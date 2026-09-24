// ═══════════════════════════════════════════════════
// Copia de seguridad de la base de sincronización (Neon).
//
// Neon es el punto de encuentro de todos los comercios: tiene la copia completa
// de cada uno (sync_rows) y sus cajas (sync_nodes). Si se pierde, las cajas en la
// nube no pueden reconstruirse y los comercios sin PC pierden sus datos.
//
// Cada noche se vuelca todo a Cloud Storage: backups/neon/AAAA-MM-DD.ndjson.gz
//  - Una línea JSON por fila: { "t": "<tabla>", "r": { ...columnas } }
//  - La primera línea es { "t": "_meta", ... } con la versión y la fecha.
// Se guardan los últimos KEEP_DAYS días. Para restaurar: scripts/restore-backup.js
// ═══════════════════════════════════════════════════
const zlib = require("zlib");
const { run } = require("./sync");

const PREFIX = "backups/neon/";
const KEEP_DAYS = 30;
const PAGE = 2000;
const FORMAT_VERSION = 1;

// Orden de restauración: primero los comercios, después sus cajas y sus datos
const TABLES = [
  { name: "sync_tenants", key: ["tenant_id"] },
  { name: "sync_nodes", key: ["tenant_id", "device_id"] },
  { name: "sync_rows", key: ["tenant_id", "tbl", "id"] },
];

/** Recorre una tabla completa por su clave primaria, de a PAGE filas. */
async function* readTable(sql, { name, key }) {
  const cols = key.join(", ");
  let last = null;
  for (;;) {
    const where = last ? `WHERE (${cols}) > (${key.map((_, i) => `$${i + 1}`).join(", ")})` : "";
    const rows = await run(sql, `SELECT * FROM ${name} ${where} ORDER BY ${cols} LIMIT ${PAGE}`, last || []);
    for (const r of rows) yield r;
    if (rows.length < PAGE) return;
    const tail = rows[rows.length - 1];
    last = key.map((k) => tail[k]);
  }
}

/** Escribe respetando la contrapresión del stream. */
function write(stream, chunk) {
  return stream.write(chunk) ? Promise.resolve() : new Promise((resolve) => stream.once("drain", resolve));
}

/**
 * Vuelca toda la base a `file` (un archivo de Cloud Storage) comprimida.
 * Devuelve cuántas filas se copiaron por tabla.
 */
async function dumpToFile(sql, file, meta = {}) {
  const gzip = zlib.createGzip();
  const out = file.createWriteStream({ resumable: true, contentType: "application/gzip", metadata: { metadata: { format: String(FORMAT_VERSION) } } });
  const done = new Promise((resolve, reject) => { out.on("finish", resolve); out.on("error", reject); gzip.on("error", reject); });
  gzip.pipe(out);

  const counts = {};
  try {
    await write(gzip, JSON.stringify({ t: "_meta", version: FORMAT_VERSION, createdAt: new Date().toISOString(), ...meta }) + "\n");
    for (const table of TABLES) {
      counts[table.name] = 0;
      for await (const r of readTable(sql, table)) {
        await write(gzip, JSON.stringify({ t: table.name, r }) + "\n");
        counts[table.name]++;
      }
    }
    await write(gzip, JSON.stringify({ t: "_end", counts }) + "\n");
  } catch (err) {
    gzip.destroy(err);
    out.destroy(err);
    throw err;
  }
  gzip.end();
  await done;
  return counts;
}

/** Borra las copias con más de KEEP_DAYS días (por la fecha del nombre). */
async function pruneOld(bucket, today) {
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  const limit = Date.parse(today) - KEEP_DAYS * 86400000;
  const old = files.filter((f) => {
    const m = /(\d{4}-\d{2}-\d{2})\.ndjson\.gz$/.exec(f.name);
    return m && Date.parse(m[1]) < limit;
  });
  await Promise.all(old.map((f) => f.delete().catch(() => {})));
  return old.length;
}

module.exports = { PREFIX, KEEP_DAYS, TABLES, FORMAT_VERSION, dumpToFile, pruneOld, readTable };
