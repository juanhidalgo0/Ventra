import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiService } from './ai.service';

export const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)([a-z])/g, '$1 $2').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
export const codeKey = (s: string) => String(s || '').toUpperCase().replace(/[\s.\-_/]/g, '').replace(/^0+/, '');
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 1 && !/^(de|la|el|con|sin|x|por|en|y)$/.test(w));
/** Los números del nombre (tamaños, pesos, sabores numerados): tienen que coincidir */
const sizes = (s: string) => (norm(s).match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n))).sort().join(' ');

export const PRODUCT_SELECT = {
  id: true, name: true, barcode: true, sku: true, supplierId: true, costPrice: true, salePrice: true, packPrice: true,
  wholesalePrice: true, tradePrice: true, unitsPerPack: true, taxRate: true, listPrice: true, discount1: true, discount2: true, discount3: true,
  unit: true, presentationType: true, trackExpiry: true,
  additionalBarcodes: { select: { barcode: true } },
} as const;

export type MatchBy = 'barcode' | 'code' | 'learned' | 'name' | 'ia';
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
  constructor(private prisma: PrismaService, private ai: AiService) {}

  async catalog() {
    return this.prisma.product.findMany({ where: { isActive: true, id: { notIn: ['VENTA_RAPIDA', 'PAGO_CTA_CTE'] } }, select: PRODUCT_SELECT });
  }

  private async learned(supplierId?: string | null): Promise<Map<string, string>> {
    if (!supplierId) return new Map();
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; product_id: string }[]>(
      `SELECT id, product_id FROM supplier_codes WHERE supplier_id = ?`, supplierId,
    ).catch((): any[] => []);
    return new Map(rows.map((r) => [r.id.slice(supplierId.length + 1), r.product_id] as [string, string]));
  }

  /** Lo confirmó el dueño: la próxima boleta de ese proveedor encuentra el producto directo */
  async learn(supplierId: string | null | undefined, items: { code?: string; name?: string; productId: string }[]) {
    if (!supplierId) return;
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

  /** useAi: buscar con la IA los que no se encontraron (si la PC está vinculada y no pasó el tope) */
  async match(rows: MatchRow[], opts: { supplierId?: string | null; useAi?: boolean } = {}) {
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
      for (const w of new Set(words(p.name))) { const l = index.get(w) || []; l.push(p); index.set(w, l); }
    }
    const supplierId = opts.supplierId || null;
    const matches: (Match | null)[] = rows.map((r) => {
      const code = String(r.code || '').trim();
      const bc = String(r.barcode || '').trim() || (/^\d{8,14}$/.test(code) ? code : '');
      let p = bc ? byBarcode.get(codeKey(bc)) : null;
      if (p) return { product: p, by: 'barcode', confidence: 'alta' };
      const lc = code ? learned.get(`c:${codeKey(code)}`) : null;
      const ln = learned.get(`n:${norm(r.name)}`);
      p = (lc && byId.get(lc)) || (ln && byId.get(ln));
      if (p) return { product: p, by: 'learned', confidence: 'alta' };
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
      for (const w of ws) {
        const list = index.get(w) || [];
        if (list.length >= 300) continue;
        for (const cand of list) {
          if (seen.has(cand)) continue;
          seen.add(cand);
          if (sizes(cand.name) !== rs) continue;
          const cw = new Set(words(cand.name));
          const common = ws.filter((x) => cw.has(x)).length;
          let score = common / Math.max(ws.length, cw.size);
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
        const { result } = await this.ai.call('match', {
          items: missing.map((x) => ({ name: x.r.name, code: x.r.code })),
          catalog: products.slice(0, 4000).map((p) => ({ id: p.id, name: p.name })),
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

    const rank: Record<Confidence, number> = { alta: 3, media: 2, baja: 1 };
    const owner = new Map<string, number>();
    matches.forEach((m, i) => {
      if (!m) return;
      const prev = owner.get(m.product.id);
      if (prev === undefined) { owner.set(m.product.id, i); return; }
      if (rank[m.confidence] > rank[matches[prev]!.confidence]) { matches[prev] = null; owner.set(m.product.id, i); } else matches[i] = null;
    });
    return { matches, aiMatched, products };
  }
}
