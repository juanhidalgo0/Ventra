// Mide si alcanza para un "catálogo inicial" por rubro con los productos MÁS VENDIDOS y vendidos
// HACE POCO (así no entran códigos viejos). Solo lee y solo muestra conteos: nada de precios, ni
// nombres de comercios, ni productos de un comercio en particular.
//   node scripts/medir-catalogo-inicial.js [días=90]   (toma NEON_DATABASE_URL de los secretos de Firebase, sin mostrarla)
const { execSync } = require("child_process");
const { neon } = require("@neondatabase/serverless");

const DAYS = Number(process.argv[2]) || 90;
const url = process.env.NEON_DATABASE_URL
  || execSync("firebase functions:secrets:access NEON_DATABASE_URL", { cwd: __dirname + "/../..", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();
const sql = neon(url);
const q = (t, p = []) => (typeof sql.query === "function" ? sql.query(t, p) : sql(t, p));

// created_at puede venir como texto ISO o como milisegundos
const TS = `(CASE WHEN (s.data->>'created_at') ~ '^[0-9]+$' THEN to_timestamp((s.data->>'created_at')::bigint / 1000.0) ELSE (s.data->>'created_at')::timestamptz END)`;

const BASE = `
  WITH prof AS (
    SELECT tenant_id, coalesce(nullif(trim(both '"' from coalesce(data->>'value', '')), ''), 'SIN RUBRO') AS rubro
    FROM sync_rows WHERE tbl = 'store_settings' AND id = 'business_profile' AND NOT deleted
  ),
  ventas AS (
    SELECT s.tenant_id, s.id AS sale_id FROM sync_rows s
    WHERE s.tbl = 'sales' AND NOT s.deleted AND coalesce(s.data->>'status', 'COMPLETED') NOT IN ('CANCELLED', 'VOIDED', 'ANULADA')
      AND ${TS} > now() - ($1 || ' days')::interval
  ),
  items AS (
    SELECT i.tenant_id, i.data->>'product_id' AS pid, coalesce((i.data->>'quantity')::numeric, 0) AS qty
    FROM sync_rows i JOIN ventas v ON v.tenant_id = i.tenant_id AND v.sale_id = i.data->>'sale_id'
    WHERE i.tbl = 'sale_items' AND NOT i.deleted
  ),
  prods AS (
    SELECT tenant_id, id AS pid, nullif(data->>'barcode', '') AS bc,
      lower(regexp_replace(coalesce(data->>'name', ''), '\\s+', ' ', 'g')) AS nombre
    FROM sync_rows WHERE tbl = 'products' AND NOT deleted
  ),
  vendidos AS (
    SELECT coalesce(prof.rubro, 'SIN RUBRO') AS rubro, it.tenant_id,
      CASE WHEN p.bc ~ '^[0-9]{8,14}$' THEN p.bc ELSE 'n:' || p.nombre END AS clave, sum(it.qty) AS unidades
    FROM items it JOIN prods p ON p.tenant_id = it.tenant_id AND p.pid = it.pid
    LEFT JOIN prof ON prof.tenant_id = it.tenant_id
    GROUP BY 1, 2, 3
  )`;

(async () => {
  console.log(`Ventas de los últimos ${DAYS} días\n`);
  const rows = await q(`${BASE},
    porClave AS (SELECT rubro, clave, count(DISTINCT tenant_id) AS n, sum(unidades) AS u FROM vendidos GROUP BY rubro, clave)
    SELECT rubro,
      (SELECT count(DISTINCT tenant_id) FROM vendidos x WHERE x.rubro = c.rubro)::int AS comercios,
      count(*) FILTER (WHERE clave !~ '^n:')::int AS con_codigo,
      count(*) FILTER (WHERE clave ~ '^n:')::int AS sin_codigo,
      count(*) FILTER (WHERE clave !~ '^n:' AND n >= 2)::int AS cod_en2,
      count(*) FILTER (WHERE clave !~ '^n:' AND n >= 3)::int AS cod_en3,
      count(*) FILTER (WHERE clave !~ '^n:' AND u >= 10)::int AS cod_10u
    FROM porClave c GROUP BY rubro ORDER BY comercios DESC`, [String(DAYS)]);
  console.log("Rubro          comercios | con código vendidos | en 2+ | en 3+ | 10+ unidades | sin código (por nombre)");
  for (const r of rows) console.log(`  ${r.rubro.padEnd(13)} ${String(r.comercios).padStart(3)} | ${String(r.con_codigo).padStart(6)} | ${String(r.cod_en2).padStart(5)} | ${String(r.cod_en3).padStart(5)} | ${String(r.cod_10u).padStart(5)} | ${String(r.sin_codigo).padStart(5)}`);

  // ¿Algún comercio es copia de otro? Coincidencia de códigos vendidos entre pares, sin nombres (A, B, C…)
  const sets = await q(`${BASE} SELECT tenant_id, array_agg(DISTINCT clave) FILTER (WHERE clave !~ '^n:') AS codigos FROM vendidos GROUP BY tenant_id`, [String(DAYS)]);
  const list = sets.map((s, i) => ({ label: String.fromCharCode(65 + i), set: new Set(s.codigos || []) })).filter((x) => x.set.size > 20);
  console.log("\nCoincidencia entre comercios (códigos vendidos en común / el menor de los dos):");
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b];
    let inter = 0; for (const x of A.set) if (B.set.has(x)) inter++;
    const pct = Math.round((inter / Math.min(A.set.size, B.set.size)) * 100);
    console.log(`  ${A.label}(${A.set.size}) – ${B.label}(${B.set.size}): ${inter} en común, ${pct}%${pct >= 70 ? "  ← parecen el mismo catálogo" : ""}`);
  }
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
