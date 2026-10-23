// ═══════════════════════════════════════════════════
// IA para los comercios (ventraAi): la usa la PC vinculada a través de su backend.
//
//  - "order":   el texto (o la foto) de un pedido que mandó un cliente por WhatsApp →
//               renglones del catálogo del comercio (producto, bulto o unidad, cantidad).
//  - "invoice": las fotos de una factura de compra → proveedor, número, fecha y renglones
//               (mismo formato que ya usaba el lector de boletas de la caja).
//
// La clave de Claude vive solo acá (secreto VENTRA_ANTHROPIC_KEY): las PCs nunca la ven.
// Cada comercio tiene un tope de usos por mes (LIMITS) para que el costo no se dispare;
// el uso y el costo quedan en ventra_ai_usage/{AAAA-MM}_{uid}.
// La IA solo arma la lista: precios y stock los pone el sistema, y todo pasa por revisión.
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");

const anthropicClient = (opts) => { const SDK = require("@anthropic-ai/sdk"); return new (SDK.default || SDK)(opts); };

const MODEL = "claude-haiku-5-5";
const LIMITS = { order: 300, invoice: 60 };
// Haiku 5.5: $0,10 / $0,50 por millón (entrada / salida); cache: escritura 1,25x, lectura 0,1x
const costOf = (u) => ((u.input_tokens || 0) * 0.1 + (u.cache_creation_input_tokens || 0) * 0.125
  + (u.cache_read_input_tokens || 0) * 0.01 + (u.output_tokens || 0) * 0.5) / 1e6;

const TZ = "America/Argentina/Buenos_Aires";
const monthKey = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);

class AiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_B64 = 7_000_000; // ~5 MB por foto
function imageBlocks(images) {
  return (Array.isArray(images) ? images : []).slice(0, 6).map((im) => {
    const mediaType = String(im && im.mediaType || "image/jpeg").toLowerCase();
    const data = String(im && im.data || "").replace(/^data:[^,]+,/, "");
    if (!IMAGE_TYPES.includes(mediaType)) throw new AiError(400, "BAD_IMAGE", "La foto tiene que ser JPG, PNG o WEBP.");
    if (!data || data.length > MAX_IMAGE_B64) throw new AiError(400, "BAD_IMAGE", "La foto es muy pesada: sacala de nuevo o mandá una más chica.");
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  });
}

const textOf = (msg) => (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");

// ─── Pedido de WhatsApp ───

const ORDER_SYSTEM = `Sos el asistente de una distribuidora o comercio de Argentina. Recibís el mensaje con el que un cliente hizo su pedido (texto copiado de WhatsApp o la foto de una lista, a veces escrita a mano) y el catálogo del comercio.

Tu trabajo es armar la lista del pedido con los productos DEL CATÁLOGO:
- Por cada cosa que pide el cliente, buscá el producto del catálogo que corresponde (por nombre, marca, tamaño, sabor). Usá el "id" del catálogo.
- Si pide por caja, bulto, pack, fardo, docena de packs o similar y el producto tiene bulto ("bulto": N), la unidad es "bulto". Si pide unidades sueltas, la unidad es "unidad". Si no dice y el producto tiene bulto, en una distribuidora suele ser por bulto: usá "bulto" con confianza "media".
- Si pide algo que no está en el catálogo o no estás seguro de cuál es, dejá productId vacío ("") y explicá en "nota" qué pidió. Si dudás entre dos, elegí el más probable con confianza "baja".
- "Lo de siempre", "lo mismo que la otra vez" y parecidos no los podés resolver: ponelos como renglón con productId vacío.
- Las cantidades son números ("media docena" = 6, "un par" = 2). Si no dice cantidad, 1.
- No inventes productos ni precios. No agregues nada que el cliente no pidió.
- "cliente": el nombre del comercio o la persona si aparece en el mensaje (si no, vacío). "aclaracion": horarios, dirección o pedidos especiales que no son productos (si no hay, vacío).`;

const ORDER_SCHEMA = {
  type: "object",
  properties: {
    cliente: { type: "string" },
    aclaracion: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productId: { type: "string", description: "id del catálogo, o vacío si no está" },
          pedido: { type: "string", description: "Lo que escribió el cliente para este renglón" },
          cantidad: { type: "number" },
          unidad: { type: "string", enum: ["bulto", "unidad"] },
          confianza: { type: "string", enum: ["alta", "media", "baja"] },
          nota: { type: "string" },
        },
        required: ["productId", "pedido", "cantidad", "unidad", "confianza", "nota"],
        additionalProperties: false,
      },
    },
  },
  required: ["cliente", "aclaracion", "items"],
  additionalProperties: false,
};

function catalogText(catalog) {
  // Compacto: una línea por producto. Va primero y cacheado: el mismo comercio repite catálogo
  return (Array.isArray(catalog) ? catalog : []).slice(0, 4000).map((p) => {
    const pack = Number(p && p.pack) > 1 ? `, "bulto": ${Math.round(Number(p.pack))}` : "";
    return `{"id": ${JSON.stringify(String(p && p.id || ""))}, "nombre": ${JSON.stringify(String(p && p.name || "").slice(0, 120))}${pack}}`;
  }).join("\n");
}

async function parseOrder(client, body) {
  const text = String(body.text || "").slice(0, 6000).trim();
  const images = imageBlocks(body.images);
  if (!text && !images.length) throw new AiError(400, "EMPTY", "Pegá el mensaje del cliente o subí la foto del pedido.");
  const ids = new Set((body.catalog || []).map((p) => String(p && p.id || "")));
  if (!ids.size) throw new AiError(400, "NO_CATALOG", "No hay productos cargados para buscar.");
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: ORDER_SCHEMA } },
    system: ORDER_SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Catálogo del comercio (un producto por línea):\n${catalogText(body.catalog)}`, cache_control: { type: "ephemeral" } },
        ...images,
        { type: "text", text: text ? `Mensaje del cliente:\n${text}` : "El pedido está en la foto." },
      ],
    }],
  });
  if (msg.stop_reason === "refusal") throw new AiError(422, "REFUSED", "No se pudo leer ese pedido. Cargalo a mano.");
  let out;
  try { out = JSON.parse(textOf(msg)); } catch { throw new AiError(502, "BAD_OUTPUT", "No se pudo leer el pedido. Probá de nuevo."); }
  // Un id que no es del catálogo no vale: queda como "no encontrado"
  out.items = (out.items || []).map((it) => (it.productId && ids.has(String(it.productId)) ? it : { ...it, productId: null, confianza: it.productId ? "baja" : it.confianza }));
  return { result: out, usage: msg.usage || {} };
}

// ─── Factura de compra por foto ───

const INVOICE_PROMPT = `Sos experto en leer comprobantes de compra de Argentina (facturas impresas, tickets de mayorista o notas escritas a mano). Extraé la lista completa de los productos físicos comprados.

Primero transcribí la tabla de artículos en markdown (columnas: ARTICULO/SKU, CANTIDAD, U.B., DESCRIPCION, PRECIO UNITARIO, TOTAL) para alinear cada fila. Después extraé cada artículo.

Reglas:
1. Extraé TODOS los productos que tengan cantidad y total, sean 2 o 50 filas.
2. Si está escrito a mano, transcribí lo mejor posible.
3. Ignorá descuentos globales y promociones ("Promoción…", "15% llevando…", "Paga solo"), recargos y resúmenes ("21 BULTOS EN CARRO", "KILOS", "TOTAL GENERAL").
4. Cada fila: código, descripción, cantidad y total de la misma línea. Que el total de cada fila sea el de ese producto, no el de la fila de arriba o de abajo.
5. "packageQuantity" es la cantidad de bultos de la columna CANTIDAD (o unidades si se vende suelto). "unitsPerPack" son las unidades por bulto (U.B.); si no hay, 1.
6. "total" es el total neto de la línea, tal cual está impreso (por ejemplo "6.528,97"). Nunca pongas el precio unitario como total.
7. Controlá: la suma de los totales con IVA (x1,21) y los descuentos del pie tiene que dar el total de la factura ("totalFacturaAPagar"). Si no da, revisá la alineación y corregí.
8. "barcode" solo si aparece un código de barras (EAN) del producto; "sku" el código interno del proveedor si hay. Si no, vacíos.
9. "date" en formato AAAA-MM-DD.`;

const INVOICE_SCHEMA = {
  type: "object",
  properties: {
    rawTableTranscription: { type: "string" },
    supplierName: { type: "string" },
    invoiceNumber: { type: "string" },
    date: { type: "string" },
    totalFacturaAPagar: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sku: { type: "string" },
          barcode: { type: "string" },
          name: { type: "string" },
          packageQuantity: { type: "number" },
          unitsPerPack: { type: "number" },
          total: { type: "string" },
        },
        required: ["sku", "barcode", "name", "packageQuantity", "unitsPerPack", "total"],
        additionalProperties: false,
      },
    },
  },
  required: ["rawTableTranscription", "supplierName", "invoiceNumber", "date", "totalFacturaAPagar", "items"],
  additionalProperties: false,
};

async function parseInvoice(client, body) {
  const images = imageBlocks(body.images);
  if (!images.length) throw new AiError(400, "EMPTY", "Subí la foto de la factura.");
  const anchor = body.manualTotal !== undefined && body.manualTotal !== null && String(body.manualTotal).trim()
    ? `\n\nEl total a pagar de esta factura es exactamente ${String(body.manualTotal).slice(0, 30)}: usalo para controlar que los renglones cierren.`
    : "";
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: INVOICE_SCHEMA } },
    system: INVOICE_PROMPT,
    messages: [{ role: "user", content: [...images, { type: "text", text: `Leé esta factura de compra.${anchor}` }] }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new AiError(422, "REFUSED", "No se pudo leer esa factura. Cargala a mano o subí el PDF.");
  try { return { result: JSON.parse(textOf(msg)), usage: msg.usage || {} }; } catch { throw new AiError(502, "BAD_OUTPUT", "No se pudo leer la factura. Probá con una foto más nítida."); }
}

// ─── Entrada ───

async function handle({ db, logger, apiKey, client: injected }, uid, body) {
  const kind = String(body && body.kind || "");
  if (!LIMITS[kind]) throw new AiError(400, "BAD_KIND", "Pedido inválido");
  if (!apiKey && !injected) throw new AiError(503, "NO_KEY", "La IA de Ventra no está disponible en este momento.");
  const ref = db.collection("ventra_ai_usage").doc(`${monthKey()}_${uid}`);
  const snap = await ref.get();
  const used = Number(snap.exists && snap.data()[kind]) || 0;
  if (used >= LIMITS[kind]) {
    throw new AiError(429, "LIMIT", kind === "order"
      ? `Llegaste a los ${LIMITS.order} pedidos leídos con IA de este mes. Se renueva el mes que viene.`
      : `Llegaste a las ${LIMITS.invoice} facturas leídas con IA de este mes. Se renueva el mes que viene; mientras, subí el PDF o el Excel del proveedor.`);
  }
  // client: solo en las pruebas (firebase/test/ai.test.cjs)
  const client = injected || anthropicClient({ apiKey, maxRetries: 2, timeout: 120 * 1000 });
  let out;
  try {
    out = kind === "order" ? await parseOrder(client, body) : await parseInvoice(client, body);
  } catch (err) {
    if (err instanceof AiError) throw err;
    logger.warn(`Ventra IA (${uid}, ${kind}): ${err && err.message}`);
    throw new AiError(502, "AI_ERROR", "La IA no respondió. Probá de nuevo en un rato.");
  }
  // Solo cuenta lo que salió bien
  await ref.set({
    [kind]: admin.firestore.FieldValue.increment(1),
    costUsd: admin.firestore.FieldValue.increment(costOf(out.usage)),
    uid, month: monthKey(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { result: out.result, left: LIMITS[kind] - used - 1 };
}

module.exports = { handle, AiError, LIMITS, catalogText, imageBlocks };
