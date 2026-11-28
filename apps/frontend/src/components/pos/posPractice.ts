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
  backup: null | { products: any[]; categories: any[]; promotions: any[]; rawPromotions?: any[]; cart: any[]; selectedClient: any; order: any };
  start: (profile: BusinessProfile) => void;
  end: () => void;
}

const cat = (id: string, name: string, color: string, count: number) => ({ id, name, color, _count: { products: count } });

/**
 * Foto real de los productos de ejemplo (public/practica, 400 px en .webp, ~1 MB en total). Las de
 * marca son de Open Food Facts con su código de barras real; las demás de Pexels, Wikimedia Commons
 * y Openverse. Fuente y licencia de cada una en public/practica/creditos.json.
 */
const ph = (file: string) => `./practica/${file}.webp`;

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
    case 'CARNICERIA': {
      const c = [cat('pc_c1', 'Vacuno', '#b91c1c', 5), cat('pc_c2', 'Cerdo y pollo', '#f59e0b', 3), cat('pc_c3', 'Embutidos', '#7c2d12', 2)];
      const kg = (plu: number) => ({ unit: 'KG', sku: String(plu), stock: 30 });
      return { categories: c, products: [
        prod('Asado de tira', 15900, c[0], { ...kg(10), imageUrl: ph('carniceria/asado') }), prod('Vacío', 17900, c[0], { ...kg(11), imageUrl: ph('carniceria/vacio') }),
        prod('Nalga', 18900, c[0], { ...kg(13), imageUrl: ph('carniceria/nalga') }), prod('Bife de chorizo', 21900, c[0], { ...kg(16), imageUrl: ph('carniceria/bife') }),
        prod('Carne picada especial', 12900, c[0], { ...kg(19), imageUrl: ph('carniceria/picada') }),
        prod('Bondiola', 11900, c[1], { ...kg(30), imageUrl: ph('carniceria/bondiola') }), prod('Pollo entero', 4900, c[1], { ...kg(40), imageUrl: ph('carniceria/pollo') }),
        prod('Pechuga', 8900, c[1], { ...kg(42), imageUrl: ph('carniceria/pechuga') }),
        prod('Chorizo puro cerdo', 9500, c[2], { ...kg(50), imageUrl: ph('carniceria/chorizo') }), prod('Morcilla', 7500, c[2], { ...kg(51), imageUrl: ph('carniceria/morcilla') }),
      ] };
    }
    case 'FIAMBRERIA': {
      const c = [cat('pc_b1', 'Fiambres', '#e11d48', 4), cat('pc_b2', 'Quesos', '#eab308', 4), cat('pc_b3', 'Almacén', '#10b981', 2)];
      const kg = (plu: number) => ({ unit: 'KG', sku: String(plu), stock: 10 });
      return { categories: c, products: [
        prod('Jamón cocido natural', 18900, c[0], { ...kg(110), imageUrl: ph('fiambreria/jamon') }), prod('Jamón crudo', 39900, c[0], { ...kg(111), imageUrl: ph('fiambreria/crudo') }),
        prod('Salamín picado grueso', 21900, c[0], { ...kg(113), imageUrl: ph('fiambreria/salamin') }), prod('Salame Milán', 24900, c[0], { ...kg(130), imageUrl: ph('fiambreria/salame') }),
        prod('Queso de máquina', 15900, c[1], { ...kg(120), imageUrl: ph('fiambreria/quesomaq') }), prod('Queso cremoso', 11900, c[1], { ...kg(121), imageUrl: ph('fiambreria/cremoso') }),
        prod('Queso tybo', 14900, c[1], { ...kg(122), imageUrl: ph('fiambreria/tybo') }), prod('Muzzarella', 10900, c[1], { ...kg(125), imageUrl: ph('fiambreria/muzza') }),
        prod('Pan de miga x8', 4500, c[2], { imageUrl: ph('fiambreria/panmiga') }), prod('Aceitunas verdes 200 g', 3200, c[2], { imageUrl: ph('fiambreria/aceitunas') }),
      ] };
    }
    case 'VERDULERIA': {
      const c = [cat('pc_v1', 'Verduras', '#16a34a', 5), cat('pc_v2', 'Frutas', '#f97316', 4), cat('pc_v3', 'Por unidad', '#65a30d', 3)];
      const kg = (plu: number) => ({ unit: 'KG', sku: String(plu), stock: 40 });
      return { categories: c, products: [
        prod('Papa', 1200, c[0], { ...kg(10), imageUrl: ph('verduleria/papa') }), prod('Cebolla', 1100, c[0], { ...kg(11), imageUrl: ph('verduleria/cebolla') }),
        prod('Tomate redondo', 2900, c[0], { ...kg(12), imageUrl: ph('verduleria/tomate') }), prod('Zanahoria', 1300, c[0], { ...kg(13), imageUrl: ph('verduleria/zanahoria') }),
        prod('Zapallo anco', 1500, c[0], { ...kg(14), imageUrl: ph('verduleria/zapallo') }),
        prod('Banana', 2200, c[1], { ...kg(30), imageUrl: ph('verduleria/banana') }), prod('Manzana roja', 2600, c[1], { ...kg(31), imageUrl: ph('verduleria/manzana') }),
        prod('Naranja de jugo', 1400, c[1], { ...kg(32), imageUrl: ph('verduleria/naranja') }), prod('Limón', 1800, c[1], { ...kg(33), imageUrl: ph('verduleria/limon') }),
        prod('Lechuga', 1500, c[2], { sku: '50', stock: 20, imageUrl: ph('verduleria/lechuga') }), prod('Perejil (atado)', 800, c[2], { sku: '51', stock: 15, imageUrl: ph('verduleria/perejil') }),
        prod('Huevos (docena)', 3600, c[2], { sku: '52', stock: 20, imageUrl: ph('verduleria/huevos') }),
      ] };
    }
    case 'FERRETERIA': {
      const c = [cat('pc_f1', 'Tornillería', '#64748b', 3), cat('pc_f2', 'Electricidad', '#f59e0b', 3), cat('pc_f3', 'Pinturería', '#3b82f6', 2)];
      return { categories: c, products: [
        prod('Tornillo autoperforante 8x1"', 45, c[0], { imageUrl: ph('ferreteria/tornillo') }), prod('Tarugo Fischer 8 mm', 30, c[0], { imageUrl: ph('ferreteria/tarugo') }),
        prod('Clavo punta París 2" (kg)', 4200, c[0], { unit: 'KG', imageUrl: ph('ferreteria/clavos') }),
        prod('Cable unipolar 2,5 mm (metro)', 980, c[1], { unit: 'MT', imageUrl: ph('ferreteria/cable') }), prod('Lámpara LED 12 W', 2900, c[1], { imageUrl: ph('ferreteria/lampara') }),
        prod('Cinta aisladora', 1500, c[1], { imageUrl: ph('ferreteria/cinta') }),
        prod('Látex interior blanco 4 L', 28500, c[2], { imageUrl: ph('ferreteria/latex') }), prod('Rodillo de lana 22 cm', 7400, c[2], { imageUrl: ph('ferreteria/rodillo') }),
      ] };
    }
    case 'INDUMENTARIA': {
      const c = [cat('pc_i1', 'Remeras', '#ec4899', 6), cat('pc_i2', 'Pantalones', '#6366f1', 3), cat('pc_i3', 'Accesorios', '#14b8a6', 2)];
      return { categories: c, products: [
        ...variants('Remera básica', () => 14900, c[0], { talle: ['S', 'M', 'L'], color: ['Negro', 'Blanco'] }).map((p) => ({ ...p, imageUrl: ph('varios/remera') })),
        ...variants('Jean recto', () => 45900, c[1], { talle: ['38', '40', '42'] }).map((p) => ({ ...p, imageUrl: ph('varios/jean') })),
        prod('Gorra', 12500, c[2], { imageUrl: ph('varios/gorra') }), prod('Medias x3', 6900, c[2], { imageUrl: ph('varios/medias') }),
      ] };
    }
    case 'GASTRONOMIA': {
      const c = [cat('pc_g1', 'Pizzas', '#ef4444', 4), cat('pc_g2', 'Empanadas', '#f59e0b', 3), cat('pc_g3', 'Bebidas', '#0ea5e9', 3)];
      return { categories: c, products: [
        ...variants('Pizza muzzarella', (a) => (a['tamaño'] === 'Grande' ? 14500 : 10500), c[0], { 'tamaño': ['Chica', 'Grande'] }).map((p) => ({ ...p, imageUrl: ph('varios/pizzamuzza') })),
        ...variants('Pizza napolitana', (a) => (a['tamaño'] === 'Grande' ? 16500 : 12000), c[0], { 'tamaño': ['Chica', 'Grande'] }).map((p) => ({ ...p, imageUrl: ph('varios/pizzanapo') })),
        prod('Empanada de carne', 1600, c[1], { imageUrl: ph('varios/empanadas') }), prod('Empanada de jamón y queso', 1600, c[1], { imageUrl: ph('varios/empanadas') }),
        prod('Empanada de pollo', 1600, c[1], { imageUrl: ph('varios/empanadas') }),
        prod('Coca-Cola Zero 1,5 L', 3800, c[2], { barcode: '7790895067556', imageUrl: ph('marcas/cocazero15') }),
        prod('Agua Villavicencio 500 ml', 1500, c[2], { barcode: '7799155000173', imageUrl: ph('marcas/villa500') }),
        prod('Cerveza Quilmes lata 473 ml', 2600, c[2], { barcode: '7792798012923', imageUrl: ph('marcas/quilmes') }),
      ] };
    }
    case 'MULTIRUBRO': {
      const c = [cat('pc_m1', 'Bazar', '#8b5cf6', 3), cat('pc_m2', 'Ropa', '#ec4899', 3), cat('pc_m3', 'Por medida', '#64748b', 2)];
      return { categories: c, products: [
        prod('Taza de cerámica', 4500, c[0], { imageUrl: ph('varios/taza') }), prod('Set de cubiertos x24', 18900, c[0], { imageUrl: ph('varios/cubiertos') }),
        prod('Repasador', 2500, c[0], { imageUrl: ph('varios/repasador') }),
        ...variants('Remera básica', () => 14900, c[1], { talle: ['S', 'M', 'L'] }).map((p) => ({ ...p, imageUrl: ph('varios/remera') })),
        prod('Cinta bebé (metro)', 600, c[2], { unit: 'MT', imageUrl: ph('varios/cinta') }), prod('Hilo de algodón (metro)', 250, c[2], { unit: 'MT', imageUrl: ph('varios/hilo') }),
      ] };
    }
    case 'DISTRIBUIDORA': {
      const c = [cat('pc_d1', 'Bebidas', '#0ea5e9', 3), cat('pc_d2', 'Golosinas', '#f59e0b', 3), cat('pc_d3', 'Almacén y limpieza', '#10b981', 3)];
      const bulto = (units: number, packPrice: number) => ({ unitsPerPack: units, packPrice, stock: units * 40 });
      return { categories: c, products: [
        prod('Coca-Cola 2,25 L', 2900, c[0], { ...bulto(6, 15600), barcode: '7790895000997', imageUrl: ph('marcas/coca225') }),
        prod('Agua Villavicencio 2 L', 1500, c[0], { ...bulto(6, 7800), barcode: '7790315000422', imageUrl: ph('marcas/villa2l') }),
        prod('Cerveza Quilmes lata 473 ml', 2100, c[0], { ...bulto(24, 45600), barcode: '7792798012923', imageUrl: ph('marcas/quilmes') }),
        prod('Alfajor Guaymallén dulce de leche', 1100, c[1], { ...bulto(40, 38000), barcode: '77980229', imageUrl: ph('marcas/guaymallen') }),
        prod('Caramelos Sugus confitados 50 g', 900, c[1], { ...bulto(24, 19200), barcode: '7790580056001', imageUrl: ph('marcas/sugus') }),
        prod('Chicles Topline Ultra', 1900, c[1], { ...bulto(18, 30600), barcode: '7790580120573', imageUrl: ph('marcas/topline') }),
        prod('Yerba Taragüi 1 kg', 5200, c[2], { ...bulto(10, 47000), barcode: '7790387110159', imageUrl: ph('marcas/taragui') }),
        prod('Fideos Matarazzo tallarín 500 g', 1300, c[2], { ...bulto(20, 23000), barcode: '7790070336316', imageUrl: ph('marcas/matarazzo') }),
        prod('Lavandina Ayudín 1 L', 1100, c[2], { ...bulto(12, 11400), barcode: '7790132098459', imageUrl: ph('marcas/ayudin') }),
      ] };
    }
    case 'IMPRENTA': {
      const c = [cat('pc_p1', 'Impresiones', '#3b82f6', 3), cat('pc_p2', 'Gráfica', '#8b5cf6', 2), cat('pc_p3', 'Sellos y regalos', '#ec4899', 2)];
      const servicio = { unlimitedStock: true };
      return { categories: c, products: [
        prod('Fotocopia B/N A4', 150, c[0], { ...servicio, imageUrl: ph('varios/fotocopia') }), prod('Impresión color A4', 600, c[0], { ...servicio, imageUrl: ph('varios/impresion') }),
        prod('Anillado hasta 100 hojas', 2500, c[0], { ...servicio, imageUrl: ph('varios/anillado') }),
        prod('Tarjetas personales x100', 18000, c[1], { ...servicio, imageUrl: ph('varios/tarjetas') }), prod('Volantes A5 x1000', 65000, c[1], { ...servicio, imageUrl: ph('varios/volantes') }),
        prod('Sello automático 38x14', 21000, c[2], { ...servicio, imageUrl: ph('varios/sello') }), prod('Taza sublimada', 9500, c[2], { imageUrl: ph('varios/taza') }),
      ] };
    }
    default: {
      const c = [cat('pc_k1', 'Bebidas', '#0ea5e9', 3), cat('pc_k2', 'Golosinas', '#f59e0b', 4), cat('pc_k3', 'Almacén', '#10b981', 3)];
      return { categories: c, products: [
        prod('Coca-Cola 500 ml', 1800, c[0], { barcode: '7790895000782', imageUrl: ph('marcas/coca500') }),
        prod('Agua Villavicencio 500 ml', 1200, c[0], { barcode: '7799155000173', imageUrl: ph('marcas/villa500') }),
        prod('Cepita naranja 1 L', 2100, c[0], { barcode: '7790895648441', imageUrl: ph('marcas/cepita') }),
        prod('Alfajor Jorgito', 1500, c[1], { barcode: '77905741', imageUrl: ph('marcas/jorgito') }),
        prod('Chocolate Milka almendras 155 g', 4300, c[1], { barcode: '7622300990152', imageUrl: ph('marcas/milka') }),
        prod('Sugus confitados 50 g', 900, c[1], { barcode: '7790580056001', imageUrl: ph('marcas/sugus') }),
        prod('Chicles Beldent menta', 900, c[1], { barcode: '77969071', imageUrl: ph('marcas/beldent') }),
        prod('Galletitas Express', 1400, c[2], { barcode: '7622201509194', imageUrl: ph('marcas/express') }),
        prod('Yerba Playadito 500 g', 3600, c[2], { barcode: '7793704000911', imageUrl: ph('marcas/playadito') }),
        prod('Leche La Serenísima 1 L', 1700, c[2], { barcode: '7790742358608', imageUrl: ph('marcas/serenisima') }),
      ] };
    }
  }
}

/** Qué agrega el recorrido al ticket de práctica: un par de cosas típicas del rubro */
export function practiceTicket(profile: BusinessProfile, products: any[]): { product: any; qty: number }[] {
  const by = (pred: (p: any) => boolean) => products.find(pred);
  const picks: [any, number][] =
    profile === 'CARNICERIA' ? [[by((p) => /Asado/.test(p.name)), 1.5], [by((p) => /Chorizo/.test(p.name)), 0.5]]
    : profile === 'FIAMBRERIA' ? [[by((p) => /cocido/.test(p.name)), 0.25], [by((p) => /máquina/.test(p.name)), 0.3]]
    : profile === 'VERDULERIA' ? [[by((p) => /^Papa/.test(p.name)), 2], [by((p) => /Tomate/.test(p.name)), 1], [by((p) => /Lechuga/.test(p.name)), 1]]
    : profile === 'FERRETERIA' ? [[by((p) => p.unit === 'MT'), 5], [by((p) => /Tornillo/.test(p.name)), 20]]
    : profile === 'INDUMENTARIA' ? [[by((p) => /Remera.*M Negro/.test(p.name)), 1], [by((p) => /Gorra/.test(p.name)), 1]]
    : profile === 'GASTRONOMIA' ? [[by((p) => /muzzarella Grande/.test(p.name)), 1], [by((p) => /carne/.test(p.name)), 6], [by((p) => /Coca/.test(p.name)), 1]]
    : profile === 'MULTIRUBRO' ? [[by((p) => /Taza/.test(p.name)), 2], [by((p) => p.unit === 'MT'), 3]]
    : profile === 'DISTRIBUIDORA' ? [[by((p) => /Coca/.test(p.name)), 2], [by((p) => /Alfajor/.test(p.name)), 1]]
    : profile === 'IMPRENTA' ? [[by((p) => /color/.test(p.name)), 10], [by((p) => /Anillado/.test(p.name)), 1]]
    : [[by((p) => /Coca/.test(p.name)), 2], [by((p) => /Alfajor/.test(p.name)), 3]];
  return picks.filter(([p]) => !!p).map(([product, qty]) => ({ product, qty }));
}

export const usePosPractice = create<PracticeState>((set, get) => ({
  active: false,
  backup: null,
  start: (profile) => {
    if (get().active) return;
    const s = usePOSStore.getState();
    const backup = { products: s.products, categories: s.categories, promotions: s.promotions, rawPromotions: s.rawPromotions, cart: s.cart, selectedClient: s.selectedClient, order: s.order };
    const { categories, products } = sampleCatalog(profile);
    usePOSStore.setState({ products, categories, promotions: [], rawPromotions: [], cart: [], selectedClient: null } as any);
    set({ active: true, backup });
  },
  end: () => {
    const { active, backup } = get();
    if (!active) return;
    if (backup) usePOSStore.setState({ products: backup.products, categories: backup.categories, promotions: backup.promotions, rawPromotions: backup.rawPromotions || [], cart: backup.cart, selectedClient: backup.selectedClient, order: backup.order } as any);
    set({ active: false, backup: null });
  },
}));

/** Lo usan las cargas automáticas de la caja: en práctica no se pisa el catálogo de ejemplo */
export const inPractice = () => usePosPractice.getState().active;
