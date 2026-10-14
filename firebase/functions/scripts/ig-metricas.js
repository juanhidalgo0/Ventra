// Informe del Instagram de Ventra para planificar la semana (solo lee, no cambia nada).
// Junta lo que guarda la nube (instagram.js): seguidores por día, métricas de cada publicación,
// borradores aprobados y descartados con el motivo, y de qué hablan los mensajes y comentarios.
//
//   node scripts/ig-metricas.js            → últimos 30 días
//   node scripts/ig-metricas.js --dias 60
//   node scripts/ig-metricas.js --pagada <id>   → marca una publicación promocionada pagando (su id sale en la tabla)
//   node scripts/ig-metricas.js --organica <id> → la desmarca
//
// Las promocionadas tienen el alcance inflado: se muestran aparte y no cuentan en los rankings ni promedios.
//
// Credenciales: las de gcloud (gcloud auth application-default login), como los otros scripts.
const admin = require("firebase-admin");

const DAY = 864e5;
const TZ = "America/Argentina/Buenos_Aires";
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
const n = (x) => (x == null ? "—" : Number(x).toLocaleString("es-AR"));
const avg = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : 0);
const local = (t) => {
  const d = new Date(ms(t) - 3 * 3600e3);
  return { day: DIAS[d.getUTCDay()], hour: d.getUTCHours(), date: d.toISOString().slice(0, 10) };
};
const cell = (s) => String(s || "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();

/** Puntaje para comparar publicaciones: lo que más hace crecer (compartir, guardar, seguir) pesa más. */
function score(m) {
  const x = m.metrics || {};
  if (!x.reach) return null;
  const inter = (x.likes ?? m.likes ?? 0) + 2 * (x.comments ?? m.comments ?? 0) + 3 * (x.saved || 0) + 4 * (x.shares || 0) + 6 * (x.follows || 0);
  return inter / x.reach;
}

function count(items, key) {
  const m = new Map();
  for (const i of items) {
    const k = i.lead && i.lead[key];
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function group(media, keyOf) {
  const g = new Map();
  for (const m of media) {
    if (!m.metrics || !m.metrics.reach) continue;
    const k = keyOf(m);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(m);
  }
  return [...g.entries()].map(([k, list]) => ({
    k, posts: list.length,
    reach: Math.round(avg(list.map((m) => m.metrics.reach))),
    score: avg(list.map(score)),
  })).sort((a, b) => b.score - a.score);
}

async function main() {
  const i = process.argv.indexOf("--dias");
  const days = Math.max(7, Math.min(365, Number(i > -1 ? process.argv[i + 1] : 30) || 30));
  admin.initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST && process.env.GCLOUD_PROJECT ? process.env.GCLOUD_PROJECT : "ventra-9cba5" });
  const db = admin.firestore();
  for (const flag of ["--pagada", "--organica"]) {
    const k = process.argv.indexOf(flag);
    if (k === -1) continue;
    const id = String(process.argv[k + 1] || "");
    const ref = db.collection("ventra_ig_media").doc(id);
    if (!id || !(await ref.get()).exists) { console.error(`No existe la publicación ${id}`); process.exitCode = 1; return; }
    await ref.set({ promoted: flag === "--pagada" }, { merge: true });
    console.log(`${id}: ${flag === "--pagada" ? "marcada como promocionada (no cuenta en los rankings)" : "orgánica"}`);
    return;
  }
  const from = Date.now() - days * DAY;
  const fromKey = new Date(from - 3 * 3600e3).toISOString().slice(0, 10);

  const [cfgDoc, daily, mediaSnap, postsSnap, inboxSnap, threadsSnap] = await Promise.all([
    db.collection("ventra_private").doc("instagram").get(),
    db.collection("ventra_ig_daily").where(admin.firestore.FieldPath.documentId(), ">=", fromKey).get(),
    db.collection("ventra_ig_media").where("timestamp", ">=", admin.firestore.Timestamp.fromMillis(from)).get(),
    db.collection("ventra_ig_posts").orderBy("createdAt", "desc").limit(100).get(),
    db.collection("ventra_ig_inbox").where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(from)).get(),
    db.collection("ventra_ig_threads").where("needsHuman", "==", true).get(),
  ]);
  const cfg = cfgDoc.data() || {};
  const out = [];
  const p = (s = "") => out.push(s);

  p(`# Instagram de Ventra — últimos ${days} días`);
  p(`Generado ${new Date().toLocaleString("es-AR", { timeZone: TZ })}. Cuenta: ${cfg.username ? "@" + cfg.username : "sin conectar"}. Respuestas automáticas: mensajes ${cfg.bots && cfg.bots.dm ? "prendidas" : "apagadas"}, comentarios ${cfg.bots && cfg.bots.comments ? "prendidas" : "apagadas"}. Piloto automático: ${cfg.autopilot && cfg.autopilot.enabled ? "PRENDIDO (lo que cargues con --cuando a 12 h o más se publica sin aprobación)" : "apagado (todo queda como borrador para aprobar)"}.`);
  if (cfg.lastError) p(`\n> Problema actual: ${cfg.lastError}`);
  if (cfg.insightsError) p(`\n> Métricas: ${cfg.insightsError}`);

  // Seguidores
  const f = daily.docs.filter((d) => typeof d.data().followers === "number").map((d) => ({ day: d.id, n: d.data().followers }));
  p("\n## Seguidores");
  if (f.length) {
    const last = f[f.length - 1];
    const week = f.find((x) => x.day >= new Date(Date.now() - 7 * DAY - 3 * 3600e3).toISOString().slice(0, 10)) || f[0];
    p(`Hoy ${n(last.n)}. En 7 días: ${last.n - week.n >= 0 ? "+" : ""}${n(last.n - week.n)}. En el período: ${last.n - f[0].n >= 0 ? "+" : ""}${n(last.n - f[0].n)} (desde ${f[0].day}).`);
  } else p("Todavía sin datos (se guardan una vez por día desde que se conectó la cuenta).");

  // Publicaciones
  const posts = postsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byPost = new Map(posts.map((x) => [x.id, x]));
  const media = mediaSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
  const typeOf = (m) => (m.productType === "REELS" ? "reel" : m.mediaType === "CAROUSEL_ALBUM" ? "carrusel" : m.productType === "STORY" ? "historia" : "foto");
  p("\n## Publicaciones");
  if (!media.length) p("Sin publicaciones con métricas en el período.");
  else {
    p("| Fecha | Día y hora | Tipo | Alcance | Me gusta | Coment. | Guard. | Compart. | Seguidores | Puntaje | Origen | Id | Texto |");
    p("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const m of media) {
      const x = m.metrics || {};
      const l = local(m.timestamp);
      const s = score(m);
      p(`| ${l.date} | ${l.day} ${l.hour} h | ${typeOf(m)} | ${n(x.reach)} | ${n(x.likes ?? m.likes)} | ${n(x.comments ?? m.comments)} | ${n(x.saved)} | ${n(x.shares)} | ${n(x.follows)} | ${s == null ? "—" : s.toFixed(3)} | ${m.postId ? "agente" : "a mano"}${m.promoted ? ", pagada" : ""} | ${m.id} | ${cell((m.caption || "").split("\n")[0]).slice(0, 80)} |`);
    }
    // Solo lo orgánico: lo promocionado pagando tiene el alcance inflado
    const organic = media.filter((m) => !m.promoted);
    if (organic.length < media.length) p(`\n${media.length - organic.length} promocionadas pagando: se muestran arriba pero no cuentan en lo que sigue.`);
    const ranked = organic.filter((m) => score(m) != null).sort((a, b) => score(b) - score(a));
    if (ranked.length >= 3) {
      p("\nMejores (puntaje = interacciones ponderadas por alcance: compartir y seguir pesan más):");
      for (const m of ranked.slice(0, 3)) {
        const note = m.postId && byPost.get(m.postId) ? byPost.get(m.postId).note : "";
        p(`- ${typeOf(m)} ${local(m.timestamp).date}: "${cell(m.caption).slice(0, 160)}"${note ? ` — idea: ${cell(note)}` : ""} (${m.permalink || ""})`);
      }
      p("\nPeores:");
      for (const m of ranked.slice(-3).reverse()) p(`- ${typeOf(m)} ${local(m.timestamp).date}: "${cell(m.caption).slice(0, 160)}" (${m.permalink || ""})`);
    }
    const table = (title, rows) => {
      if (!rows.length) return;
      p(`\n${title}`);
      for (const r of rows) p(`- ${r.k}: ${r.posts} publicaciones, alcance medio ${n(r.reach)}, puntaje medio ${r.score.toFixed(3)}`);
    };
    table("Por tipo:", group(organic, typeOf));
    table("Por día:", group(organic, (m) => local(m.timestamp).day));
    table("Por franja horaria:", group(organic, (m) => { const h = local(m.timestamp).hour; return h < 12 ? "mañana (antes de 12)" : h < 17 ? "tarde (12 a 17)" : h < 21 ? "tarde-noche (17 a 21)" : "noche (21 o más)"; }));
  }

  // Borradores
  p("\n## Borradores del agente");
  const st = {};
  for (const x of posts) st[x.status] = (st[x.status] || 0) + 1;
  p(Object.entries(st).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Ninguno todavía.");
  const rejected = posts.filter((x) => x.status === "rejected");
  if (rejected.length) {
    p("\nDescartados por el dueño (aprender de esto):");
    for (const x of rejected.slice(0, 15)) p(`- ${x.type}: "${cell(x.caption).slice(0, 120)}"${x.feedback ? ` → motivo: ${cell(x.feedback)}` : " (sin motivo)"}`);
  }
  const edited = posts.filter((x) => x.status === "published" && x.approvedBy && x.originalCaption && x.originalCaption !== x.caption);
  if (edited.length) {
    p("\nTextos que el dueño corrigió antes de aprobar:");
    for (const x of edited.slice(0, 10)) p(`- antes: "${cell(x.originalCaption).slice(0, 140)}"\n  después: "${cell(x.caption).slice(0, 140)}"`);
  }
  const failedPosts = posts.filter((x) => x.status === "failed");
  if (failedPosts.length) for (const x of failedPosts) p(`- Con error: ${x.id} (${x.type}): ${x.error}`);
  const queued = posts.filter((x) => x.status === "draft" || x.status === "approved").sort((a, b) => ms(a.publishAt) - ms(b.publishAt));
  if (queued.length) {
    p("\nEn cola:");
    for (const x of queued) p(`- ${x.status === "draft" ? "borrador" : "programada"} ${x.publishAt ? new Date(ms(x.publishAt)).toLocaleString("es-AR", { timeZone: TZ }) : "sin fecha"} · ${x.type}: "${cell(x.caption).slice(0, 90)}"`);
  }

  // Conversaciones
  const items = inboxSnap.docs.map((d) => d.data()).filter((x) => x.kind === "dm" || x.kind === "comment");
  const learned = items.filter((x) => x.lead && x.lead.intent !== "spam");
  p("\n## Lo que dice la gente");
  p(`${items.filter((x) => x.kind === "dm").length} mensajes directos y ${items.filter((x) => x.kind === "comment").length} comentarios. Respondidos por el bot: ${items.filter((x) => x.status === "replied").length}. Derivados a una persona: ${items.filter((x) => x.status === "handoff" || x.needsHuman).length}.`);
  const list = (title, rows) => p(`${title}: ${rows.length ? rows.slice(0, 12).map(([k, v]) => `${k} (${v})`).join(", ") : "sin datos"}`);
  list("Temas", count(learned, "topic"));
  list("Rubros", count(learned, "rubro"));
  list("Intención", count(learned, "intent"));
  const questions = items.filter((x) => x.text && x.lead && ["consulta", "interesado", "listo_para_comprar"].includes(x.lead.intent)).slice(-40);
  if (questions.length) {
    p("\nPreguntas reales (sin nombres), para sacar ideas de contenido:");
    for (const x of questions) p(`- [${x.kind === "dm" ? "mensaje" : "comentario"} · ${x.lead.topic || "?"}${x.lead.rubro ? " · " + x.lead.rubro : ""}] ${cell(x.text).slice(0, 200)}`);
  }
  const hot = threadsSnap.docs.map((d) => d.data()).filter((t) => t.needsHumanWhy === "Posible venta");
  if (hot.length) p(`\nPosibles ventas esperando a una persona: ${hot.length}.`);

  // Gasto
  const month = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
  const usage = (await db.collection("ventra_chat_usage").doc(month).get()).data() || {};
  p(`\n## Gasto de IA este mes\nUS$ ${(usage.costUsd || 0).toFixed(2)} (compartido con el asistente de la web; tope US$ 50). Respuestas: ${usage.igDmReplies || 0} mensajes, ${usage.igCommentReplies || 0} comentarios.`);

  console.log(out.join("\n"));
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
