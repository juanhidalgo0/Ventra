// ═══════════════════════════════════════════════════
// Kit de marca de cada comercio, para las imágenes de promos.
//
// De dónde sale:
//   - Nombre y logo: la configuración de la caja (store_settings en la réplica de Neon).
//   - Colores: los de la tienda online (ventra_stores.primaryColor/secondaryColor) si el comercio
//     los eligió; si no, los que se sacan del logo.
//   - Lo aprendido: ventra_brand_kits/{uid} (estilos elegidos, reglas que dijo el dueño, nombre y
//     logo cargados por WhatsApp si la caja no los tenía).
//
// Lo que aprende:
//   picks:   cuántas veces eligió cada estilo → el preferido sale primero.
//   rules:   frases del dueño ("nada de rojo", "el precio más grande") → la IA las lee siempre.
//   tweaks:  ajustes concretos que se aplican al diseño (tamaño del precio, colores prohibidos,
//            color de acento, tono, frase de cierre).
// ═══════════════════════════════════════════════════
const sharp = require("sharp");

const KITS = "ventra_brand_kits";
const STYLES = ["nocturno", "precio", "invitacion"];
/** El color que la tienda trae de fábrica: si sigue ese, el comercio no eligió color */
const DEFAULT_STORE_COLORS = new Set(["#0e6e52", "#1e293b"]);
const MAX_RULES = 20;

const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));
const parseSetting = (v) => { try { return JSON.parse(v); } catch { return v; } };

// ── Colores ──
const hex = (r, g, b) => `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}`;
function rgbOf(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
/** Luminancia relativa (WCAG): para elegir texto claro u oscuro encima de un color */
function luminance(h) {
  const c = rgbOf(h);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const inkOn = (bg) => (luminance(bg) > 0.45 ? "#0b0b0b" : "#ffffff");

/** Nombres de colores que el dueño puede prohibir ("nada de rojo") → rango de tono */
const HUES = { rojo: [345, 15], naranja: [15, 40], amarillo: [40, 65], verde: [65, 170], celeste: [170, 200], azul: [200, 255], violeta: [255, 290], rosa: [290, 345] };
function isBanned(h, banned = []) {
  const c = rgbOf(h);
  if (!c) return false;
  const [hue, s, l] = hsl(c);
  if (s < 0.25 || l < 0.12 || l > 0.92) return false;
  return banned.some((name) => {
    const r = HUES[name];
    if (!r) return false;
    return r[0] > r[1] ? hue >= r[0] || hue < r[1] : hue >= r[0] && hue < r[1];
  });
}

/**
 * Colores de un logo: el oscuro, el claro y los vivos más usados (los píxeles transparentes no
 * cuentan). Devuelve { dark, light, vivid: [..] }.
 */
async function logoColors(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  // El oscuro y el claro: el promedio de los píxeles muy oscuros / muy claros (no uno solo,
  // que en los bordes suavizados sale de cualquier tono)
  const darkSum = [0, 0, 0, 0], lightSum = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const [, s, l] = hsl(rgb);
    if (l < 0.18) { darkSum[0] += rgb[0]; darkSum[1] += rgb[1]; darkSum[2] += rgb[2]; darkSum[3]++; }
    if (l > 0.88) { lightSum[0] += rgb[0]; lightSum[1] += rgb[1]; lightSum[2] += rgb[2]; lightSum[3]++; }
    if (s < 0.35 || l < 0.15 || l > 0.9) continue;
    const key = rgb.map((v) => v >> 4).join(",");
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += rgb[0]; b.g += rgb[1]; b.b += rgb[2];
    buckets.set(key, b);
  }
  const vivid = [...buckets.values()].sort((a, b) => b.n - a.n).filter((b) => b.n >= 6).slice(0, 3).map((b) => hex(b.r / b.n, b.g / b.n, b.b / b.n));
  return {
    dark: darkSum[3] >= 8 ? hex(darkSum[0] / darkSum[3], darkSum[1] / darkSum[3], darkSum[2] / darkSum[3]) : "#0b0b0b",
    light: lightSum[3] >= 8 ? hex(lightSum[0] / lightSum[3], lightSum[1] / lightSum[3], lightSum[2] / lightSum[3]) : "#ffffff",
    vivid,
  };
}

/** Acentos de reserva que combinan con casi todo (amarillo, rojo, celeste), sin los prohibidos */
const SPARE_ACCENTS = ["#f2b705", "#e63946", "#2ec4b6", "#ff7a00", "#7b2cbf"];

/**
 * Paleta final. Prioridad: lo que pidió el dueño (tweaks.accent) > tienda online > logo > reserva.
 * Nunca usa un color prohibido. { dark, light, accent, accent2, accentInk, accent2Ink }
 */
function palette({ store = {}, logo = null, tweaks = {} }) {
  const banned = tweaks.bannedColors || [];
  const ok = (c) => c && rgbOf(c) && !isBanned(c, banned);
  const chosen = [store.primaryColor, store.secondaryColor].map((c) => String(c || "").toLowerCase()).filter((c) => rgbOf(c) && !DEFAULT_STORE_COLORS.has(c));
  const candidates = [tweaks.accent, ...chosen, ...((logo && logo.vivid) || []), ...SPARE_ACCENTS].filter(ok);
  const accent = candidates[0] || "#f2b705";
  const accent2 = candidates.find((c) => c !== accent && Math.abs(hsl(rgbOf(c))[0] - hsl(rgbOf(accent))[0]) > 40) || "#ffffff";
  const dark = (logo && logo.dark) || "#0b0b0b";
  const light = (logo && logo.light) || "#ffffff";
  return { dark, light, accent, accent2, accentInk: inkOn(accent), accent2Ink: inkOn(accent2) };
}

/** Logo como data URL (lo que guarda la caja) → Buffer, o null */
function dataUrlBuffer(v) {
  const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(v || ""));
  return m ? Buffer.from(m[1], "base64") : null;
}

/**
 * El kit completo de un comercio. deps: { sql, db, bucket? }.
 * needs: lo que falta para poder hacer imágenes ("nombre", "logo").
 */
async function load({ sql, db, bucket }, uid) {
  const [settings, kitSnap, storeSnap] = await Promise.all([
    run(sql, `SELECT id, data->>'value' AS v FROM sync_rows WHERE tenant_id = $1 AND tbl = 'store_settings' AND id = ANY($2) AND NOT deleted`, [uid, ["store_name", "store_logo", "business_profile"]]),
    db.collection(KITS).doc(uid).get(),
    db.collection("ventra_stores").where("ownerUid", "==", uid).get().catch(() => null),
  ]);
  const s = Object.fromEntries(settings.map((r) => [r.id, parseSetting(r.v)]));
  const kit = kitSnap.exists ? kitSnap.data() : {};
  const store = storeSnap && storeSnap.docs && storeSnap.docs[0] ? storeSnap.docs[0].data() : {};
  const name = String(kit.name || s.store_name || store.businessName || "").trim();

  // Logo: el que cargó por WhatsApp (Storage) > el de la caja > el de la tienda online
  let logo = null;
  if (kit.logoPath && bucket) logo = await bucket.file(kit.logoPath).download().then(([b]) => b).catch(() => null);
  if (!logo) logo = dataUrlBuffer(s.store_logo);
  if (!logo && store.logoUrl && /^https:\/\//.test(store.logoUrl)) {
    logo = await fetch(store.logoUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? Buffer.from(b) : null)).catch(() => null);
  }
  const logoInfo = logo ? await logoColors(logo).catch(() => null) : null;
  const tweaks = kit.tweaks || {};
  const needs = [];
  if (!name) needs.push("nombre");
  if (!logo) needs.push("logo");
  return {
    uid, name, logo, profile: s.business_profile || null,
    store: { primaryColor: store.primaryColor || null, secondaryColor: store.secondaryColor || null },
    colors: palette({ store, logo: logoInfo, tweaks }),
    logoColors: logoInfo,
    tweaks,
    rules: Array.isArray(kit.rules) ? kit.rules.slice(-MAX_RULES) : [],
    picks: kit.picks || {},
    awaitingLogo: !!kit.awaitingLogo,
    needs,
  };
}

/** Estilos en el orden en que se ofrecen: los más elegidos primero (sin elegir: el orden de fábrica) */
function styleOrder(kit) {
  const picks = kit.picks || {};
  return [...STYLES].sort((a, b) => (Number(picks[b]) || 0) - (Number(picks[a]) || 0) || STYLES.indexOf(a) - STYLES.indexOf(b));
}

/** Lo aprendido, sin cargar logo ni base (una sola lectura): para la nota de la IA en cada pregunta */
async function learned(db, uid) {
  const snap = await db.collection(KITS).doc(uid).get();
  const k = snap.exists ? snap.data() : {};
  return { name: k.name || null, rules: Array.isArray(k.rules) ? k.rules.slice(-MAX_RULES) : [], tweaks: k.tweaks || {}, picks: k.picks || {}, pendingRequest: k.pendingRequest || null, awaitingLogo: !!k.awaitingLogo };
}

/** Para la IA: el kit en pocas palabras (qué le gusta al dueño y qué reglas dejó) */
function describe(kit) {
  const fav = styleOrder(kit)[0];
  const total = Object.values(kit.picks || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  return {
    comercio: kit.name || null,
    falta: kit.needs || [],
    colores: kit.colors || null,
    estiloPreferido: total ? fav : null,
    elecciones: kit.picks || {},
    reglasDelDueño: (kit.rules || []).map((r) => r.text),
    ajustes: kit.tweaks,
  };
}

/** Guarda lo aprendido (merge) */
async function save(db, uid, patch) {
  await db.collection(KITS).doc(uid).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

/** Una regla nueva del dueño, con los ajustes concretos que la IA sacó de ella */
async function learnRule(db, uid, kit, text, tweaks = {}) {
  const rules = [...(kit.rules || []), { text: String(text).slice(0, 200), at: Date.now() }].slice(-MAX_RULES);
  const merged = { ...(kit.tweaks || {}) };
  if (Number.isFinite(Number(tweaks.priceScale))) merged.priceScale = Math.min(1.6, Math.max(0.7, Number(tweaks.priceScale)));
  if (Array.isArray(tweaks.bannedColors)) merged.bannedColors = [...new Set([...(merged.bannedColors || []), ...tweaks.bannedColors.filter((c) => HUES[c])])];
  if (Array.isArray(tweaks.allowColors)) merged.bannedColors = (merged.bannedColors || []).filter((c) => !tweaks.allowColors.includes(c));
  if (tweaks.accent && rgbOf(tweaks.accent)) merged.accent = String(tweaks.accent).toLowerCase();
  if (tweaks.tone) merged.tone = String(tweaks.tone).slice(0, 80);
  if (tweaks.signature !== undefined) merged.signature = String(tweaks.signature || "").slice(0, 60);
  if (typeof tweaks.lightBackground === "boolean") merged.lightBackground = tweaks.lightBackground;
  await save(db, uid, { rules, tweaks: merged });
  return { rules, tweaks: merged };
}

async function recordPick(db, uid, kit, style) {
  if (!STYLES.includes(style)) return;
  const picks = { ...(kit.picks || {}) };
  picks[style] = (Number(picks[style]) || 0) + 1;
  await save(db, uid, { picks, lastPick: { style, at: Date.now() } });
}

module.exports = { load, learned, palette, logoColors, styleOrder, describe, save, learnRule, recordPick, isBanned, inkOn, luminance, rgbOf, dataUrlBuffer, STYLES, KITS, HUES };
