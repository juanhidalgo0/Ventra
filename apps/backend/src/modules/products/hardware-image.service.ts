import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from './firebase-sync.service';
import { familyKey, ImageCandidate, normalizeText, searchProductImages, SearchTarget } from './hardware-image-search';

const OLD_PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80';
const WORKERS = 4;

type StoredCandidate = Pick<ImageCandidate, 'url' | 'thumb' | 'title' | 'source' | 'score'>;

const withoutImage = { OR: [{ imageUrl: null }, { imageUrl: '' }, { imageUrl: OLD_PLACEHOLDER_IMAGE }] };

/**
 * Asignación de fotos para ferretería (productos sin código de barras).
 * Agrupa las medidas de un mismo artículo, busca en catálogos de tiendas y:
 *  - asigna sola la foto cuando la coincidencia es segura,
 *  - deja para revisión las dudosas,
 *  - nunca toca productos que ya tienen foto.
 */
@Injectable()
export class HardwareImageService {
  private isRunning = false;
  private isCancelled = false;

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private firebaseSync: FirebaseSyncService,
  ) {}

  cancel() {
    this.isCancelled = true;
  }

  start(options: { retryDiscarded?: boolean } = {}) {
    if (this.isRunning) return { started: false, message: 'La búsqueda de fotos ya está en curso.' };
    this.isRunning = true;
    this.isCancelled = false;
    this.run(options)
      .catch(err => {
        console.error('[HardwareImage] Error en la búsqueda de fotos:', err);
        this.events.emitImageSyncProgress({ progress: 100, total: 0, current: 0, status: `Error: ${err.message}`, isComplete: true, error: err.message });
      })
      .finally(() => { this.isRunning = false; });
    return { started: true };
  }

  private async run(options: { retryDiscarded?: boolean }) {
    if (options.retryDiscarded) {
      await this.prisma.imageSuggestion.deleteMany({ where: { status: { in: ['REJECTED', 'NO_RESULTS'] } } });
    }

    const products = await this.prisma.product.findMany({
      where: { isActive: true, ...withoutImage },
      select: { id: true, name: true, brand: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    const families = new Map<string, { name: string; brand: string | null; category: string | null; ids: string[] }>();
    for (const p of products) {
      const key = familyKey(p.name, p.brand?.name);
      const fam = families.get(key) || { name: p.name, brand: p.brand?.name || null, category: p.category?.name || null, ids: [] };
      fam.ids.push(p.id);
      families.set(key, fam);
    }

    const existing = new Map(
      (await this.prisma.imageSuggestion.findMany()).map(s => [s.familyKey, s]),
    );
    const knownBrands = new Set((await this.prisma.brand.findMany({ select: { name: true } })).map(b => normalizeText(b.name)));

    const queue = [...families.entries()];
    const total = queue.length;
    let current = 0;
    let assignedProducts = 0;
    let pending = 0;
    let noResults = 0;

    const emit = (status: string, isComplete = false) =>
      this.events.emitImageSyncProgress({
        progress: total ? Math.round((current / total) * 100) : 100,
        total,
        current,
        successCount: assignedProducts,
        noMatchCount: noResults,
        status,
        isComplete,
      });

    emit(total ? `Buscando fotos para ${total} artículos (${products.length} productos)...` : 'No hay productos sin foto.', total === 0);
    if (total === 0) return;

    const processFamily = async (key: string, fam: { name: string; brand: string | null; category: string | null; ids: string[] }) => {
      const prev = existing.get(key);

      // Familia ya resuelta: productos nuevos de esa familia (otra medida) reciben la misma foto
      if (prev && ['AUTO', 'ACCEPTED'].includes(prev.status) && prev.chosenUrl) {
        const assigned = await this.applyImage(fam.ids, prev.chosenUrl, this.thumbOf(prev, prev.chosenUrl));
        assignedProducts += assigned; // sumar después del await: hay varias búsquedas en paralelo
        return;
      }
      if (prev && ['REJECTED', 'NO_RESULTS'].includes(prev.status)) {
        if (prev.status === 'NO_RESULTS') noResults++;
        return;
      }
      if (prev && prev.status === 'PENDING') {
        // Se mantiene la sugerencia; se actualiza la lista de productos
        await this.prisma.imageSuggestion.update({ where: { id: prev.id }, data: { productIds: JSON.stringify(fam.ids) } });
        pending++;
        return;
      }

      const target: SearchTarget = { name: fam.name, brand: fam.brand, category: fam.category, knownBrands };
      const result = await searchProductImages(target);
      const candidates: StoredCandidate[] = result.candidates.map(({ url, thumb, title, source, score }) => ({ url, thumb, title, source, score }));
      const best = candidates[0];

      let status = result.confidence === 'HIGH' ? 'AUTO' : result.confidence === 'MEDIUM' ? 'PENDING' : 'NO_RESULTS';
      let chosenUrl: string | null = null;
      if (status === 'AUTO') {
        try {
          const assigned = await this.applyImage(fam.ids, best.url, best.thumb);
          assignedProducts += assigned; // sumar después del await: hay varias búsquedas en paralelo
          chosenUrl = best.url;
        } catch {
          status = 'PENDING'; // la foto no se pudo descargar: que la vea una persona
        }
      }
      if (status === 'PENDING') pending++;
      if (status === 'NO_RESULTS') noResults++;

      const data = {
        displayName: fam.name,
        brand: fam.brand,
        productIds: JSON.stringify(fam.ids),
        query: result.query,
        candidates: JSON.stringify(candidates),
        bestScore: best?.score || 0,
        confidence: result.confidence,
        status,
        chosenUrl,
      };
      await this.prisma.imageSuggestion.upsert({ where: { familyKey: key }, update: data, create: { familyKey: key, ...data } });
    };

    let next = 0;
    const worker = async () => {
      while (next < queue.length && !this.isCancelled) {
        const [key, fam] = queue[next++];
        try {
          await processFamily(key, fam);
        } catch (err: any) {
          console.warn(`[HardwareImage] Falló "${fam.name}":`, err.message);
        }
        current++;
        if (current % 5 === 0 || current === total) {
          emit(`${fam.name} · ${assignedProducts} con foto · ${pending} para revisar`);
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));

    if (this.isCancelled) {
      emit(`Búsqueda detenida. ${assignedProducts} productos con foto, ${pending} artículos para revisar.`, true);
    } else {
      emit(`¡Listo! ${assignedProducts} productos con foto y ${pending} artículos para revisar.`, true);
    }
  }

  private thumbOf(s: { candidates: string }, url: string): string | undefined {
    try {
      return (JSON.parse(s.candidates) as StoredCandidate[]).find(c => c.url === url)?.thumb;
    } catch {
      return undefined;
    }
  }

  /** Descarga y comprime la foto una vez y la asigna a los productos que siguen sin foto. */
  private async applyImage(productIds: string[], url: string, fallbackThumb?: string): Promise<number> {
    let image = await this.firebaseSync.compressRemoteImageToBase64(url);
    if (!image.startsWith('data:') && fallbackThumb) image = await this.firebaseSync.compressRemoteImageToBase64(fallbackThumb);
    if (!image.startsWith('data:')) throw new Error('No se pudo descargar la foto');

    const targets = await this.prisma.product.findMany({ where: { id: { in: productIds }, ...withoutImage }, select: { id: true } });
    if (targets.length === 0) return 0;
    await this.prisma.product.updateMany({ where: { id: { in: targets.map(t => t.id) } }, data: { imageUrl: image } });
    for (const t of targets) this.events.emitProductUpdated({ id: t.id, imageUrl: image });
    return targets.length;
  }

  // -------------------------------------------------------------------------
  // Revisión
  // -------------------------------------------------------------------------

  async summary() {
    const groups = await this.prisma.imageSuggestion.groupBy({ by: ['status'], _count: { _all: true } });
    const count = (s: string) => groups.find(g => g.status === s)?._count._all || 0;
    return {
      isRunning: this.isRunning,
      pending: count('PENDING'),
      auto: count('AUTO'),
      accepted: count('ACCEPTED'),
      rejected: count('REJECTED'),
      noResults: count('NO_RESULTS'),
    };
  }

  async listPending(skip = 0, take = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.imageSuggestion.findMany({ where: { status: 'PENDING' }, orderBy: [{ bestScore: 'desc' }, { displayName: 'asc' }], skip, take }),
      this.prisma.imageSuggestion.count({ where: { status: 'PENDING' } }),
    ]);

    const allIds = rows.flatMap(r => JSON.parse(r.productIds) as string[]);
    const products = await this.prisma.product.findMany({
      where: { id: { in: allIds } },
      select: { id: true, name: true, imageUrl: true, category: { select: { name: true } } },
    });
    const byId = new Map(products.map(p => [p.id, p]));

    const resolvedElsewhere: string[] = [];
    const items = rows.map(r => {
      const members = (JSON.parse(r.productIds) as string[]).map(id => byId.get(id)).filter(Boolean) as typeof products;
      const stillWithoutImage = members.filter(p => !p.imageUrl || p.imageUrl === OLD_PLACEHOLDER_IMAGE);
      if (stillWithoutImage.length === 0) resolvedElsewhere.push(r.id);
      return {
        id: r.id,
        displayName: r.displayName,
        brand: r.brand,
        category: members[0]?.category?.name || null,
        query: r.query,
        products: stillWithoutImage.map(p => ({ id: p.id, name: p.name })),
        candidates: JSON.parse(r.candidates) as StoredCandidate[],
      };
    });

    // Artículos a los que ya se les cargó foto a mano: dejan de estar pendientes
    if (resolvedElsewhere.length > 0) {
      await this.prisma.imageSuggestion.updateMany({ where: { id: { in: resolvedElsewhere } }, data: { status: 'ACCEPTED' } });
    }
    return { total: total - resolvedElsewhere.length, items: items.filter(i => i.products.length > 0) };
  }

  private async getSuggestion(id: string) {
    const s = await this.prisma.imageSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Sugerencia no encontrada');
    return s;
  }

  async accept(id: string, url: string) {
    const s = await this.getSuggestion(id);
    if (!url) throw new BadRequestException('Falta la foto elegida');
    const ids = JSON.parse(s.productIds) as string[];
    let assigned: number;
    try {
      assigned = await this.applyImage(ids, url, this.thumbOf(s, url));
    } catch {
      throw new BadRequestException('No se pudo descargar esa foto. Elegí otra.');
    }
    await this.prisma.imageSuggestion.update({ where: { id }, data: { status: 'ACCEPTED', chosenUrl: url } });
    return { assigned };
  }

  async reject(id: string) {
    await this.getSuggestion(id);
    await this.prisma.imageSuggestion.update({ where: { id }, data: { status: 'REJECTED' } });
    return { success: true };
  }

  /** Vuelve a buscar una familia con un texto escrito por el usuario. */
  async research(id: string, query: string) {
    const s = await this.getSuggestion(id);
    if (!query?.trim()) throw new BadRequestException('Escribí qué buscar');
    const result = await searchProductImages({ name: s.displayName, brand: s.brand, knownBrands: new Set() }, query);
    const candidates: StoredCandidate[] = result.candidates.map(({ url, thumb, title, source, score }) => ({ url, thumb, title, source, score }));
    await this.prisma.imageSuggestion.update({
      where: { id },
      data: { query: result.query, candidates: JSON.stringify(candidates), bestScore: candidates[0]?.score || 0 },
    });
    return { query: result.query, candidates };
  }

  /** Búsqueda libre para elegir la foto desde la ficha del producto. */
  async searchByText(query: string) {
    if (!query?.trim()) throw new BadRequestException('Escribí qué buscar');
    const result = await searchProductImages({ name: query, knownBrands: new Set() }, query);
    return result.candidates.map(({ url, thumb, title, source, score }) => ({ url, thumb, title, source, score }));
  }
}
