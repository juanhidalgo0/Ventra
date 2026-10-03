// ═══════════════════════════════════════════════════
// Archivo de la historia vieja de cada comercio (fuera de Neon).
//
// Neon guarda cada fila de cada comercio para siempre: un kiosco suma más de medio millón
// de filas por año y el costo crece con los años. Los meses cerrados de la historia vieja
// (las mismas filas que la carga total baja en segundo plano, ver oldExpr en sync.js) se
// pasan a Cloud Storage, un archivo comprimido por tanda:
//   sync-archive/<comercio>/<AAAA-MM>/<id>.json.gz  ->  { tenant, month, rows: [{ t, id, d, ts }] }
// y se anotan en sync_archives. Después se borran de Neon (sin baja: las cajas los conservan).
//
// Reglas para no perder nada:
//  - Solo filas que todas las cajas activas ya bajaron (seq <= safe) y con más de un día.
//  - Solo comercios cuyas cajas activas saben bajar archivos (protocolo 3 o más).
//  - Primero se sube el archivo y se anota; recién después se borra de Neon, y solo si la fila
//    no cambió mientras tanto (misma seq). Si algo se corta, la próxima pasada lo repite: una
//    fila puede quedar en dos archivos, y la caja la aplica una sola vez.
//  - Una fila archivada que después cambia (o se borra) vuelve a Neon como fila nueva (o baja).
//    Al servir un archivo se sacan las filas que hoy están en Neon: la versión de Neon es más
//    nueva y la caja ya la tiene. Por eso las bajas de estas tablas no se limpian nunca de
//    Neon (ver maintain). Si una fila se archiva dos veces, el archivo más nuevo va después.
//  - Una realineación no vuelve a subir a Neon lo archivado (ver skipArchived en sync.js).
//
// Apagado por defecto: se prende con VENTRA_SYNC_ARCHIVE=1 en las funciones.
// A mano: node scripts/archivar-nube.js (modo prueba) / --ejecutar
// ═══════════════════════════════════════════════════
const zlib = require("zlib");
const crypto = require("crypto");
const { run, oldExpr, ARCHIVE_TABLES } = require("./sync");

const ENABLED = process.env.VENTRA_SYNC_ARCHIVE === "1";
const PREFIX = "sync-archive/";
/**
 * Solo se archiva lo que tiene más de esto (y meses completos). Ojo al acortarlo: el panel web
 * (dashboard.js) y el control de pagos de MP (mp-checks.js) leen ventas y pagos de Neon; hoy
 * piden como mucho 30 días más el período anterior (~62 días).
 */
const ARCHIVE_AFTER_DAYS = 90;
/** Filas por archivo: unos MB comprimidos, cómodo para bajar de una vez. */
const PART_ROWS = 20000;
/** Tope por comercio y por pasada: el mantenimiento diario tiene 9 minutos para todos. */
const MAX_ROWS_PER_RUN = 200000;
const MIN_CLIENT_V = 3;
const STALE_NODE_DAYS = 30;
const TZ = "America/Argentina/Buenos_Aires";

async function ensureArchiveSchema(sql) {
  await run(sql, `CREATE TABLE IF NOT EXISTS sync_archives (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    month text NOT NULL,
    path text NOT NULL,
    rows integer NOT NULL,
    bytes bigint NOT NULL,
    max_seq bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`, []);
  await run(sql, `CREATE INDEX IF NOT EXISTS sync_archives_tenant ON sync_archives (tenant_id, created_at)`, []);
}

/** Fecha (ms) de una fila: la propia, o la de su venta para renglones y comprobantes. */
const rowMs = `(CASE WHEN r.tbl IN ('sale_items', 'fiscal_documents') THEN
    (SELECT CASE WHEN jsonb_typeof(s.data->'created_at') = 'number' THEN (s.data->>'created_at')::numeric END
     FROM sync_rows s WHERE s.tenant_id = r.tenant_id AND s.tbl = 'sales' AND s.id = r.data->>'sale_id')
  ELSE CASE WHEN jsonb_typeof(r.data->'created_at') = 'number' THEN (r.data->>'created_at')::numeric END END)`;
const monthOf = `to_char(to_timestamp(${rowMs} / 1000) AT TIME ZONE '${TZ}', 'YYYY-MM')`;

/**
 * Hasta dónde se puede archivar: el primer día del mes de hace 90 días, o antes si hay una
 * caja abierta desde antes (sus pagos y movimientos tienen que estar en la primera bajada).
 */
async function archiveCut(sql, tenantId) {
  const [{ cut }] = await run(sql, `SELECT (extract(epoch FROM date_trunc('month', (LEAST(
      now() - make_interval(days => $2),
      COALESCE((SELECT to_timestamp(min(CASE WHEN jsonb_typeof(data->'opened_at') = 'number' THEN (data->>'opened_at')::numeric END) / 1000)
        FROM sync_rows WHERE tenant_id = $1 AND tbl = 'cash_register_sessions' AND NOT deleted AND data->>'status' = 'OPEN'), 'infinity'::timestamptz)
    )) AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') * 1000)::bigint::text AS cut`, [tenantId, ARCHIVE_AFTER_DAYS]);
  return Number(cut);
}

/** Lo que todas las cajas activas ya bajaron, o el motivo por el que no se archiva. */
async function safeSeq(sql, tenantId) {
  const [n] = await run(sql, `SELECT count(*)::int AS active, count(*) FILTER (WHERE client_v < $3)::int AS old,
      COALESCE(min(pulled_seq), 0)::text AS safe
    FROM sync_nodes WHERE tenant_id = $1 AND last_seen_at > now() - make_interval(days => $2)`, [tenantId, STALE_NODE_DAYS, MIN_CLIENT_V]);
  if (!n.active) return { skipped: "sin cajas activas" };
  if (n.old) return { skipped: `${n.old} caja(s) sin la versión que baja archivos` };
  if (n.safe === "0") return { skipped: "una caja todavía no bajó nada" };
  return { safe: n.safe };
}

/** Archiva los meses cerrados de un comercio (ver arriba). */
async function archiveTenant(sql, bucket, tenantId, dryRun = false) {
  const out = { tenantId, archived: 0, files: 0, months: {}, skipped: null };
  const s = await safeSeq(sql, tenantId);
  if (s.skipped) { out.skipped = s.skipped; return out; }
  const cut = await archiveCut(sql, tenantId);
  const eligible = `r.tenant_id = $1 AND NOT r.deleted AND r.tbl = ANY($3::text[]) AND r.seq <= $2::bigint
    AND r.updated_at < now() - interval '1 day' AND ${oldExpr("$4::numeric")} AND ${rowMs} < $4::numeric`;
  const params = [tenantId, s.safe, ARCHIVE_TABLES, cut];

  const months = await run(sql, `SELECT ${monthOf} AS month, count(*)::int AS n FROM sync_rows r
    WHERE ${eligible} GROUP BY 1 ORDER BY 1`, params);
  for (const m of months) out.months[m.month] = m.n;
  if (dryRun) {
    out.archived = months.reduce((a, m) => a + m.n, 0);
    return out;
  }

  for (const { month } of months) {
    for (;;) {
      if (out.archived >= MAX_ROWS_PER_RUN) return out;
      const rows = await run(sql, `SELECT r.tbl, r.id, r.data, r.ts, r.seq FROM sync_rows r
        WHERE ${eligible} AND ${monthOf} = $5
        ORDER BY (r.tbl IN ('sale_items', 'fiscal_documents')) DESC, r.seq LIMIT ${PART_ROWS}`, [...params, month]);
      if (!rows.length) break;
      // Renglones y comprobantes antes que sus ventas: se fechan por la venta, que tiene que seguir en Neon
      const id = crypto.randomUUID();
      const path = `${PREFIX}${tenantId}/${month}/${id}.json.gz`;
      const gz = zlib.gzipSync(JSON.stringify({
        tenant: tenantId, month,
        rows: rows.map((r) => ({ t: r.tbl, id: r.id, d: r.data, ts: Number(r.ts) })),
      }), { level: 9 });
      await bucket.file(path).save(gz, { contentType: "application/json", metadata: { contentEncoding: "gzip" }, resumable: false });
      const maxSeq = rows.reduce((a, r) => (BigInt(r.seq) > a ? BigInt(r.seq) : a), 0n).toString();
      await run(sql, `INSERT INTO sync_archives (id, tenant_id, month, path, rows, bytes, max_seq) VALUES ($1, $2, $3, $4, $5, $6, $7::bigint)`,
        [id, tenantId, month, path, rows.length, gz.length, maxSeq]);
      // Solo lo que no cambió desde que se leyó: lo que cambió sigue en Neon (más nuevo que el archivo)
      const [d] = await run(sql, `WITH d AS (DELETE FROM sync_rows WHERE tenant_id = $1
          AND (tbl, id, seq) IN (SELECT * FROM unnest($2::text[], $3::text[], $4::bigint[])) RETURNING 1)
        SELECT count(*)::int AS n FROM d`, [tenantId, rows.map((r) => r.tbl), rows.map((r) => r.id), rows.map((r) => String(r.seq))]);
      out.archived += d.n;
      out.files++;
      if (rows.length < PART_ROWS) break;
    }
  }
  if (out.archived) {
    // Una caja que quedó más atrás (inactiva) se realinea: lo que le faltaba ya no está en Neon
    await run(sql, `UPDATE sync_tenants SET compacted_seq = GREATEST(compacted_seq, $2::bigint) WHERE tenant_id = $1`, [tenantId, s.safe]);
  }
  return out;
}

async function archiveAll(sql, bucket, dryRun = false) {
  await ensureArchiveSchema(sql);
  const tenants = await run(sql, `SELECT tenant_id FROM sync_tenants ORDER BY tenant_id`, []);
  const results = [];
  for (const { tenant_id: id } of tenants) {
    try {
      results.push(await archiveTenant(sql, bucket, id, dryRun));
    } catch (err) {
      results.push({ tenantId: id, error: err.message });
    }
  }
  return results;
}

/** Archivos de un comercio, del más viejo al más nuevo. */
async function list(sql, tenantId) {
  await ensureArchiveSchema(sql);
  const rows = await run(sql, `SELECT id, month, rows, bytes, max_seq::text AS max_seq FROM sync_archives WHERE tenant_id = $1 ORDER BY month, created_at`, [tenantId]);
  return { ok: true, archives: rows.map((r) => ({ id: r.id, month: r.month, rows: r.rows, bytes: Number(r.bytes), maxSeq: r.max_seq })) };
}

/**
 * Filas de un archivo, sin las que hoy están en Neon (cambiadas o borradas después de
 * archivarse: lo de Neon es más nuevo). Comprimido, para mandar con Content-Encoding: gzip.
 */
async function read(sql, bucket, tenantId, id) {
  await ensureArchiveSchema(sql);
  const [a] = await run(sql, `SELECT path FROM sync_archives WHERE tenant_id = $1 AND id = $2`, [tenantId, String(id || "")]);
  if (!a) return null;
  const [buf] = await bucket.file(a.path).download({ decompress: false });
  const file = JSON.parse(zlib.gunzipSync(buf).toString("utf8"));
  const rows = file.rows || [];
  const live = await run(sql, `SELECT tbl || '|' || id AS k FROM sync_rows WHERE tenant_id = $1
    AND (tbl, id) IN (SELECT * FROM unnest($2::text[], $3::text[]))`, [tenantId, rows.map((r) => r.t), rows.map((r) => r.id)]);
  const inNeon = new Set(live.map((r) => r.k));
  return zlib.gzipSync(JSON.stringify({ ok: true, month: file.month, rows: rows.filter((r) => !inNeon.has(`${r.t}|${r.id}`)) }));
}

/** Bajas de las tablas que se archivan, para aplicarlas después de los archivos (de a tandas). */
async function deletes(sql, tenantId, after) {
  const since = String(Math.max(0, Math.floor(Number(after) || 0)));
  const rows = await run(sql, `SELECT tbl, id, seq FROM sync_rows WHERE tenant_id = $1 AND deleted AND tbl = ANY($2::text[]) AND seq > $3::bigint
    ORDER BY seq LIMIT 5000`, [tenantId, ARCHIVE_TABLES, since]);
  return {
    ok: true,
    rows: rows.map((r) => ({ t: r.tbl, id: r.id, x: true })),
    last: rows.length ? String(rows[rows.length - 1].seq) : since,
    more: rows.length === 5000,
  };
}

/** Reinicio de fábrica de la cuenta: se van también sus archivos. */
async function drop(sql, bucket, tenantId) {
  await ensureArchiveSchema(sql);
  await bucket.deleteFiles({ prefix: `${PREFIX}${tenantId}/` }).catch(() => {});
  await run(sql, `DELETE FROM sync_archives WHERE tenant_id = $1`, [tenantId]);
}

module.exports = { ENABLED, archiveTenant, archiveAll, list, read, deletes, drop, ensureArchiveSchema };
