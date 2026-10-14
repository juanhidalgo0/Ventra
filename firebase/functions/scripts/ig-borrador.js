// Carga un borrador para el Instagram de Ventra. No publica nada: queda en ventra.store/instagram
// hasta que el dueño lo aprueba (ver instagram.js).
//
//   node scripts/ig-borrador.js --tipo reel --archivo out/reel.mp4 [--portada out/portada.jpg] \
//        --texto texto.txt --cuando "2026-10-14 19:00" --nota "Por qué este post"
//   node scripts/ig-borrador.js --tipo foto --archivo post.jpg --texto "Texto del post #ventra"
//   node scripts/ig-borrador.js --tipo carrusel --archivo 1.jpg --archivo 2.jpg --archivo 3.jpg --texto texto.txt
//   node scripts/ig-borrador.js --tipo historia --archivo historia.jpg
//   node scripts/ig-borrador.js --listar
//
// Fotos: JPEG, proporción entre 4:5 y 1.91:1 (historias: cualquiera). Los PNG y WEBP se pasan
// solos a JPEG con el ffmpeg de marketing/remotion (Instagram solo acepta JPEG).
// Videos: MP4 o MOV. --cuando es hora de Argentina; sin --cuando se elige al aprobar.
// Piloto automático (se prende en el panel): la pieza queda programada sin esperar al dueño, si
// tiene --cuando con al menos 12 h de anticipación y esa semana no pasa de 5. Si no, queda como
// borrador. Con --borrador queda siempre como borrador (cuando el agente tiene dudas).
//
// Credenciales: las de gcloud (gcloud auth application-default login), como los otros scripts.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const admin = require("firebase-admin");

const BUCKET = "ventra-9cba5.firebasestorage.app";
const TYPES = { foto: "image", imagen: "image", image: "image", reel: "reel", carrusel: "carousel", carousel: "carousel", historia: "story", story: "story" };
const IMAGE_EXT = [".jpg", ".jpeg"];
const VIDEO_EXT = [".mp4", ".mov"];
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = 300 * 1024 * 1024;
const FFMPEG = path.join(__dirname, "../../../marketing/remotion/node_modules/ffmpeg-static/ffmpeg.exe");

/** PNG/WEBP → JPEG de buena calidad (fondo blanco si tiene transparencias). Devuelve la ruta nueva. */
function toJpeg(file) {
  const out = path.join(os.tmpdir(), `ig-${crypto.randomUUID()}.jpg`);
  const bin = fs.existsSync(FFMPEG) ? FFMPEG : "ffmpeg";
  execFileSync(bin, ["-y", "-loglevel", "error", "-i", file,
    "-filter_complex", "color=white,format=rgb24[bg];[bg][0:v]scale2ref[bg2][img];[bg2][img]overlay=shortest=1,format=yuvj444p",
    "-frames:v", "1", "-q:v", "2", out]);
  return out;
}

function args(argv) {
  const out = { archivo: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    if (key === "archivo") out.archivo.push(val);
    else out[key] = val;
  }
  return out;
}

/** Ancho y alto de un JPEG (lee el encabezado SOF). null si no es un JPEG válido. */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

const AUTOPILOT = { leadHours: 12, perWeek: 5 };
const AUTOPILOT_BY = "piloto automático";

/** Lunes 00:00 (hora de Argentina) de la semana de un momento, en milisegundos. */
function weekStart(at) {
  const d = new Date(at - 3 * 3600e3);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day) + 3 * 3600e3;
}

/**
 * ¿Se programa sola o queda como borrador? Pura (se prueba sola).
 * others: momentos (ms) de las otras publicaciones del piloto automático que siguen en pie.
 */
function autoDecision(autopilot, { publishAt, forceDraft, others = [], now = Date.now() }) {
  if (!autopilot || !autopilot.enabled) return { auto: false, why: "el piloto automático está apagado" };
  if (forceDraft) return { auto: false, why: "se pidió como borrador" };
  if (!publishAt) return { auto: false, why: "no tiene --cuando" };
  if (publishAt < now + AUTOPILOT.leadHours * 3600e3) return { auto: false, why: `sale en menos de ${AUTOPILOT.leadHours} h` };
  const week = weekStart(publishAt);
  const sameWeek = others.filter((t) => weekStart(t) === week).length;
  if (sameWeek >= AUTOPILOT.perWeek) return { auto: false, why: `esa semana ya tiene ${sameWeek} programadas por el piloto` };
  return { auto: true };
}

/** "2026-10-14 19:00" en hora de Argentina → milisegundos. */
function parseWhen(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, "0")}:${m[5]}:00-03:00`);
  return Number.isFinite(t) ? t : null;
}

/** Revisa todo antes de subir. Devuelve la lista de problemas (vacía si está bien). */
function validate({ type, files, caption, cover }) {
  const errors = [];
  const count = { image: [1, 1], reel: [1, 1], story: [1, 1], carousel: [2, 10] }[type];
  if (!count) return ["Tipo inválido: foto, reel, carrusel o historia"];
  if (files.length < count[0] || files.length > count[1]) {
    errors.push(count[0] === count[1] ? `Un ${type} lleva ${count[0]} archivo` : `Un carrusel lleva de ${count[0]} a ${count[1]} archivos`);
  }
  for (const f of files) {
    if (!fs.existsSync(f)) { errors.push(`No existe ${f}`); continue; }
    const ext = path.extname(f).toLowerCase();
    const size = fs.statSync(f).size;
    const isImage = IMAGE_EXT.includes(ext), isVideo = VIDEO_EXT.includes(ext);
    if (!isImage && !isVideo) { errors.push(`${f}: solo JPEG (.jpg) o video (.mp4/.mov)`); continue; }
    if (type === "image" && !isImage) errors.push(`${f}: una foto tiene que ser .jpg`);
    if (type === "reel" && !isVideo) errors.push(`${f}: un reel tiene que ser video`);
    if (isImage && size > MAX_IMAGE) errors.push(`${f}: pesa más de 8 MB`);
    if (isVideo && size > MAX_VIDEO) errors.push(`${f}: pesa más de 300 MB`);
    if (isImage) {
      const dim = jpegSize(fs.readFileSync(f));
      if (!dim) errors.push(`${f}: no es un JPEG válido (¿es un PNG renombrado?)`);
      else if (type !== "story") {
        const ratio = dim.width / dim.height;
        if (ratio < 0.8 - 0.005 || ratio > 1.91 + 0.005) errors.push(`${f}: proporción ${dim.width}x${dim.height} fuera de lo que acepta Instagram (de 4:5 a 1.91:1)`);
      }
    }
  }
  if (cover) {
    if (type !== "reel") errors.push("--portada es solo para reels");
    else if (!fs.existsSync(cover) || !IMAGE_EXT.includes(path.extname(cover).toLowerCase())) errors.push("La portada tiene que ser un .jpg existente");
  }
  if (type === "story" && caption) errors.push("Las historias no llevan texto: sacá --texto");
  if (caption.length > 2200) errors.push(`El texto tiene ${caption.length} caracteres (máximo 2200)`);
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length > 30) errors.push(`El texto tiene ${tags.length} hashtags (máximo 30)`);
  return errors;
}

async function upload(bucket, local, dest) {
  const token = crypto.randomUUID();
  const ext = path.extname(local).toLowerCase();
  const contentType = IMAGE_EXT.includes(ext) ? "image/jpeg" : ext === ".mov" ? "video/quicktime" : "video/mp4";
  await bucket.upload(local, { destination: dest, metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } } });
  // Link público con token: Instagram baja el archivo desde acá al publicar
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : "https://firebasestorage.googleapis.com";
  return { url: `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`, kind: IMAGE_EXT.includes(ext) ? "image" : "video", path: dest };
}

async function list(db) {
  const snap = await db.collection("ventra_ig_posts").orderBy("createdAt", "desc").limit(30).get();
  for (const d of snap.docs) {
    const p = d.data();
    const when = p.publishAt ? new Date(p.publishAt.toMillis()).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hourCycle: "h23" }) : "sin fecha";
    console.log(`${d.id}  ${String(p.status).padEnd(10)} ${String(p.type).padEnd(8)} ${when}  ${(p.caption || "").split("\n")[0].slice(0, 60)}${p.feedback ? `  · comentario del dueño: ${p.feedback}` : ""}${p.error ? `  · error: ${p.error}` : ""}`);
  }
}

async function main() {
  const a = args(process.argv.slice(2));
  // En los emuladores se usa el proyecto de prueba que ellos indican
  admin.initializeApp({ projectId: process.env.FIRESTORE_EMULATOR_HOST && process.env.GCLOUD_PROJECT ? process.env.GCLOUD_PROJECT : "ventra-9cba5", storageBucket: BUCKET });
  const db = admin.firestore();
  if (a.listar) return list(db);

  const type = TYPES[String(a.tipo || "").toLowerCase()];
  let caption = typeof a.texto === "string" ? a.texto : "";
  if (caption && fs.existsSync(caption)) caption = fs.readFileSync(caption, "utf8");
  caption = caption.replace(/\r\n/g, "\n").trim();
  // Instagram solo acepta JPEG: los PNG y WEBP se convierten antes de validar
  const convert = (f) => {
    if (typeof f !== "string" || !fs.existsSync(f) || ![".png", ".webp"].includes(path.extname(f).toLowerCase())) return f;
    const out = toJpeg(f);
    console.log(`${path.basename(f)} → JPEG`);
    return out;
  };
  a.archivo = a.archivo.map(convert);
  const cover = typeof a.portada === "string" ? convert(a.portada) : null;
  const errors = validate({ type, files: a.archivo, caption, cover });
  let publishAt = null;
  if (a.cuando) {
    publishAt = parseWhen(a.cuando);
    if (!publishAt) errors.push('--cuando tiene que ser "AAAA-MM-DD HH:MM" (hora de Argentina)');
    else if (publishAt < Date.now()) errors.push("--cuando ya pasó");
  }
  if (errors.length) {
    console.error("No se cargó el borrador:\n- " + errors.join("\n- "));
    process.exitCode = 1;
    return;
  }

  const cfg = (await db.collection("ventra_private").doc("instagram").get()).data() || {};
  const others = (await db.collection("ventra_ig_posts").where("approvedBy", "==", AUTOPILOT_BY).get()).docs
    .map((d) => d.data()).filter((p) => ["approved", "processing", "published"].includes(p.status) && p.publishAt).map((p) => p.publishAt.toMillis());
  const decision = autoDecision(cfg.autopilot, { publishAt, forceDraft: !!a.borrador, others });

  const ref = db.collection("ventra_ig_posts").doc();
  const bucket = admin.storage().bucket();
  const media = [];
  for (let i = 0; i < a.archivo.length; i++) {
    media.push(await upload(bucket, a.archivo[i], `ventra_ig/${ref.id}/${i + 1}${path.extname(a.archivo[i]).toLowerCase()}`));
  }
  const coverUrl = cover ? (await upload(bucket, cover, `ventra_ig/${ref.id}/portada.jpg`)).url : null;
  await ref.set({
    type, media, coverUrl, caption, note: typeof a.nota === "string" ? a.nota : "",
    // El texto tal como lo propuso el agente: si el dueño lo corrige, el informe muestra el cambio
    originalCaption: caption,
    publishAt: publishAt ? admin.firestore.Timestamp.fromMillis(publishAt) : null,
    status: decision.auto ? "approved" : "draft",
    ...(decision.auto ? { approvedBy: AUTOPILOT_BY, approvedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    createdBy: "claude", createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const what = `(${type}, ${media.length} archivo${media.length === 1 ? "" : "s"})`;
  if (decision.auto) {
    const when = new Date(publishAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hourCycle: "h23" });
    console.log(`Programada ${ref.id} ${what} por el piloto automático para el ${when}. Se puede frenar en https://ventra.store/instagram`);
  } else {
    console.log(`Borrador ${ref.id} cargado ${what}${cfg.autopilot && cfg.autopilot.enabled ? ` (no se programó solo: ${decision.why})` : ""}. Aprobalo en https://ventra.store/instagram`);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}

module.exports = { validate, jpegSize, parseWhen, toJpeg, autoDecision, weekStart, AUTOPILOT, AUTOPILOT_BY };
