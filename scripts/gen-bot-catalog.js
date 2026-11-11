// ═══════════════════════════════════════════════════
// Catálogo de operaciones de Ventra para el bot de WhatsApp del dueño.
//
// Lee los controladores del backend (apps/backend/src/modules/**/*.controller.ts) y escribe
// firebase/functions/ventra-api/catalog.json: una entrada por endpoint con método, ruta,
// descripción (los comentarios), parámetros, el formato del cuerpo si está escrito, y el código
// del controlador y del servicio que lo atiende (así la IA ve qué campos usa de verdad, porque
// casi todos reciben el cuerpo como `any`).
//
// Hay que volver a generarlo cuando cambian los controladores:
//   node scripts/gen-bot-catalog.js
// ═══════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODULES = path.join(ROOT, "apps/backend/src/modules");
const OUT = path.join(ROOT, "firebase/functions/ventra-api/catalog.json");
const MAX_SNIPPET = 5200;
const SCHEMA = fs.readFileSync(path.join(ROOT, "apps/backend/prisma/schema.prisma"), "utf8");

/** Lo que el bot nunca puede tocar (además de lo que pide un archivo) */
const DENY = [
  /^\/api\/auth(\/|$)/, /^\/api\/sync(\/|$)/, /^\/api\/system(\/|$)/, /^\/api\/demo(\/|$)/,
  /^\/api\/subscription(\/|$)/, /^\/api\/notifications(\/|$)/, /^\/api\/ai(\/|$)/,
  /^\/api\/users\/[^/]+\/password/, /^\/api\/settings\/license/, /^\/api\/mercadopago\/(credentials|connect|oauth)/,
  /^\/api\/pos-trail(\/|$)/,
];

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/** Desde `start` (que apunta a un "{"), devuelve el bloque hasta su "}" (saltea textos y comentarios) */
function block(src, start) {
  let depth = 0, i = start, q = null;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === "'" || c === '"' || c === "`") { q = c; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Los comentarios justo antes de una posición (/** *\/ y //), sin los decoradores */
function commentBefore(src, pos) {
  const before = src.slice(Math.max(0, pos - 1500), pos).replace(/\s*@\w+\([^)]*\)\s*$/g, "");
  const m = /(\/\*\*[\s\S]*?\*\/|(?:\s*\/\/[^\n]*\n)+)\s*$/.exec(before);
  if (!m) return "";
  return m[1].replace(/^\s*\/\*\*|\*\/\s*$/g, "").replace(/^\s*(\*|\/\/)\s?/gm, "").replace(/\s+/g, " ").trim();
}

/** model Promotion { … } por el nombre que usa Prisma en el código (promotion, cashRegisterSession) */
function prismaModel(clientName) {
  const model = clientName[0].toUpperCase() + clientName.slice(1);
  const m = new RegExp(`\\nmodel ${model} \\{`).exec(SCHEMA);
  if (!m) return null;
  const body = block(SCHEMA, m.index + m[0].length - 1);
  // Solo los campos: sin relaciones (tipos que son otro modelo) ni índices
  const SCALARS = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "Decimal", "BigInt", "Bytes"]);
  const lines = body.split("\n").filter((l) => {
    if (/^\s*@@/.test(l)) return false;
    const f = /^\s*\w+\s+([A-Z]\w*)/.exec(l);
    return !f || SCALARS.has(f[1]);
  });
  return `model ${model} ${lines.join("\n")}`;
}

function serviceMethod(serviceFiles, name) {
  for (const f of serviceFiles) {
    const src = fs.readFileSync(f, "utf8");
    const re = new RegExp(`\\n\\s*(?:public\\s+|private\\s+)?(?:async\\s+)?${name}\\s*\\(`, "g");
    const m = re.exec(src);
    if (!m) continue;
    const open = src.indexOf("{", src.indexOf(")", m.index));
    // La firma puede tener tipos con llaves: se busca la llave que abre el cuerpo después del ")" final
    let sigEnd = m.index + m[0].length, depth = 1;
    for (; sigEnd < src.length && depth; sigEnd++) { if (src[sigEnd] === "(") depth++; else if (src[sigEnd] === ")") depth--; }
    const bodyStart = src.indexOf("{", sigEnd);
    const code = src.slice(m.index + 1, bodyStart) + block(src, bodyStart >= 0 ? bodyStart : open);
    return { file: path.relative(ROOT, f).replace(/\\/g, "/"), code };
  }
  return null;
}

const entries = [];
for (const file of walk(MODULES).filter((f) => f.endsWith(".controller.ts"))) {
  const src = fs.readFileSync(file, "utf8");
  const ctl = /@Controller\(\s*['"`]([^'"`]*)['"`]\s*\)/.exec(src);
  if (!ctl) continue;
  const prefix = `/api/${ctl[1]}`.replace(/\/+$/, "");
  const dir = path.dirname(file);
  const serviceFiles = walk(dir).filter((f) => f.endsWith(".service.ts"));
  const classRoles = /@Roles\(([^)]*)\)\s*(?:@\w+\([^)]*\)\s*)*export class/.exec(src);
  const re = /@(Get|Post|Patch|Put|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const route = m[2] ? `${prefix}/${m[2]}`.replace(/\/+/g, "/") : prefix;
    // Decoradores que siguen (roles, archivos) y la firma del método
    const after = src.slice(m.index + m[0].length);
    const sig = /^((?:\s*@\w+\([^)]*(?:\([^)]*\))?[^)]*\))*)\s*(?:async\s+)?(\w+)\s*\(/.exec(after);
    if (!sig) continue;
    const decorators = sig[1];
    const name = sig[2];
    const sigStart = m.index + m[0].length + sig[0].length - 1;
    let depth = 1, i = sigStart + 1;
    for (; i < src.length && depth; i++) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; }
    const params = src.slice(sigStart + 1, i - 1);
    const bodyStart = src.indexOf("{", i);
    const handler = block(src, bodyStart);
    const uploads = /UploadedFile|FileInterceptor|FilesInterceptor|@Res\(/.test(decorators + params);
    const roles = (/@Roles\(([^)]*)\)/.exec(decorators) || classRoles || [])[1] || null;
    const query = [...params.matchAll(/@Query\(\s*['"`](\w+)['"`]\s*\)/g)].map((q) => q[1]);
    const bodyType = (/@Body\(\)\s*\w+\s*:\s*([^,)]*(?:\{[^}]*\})?)/.exec(params) || [])[1] || null;
    const calls = [...handler.matchAll(/this\.(\w+)\.(\w+)\(/g)].map((c) => c[2]).filter((n, k, a) => a.indexOf(n) === k).slice(0, 2);
    const services = calls.map((c) => serviceMethod(serviceFiles, c)).filter(Boolean);
    // Funciones del propio controlador que usa (por ejemplo clean(), que elige los campos)
    for (const h of [...handler.matchAll(/this\.(\w+)\(/g)].map((x) => x[1]).filter((n, k, a) => a.indexOf(n) === k)) {
      const own = serviceMethod([file], h);
      if (own) services.push(own);
    }
    // Las tablas que crea o cambia: sus campos, con los comentarios que dicen qué valores van
    const touched = ([handler, ...services.map((x) => x.code)].join("\n").match(/(?:prisma|tx)\.(\w+)\.(?:create|update|upsert|createMany|updateMany)\b/g) || [])
      .map((x) => x.split(".")[1]).filter((n, k, a) => a.indexOf(n) === k).slice(0, 3);
    const models = touched.map(prismaModel).filter(Boolean);
    const comment = commentBefore(src, m.index);
    let code = `// ${path.relative(ROOT, file).replace(/\\/g, "/")}\n${name}(${params.replace(/\s+/g, " ").trim()}) ${handler}`;
    // La tabla primero: si el código es largo y se recorta, los campos quedan
    for (const md of models) code = code.replace(/\n/, `\n// Tabla (apps/backend/prisma/schema.prisma)\n${md}\n\n`);
    for (const s of services) code += `\n\n// ${s.file}\n${s.code}`;
    const id = `${method} ${route}`;
    entries.push({
      id, method, path: route, name, description: comment || null,
      params: [...route.matchAll(/:(\w+)/g)].map((p) => p[1]), query,
      body: bodyType && bodyType.trim() !== "any" ? bodyType.replace(/\s+/g, " ").trim() : (/@Body\(/.test(params) ? "any (ver código)" : null),
      roles: roles ? roles.replace(/['"\s]/g, "") : null,
      blocked: uploads ? "archivo" : DENY.some((d) => d.test(route)) ? "protegido" : null,
      code: code.length > MAX_SNIPPET ? `${code.slice(0, MAX_SNIPPET)}\n…(recortado)` : code,
    });
  }
}
entries.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, entries }, null, 0));
const blocked = entries.filter((e) => e.blocked).length;
console.log(`Catálogo: ${entries.length} operaciones (${blocked} bloqueadas para el bot) → ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
