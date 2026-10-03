// ═══════════════════════════════════════════════════
// Pagos de Mercado Pago sin venta: el control vive en la nube.
//
// Así avisa igual si el comercio usa la PC, la caja en la nube o las dos, sin
// duplicar y aunque nadie tenga Ventra abierto:
//   1. Mercado Pago avisa cada pago (webhook "payment") → se verifica contra la API
//      y queda en ventra_mp_checks/{paymentId} con dueAt = ahora + 5 min (el tiempo
//      del cajero para cargar la venta).
//   2. Cada 5 minutos se revisan los vencidos. Sin pendientes no se toca Neon.
//   3. Se busca en la réplica (sync_rows) una venta de MP de ese monto cerca de esa
//      hora. Si no hay, el aviso entra como una fila más de app_notifications (llega
//      a la campanita de todas las cajas por la sincronización) y va al celular.
//
// Si las cajas todavía no subieron sus ventas (PC sin internet), se espera: un aviso
// de una venta que sí estaba cargada le saca confianza al control.
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");
const crypto = require("crypto");
const logger = require("firebase-functions/logger");

const checks = () => admin.firestore().collection("ventra_mp_checks");
const GRACE_MS = 5 * 60 * 1000;
const MATCH_MS = 30 * 60 * 1000;
/** Si las cajas no sincronizan en este tiempo, el pago se deja de revisar (sin avisar) */
const GIVE_UP_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
/** Un control resuelto se corre al futuro: la consulta de pendientes es solo por fecha (sin índice compuesto) */
const DONE = () => admin.firestore.Timestamp.fromMillis(Date.UTC(2999, 0, 1));

const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));
const tsOf = (alias, col) => `(CASE WHEN jsonb_typeof(${alias}.data->'${col}') = 'number'
  THEN to_timestamp((${alias}.data->>'${col}')::float8 / 1000)
  ELSE (${alias}.data->>'${col}')::timestamptz END)`;

/** Deja un pago recibido esperando su control (una sola vez por pago). */
async function enqueue(uid, view) {
  const at = Date.parse(view.at || "") || Date.now();
  const amount = Math.round((Number(view.amount) - Number(view.refunded || 0)) * 100) / 100;
  if (!(amount > 0)) return;
  try {
    await checks().doc(String(view.id)).create({
      uid,
      paymentId: String(view.id),
      amount,
      at: admin.firestore.Timestamp.fromMillis(at),
      channel: view.channel || "other",
      status: "pending",
      dueAt: admin.firestore.Timestamp.fromMillis(Math.max(Date.now(), at) + GRACE_MS),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (err.code !== 6) throw err; // 6 = ya existe: Mercado Pago avisa varias veces el mismo pago
  }
}

/**
 * Revisa los pagos vencidos. `deps`: { getSql(), cloudSync, syncHead, notify, db, mpMethodsFor(uid) }.
 */
async function runDue(deps) {
  const snap = await checks().where("dueAt", "<=", admin.firestore.Timestamp.now()).limit(100).get();
  const due = snap.docs.filter((d) => d.data().status === "pending");
  if (!due.length) return { checked: 0 };
  const sql = deps.getSql();
  let alerted = 0;

  for (const doc of due) {
    const c = doc.data();
    const at = c.at.toMillis();
    try {
      // ¿Las cajas ya subieron lo que pasó hasta un rato después del pago?
      const t = await run(sql, `SELECT last_push_at FROM sync_tenants WHERE tenant_id = $1`, [c.uid]);
      const lastPush = t[0] && t[0].last_push_at ? new Date(t[0].last_push_at).getTime() : 0;
      if (lastPush < at + 60 * 1000) {
        if (Date.now() - at > GIVE_UP_MS) await doc.ref.update({ status: "skipped", reason: "sin sincronizar", dueAt: DONE() });
        else await doc.ref.update({ dueAt: admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_MS) });
        continue;
      }

      const near = await run(sql, `
        SELECT p.data->>'method' AS method, p.data->>'reference' AS reference, (s.data->>'sale_number')::bigint AS sale_number
        FROM sync_rows p
        JOIN sync_rows s ON s.tenant_id = p.tenant_id AND s.tbl = 'sales' AND s.id = p.data->>'sale_id' AND NOT s.deleted
        WHERE p.tenant_id = $1 AND p.tbl = 'payments' AND NOT p.deleted
          AND abs(COALESCE((p.data->>'amount')::float8, 0) - $2) < 0.01
          AND s.data->>'status' = 'COMPLETED'
          AND ${tsOf("s", "created_at")} BETWEEN to_timestamp($3::float8 / 1000) AND to_timestamp($4::float8 / 1000)`,
      [c.uid, c.amount, at - MATCH_MS, at + MATCH_MS]);

      const mpSet = new Set(["MERCADOPAGO", ...(await deps.mpMethodsFor(c.uid))]);
      const isMp = (r) => mpSet.has(r.method) || String(r.reference || "").startsWith("MP ") || String(r.reference || "").includes(`pago N° ${c.paymentId} `);
      if (near.some(isMp)) {
        await doc.ref.update({ status: "matched", dueAt: DONE() });
        continue;
      }

      const wrong = near.find((r) => !mpSet.has(r.method));
      const data = {
        paymentId: c.paymentId, amount: c.amount, at: new Date(at).toISOString(), channel: c.channel,
        saleNumber: wrong ? Number(wrong.sale_number) : null, method: wrong ? wrong.method : null,
      };
      const msg = deps.notify.messageFor({ type: "mpUnmatched", data });

      // A la campanita de todas las cajas: una fila de app_notifications por la sincronización
      const now = Date.now();
      const row = {
        id: crypto.randomUUID(), type: "mpUnmatched", title: msg.title, body: msg.body,
        url: "/cash-control", created_at: now, read_at: null,
      };
      const pushed = await deps.cloudSync.push(sql, c.uid, "ventra-cloud-mp", [{ t: "app_notifications", id: row.id, d: row, ts: now }]);
      if (pushed.maxSeq) await deps.syncHead.afterWrite(c.uid, pushed.maxSeq, pushed.gen);

      await deps.notify.sendToAccount(deps.db, c.uid, "mpUnmatched", msg).catch((err) => logger.warn("Ventra MP: push del aviso", err.message));
      await doc.ref.update({ status: "alerted", dueAt: DONE(), alertedAt: admin.firestore.FieldValue.serverTimestamp() });
      alerted++;
    } catch (err) {
      logger.warn(`Ventra MP: control del pago ${c.paymentId} (${c.uid})`, err.message);
      await doc.ref.update({ dueAt: admin.firestore.Timestamp.fromMillis(Date.now() + RETRY_MS) }).catch(() => {});
    }
  }

  // Limpieza: lo resuelto hace más de 3 días
  const old = await checks().where("createdAt", "<", admin.firestore.Timestamp.fromMillis(Date.now() - 3 * 24 * 60 * 60 * 1000)).limit(300).get();
  if (!old.empty) {
    const b = admin.firestore().batch();
    old.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  return { checked: due.length, alerted };
}

module.exports = { enqueue, runDue };
