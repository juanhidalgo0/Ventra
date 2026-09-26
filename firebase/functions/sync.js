// ═══════════════════════════════════════════════════
// Sincronización de cada comercio en la nube (Neon / PostgreSQL).
//
// Todas las "cajas" de un comercio (PCs del local y la caja en la nube) suben
// sus cambios y bajan los de las demás. La nube es el punto de encuentro.
//
//  - sync_rows: una fila por registro de la app (tabla espejo en jsonb), aislada
//    por comercio (tenant_id). Cada cambio lleva `ts` (hora en que ocurrió en su
//    caja) y `device_id` (qué caja). Gana el cambio más reciente, no el que
//    llegó primero. `seq` es el orden global para que cada caja baje lo nuevo.
//  - Contadores (stock, saldos): viajan como diferencias en filas tbl='_delta',
//    que solo se agregan. Así dos cajas vendiendo lo mismo sin internet nunca
//    se pisan: cada una aplica las restas de la otra.
//  - sync_nodes: las cajas de cada comercio y su número (para la numeración).
//
// El comercio SIEMPRE sale de la vinculación de la caja, nunca de lo que envía.
// ═══════════════════════════════════════════════════
const { neon } = require("@neondatabase/serverless");

const MAX_ROWS_PER_PUSH = 1000;
const PAGE_SIZE = 1000;
const TABLE_RE = /^(_delta|[a-z_][a-z0-9_]{0,62})$/;

let schemaReady = null;

function db(url) {
  return neon(url);
}

// Consulta con parámetros: el driver 0.10 usa sql(texto, params); versiones nuevas, sql.query
const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));

async function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await run(sql, `CREATE SEQUENCE IF NOT EXISTS sync_seq`, []);
      await run(sql, `CREATE TABLE IF NOT EXISTS sync_rows (
        tenant_id text NOT NULL,
        tbl text NOT NULL,
        id text NOT NULL,
        data jsonb,
        deleted boolean NOT NULL DEFAULT false,
        gen integer NOT NULL DEFAULT 0,
        device_id text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, tbl, id)
      )`, []);
      // Columnas de la sincronización en los dos sentidos (se agregan a bases de la etapa 1)
      await run(sql, `ALTER TABLE sync_rows ADD COLUMN IF NOT EXISTS ts bigint NOT NULL DEFAULT 0`, []);
      await run(sql, `ALTER TABLE sync_rows ADD COLUMN IF NOT EXISTS seq bigint`, []);
      await run(sql, `UPDATE sync_rows SET seq = nextval('sync_seq') WHERE seq IS NULL`, []);
      await run(sql, `CREATE INDEX IF NOT EXISTS sync_rows_tenant_seq ON sync_rows (tenant_id, seq)`, []);
      await run(sql, `CREATE INDEX IF NOT EXISTS sync_rows_tenant_updated ON sync_rows (tenant_id, updated_at)`, []);
      // Para el panel web: unir pagos/ítems con su venta y ventas/movimientos con su caja
      await run(sql, `CREATE INDEX IF NOT EXISTS sync_rows_sale_ref ON sync_rows (tenant_id, tbl, (data->>'sale_id'))`, []);
      await run(sql, `CREATE INDEX IF NOT EXISTS sync_rows_session_ref ON sync_rows (tenant_id, tbl, (data->>'session_id'))`, []);
      await run(sql, `CREATE TABLE IF NOT EXISTS sync_tenants (
        tenant_id text PRIMARY KEY,
        gen integer NOT NULL DEFAULT 0,
        full_in_progress boolean NOT NULL DEFAULT false,
        last_push_at timestamptz,
        last_full_at timestamptz,
        device_id text
      )`, []);
      await run(sql, `ALTER TABLE sync_tenants ADD COLUMN IF NOT EXISTS ledger boolean NOT NULL DEFAULT false`, []);
      await run(sql, `CREATE TABLE IF NOT EXISTS sync_nodes (
        tenant_id text NOT NULL,
        device_id text NOT NULL,
        idx integer NOT NULL,
        kind text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz,
        PRIMARY KEY (tenant_id, device_id)
      )`, []);
      // Avance que informa cada caja (para que las demás lo muestren mientras la esperan)
      await run(sql, `ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS status jsonb`, []);
      // Hasta dónde bajó cada caja y con qué versión de la sincronización: con eso se sabe qué
      // movimientos viejos ya vieron todas y se pueden compactar
      await run(sql, `ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS pulled_seq bigint NOT NULL DEFAULT 0`, []);
      await run(sql, `ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS client_v integer NOT NULL DEFAULT 1`, []);
      // Todo lo que está por debajo de este número ya se compactó: una caja que quedó más atrás se realinea
      await run(sql, `ALTER TABLE sync_tenants ADD COLUMN IF NOT EXISTS compacted_seq bigint NOT NULL DEFAULT 0`, []);
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function validRows(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_PUSH) return false;
  return rows.every((r) => r && TABLE_RE.test(String(r.t)) && typeof r.id === "string" && r.id.length > 0 && r.id.length <= 200
    && (r.ts === undefined || Number.isFinite(Number(r.ts))));
}

/**
 * Alta de una caja en el comercio. Devuelve su número (0 = la caja original,
 * que conserva su numeración) y el estado del comercio en la nube.
 */
async function register(sql, tenantId, deviceId, kind, clientV) {
  await run(sql, `INSERT INTO sync_tenants (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  const existing = await run(sql, `SELECT idx FROM sync_nodes WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  let idx;
  if (existing.length) {
    idx = existing[0].idx;
  } else {
    const [t] = await run(sql, `SELECT device_id FROM sync_tenants WHERE tenant_id = $1`, [tenantId]);
    const [{ maxidx, zero }] = await run(sql, `SELECT COALESCE(max(idx), -1)::int AS maxidx, bool_or(idx = 0) AS zero
      FROM sync_nodes WHERE tenant_id = $1`, [tenantId]);
    // El 0 es de la caja que ya tenía los datos del comercio (la que subió primero)
    idx = !zero && (!t.device_id || t.device_id === deviceId) ? 0 : Math.max(1, maxidx + 1);
    const rows = await run(sql, `INSERT INTO sync_nodes (tenant_id, device_id, idx, kind) VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, device_id) DO UPDATE SET kind = EXCLUDED.kind RETURNING idx`, [tenantId, deviceId, idx, kind || null]);
    idx = rows[0].idx;
  }
  await run(sql, `UPDATE sync_nodes SET last_seen_at = now(), client_v = $3 WHERE tenant_id = $1 AND device_id = $2`,
    [tenantId, deviceId, Math.max(1, Math.floor(Number(clientV) || 1))]);
  const [state] = await run(sql, `SELECT ledger FROM sync_tenants WHERE tenant_id = $1`, [tenantId]);
  const [{ rows }] = await run(sql, `SELECT count(*)::int AS rows FROM sync_rows WHERE tenant_id = $1 AND tbl <> '_delta' AND NOT deleted`, [tenantId]);
  const nodes = await run(sql, `SELECT idx, kind, status, last_seen_at FROM sync_nodes WHERE tenant_id = $1 ORDER BY idx`, [tenantId]);
  return {
    ok: true, nodeIndex: idx, cloudRows: rows, ledger: state.ledger, gen: await tenantGen(sql, tenantId),
    nodes: nodes.map((n) => ({ idx: n.idx, kind: n.kind, status: n.status || null, lastSeenAt: n.last_seen_at ? new Date(n.last_seen_at).toISOString() : null })),
  };
}

/** Una caja informa en qué anda (fase y avance). */
async function report(sql, tenantId, deviceId, status) {
  const clean = {
    phase: String((status && status.phase) || '').slice(0, 20),
    label: String((status && status.label) || '').slice(0, 80),
    done: Math.max(0, Number(status && status.done) || 0),
    total: Math.max(0, Number(status && status.total) || 0),
  };
  await run(sql, `UPDATE sync_nodes SET status = $3::jsonb, last_seen_at = now() WHERE tenant_id = $1 AND device_id = $2`,
    [tenantId, deviceId, JSON.stringify({ ...clean, at: new Date().toISOString() })]);
  return { ok: true };
}

/** Solo una caja puede cargar el saldo inicial de los contadores. */
async function claimLedger(sql, tenantId) {
  const rows = await run(sql, `UPDATE sync_tenants SET ledger = true WHERE tenant_id = $1 AND ledger = false RETURNING 1`, [tenantId]);
  return { ok: true, claimed: rows.length === 1 };
}

/**
 * Sube cambios. Cada fila: { t, id, d?, x? (baja), ts (hora del cambio en ms) }.
 * Una fila solo reemplaza a la de la nube si su cambio es más nuevo (ts; a igual
 * hora decide el id de la caja). ts = 0 solo completa lo que falta.
 * Las diferencias de contadores (t = '_delta') solo se agregan.
 */
async function push(sql, tenantId, deviceId, rows, gen) {
  await run(sql, `INSERT INTO sync_tenants (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  const current = await tenantGen(sql, tenantId);
  // Una caja que todavía no se enteró del reinicio de la cuenta no puede volver a subir lo viejo
  if (gen !== undefined && gen !== null && Number(gen) !== current) return { ok: true, reset: true, gen: current, count: 0, applied: 0 };
  if (!rows.length) return { ok: true, count: 0, applied: 0 };
  const tbls = rows.map((r) => String(r.t));
  const ids = rows.map((r) => r.id);
  const datas = rows.map((r) => (r.d ? JSON.stringify(r.d) : null));
  const deleted = rows.map((r) => !!r.x);
  const tss = rows.map((r) => String(Math.max(0, Math.floor(Number(r.ts) || 0))));
  const applied = await run(sql, `INSERT INTO sync_rows AS cur (tenant_id, tbl, id, data, deleted, device_id, ts, seq, updated_at)
    SELECT $1, t.tbl, t.id, t.data::jsonb, t.deleted, $2, t.ts, nextval('sync_seq'), now()
    FROM unnest($3::text[], $4::text[], $5::text[], $6::boolean[], $7::bigint[]) AS t(tbl, id, data, deleted, ts)
    ON CONFLICT (tenant_id, tbl, id) DO UPDATE SET
      data = EXCLUDED.data, deleted = EXCLUDED.deleted, device_id = EXCLUDED.device_id,
      ts = EXCLUDED.ts, seq = EXCLUDED.seq, updated_at = now()
    WHERE cur.tbl <> '_delta'
      AND (EXCLUDED.ts, EXCLUDED.device_id) > (cur.ts, COALESCE(cur.device_id, ''))
    RETURNING 1`, [tenantId, deviceId, tbls, ids, datas, deleted, tss]);
  await run(sql, `UPDATE sync_tenants SET last_push_at = now(), device_id = COALESCE(device_id, $2) WHERE tenant_id = $1`, [tenantId, deviceId]);
  return { ok: true, count: rows.length, applied: applied.length, gen: current };
}

/**
 * Baja cambios posteriores a `after` (orden global). Por defecto excluye lo que
 * esta misma caja escribió (ya lo tiene). `all` = incluir lo propio (recuperar).
 * `fresh` = caja vacía que baja todo: las bajas no le sirven y no se mandan.
 * `resync` en la respuesta: la caja quedó por detrás de lo compactado y tiene que realinearse.
 */
async function pull(sql, tenantId, deviceId, after, all, fresh) {
  const since = String(Math.max(0, Math.floor(Number(after) || 0)));
  // Las consultas van en paralelo: la función se cobra por el tiempo que espera a Neon.
  // "settled" recorre el índice (tenant_id, seq) desde el final y corta en la primera
  // fila con más de 10 s: no recorre todas las filas del comercio en cada consulta.
  const [[tenant], rows, [{ max }], settledRows] = await Promise.all([
    run(sql, `SELECT gen, compacted_seq::text AS compacted FROM sync_tenants WHERE tenant_id = $1`, [tenantId]),
    run(sql, `SELECT tbl, id, data, deleted, ts, seq FROM sync_rows
      WHERE tenant_id = $1 AND seq > $2::bigint AND ($4::boolean OR device_id IS DISTINCT FROM $3) AND NOT ($5::boolean AND deleted)
      ORDER BY seq LIMIT ${PAGE_SIZE}`, [tenantId, since, deviceId, !!all, !!fresh]),
    run(sql, `SELECT COALESCE(max(seq), 0)::text AS max FROM sync_rows WHERE tenant_id = $1`, [tenantId]),
    run(sql, `SELECT seq::text AS settled FROM sync_rows WHERE tenant_id = $1 AND updated_at < now() - interval '10 seconds'
      ORDER BY sync_rows.seq DESC LIMIT 1`, [tenantId]),
    // Lo que pide ya lo aplicó: queda anotado hasta dónde llegó esta caja
    since !== "0"
      ? run(sql, `UPDATE sync_nodes SET pulled_seq = LEAST($3::bigint, (SELECT COALESCE(max(seq), 0) FROM sync_rows WHERE tenant_id = $1))
          WHERE tenant_id = $1 AND device_id = $2 AND pulled_seq < $3::bigint`, [tenantId, deviceId, since])
      : Promise.resolve(),
  ]);
  const gen = tenant ? Number(tenant.gen) || 0 : 0;
  if (since !== "0" && tenant && BigInt(since) < BigInt(tenant.compacted)) {
    return { ok: true, gen, resync: true, rows: [], last: since, more: false, head: max };
  }
  const settled = settledRows.length ? settledRows[0].settled : "0";
  const more = rows.length === PAGE_SIZE;
  let last = rows.length ? String(rows[rows.length - 1].seq) : since;
  // Sin más cambios de otras cajas: el marcador avanza sobre lo propio ya confirmado
  // (10 s de margen por subidas en curso), así no se vuelve a recorrer cada vez
  if (!more && BigInt(settled) > BigInt(last)) last = settled;
  return {
    ok: true,
    gen,
    rows: rows.map((r) => ({ t: r.tbl, id: r.id, d: r.data, x: r.deleted, ts: Number(r.ts) })),
    last,
    more,
    head: max,
  };
}

/** Número de "reinicio" de la cuenta: cambia cada vez que el dueño borra todo. */
async function tenantGen(sql, tenantId) {
  const [t] = await run(sql, `SELECT gen FROM sync_tenants WHERE tenant_id = $1`, [tenantId]);
  return t ? Number(t.gen) || 0 : 0;
}

/** Lo que sobrevive a un reinicio: la configuración fiscal y los recargos. */
const KEEP_ON_RESET = ["fiscal_config", "fiscal_tokens", "surcharges"];

/**
 * Reinicio de fábrica de la cuenta: borra los datos del comercio en la nube y sube el
 * número de reinicio. Cada caja lo ve en su próxima sincronización y vacía su base.
 */
async function reset(sql, tenantId) {
  await run(sql, `INSERT INTO sync_tenants (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  await run(sql, `DELETE FROM sync_rows WHERE tenant_id = $1 AND NOT (tbl = ANY($2::text[]))`, [tenantId, KEEP_ON_RESET]);
  const [t] = await run(sql, `UPDATE sync_tenants SET gen = gen + 1, ledger = false, full_in_progress = false
    WHERE tenant_id = $1 RETURNING gen`, [tenantId]);
  return { ok: true, gen: Number(t.gen) };
}

async function status(sql, tenantId) {
  const [tenant] = await run(sql, `SELECT last_push_at, ledger FROM sync_tenants WHERE tenant_id = $1`, [tenantId]);
  const [counts] = await run(sql, `SELECT count(*)::int AS rows, coalesce(sum(pg_column_size(data)), 0)::bigint AS bytes
    FROM sync_rows WHERE tenant_id = $1 AND tbl <> '_delta' AND NOT deleted`, [tenantId]);
  const nodes = await run(sql, `SELECT device_id, idx, kind, last_seen_at FROM sync_nodes WHERE tenant_id = $1 ORDER BY idx`, [tenantId]);
  return { ok: true, tenant: tenant || null, rows: counts.rows, bytes: Number(counts.bytes), nodes };
}

/** Resumen por comercio para el panel de administración. */
async function adminSummary(url) {
  const sql = db(url);
  await ensureSchema(sql);
  const rows = await run(sql, `SELECT t.tenant_id, t.last_push_at, t.last_full_at,
      count(r.id) FILTER (WHERE NOT r.deleted AND r.tbl <> '_delta')::int AS rows,
      coalesce(sum(pg_column_size(r.data)) FILTER (WHERE NOT r.deleted AND r.tbl <> '_delta'), 0)::bigint AS bytes
    FROM sync_tenants t LEFT JOIN sync_rows r ON r.tenant_id = t.tenant_id
    GROUP BY t.tenant_id, t.last_push_at, t.last_full_at`, []);
  const map = {};
  rows.forEach((r) => {
    map[r.tenant_id] = {
      rows: r.rows, bytes: Number(r.bytes),
      lastPushAt: r.last_push_at ? new Date(r.last_push_at).toISOString() : null,
      lastFullAt: r.last_full_at ? new Date(r.last_full_at).toISOString() : null,
    };
  });
  return map;
}

module.exports = { reset, tenantGen, db, run, ensureSchema, register, report, claimLedger, push, pull, status, adminSummary, validRows, MAX_ROWS_PER_PUSH };
