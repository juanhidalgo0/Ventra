// Vista previa de todos los mails automáticos de Ventra (no manda nada).
//   node firebase/scripts/preview-signup-emails.cjs [salida.html]
const fs = require("fs");
const path = require("path");
const se = require("../functions/signup-emails");
const ae = require("../functions/account-emails");

const D = 864e5;
const now = Date.UTC(2026, 10, 11, 18, 0);
const p = { uid: "demo", email: "jordy.ejemplo@gmail.com", name: "Jordy García" };
const acc = (plan, planName, extra = {}) => ({ uid: "demo", email: "dueno.ejemplo@gmail.com", name: "Ana López", plan, planName, paidUntil: now + 3 * D - 3600e3, mpPreapprovalId: "x", status: "active", ...extra });
const full = acc("full", "Ventra Full");
const grace = (daysAgo) => ({ ...full, paidUntil: now - daysAgo * D });
const pay = (first, extra = {}) => ({ amount: 24900, paidAt: now, newPaidUntil: now + 30 * D, previousPaidUntil: first ? null : now, ...extra });

const groups = [
  ["Registrados sin plan", [
    ["Día 0 · Bienvenida", se.emailFor("bienvenida", p, { unsubUrl: "#baja" })],
    ["Día 0 · Bienvenida (eligió plan y no terminó de pagar)", se.emailFor("bienvenida", { ...p, pendingPlan: "Ventra Full" }, { unsubUrl: "#baja" })],
    ["Día 1 · Cómo arrancar", se.emailFor("arrancar", p, { unsubUrl: "#baja" })],
    ["Día 3 · Caso real: Paulos", se.emailFor("paulos", p, { unsubUrl: "#baja" })],
    ["Día 7 · Te ayudamos a cargar", se.emailFor("ayuda", p, { unsubUrl: "#baja" })],
  ]],
  ["Cobros", [
    ["Primer pago · Bienvenida (Full)", ae.paymentEmail(pay(true), full)],
    ["Primer pago · Bienvenida (Agenda Pro)", ae.paymentEmail(pay(true, { amount: 19900 }), acc("agenda_pro", "Ventra Agenda Pro"))],
    ["Primer pago · Bienvenida (Tienda)", ae.paymentEmail(pay(true, { amount: 9900 }), acc("tienda", "Ventra Tienda"))],
    ["Pago recibido (comprobante)", ae.paymentEmail(pay(false), full)],
    ["3 días antes del cobro", ae.preChargeEmail(full, 24900)],
    ["Pago rechazado", ae.paymentFailedEmail({ amount: 24900 }, full)],
    ["Gracia · Apenas vence", se.graceEmailFor("inicio", grace(0.1), now)],
    ["Gracia · Faltan 2 días", se.graceEmailFor("fin", grace(5.2), now)],
    ["Solo lectura", se.graceEmailFor("bloqueo", grace(7.5), now)],
    ["30 días después · Volvé", ae.winbackEmail(full, { unsubUrl: "#baja" })],
  ]],
  ["Uso y cuenta", [
    ["3 días sin arrancar", ae.nudgeEmail(full, { unsubUrl: "#baja" })],
    ["Resumen mensual", ae.summaryEmail({ month: "2026-10", sales: { total: 4823500, count: 1912, prevTotal: 4410000 }, top: ["Coca-Cola 2,25 L", "Marlboro Box 20", "Alfajor Guaymallén"], orders: { count: 38, total: 612400 }, bookings: 0 }, full, { unsubUrl: "#baja" })],
    ["PC nueva vinculada", ae.deviceEmail({ name: "Caja 2 - Mostrador", linkedAt: now }, full)],
    ["Cambio de plan", ae.planChangeEmail({ planName: "Ventra Agenda" }, acc("agenda_pro", "Ventra Agenda Pro"), 19900)],
  ]],
];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const total = groups.reduce((n, g) => n + g[1].length, 0);
const out = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mails de Ventra</title>
<style>body{margin:0;background:#e9e5de;font-family:system-ui,sans-serif;color:#0F1F1A}.wrap{max-width:1180px;margin:0 auto;padding:20px 16px 40px}h1{font-size:22px;margin:0 0 4px}.sub{color:#56655F;font-size:14px;margin:0 0 8px}
h2{font-size:17px;margin:26px 0 10px;color:#167160}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}
.card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px #0002}.h{padding:12px 14px;border-bottom:1px solid #eee}.h b{display:block;font-size:13px;color:#167160}.h span{font-size:14px}
iframe{width:100%;height:820px;border:0;display:block}@media(max-width:420px){.grid{grid-template-columns:1fr}}</style></head><body><div class="wrap"><h1>Mails automáticos de Ventra</h1><p class="sub">${total} mails · vista previa con datos de ejemplo</p>
${groups.map(([g, mails]) => `<h2>${esc(g)}</h2><div class="grid">${mails.map(([label, m]) => `<div class="card"><div class="h"><b>${esc(label)}</b><span>Asunto: ${esc(m.subject)}</span></div><iframe srcdoc="${esc(m.html)}"></iframe></div>`).join("\n")}</div>`).join("\n")}
</div></body></html>`;
const file = process.argv[2] || path.join(__dirname, "..", "..", "vista-previa-mails.html");
fs.writeFileSync(file, out);
console.log(file, total);
