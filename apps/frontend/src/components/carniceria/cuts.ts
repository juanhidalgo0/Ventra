import api, { resolveServerUrl } from '../../services/api';
import { usePOSStore } from '../../stores/posStore';
import type { BusinessProfile } from '../../stores/businessStore';

/**
 * Productos por kilo de cada rubro con balanza, para cargarlos de una (ver CutsLoader). Solo
 * nombres y categorías: los precios los pone el carnicero (cambian cada semana) y el código de
 * balanza sale solo, siguiendo los que ya tiene.
 */
export interface CutGroup { category: string; color: string; items: string[] }

export const CUT_PRESETS: Partial<Record<BusinessProfile, CutGroup[]>> = {
  CARNICERIA: [
    {
      category: 'Vacuno', color: '#b91c1c', items: [
        'Asado', 'Vacío', 'Matambre', 'Entraña', 'Tapa de asado', 'Bife de chorizo', 'Bife ancho', 'Ojo de bife', 'Lomo',
        'Colita de cuadril', 'Cuadril', 'Peceto', 'Nalga', 'Bola de lomo', 'Cuadrada', 'Tapa de nalga', 'Paleta', 'Roast beef',
        'Falda', 'Osobuco', 'Carnaza', 'Carne picada común', 'Carne picada especial',
      ],
    },
    { category: 'Cerdo', color: '#f472b6', items: ['Bondiola', 'Pechito de cerdo', 'Carré de cerdo', 'Matambre de cerdo', 'Solomillo', 'Costilla de cerdo'] },
    { category: 'Pollo', color: '#f59e0b', items: ['Pollo entero', 'Pata y muslo', 'Pechuga', 'Suprema', 'Alitas'] },
    { category: 'Achuras y embutidos', color: '#7c2d12', items: ['Chorizo', 'Morcilla', 'Salchicha parrillera', 'Chinchulines', 'Mollejas', 'Riñón', 'Hígado'] },
    { category: 'Elaborados', color: '#ea580c', items: ['Milanesa de nalga', 'Milanesa de pollo', 'Hamburguesa casera', 'Matambre arrollado'] },
  ],
  FIAMBRERIA: [
    {
      category: 'Fiambres', color: '#e11d48', items: [
        'Jamón cocido', 'Jamón crudo', 'Paleta cocida', 'Mortadela', 'Lomito ahumado', 'Panceta ahumada', 'Bondiola curada', 'Pastrón', 'Pechuga de pavo',
      ],
    },
    {
      category: 'Quesos', color: '#eab308', items: [
        'Queso de máquina', 'Queso cremoso', 'Queso tybo', 'Queso sardo', 'Queso reggianito', 'Queso azul', 'Muzzarella', 'Queso gouda',
        'Queso pategrás', 'Queso fontina', 'Provolone',
      ],
    },
    { category: 'Salames', color: '#9f1239', items: ['Salame Milán', 'Salamín picado fino', 'Salamín picado grueso', 'Longaniza', 'Sopressata'] },
  ],
};

/** Código de balanza numérico de un producto (SKU, o el código si es un número corto) */
export const pluOf = (p: any): number | null => {
  for (const c of [p?.sku, p?.barcode]) {
    const s = String(c ?? '').trim();
    if (/^\d{1,6}$/.test(s) && Number(s) > 0) return Number(s);
  }
  return null;
};

/** Desde qué número seguir la numeración de la balanza: después del más alto, o desde 10 */
export const nextPlu = (products: any[]): number => {
  let max = 9;
  for (const p of products) { const n = pluOf(p); if (n && n < 100000) max = Math.max(max, n); }
  return max + 1;
};

export const normName = (s: string) => s.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Suma a la caja los productos que cambiaron desde `since` (los recién creados o actualizados),
 * sin bajar el catálogo entero: en un almacén grande con carnicería son miles.
 */
export async function mergeIntoPosCatalog(since: string) {
  try {
    const { data } = await api.get('/products/pos-catalog', { params: { updatedAfter: since }, silent: true } as any);
    const fresh: any[] = data?.products || (Array.isArray(data) ? data : []);
    if (!fresh.length) return;
    const st = usePOSStore.getState();
    const byId = new Map(st.products.map((p: any) => [p.id, p]));
    for (const p of fresh) {
      const nameLower = (p.name || '').toLowerCase();
      const skuLower = (p.sku || '').toLowerCase();
      byId.set(p.id, { ...byId.get(p.id), ...p, imageUrl: resolveServerUrl(p.imageUrl), _searchToken: `${nameLower} ${nameLower.normalize('NFD').replace(/[̀-ͯ]/g, '')} ${skuLower} ${p.barcode || ''}`.trim() });
    }
    st.setProducts([...byId.values()]);
  } catch { /* la caja lo trae en su próxima recarga */ }
}

/** Productos del comercio para estas pantallas (los mismos que ve la caja, con su unidad y código) */
export async function loadCatalog(): Promise<any[]> {
  const cached = usePOSStore.getState().products;
  if (cached.length) return cached;
  const { data } = await api.get('/products/pos-catalog', { silent: true } as any);
  return data?.products || (Array.isArray(data) ? data : []);
}
