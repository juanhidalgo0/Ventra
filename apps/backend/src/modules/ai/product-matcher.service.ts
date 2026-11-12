import { Injectable, Optional } from '@nestjs/common';
import { SharedCatalogService, type SharedSupplierCode } from '../products/shared-catalog.service';
import { PrismaService } from '../../database/prisma.service';
import { AiService } from './ai.service';
import { validCuit } from '../purchases/invoice-reader/invoice-parser';

export const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)([a-z])/g, '$1 $2').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * Código de barras de producto de verdad (dígito verificador, largo, prefijo GS1 y patrones de código
 * interno: ver invoice-reader/barcode-check). El SKU (código interno del proveedor o del comercio) es
 * otra cosa, aunque sea un número largo: nunca se mezclan.
 */
export { isBarcode } from '../purchases/invoice-reader/barcode-check';
import { isBarcode } from '../purchases/invoice-reader/barcode-check';
export const codeKey = (s: string) => String(s || '').toUpperCase().replace(/[\s.\-_/]/g, '').replace(/^0+/, '');
/** Palabras del nombre, sin los puntos de las abreviaturas ("alf.") ni la cantidad del bulto ("x24") */
const words = (s: string) => norm(s).split(' ').map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 1 && !/^(de|la|el|con|sin|x|por|en|y)$/.test(w) && !/^x\d+$/.test(w));
/** Los números del nombre (tamaños, pesos, sabores numerados): tienen que coincidir */
const sizes = (s: string) => (norm(s).replace(/\bx ?\d+\b/g, ' ').match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n))).sort().join(' ');
/** Clave del índice: las primeras 3 letras (así "alf." encuentra "alfajor") */
const key3 = (w: string) => (/^\d/.test(w) ? w : w.slice(0, 3));
/** Palabras en común, contando las abreviadas de las boletas: "alf" = "alfajor", "gall" = "galletitas" */
function overlap(ws: string[], other: string[]) {
  let n = 0;
  for (const w of ws) {
    if (other.some((c) => c === w || (!/^\d/.test(w) && !/^\d/.test(c) && Math.min(w.length, c.length) >= 3 && (c.startsWith(w) || w.startsWith(c))))) n++;
  }
  return n;
}

/** Hasta este tamaño el catálogo va entero a la IA; más grande, solo los parecidos a cada renglón */
const AI_FULL_CATALOG = 2000;
/** Candidatos por renglón sin encontrar que van a la IA con un catálogo grande */
const AI_PER_ROW = 30;

export const PRODUCT_SELECT = {
  id: true, name: true, barcode: true, sku: true, supplierId: true, costPrice: true, salePrice: true, packPrice: true,
  wholesalePrice: true, tradePrice: true, unitsPerPack: true, taxRate: true, listPrice: true, discount1: true, discount2: true, discount3: true,
  unit: true, presentationType: true, trackExpiry: true,
  additionalBarcodes: { select: { barcode: true } },
} as const;

export type MatchBy = 'barcode' | 'code' | 'learned' | 'shared' | 'name' | 'ia';
/** Clave del código del proveedor en el mapa compartido (igual que supplier-codes.js en la nube) */
const sharedKey = (s: string) => codeKey(s).replace(/[^A-Z0-9]/g, '').slice(0, 40);
export type Confidence = 'alta' | 'media' | 'baja';
export interface MatchRow { code?: string; barcode?: string; name: string }
export interface Match { product: any; by: MatchBy; confidence: Confidence }

/**
 * Qué producto del catálogo es cada renglón de una boleta o lista de precios de un proveedor.
 * En orden: código de barras, lo aprendido de ese proveedor (supplier_codes), código interno,
 * nombre igual o muy parecido (con los mismos tamaños), y la IA para los que quedan.
 * Un producto no se asigna a dos renglones: se queda el más seguro.
 */
@Injectable()
export class ProductMatcherService {
  constructor(private prisma: PrismaService, private ai: AiService, @Optional() private shared?: SharedCatalogService) {}

  async catalog() {
    return this.prisma.product.findMany({ where: { isActive: true, id: { notIn: ['VENTA_RAPIDA', 'SERVICIO', 'PAGO_CTA_CTE'] } }, select: PRODUCT_SELECT });
  }

  private async learned(supplierId?: string | null): Promise<Map<string, string>> {
    if (!supplierId) return new Map();
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; product_id: string }[]>(
      `SELECT id, product_id FROM supplier_codes WHERE supplier_id = ?`, supplierId,
    ).catch((): any[] => []);
    return new Map(rows.map((r) => [r.id.slice(supplierId.length + 1), r.product_id] as [string, string]));
  }

  /**
   * El proveedor de una boleta o lista entre los cargados: por CUIT (lo más seguro) o por nombre
   * parecido (sin "S.A.", "S.R.L."). create: si no está, se agrega. El CUIT queda guardado en el
   * proveedor para las próximas boletas (nunca el del propio comercio, que también sale impreso).
   */
  async findSupplier(name?: string | null, create = false, rawCuit?: string | null) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim();
    let cuit = String(rawCuit || '').replace(/\D/g, '');
    if (cuit && (!validCuit(cuit) || (await this.ownCuits()).includes(cuit))) cuit = '';
    const pretty = cuit ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}` : '';
    if (cuit) {
      const byCuit = await this.prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
        `SELECT id, name FROM suppliers WHERE REPLACE(cuit, '-', '') = ? LIMIT 1`, cuit,
      ).catch((): any[] => []);
      if (byCuit.length) return byCuit[0];
    }
    const saveCuit = async (s: { id: string; name: string } | null) => {
      if (s && pretty) await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET cuit = ? WHERE id = ? AND (cuit IS NULL OR cuit = '')`, pretty, s.id).catch(() => {});
      return s;
    };
    if (!clean || clean.length < 3) return null;
    const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(s\.?a\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|sociedad anonima|de|la|el)\b/g, ' ').replace(/[^a-z0-9]/g, '');
    const target = key(clean);
    if (!target) return null;
    const all = await this.prisma.supplier.findMany({ select: { id: true, name: true } });
    const found = all.find((s) => key(s.name) === target)
      || all.find((s) => { const k = key(s.name); return k.length >= 4 && target.length >= 4 && (k.includes(target) || target.includes(k)); });
    if (found || !create) return saveCuit(found || null);
    return saveCuit(await this.prisma.supplier.create({ data: { name: clean.slice(0, 120) }, select: { id: true, name: true } }));
  }

  /** CUIT del propio comercio (facturación y datos de las hojas): no es el del proveedor */
  async ownCuits(): Promise<string[]> {
    const out: string[] = [];
    const fiscal = await this.prisma.fiscalConfig.findFirst({ select: { cuit: true } }).catch(() => null);
    if (fiscal?.cuit) out.push(fiscal.cuit.replace(/\D/g, ''));
    const setting = await this.prisma.storeSetting.findUnique({ where: { id: 'store_cuit' } }).catch(() => null);
    if (setting?.value) out.push(String(setting.value).replace(/\D/g, ''));
    return out.filter(Boolean);
  }

  /**
   * Lo confirmó el dueño: la próxima boleta de ese proveedor encuentra el producto directo. Si el
   * producto no tenía código interno (SKU), se le pone el del proveedor (si ningún otro lo usa).
   */
  async learn(supplierId: string | null | undefined, items: { code?: string; name?: string; productId: string }[]) {
    for (const it of items) {
      const code = String(it.code || '').trim().slice(0, 40);
      // Un EAN no es un SKU: no se guarda como código interno (el código de barras va por su lado)
      if (!it.productId || !code || isBarcode(code)) continue;
      const p = await this.prisma.product.findUnique({ where: { id: it.productId }, select: { sku: true } }).catch(() => null);
      if (p && !p.sku && !(await this.prisma.product.findFirst({ where: { sku: code }, select: { id: true } }))) {
        await this.prisma.product.update({ where: { id: it.productId }, data: { sku: code } }).catch(() => {});
      }
    }
    if (!supplierId) return;
    // Mapa compartido entre comercios (tanda 3): código del proveedor → código de barras del producto.
    // En segundo plano: votar nunca frena la compra. Solo código y código de barras, nunca precios.
    if (this.shared) this.shareCodes(supplierId, items).catch(() => {});
    for (const it of items) {
      if (!it.productId) continue;
      const keys = [it.code && codeKey(it.code) ? `c:${codeKey(it.code)}` : null, it.name && norm(it.name) ? `n:${norm(it.name)}` : null].filter(Boolean) as string[];
      for (const k of keys) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO supplier_codes (id, supplier_id, product_id, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET product_id = excluded.product_id, updated_at = CURRENT_TIMESTAMP`,
          `${supplierId}|${k}`.slice(0, 300), supplierId, it.productId,
        ).catch(() => {});
      }
    }
  }

  private async shareCodes(supplierId: string, items: { code?: string; productId: string }[]) {
    const withCode = items.filter((it) => it.productId && it.code && !isBarcode(String(it.code)));
    if (!withCode.length) return;
    const s = await this.prisma.$queryRawUnsafe<{ cuit: string | null }[]>(`SELECT cuit FROM suppliers WHERE id = ?`, supplierId).catch(() => []);
    const cuit = String(s[0]?.cuit || '').replace(/\D/g, '');
    if (!validCuit(cuit)) return;
    const prods = await this.prisma.product.findMany({ where: { id: { in: [...new Set(withCode.map((i) => i.productId))] } }, select: { id: true, name: true, barcode: true, unitsPerPack: true } });
    const byId = new Map(prods.map((p) => [p.id, p]));
    const out = withCode.map((it) => {
      const p = byId.get(it.productId);
      return p && p.barcode && isBarcode(p.barcode) ? { code: String(it.code), barcode: p.barcode, name: p.name, unitsPerPack: p.unitsPerPack || 1 } : null;
    }).filter(Boolean) as { code: string; barcode: string; name: string; unitsPerPack: number }[];
    if (out.length) await this.shared!.confirmSupplierCodes(cuit, out);
  }

  /** Códigos de barras sugeridos por nombre desde el catálogo compartido (tanda 7.1): uno por nombre, hasta 3 cada uno */
  async barcodeSuggestions(names: string[]) {
    return this.shared ? this.shared.searchNames(names) : names.map(() => []);
  }

  /** useAi: buscar con la IA los que no se encontraron (si la PC está vinculada y no pasó el tope) */
  async match(rows: MatchRow[], opts: { supplierId?: string | null; useAi?: boolean; supplierCuit?: string | null } = {}) {
    const products = await this.catalog();
    const byId = new Map(products.map((p) => [p.id, p]));
    const learned = await this.learned(opts.supplierId);
    const byBarcode = new Map<string, any>();
    const bySku = new Map<string, any>();
    const byName = new Map<string, any>();
    const index = new Map<string, any[]>();
    for (const p of products) {
      for (const b of [p.barcode, ...p.additionalBarcodes.map((x) => x.barcode)]) if (b) byBarcode.set(codeKey(b), p);
      if (p.sku) bySku.set(codeKey(p.sku), p);
      byName.set(norm(p.name), p);
      for (const w of new Set(words(p.name).map(key3))) { const l = index.get(w) || []; l.push(p); index.set(w, l); }
    }
    const supplierId = opts.supplierId || null;
    // Mapa compartido entre comercios (tanda 3): se piden a la nube los códigos del proveedor que ni el
    // código de barras ni lo aprendido acá encuentran. Sin internet o sin vincular: vacío, sigue como siempre.
    let sharedMap: Record<string, SharedSupplierCode> = {};
    const cuit = String(opts.supplierCuit || '').replace(/\D/g, '');
    if (this.shared && validCuit(cuit)) {
      const ask = rows.filter((r) => {
        const code = String(r.code || '').trim();
        if (!code || isBarcode(code)) return false;
        const bc = String(r.barcode || '').trim();
        if (bc && byBarcode.has(codeKey(bc))) return false;
        return !learned.get(`c:${codeKey(code)}`) && !learned.get(`n:${norm(r.name)}`);
      }).map((r) => String(r.code).trim());
      if (ask.length) sharedMap = await this.shared.supplierCodes(cuit, ask).catch(() => ({}));
    }
    const sharedOf = (code: string) => (code ? sharedMap[sharedKey(code)] || null : null);
    const matches: (Match | null)[] = rows.map((r) => {
      const code = String(r.code || '').trim();
      // El código de la boleta solo se busca como código de barras si es un EAN válido
      const bc = String(r.barcode || '').trim() || (isBarcode(code) ? code : '');
      let p = bc ? byBarcode.get(codeKey(bc)) : null;
      if (p) return { product: p, by: 'barcode', confidence: 'alta' };
      const lc = code ? learned.get(`c:${codeKey(code)}`) : null;
      const ln = learned.get(`n:${norm(r.name)}`);
      p = (lc && byId.get(lc)) || (ln && byId.get(ln));
      if (p) return { product: p, by: 'learned', confidence: 'alta' };
      // Otros comercios asociaron este código del proveedor a un código de barras que tenés: dos o más
      // que coinciden lo asocian solo; uno solo o si se contradicen, queda dudoso
      const sh = sharedOf(code);
      p = sh ? byBarcode.get(codeKey(sh.barcode)) : null;
      if (p) return { product: p, by: 'shared', confidence: sh!.confidence === 'alta' ? 'alta' : 'baja' };
      p = code ? bySku.get(codeKey(code)) : null;
      if (p) return { product: p, by: 'code', confidence: supplierId && p.supplierId && p.supplierId !== supplierId ? 'media' : 'alta' };
      p = byName.get(norm(r.name));
      if (p) return { product: p, by: 'name', confidence: 'alta' };
      // Por nombre parecido: muchas palabras en común y los mismos números (tamaño, peso)
      const ws = words(r.name);
      const rs = sizes(r.name);
      const seen = new Set<any>();
      let best: any = null;
      let bestScore = 0;
      for (const w of new Set(ws.map(key3))) {
        const list = index.get(w) || [];
        if (list.length >= 300) continue;
        for (const cand of list) {
          if (seen.has(cand)) continue;
          seen.add(cand);
          if (sizes(cand.name) !== rs) continue;
          const cw = words(cand.name);
          let score = overlap(ws, cw) / Math.max(ws.length, cw.length);
          if (supplierId && cand.supplierId === supplierId) score += 0.05;
          if (score > bestScore) { bestScore = score; best = cand; }
        }
      }
      if (best && bestScore >= 0.75) return { product: best, by: 'name', confidence: bestScore >= 0.9 ? 'alta' : 'media' };
      return null;
    });

    let aiMatched = 0;
    const missing = rows.map((r, i) => ({ r, i })).filter((x) => !matches[x.i]).slice(0, 400);
    if (opts.useAi !== false && missing.length && products.length) {
      try {
        // Catálogo chico: va entero, como siempre. Grande: antes iban los primeros 4.000 y el resto
        // quedaba fuera de alcance (un comercio con 5.771 productos). Ahora, por cada renglón sin
        // encontrar, sus 30 más parecidos; a la IA va la unión de esos candidatos.
        const pool = products.length <= AI_FULL_CATALOG ? products : this.aiCandidates(missing.map((x) => x.r.name), index);
        if (!pool.length) throw new Error('sin candidatos');
        const { result } = await this.ai.call('match', {
          items: missing.map((x) => ({ name: x.r.name, code: x.r.code })),
          catalog: pool.map((p) => ({ id: p.id, name: p.name })),
        });
        for (const m of result?.matches || []) {
          const target = missing[Number(m.i)];
          const p = byId.get(String(m.productId));
          if (!target || !p) continue;
          // La IA nunca va como "segura": el dueño lo ve antes de que cambie un precio
          matches[target.i] = { product: p, by: 'ia', confidence: m.confianza === 'alta' ? 'media' : 'baja' };
          aiMatched++;
        }
      } catch { /* sin IA: quedan sin encontrar */ }
    }

    // Los que no se encontraron: los 3 más parecidos, para elegir con un toque (el dueño decide)
    const candidates: any[][] = rows.map((r, i) => (matches[i] ? [] : this.similar(r.name, index)));

    // Un producto no se asigna a dos renglones (se queda el más seguro), salvo que los dos coincidan por
    // código de barras, lo aprendido del proveedor o su código interno: es el mismo producto facturado en
    // dos renglones (otro precio, una promo, otra hoja), y antes el segundo quedaba sin asociar.
    const rank: Record<Confidence, number> = { alta: 3, media: 2, baja: 1 };
    const byCode = (m: Match) => m.by === 'barcode' || m.by === 'learned' || m.by === 'code' || (m.by === 'shared' && m.confidence === 'alta');
    const owner = new Map<string, number[]>();
    matches.forEach((m, i) => {
      if (!m) return;
      const prev = owner.get(m.product.id);
      if (!prev) { owner.set(m.product.id, [i]); return; }
      const held = prev.map((k) => matches[k]!);
      if (byCode(m) && held.every(byCode)) { prev.push(i); return; }
      // Por código le gana a cualquiera por nombre o IA; si no, el más seguro
      const strongest = Math.max(...held.map((h) => rank[h.confidence] + (byCode(h) ? 10 : 0)));
      if (rank[m.confidence] + (byCode(m) ? 10 : 0) > strongest) { for (const k of prev) matches[k] = null; owner.set(m.product.id, [i]); } else matches[i] = null;
    });
    // Los que quedaron sin producto por ceder el suyo: también con sugerencias
    matches.forEach((m, i) => { if (!m && !candidates[i].length) candidates[i] = this.similar(rows[i].name, index); });
    // Lo que dicen otros comercios de los que siguen sin producto: un producto nuevo ya viene con su
    // código de barras, nombre y unidades por bulto (si coinciden 2 o más) o como sugerencia
    const sharedHints: (SharedSupplierCode | null)[] = rows.map((r, i) => (matches[i] ? null : sharedOf(String(r.code || '').trim())));
    return { matches, aiMatched, products, candidates, sharedHints };
  }

  /** Productos parecidos por palabras en común (mismo tamaño suma); sin exigir que sea seguro */
  private similar(name: string, index: Map<string, any[]>) {
    return this.ranked(name, index, { limit: 3, min: 0.25, maxList: 500 })
      .map((cand) => ({ id: cand.id, name: cand.name, costPrice: cand.costPrice, salePrice: cand.salePrice, unitsPerPack: cand.unitsPerPack }));
  }

  /** Los más parecidos por palabras en común, de mayor a menor */
  private ranked(name: string, index: Map<string, any[]>, o: { limit: number; min: number; maxList: number }) {
    const ws = words(name);
    const rs = sizes(name);
    const seen = new Set<any>();
    for (const w of new Set(ws.map(key3))) {
      const list = index.get(w) || [];
      if (list.length >= o.maxList) continue;
      for (const cand of list) seen.add(cand);
    }
    return [...seen].map((cand) => {
      const cw = words(cand.name);
      return { cand, score: overlap(ws, cw) / Math.max(ws.length, cw.length) + (rs && sizes(cand.name) === rs ? 0.3 : 0) };
    }).filter((x) => x.score >= o.min).sort((a, b) => b.score - a.score).slice(0, o.limit).map((x) => x.cand);
  }

  /**
   * Para la IA con un catálogo grande: los 30 más parecidos a cada renglón (palabras comunes como "x"
   * o una marca con miles de productos también cuentan, con un tope por palabra), sin repetir.
   */
  aiCandidates(names: string[], index: Map<string, any[]>) {
    const out = new Map<string, any>();
    for (const n of names) for (const c of this.ranked(n, index, { limit: AI_PER_ROW, min: 0.01, maxList: 3000 })) out.set(c.id, c);
    return [...out.values()];
  }
}
