import { create } from 'zustand';
import { usePOSStore } from '../../stores/posStore';
import type { BusinessProfile } from '../../stores/businessStore';

/**
 * Modo práctica de la caja: mientras dura el recorrido guiado, la caja se muestra abierta con
 * productos de ejemplo del rubro, el recorrido arma un ticket y abre la ventana de cobro.
 * Nada llega al servidor: la sesión es simulada, los productos viven solo en memoria y la
 * ventana de cobro no registra la venta. Al terminar, la caja vuelve exactamente a como estaba.
 */

export const PRACTICE_SESSION_ID = 'PRACTICE';

interface PracticeState {
  active: boolean;
  /** Lo que había antes de la práctica (se devuelve al terminar) */
  backup: null | { products: any[]; categories: any[]; promotions: any[]; cart: any[]; selectedClient: any };
  start: (profile: BusinessProfile) => void;
  end: () => void;
}

const cat = (id: string, name: string, color: string, count: number) => ({ id, name, color, _count: { products: count } });

let seq = 0;
const prod = (name: string, price: number, category: ReturnType<typeof cat>, extra: Record<string, any> = {}) => {
  const id = `practice_${++seq}`;
  const nameLower = name.toLowerCase();
  return {
    id, name, salePrice: price, stock: 50, categoryId: category.id, category: { id: category.id, name: category.name, color: category.color },
    barcode: `779000000${String(seq).padStart(4, '0')}`, sku: null, imageUrl: null, allowCustomPrice: false, unit: 'UNIT',
    unitsPerPack: 1, salesCount: 100 - seq, additionalBarcodes: [],
    _searchToken: `${nameLower} ${nameLower.normalize('NFD').replace(/[̀-ͯ]/g, '')}`,
    ...extra,
  };
};
const variants = (base: string, price: (attrs: Record<string, string>) => number, category: ReturnType<typeof cat>, axes: Record<string, string[]>) => {
  const group = `practice_group_${++seq}`;
  const [k1, v1] = Object.entries(axes)[0];
  const second = Object.entries(axes)[1];
  const combos = v1.flatMap((a) => (second ? second[1].map((b) => ({ [k1]: a, [second[0]]: b })) : [{ [k1]: a }]));
  return combos.map((attrs) => prod(`${base} ${Object.values(attrs).join(' ')}`, price(attrs), category, {
    baseName: base, variantGroupId: group, variantAttrs: JSON.stringify(attrs),
  }));
};

/** Catálogo de ejemplo por rubro */
function sampleCatalog(profile: BusinessProfile) {
  seq = 0;
  switch (profile) {
    case 'FERRETERIA': {
      const c = [cat('pc_f1', 'Tornillería', '#64748b', 3), cat('pc_f2', 'Electricidad', '#f59e0b', 3), cat('pc_f3', 'Pinturería', '#3b82f6', 2)];
      return { categories: c, products: [
        prod('Tornillo autoperforante 8x1"', 45, c[0]), prod('Tarugo Fischer 8mm', 30, c[0]), prod('Clavo punta París 2"  (kg)', 4200, c[0], { unit: 'KG' }),
        prod('Cable unipolar 2,5mm (metro)', 980, c[1], { unit: 'MT' }), prod('Lámpara LED 12W', 2900, c[1]), prod('Cinta aisladora', 1500, c[1]),
        prod('Látex interior blanco 4L', 28500, c[2]), prod('Rodillo lana 22cm', 7400, c[2]),
      ] };
    }
    case 'INDUMENTARIA': {
      const c = [cat('pc_i1', 'Remeras', '#ec4899', 6), cat('pc_i2', 'Pantalones', '#6366f1', 3), cat('pc_i3', 'Accesorios', '#14b8a6', 2)];
      return { categories: c, products: [
        ...variants('Remera básica', () => 14900, c[0], { talle: ['S', 'M', 'L'], color: ['Negro', 'Blanco'] }),
        ...variants('Jean recto', () => 45900, c[1], { talle: ['38', '40', '42'] }),
        prod('Gorra', 12500, c[2]), prod('Medias x3', 6900, c[2]),
      ] };
    }
    case 'GASTRONOMIA': {
      const c = [cat('pc_g1', 'Pizzas', '#ef4444', 4), cat('pc_g2', 'Empanadas', '#f59e0b', 3), cat('pc_g3', 'Bebidas', '#0ea5e9', 3)];
      return { categories: c, products: [
        ...variants('Pizza muzzarella', (a) => (a['tamaño'] === 'Grande' ? 14500 : 10500), c[0], { 'tamaño': ['Chica', 'Grande'] }),
        ...variants('Pizza napolitana', (a) => (a['tamaño'] === 'Grande' ? 16500 : 12000), c[0], { 'tamaño': ['Chica', 'Grande'] }),
        prod('Empanada de carne', 1600, c[1]), prod('Empanada de jamón y queso', 1600, c[1]), prod('Empanada de pollo', 1600, c[1]),
        prod('Gaseosa 1,5L', 3800, c[2]), prod('Agua sin gas 500ml', 1500, c[2]), prod('Cerveza lata', 2600, c[2]),
      ] };
    }
    case 'MULTIRUBRO': {
      const c = [cat('pc_m1', 'Bazar', '#8b5cf6', 3), cat('pc_m2', 'Ropa', '#ec4899', 3), cat('pc_m3', 'Por medida', '#64748b', 2)];
      return { categories: c, products: [
        prod('Taza cerámica', 4500, c[0]), prod('Set de cubiertos x24', 18900, c[0]), prod('Repasador', 2500, c[0]),
        ...variants('Remera básica', () => 14900, c[1], { talle: ['S', 'M', 'L'] }),
        prod('Cinta bebé (metro)', 600, c[2], { unit: 'MT' }), prod('Hilo de algodón (metro)', 250, c[2], { unit: 'MT' }),
      ] };
    }
    default: {
      const c = [cat('pc_k1', 'Bebidas', '#0ea5e9', 3), cat('pc_k2', 'Golosinas', '#f59e0b', 4), cat('pc_k3', 'Almacén', '#10b981', 3)];
      return { categories: c, products: [
        prod('Gaseosa cola 500ml', 1800, c[0]), prod('Agua mineral 500ml', 1200, c[0]), prod('Jugo en caja 1L', 2100, c[0]),
        prod('Alfajor triple', 1500, c[1]), prod('Chocolate con leche', 2300, c[1]), prod('Caramelos surtidos', 100, c[1]), prod('Chicles', 600, c[1]),
        prod('Galletitas de agua', 1400, c[2]), prod('Yerba 500g', 3600, c[2]), prod('Leche entera 1L', 1700, c[2]),
      ] };
    }
  }
}

/** Qué agrega el recorrido al ticket de práctica: un par de cosas típicas del rubro */
export function practiceTicket(profile: BusinessProfile, products: any[]): { product: any; qty: number }[] {
  const by = (pred: (p: any) => boolean) => products.find(pred);
  const picks: [any, number][] =
    profile === 'FERRETERIA' ? [[by((p) => p.unit === 'MT'), 5], [by((p) => /Tornillo/.test(p.name)), 20]]
    : profile === 'INDUMENTARIA' ? [[by((p) => /Remera.*M Negro/.test(p.name)), 1], [by((p) => /Gorra/.test(p.name)), 1]]
    : profile === 'GASTRONOMIA' ? [[by((p) => /muzzarella Grande/.test(p.name)), 1], [by((p) => /carne/.test(p.name)), 6], [by((p) => /Gaseosa/.test(p.name)), 1]]
    : profile === 'MULTIRUBRO' ? [[by((p) => /Taza/.test(p.name)), 2], [by((p) => p.unit === 'MT'), 3]]
    : [[by((p) => /Gaseosa/.test(p.name)), 2], [by((p) => /Alfajor/.test(p.name)), 3]];
  return picks.filter(([p]) => !!p).map(([product, qty]) => ({ product, qty }));
}

export const usePosPractice = create<PracticeState>((set, get) => ({
  active: false,
  backup: null,
  start: (profile) => {
    if (get().active) return;
    const s = usePOSStore.getState();
    const backup = { products: s.products, categories: s.categories, promotions: s.promotions, cart: s.cart, selectedClient: s.selectedClient };
    const { categories, products } = sampleCatalog(profile);
    usePOSStore.setState({ products, categories, promotions: [], cart: [], selectedClient: null } as any);
    set({ active: true, backup });
  },
  end: () => {
    const { active, backup } = get();
    if (!active) return;
    if (backup) usePOSStore.setState({ products: backup.products, categories: backup.categories, promotions: backup.promotions, cart: backup.cart, selectedClient: backup.selectedClient } as any);
    set({ active: false, backup: null });
  },
}));

/** Lo usan las cargas automáticas de la caja: en práctica no se pisa el catálogo de ejemplo */
export const inPractice = () => usePosPractice.getState().active;
