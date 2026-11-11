// ═══════════════════════════════════════════════════
// Imágenes de promos por WhatsApp (el dueño le pide al bot "haceme una imagen del Fernet").
//
// Herramientas que recibe la IA (ai-agent.js), solo el dueño y solo por WhatsApp:
//   crear_imagen    productos (1 a 3, combo), con o sin precio, textos, estilo, formato, escena
//   ajustar_estilo  lo que el dueño corrige ("el precio más grande", "nada de rojo") → kit de marca
//   guardar_marca   el nombre del comercio (y usar la última foto como logo)
//
// Flujo: la herramienta prepara el pedido (productos, precio, ahorro, qué falta); processInbox
// (wa-owner.js) avisa que está armando, llama a generate, sube las imágenes a Storage, las manda
// por WhatsApp y ofrece elegir (La 1 / La 2 / La 3). Elegir suma un voto a ese estilo y manda la
// misma imagen en formato historia. Si falta el nombre o el logo, lo pide antes y deja el pedido
// guardado: cuando llega el logo, sigue solo.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");
const sharp = require("sharp");
const brand = require("./brand");
const photos = require("./photos");
const designs = require("./designs");
const { render } = require("./render");
const { scene } = require("./scene");

const JOBS = "ventra_promo_images";
const USAGE = "ventra_promo_usage";
const DAILY_LIMIT = 25;
const SKIP_PRODUCTS = ["VENTA_RAPIDA", "PAGO_CTA_CTE"];
const TZ = "America/Argentina/Buenos_Aires";

const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const yes = (v) => v === true || v === 1 || v === "1" || v === "true";
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const money = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const dayKey = (now = Date.now()) => new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
const STYLE_NAMES = { nocturno: "Nocturno", precio: "Precio protagonista", invitacion: "Invitación" };

const TEXTS = {
  type: "object",
  properties: {
    etiqueta: { type: "string", description: "Frase corta arriba del título: PROMO DEL FINDE, SOLO HOY, COMBO, ¿SALE" },
    titulo: { type: "string", description: "Lo grande: el nombre del producto limpio (Fernet Branca, no FERNET BRANCA 750ML) o el nombre del combo" },
    detalle: { type: "string", description: "Línea chica: tamaño, qué trae el combo, hasta cuándo" },
    frase: { type: "string", description: "Frase con onda, escrita a mano (solo estilo invitación): el de siempre, todo para la previa" },
    accion: { type: "string", description: "Botón: PEDILO YA, RESERVÁ EL TUYO" },
    cierre: { type: "string", description: "Pie: Pedilo en el local o por GO Delivery" },
  },
  additionalProperties: false,
};

const TOOLS = [
  {
    name: "crear_imagen",
    description: "Arma imágenes para publicitar productos o combos del comercio, con su logo, nombre y colores (por defecto 3 opciones de estilo). "
      + "productos: 1 a 3, cada uno con buscar (nombre, parte del nombre o código; o el id que devolvió esta herramienta). usar_ultima_foto: true si el dueño acaba de mandar la foto de ese producto. "
      + "con_precio: false para no mostrar precio. precio: el precio a mostrar (en un combo, el precio del combo). Sin precio, usa el precio de venta (en un combo, la suma). Si el precio es menor al normal, muestra el ahorro. "
      + "textos: los escribís vos, cortos, con el tono del comercio. estilo: solo si el dueño eligió uno (nocturno, precio, invitacion): arma solo ese. formato: post (cuadrado) o historia. "
      + "escena: si querés un fondo fotográfico, describilo en una oración (ej. barra de madera con hielo y luces cálidas), sin productos ni texto.",
    input_schema: {
      type: "object",
      properties: {
        productos: { type: "array", items: { type: "object", properties: { buscar: { type: "string" }, usar_ultima_foto: { type: "boolean" } }, required: ["buscar"], additionalProperties: false } },
        con_precio: { type: "boolean" },
        precio: { type: "number" },
        textos: TEXTS,
        estilo: { type: "string", enum: brand.STYLES },
        formato: { type: "string", enum: ["post", "historia"] },
        escena: { type: "string" },
      },
      required: ["productos"],
      additionalProperties: false,
    },
  },
  {
    name: "ajustar_estilo",
    description: "Guarda lo que el dueño corrige o pide del estilo de sus imágenes, para esta y las próximas. regla: lo que dijo, en sus palabras. "
      + "Ajustes concretos (solo los que correspondan): precio_mas_grande / precio_mas_chico, prohibir_colores y permitir_colores (rojo, naranja, amarillo, verde, celeste, azul, violeta, rosa), "
      + "color_acento (hex, ej. #f2b705), tono (ej. elegante, canchero, familiar), cierre (frase fija al pie, ej. Pedilo por GO Delivery), fondo_claro (true/false).",
    input_schema: {
      type: "object",
      properties: {
        regla: { type: "string" },
        precio_mas_grande: { type: "boolean" },
        precio_mas_chico: { type: "boolean" },
        prohibir_colores: { type: "array", items: { type: "string" } },
        permitir_colores: { type: "array", items: { type: "string" } },
        color_acento: { type: "string" },
        tono: { type: "string" },
        cierre: { type: "string" },
        fondo_claro: { type: "boolean" },
      },
      required: ["regla"],
      additionalProperties: false,
    },
  },
  {
    name: "guardar_marca",
    description: "Guarda el nombre del comercio para las imágenes (cuando falta o lo quiere cambiar). usar_ultima_foto_como_logo: true si el dueño dice que la foto que mandó es el logo.",
    input_schema: {
      type: "object",
      properties: { nombre: { type: "string" }, usar_ultima_foto_como_logo: { type: "boolean" } },
      additionalProperties: false,
    },
  },
];

function systemNote(kit, last) {
  const d = brand.describe(kit);
  return `- Imágenes de promos: con crear_imagen armás imágenes con el logo, el nombre y los colores del comercio. Los textos los escribís vos y son lo que hace que la imagen venda: cortos, con onda argentina, sin errores y con el tono del comercio (o el que pidió el dueño). Completá siempre:
  · etiqueta: gancho de 2 a 4 palabras (PROMO DEL FINDE, SOLO HOY, PARA LA PREVIA, ¿SALE).
  · titulo: en un combo, un nombre propio con gracia (Combo Fernandito, Combo Previa, Kit Mate); con un solo producto, su nombre limpio (Fernet Branca, no FERNET BRANCA 750ML).
  · detalle: qué lleva o el tamaño (Fernet Branca 750 + Coca-Cola 2,25 L).
  · frase: una línea con onda escrita a mano (todo para la previa, el de siempre).
  · accion: el botón (PEDILO YA, RESERVÁ EL TUYO). cierre: solo si el dueño lo pidió o está en sus ajustes.
  No pongas el precio en los textos (lo pone el diseño, exacto). No inventes fechas ni condiciones que el dueño no dijo. Si hay varios productos parecidos, preguntá cuál con las opciones que trae la herramienta. Cuando la herramienta devuelve listo, respondé solo una oración corta (ej. "Ahí te las armo") y nada más: el sistema manda las imágenes.
- Si el dueño corrige algo del estilo ("más grande el precio", "sin rojo", "más elegante"), primero usá ajustar_estilo y después volvé a crear la imagen con ese cambio (con el mismo estilo si había elegido uno).
- Si falta el nombre o el logo, pedíselo antes: el nombre con guardar_marca; el logo, que mande una foto. Usá guardar_marca solo si falta algo o el dueño pide cambiarlo.
- Kit de marca de este comercio: ${JSON.stringify(d)}${last ? `\n- Última imagen que le armaste: ${JSON.stringify(last)}` : ""}`;
}

/** Productos vigentes con lo que hace falta para la imagen */
async function listProducts(sql, uid) {
  return run(sql, `SELECT id, data->>'name' AS name, data->>'barcode' AS barcode, data->>'sku' AS sku, data->>'sale_price' AS price,
      data->>'is_active' AS active, data->>'image_url' AS image_url, data->>'unit' AS unit
    FROM sync_rows WHERE tenant_id = $1 AND tbl = 'products' AND NOT deleted AND id <> ALL($2)`, [uid, SKIP_PRODUCTS]);
}

function findOne(products, buscar) {
  const raw = String(buscar || "").trim();
  if (!raw) return {};
  const byId = products.find((p) => p.id === raw || (p.barcode && p.barcode === raw) || (p.sku && p.sku === raw));
  if (byId) return { product: byId };
  const q = norm(raw);
  const exact = products.filter((p) => norm(p.name) === q);
  if (exact.length === 1) return { product: exact[0] };
  const words = q.split(" ").filter(Boolean);
  const found = products.filter((p) => words.every((w) => norm(p.name).includes(w)));
  found.sort((a, b) => (yes(b.active) - yes(a.active)) || String(a.name).length - String(b.name).length);
  if (found.length === 1) return { product: found[0] };
  return found.length ? { options: found } : {};
}

/**
 * Lo que pidió la IA → pedido listo para armar, o dudas / lo que falta.
 * Devuelve { result } para la IA y, si está todo, { plan }.
 */
async function prepare({ sql }, uid, kit, input = {}, lastPhoto = null) {
  if (kit.needs.length) {
    return { result: { listo: false, falta: kit.needs, instruccion: `Antes de la primera imagen hace falta ${kit.needs.map((n) => (n === "logo" ? "el logo (que mande una foto del logo)" : "el nombre del comercio")).join(" y ")}. Pedíselo; el pedido queda guardado y sigue solo cuando llegue.` }, pending: input };
  }
  const want = Array.isArray(input.productos) ? input.productos : [];
  if (!want.length) return { result: { listo: false, dudas: [{ problema: "No dijo qué producto" }] } };
  if (want.length > 3) return { result: { listo: false, dudas: [{ problema: "Una imagen lleva hasta 3 productos" }] } };
  const all = await listProducts(sql, uid);
  const doubts = [];
  const chosen = [];
  for (const w of want) {
    const f = findOne(all, w.buscar);
    if (f.product) { chosen.push({ ...f.product, ownPhoto: !!w.usar_ultima_foto && lastPhoto ? lastPhoto : null }); continue; }
    doubts.push(f.options
      ? { buscado: w.buscar, problema: "Hay varios parecidos: preguntale cuál", opciones: f.options.slice(0, 6).map((p) => ({ id: p.id, producto: p.name, precio: Number(p.price) || 0 })), total: f.options.length }
      : { buscado: w.buscar, problema: "No encontré ese producto en Ventra" });
  }
  if (doubts.length) return { result: { listo: false, dudas: doubts } };
  const showPrice = input.con_precio !== false;
  const sum = chosen.reduce((a, p) => a + (Number(p.price) || 0), 0);
  let price = null, oldPrice = null;
  if (showPrice) {
    price = Number.isFinite(num(input.precio)) && num(input.precio) > 0 ? num(input.precio) : sum;
    if (!(price > 0)) return { result: { listo: false, dudas: [{ problema: "Esos productos no tienen precio cargado: preguntale a cuánto lo pone o si va sin precio" }] } };
    if (sum > price) oldPrice = sum;
  }
  const plan = {
    products: chosen.map((p) => ({ id: p.id, name: p.name, barcode: p.barcode || null, hasImage: !!p.image_url, price: Number(p.price) || 0, ownPhoto: p.ownPhoto || null })),
    price, oldPrice,
    texts: input.textos || {},
    style: brand.STYLES.includes(input.estilo) ? input.estilo : null,
    format: input.formato === "historia" ? "story" : "post",
    scene: String(input.escena || "").slice(0, 300) || null,
  };
  return {
    plan,
    result: {
      listo: true,
      productos: plan.products.map((p) => `${p.name} (${money(p.price)})`),
      precioQueSeMuestra: price ? money(price) : "sin precio",
      ...(oldPrice ? { separadosSalen: money(oldPrice), ahorro: `${money(oldPrice - price)} (${Math.round(((oldPrice - price) / oldPrice) * 100)}%)` } : {}),
      aviso: "El sistema ya arma y manda las imágenes. Respondé solo una oración corta.",
    },
  };
}

/** Tope diario de imágenes por comercio. Devuelve true si se puede (y lo cuenta). */
async function allow(db, uid, n, now = Date.now()) {
  const ref = db.collection(USAGE).doc(`${dayKey(now)}_${uid}`);
  const snap = await ref.get();
  const used = snap.exists ? Number(snap.data().images) || 0 : 0;
  if (used + n > DAILY_LIMIT) return false;
  await ref.set({ uid, day: dayKey(now), images: used + n }, { merge: true });
  return true;
}

/** Sube la imagen a Storage con link de descarga (WhatsApp la baja desde ahí) */
async function upload(bucket, path, buf, type = "image/jpeg") {
  const token = crypto.randomUUID();
  await bucket.file(path).save(buf, { metadata: { contentType: type, cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } } });
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : "https://firebasestorage.googleapis.com";
  return `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/** Nombre corto para mostrar (FERNET BRANCA 750ML → Fernet Branca 750ml) */
const display = (name) => String(name || "").toLowerCase().replace(/(^|[\s(/-])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(\d+)\s*(ml|cc|l|lt|kg|gr|g)\b/gi, (m, n, u) => `${n} ${u.toLowerCase()}`);

/**
 * Arma las imágenes. deps: { db, bucket, uid, kit, logger, renderImpl?, photoImpl?, sceneImpl? }.
 * Devuelve { id, variants: [{ style, format, url, path }], missing: [nombres sin foto] }.
 */
async function generate(deps, plan, { from = null, now = Date.now() } = {}) {
  const { db, bucket, uid, kit, logger } = deps;
  const renderImpl = deps.renderImpl || render;
  const sceneImpl = deps.sceneImpl || scene;
  const photoImpl = deps.photoImpl || ((p) => photos.productPhoto({ bucket, uid }, p));

  // Fotos: la que mandó el dueño > la oficial en alta > la de la caja. Recortadas.
  const prods = [];
  const missing = [];
  for (const p of plan.products) {
    let raw = null;
    if (p.ownPhoto && bucket) [raw] = await bucket.file(p.ownPhoto).download().catch(() => [null]);
    if (!raw) { const ph = await photoImpl(p).catch(() => null); raw = ph && ph.buf; }
    if (!raw) { missing.push(p.name); continue; }
    const c = await photos.cutout(raw);
    prods.push({ buf: c.png, mime: "image/png", width: c.width, height: c.height, display: display(p.name) });
  }
  if (missing.length) return { missing };

  const styles = plan.style ? [plan.style] : brand.styleOrder(kit);
  // Sin precio, la invitación va primero (es el estilo pensado para eso)
  if (!plan.price && !plan.style) styles.sort((a, b) => (b === "invitacion") - (a === "invitacion"));
  const fmt = plan.format || "post";
  const bg = plan.scene ? await sceneImpl(plan.scene, { aspect: fmt === "story" ? "9:16" : "1:1", logger }) : null;
  const id = `${now.toString(36)}${crypto.randomBytes(3).toString("hex")}`;
  const variants = [];
  for (const style of styles) {
    const spec = {
      style, colors: kit.colors, tweaks: kit.tweaks, logo: kit.logo,
      products: prods, price: plan.price, oldPrice: plan.oldPrice, texts: plan.texts,
      scene: bg && (style !== "precio") ? bg : null,
    };
    const jpg = await renderImpl(designs.html(spec, fmt), designs.FORMATS[fmt]);
    const path = `tenants/${uid}/promos/${id}/${style}-${fmt}.jpg`;
    const url = bucket ? await upload(bucket, path, jpg) : null;
    variants.push({ style, format: fmt, path, url, bytes: jpg.length, ...(deps.keepBuffers ? { jpg } : {}) });
  }
  await db.collection(JOBS).doc(id).set({ uid, from, plan: { ...plan, products: plan.products.map(({ ownPhoto, ...p }) => p) }, variants: variants.map(({ jpg, ...v }) => v), createdAt: now, scene: !!bg });
  return { id, variants, scene: !!bg };
}

/**
 * Eligió la opción n (1 a 3): suma el voto a ese estilo y arma la misma en el otro formato.
 * Devuelve { style, extra: { url, format } } o { error }.
 */
async function pick(deps, jobId, n, { from, now = Date.now() } = {}) {
  const { db, uid, kit } = deps;
  const snap = await db.collection(JOBS).doc(String(jobId)).get();
  if (!snap.exists) return { error: "No encontré esas imágenes. Pedímelas de nuevo." };
  const job = snap.data();
  if (job.uid !== uid || (from && job.from && job.from !== from)) return { error: "Esas imágenes no son tuyas." };
  const v = job.variants[Number(n) - 1];
  if (!v) return { error: "Esa opción no existe." };
  if (job.picked === v.style) return { style: v.style, already: true };
  await brand.recordPick(db, uid, kit, v.style);
  await db.collection(JOBS).doc(String(jobId)).set({ picked: v.style, pickedAt: now }, { merge: true });
  const other = v.format === "post" ? "historia" : "post";
  const r = await generate(deps, { ...job.plan, style: v.style, format: other === "historia" ? "story" : "post" }, { from, now });
  if (r.missing) return { style: v.style };
  return { style: v.style, extra: r.variants[0] };
}

/**
 * Para una pregunta: las herramientas de imágenes y lo que la IA pidió.
 * session.plan (armar), session.pending (falta nombre/logo), session.learned (ajustes), session.brandSaved.
 */
function session({ sql, db, bucket, uid, kit: known, loadKit, from, lastPhoto, last }) {
  // El kit completo (logo, colores, base) se carga recién cuando la IA usa una herramienta
  let kitPromise = null;
  const getKit = () => kitPromise || (kitPromise = known && known.colors ? Promise.resolve(known) : loadKit());
  let kit = known || {};
  const s = {
    tools: TOOLS,
    systemNote: systemNote(kit, last),
    plan: null,
    pending: null,
    get kit() { return kit; },
    async call(name, input = {}) {
      kit = await getKit();
      if (name === "crear_imagen") {
        // Un cambio sobre la imagen anterior sin textos nuevos: se quedan los de antes
        if (last && last.textos && Object.keys(last.textos).length && !(input.textos && Object.keys(input.textos).length)) input = { ...input, textos: last.textos };
        const r = await prepare({ sql }, uid, kit, input, lastPhoto);
        s.plan = r.plan || null;
        if (r.pending) {
          s.pending = r.pending;
          await brand.save(db, uid, { pendingRequest: { input: r.pending, from, at: Date.now() }, awaitingLogo: kit.needs.includes("logo") });
        }
        return r.result;
      }
      if (name === "ajustar_estilo") {
        const tw = {};
        const cur = Number(kit.tweaks.priceScale) || 1;
        if (input.precio_mas_grande) tw.priceScale = cur + 0.18;
        if (input.precio_mas_chico) tw.priceScale = cur - 0.15;
        if (input.prohibir_colores) tw.bannedColors = input.prohibir_colores.map(norm);
        if (input.permitir_colores) tw.allowColors = input.permitir_colores.map(norm);
        if (input.color_acento) tw.accent = input.color_acento;
        if (input.tono) tw.tone = input.tono;
        if (input.cierre !== undefined) tw.signature = input.cierre;
        if (typeof input.fondo_claro === "boolean") tw.lightBackground = input.fondo_claro;
        const saved = await brand.learnRule(db, uid, kit, input.regla || "", tw);
        kit.rules = saved.rules;
        kit.tweaks = saved.tweaks;
        kit.colors = brand.palette({ store: kit.store, logo: kit.logoColors, tweaks: saved.tweaks });
        s.systemNote = systemNote(kit, last);
        s.learned = true;
        return { ok: true, guardado: input.regla, ajustes: saved.tweaks };
      }
      if (name === "guardar_marca") {
        const patch = {};
        if (input.nombre) patch.name = String(input.nombre).trim().slice(0, 60);
        if (input.usar_ultima_foto_como_logo) {
          if (!lastPhoto) return { error: "No tengo una foto reciente: pedile que mande la foto del logo" };
          const saved = await saveLogo({ db, bucket, uid }, lastPhoto);
          Object.assign(patch, saved);
        }
        if (Object.keys(patch).length) await brand.save(db, uid, patch);
        if (patch.name) { kit.name = patch.name; kit.needs = kit.needs.filter((x) => x !== "nombre"); }
        if (patch.logoPath) kit.needs = kit.needs.filter((x) => x !== "logo");
        s.brandSaved = true;
        return { ok: true, falta: kit.needs };
      }
      return { error: "Herramienta desconocida" };
    },
  };
  return s;
}

/**
 * Una foto que mandó el dueño (ya en Storage, en `path`) como logo: le saca el fondo si es
 * claro y parejo, la achica y la guarda. Devuelve { logoPath, awaitingLogo: false }.
 */
async function saveLogo({ db, bucket, uid }, path) {
  const [buf] = await bucket.file(path).download();
  const c = await photos.cutout(buf, { maxSide: 700, tolerance: 40 });
  const png = await sharp(c.png).resize(600, 600, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const logoPath = `tenants/${uid}/brand/logo.png`;
  await bucket.file(logoPath).save(png, { metadata: { contentType: "image/png" } });
  return { logoPath, awaitingLogo: false, logoAt: Date.now() };
}

/** Guarda una foto que mandó el dueño (para usarla como logo o como foto de un producto) */
async function savePhoto(bucket, uid, buf, now = Date.now()) {
  const jpg = await sharp(buf).rotate().resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  const path = `tenants/${uid}/promo-photos/${now.toString(36)}.jpg`;
  await bucket.file(path).save(jpg, { metadata: { contentType: "image/jpeg" } });
  return path;
}

module.exports = { TOOLS, session, prepare, generate, pick, saveLogo, savePhoto, allow, display, JOBS, USAGE, DAILY_LIMIT, STYLE_NAMES };
