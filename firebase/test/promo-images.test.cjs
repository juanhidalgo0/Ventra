// Imágenes de promos por WhatsApp (functions/promo-images + wa-owner.js): Postgres en memoria
// (PGlite) con el esquema real de la sincronización, Firestore, Storage, WhatsApp y Claude falsos.
// Un test dibuja de verdad con el Chrome de la PC (si no hay Chrome, se saltea).
//   node firebase/test/promo-images.test.cjs
const assert = require("assert");
const fs = require("fs");
const { PGlite } = require("../../tools/sync-sim/node_modules/@electric-sql/pglite");
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
admin.firestore.FieldValue.serverTimestamp = () => "ts";
const sharp = require("../functions/node_modules/sharp");
const ai = require("../functions/ai");
const cloudSync = require("../functions/sync");
const waOwner = require("../functions/wa-owner");
const promo = require("../functions/promo-images");
const brand = require("../functions/promo-images/brand");
const photos = require("../functions/promo-images/photos");
const designs = require("../functions/promo-images/designs");

// ── Falsos ──
const fakeDb = () => {
  const cols = {};
  const col = (name) => (cols[name] = cols[name] || {});
  const docRef = (name, id) => ({
    id,
    get: async () => ({ id, exists: id in col(name), data: () => col(name)[id], ref: docRef(name, id) }),
    set: async (v, opt) => {
      const cur = opt && opt.merge ? { ...(col(name)[id] || {}) } : {};
      for (const [k, x] of Object.entries(v)) cur[k] = x && x.operand !== undefined ? (cur[k] || 0) + x.operand : x;
      col(name)[id] = cur;
    },
    create: async (v) => { if (id in col(name)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 }); col(name)[id] = v; },
    delete: async () => { delete col(name)[id]; },
  });
  const query = (name, filters) => ({
    where: (f, op, v) => query(name, [...filters, [f, v]]),
    get: async () => {
      const docs = Object.entries(col(name)).filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => ({ id, data: () => d, ref: docRef(name, id) }));
      return { docs, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
    },
  });
  return { cols, collection: (name) => ({ doc: (id) => docRef(name, id), where: (f, op, v) => query(name, [[f, v]]) }) };
};
const fakeBucket = () => {
  const files = {};
  return {
    name: "ventra-test", files,
    file: (p) => ({
      save: async (buf) => { files[p] = Buffer.from(buf); },
      download: async () => { if (!(p in files)) throw new Error("No existe " + p); return [files[p]]; },
      exists: async () => [p in files],
    }),
  };
};
// Claude falso: la primera vuelta pide las herramientas de `calls`; la segunda contesta `final`
const client = (calls = [], final = "Ahí te las armo.") => {
  const reqs = [];
  return {
    reqs,
    messages: { create: async (req) => {
      reqs.push(JSON.parse(JSON.stringify(req)));
      if (reqs.length === 1 && calls.length) return { stop_reason: "tool_use", usage: {}, content: calls.map((c, i) => ({ type: "tool_use", id: `t${i}`, name: c.name, input: c.input || {} })) };
      return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: final }] };
    } },
  };
};
// Dibujante falso: un JPG chico que guarda el HTML que recibió (para revisar qué se dibujó)
const drawn = [];
const fakeRender = async (html, size) => { drawn.push({ html, size }); return sharp({ create: { width: 20, height: 20, channels: 3, background: "#222" } }).jpeg().toBuffer(); };
const logger = { warn() {}, error(...a) { console.log("   [error]", ...a); }, info() {} };

// ── Imágenes de ejemplo (hechas acá, sin archivos) ──
/** Foto de catálogo: fondo blanco, una "botella" oscura en el medio y un cartel rojo pegado al costado derecho */
async function catalogPhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#fff"/>
    <rect x="120" y="20" width="60" height="260" rx="22" fill="#2b1a10"/><rect x="135" y="5" width="30" height="30" fill="#111"/>
    <rect x="262" y="40" width="38" height="200" fill="#d11"/><rect x="20" y="250" width="20" height="10" fill="#333"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}
/** Una foto común (fondo con degradé, no de catálogo) */
async function plainPhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><defs><linearGradient id="g"><stop offset="0" stop-color="#335"/><stop offset="1" stop-color="#a73"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="100" r="40" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}
/** Logo: círculo negro con una franja amarilla */
async function logoPng() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="98" fill="#0b0b0b"/><rect x="30" y="85" width="140" height="30" fill="#f2b705"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const T = "tenant1";
const PHONE = "5492215550000";
const NOW = Date.now();
let ok = 0, bad = 0, skipped = 0;
const t = async (name, fn) => { try { const r = await fn(); if (r === "skip") { skipped++; console.log(`--    ${name} (salteado)`); return; } ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

(async () => {
  const pg = new PGlite();
  const sql = { query: async (text, params) => (await pg.query(text, params)).rows };
  await cloudSync.ensureSchema(sql);
  const logo = await logoPng();
  const photo = await catalogPhoto();
  const rows = [];
  const add = (tbl, id, data, tenant = T) => rows.push({ t: tbl, id, d: { id, ...data }, ts: NOW - 864e5 });
  add("store_settings", "store_name", { value: JSON.stringify("ESCABIADOS") });
  add("store_settings", "store_logo", { value: JSON.stringify(`data:image/png;base64,${logo.toString("base64")}`) });
  add("products", "fernet", { name: "FERNET BRANCA 750ML", sale_price: 19500, is_active: 1, image_url: "ventra-img:abc" });
  add("products", "fernetl", { name: "FERNET BRANCA LITRO", sale_price: 26500, is_active: 1, image_url: "ventra-img:def" });
  add("products", "coca", { name: "COCA COLA 2.25", sale_price: 5200, is_active: 1, image_url: "ventra-img:ghi" });
  add("products", "sinfoto", { name: "ALFAJOR TRIPLE", sale_price: 900, is_active: 1 });
  add("products", "sinprecio", { name: "HIELO BOLSA", sale_price: 0, is_active: 1, image_url: "ventra-img:x" });
  await cloudSync.push(sql, T, "pc", rows);
  // Otro comercio, sin nombre ni logo
  await cloudSync.push(sql, "otro", "pc2", [{ t: "products", id: "fernet", d: { id: "fernet", name: "FERNET BRANCA 750ML", sale_price: 18000, is_active: 1, image_url: "ventra-img:z" }, ts: NOW - 864e5 }]);

  const db = fakeDb();
  const bucket = fakeBucket();
  for (const id of ["fernet", "fernetl", "coca", "sinprecio"]) bucket.files[photos.imagePath(T, id)] = photo;
  bucket.files[photos.imagePath("otro", "fernet")] = photo;
  const noHd = async () => null;

  // ── Fotos ──
  await t("recorte: borra el fondo blanco y el cartel del costado, queda la botella", async () => {
    const r = await photos.cutout(photo);
    assert.strictEqual(r.cut, true);
    assert.ok(r.width <= 66 && r.width >= 56, `ancho ${r.width}`);
    assert.ok(r.dropped >= 2, "descartó el cartel y el cuadrito");
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    assert.strictEqual(data[3], 0, "la esquina queda transparente");
    assert.ok(data[((info.height >> 1) * info.width + (info.width >> 1)) * 4 + 3] === 255, "el centro de la botella queda opaco");
  });
  await t("una foto común (no de catálogo) no se recorta", async () => {
    const r = await photos.cutout(await plainPhoto());
    assert.strictEqual(r.cut, false);
  });
  await t("foto del producto: la oficial en alta por código de barras; si no hay, la de la caja", async () => {
    const hd = await photos.hdPhoto("7790290101602", {
      fetchJson: async (u) => (u.includes("carrefour") ? [{ items: [{ ean: "7790290101602", images: [{ imageUrl: "https://x/arquivos/ids/123/f.jpg" }] }] }] : null),
      fetchImage: async (u) => { assert.match(u, /ids\/123-800-800\//); return Buffer.alloc(20000, 1); },
    });
    assert.strictEqual(hd.source, "carrefour.com.ar");
    assert.strictEqual(await photos.hdPhoto("123"), null, "un código que no es EAN no se busca");
    const fromBox = await photos.productPhoto({ bucket, uid: T, hd: noHd }, { id: "fernet", barcode: "7790290101602", hasImage: true });
    assert.strictEqual(fromBox.source, "caja");
  });

  // ── Kit de marca ──
  await t("colores del logo y paleta: tienda online > logo > reserva; nunca un color prohibido", async () => {
    const lc = await brand.logoColors(logo);
    assert.ok(brand.luminance(lc.dark) < 0.01, `oscuro ${lc.dark}`);
    assert.ok(lc.vivid[0], "encuentra el amarillo");
    const p = brand.palette({ logo: lc });
    assert.strictEqual(p.accent, lc.vivid[0]);
    assert.strictEqual(p.accentInk, "#0b0b0b", "texto oscuro sobre amarillo");
    assert.strictEqual(brand.palette({ store: { primaryColor: "#7b2cbf" }, logo: lc }).accent, "#7b2cbf");
    assert.strictEqual(brand.palette({ store: { primaryColor: "#0E6E52" }, logo: lc }).accent, lc.vivid[0], "el color de fábrica de la tienda no cuenta");
    const noYellow = brand.palette({ logo: lc, tweaks: { bannedColors: ["amarillo"] } });
    assert.ok(!brand.isBanned(noYellow.accent, ["amarillo"]) && !brand.isBanned(noYellow.accent2, ["amarillo"]));
  });
  await t("kit: nombre y logo de la caja; si faltan, lo dice", async () => {
    const k = await brand.load({ sql, db, bucket }, T);
    assert.strictEqual(k.name, "ESCABIADOS");
    assert.ok(k.logo && k.logo.length > 100);
    assert.deepStrictEqual(k.needs, []);
    const o = await brand.load({ sql, db, bucket }, "otro");
    assert.deepStrictEqual(o.needs, ["nombre", "logo"]);
  });
  await t("aprende: reglas, precio más grande (con tope) y estilo preferido primero", async () => {
    const k = await brand.load({ sql, db, bucket }, T);
    const r = await brand.learnRule(db, T, k, "el precio más grande", { priceScale: 9 });
    assert.strictEqual(r.tweaks.priceScale, 1.6);
    await brand.recordPick(db, T, k, "invitacion");
    const k2 = await brand.load({ sql, db, bucket }, T);
    assert.deepStrictEqual(brand.styleOrder(k2), ["invitacion", "nocturno", "precio"]);
    assert.deepStrictEqual(k2.rules.map((x) => x.text), ["el precio más grande"]);
    await brand.save(db, T, { picks: {}, rules: [], tweaks: {} });
  });

  // ── Pedido ──
  const kitT = await brand.load({ sql, db, bucket }, T);
  await t("pedido: un producto con su precio; combo con precio propio muestra el ahorro", async () => {
    const one = await promo.prepare({ sql }, T, kitT, { productos: [{ buscar: "fernet 750" }] });
    assert.deepStrictEqual([one.plan.price, one.plan.oldPrice], [19500, null]);
    const combo = await promo.prepare({ sql }, T, kitT, { productos: [{ buscar: "fernet 750" }, { buscar: "coca 2.25" }], precio: 22900 });
    assert.deepStrictEqual([combo.plan.price, combo.plan.oldPrice], [22900, 24700]);
    assert.match(combo.result.ahorro, /\$ 1\.800 \(7%\)/);
    const noPrice = await promo.prepare({ sql }, T, kitT, { productos: [{ buscar: "fernet 750" }], con_precio: false });
    assert.strictEqual(noPrice.plan.price, null);
  });
  await t("pedido: varios parecidos o sin precio cargado → pregunta; sin nombre/logo → lo pide y guarda el pedido", async () => {
    const amb = await promo.prepare({ sql }, T, kitT, { productos: [{ buscar: "fernet branca" }] });
    assert.deepStrictEqual(amb.result.dudas[0].opciones.map((o) => o.id).sort(), ["fernet", "fernetl"]);
    const zero = await promo.prepare({ sql }, T, kitT, { productos: [{ buscar: "hielo" }] });
    assert.match(zero.result.dudas[0].problema, /no tienen precio/);
    const k = await brand.load({ sql, db, bucket }, "otro");
    const need = await promo.prepare({ sql }, "otro", k, { productos: [{ buscar: "fernet" }] });
    assert.deepStrictEqual(need.result.falta, ["nombre", "logo"]);
    assert.ok(need.pending);
  });

  // ── Diseño ──
  await t("diseño: precio exacto, logo, colores del kit y textos escapados", async () => {
    const c = await photos.cutout(photo);
    const prod = { buf: c.png, mime: "image/png", width: c.width, height: c.height, display: "Fernet Branca 750" };
    const spec = { style: "nocturno", colors: kitT.colors, tweaks: {}, logo: kitT.logo, products: [prod, prod], price: 22900, oldPrice: 24700, texts: { titulo: "<script>x</script>", etiqueta: "Combo" } };
    const h = designs.html(spec, "post");
    assert.match(h, /\$22\.900/);
    assert.match(h, /AHORRÁS \$1\.800/);
    assert.match(h, /ANTES \$24\.700/);
    assert.ok(h.includes(kitT.colors.accent));
    assert.ok(!h.includes("<script>x"), "los textos van escapados");
    assert.match(designs.html({ ...spec, price: null, oldPrice: null }, "story"), /PEDILO YA/);
    for (const s of designs.STYLES) for (const f of ["post", "story"]) assert.ok(designs.html({ ...spec, style: s }, f).length > 1000, `${s}/${f}`);
  });

  // ── Armado ──
  await t("armado: 3 opciones en el orden de lo que más elige, subidas y guardadas", async () => {
    drawn.length = 0;
    await brand.recordPick(db, T, kitT, "precio");
    const k = await brand.load({ sql, db, bucket }, T);
    const { plan } = await promo.prepare({ sql }, T, k, { productos: [{ buscar: "fernet 750" }], textos: { titulo: "Fernet Branca" } });
    const r = await promo.generate({ db, bucket, uid: T, kit: k, logger, renderImpl: fakeRender, photoImpl: (p) => photos.productPhoto({ bucket, uid: T, hd: noHd }, p) }, plan, { from: PHONE, now: NOW });
    assert.deepStrictEqual(r.variants.map((v) => v.style), ["precio", "nocturno", "invitacion"]);
    assert.ok(r.variants.every((v) => bucket.files[v.path] && /^https:\/\/firebasestorage/.test(v.url)));
    assert.strictEqual(drawn.length, 3);
    assert.deepStrictEqual(drawn[0].size, { width: 1080, height: 1080 });
    assert.ok(db.cols[promo.JOBS][r.id]);
    await brand.save(db, T, { picks: {} });
  });
  await t("armado: si un producto no tiene foto, avisa cuál", async () => {
    const { plan } = await promo.prepare({ sql }, T, kitT, { productos: [{ buscar: "alfajor triple" }] });
    const r = await promo.generate({ db, bucket, uid: T, kit: kitT, logger, renderImpl: fakeRender, photoImpl: (p) => photos.productPhoto({ bucket, uid: T, hd: noHd }, p) }, plan, { now: NOW });
    assert.deepStrictEqual(r.missing, ["ALFAJOR TRIPLE"]);
  });
  await t("tope diario de imágenes por comercio", async () => {
    const d = fakeDb();
    assert.ok(await promo.allow(d, T, promo.DAILY_LIMIT - 1, NOW));
    assert.ok(await promo.allow(d, T, 1, NOW));
    assert.ok(!(await promo.allow(d, T, 1, NOW)));
  });

  // ── Por WhatsApp ──
  const ACC = { plan: "full", paidUntil: NOW + 30 * 864e5 };
  db.cols.ventra_accounts = { [T]: ACC, otro: ACC };
  db.cols[waOwner.OWNERS] = { [PHONE]: { uid: T, userId: "u1", role: "ADMIN", lastInboundAt: NOW }, "5492219990000": { uid: "otro", userId: "u2", role: "ADMIN", lastInboundAt: NOW } };
  const sent = [];
  const deps = (cl) => ({
    ai, aiDeps: { db, logger, sql, client: cl }, sql, logger, bucket, renderImpl: fakeRender,
    send: async (to, text) => { sent.push({ to, text }); },
    sendButtons: async (to, text, buttons) => { sent.push({ to, text, buttons }); },
    sendImage: async (to, link, caption) => { sent.push({ to, image: link, caption }); },
    download: async (id) => (id === "logo-media" ? logo : photo),
    afterWrite: async () => {},
  });
  const inbox = () => db.cols[waOwner.INBOX] || {};
  const drain = async (cl, now = NOW) => { for (const id of Object.keys(inbox())) { const item = inbox()[id]; delete inbox()[id]; await waOwner.processInbox(db, item, deps(cl), now); } };
  const say = async (from, body, id, cl, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from, id, type: "text", text: { body } }, now); await drain(cl, now); };
  const tap = async (from, payload, id, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from, id, type: "interactive", interactive: { button_reply: { id: payload } } }, now); await drain(null, now); };
  const pic = async (from, mediaId, id, caption, cl, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from, id, type: "image", image: { id: mediaId, mime_type: "image/jpeg", caption } }, now); await drain(cl, now); };
  // Fotos de la caja: sin red (los productos de prueba no tienen código de barras)

  await t("pide una imagen: avisa, manda 3 imágenes y los botones para elegir", async () => {
    sent.length = 0;
    const cl = client([{ name: "crear_imagen", input: { productos: [{ buscar: "fernet 750" }], textos: { etiqueta: "Promo del finde", titulo: "Fernet Branca" } } }]);
    await say(PHONE, "haceme una imagen del fernet 750 con precio", "m1", cl);
    assert.ok(cl.reqs[0].tools.some((x) => x.name === "crear_imagen"), "la IA tiene la herramienta");
    assert.match(cl.reqs[0].system[0].text, /Imágenes de promos/);
    assert.match(sent[0].text, /Armando 3 opciones con el estilo de \*ESCABIADOS\*/);
    const imgs = sent.filter((s) => s.image);
    assert.deepStrictEqual(imgs.map((s) => s.caption), ["Opción 1 · Nocturno", "Opción 2 · Precio protagonista", "Opción 3 · Invitación"]);
    assert.deepStrictEqual(sent.at(-1).buttons.map((b) => b.title), ["La 1", "La 2", "La 3"]);
    assert.ok(db.cols[waOwner.OWNERS][PHONE].lastImage.id);
  });
  await t("elige 'la 2' escrito: suma el voto y manda la historia", async () => {
    drawn.length = 0;
    await say(PHONE, "la 2", "m2", null, NOW + 60e3);
    assert.match(sent.at(-2).text, /estilo \*Precio protagonista\*/);
    assert.ok(sent.at(-1).image, "manda la versión historia");
    assert.deepStrictEqual(drawn[0].size, { width: 1080, height: 1920 });
    assert.strictEqual(db.cols[brand.KITS][T].picks.precio, 1);
    await say(PHONE, "la 2", "m3", null, NOW + 61e3);
    assert.match(sent.at(-1).text, /ya la elegiste/);
  });
  await t("corrige el estilo: guarda la regla y vuelve a armar con ese estilo", async () => {
    const cl = client([
      { name: "ajustar_estilo", input: { regla: "el precio más grande", precio_mas_grande: true } },
      { name: "crear_imagen", input: { productos: [{ buscar: "fernet 750" }], estilo: "precio" } },
    ]);
    drawn.length = 0;
    await say(PHONE, "me gusta la 2 pero con el precio más grande", "m4", cl, NOW + 120e3);
    assert.ok(db.cols[brand.KITS][T].tweaks.priceScale > 1);
    assert.strictEqual(drawn.length, 1, "arma solo el estilo elegido");
    assert.match(drawn[0].html, /--ps:1\.18/);
    assert.match(sent.at(-1).text, /Te sirve/);
  });
  await t("combo con precio: el ahorro sale en la imagen", async () => {
    drawn.length = 0;
    const cl = client([{ name: "crear_imagen", input: { productos: [{ buscar: "fernet 750" }, { buscar: "coca" }], precio: 22900, textos: { titulo: "Combo Fernandito" } } }]);
    await say(PHONE, "armá la promo de un fernet más una coca a 22900", "m5", cl, NOW + 180e3);
    assert.ok(drawn.every((d) => /\$22\.900/.test(d.html)));
    assert.ok(drawn.some((d) => /AHORRÁS \$1\.800/.test(d.html)));
  });
  await t("sin nombre ni logo: lo pide; con el nombre y la foto del logo, sigue solo con el pedido", async () => {
    const OTHER = "5492219990000";
    sent.length = 0;
    // 1. Pide la imagen: la herramienta dice qué falta y guarda el pedido
    await say(OTHER, "haceme una imagen del fernet", "o1", client([{ name: "crear_imagen", input: { productos: [{ buscar: "fernet" }] } }], "¿Cómo se llama el comercio? Y mandame una foto del logo."), NOW);
    assert.ok(db.cols[brand.KITS].otro.pendingRequest);
    assert.strictEqual(db.cols[brand.KITS].otro.awaitingLogo, true);
    assert.ok(!sent.some((s) => s.image));
    // 2. El nombre
    await say(OTHER, "Kiosco Lo de Tito", "o2", client([{ name: "guardar_marca", input: { nombre: "Kiosco Lo de Tito" } }], "¡Gracias! Ahora mandame la foto del logo."), NOW + 10e3);
    assert.strictEqual(db.cols[brand.KITS].otro.name, "Kiosco Lo de Tito");
    // 3. La foto del logo: la guarda y arma el pedido que esperaba
    drawn.length = 0;
    await pic(OTHER, "logo-media", "o3", "", null, NOW + 20e3);
    assert.ok(bucket.files["tenants/otro/brand/logo.png"], "guardó el logo");
    assert.match(sent.find((s) => /Guardé el logo/.test(s.text || "")).text, /saqué sus colores/);
    assert.match(sent.find((s) => /Armando/.test(s.text || "")).text, /Ahora sí.*Kiosco Lo de Tito/);
    assert.strictEqual(sent.filter((s) => s.image).length, 3);
    assert.ok(!db.cols[brand.KITS].otro.pendingRequest);
  });
  await t("una foto suelta: pregunta qué hacer; 'usala para el fernet' la usa en la imagen", async () => {
    sent.length = 0;
    await pic(PHONE, "foto-media", "p1", "", null, NOW + 300e3);
    assert.match(sent.at(-1).text, /Recibí la foto. ¿Qué es?/);
    assert.deepStrictEqual(sent.at(-1).buttons.map((b) => b.title), ["Boleta o factura", "Logo del comercio", "Otra cosa"]);
    const cl = client([{ name: "crear_imagen", input: { productos: [{ buscar: "fernet 750", usar_ultima_foto: true }] } }]);
    await say(PHONE, "usala para el fernet 750", "p2", cl, NOW + 310e3);
    assert.strictEqual(sent.filter((s) => s.image).length, 3);
  });
  await t("el encargado no tiene las herramientas de imágenes", async () => {
    db.cols[waOwner.OWNERS][PHONE].role = "SUPERVISOR";
    db.cols.ventra_wa_settings = { [T]: { supervisors: true } };
    const cl = client([], "Eso lo hace el dueño.");
    await say(PHONE, "haceme una imagen", "s1", cl, NOW + 400e3);
    assert.ok(!cl.reqs[0].tools.some((x) => x.name === "crear_imagen"));
    db.cols[waOwner.OWNERS][PHONE].role = "ADMIN";
  });

  // ── Dibujo de verdad (Chrome de la PC) ──
  await t("dibuja de verdad: JPG de 1080 × 1080 con Chrome", async () => {
    const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", process.env.CHROME_PATH].filter(Boolean).find((p) => fs.existsSync(p));
    if (!chrome) return "skip";
    const { render, close } = require("../functions/promo-images/render");
    const c = await photos.cutout(photo);
    const jpg = await render(designs.html({ style: "nocturno", colors: kitT.colors, tweaks: {}, logo: kitT.logo, products: [{ buf: c.png, mime: "image/png", width: c.width, height: c.height, display: "Fernet" }], price: 19500, texts: { titulo: "Fernet Branca" } }, "post"), designs.FORMATS.post);
    await close();
    const m = await sharp(jpg).metadata();
    assert.deepStrictEqual([m.format, m.width, m.height], ["jpeg", 1080, 1080]);
  });

  console.log(`\n${ok} bien, ${bad} mal${skipped ? `, ${skipped} salteados` : ""}`);
  process.exit(bad ? 1 : 0);
})();
