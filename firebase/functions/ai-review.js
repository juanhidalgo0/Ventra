// ═══════════════════════════════════════════════════
// Revisión semanal de lo que la IA no supo responder (2026-11-12): una IA lee las preguntas sin
// respuesta (y las que el dueño marcó "No me sirvió") y propone el arreglo. El equipo de Ventra lo
// aprueba (o lo corrige) desde el admin y queda como conocimiento del bot para todos los comercios.
//
// - ventra_ai_review/current: { proposals: [{ id, question, count, tipo, texto, nota, status }], at }
// - ventra_ai_knowledge/main: { items: [{ id, text, at }] } → ai-agent.js lo suma a sus instrucciones
// Nada cambia en el bot sin la aprobación de una persona.
// ═══════════════════════════════════════════════════
const REVIEW = "ventra_ai_review";
const KNOWLEDGE = "ventra_ai_knowledge";
const MODEL = "claude-sonnet-5-5";
const MAX_ITEMS = 60;

const SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          // conocimiento: se arregla explicándole algo al bot; falta_dato: hace falta una consulta o
          // pantalla nueva (lo programa el equipo); ignorar: no es del negocio o ya se responde
          tipo: { type: "string", enum: ["conocimiento", "falta_dato", "ignorar"] },
          texto: { type: "string" },
          nota: { type: "string" },
        },
        required: ["question", "tipo", "texto", "nota"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
};

const PROMPT = `Revisás las preguntas que el asistente de Ventra (un sistema de ventas para comercios de Argentina) no pudo responder esta semana, por WhatsApp y en la app. El asistente responde con consultas fijas a los datos del comercio y con una guía de cómo se usa Ventra.

Para cada pregunta (o grupo de preguntas parecidas) proponé el arreglo:
- "conocimiento": se arregla explicándole algo al asistente. En "texto", la instrucción exacta para sumarle, en una o dos oraciones, en segunda persona ("Si preguntan cómo …, explicá que …"). Solo cosas que sean ciertas de Ventra según la guía; si no estás seguro, usá falta_dato.
- "falta_dato": necesita una consulta o una función nueva que hoy no existe. En "texto", qué habría que programar, en una oración.
- "ignorar": no tiene que ver con el negocio o el asistente ya debería poder responderla. En "texto", por qué.
"nota": en pocas palabras, por qué no la pudo responder. Escribí en español rioplatense. Como mucho 20 propuestas, las más pedidas primero.`;

/** Propone arreglos para las preguntas sin respuesta. groups: [{ question, count, reasons }] */
async function propose(client, groups, guide = "", known = []) {
  const top = (groups || []).slice(0, 40);
  if (!top.length) return { proposals: [], usage: {} };
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 6000,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: `${PROMPT}\n\nGuía de Ventra (lo que el asistente ya sabe):\n${String(guide).slice(0, 40000)}`, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Conocimiento que ya se le sumó antes:\n${known.length ? known.map((k) => `- ${k.text}`).join("\n") : "(nada)"}\n\nPreguntas sin respuesta de la semana:\n${top.map((g) => `- (${g.count} ${g.count === 1 ? "vez" : "veces"}) "${String(g.question).slice(0, 300)}"${g.reasons && g.reasons.length ? ` — motivo: ${g.reasons.join("; ").slice(0, 200)}` : ""}`).join("\n")}` }],
  });
  let out = { proposals: [] };
  try { out = JSON.parse((msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")); } catch { /* sin propuestas */ }
  const count = new Map(top.map((g) => [String(g.question).slice(0, 300), g.count]));
  const proposals = (out.proposals || []).slice(0, 20).map((p, i) => ({
    id: `${Date.now().toString(36)}${i}`,
    question: String(p.question || "").slice(0, 300),
    count: count.get(String(p.question || "").slice(0, 300)) || 1,
    tipo: ["conocimiento", "falta_dato", "ignorar"].includes(p.tipo) ? p.tipo : "falta_dato",
    texto: String(p.texto || "").slice(0, 600),
    nota: String(p.nota || "").slice(0, 300),
    status: "pending",
  }));
  return { proposals, usage: msg.usage || {} };
}

/** Lo aprobado, para las instrucciones del bot (con un poco de caché por instancia) */
let cache = { at: 0, items: [] };
async function knowledge(db, now = Date.now()) {
  if (now - cache.at < 10 * 60 * 1000) return cache.items;
  try {
    const s = await db.collection(KNOWLEDGE).doc("main").get();
    cache = { at: now, items: s.exists && Array.isArray(s.data().items) ? s.data().items : [] };
  } catch { cache = { at: now, items: cache.items }; }
  return cache.items;
}
const resetCache = () => { cache = { at: 0, items: [] }; };

/** Guarda las propuestas de la semana (las pendientes de antes que no se decidieron siguen) */
async function saveProposals(db, proposals, now = Date.now()) {
  const ref = db.collection(REVIEW).doc("current");
  const s = await ref.get();
  const old = s.exists && Array.isArray(s.data().proposals) ? s.data().proposals.filter((p) => p.status === "pending") : [];
  const seen = new Set(proposals.map((p) => p.question.toLowerCase()));
  const all = [...proposals, ...old.filter((p) => !seen.has(String(p.question).toLowerCase()))].slice(0, 40);
  await ref.set({ proposals: all, at: now });
  return all;
}

async function list(db) {
  const [r, k] = await Promise.all([db.collection(REVIEW).doc("current").get(), db.collection(KNOWLEDGE).doc("main").get()]);
  return {
    proposals: r.exists ? (r.data().proposals || []) : [],
    at: r.exists ? r.data().at || null : null,
    knowledge: k.exists ? (k.data().items || []) : [],
  };
}

/**
 * Aprobar (con el texto corregido si hace falta), descartar o sacar algo ya aprobado.
 * decision: "approve" | "reject" | "remove"
 */
async function decide(db, { id, decision, texto, by }, now = Date.now()) {
  const kref = db.collection(KNOWLEDGE).doc("main");
  const k = await kref.get();
  const items = k.exists && Array.isArray(k.data().items) ? k.data().items : [];
  if (decision === "remove") {
    await kref.set({ items: items.filter((x) => x.id !== id), updatedAt: now });
    resetCache();
    return { ok: true };
  }
  const ref = db.collection(REVIEW).doc("current");
  const s = await ref.get();
  const proposals = s.exists && Array.isArray(s.data().proposals) ? s.data().proposals : [];
  const p = proposals.find((x) => x.id === id);
  if (!p) return { error: "Esa propuesta ya no está" };
  p.status = decision === "approve" ? "approved" : "rejected";
  p.decidedBy = by || null;
  p.decidedAt = now;
  if (decision === "approve") {
    const text = String(texto || p.texto || "").trim().slice(0, 600);
    if (!text) return { error: "Falta el texto" };
    items.push({ id, text, question: p.question, at: now, by: by || null });
    while (items.length > MAX_ITEMS) items.shift();
    await kref.set({ items, updatedAt: now });
    resetCache();
  }
  await ref.set({ proposals, at: s.exists ? s.data().at || now : now });
  return { ok: true };
}

module.exports = { propose, knowledge, saveProposals, list, decide, resetCache, REVIEW, KNOWLEDGE };
