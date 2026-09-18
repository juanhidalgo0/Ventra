import axios from 'axios';
import { createHash } from 'crypto';
import { Jimp } from 'jimp';

/**
 * Búsqueda de fotos para productos sin código de barras (ferretería).
 *
 * No usa IA: la precisión sale de
 *  1. agrupar las medidas de un mismo artículo (una foto por familia),
 *  2. armar la búsqueda con nombre expandido + marca,
 *  3. puntuar cada candidata por texto (sustantivo principal, palabras, marca),
 *  4. descartar imágenes de relleno y repetidas, y preferir fotos de catálogo
 *     (fondo blanco).
 * Lo dudoso no se asigna solo: queda para revisión.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Normalización de nombres
// ---------------------------------------------------------------------------

const ABBREVIATIONS: Record<string, string> = {
  GALVA: 'GALVANIZADO', GALV: 'GALVANIZADO', HEXA: 'HEXAGONAL', HEX: 'HEXAGONAL',
  AUTOFRENAN: 'AUTOFRENANTE', AUTOPERF: 'AUTOPERFORANTE', AUTOPERFOR: 'AUTOPERFORANTE',
  FRES: 'FRESADA', ALUM: 'ALUMINIO', INOX: 'INOXIDABLE', BCE: 'BRONCE', BRON: 'BRONCE',
  PLAST: 'PLASTICO', PLAS: 'PLASTICO', ELECT: 'ELECTRICO', ELEC: 'ELECTRICO',
  TERMOF: 'TERMOFUSION', DESTOR: 'DESTORNILLADOR', DEST: 'DESTORNILLADOR',
  MANG: 'MANGUERA', ADAPT: 'ADAPTADOR', REDUC: 'REDUCCION', CANO: 'CAÑO',
  ESMAL: 'ESMALTE', PINT: 'PINTURA', UNIV: 'UNIVERSAL', REG: 'REGULABLE', AJUST: 'AJUSTABLE',
};

const PREFIX_EXPANSIONS: [RegExp, string][] = [
  [/\bC\//g, ' CON '], [/\bS\//g, ' SIN '], [/\bP\//g, ' PARA '], [/\bX\s+/g, ' X '],
];

const STOPWORDS = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'CON', 'SIN', 'PARA', 'Y', 'EN', 'X', 'POR', 'A', 'AL', 'UN', 'UNA',
  'UNIDAD', 'UNIDADES', 'UN', 'UND', 'UNID', 'PACK', 'CAJA', 'BLISTER', 'SET', 'KIT', 'NUEVO', 'NUEVA', 'LINEA',
  'TIPO', 'MOD', 'MODELO', 'COLOR', 'VARIOS', 'SURTIDO', 'SURTIDOS', 'GRANDE', 'CHICO', 'CHICA', 'MEDIANO',
]);

// Quita acentos pero conserva la Ñ (NFD la separaría en N + tilde)
const deaccent = (s: string) =>
  s.split('Ñ').map(part => part.normalize('NFD').replace(/\p{M}/gu, '')).join('Ñ');

/** Mayúsculas, sin acentos (conserva la Ñ), abreviaturas expandidas. */
export function normalizeText(s: string): string {
  let t = deaccent(` ${(s || '').toUpperCase()} `);
  for (const [re, rep] of PREFIX_EXPANSIONS) t = t.replace(re, rep);
  t = t.replace(/[.,;:()"'`´\-_+*#!?¡¿\[\]{}|]/g, ' ');
  return t
    .split(/\s+/)
    .filter(Boolean)
    .map(w => ABBREVIATIONS[w] || w)
    .join(' ');
}

const MEASURE_RE = /\b\d+([.,]\d+)?\s*(MM|CM|MTS?|M|LTS?|LT|L|KG|KGS|GRS?|GR|G|CC|ML|W|V|HP|AMP?|A|PULG|"|MTR)\b/g;
const FRACTION_RE = /\b\d+\s*\/\s*\d+"?/g;
const DIMENSION_RE = /\b\d+([.,]\d+)?\s*X\s*\d+([.,]\d+)?\b/g;
const NUMBER_RE = /\b(N|NRO|NO|N°|Nº)?\s*\d+([.,]\d+)?\b/g;

/** Nombre sin medidas ni números: identifica el artículo sin importar el tamaño. */
export function stripMeasures(name: string): string {
  return normalizeText(name)
    .replace(DIMENSION_RE, ' ')
    .replace(FRACTION_RE, ' ')
    .replace(MEASURE_RE, ' ')
    .replace(NUMBER_RE, ' ')
    .replace(/[^A-ZÑ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function familyKey(name: string, brand?: string | null): string {
  const b = brand ? normalizeText(brand) : '';
  return `${stripMeasures(name)}|${b}`;
}

/** Palabras significativas (sin stopwords ni palabras de 1 letra). */
export function significantTokens(s: string): string[] {
  return stripMeasures(s).split(' ').filter(w => w.length >= 2 && !STOPWORDS.has(w));
}

/** Compara palabras tolerando plural/singular y género (TUERCA/TUERCAS, BLANCO/BLANCA). */
function stem(w: string): string {
  if (w.length <= 4) return w;
  return w.replace(/(ES|S)$/, '').replace(/[AO]$/, '');
}

// ---------------------------------------------------------------------------
// Fuentes
// ---------------------------------------------------------------------------

export interface ImageCandidate {
  url: string;
  thumb: string;
  title: string;
  source: string;
  brand?: string;
  pageUrl?: string;
  // Calculados
  textScore?: number;
  headMatch?: boolean;
  brandMatch?: boolean;
  foreignBrand?: boolean;
  whiteBackground?: number;
  qualifierMatch?: boolean;
  fileHash?: string;
  score?: number;
}

/**
 * Tiendas argentinas con catálogo VTEX público y artículos de ferretería, sanitarios,
 * pinturería o electricidad. Los buscadores de imágenes (Bing, DuckDuckGo, Yahoo,
 * MercadoLibre) bloquean o devuelven resultados al azar a pedidos automáticos.
 */
const VTEX_STORES = [
  { source: 'Easy', domain: 'www.easy.com.ar' },
  { source: 'Frávega', domain: 'www.fravega.com' },
  { source: 'Carrefour', domain: 'www.carrefour.com.ar' },
  { source: 'Más Online', domain: 'www.masonline.com.ar' },
  { source: 'OnCity', domain: 'www.oncity.com' },
  { source: 'Jumbo', domain: 'www.jumbo.com.ar' },
];

/** Imágenes "no disponible" conocidas de las tiendas (md5 de la miniatura de 200px) */
const PLACEHOLDER_FILES = new Set<string>([
  'a12d86e5b4dc98a8ca4e96fdfa386727', // Jumbo
]);

/** VTEX permite pedir la imagen redimensionada agregando -ancho-alto al id del archivo. */
function vtexResized(url: string, size: number): string {
  return url.replace(/(\/arquivos\/ids\/\d+)(-\d+-\d+)?\//, `$1-${size}-${size}/`);
}

async function searchVtex(store: { source: string; domain: string }, query: string): Promise<ImageCandidate[]> {
  try {
    const url = `https://${store.domain}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=5`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': UA },
      timeout: 8000,
    });
    if (!Array.isArray(data)) return [];
    return data
      .map((p: any) => {
        const img = p?.items?.[0]?.images?.[0]?.imageUrl;
        if (!img) return null;
        return {
          url: vtexResized(img, 600),
          thumb: vtexResized(img, 200),
          title: p.productName || '',
          brand: p.brand || '',
          source: store.source,
          pageUrl: p.link,
        } as ImageCandidate;
      })
      .filter(Boolean) as ImageCandidate[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Puntaje
// ---------------------------------------------------------------------------

export interface SearchTarget {
  /** Nombre representativo de la familia (el de un producto) */
  name: string;
  brand?: string | null;
  category?: string | null;
  /** Todas las marcas conocidas del catálogo, para detectar resultados de otra marca */
  knownBrands: Set<string>;
}

function scoreText(target: SearchTarget, cand: ImageCandidate) {
  const tokens = significantTokens(target.name);
  const haystack = normalizeText(`${cand.title} ${cand.brand || ''}`);
  const hayStems = new Set(haystack.split(' ').map(stem));
  const has = (w: string) => hayStems.has(stem(w)) || (w.length >= 5 && haystack.includes(w));

  const brandWords = target.brand ? normalizeText(target.brand).split(' ') : [];
  const descriptive = tokens.filter(t => !brandWords.includes(t));
  const head = descriptive[0];
  const headMatch = head ? has(head) : false;
  // La palabra que sigue al sustantivo suele definir el artículo: CAÑO LUZ, LIMPIA HORNOS, TEE NORMAL
  const qualifier = descriptive[1];
  const qualifierMatch = qualifier ? has(qualifier) : true;

  const others = descriptive.slice(1);
  const coverage = others.length ? others.filter(has).length / others.length : 1;

  const brandNorm = brandWords.join(' ');
  const brandMatch = !!brandNorm && brandWords.every(has);

  // Otra marca conocida del catálogo en el título (y no la nuestra): casi seguro es otro producto
  const foreignBrand = !!brandNorm && !brandMatch && [...target.knownBrands].some(
    b => b !== brandNorm && b.length >= 4 && ` ${haystack} `.includes(` ${b} `),
  );

  let score = (headMatch ? 0.4 : 0) + (qualifierMatch ? 0.15 : 0) + coverage * 0.25 + (brandMatch ? 0.2 : brandNorm ? 0 : 0.1);
  if (foreignBrand) score -= 0.3;
  // Nombres muy cortos ("REPUESTO RESORTE") coinciden con cualquier cosa
  if (descriptive.length <= 2) score -= 0.1;
  return { textScore: Math.max(0, Math.min(1, score)), headMatch, qualifierMatch, brandMatch, foreignBrand };
}

async function analyzeImage(cand: ImageCandidate): Promise<void> {
  try {
    const { data } = await axios.get(cand.thumb, { responseType: 'arraybuffer', timeout: 6000, headers: { 'User-Agent': UA } });
    const bytes = Buffer.from(data);
    const img = await Jimp.read(bytes);
    if (img.width < 60 || img.height < 60) return;
    const ratio = img.width / img.height;
    if (ratio > 3 || ratio < 0.33) return; // banners, tiras
    const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 40));

    // Imagen casi vacía (dibujo gris claro de "imagen no disponible"): sin píxeles oscuros ni color
    let marked = 0;
    let sampled = 0;
    for (let y = 0; y < img.height; y += step) {
      for (let x = 0; x < img.width; x += step) {
        const c = img.getPixelColor(x, y);
        const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255;
        sampled++;
        if (Math.min(r, g, b) < 170 || Math.max(r, g, b) - Math.min(r, g, b) > 40) marked++;
      }
    }
    if (sampled && marked / sampled < 0.01) return;

    cand.fileHash = createHash('md5').update(bytes).digest('hex');

    // Proporción de píxeles casi blancos en el borde: las fotos de catálogo tienen fondo blanco
    let white = 0;
    let total = 0;
    const check = (x: number, y: number) => {
      const c = img.getPixelColor(x, y);
      const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255;
      total++;
      if (r > 235 && g > 235 && b > 235) white++;
    };
    for (let x = 0; x < img.width; x += step) { check(x, 0); check(x, img.height - 1); }
    for (let y = 0; y < img.height; y += step) { check(0, y); check(img.width - 1, y); }
    cand.whiteBackground = total ? white / total : 0;
  } catch {
    // imagen inaccesible: se descarta
  }
}

export type Confidence = 'HIGH' | 'MEDIUM' | 'NONE';

export interface SearchResult {
  query: string;
  confidence: Confidence;
  candidates: ImageCandidate[];
}

export function buildQuery(target: { name: string; brand?: string | null }, withBrand = true): string {
  const base = significantTokens(target.name).slice(0, 7).join(' ');
  const brand = withBrand && target.brand ? normalizeText(target.brand) : '';
  return `${base}${brand && !base.includes(brand) ? ` ${brand}` : ''}`.toLowerCase();
}

export async function searchProductImages(target: SearchTarget, customQuery?: string): Promise<SearchResult> {
  const manual = !!customQuery?.trim();
  const query = manual ? customQuery!.trim() : buildQuery(target);
  // En una búsqueda manual se puntúa contra lo que escribió el usuario
  const scoringTarget = manual ? { ...target, name: query, brand: null } : target;

  // Búsqueda escalonada: completa, marca + lo esencial, sin marca, y solo lo esencial
  const brandWords = target.brand ? normalizeText(target.brand).split(' ') : [];
  const essential = significantTokens(target.name).filter(t => !brandWords.includes(t));
  const queries = manual
    ? [query]
    : [...new Set([
        query,
        target.brand ? `${brandWords.join(' ')} ${essential.slice(0, 2).join(' ')}`.toLowerCase() : '',
        buildQuery(target, false),
        essential.slice(0, 3).join(' ').toLowerCase(),
      ])].filter(q => q.trim());
  const isGood = (c: ImageCandidate) =>
    c.headMatch && c.qualifierMatch && c.textScore! >= 0.6 && (!target.brand || c.brandMatch);

  const seen = new Set<string>();
  let candidates: ImageCandidate[] = [];
  for (const q of queries) {
    const batch = (await Promise.all(VTEX_STORES.map(st => searchVtex(st, q)))).flat();
    for (const c of batch) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      Object.assign(c, scoreText(scoringTarget, c));
      candidates.push(c);
    }
    if (manual || candidates.filter(isGood).length >= 2) break;
  }

  candidates = candidates
    .filter(c => manual || c.headMatch) // sin el sustantivo principal es otro producto
    .sort((a, b) => b.textScore! - a.textScore!)
    .slice(0, 14);

  await Promise.all(candidates.map(analyzeImage));
  candidates = candidates.filter(c => c.fileHash);

  // Imagen de relleno: archivo conocido, o el mismo archivo en artículos de distinto tipo
  // (las tiendas sí repiten una foto entre medidas o colores de un mismo artículo).
  const headsByFile = new Map<string, Set<string>>();
  for (const c of candidates) {
    const head = significantTokens(c.title)[0] || '';
    headsByFile.set(c.fileHash!, (headsByFile.get(c.fileHash!) || new Set<string>()).add(stem(head)));
  }
  candidates = candidates.filter(c => !PLACEHOLDER_FILES.has(c.fileHash!) && headsByFile.get(c.fileHash!)!.size < 2);

  // La misma foto repetida (marketplaces que comparten vendedor): se muestra una sola vez
  const uniqueFiles = new Set<string>();
  candidates = candidates.filter(c => {
    if (uniqueFiles.has(c.fileHash!)) return false;
    uniqueFiles.add(c.fileHash!);
    return true;
  });

  for (const c of candidates) {
    const bg = c.whiteBackground || 0;
    c.score = Math.round(Math.max(0, Math.min(1, c.textScore! + (bg > 0.8 ? 0.05 : bg < 0.2 ? -0.05 : 0))) * 100) / 100;
  }
  candidates.sort((a, b) => b.score! - a.score!);

  const best = candidates[0];
  let confidence: Confidence = 'NONE';
  if (best) {
    const exact = best.headMatch && best.qualifierMatch && !best.foreignBrand && best.textScore! >= 0.85;
    const brandOk = !scoringTarget.brand || best.brandMatch;
    if (!manual && exact && brandOk && best.score! >= 0.9 && best.whiteBackground! > 0.5) confidence = 'HIGH';
    else if (best.score! >= 0.45) confidence = 'MEDIUM';
  }

  return { query, confidence, candidates: candidates.slice(0, 8) };
}
