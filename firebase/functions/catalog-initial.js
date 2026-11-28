// ═══════════════════════════════════════════════════
// Catálogo inicial por rubro: los productos MÁS VENDIDOS de cada rubro en los últimos 90 días,
// sumando las ventas de todos los comercios de Ventra (réplica en Neon). Lo ofrece el alta del
// comercio ("¿Empezás con los productos más vendidos de tu rubro?").
//
// Crece solo con el uso: se recalcula cada semana, así cuando se suma el primer comercio de un
// rubro nuevo (una carnicería), sus ventas ya alimentan el catálogo de las siguientes, y los
// códigos que dejan de venderse salen solos.
//
// Privacidad: solo datos sumados y anónimos. Nunca precios, nunca de qué comercio es cada cosa.
// Los productos con código de barras entran aunque los venda un solo comercio (el código es
// público); los que no tienen código solo si el MISMO nombre lo venden 2 comercios o más del
// rubro, así no se filtran nombres propios de un negocio ("Pizza especial de Juan").
//
// ventra_initial_catalog/{RUBRO}: { items: [{ barcode, name, category, unit, imageUrl, rank }], stores, updatedAt }
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");

const DAYS = 90;
const MAX_ITEMS = 800;
const MIN_UNITS = 3;
const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));
const TS = `(CASE WHEN (s.data->>'created_at') ~ '^[0-9]+$' THEN to_timestamp((s.data->>'created_at')::bigint / 1000.0) ELSE (s.data->>'created_at')::timestamptz END)`;

const QUERY = `
  WITH prof AS (
    SELECT tenant_id, upper(coalesce(nullif(trim(both '"' from coalesce(data->>'value', '')), ''), 'KIOSKO')) AS rubro
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
  cats AS (SELECT tenant_id, id, data->>'name' AS name FROM sync_rows WHERE tbl = 'categories' AND NOT deleted),
  prods AS (
    SELECT p.tenant_id, p.id AS pid, nullif(p.data->>'barcode', '') AS bc, trim(regexp_replace(coalesce(p.data->>'name', ''), '\\s+', ' ', 'g')) AS name,
      coalesce(nullif(p.data->>'unit', ''), 'UNIT') AS unit, c.name AS category
    FROM sync_rows p LEFT JOIN cats c ON c.tenant_id = p.tenant_id AND c.id = p.data->>'category_id'
    WHERE p.tbl = 'products' AND NOT p.deleted AND coalesce(p.data->>'is_active', 'true') <> 'false'
  ),
  vendidos AS (
    SELECT coalesce(prof.rubro, 'KIOSKO') AS rubro, it.tenant_id,
      CASE WHEN p.bc ~ '^[0-9]{8,14}$' THEN p.bc ELSE 'n:' || lower(p.name) END AS clave,
      max(p.bc) AS bc, max(p.name) AS name, max(p.unit) AS unit, max(p.category) AS category, sum(it.qty) AS u
    FROM items it JOIN prods p ON p.tenant_id = it.tenant_id AND p.pid = it.pid
    LEFT JOIN prof ON prof.tenant_id = it.tenant_id
    WHERE p.name <> ''
    GROUP BY 1, 2, 3
  )
  SELECT rubro, clave, max(bc) AS bc, count(DISTINCT tenant_id)::int AS stores, sum(u)::float AS units,
    mode() WITHIN GROUP (ORDER BY name) AS name, mode() WITHIN GROUP (ORDER BY unit) AS unit,
    mode() WITHIN GROUP (ORDER BY category) FILTER (WHERE category IS NOT NULL) AS category
  FROM vendidos GROUP BY rubro, clave`;

const SYSTEM = /venta r[aá]pida|pago (de )?cuenta|cuenta corriente|carga virtual|recarga virtual|^virtual|sin c[oó]digo|varios$/i;

/** Elige y ordena los productos de cada rubro. Pura (se prueba sin base). */
function pick(rows) {
  const byRubro = new Map();
  for (const r of rows) {
    // Productos internos del sistema, no mercadería: venta rápida, cobros de cuenta, cargas virtuales
    if (SYSTEM.test(String(r.name || ""))) continue;
    const coded = !String(r.clave).startsWith("n:");
    if (Number(r.units) < MIN_UNITS) continue;
    if (!coded && Number(r.stores) < 2) continue; // nombres sin código: solo si son comunes a 2+ comercios
    if (!byRubro.has(r.rubro)) byRubro.set(r.rubro, []);
    byRubro.get(r.rubro).push(r);
  }
  const out = {};
  for (const [rubro, list] of byRubro) {
    // Primero lo que venden más comercios, después lo que más unidades vendió
    list.sort((a, b) => b.stores - a.stores || b.units - a.units);
    out[rubro] = list.slice(0, MAX_ITEMS).map((r, i) => ({
      barcode: String(r.clave).startsWith("n:") ? null : r.bc,
      name: String(r.name || "").slice(0, 120),
      category: r.category ? String(r.category).slice(0, 60) : null,
      unit: ["KG", "MT", "L", "UNIT"].includes(r.unit) ? r.unit : "UNIT",
      rank: i + 1,
    }));
  }
  return out;
}

/** Recalcula todos los rubros y los guarda en Firestore. Devuelve cuántos productos quedó por rubro. */
async function build(sql, db) {
  const rows = await run(sql, QUERY, [String(DAYS)]);
  const stores = {};
  for (const r of rows) stores[r.rubro] = Math.max(stores[r.rubro] || 0, Number(r.stores) || 0);
  const catalogs = pick(rows);
  // Fotos y nombre más votado del catálogo compartido de códigos
  const codes = [...new Set(Object.values(catalogs).flat().map((i) => i.barcode).filter(Boolean))];
  const shared = new Map();
  for (let i = 0; i < codes.length; i += 100) {
    const snaps = await db.getAll(...codes.slice(i, i + 100).map((c) => db.collection("ventra_barcodes").doc(c)));
    snaps.forEach((s) => { if (s.exists) shared.set(s.id, s.data()); });
  }
  const summary = {};
  for (const [rubro, items] of Object.entries(catalogs)) {
    const full = items.map((it) => {
      const sh = it.barcode ? shared.get(it.barcode) : null;
      return { ...it, name: (sh && sh.votes >= 2 && sh.name) || it.name, imageUrl: (sh && sh.imageUrl) || null };
    });
    await db.collection("ventra_initial_catalog").doc(rubro).set({
      items: full, updatedAt: admin.firestore.FieldValue.serverTimestamp(), days: DAYS,
    });
    summary[rubro] = full.length;
  }
  return summary;
}

/** El catálogo de un rubro (y, si es multirubro o no hay del rubro, el de kiosco no se mezcla: vacío) */
async function get(db, rubro) {
  const key = String(rubro || "").toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 30);
  if (!key) return { items: [] };
  const snap = await db.collection("ventra_initial_catalog").doc(key).get();
  if (!snap.exists) return { items: [] };
  const d = snap.data();
  return { items: d.items || [], updatedAt: d.updatedAt ? d.updatedAt.toMillis() : null };
}

module.exports = { build, get, pick, QUERY, DAYS, MAX_ITEMS };
