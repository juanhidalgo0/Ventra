// ═══════════════════════════════════════════════════
// Menú del WhatsApp del dueño: "MENÚ" abre una lista desplegable con lo más usado.
//
// - "Ver" (ventas de hoy, cajas, deudas, qué reponer…): sale directo de la base, sin IA → al
//   instante y sin gastar preguntas.
// - "Hacer" (crear producto, cambiar precio, anotar fiado, cargar compra, promo…): el bot pide
//   los datos y lo que contesta el dueño va a la IA con esa intención; después confirma como
//   siempre con los botones.
// - La lista de WhatsApp tiene hasta 10 renglones: lo demás está en "Más opciones".
// - Escribir o mandar un audio sigue funcionando igual: el menú es un atajo.
// ═══════════════════════════════════════════════════
const insights = require("./insights-cloud");

/** Cuánto vale la elección de una opción "hacer" para interpretar lo que escribe después */
const INTENT_MS = 15 * 60 * 1000;
const MENU_RE = /^(?:menu|menú|el menu|el menú|opciones|ver opciones|inicio|que podes hacer|qué podés hacer|que puedo hacer|qué puedo hacer|ayuda)[.!?]*$/i;

const money = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "-" : ""}$ ${Math.abs(v).toLocaleString("es-AR")}`; };
const TZ = "America/Argentina/Buenos_Aires";
const today = (now = Date.now()) => new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
const daysAgo = (d, now = Date.now()) => today(now - d * 864e5);

/**
 * Opciones. kind: "ver" (respuesta directa) u "hacer" (pide datos y sigue con la IA).
 * write: solo el dueño (los encargados no las ven). plans: en qué planes aparece (sin plans: con caja).
 */
const OPTIONS = {
  // Ventas y caja
  ventas_hoy: { title: "Ventas de hoy", description: "Total, tickets y medios de pago", kind: "ver" },
  ultimas_ventas: { title: "Últimas ventas", description: "Las 10 últimas, con cajero y productos", kind: "ver" },
  cajas: { title: "Cajas", description: "Abiertas ahora y últimos cierres con diferencias", kind: "ver" },
  // Productos
  crear_producto: { title: "Crear producto", description: "Lo doy de alta con precio, costo y código", kind: "hacer", write: true,
    ask: "Dale. Decime el *nombre*, el *precio de venta* y, si querés, el *costo*, el *código de barras* y la *categoría*.\n\nPor ejemplo: _Alfajor Jorgito triple, 1200, costo 700, código 7790040613102_" },
  cambiar_precio: { title: "Cambiar precio o costo", description: "De un producto, varios o una categoría", kind: "hacer", write: true,
    ask: "¿Qué producto y a cuánto? También podés cambiar el costo o subir un porcentaje.\n\nPor ejemplo: _Coca 1,5 a 2800_ · _subí 10% las gaseosas_ · _el costo del Fernet es 15000_" },
  reponer: { title: "Qué reponer", description: "Productos sin stock o en el mínimo", kind: "ver" },
  // Clientes y proveedores
  deudas: { title: "Deudas de clientes", description: "Quién te debe y cuánto", kind: "ver" },
  fiado: { title: "Anotar fiado o pago", description: "En la cuenta corriente de un cliente", kind: "hacer", write: true,
    ask: "¿A quién y cuánto? Decime si es *fiado* (deuda) o *pago*.\n\nPor ejemplo: _fiado a Don Tito 3000 por un Fernet_ · _Marta pagó 5000_" },
  // Promos
  promo: { title: "Promo o imagen", description: "Crear una promo o combo y su imagen", kind: "hacer", write: true,
    ask: "¿Qué promo armamos? Decime los productos y el precio (y hasta cuándo, si querés). Te puedo armar la promo en Ventra, la imagen para publicar, o las dos.\n\nPor ejemplo: _combo Fernet Branca 750 + Coca 2,25 a 22900 hasta el domingo_" },
  mas: { title: "Más opciones", description: "Compras, resumen, vencimientos y más", kind: "submenu" },
  // Más opciones
  resumen: { title: "Resumen del día", description: "Ventas, comparación y control de caja", kind: "ver" },
  mas_vendidos: { title: "Lo más vendido", description: "De los últimos 7 días", kind: "ver" },
  compra: { title: "Cargar una compra", description: "Foto de la boleta o escribime qué llegó", kind: "hacer", write: true,
    ask: "Mandame una *foto de la boleta o factura* del proveedor y la leo yo (la próxima vez que me mandes una foto, la tomo como boleta).\n\nO escribime qué llegó: _de Distribuidora Sur: 24 Coca 2,25 a 3800 y 12 Sprite 1,5 a 2100_" },
  repetidos: { title: "Productos repetidos", description: "Revisar y juntar los que están dos veces", kind: "special", write: true },
  stock: { title: "Ajustar stock", description: "Sumar o descontar unidades de un producto", kind: "hacer", write: true,
    ask: "¿De qué producto y cuántas unidades sumo o descuento?\n\nPor ejemplo: _sumá 12 Coca 1,5_ · _descontá 2 alfajores rotos_" },
  vencimientos: { title: "Vencimientos", description: "Lo que vence en los próximos 15 días", kind: "ver" },
  encargos: { title: "Encargos", description: "Para hoy, atrasados y por cobrar", kind: "ver" },
  gasto: { title: "Anotar un gasto", description: "Sale plata de la caja (hielo, flete…)", kind: "hacer", write: true,
    ask: "¿Qué gasto y de cuánto? Si tenés más de una caja abierta, decime de cuál.\n\nPor ejemplo: _gasto de hielo 2000_" },
  otra_cosa: { title: "Otra cosa", description: "Cualquier cosa que hagas en Ventra", kind: "hacer", write: true,
    ask: "Contame qué querés hacer, con tus palabras (o mandame un audio). Puedo hacer casi todo lo que hacés en Ventra: clientes, proveedores, presupuestos, usuarios, ajustes, GO Delivery…" },
  // Agenda
  turnos_hoy: { title: "Turnos de hoy", description: "Quién viene y a qué hora", kind: "ver", plans: ["agenda", "agenda_pro", "tienda", "*"] },
  turnos_manana: { title: "Turnos de mañana", description: "La agenda de mañana", kind: "ver", plans: ["agenda", "agenda_pro", "tienda", "*"] },
};

const hasCaja = (plan) => !["agenda", "agenda_pro"].includes(plan);

/** Las secciones de la lista para este plan y este rol (como mucho 10 renglones) */
function sections({ plan, role, page = "main" }) {
  const can = (id) => {
    const o = OPTIONS[id];
    if (!o) return false;
    if (o.write && role === "SUPERVISOR") return false;
    return true;
  };
  const row = (id) => ({ id: `m|${id}`, title: OPTIONS[id].title, description: OPTIONS[id].description });
  const build = (groups) => groups.map(([title, ids]) => ({ title, rows: ids.filter(can).map(row) })).filter((s) => s.rows.length);
  if (!hasCaja(plan)) return build([["Agenda", ["turnos_hoy", "turnos_manana"]], ["Más", ["otra_cosa"]]]);
  if (page === "mas") {
    return build([
      ["Más para ver", ["resumen", "mas_vendidos", "vencimientos", "encargos", ...(plan === "tienda" ? ["turnos_hoy"] : [])]],
      ["Más para hacer", ["compra", "repetidos", "stock", "gasto", "otra_cosa"]],
    ]);
  }
  return build([
    ["Ventas y caja", ["ventas_hoy", "ultimas_ventas", "cajas"]],
    ["Productos", ["crear_producto", "cambiar_precio", "reponer"]],
    ["Clientes", ["deudas", "fiado"]],
    ["Promos y más", ["promo", "mas"]],
  ]);
}

const MENU_TEXT = "¿Qué hacemos? Elegí una opción. También podés escribirme o mandarme un audio con lo que necesites.";

// ── Respuestas al instante (sin IA) ──
const one = async (sql, uid, q, opts) => (await insights.runQueries(sql, uid, [q], null, opts))[0] || {};
const lines = (arr) => arr.filter(Boolean).join("\n");
const cut = (list, n) => (list.length > n ? [...list.slice(0, n), `_…y ${list.length - n} más_`] : list);

const QUICK = {
  async ventas_hoy(sql, uid, { now }) {
    const d = today(now);
    const [r, m] = await Promise.all([one(sql, uid, { tipo: "ventas", desde: d, hasta: d }), one(sql, uid, { tipo: "ventas", desde: d, hasta: d, agrupar: "medio_de_pago" })]);
    if (r.error) return r.error;
    if (!r.ventas) return "Hoy todavía no hay ventas registradas.";
    return lines([`*Ventas de hoy: ${money(r.total)}* en ${r.ventas} ${r.ventas === 1 ? "ticket" : "tickets"} (promedio ${money(r.ticketPromedio)}).`,
      ...(m.porMedioDePago || []).map((x) => `- ${x.medio}: ${money(x.monto)}`)]);
  },
  async ultimas_ventas(sql, uid) {
    const r = await one(sql, uid, { tipo: "ultimas_ventas", limite: 10 });
    const list = r.ventas || r.ultimas || [];
    if (!list.length) return r.error || "No hay ventas registradas.";
    return lines(["*Últimas ventas*", ...list.slice(0, 10).map((s) => `- ${s.hora}${s.venta ? ` · N° ${s.venta}` : ""} · *${money(s.total)}*${s.cajero ? ` · ${s.cajero}` : ""}${s.productos && s.productos.length ? `\n  ${s.productos.slice(0, 3).join(", ")}${s.productos.length > 3 ? "…" : ""}` : ""}`)]);
  },
  async cajas(sql, uid) {
    const r = await one(sql, uid, { tipo: "caja" });
    if (r.error) return r.error;
    const open = (r.cajasAbiertas || []).map((c) => `- *${c.caja || "Caja"}*${c.cajero ? ` (${c.cajero})` : ""}, abierta desde ${c.abiertaDesde}: vendió ${money(c.vendido)} en ${c.ventas}; debería haber ${money(c.efectivoQueDeberiaHaber)} en efectivo`);
    const closed = (r.ultimosCierres || []).map((c) => `- ${c.caja || "Caja"}${c.cajero ? ` (${c.cajero})` : ""}, ${c.cerrada}: ${c.diferencia === null ? "sin arqueo" : c.diferencia === 0 ? "sin diferencia ✅" : `diferencia *${c.diferencia > 0 ? "+" : ""}${money(c.diferencia)}*`}`);
    return lines([open.length ? "*Cajas abiertas*" : "No hay cajas abiertas ahora.", ...open, closed.length ? "\n*Últimos cierres*" : "", ...closed]);
  },
  async reponer(sql, uid) {
    const r = await one(sql, uid, { tipo: "stock_bajo" });
    if (r.error) return r.error;
    if (!r.productos || !r.productos.length) return "No hay nada para reponer: todo tiene stock por encima del mínimo. ✅";
    return lines([`*${r.sinStock} sin stock* y *${r.enElMinimo} en el mínimo*.`, ...cut(r.productos.map((p) => `- ${p.producto}: ${p.stock}${p.minimo ? ` (mín. ${p.minimo})` : ""}`), 15)]);
  },
  async deudas(sql, uid) {
    const r = await one(sql, uid, { tipo: "deudores", limite: 15 });
    if (r.error) return r.error;
    if (!r.clientesQueDeben) return "Nadie te debe plata en cuenta corriente. ✅";
    return lines([`*Te deben ${money(r.totalAdeudado)}* entre ${r.clientesQueDeben} ${r.clientesQueDeben === 1 ? "cliente" : "clientes"}.`,
      ...cut(r.clientes.map((c) => `- ${c.cliente}: *${money(c.debe)}*${c.pasoElLimite ? " ⚠️ pasó su límite" : ""}`), 15)]);
  },
  async mas_vendidos(sql, uid, { now }) {
    const r = await one(sql, uid, { tipo: "productos", desde: daysAgo(6, now), hasta: today(now), orden: "unidades", limite: 10 });
    if (r.error) return r.error;
    if (!r.productos || !r.productos.length) return "No hubo ventas en los últimos 7 días.";
    return lines(["*Lo más vendido (7 días)*", ...r.productos.map((p, i) => `${i + 1}. ${p.producto}: ${p.unidades} u · ${money(p.vendido)}`)]);
  },
  async vencimientos(sql, uid) {
    const r = await one(sql, uid, { tipo: "vencimientos", dias: 15 });
    if (r.error) return r.error;
    if (!r.lotes || !r.lotes.length) return "No hay nada que venza en los próximos 15 días. ✅";
    return lines([`*${r.vencidos} vencidos* y *${r.porVencer} por vencer* (15 días).`, ...cut(r.lotes.map((l) => `- ${l.producto} × ${l.cantidad}: ${l.yaVencido ? "*venció*" : "vence"} ${l.vence.split("-").reverse().slice(0, 2).join("/")}`), 15)]);
  },
  async encargos(sql, uid) {
    const r = await one(sql, uid, { tipo: "encargos" });
    if (r.error) return r.error;
    if (!r.abiertos) return "No hay encargos abiertos.";
    return lines([`*${r.abiertos} encargos abiertos*: ${r.paraHoy} para hoy, ${r.atrasados} atrasados, ${r.listosParaEntregar} listos. Falta cobrar ${money(r.porCobrar)}.`,
      ...cut(r.encargos.map((w) => `- N° ${w.encargo}${w.cliente ? ` · ${w.cliente}` : ""} · ${w.estado}${w.entrega ? ` · entrega ${w.entrega.split("-").reverse().slice(0, 2).join("/")}` : ""}${w.atrasado ? " ⚠️" : ""}${w.falta > 0 ? ` · falta ${money(w.falta)}` : ""}`), 10)]);
  },
  async turnos_hoy(sql, uid, { db, now }) { return turnos(sql, uid, db, today(now), "hoy"); },
  async turnos_manana(sql, uid, { db, now }) { return turnos(sql, uid, db, today(now + 864e5), "mañana"); },
};

async function turnos(sql, uid, db, day, label) {
  const r = await one(sql, uid, { tipo: "turnos", desde: day, hasta: day }, { db });
  if (r.error) return r.error;
  if (!r.turnos) return `No hay turnos para ${label}.`;
  return lines([`*${r.turnos} ${r.turnos === 1 ? "turno" : "turnos"} ${label}*${r.cancelados ? ` (${r.cancelados} cancelados)` : ""}`,
    ...cut(r.detalle.filter((b) => b.estado !== "cancelado").map((b) => `- ${b.hora} · ${b.cliente || "Sin nombre"}${b.servicio ? ` · ${b.servicio}` : ""}${b.profesional ? ` (${b.profesional})` : ""}${b.estado !== "confirmado" ? ` · _${b.estado}_` : ""}`), 20)]);
}

/** Respuesta al instante de una opción "ver". deps: { sql, db, summaryText? } */
async function quick(id, { sql, db, uid, role, now = Date.now(), summaryText }) {
  if (id === "resumen" && summaryText) return (await summaryText(sql, uid, now, role !== "SUPERVISOR")).text;
  const fn = QUICK[id];
  if (!fn) return null;
  return fn(sql, uid, { db, now });
}

/** El texto que se manda a la IA cuando el dueño contesta después de elegir una opción "hacer" */
function withIntent(intent, text) {
  const o = OPTIONS[intent];
  return o && o.kind === "hacer" && intent !== "otra_cosa" ? `[Eligió en el menú: ${o.title}] ${text}` : text;
}

module.exports = { OPTIONS, sections, quick, withIntent, MENU_RE, MENU_TEXT, INTENT_MS };
