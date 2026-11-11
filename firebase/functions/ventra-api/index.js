// ═══════════════════════════════════════════════════
// El bot de WhatsApp del dueño hace cualquier cosa del sistema, como si la hiciera a mano.
//
// - Las operaciones salen de catalog.json (scripts/gen-bot-catalog.js lee los controladores del
//   backend): método, ruta, descripción y el código que la atiende.
// - Se ejecutan en la caja en la nube del comercio (apps/cloud-host/bot-gateway.js): la misma
//   lógica que la pantalla, y los cambios llegan a las PCs por la sincronización de siempre.
// - Herramientas de la IA (solo el dueño, solo WhatsApp):
//     buscar_operacion  qué operaciones hay para lo que pide
//     ver_operacion     el detalle (qué datos pide, qué hace) antes de usarla
//     consultar         lee datos (GET): se ejecuta enseguida
//     operar            cambia algo: NO se ejecuta; el dueño confirma con un botón
// - Lo protegido (login, contraseñas, sincronización, sistema, suscripción, archivos) no se ofrece.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");

const OPS = "ventra_wa_owner_ops";
const PENDING_MS = 30 * 60 * 1000;
const MAX_RESULT = 9000;
const HOST_URL = process.env.VENTRA_CLOUD_URL || "https://web.ventra.store";
/** Operaciones que no se pueden deshacer: se avisa en la confirmación */
const IRREVERSIBLE = [/^DELETE /, /^POST \/api\/fiscal\//, /^POST \/api\/cash\/[^/]+\/close/, /^POST \/api\/sales\/[^/]+\/(cancel|void|refund)/];

let catalog = null;
const loadCatalog = () => catalog || (catalog = require("./catalog.json"));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9/:. ]+/g, " ").replace(/\s+/g, " ").trim();

// Temas en castellano → el recurso del sistema (/api/<recurso>)
const TOPICS = {
  caja: "cash", cajas: "cash", arqueo: "cash", gasto: "cash", gastos: "cash", retiro: "cash", efectivo: "cash",
  cliente: "clients", clientes: "clients", deuda: "clients", deudas: "clients", debe: "clients", deben: "clients", debo: "clients", fiado: "clients", cuenta: "clients", saldo: "clients",
  proveedor: "suppliers", proveedores: "suppliers", compra: "purchases", compras: "purchases", mercaderia: "purchases", factura_proveedor: "purchases",
  producto: "products", productos: "products", precio: "products", precios: "products", stock: "products", articulo: "products", articulos: "products",
  categoria: "categories", categorias: "categories", rubro: "categories", marca: "brands", marcas: "brands",
  promo: "promotions", promos: "promotions", promocion: "promotions", promociones: "promotions", combo: "promotions", oferta: "promotions",
  venta: "sales", ventas: "sales", ticket: "sales", factura: "fiscal", facturar: "fiscal", afip: "fiscal", arca: "fiscal", comprobante: "fiscal",
  presupuesto: "quotes", presupuestos: "quotes", encargo: "work-orders", encargos: "work-orders", trabajo: "work-orders", orden: "work-orders",
  pedido: "preorders", pedidos: "preorders", reparto: "delivery-runs", repartos: "delivery-runs", recorrido: "delivery-runs", chofer: "delivery-runs",
  recargo: "surcharges", recargos: "surcharges", usuario: "users", usuarios: "users", empleado: "users", empleados: "users", cajero: "users", cajera: "users", encargado: "users",
  acopio: "acopio", go: "go", delivery: "go", ajuste: "settings", ajustes: "settings", configuracion: "settings", marketing: "marketing", lista: "marketing",
  mercadopago: "mercadopago", qr: "mercadopago", transferencia: "mercadopago",
};
// Palabras que apuntan a partes de una ruta (no al recurso)
const HINTS = {
  abrir: "open", cerrar: "close", cierre: "close", arqueo: "arqueo", deuda: "movement", fiado: "movement", pago: "movement", pagar: "movement payment",
  stock: "movement stock", vencimiento: "lots expiring", vence: "lots expiring", lote: "lots", anular: "cancel void", devolver: "refund return",
  pausar: "pause", pausa: "pause", abierto: "open status", cerrado: "close status", publicar: "publish", despublicar: "unpublish",
  favorito: "favorite", codigo: "barcode", etiqueta: "label", imprimir: "print", foto: "image", gasto: "movement expense", retiro: "movement withdrawal",
};
// Qué método busca cada verbo
const INTENT = {
  crear: "POST", nuevo: "POST", nueva: "POST", alta: "POST", agregar: "POST", agrega: "POST", sumar: "POST", cargar: "POST", carga: "POST", anotar: "POST", anotale: "POST", registrar: "POST", abrir: "POST", cerrar: "POST", anular: "POST", hacer: "POST",
  cambiar: "PATCH", cambia: "PATCH", modificar: "PATCH", editar: "PATCH", actualizar: "PATCH", poner: "PATCH", ponele: "PATCH", renombrar: "PATCH", pausar: "PATCH",
  borrar: "DELETE", borra: "DELETE", eliminar: "DELETE", sacar: "DELETE", quitar: "DELETE",
  ver: "GET", mostrar: "GET", listar: "GET", buscar: "GET", cuanto: "GET", cuantos: "GET", cuales: "GET", quien: "GET", que: "GET",
};
const BULK = /(reset|unpublish|publish|delete|clear)-all|bulk|import|round-prices|all$/;

/** Las operaciones que puede usar el bot */
const usable = () => loadCatalog().entries.filter((e) => !e.blocked);

function search(text, limit = 8) {
  const words = norm(text).split(" ").filter((w) => w.length > 1);
  const topics = new Set(words.map((w) => TOPICS[w]).filter(Boolean));
  const hints = [...new Set(words.flatMap((w) => (HINTS[w] || "").split(" ").filter(Boolean)))];
  const intents = new Set(words.map((w) => INTENT[w]).filter(Boolean));
  const writing = [...intents].some((m) => m !== "GET");
  const bulk = words.some((w) => ["todo", "todos", "todas", "masivo"].includes(w));
  const scored = usable().map((e) => {
    const resource = e.path.split("/")[2];
    const rest = norm(e.path.split("/").slice(3).join(" ") + " " + e.name);
    const desc = norm(e.description || "");
    let s = 0;
    if (topics.has(resource)) s += 8;
    for (const h of hints) if (rest.includes(h)) s += 4;
    for (const w of words) { if (rest.includes(w)) s += 2; if (desc.includes(w)) s += 1.5; }
    if (intents.has(e.method) || (intents.has("PATCH") && e.method === "PUT")) s += 3;
    else if (writing && e.method === "GET") s -= 2;
    if (!bulk && BULK.test(e.path)) s -= 6;
    // Lo básico de cada recurso primero (crear, editar, ver uno) sobre lo raro
    if (topics.has(resource) && /^\/api\/[^/]+(\/:id)?$/.test(e.path)) s += 4;
    return { e, s };
  }).filter((x) => x.s > 2).sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map(({ e }) => ({ id: e.id, que_hace: e.description || e.name, datos: e.body, filtros: e.query.length ? e.query : undefined }));
}

function detail(id) {
  const e = loadCatalog().entries.find((x) => x.id === String(id || "").trim());
  if (!e) return { error: "No existe esa operación. Buscala con buscar_operacion." };
  if (e.blocked) return { error: e.blocked === "archivo" ? "Esa operación necesita subir un archivo: por WhatsApp no se puede, que la haga desde Ventra." : "Esa operación está protegida y no se puede hacer por WhatsApp." };
  return { id: e.id, metodo: e.method, ruta: e.path, parametros_de_la_ruta: e.params, filtros: e.query, datos: e.body, solo_para: e.roles, codigo: e.code };
}

/** "PATCH /api/products/:id" + { id: "x" } → "/api/products/x" */
function fillPath(template, params = {}) {
  let missing = null;
  const out = template.replace(/:(\w+)/g, (m, k) => {
    if (params[k] === undefined || params[k] === null || params[k] === "") { missing = k; return m; }
    return encodeURIComponent(String(params[k]));
  });
  return missing ? { error: `Falta ${missing} para ${template}` } : { path: out };
}

/** El cliente que habla con el anfitrión de cajas en la nube */
function client({ secret, url = HOST_URL, fetchImpl = fetch }) {
  return {
    async call(uid, calls, { provision = true } = {}) {
      const r = await fetchImpl(`${url}/_ventra/bot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cloud-secret": secret },
        body: JSON.stringify({ uid, calls, provision }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data.error || `La caja en la nube respondió ${r.status}`), { status: r.status, preparing: !!data.preparing });
      return data.results;
    },
  };
}

const trim = (v) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > MAX_RESULT ? `${t.slice(0, MAX_RESULT)}…(recortado: pedí con filtros para ver menos)` : t; };
/** El mensaje de error de Nest/Ventra en una respuesta */
const errorOf = (r) => (r && r.body && (Array.isArray(r.body.message) ? r.body.message.join(". ") : r.body.message || r.body.error)) || (typeof (r && r.body) === "string" ? r.body.slice(0, 300) : `error ${r && r.status}`);

const TOOLS = [
  { name: "buscar_operacion", description: "Busca en el sistema Ventra las operaciones que sirven para lo que pide el dueño (todo lo que se puede hacer a mano: caja, ventas, clientes y cuentas corrientes, proveedores, compras, stock, productos, categorías, promociones, presupuestos, encargos, pedidos, reparto, facturación, usuarios, ajustes, GO Delivery). texto: lo que quiere hacer, con sus palabras.", input_schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"], additionalProperties: false } },
  { name: "ver_operacion", description: "El detalle de una operación (id de buscar_operacion): qué datos pide y el código que la atiende, para armar bien los datos. Usala siempre antes de operar.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "consultar", description: "Lee datos del sistema con una operación GET (buscar el id de un cliente, ver una venta, listar productos con un filtro). Se ejecuta enseguida. id: la operación; parametros: los :xxx de la ruta; filtros: los de la operación.", input_schema: { type: "object", properties: { id: { type: "string" }, parametros: { type: "object" }, filtros: { type: "object" } }, required: ["id"], additionalProperties: false } },
  { name: "operar", description: "Prepara una operación que cambia algo (POST, PATCH, PUT, DELETE). NO se ejecuta: el sistema le manda al dueño el resumen con botones para confirmar. id: la operación; parametros: los :xxx de la ruta; datos: el cuerpo, exactamente con los nombres de campos del código; resumen: en castellano, qué va a pasar, con los valores (ej. 'Abrir la caja \"Caja 1\" con $ 5.000 de cambio').", input_schema: { type: "object", properties: { id: { type: "string" }, parametros: { type: "object" }, datos: { type: "object" }, resumen: { type: "string" } }, required: ["id", "resumen"], additionalProperties: false } },
];

const SYSTEM_NOTE = `- Todo el sistema Ventra: con buscar_operacion, ver_operacion, consultar y operar podés hacer cualquier cosa que el dueño haría a mano. Primero usá las herramientas específicas si sirven (precios y costos con cambiar_productos, imágenes con crear_imagen, preguntas de ventas con las de consulta). Si no: buscá la operación, mirá su detalle, conseguí los ids que falten con consultar (nunca inventes un id) y recién ahí usá operar con los datos exactos que pide el código. operar no ejecuta: el dueño confirma con un botón. Cuando operar devuelve listo, respondé solo una oración corta. Si algo no se puede por WhatsApp (subir archivos, contraseñas), decíselo y que lo haga desde Ventra.`;

/**
 * Para una pregunta: las herramientas y la operación que quedó para confirmar (session.op).
 * deps: { api (client), uid }
 */
function session({ api, uid }) {
  const s = {
    tools: TOOLS,
    systemNote: SYSTEM_NOTE,
    rounds: 9,
    op: null,
    async call(name, input = {}) {
      if (name === "buscar_operacion") return { operaciones: search(input.texto) };
      if (name === "ver_operacion") return detail(input.id);
      const e = loadCatalog().entries.find((x) => x.id === String(input.id || "").trim());
      if (!e) return { error: "No existe esa operación. Buscala con buscar_operacion." };
      if (e.blocked) return detail(e.id);
      const filled = fillPath(e.path, input.parametros || {});
      if (filled.error) return { error: filled.error };
      if (name === "consultar") {
        if (e.method !== "GET") return { error: "consultar es solo para leer (GET). Para cambiar algo usá operar." };
        try {
          const [r] = await api.call(uid, [{ method: "GET", path: filled.path, query: input.filtros || {} }]);
          return r.status < 300 ? { resultado: trim(r.body) } : { error: errorOf(r) };
        } catch (err) {
          return { error: err.message, ...(err.preparing ? { preparando: true } : {}) };
        }
      }
      if (name === "operar") {
        if (e.method === "GET") return { error: "Esa operación solo lee: usá consultar." };
        s.op = { id: e.id, method: e.method, path: filled.path, body: input.datos || {}, summary: String(input.resumen || "").slice(0, 600), irreversible: IRREVERSIBLE.some((re) => re.test(`${e.method} ${e.path}`)) };
        return { listo: true, aviso: "El sistema le manda al dueño el resumen con los botones. Respondé solo una oración corta." };
      }
      return { error: "Herramienta desconocida" };
    },
  };
  return s;
}

/** Texto de la confirmación (cuerpo del mensaje con botones) */
function confirmText(op, prefix = "") {
  return `${prefix}Revisá antes de confirmar:\n\n${op.summary}${op.irreversible ? "\n\n⚠️ *Esto no se puede deshacer.*" : ""}\n\nLo hago en tu caja en la nube y llega a todas las cajas. La propuesta vale 30 minutos.`.slice(0, 1024);
}

async function save(db, { uid, from, op }, now = Date.now()) {
  const id = `${now.toString(36)}${crypto.randomBytes(4).toString("hex")}`;
  await db.collection(OPS).doc(id).set({ uid, from, ...op, status: "pending", createdAt: now });
  return id;
}

/** Un resumen corto de lo que devolvió la operación (número, nombre, total) */
function resultNote(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const parts = [];
  for (const [k, label] of [["number", "N°"], ["saleNumber", "N°"], ["name", ""], ["fullName", ""], ["total", "total $"], ["balance", "saldo $"]]) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== "") parts.push(`${label}${label && !label.endsWith("$") ? " " : ""}${typeof body[k] === "number" && label.endsWith("$") ? Math.round(body[k]).toLocaleString("es-AR") : body[k]}`);
    if (parts.length >= 2) break;
  }
  return parts.length ? ` (${parts.join(" · ")})` : "";
}

/** Confirmar o cancelar. Devuelve { text } */
async function act(db, api, { action, id, from, uid }, now = Date.now()) {
  const ref = db.collection(OPS).doc(String(id || ""));
  const snap = await ref.get();
  if (!snap.exists) return { text: "No encontré esa operación. Pedímela de nuevo." };
  const op = snap.data();
  if (op.uid !== uid || op.from !== from) return { text: "Esa operación no es tuya." };
  if (action === "no") {
    if (op.status !== "pending") return { text: "Esa operación ya no está pendiente." };
    await ref.set({ status: "cancelled", doneAt: now }, { merge: true });
    return { text: "Listo, no hice nada." };
  }
  if (op.status === "done") return { text: "Esa operación ya está hecha." };
  if (op.status !== "pending") return { text: "Esa operación ya no está pendiente. Si la querés, pedímela de nuevo." };
  if (now - Number(op.createdAt || 0) > PENDING_MS) {
    await ref.set({ status: "expired" }, { merge: true });
    return { text: "Pasaron más de 30 minutos: pedímela de nuevo así la reviso con los datos de ahora." };
  }
  await ref.set({ status: "running" }, { merge: true });
  try {
    const [r] = await api.call(uid, [{ method: op.method, path: op.path, body: op.body }]);
    if (r.status >= 300) {
      await ref.set({ status: "failed", error: errorOf(r), doneAt: now }, { merge: true });
      return { text: `No se pudo: ${errorOf(r)}` };
    }
    await ref.set({ status: "done", doneAt: now, result: trim(r.body).slice(0, 2000) }, { merge: true });
    return { text: `✅ Listo: ${op.summary}${resultNote(r.body)}` };
  } catch (err) {
    await ref.set({ status: err.preparing ? "pending" : "failed", error: err.message }, { merge: true });
    return { text: err.preparing ? `${err.message} Cuando esté lista, tocá *Confirmar* de nuevo.` : `No se pudo: ${err.message}` };
  }
}

module.exports = { TOOLS, SYSTEM_NOTE, OPS, PENDING_MS, client, session, search, detail, fillPath, confirmText, save, act, errorOf, loadCatalog };
