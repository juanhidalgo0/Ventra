// ═══════════════════════════════════════════════════
// "Preguntale a tu negocio" desde la nube (WhatsApp del dueño).
//
// Las mismas consultas fijas que corre la PC (apps/backend/src/modules/ai/insights.service.ts),
// pero sobre la réplica en Neon: así se puede contestar aunque la PC del local esté apagada.
// Más dos que solo tienen sentido desde afuera: "stock" de un producto y "caja" (cajas abiertas).
// Los datos están al día hasta la última sincronización (lastSync).
// ═══════════════════════════════════════════════════
const dashboard = require("./dashboard");

const TZ = "America/Argentina/Buenos_Aires";
const DAY = 864e5;
const SKIP_PRODUCTS = ["VENTA_RAPIDA", "PAGO_CTA_CTE"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const METHODS = { CASH: "Efectivo", CLOVER: "Tarjeta (posnet)", MERCADOPAGO: "Mercado Pago", TRANSFER: "Transferencia", CARD: "Tarjeta", DEBIT: "Débito", CREDIT: "Crédito", ACCOUNT: "Cuenta corriente", CUENTA_CORRIENTE: "Cuenta corriente", DEBT: "Cuenta corriente", QR: "QR", MIXED: "Mixto" };

const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const n = (v) => Number(v) || 0;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const yes = (v) => v === true || v === 1 || v === "1" || v === "true";
const arDate = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
/** Fechas de la app: milisegundos, o texto de SQLite en UTC ("2026-10-28 05:33:32") */
const toMs = (v) => {
  if (typeof v === "number") return v;
  const s = String(v || "");
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(" ", "T") : s.replace(" ", "T") + "Z") || 0;
};
// Instante de una columna de fecha, sea número o texto (igual que dashboard.js)
const at = (col, alias = "") => {
  const d = `${alias}data`;
  return `(CASE WHEN jsonb_typeof(${d}->'${col}') = 'number' THEN to_timestamp((${d}->>'${col}')::float8 / 1000)
    ELSE (${d}->>'${col}')::timestamptz END)`;
};

/** desde/hasta en días de Argentina (hasta incluido). Sin fechas válidas: los últimos 30 días. */
function range(desde, hasta) {
  const ok = (s) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = arDate(Date.now());
  const to = ok(hasta) ? hasta : today;
  const from = ok(desde) ? desde : arDate(new Date(`${to}T12:00:00-03:00`).getTime() - 29 * DAY);
  const start = new Date(`${from}T00:00:00-03:00`);
  let end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + DAY);
  if (end <= start) end = new Date(start.getTime() + DAY);
  return { from, to, start: start.toISOString(), end: end.toISOString() };
}

function makeQueries(sql, tenant) {
  const q = (text, params = []) => run(sql, text, [tenant, ...params]);
  const inRange = (alias = "") => `${at("created_at", alias)} >= $2::timestamptz AND ${at("created_at", alias)} < $3::timestamptz`;

  const completedSales = (start, end, extra = "", params = []) => q(
    `SELECT id, data->>'total' AS total, data->'created_at' AS created_at, data->>'user_id' AS user_id, data->>'client_id' AS client_id
       FROM sync_rows WHERE tenant_id = $1 AND tbl = 'sales' AND NOT deleted AND data->>'status' = 'COMPLETED' AND ${inRange()} ${extra}`,
    [start, end, ...params]);

  async function sales(qq) {
    const { from, to, start, end } = range(qq.desde, qq.hasta);
    const by = qq.agrupar || "ninguno";
    const periodo = { desde: from, hasta: to };
    if (by === "medio_de_pago") {
      const pays = await q(
        `SELECT p.data->>'method' AS method, p.data->>'amount' AS amount
           FROM sync_rows p JOIN sync_rows s ON s.tenant_id = p.tenant_id AND s.tbl = 'sales' AND s.id = p.data->>'sale_id'
          WHERE p.tenant_id = $1 AND p.tbl = 'payments' AND NOT p.deleted AND NOT s.deleted AND s.data->>'status' = 'COMPLETED' AND ${inRange("s.")}`,
        [start, end]);
      const g = new Map();
      for (const p of pays) { const k = METHODS[p.method] || p.method; g.set(k, (g.get(k) || 0) + n(p.amount)); }
      const total = [...g.values()].reduce((a, b) => a + b, 0);
      return { periodo, total: r2(total), porMedioDePago: [...g].sort((a, b) => b[1] - a[1]).map(([medio, monto]) => ({ medio, monto: r2(monto) })) };
    }
    const list = await completedSales(start, end);
    const total = list.reduce((a, s) => a + n(s.total), 0);
    const resumen = { periodo, total: r2(total), ventas: list.length, ticketPromedio: list.length ? r2(total / list.length) : 0 };
    if (by === "ninguno" || !by) return resumen;
    let users = new Map();
    if (by === "vendedor") {
      const us = await q(`SELECT id, COALESCE(data->>'full_name', data->>'username') AS name FROM sync_rows WHERE tenant_id = $1 AND tbl = 'users'`);
      users = new Map(us.map((u) => [u.id, u.name]));
    }
    const keyOf = (ms, userId) => {
      const day = arDate(ms);
      const local = new Date(new Date(ms).toLocaleString("en-US", { timeZone: TZ }));
      if (by === "dia") return day;
      if (by === "mes") return day.slice(0, 7);
      if (by === "semana") { const dt = new Date(`${day}T12:00:00-03:00`); const back = (dt.getUTCDay() + 6) % 7; return `semana del ${arDate(dt.getTime() - back * DAY)}`; }
      if (by === "dia_de_semana") return WEEKDAYS[local.getDay()];
      if (by === "hora") return `${String(local.getHours()).padStart(2, "0")} h`;
      if (by === "vendedor") return users.get(userId) || "Sin usuario";
      return "total";
    };
    const g = new Map();
    for (const s of list) {
      const k = keyOf(toMs(s.created_at), s.user_id);
      const cur = g.get(k) || { total: 0, ventas: 0 };
      cur.total += n(s.total); cur.ventas++;
      g.set(k, cur);
    }
    const sortable = ["dia", "mes", "semana", "hora"].includes(by);
    const rows = [...g].map(([grupo, v]) => ({ grupo, total: r2(v.total), ventas: v.ventas, ticketPromedio: r2(v.total / v.ventas) }));
    rows.sort(sortable ? (a, b) => a.grupo.localeCompare(b.grupo) : (a, b) => b.total - a.total);
    return { ...resumen, agrupadoPor: by, grupos: rows.slice(0, 100) };
  }

  /** Productos por id, con categoría y marca */
  async function productsById(ids) {
    if (!ids.length) return new Map();
    const [prods, cats, brands] = await Promise.all([
      q(`SELECT id, data->>'name' AS name, data->>'cost_price' AS cost, data->>'stock' AS stock, data->>'category_id' AS category_id, data->>'brand_id' AS brand_id
           FROM sync_rows WHERE tenant_id = $1 AND tbl = 'products' AND id = ANY($2)`, [ids]),
      q(`SELECT id, data->>'name' AS name FROM sync_rows WHERE tenant_id = $1 AND tbl = 'categories' AND NOT deleted`),
      q(`SELECT id, data->>'name' AS name FROM sync_rows WHERE tenant_id = $1 AND tbl = 'brands' AND NOT deleted`),
    ]);
    const cat = new Map(cats.map((c) => [c.id, c.name]));
    const brand = new Map(brands.map((b) => [b.id, b.name]));
    return new Map(prods.map((p) => [p.id, { ...p, category: cat.get(p.category_id) || null, brand: brand.get(p.brand_id) || null }]));
  }

  async function products(qq, limit) {
    const { from, to, start, end } = range(qq.desde, qq.hasta);
    const grouped = await q(
      `SELECT i.data->>'product_id' AS product_id, sum(COALESCE((i.data->>'quantity')::float8, 0)) AS qty, sum(COALESCE((i.data->>'total')::float8, 0)) AS total
         FROM sync_rows i JOIN sync_rows s ON s.tenant_id = i.tenant_id AND s.tbl = 'sales' AND s.id = i.data->>'sale_id'
        WHERE i.tenant_id = $1 AND i.tbl = 'sale_items' AND NOT i.deleted AND NOT s.deleted AND s.data->>'status' = 'COMPLETED' AND ${inRange("s.")}
          AND COALESCE(i.data->>'product_id', '') <> ALL($4)
        GROUP BY 1`, [start, end, SKIP_PRODUCTS.slice(1)]);
    const byId = await productsById(grouped.map((g) => g.product_id).filter(Boolean));
    const search = norm(qq.buscar || "");
    let rows = grouped.map((g) => {
      const p = byId.get(g.product_id);
      const units = n(g.qty), revenue = n(g.total), cost = p ? n(p.cost) : 0;
      return {
        producto: (p && p.name) || "Producto borrado",
        categoria: (p && p.category) || null,
        marca: (p && p.brand) || null,
        unidades: r2(units),
        vendido: r2(revenue),
        gananciaEstimada: p && cost > 0 ? r2(revenue - units * cost) : null,
        stockActual: p ? r2(p.stock) : null,
      };
    });
    if (search) rows = rows.filter((r) => [r.producto, r.categoria, r.marca].some((v) => v && norm(v).includes(search)));
    const key = qq.orden === "plata" ? "vendido" : qq.orden === "ganancia" ? "gananciaEstimada" : "unidades";
    rows.sort(qq.orden === "menos_vendidos" ? (a, b) => a.unidades - b.unidades : (a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
    return {
      periodo: { desde: from, hasta: to },
      ...(search ? { busqueda: qq.buscar } : {}),
      productosDistintos: rows.length,
      totalVendido: r2(rows.reduce((a, r) => a + r.vendido, 0)),
      unidadesTotales: r2(rows.reduce((a, r) => a + r.unidades, 0)),
      productos: rows.slice(0, limit),
    };
  }

  /** Productos activos (sin los internos), con lo que usan stock, faltantes y valorizado */
  const activeProducts = async () => (await q(
    `SELECT id, data->>'name' AS name, data->>'stock' AS stock, data->>'min_stock' AS min_stock, data->>'cost_price' AS cost,
            data->>'sale_price' AS price, data->>'unlimited_stock' AS unlimited, data->>'is_active' AS active, data->>'barcode' AS barcode
       FROM sync_rows WHERE tenant_id = $1 AND tbl = 'products' AND NOT deleted AND id <> ALL($2)`, [SKIP_PRODUCTS]))
    .filter((p) => p.active === null || yes(p.active));

  async function notSelling(days) {
    const since = new Date(Date.now() - days * DAY).toISOString();
    const [sold, prods] = await Promise.all([
      q(`SELECT DISTINCT i.data->>'product_id' AS id
           FROM sync_rows i JOIN sync_rows s ON s.tenant_id = i.tenant_id AND s.tbl = 'sales' AND s.id = i.data->>'sale_id'
          WHERE i.tenant_id = $1 AND i.tbl = 'sale_items' AND NOT i.deleted AND ${at("created_at", "s.")} >= $2::timestamptz`, [since]),
      activeProducts(),
    ]);
    const soldIds = new Set(sold.map((s) => s.id));
    const rows = prods.filter((p) => n(p.stock) > 0 && !soldIds.has(p.id)).map((p) => ({ producto: p.name, stock: r2(p.stock), plataParada: r2(n(p.stock) * n(p.cost)) }));
    rows.sort((a, b) => b.plataParada - a.plataParada);
    return { dias: days, cantidad: rows.length, plataParadaAlCosto: r2(rows.reduce((a, r) => a + r.plataParada, 0)), productos: rows.slice(0, 30) };
  }

  async function lowStock() {
    const rows = (await activeProducts()).filter((p) => !yes(p.unlimited))
      .filter((p) => n(p.stock) <= 0 || (n(p.min_stock) > 0 && n(p.stock) <= n(p.min_stock)))
      .map((p) => ({ producto: p.name, stock: r2(p.stock), minimo: r2(p.min_stock) }))
      .sort((a, b) => a.stock - b.stock);
    return { sinStock: rows.filter((r) => r.stock <= 0).length, enElMinimo: rows.filter((r) => r.stock > 0).length, productos: rows.slice(0, 50) };
  }

  async function stockValue() {
    const prods = (await activeProducts()).filter((p) => !yes(p.unlimited) && n(p.stock) > 0);
    return {
      productosConStock: prods.length,
      alCosto: r2(prods.reduce((a, p) => a + n(p.stock) * n(p.cost), 0)),
      aPrecioDeVenta: r2(prods.reduce((a, p) => a + n(p.stock) * n(p.price), 0)),
      sinCostoCargado: prods.filter((p) => !n(p.cost)).length,
    };
  }

  /** Cuánto queda de un producto (por nombre o código) */
  async function stockOf(qq) {
    const search = norm(qq.buscar || "");
    if (!search) return { error: "Falta qué producto buscar" };
    const words = search.split(/\s+/).filter(Boolean);
    const found = (await activeProducts()).filter((p) => p.barcode === qq.buscar.trim() || words.every((w) => norm(p.name).includes(w)));
    found.sort((a, b) => String(a.name).length - String(b.name).length);
    return {
      buscado: qq.buscar,
      encontrados: found.length,
      productos: found.slice(0, 15).map((p) => ({
        producto: p.name, stock: yes(p.unlimited) ? "sin control de stock" : r2(p.stock),
        minimo: n(p.min_stock) > 0 ? r2(p.min_stock) : null, precio: r2(p.price),
      })),
    };
  }

  async function debtors(limit) {
    const list = (await q(`SELECT data->>'name' AS name, data->>'balance' AS balance, data->>'credit_limit' AS credit_limit, data->>'is_active' AS active
        FROM sync_rows WHERE tenant_id = $1 AND tbl = 'clients' AND NOT deleted AND COALESCE((data->>'balance')::float8, 0) > 0.5`))
      .sort((a, b) => n(b.balance) - n(a.balance));
    return {
      clientesQueDeben: list.length,
      totalAdeudado: r2(list.reduce((a, c) => a + n(c.balance), 0)),
      clientes: list.slice(0, limit).map((c) => {
        const lim = c.credit_limit === null ? null : n(c.credit_limit);
        return { cliente: c.name, debe: r2(c.balance), limite: lim, pasoElLimite: !!lim && n(c.balance) > lim };
      }),
    };
  }

  async function client(qq) {
    const search = norm(qq.buscar || "");
    if (!search) return { error: "Falta el nombre del cliente" };
    const all = await q(`SELECT id, data->>'name' AS name, data->>'balance' AS balance FROM sync_rows WHERE tenant_id = $1 AND tbl = 'clients' AND NOT deleted`);
    const matches = all.filter((c) => norm(c.name).includes(search)).sort((a, b) => String(a.name).length - String(b.name).length);
    if (!matches.length) return { encontrado: false, buscado: qq.buscar };
    const c = matches[0];
    const { from, to, start, end } = range(qq.desde, qq.hasta);
    const [list, last] = await Promise.all([
      completedSales(start, end, "AND data->>'client_id' = $4", [c.id]),
      q(`SELECT max(${at("created_at")}) AS last FROM sync_rows WHERE tenant_id = $1 AND tbl = 'sales' AND NOT deleted AND data->>'status' = 'COMPLETED' AND data->>'client_id' = $2`, [c.id]),
    ]);
    const items = list.length ? await q(
      `SELECT data->>'product_name' AS name, data->>'quantity' AS qty, data->>'total' AS total FROM sync_rows
        WHERE tenant_id = $1 AND tbl = 'sale_items' AND NOT deleted AND data->>'sale_id' = ANY($2)`, [list.map((s) => s.id)]) : [];
    const g = new Map();
    for (const it of items) {
      const cur = g.get(it.name) || { unidades: 0, plata: 0 };
      cur.unidades += n(it.qty); cur.plata += n(it.total);
      g.set(it.name, cur);
    }
    return {
      cliente: c.name,
      otrosConNombreParecido: matches.length > 1 ? matches.slice(1, 5).map((m) => m.name) : undefined,
      periodo: { desde: from, hasta: to },
      compras: list.length,
      totalComprado: r2(list.reduce((a, s) => a + n(s.total), 0)),
      saldoCuentaCorriente: r2(c.balance),
      ultimaCompra: last[0] && last[0].last ? arDate(last[0].last) : null,
      productosMasComprados: [...g].sort((a, b) => b[1].plata - a[1].plata).slice(0, 10).map(([producto, v]) => ({ producto, unidades: r2(v.unidades), plata: r2(v.plata) })),
    };
  }

  async function expenses(qq) {
    const { from, to, start, end } = range(qq.desde, qq.hasta);
    const rows = await q(`SELECT data->>'amount' AS amount, data->>'description' AS description FROM sync_rows
      WHERE tenant_id = $1 AND tbl = 'cash_movements' AND NOT deleted AND data->>'type' = 'EXPENSE' AND ${inRange()}`, [start, end]);
    const g = new Map();
    for (const m of rows) {
      // Sin las marcas internas entre corchetes ("[gasto-…]")
      const label = String(m.description || "").replace(/\s*\[[^\]]*\]\s*/g, " ").trim() || "Sin detalle";
      const k = norm(label);
      const cur = g.get(k) || { concepto: label, monto: 0, veces: 0 };
      cur.monto += Math.abs(n(m.amount)); cur.veces++;
      g.set(k, cur);
    }
    const list = [...g.values()].sort((a, b) => b.monto - a.monto);
    return { periodo: { desde: from, hasta: to }, total: r2(list.reduce((a, x) => a + x.monto, 0)), cantidad: rows.length, porConcepto: list.slice(0, 20).map((x) => ({ ...x, monto: r2(x.monto) })) };
  }

  async function purchases(qq) {
    const { from, to, start, end } = range(qq.desde, qq.hasta);
    const [rows, sups] = await Promise.all([
      q(`SELECT data->>'total' AS total, data->>'paymentStatus' AS pay, data->>'supplier_id' AS supplier_id FROM sync_rows
          WHERE tenant_id = $1 AND tbl = 'purchases' AND NOT deleted AND data->>'status' = 'COMPLETED' AND ${inRange()}`, [start, end]),
      q(`SELECT id, data->>'name' AS name FROM sync_rows WHERE tenant_id = $1 AND tbl = 'suppliers'`),
    ]);
    const names = new Map(sups.map((s) => [s.id, s.name]));
    const g = new Map();
    for (const p of rows) {
      const k = names.get(p.supplier_id) || "Sin proveedor";
      const cur = g.get(k) || { proveedor: k, total: 0, compras: 0, impago: 0 };
      cur.total += n(p.total); cur.compras++;
      if (p.pay === "OWED") cur.impago += n(p.total);
      g.set(k, cur);
    }
    const list = [...g.values()].sort((a, b) => b.total - a.total);
    return {
      periodo: { desde: from, hasta: to },
      total: r2(list.reduce((a, x) => a + x.total, 0)),
      compras: rows.length,
      porProveedor: list.slice(0, 20).map((x) => ({ ...x, total: r2(x.total), impago: r2(x.impago) })),
    };
  }

  /** Cajas abiertas ahora (cuánto vendió cada una y el efectivo que debería haber) y los últimos cierres */
  async function cashNow() {
    const c = await dashboard.cash(sql, tenant);
    const hm = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : null);
    return {
      cajasAbiertas: c.open.map((s) => ({
        caja: s.terminal || null, cajero: s.cashier || null, abiertaDesde: hm(s.opened_at),
        ventas: s.salesCount, vendido: r2(s.salesTotal), efectivoQueDeberiaHaber: r2(s.expectedNow), gastos: r2(s.expenses), retiros: r2(s.withdrawals),
      })),
      ultimosCierres: c.closed.slice(0, 3).map((s) => ({ caja: s.terminal || null, cajero: s.cashier || null, cerrada: hm(s.closed_at), diferencia: s.difference === null ? null : r2(s.difference) })),
    };
  }

  function one(qq) {
    const limit = Math.min(50, Math.max(1, Number(qq.limite) || 10));
    switch (qq.tipo) {
      case "ventas": return sales(qq);
      case "productos": return products(qq, limit);
      case "sin_ventas": return notSelling(Math.min(365, Math.max(1, Number(qq.dias) || 30)));
      case "stock_bajo": return lowStock();
      case "stock_valorizado": return stockValue();
      case "stock": return stockOf(qq);
      case "deudores": return debtors(limit);
      case "cliente": return client(qq);
      case "gastos": return expenses(qq);
      case "compras": return purchases(qq);
      case "caja": return cashNow();
      default: return Promise.resolve({ error: "Consulta desconocida" });
    }
  }
  return { one };
}

/** Corre hasta 3 consultas de la IA. Una que falla no tira las demás. */
async function runQueries(sql, tenant, queries, logger) {
  const { one } = makeQueries(sql, tenant);
  const out = [];
  for (const qq of (queries || []).slice(0, 3)) {
    try {
      out.push({ consulta: qq.tipo, ...(await one(qq)) });
    } catch (err) {
      if (logger) logger.warn(`Preguntas por WhatsApp (${tenant}, ${qq.tipo}): ${err && err.message}`);
      out.push({ consulta: qq.tipo, error: "No se pudo calcular" });
    }
  }
  return out;
}

/** Hasta cuándo están los datos: la última vez que una caja del comercio mandó algo a la nube */
async function lastSync(sql, tenant) {
  const rows = await run(sql, `SELECT last_push_at FROM sync_tenants WHERE tenant_id = $1`, [tenant]);
  return rows[0] && rows[0].last_push_at ? new Date(rows[0].last_push_at).toISOString() : null;
}

module.exports = { runQueries, lastSync, range, toMs };
