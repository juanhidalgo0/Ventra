// ═══════════════════════════════════════════════════
// Panel web del comercio (etapa 2): solo lectura sobre la réplica en Neon.
//
// Todo sale de sync_rows (tabla espejo en jsonb) filtrado por tenant_id.
// Las fechas de la app se guardan en milisegundos; algunas tablas viejas usan
// texto de SQLite. Los días se cortan en hora de Argentina.
// ═══════════════════════════════════════════════════
const TZ = "America/Argentina/Buenos_Aires";

// Fecha de una fila: número (ms) o texto ISO/SQLite
const ts = (col) => `(CASE WHEN jsonb_typeof(data->'${col}') = 'number'
  THEN to_timestamp((data->>'${col}')::float8 / 1000)
  ELSE (data->>'${col}')::timestamptz END)`;
const num = (col) => `COALESCE((data->>'${col}')::float8, 0)`;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Consulta con parámetros: el driver 0.10 usa sql(texto, params); versiones nuevas, sql.query
const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));

/** Rango en días locales [from, to] inclusive. */
function parseRange(from, to) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const f = DAY_RE.test(String(from)) ? String(from) : today;
  const t = DAY_RE.test(String(to)) ? String(to) : f;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

async function overview(sql, tenantId, fromDay, toDay) {
  const { from, to } = parseRange(fromDay, toDay);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevTo = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(from) - days * 86400000).toISOString().slice(0, 10);

  // Ventas completadas con su instante y su día local
  const salesCte = `
    WITH s AS (
      SELECT id, ${num("total")} AS total, data->>'status' AS status, data->>'session_id' AS session_id,
             data->>'user_id' AS user_id, (data->>'sale_number')::bigint AS sale_number,
             data->>'payment_method_summary' AS methods, ${ts("created_at")} AS at
      FROM sync_rows WHERE tenant_id = $1 AND tbl = 'sales' AND NOT deleted
    ), sr AS (
      SELECT * FROM s WHERE status = 'COMPLETED'
        AND at >= ($2::date)::timestamp AT TIME ZONE '${TZ}'
        AND at <  ($3::date + 1)::timestamp AT TIME ZONE '${TZ}'
    )`;

  const q = (text, params) => run(sql, text, params);

  const [summary, previous, series, methods, top, recent, freshness] = await Promise.all([
    q(`${salesCte} SELECT count(*)::int AS count, COALESCE(sum(total), 0)::float8 AS total FROM sr`, [tenantId, from, to]),
    q(`${salesCte} SELECT count(*)::int AS count, COALESCE(sum(total), 0)::float8 AS total FROM sr`, [tenantId, prevFrom, prevTo]),
    days === 1
      ? q(`${salesCte} SELECT extract(hour FROM at AT TIME ZONE '${TZ}')::int AS k, count(*)::int AS count, sum(total)::float8 AS total
            FROM sr GROUP BY 1 ORDER BY 1`, [tenantId, from, to])
      : q(`${salesCte} SELECT to_char(at AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS k, count(*)::int AS count, sum(total)::float8 AS total
            FROM sr GROUP BY 1 ORDER BY 1`, [tenantId, from, to]),
    q(`${salesCte}, p AS (
          SELECT data->>'sale_id' AS sale_id, data->>'method' AS method, ${num("amount")} AS amount
          FROM sync_rows WHERE tenant_id = $1 AND tbl = 'payments' AND NOT deleted)
        SELECT p.method, count(*)::int AS count, sum(p.amount)::float8 AS total
        FROM p JOIN sr ON sr.id = p.sale_id GROUP BY p.method ORDER BY total DESC`, [tenantId, from, to]),
    q(`${salesCte}, i AS (
          SELECT data->>'sale_id' AS sale_id, data->>'product_id' AS product_id, data->>'product_name' AS name,
                 ${num("quantity")} AS qty, ${num("total")} AS total
          FROM sync_rows WHERE tenant_id = $1 AND tbl = 'sale_items' AND NOT deleted)
        SELECT min(i.name) AS name, sum(i.qty)::float8 AS qty, sum(i.total)::float8 AS total
        FROM i JOIN sr ON sr.id = i.sale_id
        GROUP BY COALESCE(i.product_id, i.name) ORDER BY total DESC LIMIT 10`, [tenantId, from, to]),
    q(`${salesCte}, u AS (
          SELECT id, COALESCE(data->>'full_name', data->>'username') AS name
          FROM sync_rows WHERE tenant_id = $1 AND tbl = 'users')
        SELECT sr.id, sr.sale_number, sr.total, sr.methods, sr.at, u.name AS cashier
        FROM sr LEFT JOIN u ON u.id = sr.user_id ORDER BY sr.at DESC LIMIT 40`, [tenantId, from, to]),
    q(`SELECT last_push_at FROM sync_tenants WHERE tenant_id = $1`, [tenantId]),
  ]);

  return {
    range: { from, to, days },
    summary: summary[0],
    previous: { from: prevFrom, to: prevTo, ...previous[0] },
    series: { unit: days === 1 ? "hour" : "day", points: series },
    methods,
    topProducts: top,
    recentSales: recent.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
    lastSyncAt: freshness[0] && freshness[0].last_push_at ? new Date(freshness[0].last_push_at).toISOString() : null,
  };
}

/** Cajas abiertas (con efectivo esperado) y últimos cierres. */
async function cash(sql, tenantId) {
  const sessions = await run(sql, `
    WITH cs AS (
      SELECT id, data->>'status' AS status, data->>'terminal_name' AS terminal, data->>'user_id' AS user_id,
             ${num("opening_amount")} AS opening, (data->>'closing_amount_expected')::float8 AS expected,
             (data->>'closing_amount_counted')::float8 AS counted, (data->>'difference')::float8 AS difference,
             data->>'closing_summary' AS closing_summary, data->>'closing_notes' AS closing_notes,
             ${ts("opened_at")} AS opened_at,
             CASE WHEN data->>'closed_at' IS NULL THEN NULL ELSE ${ts("closed_at")} END AS closed_at
      FROM sync_rows WHERE tenant_id = $1 AND tbl = 'cash_register_sessions' AND NOT deleted
    ), u AS (
      SELECT id, COALESCE(data->>'full_name', data->>'username') AS name FROM sync_rows WHERE tenant_id = $1 AND tbl = 'users'
    )
    (SELECT cs.*, u.name AS cashier FROM cs LEFT JOIN u ON u.id = cs.user_id WHERE cs.status = 'OPEN' ORDER BY opened_at DESC)
    UNION ALL
    (SELECT cs.*, u.name AS cashier FROM cs LEFT JOIN u ON u.id = cs.user_id WHERE cs.status <> 'OPEN' ORDER BY closed_at DESC NULLS LAST LIMIT 8)`, [tenantId]);

  const open = sessions.filter((s) => s.status === "OPEN");
  if (open.length) {
    const ids = open.map((s) => s.id);
    // Efectivo cobrado y egresos de cada caja abierta
    const [cashIn, cashOut, salesCount] = await Promise.all([
      run(sql, `
        WITH s AS (SELECT id, data->>'session_id' AS session_id FROM sync_rows
                   WHERE tenant_id = $1 AND tbl = 'sales' AND NOT deleted AND data->>'status' = 'COMPLETED' AND data->>'session_id' = ANY($2))
        SELECT s.session_id, COALESCE(sum(${num("amount")}), 0)::float8 AS amount
        FROM sync_rows p JOIN s ON s.id = p.data->>'sale_id'
        WHERE p.tenant_id = $1 AND p.tbl = 'payments' AND NOT p.deleted AND p.data->>'method' = 'CASH'
        GROUP BY s.session_id`, [tenantId, ids]),
      run(sql, `SELECT data->>'session_id' AS session_id, data->>'type' AS type, COALESCE(sum(${num("amount")}), 0)::float8 AS amount
        FROM sync_rows WHERE tenant_id = $1 AND tbl = 'cash_movements' AND NOT deleted AND data->>'session_id' = ANY($2)
        GROUP BY 1, 2`, [tenantId, ids]),
      run(sql, `SELECT data->>'session_id' AS session_id, count(*)::int AS count, COALESCE(sum(${num("total")}), 0)::float8 AS total
        FROM sync_rows WHERE tenant_id = $1 AND tbl = 'sales' AND NOT deleted AND data->>'status' = 'COMPLETED' AND data->>'session_id' = ANY($2)
        GROUP BY 1`, [tenantId, ids]),
    ]);
    for (const s of open) {
      const cashSales = (cashIn.find((r) => r.session_id === s.id) || {}).amount || 0;
      const outs = cashOut.filter((r) => r.session_id === s.id);
      const expenses = outs.filter((r) => r.type === "EXPENSE").reduce((a, r) => a + r.amount, 0);
      const withdrawals = outs.filter((r) => r.type === "WITHDRAWAL").reduce((a, r) => a + r.amount, 0);
      const sc = salesCount.find((r) => r.session_id === s.id) || { count: 0, total: 0 };
      Object.assign(s, { cashSales, expenses, withdrawals, salesCount: sc.count, salesTotal: sc.total,
        expectedNow: s.opening + cashSales - expenses - withdrawals });
    }
  }
  const iso = (d) => (d ? new Date(d).toISOString() : null);
  const strip = ({ closing_summary: _s, closing_notes: _n, ...rest }) => rest;
  return {
    open: open.map((s) => ({ ...strip(s), opened_at: iso(s.opened_at), closed_at: null })),
    closed: sessions.filter((s) => s.status !== "OPEN").map((s) => ({
      ...strip(s),
      // Diferencia total (efectivo + posnet), la misma que ve el cajero al cerrar
      difference: s.difference === null || s.difference === undefined ? null : s.difference + posnetDifference(s),
      opened_at: iso(s.opened_at), closed_at: iso(s.closed_at),
    })),
  };
}

/**
 * Posnet de un turno cerrado: lo declarado (resumen o notas "[METADATA]") menos lo esperado.
 * Misma regla que la app (utils/cashDifference): Clover, Mercado Pago y los declarados;
 * sin nada declarado (cierres viejos) no se inventa diferencia.
 */
function posnetDifference(s) {
  const json = (v) => { try { return typeof v === "string" ? JSON.parse(v) : v || {}; } catch { return {}; } };
  const sum = json(s.closing_summary);
  const notes = String(s.closing_notes || "");
  const at = notes.search(/\[\s*metadata\s*\]/i);
  const meta = at >= 0 ? json(notes.slice(at).replace(/^\[\s*metadata\s*\]/i, "").trim()) : {};
  if (!meta.posnetDeclarations && !sum.posnetDeclarations && meta.virtualClover === undefined && meta.virtualMP1 === undefined) return 0;
  const n = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? undefined : Number(v));
  const declared = {};
  const fromMeta = meta.posnetDeclarations || {};
  const clover = n(fromMeta.CLOVER) ?? n(meta.virtualClover);
  if (clover !== undefined) declared.CLOVER = clover;
  const mp1 = n(fromMeta.MERCADOPAGO) ?? n(meta.virtualMP1);
  const mp2 = n(meta.virtualMP2);
  if (mp1 !== undefined || mp2 !== undefined) declared.MERCADOPAGO = (mp1 || 0) + (mp2 || 0);
  for (const [k, v] of Object.entries(fromMeta)) if (declared[k] === undefined && n(v) !== undefined) declared[k] = Number(v);
  for (const [k, v] of Object.entries(sum.posnetDeclarations || {})) if (n(v) !== undefined) declared[k] = Number(v);
  const breakdown = sum.paymentBreakdown || {};
  let diff = 0;
  for (const k of new Set(["CLOVER", "MERCADOPAGO", ...Object.keys(declared)])) diff += (declared[k] || 0) - (Number(breakdown[k]) || 0);
  return diff;
}

async function lowStock(sql, tenantId) {
  return run(sql, `
    SELECT id, data->>'name' AS name, ${num("stock")} AS stock, ${num("min_stock")} AS min_stock, data->>'unit' AS unit
    FROM sync_rows
    WHERE tenant_id = $1 AND tbl = 'products' AND NOT deleted
      AND COALESCE((data->>'is_active')::int, 1) = 1
      AND COALESCE((data->>'unlimited_stock')::int, 0) = 0
      AND ${num("min_stock")} > 0 AND ${num("stock")} <= ${num("min_stock")}
    ORDER BY (${num("stock")} / NULLIF(${num("min_stock")}, 0)) ASC, data->>'name'
    LIMIT 30`, [tenantId]);
}

async function saleDetail(sql, tenantId, saleId) {
  const [items, payments] = await Promise.all([
    run(sql, `SELECT data->>'product_name' AS name, ${num("quantity")} AS qty, ${num("unit_price")} AS unit_price, ${num("total")} AS total
      FROM sync_rows WHERE tenant_id = $1 AND tbl = 'sale_items' AND NOT deleted AND data->>'sale_id' = $2 ORDER BY id`, [tenantId, saleId]),
    run(sql, `SELECT data->>'method' AS method, ${num("amount")} AS amount
      FROM sync_rows WHERE tenant_id = $1 AND tbl = 'payments' AND NOT deleted AND data->>'sale_id' = $2`, [tenantId, saleId]),
  ]);
  return { items, payments };
}

module.exports = { overview, cash, lowStock, saleDetail, parseRange, TZ };
