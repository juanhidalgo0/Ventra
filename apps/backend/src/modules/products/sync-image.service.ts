import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from './firebase-sync.service';
import { SharedCatalogService } from './shared-catalog.service';
import axios from 'axios';

/** Un resultado de la búsqueda por código: de qué fuente, con qué nombre y foto */
export interface BarcodeHit { source: string; name: string | null; imageUrl: string | null; exact: boolean }
export interface BarcodeLookup {
  name: string | null;
  imageUrl: string | null;
  /** De dónde salió lo elegido: shared (otros comercios lo confirmaron), un supermercado, etc. */
  source: string | null;
  /** Hasta 3 fotos para elegir cuando las fuentes no coinciden (la elegida primero) */
  candidates: { imageUrl: string; source: string; name: string | null; doubtful: boolean }[];
}

// Supermercados que buscan por código de barras exacto (VTEX): si devuelven algo, es ese producto
const VTEX_HOSTS: [string, string][] = [
  ['carrefour', 'https://www.carrefour.com.ar'], ['jumbo', 'https://www.jumbo.com.ar'], ['disco', 'https://www.disco.com.ar'],
  ['vea', 'https://www.veasupermercados.com.ar'], ['dia', 'https://diaonline.supermercadosdia.com.ar'],
  ['masonline', 'https://www.masonline.com.ar'], ['farmacity', 'https://www.farmacity.com'],
];
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Cuánto se parecen dos nombres de producto (palabras en común) */
export function nameSimilarity(a: string, b: string) {
  const wa = new Set(norm(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

@Injectable()
export class SyncImageService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private firebaseSync: FirebaseSyncService,
    private shared: SharedCatalogService,
  ) {}

  // ─── Búsqueda por código de barras ───────────────────────────────────
  // Antes se quedaba con la foto que respondía primero entre 11 fuentes, y las más rápidas
  // (MercadoLibre por texto, Bing) traían fotos de cualquier cosa. Ahora: 1) lo que confirmaron
  // otros comercios de Ventra, 2) supermercados por código exacto, con nombre y foto de la misma
  // fuente, 3) MercadoLibre solo si su publicación tiene ese código, 4) Bing solo como opción.

  private async vtexHit(source: string, host: string, barcode: string): Promise<BarcodeHit | null> {
    try {
      const { data } = await axios.get(`${host}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, timeout: 4000,
      });
      const product = Array.isArray(data) ? data[0] : null;
      if (!product) return null;
      const items: any[] = product.items || [];
      // El ítem con ese código (un producto puede tener varios tamaños)
      const item = items.find((i) => String(i.ean || '') === barcode) || items[0];
      if (items.length && item && item.ean && String(item.ean) !== barcode && !items.some((i) => String(i.ean || '') === barcode)) return null;
      const name = String(product.productName || item?.nameComplete || '').trim() || null;
      const imageUrl = item?.images?.[0]?.imageUrl || null;
      return name || imageUrl ? { source, name, imageUrl, exact: true } : null;
    } catch { return null; }
  }

  private async offHit(barcode: string): Promise<BarcodeHit | null> {
    try {
      const { data } = await axios.get(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, { headers: { 'User-Agent': 'Ventra/1.0 (ventra.store)' }, timeout: 3500 });
      const p = data?.status === 1 ? data.product : null;
      if (!p) return null;
      const name = String(p.product_name_es || p.product_name || '').trim() || null;
      const imageUrl = p.image_front_url || p.image_url || null;
      return name || imageUrl ? { source: 'openfoodfacts', name, imageUrl, exact: true } : null;
    } catch { return null; }
  }

  /** MercadoLibre busca por texto: vale solo si la publicación tiene ese código entre sus datos */
  private async mercadoLibreHit(barcode: string): Promise<BarcodeHit | null> {
    try {
      const { data } = await axios.get(`https://api.mercadolibre.com/sites/MLA/search?q=${barcode}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
      for (const it of (data?.results || []).slice(0, 5)) {
        const codes = (it.attributes || []).filter((a: any) => /GTIN|EAN|UPC/i.test(String(a.id || '')))
          .map((a: any) => String(a.value_name || '').replace(/\D/g, ''));
        if (codes.some((c: string) => c && (c === barcode || c.replace(/^0+/, '') === barcode.replace(/^0+/, '')))) {
          return { source: 'mercadolibre', name: String(it.title || '').trim() || null, imageUrl: it.thumbnail ? String(it.thumbnail).replace(/-I\.(jpg|jpeg|png|webp)/gi, '-O.$1') : null, exact: true };
        }
      }
    } catch { /* sin resultado */ }
    return null;
  }

  async lookupBarcode(barcode: string): Promise<BarcodeLookup> {
    const empty: BarcodeLookup = { name: null, imageUrl: null, source: null, candidates: [] };
    if (!barcode || !this.isValidNumericBarcode(barcode)) return empty;
    const [shared, ...exactRaw] = await Promise.all([
      this.shared.get(barcode),
      ...VTEX_HOSTS.map(([source, host]) => this.vtexHit(source, host, barcode)),
      this.offHit(barcode),
    ]);
    // En el orden de VTEX_HOSTS y después Open Food Facts (el más completo primero)
    const exact = exactRaw.filter(Boolean) as BarcodeHit[];
    let hits: BarcodeHit[] = [...exact];
    // Lo confirmado por otros comercios va primero si lo confirmaron dos o más; con uno solo, después
    // de los supermercados (así el error de un comercio no les pisa el dato bueno a los demás)
    if (shared && (shared.name || shared.imageUrl)) {
      const hit: BarcodeHit = { source: 'shared', name: shared.name, imageUrl: shared.imageUrl, exact: true };
      hits = shared.votes >= 2 ? [hit, ...hits] : [...hits, hit];
    }
    if (!hits.some((h) => h.imageUrl)) {
      const ml = await this.mercadoLibreHit(barcode);
      if (ml) hits.push(ml);
    }
    // Nombre y foto de la misma fuente, si alguna trae las dos
    const both = hits.find((h) => h.name && h.imageUrl);
    const name = both?.name || hits.find((h) => h.name)?.name || null;
    const chosen = both || hits.find((h) => h.imageUrl) || null;
    const candidates: BarcodeLookup['candidates'] = [];
    const seen = new Set<string>();
    const add = (h: BarcodeHit, doubtful = false) => {
      if (!h.imageUrl || seen.has(h.imageUrl) || candidates.length >= 3) return;
      // De otra fuente exacta pero con un nombre muy distinto: se ofrece, marcada como dudosa
      const off = !!(name && h.name && nameSimilarity(name, h.name) < 0.34);
      seen.add(h.imageUrl);
      candidates.push({ imageUrl: h.imageUrl, source: h.source, name: h.name, doubtful: doubtful || off });
    };
    if (chosen) add(chosen);
    hits.forEach((h) => add(h));
    // Sin ninguna foto confiable: las de Bing van como opción, nunca solas
    if (!candidates.length) {
      for (const f of [() => this.fetchImageFromPedidosYaViaBing(barcode), () => this.fetchImageFromRappiViaBing(barcode)]) {
        const url = await f().catch(() => null);
        if (url) add({ source: 'bing', name: null, imageUrl: url, exact: false }, true);
      }
    }
    return { name, imageUrl: chosen?.imageUrl || null, source: chosen?.source || (name ? hits.find((h) => h.name)?.source || null : null), candidates };
  }

  // Helper: Clean product names for search engines
  cleanName(name: string): string {
    if (!name) return '';
    let cleaned = name.toLowerCase();
    
    // 1. Remove multipliers like "x 20", "x20", "x 6"
    cleaned = cleaned.replace(/\bx\s*\d+\b/gi, ' ');
    
    // 2. Remove decimals/weights/volumes like "1.5 l", "1,5lt", "500gr", "473ml", "1.35 lts", "30 sobres"
    cleaned = cleaned.replace(/\d+([.,]\d+)?\s*(gr|g|kg|kgs|l|lt|lts|ml|cc|un|u|sobres|sob)\b/gi, ' ');
    
    // 3. Remove isolated letters that are units
    cleaned = cleaned.replace(/\b(gr|g|kg|l|lt|lts|ml|cc|un|u)\b/gi, ' ');
    
    // 4. Remove all non-alphanumeric characters, except spaces. Keep Spanish characters (áéíóúñü).
    cleaned = cleaned.replace(/[^a-z0-9áéíóúñü\s]/gi, ' ');
    
    // 5. Collapse spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned.toUpperCase();
  }

  // Common category list to make brand matching more flexible
  private readonly commonCategories = new Set([
    'sahumerio', 'sahumerios', 'cuaderno', 'cuadernos', 'toalla', 'toallas', 'toallita', 'toallitas',
    'alfajor', 'alfajores', 'talonario', 'talonarios', 'azufre', 'regaliz', 'tijera', 'tijeras',
    'bizcocho', 'bizcochos', 'broches', 'broche', 'gatos', 'gato', 'escobillon', 'escobillones',
    'tabaco', 'tabacos', 'marcador', 'marcadores', 'guantes', 'guante', 'chocolate', 'chocolates',
    'chicle', 'chicles', 'caramelo', 'caramelos', 'chupetin', 'chupetines', 'galletitas', 'galletita',
    'pepas', 'pepa', 'agua', 'aguas', 'gaseosa', 'gaseosas', 'jugo', 'jugos', 'cerveza', 'cervezas',
    'vino', 'vinos', 'fernet', 'licor', 'licores', 'energizante', 'energizantes', 'encendedor',
    'encendedores', 'papel', 'papeles', 'sedas', 'seda', 'filtros', 'filtro', 'maquinitas', 'maquinita',
    'preservativos', 'preservativo', 'desodorante', 'desodorantes', 'jabon', 'jabones', 'shampoo',
    'acondicionador', 'crema', 'cremas', 'pasta', 'cepillo', 'cepillos', 'vape', 'vaper', 'vappper',
    'vapper', 'petaca', 'petacas', 'esponja', 'esponjas', 'balde', 'bolsa', 'bolsas', 'desinfectante',
    'desinfectantes', 'cremona', 'facturas', 'yerba', 'cafe', 'leche', 'queso', 'jamon', 'salame',
    'pan', 'snack', 'papas', 'mani'
  ]);

  // Helper: Strict matching validator
  isStrictMatch(query: string, resultName: string): boolean {
    if (!query || !resultName) return false;
    const qClean = query.toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    const rClean = resultName.toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/gi, ' ').replace(/\s+/g, ' ').trim();
    
    const words = qClean.split(' ').filter(w => w.length >= 2);
    if (words.length === 0) return false;
    
    // Find the first word that is NOT a common category to use as the primary anchor (brand)
    let anchorWord = words[0];
    for (const w of words) {
      if (!this.commonCategories.has(w)) {
        anchorWord = w;
        break;
      }
    }
    
    // The anchor word (brand/unique identifier) must be present in the result name
    if (!rClean.includes(anchorWord)) {
      return false;
    }
    
    // Calculate match percentage for all query words (must match at least 65%)
    let matches = 0;
    for (const word of words) {
      if (rClean.includes(word) || (word.length > 3 && (rClean.includes(word.slice(0, -1)) || rClean.includes(word + 's')))) {
        matches++;
      }
    }
    
    return (matches / words.length) >= 0.65;
  }

  // Helper: Validate if a string is a standard numeric EAN/UPC barcode
  isValidNumericBarcode(barcode: string): boolean {
    if (!barcode) return false;
    return /^\d+$/.test(barcode) && barcode.length >= 8;
  }

  // Helper: Run all searchers in parallel and return the first non-null image URL
  async runSearchersInParallel(searchers: (() => Promise<string | null>)[]): Promise<string | null> {
    const promises = searchers.map(async (searcher) => {
      const url = await searcher();
      if (url) return url;
      throw new Error('No image');
    });
    try {
      return await Promise.any(promises);
    } catch {
      return null;
    }
  }

  // 1. Barcode EAN Lookup: Open Food Facts Argentina
  async fetchImageFromOpenFoodFacts(barcode: string): Promise<string | null> {
    try {
      const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'MaxikioscoPaulos/1.0 (NestJS Backend; admin@paulospos.com)' },
        timeout: 2500,
      });
      if (response.data && response.data.status === 1 && response.data.product) {
        const product = response.data.product;
        const imageUrl = product.image_url || product.image_front_url || product.image_small_url;
        if (imageUrl) {
          console.log(`[OFF Barcode] ${barcode} matches: ${product.product_name || ''}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      // Quiet fail to avoid console clutter
    }
    return null;
  }

  // 2. Barcode EAN Lookup: Carrefour Argentina VTEX EAN Search
  async fetchImageFromCarrefourByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 2500,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Carrefour Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      // Quiet fail
    }
    return null;
  }

  // 3. Barcode EAN Lookup: Farmacity Argentina VTEX EAN Search
  async fetchImageFromFarmacityByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.farmacity.com/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Farmacity Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[Farmacity Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // 4. Barcode EAN Lookup: Jumbo Argentina VTEX EAN Search
  async fetchImageFromJumboByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.jumbo.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Jumbo Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[Jumbo Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // 5. Barcode EAN Lookup: Dia Argentina VTEX EAN Search
  async fetchImageFromDiaByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Dia Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[Dia Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // New: Barcode EAN Lookup: MercadoLibre Argentina (MLA)
  async fetchImageFromMercadoLibreByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://api.mercadolibre.com/sites/MLA/search?q=${barcode}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 4000,
      });
      if (response.data && response.data.results && response.data.results.length > 0) {
        const firstItem = response.data.results[0];
        let imageUrl = firstItem.thumbnail;
        if (imageUrl) {
          // Upgrade MercadoLibre thumbnail to high-resolution version
          imageUrl = imageUrl.replace(/-I\.(jpg|jpeg|png|webp)/gi, '-O.$1');
          console.log(`[MercadoLibre Barcode] Match for EAN "${barcode}": ${firstItem.title}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[MercadoLibre Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // New: Barcode EAN Lookup: Disco Argentina
  async fetchImageFromDiscoByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.disco.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 4000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Disco Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[Disco Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // New: Barcode EAN Lookup: Vea Argentina
  async fetchImageFromVeaByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.veasupermercados.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 4000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[Vea Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[Vea Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // New: Barcode EAN Lookup: PedidosYa via Bing Index (Bypasses Cloudflare/Captchas)
  async fetchImageFromPedidosYaViaBing(barcode: string): Promise<string | null> {
    try {
      const query = `site:pedidosya.com.ar/productos "${barcode}"`;
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 5000
      });
      const html = response.data;
      const regex = /&quot;murl&quot;\s*:\s*&quot;(https?:\/\/images\.deliveryhero\.io\/image\/pedidosya\/products\/[^&"]+)/gi;
      const match = regex.exec(html);
      if (match && match[1]) {
        console.log(`[PedidosYa Barcode] Match for EAN "${barcode}": ${match[1]}`);
        return match[1];
      }
    } catch (err: any) {
      console.warn(`[PedidosYa Barcode] Search failed for "${barcode}":`, err.message);
    }
    return null;
  }

  // New: Barcode EAN Lookup: Rappi via Bing Index (Bypasses Cloudflare/Captchas)
  async fetchImageFromRappiViaBing(barcode: string): Promise<string | null> {
    try {
      const query = `site:rappi.com.ar/producto "${barcode}"`;
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 5000
      });
      const html = response.data;
      const regex = /&quot;murl&quot;\s*:\s*&quot;(https?:\/\/images\.rappi\.com\.ar\/products\/[^&"]+)/gi;
      const match = regex.exec(html);
      if (match && match[1]) {
        console.log(`[Rappi Barcode] Match for EAN "${barcode}": ${match[1]}`);
        return match[1];
      }
    } catch (err: any) {
      console.warn(`[Rappi Barcode] Search failed for "${barcode}":`, err.message);
    }
    return null;
  }

  // New: Name Lookup: PedidosYa via Bing Index (Strict Match)
  async fetchImageFromPedidosYaByNameViaBing(name: string): Promise<string | null> {
    try {
      const query = `site:pedidosya.com.ar/productos "${name}"`;
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 5000
      });
      const html = response.data;
      
      const regex = /<[a-z0-9]+[^>]+class="iusc"[^>]+m="([^"]+)"/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const jsonStr = match[1].replace(/&quot;/g, '"').replace(/&#58;/g, ':').replace(/&#47;/g, '/');
        try {
          const data = JSON.parse(jsonStr);
          if (data.murl && data.murl.includes('images.deliveryhero.io')) {
            const title = data.t || data.desc || '';
            if (this.isStrictMatch(name, title)) {
              console.log(`[PedidosYa Name Bing] Verified Match for "${name}": ${title}`);
              return data.murl;
            }
          }
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[PedidosYa Name Bing] Search failed for "${name}":`, err.message);
    }
    return null;
  }

  // New: Name Lookup: Rappi via Bing Index (Strict Match)
  async fetchImageFromRappiByNameViaBing(name: string): Promise<string | null> {
    try {
      const query = `site:rappi.com.ar/producto "${name}"`;
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 5000
      });
      const html = response.data;
      
      const regex = /<[a-z0-9]+[^>]+class="iusc"[^>]+m="([^"]+)"/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const jsonStr = match[1].replace(/&quot;/g, '"').replace(/&#58;/g, ':').replace(/&#47;/g, '/');
        try {
          const data = JSON.parse(jsonStr);
          if (data.murl && data.murl.includes('images.rappi.com.ar')) {
            const title = data.t || data.desc || '';
            if (this.isStrictMatch(name, title)) {
              console.log(`[Rappi Name Bing] Verified Match for "${name}": ${title}`);
              return data.murl;
            }
          }
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[Rappi Name Bing] Search failed for "${name}":`, err.message);
    }
    return null;
  }

  // 6. Barcode EAN Lookup: ChangoMas Argentina VTEX EAN Search
  async fetchImageFromChangoMasByBarcode(barcode: string): Promise<string | null> {
    try {
      const url = `https://www.masonline.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        const item = firstProduct.items?.[0];
        const imageUrl = item?.images?.[0]?.imageUrl;
        if (imageUrl) {
          console.log(`[ChangoMas Barcode] Match for EAN "${barcode}": ${firstProduct.productName}`);
          return imageUrl;
        }
      }
    } catch (err: any) {
      console.error(`[ChangoMas Barcode] Error searching EAN "${barcode}":`, err.message);
    }
    return null;
  }

  // 7. High-Precision Name Lookup: Carrefour Argentina VTEX Search
  async fetchImageFromCarrefourByName(name: string): Promise<string | null> {
    try {
      const query = this.cleanName(name);
      const url = `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        if (this.isStrictMatch(name, firstProduct.productName)) {
          const item = firstProduct.items?.[0];
          const imageUrl = item?.images?.[0]?.imageUrl;
          if (imageUrl) {
            console.log(`[Carrefour Name] Verified Match for "${name}": ${firstProduct.productName}`);
            return imageUrl;
          }
        }
      }
    } catch (err: any) {
      console.error(`[Carrefour Name] Error searching name "${name}":`, err.message);
    }
    return null;
  }

  // 8. High-Precision Name Lookup: Farmacity Argentina VTEX Search
  async fetchImageFromFarmacityByName(name: string): Promise<string | null> {
    try {
      const query = this.cleanName(name);
      const url = `https://www.farmacity.com/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        timeout: 5000,
      });

      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        if (this.isStrictMatch(name, firstProduct.productName)) {
          const item = firstProduct.items?.[0];
          const imageUrl = item?.images?.[0]?.imageUrl;
          if (imageUrl) {
            console.log(`[Farmacity Name] Verified Match for "${name}": ${firstProduct.productName}`);
            return imageUrl;
          }
        }
      }
    } catch (err: any) {
      console.error(`[Farmacity Name] Error searching name "${name}":`, err.message);
    }
    return null;
  }

  // 9. High-Precision Name Lookup: Jumbo Argentina VTEX Search
  async fetchImageFromJumboByName(name: string): Promise<string | null> {
    try {
      const query = this.cleanName(name);
      const url = `https://www.jumbo.com.ar/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        if (this.isStrictMatch(name, firstProduct.productName)) {
          const item = firstProduct.items?.[0];
          const imageUrl = item?.images?.[0]?.imageUrl;
          if (imageUrl) {
            console.log(`[Jumbo Name] Verified Match for "${name}": ${firstProduct.productName}`);
            return imageUrl;
          }
        }
      }
    } catch (err: any) {
      console.error(`[Jumbo Name] Error searching name "${name}":`, err.message);
    }
    return null;
  }

  // 10. High-Precision Name Lookup: Dia Argentina VTEX Search
  async fetchImageFromDiaByName(name: string): Promise<string | null> {
    try {
      const query = this.cleanName(name);
      const url = `https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        if (this.isStrictMatch(name, firstProduct.productName)) {
          const item = firstProduct.items?.[0];
          const imageUrl = item?.images?.[0]?.imageUrl;
          if (imageUrl) {
            console.log(`[Dia Name] Verified Match for "${name}": ${firstProduct.productName}`);
            return imageUrl;
          }
        }
      }
    } catch (err: any) {
      console.error(`[Dia Name] Error searching name "${name}":`, err.message);
    }
    return null;
  }

  // 11. High-Precision Name Lookup: ChangoMas Argentina VTEX Search
  async fetchImageFromChangoMasByName(name: string): Promise<string | null> {
    try {
      const query = this.cleanName(name);
      const url = `https://www.masonline.com.ar/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
      });
      if (response.data && response.data.length > 0) {
        const firstProduct = response.data[0];
        if (this.isStrictMatch(name, firstProduct.productName)) {
          const item = firstProduct.items?.[0];
          const imageUrl = item?.images?.[0]?.imageUrl;
          if (imageUrl) {
            console.log(`[ChangoMas Name] Verified Match for "${name}": ${firstProduct.productName}`);
            return imageUrl;
          }
        }
      }
    } catch (err: any) {
      console.error(`[ChangoMas Name] Error searching name "${name}":`, err.message);
    }
    return null;
  }

  // 12. Safe Fallback: Scrape Bing Images
  async fetchImageFromBingImages(name: string, enforceStrict = true): Promise<string | null> {
    try {
      const query = `${name.trim()} producto png`;
      const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.9'
        },
        timeout: 5000
      });

      const html = response.data;
      const candidates: { murl: string; title: string }[] = [];
      
      const regex = /&quot;murl&quot;\s*:\s*&quot;(https?:\/\/[^&"]+)/gi;
      let match;
      while ((match = regex.exec(html)) !== null) {
        // Find title within same block if possible, or just gather URLs
        candidates.push({
          murl: match[1],
          title: '' // Metadata contains title in other attributes, but match[1] gives clean img URL
        });
      }

      // If we don't enforce strict matching (e.g. category fallbacks or generic lookups)
      if (!enforceStrict && candidates.length > 0) {
        for (const cand of candidates.slice(0, 5)) {
          // Verify URL doesn't contain standard spam keywords
          const urlLower = cand.murl.toLowerCase();
          if (!urlLower.includes('onlyfans') && !urlLower.includes('porn') && !urlLower.includes('sex') && !urlLower.includes('leak')) {
            try {
              const headRes = await axios.head(cand.murl, { timeout: 2000, headers: { 'User-Agent': 'Mozilla/5.0' } });
              if (headRes.status === 200) {
                console.log(`[Bing Images Broad/Category Match] for "${name}": ${cand.murl}`);
                return cand.murl;
              }
            } catch {}
          }
        }
      }

      // Enhanced HTML parsing to check titles for strict match
      const fullRegex = /<[a-z0-9]+[^>]+class="iusc"[^>]+m="([^"]+)"/gi;
      const fullCandidates: { murl: string; title: string }[] = [];
      while ((match = fullRegex.exec(html)) !== null) {
        const jsonStr = match[1].replace(/&quot;/g, '"').replace(/&#58;/g, ':').replace(/&#47;/g, '/');
        try {
          const data = JSON.parse(jsonStr);
          if (data.murl) {
            fullCandidates.push({
              murl: data.murl,
              title: data.t || data.desc || ''
            });
          }
        } catch {}
      }

      for (const cand of fullCandidates.slice(0, 8)) {
        if (this.isStrictMatch(name, cand.title)) {
          try {
            const headRes = await axios.head(cand.murl, { timeout: 2000, headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (headRes.status === 200) {
              console.log(`[Bing Images Verified Match] for "${name}": ${cand.title} (${cand.murl})`);
              return cand.murl;
            }
          } catch {}
        }
      }
    } catch (err: any) {
      console.error(`[Bing Images] Search failed for "${name}":`, err.message);
    }
    return null;
  }

  private isCancelled = false;

  cancelAssignment() {
    this.isCancelled = true;
  }

  /**
   * all: también los que ya tienen foto. A esos solo se les cambia por una foto confiable por
   * código de barras (de otros comercios o de un supermercado), nunca por búsqueda por nombre.
   */
  async assignImagesToProducts(userId: string, opts: { all?: boolean } = {}): Promise<{ successCount: number; totalProcessed: number }> {
    console.log('[SyncImageService] Starting high precision Argentine image assignment...');
    this.isCancelled = false;

    const missing = [
      { imageUrl: null },
      { imageUrl: '' },
      { imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80' }
    ];
    const products = await this.prisma.product.findMany({
      where: opts.all
        ? { isActive: true, OR: [...missing, { barcode: { not: null } }] }
        : { isActive: true, OR: missing },
      // Sin la foto en sí (pueden ser miles en base64): solo saber cuáles ya tenían una
      select: { id: true, name: true, barcode: true },
    });
    const withoutImage = new Set((await this.prisma.product.findMany({ where: { isActive: true, OR: missing }, select: { id: true } })).map((p) => p.id));

    const totalProducts = products.length;
    console.log(`[SyncImageService] Found ${totalProducts} products to process.`);

    if (totalProducts === 0) {
      this.events.emitImageSyncProgress({
        progress: 100,
        total: 0,
        current: 0,
        successCount: 0,
        noMatchCount: 0,
        status: 'No hay productos pendientes de imágenes.',
        isComplete: true
      });
      return { successCount: 0, totalProcessed: 0 };
    }

    let successCount = 0;
    let index = 0;

    // Cada producto consulta varias fuentes a la vez: de a pocos, para no saturar a los supermercados
    const concurrency = 6;
    for (let i = 0; i < products.length; i += concurrency) {
      const chunk = products.slice(i, i + concurrency);

      if (this.isCancelled) {
        console.log('[SyncImageService] Image assignment cancelled by user.');
        this.isCancelled = false;
        this.events.emitImageSyncProgress({
          progress: 100,
          total: totalProducts,
          current: index,
          successCount,
          noMatchCount: index - successCount,
          status: 'Búsqueda cancelada por el usuario.',
          isComplete: true
        });
        return { successCount, totalProcessed: index };
      }

      await Promise.all(chunk.map(async (product) => {
        let foundImageUrl: string | null = null;

        // TIER 1: Barcode EAN Search across 11 Barcode/Supermarket/Delivery databases (100% Precision)
        if (product.barcode && this.isValidNumericBarcode(product.barcode)) {
          // Solo fotos confiables: confirmadas por otros comercios o de un supermercado por código exacto
          const r = await this.lookupBarcode(product.barcode);
          foundImageUrl = r.candidates.find((c) => c.imageUrl === r.imageUrl && !c.doubtful)?.imageUrl || null;
        }

        const hadImage = !withoutImage.has(product.id);
        // TIER 2: Strict Name Search on official channels (65%+ Match required). No para los que ya tenían foto
        if (!foundImageUrl && product.name && !hadImage) {
          foundImageUrl = await this.runSearchersInParallel([
            () => this.fetchImageFromCarrefourByName(product.name),
            () => this.fetchImageFromDiaByName(product.name),
            () => this.fetchImageFromChangoMasByName(product.name),
            () => this.fetchImageFromJumboByName(product.name),
            () => this.fetchImageFromFarmacityByName(product.name)
          ]);
        }


        // Save image to database only if we successfully found it
        if (foundImageUrl) {
          const compressedUrl = await this.firebaseSync.compressRemoteImageToBase64(foundImageUrl);
          await this.prisma.product.update({
            where: { id: product.id },
            data: { imageUrl: compressedUrl }
          });
          successCount++;

          // Notify POS and frontend in real-time
          this.events.emitProductUpdated({ id: product.id, imageUrl: compressedUrl });
        }
      }));

      index += chunk.length;
      const progressPercent = Math.round((index / totalProducts) * 100);

      this.events.emitImageSyncProgress({
        progress: progressPercent,
        total: totalProducts,
        current: index,
        successCount,
        noMatchCount: index - successCount,
        status: `Procesando: ${chunk[chunk.length - 1]?.name || ''}`
      });

      // 400ms delay between parallel batches to respect external APIs
      await new Promise(r => setTimeout(r, 400));
    }

    this.events.emitImageSyncProgress({
      progress: 100,
      total: totalProducts,
      current: totalProducts,
      successCount,
      noMatchCount: totalProducts - successCount,
      status: `¡Búsqueda finalizada! Se asignaron ${successCount} imágenes con éxito.`,
      isComplete: true
    });

    console.log(`[SyncImageService] Finished. Assigned ${successCount}/${totalProducts} images.`);
    return { successCount, totalProcessed: totalProducts };
  }

  async assignImageToSingleProduct(productId: string, barcode: string): Promise<string | null> {
    if (!barcode || !this.isValidNumericBarcode(barcode)) return null;

    let foundImageUrl: string | null = null;

    // TIER 1: Barcode EAN Search
    if (barcode && this.isValidNumericBarcode(barcode)) {
      const r = await this.lookupBarcode(barcode);
      foundImageUrl = r.candidates.find((c) => c.imageUrl === r.imageUrl && !c.doubtful)?.imageUrl || null;
    }

    // TIER 2: Strict Name Search on official channels if barcode yields no results
    if (!foundImageUrl) {
      const product = await this.prisma.product.findUnique({ where: { id: productId } });
      if (product && product.name) {
        foundImageUrl = await this.runSearchersInParallel([
          () => this.fetchImageFromCarrefourByName(product.name),
          () => this.fetchImageFromDiaByName(product.name),
          () => this.fetchImageFromChangoMasByName(product.name),
          () => this.fetchImageFromJumboByName(product.name),
          () => this.fetchImageFromFarmacityByName(product.name)
        ]);
      }
    }

    if (foundImageUrl) {
      try {
        const compressedUrl = await this.firebaseSync.compressRemoteImageToBase64(foundImageUrl);
        await this.prisma.product.update({
          where: { id: productId },
          data: { imageUrl: compressedUrl }
        });
        
        // Notify POS and frontend in real-time
        this.events.emitProductUpdated({ id: productId, imageUrl: compressedUrl });
        
        // Sync to Firebase
        const product = await this.prisma.product.findUnique({
          where: { id: productId },
          include: { category: true }
        });
        if (product) {
          const syncBarcode = product.barcode || product.id;
          await this.firebaseSync.syncProductToFirestore(
            syncBarcode,
            product.stock,
            product.salePrice,
            {
              name: product.name,
              description: product.description || '',
              categoryName: product.category?.name || 'Varios',
              minStock: product.minStock,
              imageUrl: compressedUrl
            }
          ).catch(() => {});
        }
        return compressedUrl;
      } catch (err: any) {
        console.error(`[SyncImageService] Failed to save single product image:`, err.message);
      }
    }
    return null;
  }

  /**
   * Nombre del producto según los catálogos de los supermercados (los mismos de las fotos) y
   * Open Food Facts: el primero que conteste. Para el alta rápida en la caja.
   */
  async searchNameByBarcode(barcode: string): Promise<string | null> {
    return (await this.lookupBarcode(barcode)).name;
  }

  async searchImageByBarcode(barcode: string): Promise<string | null> {
    // Solo fotos confiables (lo de Bing queda como opción para elegir, no se pone sola)
    const r = await this.lookupBarcode(barcode);
    return r.candidates.find((c) => c.imageUrl === r.imageUrl && !c.doubtful)?.imageUrl || r.imageUrl;
  }

}
