// Prueba REAL de la devolución de "Invitá un comercio" con Mercado Pago (plata de verdad: $100).
// Usa el mismo código que la nube (functions/referrals.js → useCredit) sobre una base falsa en memoria:
// no toca Firestore ni ninguna cuenta de clientes. Lo corre el dueño, con la clave de MP en su terminal.
//
//   1) $env:MP_TOKEN = (firebase functions:secrets:access VENTRA_MP_ACCESS_TOKEN --project ventra-9cba5)
//   2) node firebase/test/referral-refund-live.cjs crear       → link para pagar $100 (con OTRA cuenta de MP)
//   3) node firebase/test/referral-refund-live.cjs buscar      → muestra el pago de prueba y su número
//   4) node firebase/test/referral-refund-live.cjs devolver N  → lo devuelve con useCredit y confirma
//
// Solo actúa sobre pagos con la referencia "ventra-prueba-devolucion": no puede devolver otra cosa.
const path = require("path");
const { fakeAdmin, fakeDb } = require("./fake-firestore.cjs");

const adminPath = require.resolve("firebase-admin", { paths: [path.join(__dirname, "../functions")] });
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: { firestore: fakeAdmin.firestore } };
const referrals = require("../functions/referrals");

const REF = "ventra-prueba-devolucion";
const AMOUNT = 100;
const token = String(process.env.MP_TOKEN || "").trim();
const [cmd, arg] = process.argv.slice(2);

async function mp(method, url, body) {
  const r = await fetch(`https://api.mercadopago.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(method === "POST" ? { "X-Idempotency-Key": `${REF}-${Date.now()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

(async () => {
  if (!/^APP_USR-/.test(token)) {
    console.log("Falta la clave: corré primero\n  $env:MP_TOKEN = (firebase functions:secrets:access VENTRA_MP_ACCESS_TOKEN --project ventra-9cba5)");
    process.exitCode = 1;
    return;
  }

  if (cmd === "crear") {
    const pref = await mp("POST", "/checkout/preferences", {
      items: [{ title: "Prueba de devolución Ventra (se devuelve)", quantity: 1, unit_price: AMOUNT, currency_id: "ARS" }],
      external_reference: REF,
      back_urls: { success: "https://ventra.store", failure: "https://ventra.store", pending: "https://ventra.store" },
    });
    console.log(`\nLink para pagar $${AMOUNT} (abrilo y pagá con una cuenta de MP o tarjeta que NO sea la de Ventra):\n\n  ${pref.init_point}\n`);
    console.log("Después corré:  node firebase/test/referral-refund-live.cjs buscar");
    return;
  }

  if (cmd === "buscar") {
    const res = await mp("GET", `/v1/payments/search?external_reference=${REF}&sort=date_created&criteria=desc&limit=10`);
    const list = res.results || [];
    if (!list.length) { console.log("Todavía no hay pagos de prueba. Si recién pagaste, esperá un minuto."); return; }
    for (const p of list) console.log(`  N.º ${p.id} · $${p.transaction_amount} · ${p.status} (${p.status_detail}) · ${p.date_created}`);
    console.log("\nPara devolver el aprobado:  node firebase/test/referral-refund-live.cjs devolver <N.º>");
    return;
  }

  if (cmd === "devolver") {
    const id = String(arg || "").trim();
    if (!/^\d+$/.test(id)) { console.log("Pasá el número del pago: node firebase/test/referral-refund-live.cjs devolver 123456"); process.exitCode = 1; return; }
    const pay = await mp("GET", `/v1/payments/${id}`);
    // Candado: solo el pago de prueba, por $100 y aprobado
    if (pay.external_reference !== REF || Number(pay.transaction_amount) !== AMOUNT) {
      console.log(`Ese pago no es el de prueba (referencia ${pay.external_reference}, $${pay.transaction_amount}). No se toca.`);
      process.exitCode = 1;
      return;
    }
    if (pay.status !== "approved") { console.log(`El pago está ${pay.status}: solo se devuelve uno aprobado.`); process.exitCode = 1; return; }

    // Igual que en la nube: una cuenta con 1 mes ganado recibe un cobro aprobado → se devuelve
    const db = fakeDb({ ventra_accounts: { prueba: { referralCredits: 1 } } });
    const logger = { info: (m) => console.log("  [nube] " + m), error: (m, e) => console.log("  [nube] ERROR " + m, e || ""), warn: () => {} };
    const out = await referrals.useCredit(db, { uid: "prueba", authorizedPaymentId: `prueba-${id}`, mpPaymentId: id, amount: AMOUNT, accessToken: token, logger });
    console.log(`\nResultado de useCredit: ${out}`);
    console.log(`Meses que le quedan a la cuenta de prueba: ${db.data.ventra_accounts.prueba.referralCredits} (debería ser 0)`);
    console.log("Lo que quedó anotado en el cobro:", JSON.stringify(db.data["ventra_accounts/prueba/payments"][`prueba-${id}`].referralRefund));

    const after = await mp("GET", `/v1/payments/${id}`);
    console.log(`\nMercado Pago dice: ${after.status} · devuelto $${after.transaction_amount_refunded || 0} de $${after.transaction_amount}`);
    console.log(after.status === "refunded" ? "\n✅ La devolución funciona." : "\n⚠️ Revisá: el pago no figura como devuelto.");
    return;
  }

  console.log("Uso: crear | buscar | devolver <N.º>");
})().catch((e) => { console.error("\n" + e.message); process.exitCode = 1; });
