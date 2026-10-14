// Pruebas de functions/scripts/ig-borrador.js. Desde firebase/:
//   firebase emulators:exec --only firestore,storage --project demo-ventra "node test/ig-borrador.test.cjs"
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const FN = path.join(__dirname, "../functions");
const { validate, jpegSize, parseWhen, autoDecision } = require(FN + "/scripts/ig-borrador.js");
const dir = path.join(require("os").tmpdir(), "ig-borrador-test");
fs.mkdirSync(dir, { recursive: true });
let passed = 0, failed = 0;
const ok = (c, n, x) => { if (c) { passed++; console.log("  ✓ " + n); } else { failed++; console.log("  ✗ " + n + (x !== undefined ? "  → " + JSON.stringify(x) : "")); } };

// JPEG mínimo con el encabezado SOF0 (alcanza para leer medidas)
function jpeg(w, h) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
const f = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); return p; };
const sq = f("cuadrada.jpg", jpeg(1080, 1080));
const port = f("vertical.jpg", jpeg(1080, 1350));
const tall = f("historia.jpg", jpeg(1080, 1920));
const png = f("falsa.jpg", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
const vid = f("reel.mp4", Buffer.from("video"));
const txt = f("texto.txt", "Texto con #ventra");

console.log("Validaciones");
ok(JSON.stringify(jpegSize(fs.readFileSync(port))) === JSON.stringify({ height: 1350, width: 1080 }), "lee las medidas del JPEG");
ok(jpegSize(fs.readFileSync(png)) === null, "detecta un PNG renombrado");
ok(validate({ type: "image", files: [sq], caption: "hola" }).length === 0, "foto cuadrada válida");
ok(validate({ type: "image", files: [port], caption: "" }).length === 0, "foto 4:5 válida");
ok(validate({ type: "image", files: [tall], caption: "" }).some((e) => /proporción/.test(e)), "foto 9:16 rechazada en el feed");
ok(validate({ type: "story", files: [tall], caption: "" }).length === 0, "historia 9:16 válida");
ok(validate({ type: "story", files: [tall], caption: "x" }).some((e) => /historias no llevan texto/.test(e)), "historia con texto rechazada");
ok(validate({ type: "image", files: [png], caption: "" }).some((e) => /no es un JPEG/.test(e)), "PNG renombrado rechazado");
ok(validate({ type: "reel", files: [sq], caption: "" }).some((e) => /reel tiene que ser video/.test(e)), "reel con foto rechazado");
ok(validate({ type: "reel", files: [vid], caption: "", cover: sq }).length === 0, "reel con portada válido");
ok(validate({ type: "carousel", files: [sq], caption: "" }).some((e) => /de 2 a 10/.test(e)), "carrusel de 1 rechazado");
ok(validate({ type: "carousel", files: [sq, port, vid], caption: "" }).length === 0, "carrusel mixto válido");
ok(validate({ type: "image", files: [sq], caption: "#a ".repeat(31) }).some((e) => /hashtags/.test(e)), "más de 30 hashtags rechazado");
ok(validate({ type: undefined, files: [sq], caption: "" })[0].startsWith("Tipo inválido"), "tipo inválido");
ok(validate({ type: "image", files: ["no-existe.jpg"], caption: "" }).some((e) => /No existe/.test(e)), "archivo inexistente");
ok(parseWhen("2026-10-14 19:00") === Date.parse("2026-10-14T22:00:00Z"), "la hora se toma como hora de Argentina");
ok(parseWhen("14/10 19hs") === null, "fecha mal escrita rechazada");

console.log("Piloto automático (decisión)");
{
  const now = Date.parse("2026-10-10T12:00:00-03:00"), H = 3600e3, on = { enabled: true };
  const at = (s) => Date.parse(s + "-03:00");
  ok(!autoDecision({ enabled: false }, { publishAt: now + 48 * H, now }).auto, "apagado: queda como borrador");
  ok(autoDecision(on, { publishAt: now + 48 * H, now }).auto, "prendido: se programa sola");
  ok(!autoDecision(on, { publishAt: now + 5 * H, now }).auto, "menos de 12 h de anticipación: borrador");
  ok(!autoDecision(on, { publishAt: null, now }).auto, "sin fecha: borrador");
  ok(!autoDecision(on, { publishAt: now + 48 * H, forceDraft: true, now }).auto, "--borrador: borrador");
  const week = ["2026-10-12T19:00", "2026-10-13T19:00", "2026-10-15T10:00", "2026-10-17T10:00", "2026-10-18T22:00"].map(at);
  ok(!autoDecision(on, { publishAt: at("2026-10-14T19:00"), others: week, now }).auto, "tope de 5 por semana");
  ok(autoDecision(on, { publishAt: at("2026-10-14T19:00"), others: [at("2026-10-11T19:00"), at("2026-10-19T00:30")], now }).auto, "la semana va de lunes a domingo (hora de Argentina)");
}

console.log("Carga contra los emuladores");
const run = (args) => {
  try { return { code: 0, out: execFileSync("node", [FN + "/scripts/ig-borrador.js", ...args], { encoding: "utf8", env: process.env }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
let r = run(["--tipo", "carrusel", "--archivo", sq, "--archivo", port, "--texto", txt, "--cuando", "2099-01-02 19:00", "--nota", "Prueba"]);
ok(r.code === 0 && /Borrador \w+ cargado \(carousel, 2 archivos\)/.test(r.out), "carga un carrusel", r.out);
r = run(["--tipo", "foto", "--archivo", tall]);
ok(r.code === 1 && /proporción/.test(r.out), "no carga si algo está mal", r.out);
r = run(["--tipo", "foto", "--archivo", sq, "--cuando", "2020-01-01 10:00"]);
ok(r.code === 1 && /ya pasó/.test(r.out), "fecha pasada rechazada", r.out);

(async () => {
  const admin = require(FN + "/node_modules/firebase-admin");
  admin.initializeApp({ projectId: "demo-ventra", storageBucket: "ventra-9cba5.firebasestorage.app" });
  const snap = await admin.firestore().collection("ventra_ig_posts").get();
  const p = snap.docs[0] && snap.docs[0].data();
  ok(snap.size === 1 && p.status === "draft" && p.type === "carousel" && p.caption === "Texto con #ventra" && p.note === "Prueba" && p.createdBy === "claude", "el borrador queda en Firestore como borrador", p);
  ok(p && p.publishAt.toMillis() === Date.parse("2099-01-02T22:00:00Z"), "con la hora programada");
  const res = p && await fetch(p.media[0].url);
  const buf = res && Buffer.from(await res.arrayBuffer());
  ok(res && res.ok && buf.equals(fs.readFileSync(sq)) && res.headers.get("content-type") === "image/jpeg", "el archivo se puede bajar por su link público", res && res.status);
  // Piloto automático prendido: se programa sola; con --borrador o poca anticipación queda como borrador
  await admin.firestore().collection("ventra_private").doc("instagram").set({ autopilot: { enabled: true } }, { merge: true });
  r = run(["--tipo", "foto", "--archivo", sq, "--texto", "Auto #ventra", "--cuando", "2099-03-04 19:00"]);
  ok(r.code === 0 && /Programada \w+ .*piloto automático/.test(r.out), "piloto automático: queda programada", r.out);
  r = run(["--tipo", "foto", "--archivo", sq, "--texto", "Dudosa", "--cuando", "2099-03-05 19:00", "--borrador"]);
  ok(r.code === 0 && /Borrador .*se pidió como borrador/.test(r.out), "piloto automático con --borrador: queda como borrador", r.out);
  const all = (await admin.firestore().collection("ventra_ig_posts").get()).docs.map((d) => d.data());
  const autoPost = all.find((x) => x.caption === "Auto #ventra"), dudosa = all.find((x) => x.caption === "Dudosa");
  ok(autoPost && autoPost.status === "approved" && autoPost.approvedBy === "piloto automático" && dudosa && dudosa.status === "draft", "estados guardados correctamente", { autoPost, dudosa });
  r = run(["--listar"]);
  ok(/draft\s+carousel/.test(r.out), "--listar muestra el borrador", r.out);
  console.log(`\n${passed} bien, ${failed} mal`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
