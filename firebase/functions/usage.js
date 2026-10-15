// ═══════════════════════════════════════════════════
// Uso de la nube por comercio, para estimar cuánto cuesta cada cliente.
//
// Cada función suma contadores en memoria (track) y cada ~60 s los vuelca a
// Firestore con incrementos: ventra_usage/{AAAA-MM}_{uid}. Así una caja que
// sincroniza cada pocos segundos no genera una escritura por llamada.
// Si la instancia se apaga antes de volcar se pierde ese minuto: son estimaciones.
//
// Contadores:
//  syncCalls, cloudSyncCalls (de la caja en la nube, pesan en fly.io),
//  neonCalls (las que llegaron a Neon), idlePulls (respondidas sin despertar Neon),
//  pushRows, pullRows, imgUpBytes, imgDownBytes, panelCalls, storeViews,
//  waReminders (recordatorios por WhatsApp mandados), waFailed (los que Meta avisó que no llegaron)
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");

const FLUSH_MS = 60 * 1000;
const TZ = "America/Argentina/Buenos_Aires";
let buffer = {};
let lastFlush = Date.now();

const monthKey = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
const prevMonthKey = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 2, 15)).toISOString().slice(0, 7); };

function track(uid, fields) {
  if (!uid) return;
  const b = (buffer[uid] = buffer[uid] || {});
  for (const [k, v] of Object.entries(fields)) {
    const n = Number(v) || 0;
    if (n) b[k] = (b[k] || 0) + n;
  }
}

/** Vuelca lo acumulado si pasó más de un minuto (o siempre, con force). Nunca tira error. */
async function flush(force = false) {
  if (!force && Date.now() - lastFlush < FLUSH_MS) return;
  const pending = buffer;
  buffer = {};
  lastFlush = Date.now();
  const uids = Object.keys(pending);
  if (!uids.length) return;
  const db = admin.firestore();
  const month = monthKey();
  const inc = admin.firestore.FieldValue.increment;
  const batch = db.batch();
  for (const uid of uids) {
    const data = { uid, month, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    for (const [k, v] of Object.entries(pending[uid])) data[k] = inc(v);
    batch.set(db.collection("ventra_usage").doc(`${month}_${uid}`), data, { merge: true });
  }
  try {
    await batch.commit();
  } catch (err) {
    console.warn("Ventra uso: no se pudo guardar", err.message);
  }
}

/** Uso del mes por comercio: { uid: { syncCalls, ... } } */
async function monthUsage(month) {
  const snap = await admin.firestore().collection("ventra_usage").where("month", "==", month).get();
  const out = {};
  snap.forEach((d) => {
    const { uid, month: _m, updatedAt: _u, ...counters } = d.data();
    out[uid] = counters;
  });
  return out;
}

/** Bytes de fotos de productos en Storage por comercio (tenants/{uid}/...). */
async function storageBytesByTenant() {
  // De a una página y pidiendo solo nombre y tamaño: con miles de fotos, traer todo junto agotaba la memoria
  const bucket = admin.storage().bucket();
  const out = {};
  let query = { prefix: "tenants/", autoPaginate: false, maxResults: 1000, fields: "items(name,size),nextPageToken" };
  while (query) {
    const [files, next] = await bucket.getFiles(query);
    files.forEach((f) => {
      const uid = f.name.split("/")[1];
      if (uid) out[uid] = (out[uid] || 0) + Number(f.metadata.size || 0);
    });
    query = next || null;
  }
  return out;
}

// Recordatorios automáticos por WhatsApp: Meta cobra cada mensaje de "utilidad" entregado en
// dólares (tarifa de Argentina) y la tarjeta le suma impuestos. Se editan en el admin.
const WA_DEFAULTS = { priceUsd: 0.026, fx: 1460, taxPct: 21 };

/**
 * Cuánto sale en pesos cada dólar que se paga con la tarjeta (WhatsApp, Neon, Google Cloud, fly).
 *  - Dólar cargado a mano en el admin: dólar × (1 + impuestos).
 *  - Si no, el dólar tarjeta del día (autoFx, de dolarapi.com): ya trae la percepción del 30 %
 *    sobre el oficial, y se le suma el IVA de servicios digitales (impuestos, 21 %) sobre el oficial.
 *  - Sin ninguno de los dos, los valores por defecto.
 */
function waSettings(saved, autoFx) {
  const s = saved || {};
  const pick = (k) => (typeof s[k] === "number" && (s[k] > 0 || (k === "taxPct" && s[k] === 0)) ? s[k] : WA_DEFAULTS[k]);
  const out = { priceUsd: pick("priceUsd"), fx: pick("fx"), taxPct: pick("taxPct") };
  const tarjeta = autoFx && Number(autoFx.tarjeta) > 0 ? Number(autoFx.tarjeta) : 0;
  let perUsd, fxSource;
  if (Number(s.fx) > 0 || !tarjeta) {
    perUsd = out.fx * (1 + out.taxPct / 100);
    fxSource = Number(s.fx) > 0 ? "manual" : "default";
  } else {
    // Sin el oficial se lo deduce del tarjeta (oficial + 30 %)
    const oficial = Number(autoFx.oficial) > 0 ? Number(autoFx.oficial) : tarjeta / 1.3;
    out.fx = tarjeta;
    perUsd = tarjeta + oficial * out.taxPct / 100;
    fxSource = "auto";
  }
  return {
    ...out, perUsd, perMessage: out.priceUsd * perUsd, defaults: fxSource === "default", fxSource,
    ...(fxSource === "auto" ? { tarjeta, oficial: Number(autoFx.oficial) || null, fxDate: autoFx.date || null } : {}),
  };
}

/**
 * Mensajes de WhatsApp entregados en el mes: los mandados (waReminders) menos los que Meta
 * avisó que no llegaron (waFailed). El cupo usado del mes (ventra_wa_quota) ya descuenta
 * los que no llegaron pero no cuenta los de paquetes: se toma el mayor de los dos.
 */
function waMessages(counters, quotaDoc, month) {
  const u = counters || {};
  const sent = Math.max(0, (Number(u.waReminders) || 0) - (Number(u.waFailed) || 0));
  const fromQuota = quotaDoc && quotaDoc.month === month ? Number(quotaDoc.used) || 0 : 0;
  return Math.max(sent, fromQuota);
}

/**
 * Reparte el costo mensual de cada servicio entre los comercios según su uso.
 *  - Neon: mitad por datos guardados, mitad por las consultas que llegaron a la base.
 *  - Firebase: 70 % por llamadas (sync + panel + tienda), 30 % por fotos guardadas.
 *  - fly.io: por uso de la caja en la nube; si nadie la usó, se reparte entre los que la tienen.
 *  - Otros (dominio, ARCA, varios): parejo entre las cuentas activas.
 *  - WhatsApp: no se reparte, cada comercio paga sus mensajes (waMessages × costo por mensaje).
 * `tenants`: [{ uid, active, cloudBytes, storageBytes, hasCloudBox, usage, waMessages }]
 */
function allocate(costs, tenants, wa = waSettings()) {
  // Si nadie tuvo uso de algo, esa parte se reparte parejo entre las cuentas activas
  const actives = tenants.filter((t) => t.active).length;
  const even = (t) => (actives ? (t.active ? 1 / actives : 0) : 1 / (tenants.length || 1));
  const share = (list, weight) => {
    const total = list.reduce((s, t) => s + weight(t), 0);
    return (t) => (total > 0 ? weight(t) / total : even(t));
  };
  const calls = (t) => (t.usage.syncCalls || 0) + (t.usage.panelCalls || 0) + (t.usage.storeViews || 0);
  const neonData = share(tenants, (t) => t.cloudBytes || 0);
  // Antes de medir neonCalls se usaban todas las sincronizaciones
  const neonCalls = share(tenants, (t) => (t.usage.neonCalls != null ? t.usage.neonCalls : t.usage.syncCalls) || 0);
  const fbCalls = share(tenants, calls);
  const fbStorage = share(tenants, (t) => t.storageBytes || 0);
  const flyUse = share(tenants, (t) => t.usage.cloudSyncCalls || 0);
  const flyHas = share(tenants, (t) => (t.hasCloudBox ? 1 : 0));
  const anyFly = tenants.some((t) => t.usage.cloudSyncCalls);
  const activeShare = even;

  const c = { neon: Number(costs.neon) || 0, firebase: Number(costs.firebase) || 0, fly: Number(costs.fly) || 0, other: Number(costs.other) || 0 };
  const out = {};
  tenants.forEach((t) => {
    const parts = {
      neon: c.neon * (0.5 * neonData(t) + 0.5 * neonCalls(t)),
      firebase: c.firebase * (0.7 * fbCalls(t) + 0.3 * fbStorage(t)),
      fly: c.fly * (anyFly ? flyUse(t) : flyHas(t)),
      other: c.other * activeShare(t),
      whatsapp: (Number(t.waMessages) || 0) * wa.perMessage,
    };
    out[t.uid] = { ...parts, waMessages: Number(t.waMessages) || 0, total: parts.neon + parts.firebase + parts.fly + parts.other + parts.whatsapp };
  });
  return out;
}

// ═══════════════════════════════════════════════════
// Costos del mes que se cargan solos (tarea nocturna ventraAutoCosts).
// Se guardan en ventra_config/admin.autoCosts[AAAA-MM] = { firebase, neon, fly, waMeta, fx, at,
// source, detail, errors }: firebase, neon y waMeta en pesos (con el dólar de ese día), detail con
// el monto original en su moneda, y errors con lo que no se pudo leer (se conserva el último dato bueno).
//  - Firebase / Google Cloud: exportación de la facturación a BigQuery (costo + créditos del mes de factura).
//  - Neon: API de consumo (plan Launch) × las tarifas publicadas.
//  - fly.io: no tiene API de facturación y la caja en la nube se suspende sola, así que las horas
//    encendidas no se pueden saber: va como costo fijo recurrente (ver recurringFor).
//  - WhatsApp: total que informa Meta (pricing_analytics), para comparar con la estimación por cliente.
//  - Dólar: dólar tarjeta y oficial de dolarapi.com.
// ═══════════════════════════════════════════════════

// Tarifas del plan Launch de Neon (neon.com/pricing, octubre de 2026), en US$.
// Almacenamiento en GB-mes decimales (10^9 bytes); 500 GB de transferencia pública incluidos por proyecto.
const NEON_PRICES = { cuHour: 0.106, storageGbMonth: 0.35, restoreGbMonth: 0.2, transferGb: 0.1, transferFreeGb: 500 };
const NEON_API = "https://console.neon.tech/api/v2";
const NEON_METRICS = ["compute_unit_seconds", "root_branch_bytes_month", "child_branch_bytes_month", "instant_restore_bytes_month", "public_network_transfer_bytes"];
const GRAPH = "https://graph.facebook.com/v21.0";
// Cuentas de WhatsApp Business de Ventra (ver whatsapp.js): la de prueba y la del número real
const WABA_IDS = () => String(process.env.VENTRA_WA_WABA_IDS || "1135959985533409,1116867764202620").split(",").map((s) => s.trim()).filter(Boolean);
const DOLAR_API = "https://dolarapi.com/v1/dolares";
const BQ_API = "https://bigquery.googleapis.com/bigquery/v2";

/** Inicio del mes en UTC, del siguiente y del mes en Argentina (UTC−3), en milisegundos. */
function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  return {
    utcStart: Date.UTC(y, m - 1, 1), utcEnd: Date.UTC(y, m, 1),
    arStart: Date.UTC(y, m - 1, 1, 3), arEnd: Date.UTC(y, m, 1, 3),
  };
}

async function getJson(fetchFn, url, opts, what) {
  const res = await fetchFn(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data && (data.error || data)) || {};
    const msg = (typeof e === "string" ? e : e.message || e.error_user_msg) || `respondió ${res.status}`;
    throw Object.assign(new Error(`${what}: ${msg}`), { status: res.status });
  }
  return data;
}

/** Dólar tarjeta (y oficial, para el IVA) del día. */
async function fetchDollar({ fetch: fetchFn = fetch } = {}) {
  const [tarjeta, oficial] = await Promise.all([
    getJson(fetchFn, `${DOLAR_API}/tarjeta`, {}, "dolarapi"),
    getJson(fetchFn, `${DOLAR_API}/oficial`, {}, "dolarapi").catch(() => null),
  ]);
  const t = Number(tarjeta.venta);
  if (!(t > 0)) throw new Error("dolarapi: sin cotización del dólar tarjeta");
  return { tarjeta: t, oficial: oficial && Number(oficial.venta) > 0 ? Number(oficial.venta) : null, date: tarjeta.fechaActualizacion || null };
}

/** Consumo de Neon del mes (todas las organizaciones y proyectos de la clave) en US$. */
async function neonMonthCost({ apiKey, month, now = Date.now(), fetch: fetchFn = fetch }) {
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  const { utcStart, utcEnd } = monthBounds(month);
  // Hasta la última hora completa (o el fin del mes, si ya pasó)
  const to = Math.min(utcEnd, Math.floor(now / 3600000) * 3600000);
  if (to <= utcStart) return { amount: 0, currency: "USD", cuHours: 0, storageGbMonth: 0, restoreGbMonth: 0, transferGb: 0, projects: 0 };
  const orgIds = process.env.NEON_ORG_ID
    ? [process.env.NEON_ORG_ID]
    : ((await getJson(fetchFn, `${NEON_API}/users/me/organizations`, { headers }, "Neon")).organizations || []).map((o) => o.id);
  if (!orgIds.length) throw new Error("Neon: la clave no tiene organizaciones");

  const perProject = {};
  for (const orgId of orgIds) {
    let cursor = null;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({
        from: new Date(utcStart).toISOString(), to: new Date(to).toISOString(),
        granularity: "daily", org_id: orgId, metrics: NEON_METRICS.join(","), limit: "100",
      });
      if (cursor) q.set("cursor", cursor);
      const data = await getJson(fetchFn, `${NEON_API}/consumption_history/v2/projects?${q}`, { headers }, "Neon");
      for (const p of data.projects || []) {
        const acc = (perProject[p.project_id] = perProject[p.project_id] || {});
        for (const period of p.periods || []) for (const c of period.consumption || []) for (const m of c.metrics || []) {
          acc[m.metric_name] = (acc[m.metric_name] || 0) + (Number(m.value) || 0);
        }
      }
      cursor = data.pagination && data.pagination.cursor;
      if (!cursor || !(data.projects || []).length) break;
    }
  }

  // Los *_bytes_month de la v2 vienen en byte-mes (GB-mes = valor / 10^9). Si llegara en
  // byte-hora (como dice otra página de su documentación) daría cientos de GB-mes para una base
  // de menos de 1 GB: en ese caso se divide por las 744 horas que usa Neon.
  const gbMonth = (v) => { const g = (v || 0) / 1e9; return g > 100 ? g / 744 : g; };
  const t = { amount: 0, currency: "USD", cuHours: 0, storageGbMonth: 0, restoreGbMonth: 0, transferGb: 0, projects: Object.keys(perProject).length };
  for (const m of Object.values(perProject)) {
    const cuHours = (m.compute_unit_seconds || 0) / 3600;
    const storage = gbMonth(m.root_branch_bytes_month) + gbMonth(m.child_branch_bytes_month);
    const restore = gbMonth(m.instant_restore_bytes_month);
    const transfer = (m.public_network_transfer_bytes || 0) / 1e9;
    t.cuHours += cuHours; t.storageGbMonth += storage; t.restoreGbMonth += restore; t.transferGb += transfer;
    t.amount += cuHours * NEON_PRICES.cuHour + storage * NEON_PRICES.storageGbMonth + restore * NEON_PRICES.restoreGbMonth +
      Math.max(0, transfer - NEON_PRICES.transferFreeGb) * NEON_PRICES.transferGb;
  }
  return t;
}

/** Total de WhatsApp que informa Meta para el mes (en la moneda de cada cuenta de WhatsApp Business). */
async function waMetaMonthCost({ token, month, now = Date.now(), fetch: fetchFn = fetch, wabaIds = WABA_IDS() }) {
  const { arStart, arEnd } = monthBounds(month);
  const start = Math.floor(arStart / 1000), end = Math.floor(Math.min(arEnd, now) / 1000);
  const out = { amount: 0, currency: null, messages: 0, accounts: 0 };
  if (end <= start) return out;
  const errors = [];
  for (const id of wabaIds) {
    const fields = `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).metric_types(COST,VOLUME)`;
    try {
      const data = await getJson(fetchFn, `${GRAPH}/${id}?fields=${encodeURIComponent(fields)}`, { headers: { Authorization: `Bearer ${token}` } }, "Meta");
      const cur = data.currency || "USD";
      if (out.currency && out.currency !== cur) throw new Error(`Meta: monedas distintas (${out.currency} y ${cur})`);
      out.currency = cur;
      out.accounts++;
      for (const block of (data.pricing_analytics && data.pricing_analytics.data) || []) {
        for (const p of block.data_points || []) { out.amount += Number(p.cost) || 0; out.messages += Number(p.volume) || 0; }
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  // Si ninguna cuenta se pudo leer no hay dato; si falló alguna (por ejemplo la de prueba, sin
  // permiso para el token) se usa lo leído y se avisa cuáles faltaron
  if (!out.accounts) throw new Error(errors.join(" · ") || "Meta: sin cuentas de WhatsApp Business");
  if (errors.length) out.warning = errors.join(" · ");
  out.currency = out.currency || "USD";
  return out;
}

/** Token de la cuenta de servicio de la función (para BigQuery). */
async function googleToken() {
  const t = await admin.credential.applicationDefault().getAccessToken();
  return t.access_token;
}

/**
 * Costo de Google Cloud (Firebase) del mes de factura, desde la exportación a BigQuery.
 * Busca la tabla gcp_billing_export_v1_* en los datasets del proyecto (o usa `table`).
 * Sin exportación devuelve { missing: true }. Solo suma el proyecto de Ventra (`projectId`).
 */
async function firebaseMonthCost({ month, projectId, table = null, fetch: fetchFn = fetch, getToken = googleToken }) {
  const headers = { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" };
  let found = table;
  if (!found) {
    const ds = await getJson(fetchFn, `${BQ_API}/projects/${projectId}/datasets?maxResults=1000`, { headers }, "BigQuery");
    for (const d of ds.datasets || []) {
      const datasetId = d.datasetReference.datasetId;
      const tb = await getJson(fetchFn, `${BQ_API}/projects/${projectId}/datasets/${datasetId}/tables?maxResults=1000`, { headers }, "BigQuery");
      // La de uso estándar (no la detallada por recurso, que suma lo mismo con más filas)
      const t = (tb.tables || []).map((x) => x.tableReference.tableId).find((id) => /^gcp_billing_export_v1_/.test(id));
      if (t) { found = `${projectId}.${datasetId}.${t}`; break; }
    }
  }
  if (!found) return { missing: true };
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(found)) throw new Error("BigQuery: nombre de tabla inválido");
  const query = "SELECT project.id AS project, currency, SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS total " +
    `FROM \`${found}\` WHERE invoice.month = @month GROUP BY 1, 2`;
  const r = await getJson(fetchFn, `${BQ_API}/projects/${projectId}/queries`, {
    method: "POST", headers,
    body: JSON.stringify({
      query, useLegacySql: false, timeoutMs: 60000, parameterMode: "NAMED",
      queryParameters: [{ name: "month", parameterType: { type: "STRING" }, parameterValue: { value: month.replace("-", "") } }],
    }),
  }, "BigQuery");
  if (r.jobComplete === false) throw new Error("BigQuery: la consulta no terminó a tiempo");
  const out = { amount: 0, currency: null, otherProjects: 0, table: found };
  for (const row of r.rows || []) {
    const [project, currency, total] = row.f.map((c) => c.v);
    if (out.currency && currency && out.currency !== currency) throw new Error(`BigQuery: monedas distintas (${out.currency} y ${currency})`);
    out.currency = currency || out.currency;
    if (project === projectId) out.amount += Number(total) || 0;
    else out.otherProjects += Number(total) || 0;
  }
  out.currency = out.currency || "USD";
  return out;
}

const toArs = (d, perUsd) => (d && Number.isFinite(Number(d.amount)) ? (d.currency === "ARS" ? Number(d.amount) : Number(d.amount) * perUsd) : null);

/**
 * Junta los costos automáticos de un mes. Lo que falla queda en errors y no pisa el último
 * dato bueno (prev). `deps`: { fetch, now, getToken } para las pruebas.
 */
async function collectAutoCosts({ month, prev = null, waConfig = null, neonApiKey = "", waToken = "", projectId = "", billingTable = null, deps = {} }) {
  const now = deps.now || Date.now();
  const f = deps.fetch || fetch;
  const p = prev || {};
  const errors = {};
  const soft = (what, promise) => promise.catch((err) => { errors[what] = err.message; return null; });
  const [fx, firebase, neon, waMeta] = await Promise.all([
    soft("fx", fetchDollar({ fetch: f })),
    projectId ? soft("firebase", firebaseMonthCost({ month, projectId, table: billingTable, fetch: f, getToken: deps.getToken })) : null,
    neonApiKey ? soft("neon", neonMonthCost({ apiKey: neonApiKey, month, now, fetch: f })) : (errors.neon = "falta el secreto NEON_API_KEY", null),
    waToken ? soft("waMeta", waMetaMonthCost({ token: waToken, month, now, fetch: f, wabaIds: deps.wabaIds })) : (errors.waMeta = "falta el token de WhatsApp", null),
  ]);
  if (firebase && firebase.missing) errors.firebase = "sin-exportacion";

  const detail = { ...(p.detail || {}) };
  const source = { ...(p.source || {}) };
  if (firebase && !firebase.missing) { detail.firebase = firebase; source.firebase = `BigQuery ${firebase.table}`; }
  if (neon) { detail.neon = neon; source.neon = "API de consumo de Neon"; }
  if (waMeta) { detail.waMeta = waMeta; source.waMeta = "Graph API de Meta (pricing_analytics)"; }
  const dollar = fx || p.fx || null;
  if (fx) source.fx = "dolarapi.com (dólar tarjeta)";
  source.fly = "costo fijo (fly.io no tiene API de facturación)";
  const perUsd = waSettings(waConfig, dollar).perUsd;
  return {
    firebase: toArs(detail.firebase, perUsd),
    neon: toArs(detail.neon, perUsd),
    fly: null,
    waMeta: toArs(detail.waMeta, perUsd),
    fx: dollar,
    source, detail, errors,
    at: new Date(now).toISOString(),
  };
}

/**
 * Costos fijos que se repiten cada mes (fly.io, dominio, certificado de ARCA…).
 * recurring = { clave: { label, service: "fly"|"other", currency: "ARS"|"USD", history: [{ from: "AAAA-MM", amount }] } }
 * Vale el último monto con from ≤ month; un monto 0 quiere decir que dejó de cobrarse.
 */
function recurringFor(recurring, month) {
  return Object.entries(recurring || {}).map(([key, r]) => {
    const h = (r.history || []).filter((e) => e.from <= month).sort((a, b) => a.from.localeCompare(b.from)).pop();
    return { key, label: r.label || key, service: r.service === "fly" ? "fly" : "other", currency: r.currency === "USD" ? "USD" : "ARS", amount: h ? Number(h.amount) || 0 : 0 };
  }).filter((r) => r.amount > 0);
}

/** Guarda los montos de `items` desde `month` en adelante; los que no vienen dejan de cobrarse desde ese mes. */
function applyRecurring(recurring, month, items) {
  const out = JSON.parse(JSON.stringify(recurring || {}));
  const seen = new Set();
  for (const it of items) {
    seen.add(it.key);
    const r = (out[it.key] = { ...(out[it.key] || {}), label: it.label, service: it.service, currency: it.currency, history: (out[it.key] && out[it.key].history) || [] });
    const current = recurringFor({ x: r }, month)[0];
    if (current && current.amount === it.amount) continue;
    r.history = r.history.filter((e) => e.from !== month).concat({ from: month, amount: it.amount });
  }
  for (const [key, r] of Object.entries(out)) {
    if (seen.has(key) || !recurringFor({ x: r }, month).length) continue;
    r.history = (r.history || []).filter((e) => e.from !== month).concat({ from: month, amount: 0 });
  }
  return out;
}

/**
 * Costo de cada servicio en el mes y de dónde sale: lo cargado a mano (corrección) gana,
 * después lo automático y por último los costos fijos recurrentes.
 */
function monthCosts(config, month) {
  const c = config || {};
  const auto = (c.autoCosts || {})[month] || null;
  const manual = (c.costs || {})[month] || {};
  const wa = waSettings(c.wa, auto && auto.fx);
  const fixed = recurringFor(c.recurring, month).map((r) => ({ ...r, ars: r.currency === "USD" ? r.amount * wa.perUsd : r.amount }));
  const fixedSum = (svc) => fixed.filter((r) => r.service === svc).reduce((s, r) => s + r.ars, 0);
  const detail = (auto && auto.detail) || {};
  const errors = (auto && auto.errors) || {};
  const pick = (svc, autoValue, fixedValue) => {
    const m = Number(manual[svc]);
    if (m > 0) return { value: m, source: "manual", auto: autoValue, fixed: fixedValue || 0 };
    if (autoValue != null) return { value: autoValue, source: "auto", at: auto.at, auto: autoValue };
    if (fixedValue > 0) return { value: fixedValue, source: "fijo", fixed: fixedValue };
    return { value: 0, source: null, error: errors[svc] || null };
  };
  const services = {
    neon: pick("neon", toArs(detail.neon, wa.perUsd)),
    firebase: pick("firebase", toArs(detail.firebase, wa.perUsd)),
    fly: pick("fly", null, fixedSum("fly")),
    other: pick("other", null, fixedSum("other")),
  };
  if (!services.firebase.error && errors.firebase && services.firebase.source !== "manual") services.firebase.error = errors.firebase;
  if (!services.neon.error && errors.neon && services.neon.source !== "manual") services.neon.error = errors.neon;
  const numbers = Object.fromEntries(Object.entries(services).map(([k, v]) => [k, v.value]));
  return {
    month, services, numbers, total: Object.values(numbers).reduce((s, v) => s + v, 0), fixed, wa,
    waMeta: detail.waMeta ? { ars: toArs(detail.waMeta, wa.perUsd), ...detail.waMeta } : null,
    autoAt: auto ? auto.at : null, autoFx: (auto && auto.fx) || null, errors,
  };
}

module.exports = {
  track, flush, monthUsage, storageBytesByTenant, allocate, monthKey, prevMonthKey, WA_DEFAULTS, waSettings, waMessages,
  NEON_PRICES, monthBounds, fetchDollar, neonMonthCost, waMetaMonthCost, firebaseMonthCost, collectAutoCosts,
  recurringFor, applyRecurring, monthCosts,
};
