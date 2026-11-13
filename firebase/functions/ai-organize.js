// ═══════════════════════════════════════════════════
// "Organizar automáticamente" (ventraAi, kind "organize"): la IA ordena los productos de un
// comercio en categorías, subcategorías y marcas. La PC manda los nombres; la IA solo sugiere,
// la caja muestra una vista previa y el dueño acepta o desmarca (y puede deshacer).
//
//  - "plan":  una muestra de nombres del catálogo + las categorías que ya tiene el comercio →
//             el árbol de categorías del comercio (reusa las que hay, suma las que faltan).
//             Así todas las tandas usan los mismos nombres y no aparecen "Gaseosa" y "Gaseosas".
//  - "items": hasta 100 productos (de a 50 en paralelo) → categoría, subcategoría y marca de cada uno,
//             eligiendo del árbol y de las marcas que ya usa el comercio.
//
// Haiku (aprobado por el dueño): ~US$ 0,05 cada 1.000 productos. Cada producto cuenta 1; el plan, 1.
// ═══════════════════════════════════════════════════

const ORGANIZE_ITEMS_MAX = 100; // productos por pedido de la PC
const ORGANIZE_CHUNK = 50;      // productos por consulta a la IA (en paralelo)
const ORGANIZE_SAMPLE_MAX = 400; // nombres de muestra para armar el árbol
const TREE_MAX = 80;            // categorías principales
const SUBS_MAX = 40;            // subcategorías por categoría
const BRANDS_MAX = 1500;

const clip = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

const PLAN_SYSTEM = `Armás el árbol de categorías de los productos de un comercio de Argentina, para su caja y su tienda online.

Te paso el rubro del comercio, las categorías que ya tiene cargadas (pueden estar desordenadas) y una muestra de los nombres de sus productos (a veces abreviados, en mayúsculas, copiados de la boleta del proveedor).

Devolvé el árbol: categorías principales, cada una con sus subcategorías.
Reglas:
- Reusá las categorías que ya existen con el MISMO nombre exacto (mayúsculas, tildes) siempre que tengan sentido: el dueño ya las conoce. Si hay dos que son lo mismo ("Gaseosa" y "Gaseosas", "Golosina" y "Golosinas"), quedate con una sola.
- Si una categoría existente es en realidad una subcategoría de otra (por ejemplo "Gaseosas" y "Bebidas"), ponela como subcategoría.
- Sumá solo las categorías que hacen falta para los productos de la muestra. Nombres cortos, en plural, como los usa un supermercado o un mayorista argentino: "Bebidas", "Almacén", "Golosinas", "Galletitas", "Lácteos", "Fiambres", "Limpieza", "Perfumería", "Cigarrillos", "Kiosco", "Librería", "Bazar", "Congelados", "Panadería", "Verdulería", "Carnicería", "Mascotas", "Bebidas alcohólicas".
- Entre 4 y 25 categorías principales según el tamaño del catálogo; de 0 a 15 subcategorías cada una ("Bebidas": "Gaseosas", "Aguas", "Jugos", "Energizantes"…). No hagas subcategorías de un solo producto.
- Cada nombre aparece una sola vez en todo el árbol (una subcategoría no puede llamarse igual que otra categoría).
- No uses marcas como categorías (nada de "Coca-Cola" o "Arcor" como categoría).
- Usá el idioma y las palabras de Argentina ("Galletitas", no "Galletas"; "Fiambres", no "Embutidos"; "Gaseosas", no "Refrescos").`;

const PLAN_SCHEMA = {
  type: "object",
  properties: { categorias: { type: "array", items: { type: "object", properties: {
    nombre: { type: "string" }, subcategorias: { type: "array", items: { type: "string" } },
  }, required: ["nombre", "subcategorias"], additionalProperties: false } } },
  required: ["categorias"], additionalProperties: false,
};

const ITEMS_SYSTEM = `Ordenás los productos de un comercio de Argentina: para cada uno elegís categoría, subcategoría y marca. Los nombres vienen como están cargados en la caja (a veces abreviados, en mayúsculas, con códigos, "X12", "UN", copiados de la boleta del proveedor).

Categoría y subcategoría:
- Elegí del árbol de categorías del comercio que te paso, escribiendo los nombres EXACTAMENTE como están ahí.
- "subcategoria" tiene que ser una de las subcategorías de esa categoría, o "" si ninguna le queda bien.
- Solo si ninguna categoría del árbol le sirve al producto, inventá una nueva (nombre corto, en plural, como en un supermercado argentino). Nunca crees una casi igual a una que ya está ("Gaseosa" si existe "Gaseosas").
- Pensá qué es el producto: "ALF JORGITO" es un alfajor (Golosinas o Alfajores), "GALL.OREO" son galletitas, "LAV.AYUDIN" es lavandina (Limpieza), "SPRITE 2.25" es una gaseosa, "QUILMES 1L" es cerveza, "MARLBORO BOX 20" son cigarrillos, "PAN LACTAL BIMBO" es panificado.

Marca:
- La marca que se lee en el envase y que el cliente reconoce: "Oreo" (no "Mondelez"), "Sprite" (no "Coca-Cola"), "La Serenísima", "Arcor", "Jorgito", "Marlboro".
- Si la marca ya está en la lista de marcas del comercio, escribila EXACTAMENTE como está en la lista (aunque en el nombre del producto esté abreviada o en mayúsculas).
- Desarmá abreviaturas conocidas: "CC" o "COCA" en gaseosas = "Coca-Cola", "SERENISIMA" o "LS" en lácteos = "La Serenísima", "PAPEL HIG. ELITE" = "Elite".
- Escribila bien: con mayúsculas y minúsculas, tildes y guiones como la escribe la marca ("Coca-Cola", "Bon o Bon", "7up" → "7Up").
- "" si el producto no tiene marca (fiambre o queso suelto, verdura, fruta, pan del día, carne, comida preparada, un servicio) o si no se puede saber cuál es. NUNCA inventes una marca: el tipo de producto, el sabor, el tamaño o el proveedor no son marcas.

"segura": true solo si estás seguro de las tres cosas. false si dudaste en alguna (nombre raro, producto que podría ir en dos lugares, marca que no se entiende).`;

const ITEMS_SCHEMA = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object", properties: {
    i: { type: "integer" }, categoria: { type: "string" }, subcategoria: { type: "string" },
    marca: { type: "string" }, segura: { type: "boolean" },
  }, required: ["i", "categoria", "subcategoria", "marca", "segura"], additionalProperties: false } } },
  required: ["items"], additionalProperties: false,
};

/** El árbol que manda la PC (o el que armó "plan"), limpio y acotado. Pura. */
function cleanTree(tree) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(tree) ? tree : []) {
    const name = clip(c && (c.name || c.nombre), 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const subs = [];
    for (const s of Array.isArray(c.subs || c.subcategorias) ? (c.subs || c.subcategorias) : []) {
      const sn = clip(s, 60);
      if (!sn || seen.has(sn.toLowerCase())) continue;
      seen.add(sn.toLowerCase());
      subs.push(sn);
      if (subs.length >= SUBS_MAX) break;
    }
    out.push({ name, subs });
    if (out.length >= TREE_MAX) break;
  }
  return out;
}

const treeText = (tree) => tree.length
  ? tree.map((c) => `- ${c.name}${c.subs.length ? `: ${c.subs.join(", ")}` : ""}`).join("\n")
  : "(todavía no tiene categorías)";

/** Cuántos usos cuenta un pedido de organize (lo que se reserva del cupo). Pura. */
function organizeCount(body) {
  if (body && body.step === "plan") return 1;
  const items = Array.isArray(body && body.items) ? body.items : [];
  return Math.min(items.length, ORGANIZE_ITEMS_MAX);
}

const addUsage = (usage, u = {}) => {
  for (const k of ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"]) usage[k] = (usage[k] || 0) + (u[k] || 0);
};

/**
 * @param jsonCall  (client, req) → { out, usage }  (el de ai.js: misma forma de llamar y de fallar)
 * @param AiError   el error con status de ai.js
 */
async function organize(client, body, { jsonCall, AiError, model }) {
  const rubro = clip(body.rubro, 80);
  if (body.step === "plan") {
    const names = (Array.isArray(body.names) ? body.names : []).map((n) => clip(n, 100)).filter(Boolean).slice(0, ORGANIZE_SAMPLE_MAX);
    if (!names.length) throw new AiError(400, "EMPTY", "No hay productos para organizar.");
    const existing = (Array.isArray(body.categories) ? body.categories : []).slice(0, 400)
      .map((c) => ({ name: clip(c && c.name, 60), parent: clip(c && c.parent, 60), count: Number(c && c.count) || 0 })).filter((c) => c.name);
    const { out, usage } = await jsonCall(client, {
      model, max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      system: PLAN_SYSTEM,
      messages: [{ role: "user", content: [
        `Rubro del comercio: ${rubro || "comercio de barrio (kiosco / almacén)"}`,
        `Categorías que ya tiene (${existing.length}):\n${existing.length ? existing.map((c) => `- ${c.parent ? `${c.parent} › ` : ""}${c.name}${c.count ? ` (${c.count} productos)` : ""}`).join("\n") : "(ninguna)"}`,
        `Muestra de ${names.length} productos:\n${names.join("\n")}`,
      ].join("\n\n") }],
    });
    return { result: { tree: cleanTree(out.categorias) }, usage, count: 1 };
  }
  if (body.step === "items") {
    const list = (Array.isArray(body.items) ? body.items : []).slice(0, ORGANIZE_ITEMS_MAX)
      .map((x, i) => ({ i, n: clip(x && x.name, 120), hint: clip(x && x.category, 80) })).filter((x) => x.n);
    if (!list.length) throw new AiError(400, "EMPTY", "No hay productos para organizar.");
    const tree = cleanTree(body.tree);
    const brands = (Array.isArray(body.brands) ? body.brands : []).map((b) => clip(b, 50)).filter(Boolean).slice(0, BRANDS_MAX);
    // Lo mismo en todas las consultas (rubro, árbol y marcas): va primero y cacheado
    const context = {
      type: "text",
      text: `Rubro del comercio: ${rubro || "comercio de barrio (kiosco / almacén)"}\n\nÁrbol de categorías del comercio:\n${treeText(tree)}\n\nMarcas que ya usa el comercio:\n${brands.length ? brands.join(", ") : "(ninguna todavía)"}`,
      cache_control: { type: "ephemeral" },
    };
    const chunks = [];
    for (let k = 0; k < list.length; k += ORGANIZE_CHUNK) chunks.push(list.slice(k, k + ORGANIZE_CHUNK));
    const usage = {};
    const byI = new Map();
    const results = await Promise.all(chunks.map((part) => jsonCall(client, {
      model, max_tokens: 12000,
      output_config: { effort: "low", format: { type: "json_schema", schema: ITEMS_SCHEMA } },
      system: ITEMS_SYSTEM,
      messages: [{ role: "user", content: [context, {
        type: "text",
        text: `Productos:\n${part.map((x, j) => `${j}. ${x.n}${x.hint ? ` (hoy en: ${x.hint})` : ""}`).join("\n")}`,
      }] }],
    }).then((r) => ({ part, ...r }))));
    for (const { part, out, usage: u } of results) {
      for (const x of out.items || []) {
        const p = part[x.i];
        if (!p) continue;
        const category = clip(x.categoria, 60);
        let subcategory = clip(x.subcategoria, 60);
        if (subcategory && subcategory.toLowerCase() === category.toLowerCase()) subcategory = "";
        byI.set(p.i, { category, subcategory: category ? subcategory : "", brand: clip(x.marca, 50), sure: !!x.segura });
      }
      addUsage(usage, u);
    }
    // Lo que la IA no devolvió queda sin sugerencia (la caja no lo toca)
    return {
      result: { items: list.map((x) => ({ i: x.i, ...(byI.get(x.i) || { category: "", subcategory: "", brand: "", sure: false }) })) },
      usage, count: list.length,
    };
  }
  throw new AiError(400, "BAD_STEP", "Pedido inválido");
}

module.exports = { organize, organizeCount, cleanTree, ORGANIZE_ITEMS_MAX, ORGANIZE_CHUNK, ORGANIZE_SAMPLE_MAX, ITEMS_SYSTEM, PLAN_SYSTEM };
