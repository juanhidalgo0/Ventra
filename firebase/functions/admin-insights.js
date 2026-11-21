"use strict";
// ═══════════════════════════════════════════════════════════════════
// Panel del admin: lo que dice cómo viene cada cliente y el negocio.
//  - measure: de noche, en Neon, la actividad de ventas y qué funciones usa cada comercio
//  - health: puntaje 0-100 de cada cliente con sus motivos (lo usan el panel y los avisos)
//  - funnel: visitas → /empezar → registro → plan → primer pago → segundo pago, por mes
//  - revenueMonths: cobrado, altas pagas y bajas de cada mes
//  - alerts / weekly: lo que se te avisa al celular y por mail (ver ventraAdminWatch en index.js)
// Todo lo que no toca la base es puro, para probarlo con node (test/admin-insights.test.js).
// ═══════════════════════════════════════════════════════════════════

const DAY = 864e5;

// Tablas de la caja que dicen si un comercio usa cada función (las que se sincronizan con Neon)
const FEATURES = [
  { key: "purchases", tbl: "purchases", label: "Compras" },
  { key: "accounts", tbl: "account_movements", label: "Cuenta corriente" },
  { key: "zreports", tbl: "daily_z_reports", label: "Cierres Z" },
  { key: "promos", tbl: "promotions", label: "Promos" },
  { key: "kits", tbl: "product_kit_items", label: "Combos y packs" },
  { key: "quotes", tbl: "quotes", label: "Presupuestos" },
  { key: "preorders", tbl: "pre_orders", label: "Pedidos y preventa" },
  { key: "delivery", tbl: "delivery_runs", label: "Reparto" },
  { key: "workorders", tbl: "work_orders", label: "Encargos" },
  { key: "lots", tbl: "product_lots", label: "Vencimientos" },
  { key: "fiscal", tbl: "fiscal_documents", label: "Factura electrónica" },
  { key: "suppliers", tbl: "supplier_payments", label: "Pagos a proveedores" },
  { key: "surcharges", tbl: "surcharges", label: "Recargos" },
  { key: "commissions", tbl: "seller_commission_payments", label: "Comisiones" },
];
// Planes que venden con la caja (los de turnos y tienda sola no cargan ventas en la caja)
const CAJA_PLANS = new Set(["full", "caja", "prueba"]);

// Fecha de la venta: número (ms) o texto ISO. Un texto raro no rompe la consulta: queda sin fecha.
const SALE_AT = `(CASE WHEN jsonb_typeof(data->'created_at') = 'number' THEN to_timestamp((data->>'created_at')::float8 / 1000)
  WHEN data->>'created_at' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN (data->>'created_at')::timestamptz END)`;

/** De noche: ventas por comercio (última, esta semana, las 4 anteriores, $ de 30 días) y uso de funciones. */
async function measure(sql, run) {
  const [sales, tables] = await Promise.all([
    run(sql, `SELECT tenant_id,
        count(*) FILTER (WHERE at >= now() - interval '7 days')::int AS s7,
        count(*) FILTER (WHERE at >= now() - interval '35 days' AND at < now() - interval '7 days')::int AS s28,
        coalesce(sum(total) FILTER (WHERE at >= now() - interval '30 days'), 0)::float8 AS amount30,
        max(at) AS last
      FROM (SELECT tenant_id, ${SALE_AT} AS at,
              CASE WHEN jsonb_typeof(data->'total') = 'number' THEN (data->>'total')::float8 ELSE 0 END AS total
            FROM sync_rows WHERE tbl = 'sales' AND NOT deleted AND data->>'status' = 'COMPLETED') x
      WHERE at IS NOT NULL AND at <= now() + interval '1 day'
      GROUP BY tenant_id`, []),
    run(sql, `SELECT tenant_id, tbl, count(*)::int AS n,
        count(*) FILTER (WHERE updated_at >= now() - interval '30 days')::int AS recent
      FROM sync_rows WHERE NOT deleted AND tbl = ANY($1) GROUP BY tenant_id, tbl`, [FEATURES.map((f) => f.tbl)]),
  ]);
  const activity = {};
  sales.forEach((r) => {
    activity[r.tenant_id] = {
      s7: r.s7, s28: r.s28, amount30: Math.round(Number(r.amount30) || 0),
      last: r.last ? new Date(r.last).toISOString() : null,
    };
  });
  const usage = {};
  tables.forEach((r) => { (usage[r.tenant_id] = usage[r.tenant_id] || {})[r.tbl] = [r.n, r.recent]; });
  return { activity, tables: usage };
}

/**
 * Funciones que usa un comercio. `tables`: { tbl: [total, cambiadas en 30 días] } de measure.
 * extras: { store: { published }, aiThisMonth } (de Firestore).
 */
function features(tables, extras = {}) {
  const t = tables || {};
  const out = FEATURES.map((f) => {
    const [n, recent] = t[f.tbl] || [0, 0];
    return { key: f.key, label: f.label, used: n > 0, recent: recent > 0, count: n };
  });
  const store = extras.store;
  out.push({ key: "store", label: "Tienda online", used: !!(store && store.subdomain), recent: !!(store && store.published), count: store && store.published ? 1 : 0 });
  out.push({ key: "ai", label: "IA (boletas, preguntas)", used: !!extras.aiThisMonth, recent: !!extras.aiThisMonth, count: Number(extras.aiThisMonth) || 0 });
  return out;
}

const daysSince = (iso, now) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : null);

/**
 * Salud de un cliente, 0 a 100, con los motivos que le restan.
 * a: { plan, state, trial, createdAt, devices: [{ kind, lastSeenAt }] }
 * ctx: { activity, sync: { lastPushAt }, feats (de features), lastSignInAt, now }
 */
function health(a, ctx = {}) {
  const now = ctx.now || Date.now();
  const reasons = [];
  let score = 100;
  const hit = (pts, text, level = "warn") => { score -= pts; reasons.push({ text, level, pts }); };

  if (a.state === "GRACE") hit(25, "No se renovó el pago (está en gracia)", "bad");
  else if (a.state === "READ_ONLY") hit(55, "Quedó en solo lectura", "bad");
  else if (a.state === "UNPAID") hit(45, "Nunca pagó", "bad");

  const age = daysSince(a.createdAt, now);
  const sellsWithCaja = CAJA_PLANS.has(a.plan);
  const act = ctx.activity || null;
  if (sellsWithCaja) {
    const since = act ? daysSince(act.last, now) : null;
    if (since == null) {
      if (age == null || age >= 3) hit(age != null && age >= 10 ? 35 : 20, "Todavía no vendió nada con Ventra", age != null && age >= 10 ? "bad" : "warn");
    } else if (since >= 7) hit(35, `Hace ${since} días que no vende`, "bad");
    else if (since >= 3) hit(20, `Hace ${since} días que no vende`);
    if (act && since != null && since < 7) {
      const weekAvg = (act.s28 || 0) / 4;
      if (weekAvg >= 10 && act.s7 < weekAvg * 0.5) hit(15, `Vende menos de la mitad que antes (${act.s7} esta semana, ~${Math.round(weekAvg)} por semana)`);
    }
  } else if (ctx.lastSignInAt !== undefined) {
    const s = daysSince(ctx.lastSignInAt, now);
    if (s == null || s >= 14) hit(20, s == null ? "No volvió a entrar" : `No entra hace ${s} días`);
  }

  const pcs = (a.devices || []).filter((d) => d.kind !== "cloud");
  if (sellsWithCaja && !(a.devices || []).length && (age == null || age >= 2)) hit(10, "Sin PC ni caja web vinculada");
  const seen = pcs.map((d) => daysSince(d.lastSeenAt, now)).filter((d) => d != null);
  const freshest = seen.length ? Math.min(...seen) : null;
  if (pcs.length && freshest != null && freshest >= 3) hit(10, `Sus PCs no se conectan hace ${freshest} días`);
  const push = ctx.sync ? daysSince(ctx.sync.lastPushAt, now) : null;
  if (freshest != null && freshest < 1 && push != null && push >= 2) hit(10, `La PC está prendida pero no sincroniza hace ${push} días`, "bad");

  if (ctx.feats && sellsWithCaja && age != null && age >= 14) {
    const used = ctx.feats.filter((f) => f.recent).length;
    if (!used) hit(5, "Solo usa la caja (ninguna otra función)");
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? "ok" : score >= 40 ? "watch" : "risk";
  // En prueba gratis: el puntaje vale igual, pero se marca para no confundir con un cliente que paga
  return { score, level, reasons, trial: !!a.trial };
}

const monthKey = (d) => new Date(d).toISOString().slice(0, 7);
function lastMonths(n, now) {
  const out = [], d = new Date(now);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

/**
 * Embudo por mes. site: { "AAAA-MM": { view_home, view_empezar, signup_google, ... } } (ventra_site_stats)
 * authUsers: [{ createdAt }], accounts: [{ createdAt, trialUsed, payments: n }]
 */
function funnel({ site = {}, authUsers = [], accounts = [], months = 6, now = Date.now() }) {
  return lastMonths(months, now).map((m) => {
    const s = site[m] || {};
    const views = Object.keys(s).filter((k) => k.startsWith("view_") && k !== "view_empezar").reduce((n, k) => n + (Number(s[k]) || 0), 0);
    const acc = accounts.filter((a) => a.createdAt && monthKey(a.createdAt) === m);
    return {
      month: m,
      visits: views,
      empezar: Number(s.view_empezar) || 0,
      google: Number(s.signup_google) || 0,
      registered: authUsers.filter((u) => u.createdAt && monthKey(u.createdAt) === m).length,
      accounts: acc.length,
      trial: acc.filter((a) => a.trialUsed).length,
      paid: acc.filter((a) => a.payments >= 1).length,
      renewed: acc.filter((a) => a.payments >= 2).length,
    };
  });
}

/**
 * Cobrado, clientes que pagaron por primera vez y bajas de cada mes.
 * accounts: [{ payments: [{ paidAt, amount }], paidUntil, state }] · graceDays: días de gracia
 * Baja = pagó alguna vez y hoy ya no está activa ni en gracia: cuenta en el mes en que se le terminó la gracia.
 */
function revenueMonths({ accounts = [], graceDays = 7, months = 12, now = Date.now() }) {
  const keys = lastMonths(months, now);
  const rows = Object.fromEntries(keys.map((k) => [k, { month: k, revenue: 0, newPaying: 0, churned: 0, payingEnd: 0 }]));
  accounts.forEach((a) => {
    const pays = (a.payments || []).filter((p) => p.paidAt && p.amount > 0).sort((x, y) => String(x.paidAt).localeCompare(String(y.paidAt)));
    pays.forEach((p) => { const r = rows[monthKey(p.paidAt)]; if (r) r.revenue += p.amount; });
    if (!pays.length) return;
    const first = rows[monthKey(pays[0].paidAt)];
    if (first) first.newPaying++;
    const end = a.paidUntil ? Date.parse(a.paidUntil) + graceDays * DAY : null;
    const gone = end != null && end < now && a.state !== "ACTIVE" && a.state !== "GRACE";
    if (gone) { const r = rows[monthKey(end)]; if (r) r.churned++; }
    // Pagando a fin de cada mes: desde su primer pago hasta que se fue
    keys.forEach((k) => {
      const [y, mm] = k.split("-").map(Number);
      const monthEnd = Math.min(Date.UTC(y, mm, 1) - 1, now);
      if (Date.parse(pays[0].paidAt) <= monthEnd && (end == null || end >= monthEnd || !gone)) rows[k].payingEnd++;
    });
  });
  return keys.map((k, i) => {
    const r = rows[k], start = i ? rows[keys[i - 1]].payingEnd : null;
    return { ...r, churnPct: start ? Math.round((1000 * r.churned) / start) / 10 : null };
  });
}

const cmpVersion = (a, b) => {
  const pa = String(a || "").split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b || "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};

/**
 * Avisos para el dueño de Ventra. Cada uno con una clave estable: el que vigila (index.js) no repite
 * la misma clave en 7 días. rows: [{ a (cuenta del panel), h (health), activity, sync, aiUsd, followUp }]
 */
function alerts({ rows = [], errors = [], now = Date.now(), aiLimitPct = 30, fx = 1500 }) {
  const out = [];
  const today = new Date(now).toISOString().slice(0, 10);
  rows.forEach(({ a, activity, sync, aiUsd, followUp }) => {
    const who = a.email || a.uid;
    const sells = CAJA_PLANS.has(a.plan) && (a.state === "ACTIVE" || a.state === "GRACE");
    // Dejó de vender: vendía (hay ventas en las 4 semanas anteriores) y hace 3 días o más que no
    if (sells && activity && activity.s28 > 0) {
      const since = daysSince(activity.last, now);
      if (since != null && since >= 3) out.push({ key: `nosales:${a.uid}`, level: since >= 7 ? "bad" : "warn", uid: a.uid, title: `${who} dejó de vender`, body: `Su última venta fue hace ${since} días. Vendía ~${Math.round(activity.s28 / 4)} por semana.` });
    }
    // Caja trabada: PC prendida (se conectó en el día) pero sin subir nada hace 2 días o más
    if (a.state === "ACTIVE" || a.state === "GRACE") {
      const pcs = (a.devices || []).filter((d) => d.kind !== "cloud");
      const on = pcs.some((d) => { const s = daysSince(d.lastSeenAt, now); return s != null && s < 1; });
      const push = sync ? daysSince(sync.lastPushAt, now) : null;
      if (on && push != null && push >= 2) out.push({ key: `stuck:${a.uid}`, level: "bad", uid: a.uid, title: `La caja de ${who} no sincroniza`, body: `La PC se conecta pero no sube datos hace ${push} días. Entrá a su sistema o pedile que reinicie Ventra.` });
    }
    // Pago no renovado: entró en gracia
    if (a.state === "GRACE" && !a.trial) out.push({ key: `grace:${a.uid}:${String(a.paidUntil || "").slice(0, 10)}`, level: "warn", uid: a.uid, title: `${who} no renovó el pago`, body: `Está en gracia: le quedan ${a.daysLeft} día(s) antes de quedar en solo lectura.` });
    // Prueba gratis que termina mañana
    if (a.trial && a.daysLeft === 1) out.push({ key: `trial:${a.uid}`, level: "info", uid: a.uid, title: `Mañana termina la prueba de ${who}`, body: a.mpStatus === "cancelled" ? "Se dio de baja en Mercado Pago: no se le va a cobrar." : "Mañana se le cobra el primer mes." });
    // Gasto de IA alto contra lo que paga
    if (aiUsd > 0 && a.planAmount) {
      const pct = Math.round((100 * aiUsd * fx) / a.planAmount);
      if (pct >= aiLimitPct) out.push({ key: `ai:${a.uid}:${today.slice(0, 7)}:${pct >= 2 * aiLimitPct ? 2 : 1}`, level: pct >= 2 * aiLimitPct ? "bad" : "warn", uid: a.uid, title: `IA: ${who} ya gastó el ${pct}% de lo que paga`, body: `US$ ${aiUsd.toFixed(2)} este mes con ${a.planName || a.plan}.` });
    }
    // Seguimiento que vos te anotaste para hoy (o que quedó atrasado)
    if (followUp && followUp.date && followUp.date <= today && !followUp.done) out.push({ key: `follow:${a.uid}:${followUp.date}`, level: "info", uid: a.uid, title: `Seguimiento: ${who}`, body: followUp.text || "Te lo anotaste para hoy." });
  });
  const fresh = errors.filter((e) => !e.resolved && e.firstAt && now - Date.parse(e.firstAt) < DAY);
  if (fresh.length) out.push({ key: `errors:${today}`, level: "warn", title: `${fresh.length} error(es) nuevo(s) en las cajas`, body: fresh.slice(0, 3).map((e) => String(e.message || "").slice(0, 80)).join(" · ") });
  return out;
}

/** Resumen del lunes: la semana en números. */
function weekly({ accounts = [], rows = [], authUsers = [], errors = [], mrr = 0, aiUsdMonth = 0, now = Date.now() }) {
  const since = now - 7 * DAY;
  const inWeek = (iso) => iso && Date.parse(iso) >= since;
  const paid = accounts.reduce((s, a) => s + (a.payments || []).filter((p) => inWeek(p.paidAt)).reduce((t, p) => t + (p.amount || 0), 0), 0);
  const risk = rows.filter((r) => r.h && r.h.level === "risk" && !r.h.trial && r.a.state !== "READ_ONLY" && r.a.state !== "UNPAID").sort((x, y) => x.h.score - y.h.score);
  return {
    paid,
    mrr,
    newAccounts: accounts.filter((a) => inWeek(a.createdAt)).length,
    registered: authUsers.filter((u) => inWeek(u.createdAt)).length,
    newPaying: accounts.filter((a) => { const p = (a.payments || []).filter((x) => x.amount > 0).sort((x, y) => String(x.paidAt).localeCompare(String(y.paidAt)))[0]; return p && inWeek(p.paidAt); }).length,
    lost: accounts.filter((a) => a.state === "READ_ONLY" && a.paidUntil && (a.payments || []).length && Date.parse(a.paidUntil) >= since - 7 * DAY && Date.parse(a.paidUntil) < now).length,
    risk: risk.slice(0, 5).map((r) => ({ email: r.a.email, score: r.h.score, why: (r.h.reasons[0] || {}).text || "" })),
    riskCount: risk.length,
    aiUsdMonth,
    errors: errors.filter((e) => !e.resolved && e.lastAt && Date.parse(e.lastAt) >= since).length,
  };
}

module.exports = { FEATURES, CAJA_PLANS, measure, features, health, funnel, revenueMonths, alerts, weekly, cmpVersion, lastMonths };
