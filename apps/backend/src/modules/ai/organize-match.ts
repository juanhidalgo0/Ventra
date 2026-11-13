/**
 * Organizar automáticamente: cómo se reconoce que dos nombres son la misma categoría o la misma
 * marca, para reusar lo que ya existe en vez de duplicarlo. Funciones puras (ver scripts/test-organize.ts).
 *
 *   "Gaseosa" = "GASEOSAS" = "gaseósas"         "Lácteos" = "Lacteo"        "Fiambres" = "Fiambre"
 *   "Coca-Cola" = "Coca Cola" = "COCACOLA"      "La Serenísima" = "Serenisima"
 */

const plain = (s: string) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/** Una palabra en singular, aproximado (alcanza para comparar: no se muestra) */
const singular = (w: string) => (w.length > 3 ? w.replace(/(es|s)$/, '').replace(/e$/, '') : w);

/** Clave de una categoría: sin tildes, mayúsculas ni plurales */
export function categoryKey(name: string): string {
  return plain(name).split(' ').filter(Boolean).map(singular).join(' ');
}

const ARTICLES = new Set(['la', 'el', 'los', 'las']);

/** Clave de una marca: sin tildes, espacios, guiones ni artículo adelante */
export function brandKey(name: string): string {
  const words = plain(name).split(' ').filter(Boolean);
  if (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.join('');
}

/** Palabras de un nombre de producto, para buscar marcas adentro ("GALL.OREO 118G" → galletitas…) */
export function nameWords(name: string): string[] {
  return plain(name).split(' ').filter(Boolean);
}

/**
 * La marca existente que aparece en el nombre del producto (como palabras enteras), la más larga.
 * Sirve para sugerir sin IA: "ALFAJOR JORGITO CHOCOLATE" → "Jorgito".
 */
export function brandInName<T extends { name: string }>(productName: string, brands: T[]): T | null {
  const hay = ` ${nameWords(productName).join(' ')} `;
  const glued = nameWords(productName).join('');
  let best: T | null = null;
  let bestLen = 0;
  for (const b of brands) {
    const words = nameWords(b.name);
    if (words.length > 1 && ARTICLES.has(words[0])) words.shift();
    const phrase = words.join(' ');
    if (phrase.length < 3) continue;
    // "COCA COLA" o "COCACOLA" en el nombre
    const found = hay.includes(` ${phrase} `) || (words.length > 1 && phrase.replace(/ /g, '').length >= 6 && glued.includes(phrase.replace(/ /g, '')));
    if (found && phrase.length > bestLen) { best = b; bestLen = phrase.length; }
  }
  return best;
}

/** Nombre prolijo para algo nuevo que sugirió la IA: "gaseosas" → "Gaseosas" (las marcas van como vienen) */
export function tidyName(name: string): string {
  const s = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!s) return '';
  return s === s.toUpperCase() || s === s.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

/**
 * Lo más votado entre productos parecidos ya ordenados: si al menos 2 y 60 % coinciden.
 * Pura: recibe los valores (ids de categoría) de los vecinos.
 */
export function majority(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const v of values) { if (!v) continue; total++; counts.set(v, (counts.get(v) || 0) + 1); }
  let best: string | null = null; let n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return best && n >= 2 && n / total >= 0.6 ? best : null;
}

/** Muestra pareja de una lista (para que la IA vea de todo un poco al armar el árbol) */
export function spreadSample<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list.slice();
  const out: T[] = [];
  const step = list.length / max;
  for (let k = 0; k < max; k++) out.push(list[Math.floor(k * step)]);
  return out;
}
