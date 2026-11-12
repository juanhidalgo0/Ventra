// ═══════════════════════════════════════════════════
// Lo común de los mails de Ventra a sus clientes (signup-emails.js y account-emails.js):
// el diseño (logo, tarjeta, botón, pie), el texto plano, el envío por Resend y el registro
// que muestra el admin (ventra_email_log).
// ═══════════════════════════════════════════════════
const FROM = "Ventra <hola@ventra.store>";
// WhatsApp de Ventra = el del bot (support.js). Consultas generales las contesta el asistente; con el
// texto de WA_HUMAN el bot pasa directo a una persona (para cobros y temas de la cuenta).
const WA_NUMBER = "5492212048533";
const WA_HELP = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Hola, tengo una consulta sobre Ventra")}`;
const WA_HUMAN = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent("Quiero hablar con una persona de Ventra")}`;
const LOGO = "https://ventra.store/ventra-icon-192.png";
const LOG = "ventra_email_log";
const GREEN = "#167160";

const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : t instanceof Date ? t.getTime() : Number(t) || 0);
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstName = (name) => {
  const f = String(name || "").trim().split(/\s+/)[0] || "";
  return /^[\p{L}'-]{2,20}$/u.test(f) ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : "";
};
const hola = (name) => (firstName(name) ? `¡Hola ${firstName(name)}!` : "¡Hola!");
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "14 de noviembre" (en Argentina) */
const longDate = (t) => { const d = new Date(ms(t) - 3 * 3600e3); return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`; };
/** "14/11/2026" (en Argentina) */
const shortDate = (t) => { const d = new Date(ms(t) - 3 * 3600e3); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
const utm = (medium, campaign) => `utm_source=email&utm_medium=${medium}&utm_campaign=${campaign}`;

const BADGE = {
  warn: "color:#8A5A00;background:#FFF4DB;border:1px solid #F1D9A6",
  danger: "color:#9B2C1C;background:#FBECE8;border:1px solid #F1C7BD",
  ok: `color:${GREEN};background:#E6F4EF;border:1px solid #BFE3D6`,
  info: "color:#2F4A5E;background:#EAF1F6;border:1px solid #CFDEEA",
};

/**
 * Arma el mail. c = { subject, preheader, badge?: [texto, tono], title, paras: [html], rows?: [[etiqueta, valor]],
 *   cta?: [texto, url], help?, footer (html), footerText }
 * Los párrafos son HTML ya escapado por quien los arma; el resto se escapa acá.
 */
function render(c) {
  const rows = c.rows && c.rows.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:4px 0 16px;font-size:14.5px">${c.rows.map(([k, v]) =>
      `<tr><td style="padding:8px 0;border-bottom:1px solid #EFEAE2;color:#56655F">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #EFEAE2;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join("")}</table>`
    : "";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject)}</title></head><body style="margin:0;background:#F6F2EC;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F1F1A">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader || "")}</div>
<div style="max-width:520px;margin:0 auto;padding:24px 16px 28px">
  <table role="presentation" style="border-collapse:collapse;margin:0 0 14px"><tr><td style="padding:0 8px 0 0"><img src="${LOGO}" width="28" height="28" alt="" style="display:block;border-radius:7px"></td><td style="font-size:16px;font-weight:700;color:${GREEN};letter-spacing:.2px">Ventra</td></tr></table>
  <div style="background:#fff;border-radius:20px;padding:28px 24px;border:1px solid #E4DDD1">
    ${c.badge ? `<p style="display:inline-block;margin:0 0 12px;font-size:12.5px;font-weight:600;${BADGE[c.badge[1]] || BADGE.info};border-radius:999px;padding:4px 10px">${esc(c.badge[0])}</p>` : ""}
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(c.title)}</h1>
    ${c.paras.map((t) => `<p style="margin:0 0 14px;font-size:15.5px;line-height:1.55">${t}</p>`).join("\n    ")}
    ${rows}
    ${c.cta ? `<a href="${esc(c.cta[1])}" style="display:block;text-align:center;background:${GREEN};color:#fff;text-decoration:none;font-weight:600;border-radius:999px;padding:14px;margin:20px 0 0">${esc(c.cta[0])}</a>` : ""}
    ${c.help ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#56655F">${esc(c.help)}</p>
    <a href="${c.helpHuman ? WA_HUMAN : WA_HELP}" style="display:block;text-align:center;color:${GREEN};text-decoration:none;font-weight:600;padding:10px 0 0">Escribirnos por WhatsApp</a>` : ""}
  </div>
  <p style="margin:16px 0 0;font-size:11.5px;line-height:1.5;color:#8A958F;text-align:center">${c.footer}<br>Ventra · Sistema de ventas para comercios · <a href="https://ventra.store/privacidad.html" style="color:#8A958F">Privacidad</a></p>
</div></body></html>`;
  const strip = (s) => String(s).replace(/<br>/g, "\n").replace(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g, "$2 ($1)").replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const text = [strip(c.title), "", ...c.paras.map(strip).flatMap((t) => [t, ""]),
    ...(c.rows && c.rows.length ? [...c.rows.map(([k, v]) => `${k}: ${v}`), ""] : []),
    ...(c.cta ? [`${c.cta[0]}: ${c.cta[1]}`, ""] : []),
    ...(c.help ? [c.help, `WhatsApp: ${c.helpHuman ? WA_HUMAN : WA_HELP}`, ""] : []),
    "—", c.footerText || strip(c.footer)].join("\n");
  return { subject: c.subject, html, text };
}

async function sendEmail(apiKey, msg) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Resend respondió ${res.status}`), { status: res.status });
  return data;
}
const keyOk = (apiKey) => !!(apiKey && apiKey.startsWith("re_"));
/** 401/403: problema de la cuenta de Resend (clave o dominio), no del destinatario. */
const isSetupError = (err) => !!err && (err.status === 401 || err.status === 403);

/** Mails completos (asunto + HTML), aparte del registro para que la lista del admin siga liviana. Mismo id que en LOG. */
const BODIES = "ventra_email_bodies";
async function logSend(db, admin, nowMs, e) {
  const ref = db.collection(LOG).doc();
  const msg = e.msg && e.msg.html ? e.msg : null;
  await ref.set({
    at: admin.firestore.Timestamp.fromMillis(nowMs), kind: e.kind, step: e.step, uid: e.uid || null, to: e.to || null,
    channel: e.channel || "mail", ok: !!e.ok, id: e.id || null, ...(e.error ? { error: String(e.error).slice(0, 200) } : {}),
    ...(msg ? { subject: String(msg.subject || "").slice(0, 200), body: true } : {}),
  }).catch(() => {});
  if (msg) {
    await db.collection(BODIES).doc(ref.id).set({
      at: admin.firestore.Timestamp.fromMillis(nowMs), subject: String(msg.subject || ""), html: String(msg.html).slice(0, 400000),
      text: String(msg.text || "").slice(0, 100000), to: e.to || null, from: msg.from || FROM,
    }).catch(() => {});
  }
}

module.exports = { BODIES, FROM, WA_HELP, WA_HUMAN, WA_NUMBER, LOG, ms, esc, firstName, hola, money, longDate, shortDate, utm, render, sendEmail, keyOk, isSetupError, logSend };
