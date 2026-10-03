// Analiza la última caja cerrada de un usuario (por nombre) en Neon, para buscar
// el origen de una diferencia. Solo lee.
//   NEON_DATABASE_URL="postgres://..." node scripts/analizar-caja.js JUAN
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.NEON_DATABASE_URL);
const q = (t, p = []) => (typeof sql.query === "function" ? sql.query(t, p) : sql(t, p));
const who = (process.argv[2] || "JUAN").toLowerCase();

(async () => {
  const users = await q(`SELECT tenant_id, id, data FROM sync_rows WHERE tbl='users' AND NOT deleted
    AND (lower(data->>'name') LIKE $1 OR lower(data->>'username') LIKE $1)`, [`%${who}%`]);
  if (!users.length) return console.log("No encontré el usuario");
  const ids = users.map((u) => u.id);
  const [s] = await q(`SELECT tenant_id, id, data FROM sync_rows WHERE tbl='cash_register_sessions' AND NOT deleted
    AND data->>'user_id' = ANY($1) AND data->>'status'='CLOSED' ORDER BY data->>'closed_at' DESC LIMIT 1`, [ids]);
  if (!s) return console.log("Sin cajas cerradas");
  const d = s.data;
  console.log("CAJA", s.id, "tenant", s.tenant_id, d.terminal_name);
  console.log({ abierta: d.opened_at, cerrada: d.closed_at, apertura: d.opening_amount, esperado: d.closing_amount_expected,
    contado: d.closing_amount_counted, diferencia: d.difference, notas: d.closing_notes });
  try { console.log("RESUMEN", JSON.parse(d.closing_summary)); } catch { console.log("RESUMEN", d.closing_summary); }

  const sales = await q(`SELECT id, data, deleted FROM sync_rows WHERE tenant_id=$1 AND tbl='sales' AND data->>'session_id'=$2`, [s.tenant_id, s.id]);
  const saleIds = sales.map((r) => r.id);
  const pays = saleIds.length ? await q(`SELECT data FROM sync_rows WHERE tenant_id=$1 AND tbl='payments' AND NOT deleted AND data->>'sale_id' = ANY($2)`, [s.tenant_id, saleIds]) : [];
  const byStatus = {}, byMethod = {};
  for (const r of sales) { const k = (r.deleted ? "BORRADA-" : "") + r.data.status; byStatus[k] = byStatus[k] || { n: 0, total: 0 }; byStatus[k].n++; byStatus[k].total += +r.data.total; }
  const okSales = new Set(sales.filter((r) => !r.deleted && r.data.status === "COMPLETED").map((r) => r.id));
  for (const p of pays) { const k = p.data.method + (okSales.has(p.data.sale_id) ? "" : " (venta no completada)"); byMethod[k] = (byMethod[k] || 0) + +p.data.amount; }
  console.log("VENTAS por estado", byStatus);
  console.log("PAGOS por medio", byMethod);
  // Ventas cuyo resumen de medio no coincide con sus pagos, o sin pagos
  const paidBySale = {}; for (const p of pays) paidBySale[p.data.sale_id] = (paidBySale[p.data.sale_id] || 0) + +p.data.amount;
  const odd = sales.filter((r) => Math.abs((paidBySale[r.id] || 0) - +r.data.total) > 1);
  console.log("Ventas con pagos != total:", odd.map((r) => ({ n: r.data.sale_number, total: r.data.total, pagado: paidBySale[r.id] || 0, medio: r.data.payment_method_summary, estado: r.data.status })));
  const big = sales.filter((r) => +r.data.total >= 20000).map((r) => ({ n: r.data.sale_number, hora: r.data.created_at, total: r.data.total, medio: r.data.payment_method_summary, estado: r.data.status }));
  console.log("Ventas >= $20.000:", big);

  const movs = await q(`SELECT data, deleted FROM sync_rows WHERE tenant_id=$1 AND tbl='cash_movements' AND data->>'session_id'=$2`, [s.tenant_id, s.id]);
  console.log("MOVIMIENTOS", movs.map((m) => ({ tipo: m.data.type, monto: m.data.amount, desc: m.data.description, hora: m.data.created_at, borrado: m.deleted })));

  const [prev] = await q(`SELECT data FROM sync_rows WHERE tenant_id=$1 AND tbl='cash_register_sessions' AND data->>'status'='CLOSED'
    AND data->>'closed_at' < $2 ORDER BY data->>'closed_at' DESC LIMIT 1`, [s.tenant_id, d.opened_at]);
  if (prev) console.log("CAJA ANTERIOR: contado", prev.data.closing_amount_counted, "diferencia", prev.data.difference, "cerró", prev.data.closed_at);
})().catch((e) => { console.error(e); process.exit(1); });
