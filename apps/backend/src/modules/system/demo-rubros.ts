import * as bcrypt from 'bcrypt';
import { numberRange, nextDocNumber } from '../sync/numbering';
import { DEMO_PRODUCTS, DEMO_CATEGORY_COLORS } from './demo-reset.service';

/**
 * Demo pública: datos de ejemplo de cada rubro.
 *
 * La base de cada visitante arranca con el kiosco de ejemplo. Al elegir otro rubro, los
 * productos del kiosco se apagan (no se borran: si el visitante ya vendió, sus ventas los
 * siguen nombrando) y aparece el catálogo del rubro, más lo que lo muestra trabajando:
 * encargos en la imprenta, pedidos de preventa y un reparto en la distribuidora.
 * Volver a un rubro ya elegido reactiva lo suyo, sin duplicar nada.
 */

export const DEMO_PROFILES = ['KIOSKO', 'CARNICERIA', 'FIAMBRERIA', 'VERDULERIA', 'FERRETERIA', 'INDUMENTARIA', 'GASTRONOMIA', 'MULTIRUBRO', 'DISTRIBUIDORA', 'IMPRENTA', 'NUTRICION'] as const;
export type DemoProfile = typeof DEMO_PROFILES[number];

interface Item {
  name: string;
  price: number;
  category: string;
  stock?: number;
  unit?: 'UNIT' | 'KG' | 'MT' | 'L';
  pieceSize?: number;
  unitsPerPack?: number;
  packPrice?: number;
  tradePrice?: number;
  unlimited?: boolean;
  /** Variantes: nombre del modelo y atributos de esta variante */
  baseName?: string;
  attrs?: Record<string, string>;
  /** Carnicería, fiambrería y verdulería: código de la balanza (PLU). Va como código del producto */
  plu?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Tornillería': '#64748b', Electricidad: '#f59e0b', 'Pinturería': '#3b82f6', Herramientas: '#ef4444', Sanitarios: '#06b6d4',
  Remeras: '#ec4899', Pantalones: '#6366f1', Buzos: '#8b5cf6', Accesorios: '#14b8a6',
  Pizzas: '#ef4444', Empanadas: '#f59e0b', Bebidas: '#0ea5e9', Postres: '#ec4899',
  Bazar: '#8b5cf6', Ropa: '#ec4899', 'Por medida': '#64748b', 'Librería': '#10b981',
  Golosinas: '#f59e0b', 'Almacén': '#10b981', Limpieza: '#06b6d4',
  Impresiones: '#3b82f6', 'Gráfica': '#8b5cf6', 'Gran formato': '#f97316', 'Sellos y regalos': '#ec4899',
  Vacuno: '#b91c1c', Cerdo: '#f472b6', Pollo: '#f59e0b', 'Achuras y embutidos': '#7c2d12', Elaborados: '#ea580c',
  Fiambres: '#e11d48', Quesos: '#eab308', Salames: '#9f1239', Fiambrería: '#e11d48',
  Verduras: '#16a34a', Frutas: '#f97316', 'Por unidad': '#65a30d', 'Huevos y almacén': '#ca8a04',
};

/** Todas las combinaciones de los ejes (talle × color, tamaño…) como variantes de un modelo. */
function variants(baseName: string, category: string, axes: Record<string, string[]>, price: (a: Record<string, string>) => number, extra: Partial<Item> = {}): Item[] {
  let combos: Record<string, string>[] = [{}];
  for (const [axis, values] of Object.entries(axes)) combos = combos.flatMap((c) => values.map((v) => ({ ...c, [axis]: v })));
  return combos.map((attrs) => ({ name: `${baseName} ${Object.values(attrs).join(' ')}`, price: price(attrs), category, baseName, attrs, ...extra }));
}

const bulto = (unitsPerPack: number, packPrice: number): Partial<Item> => ({ unitsPerPack, packPrice, stock: unitsPerPack * 40 });

/** Por kilo, con su código de balanza */
const kilo = (plu: number, name: string, price: number, category: string, stock = 15): Item => ({ name, price, category, unit: 'KG', stock, plu });

const CATALOGS: Record<Exclude<DemoProfile, 'KIOSKO'>, Item[]> = {
  CARNICERIA: [
    kilo(10, 'ASADO', 15900, 'Vacuno', 30), kilo(11, 'VACÍO', 17900, 'Vacuno', 20), kilo(12, 'MATAMBRE', 16900, 'Vacuno', 10),
    kilo(13, 'NALGA', 18900, 'Vacuno'), kilo(14, 'CUADRADA', 17500, 'Vacuno'), kilo(15, 'PECETO', 19900, 'Vacuno', 8),
    kilo(16, 'BIFE DE CHORIZO', 21900, 'Vacuno', 12), kilo(17, 'COLITA DE CUADRIL', 19500, 'Vacuno', 8), kilo(18, 'PALETA', 14900, 'Vacuno'),
    kilo(19, 'CARNE PICADA ESPECIAL', 12900, 'Vacuno', 25), kilo(20, 'OSOBUCO', 8900, 'Vacuno'),
    kilo(30, 'BONDIOLA', 11900, 'Cerdo', 10), kilo(31, 'PECHITO DE CERDO', 9900, 'Cerdo', 10), kilo(32, 'CARRÉ DE CERDO', 10900, 'Cerdo', 10),
    kilo(40, 'POLLO ENTERO', 4900, 'Pollo', 30), kilo(41, 'PATA Y MUSLO', 5900, 'Pollo', 20), kilo(42, 'PECHUGA', 8900, 'Pollo', 15),
    kilo(50, 'CHORIZO PURO CERDO', 9500, 'Achuras y embutidos', 12), kilo(51, 'MORCILLA', 7500, 'Achuras y embutidos', 8), kilo(52, 'MOLLEJAS', 22900, 'Achuras y embutidos', 4),
    kilo(60, 'MILANESA DE NALGA', 16900, 'Elaborados', 10), kilo(61, 'MILANESA DE POLLO', 10900, 'Elaborados', 10), kilo(62, 'HAMBURGUESA CASERA', 11900, 'Elaborados', 8),
    { name: 'CARBÓN 4KG', price: 6500, category: 'Elaborados', stock: 20 },
  ],
  FIAMBRERIA: [
    kilo(110, 'JAMÓN COCIDO NATURAL', 18900, 'Fiambres', 8), kilo(111, 'JAMÓN CRUDO', 39900, 'Fiambres', 4), kilo(112, 'PALETA COCIDA', 12900, 'Fiambres', 8),
    kilo(113, 'MORTADELA', 9900, 'Fiambres', 6), kilo(114, 'LOMITO AHUMADO', 34900, 'Fiambres', 3), kilo(115, 'PANCETA AHUMADA', 22900, 'Fiambres', 4),
    kilo(120, 'QUESO DE MÁQUINA', 15900, 'Quesos', 10), kilo(121, 'QUESO CREMOSO', 11900, 'Quesos', 12), kilo(122, 'QUESO TYBO', 14900, 'Quesos', 8),
    kilo(123, 'QUESO SARDO', 21900, 'Quesos', 5), kilo(124, 'QUESO AZUL', 24900, 'Quesos', 3), kilo(125, 'MUZZARELLA', 10900, 'Quesos', 15),
    kilo(130, 'SALAME MILÁN', 24900, 'Salames', 5), kilo(131, 'SALAMÍN PICADO FINO', 26900, 'Salames', 4), kilo(132, 'LONGANIZA', 21900, 'Salames', 4),
    { name: 'ACEITUNAS VERDES 200G', price: 3200, category: 'Fiambrería', stock: 20 },
    { name: 'PAN DE MIGA X8', price: 4500, category: 'Fiambrería', stock: 15 },
  ],
  VERDULERIA: [
    kilo(10, 'PAPA', 1200, 'Verduras', 80), kilo(11, 'PAPA NEGRA', 1500, 'Verduras', 30), kilo(12, 'CEBOLLA', 1100, 'Verduras', 60),
    kilo(13, 'TOMATE REDONDO', 2900, 'Verduras', 25), kilo(14, 'TOMATE PERITA', 2500, 'Verduras', 20), kilo(15, 'ZANAHORIA', 1300, 'Verduras', 30),
    kilo(16, 'ZAPALLO ANCO', 1500, 'Verduras', 25), kilo(17, 'ZAPALLITO REDONDO', 2200, 'Verduras', 12), kilo(18, 'BATATA', 1600, 'Verduras', 30),
    kilo(19, 'MORRÓN ROJO', 5900, 'Verduras', 8), kilo(20, 'BERENJENA', 2400, 'Verduras', 10), kilo(21, 'AJO', 7900, 'Verduras', 4),
    kilo(30, 'BANANA', 2200, 'Frutas', 40), kilo(31, 'MANZANA ROJA', 2600, 'Frutas', 35), kilo(32, 'MANZANA VERDE', 2800, 'Frutas', 20),
    kilo(33, 'NARANJA DE JUGO', 1400, 'Frutas', 50), kilo(34, 'MANDARINA', 1900, 'Frutas', 30), kilo(35, 'LIMÓN', 1800, 'Frutas', 15),
    kilo(36, 'PERA', 2700, 'Frutas', 20), kilo(37, 'FRUTILLA', 6900, 'Frutas', 6), kilo(38, 'PALTA', 8900, 'Frutas', 5),
    { name: 'LECHUGA', price: 1500, category: 'Por unidad', stock: 25, plu: 50 },
    { name: 'ACELGA (ATADO)', price: 1200, category: 'Por unidad', stock: 15, plu: 51 },
    { name: 'PEREJIL (ATADO)', price: 800, category: 'Por unidad', stock: 20, plu: 52 },
    { name: 'VERDEO (ATADO)', price: 900, category: 'Por unidad', stock: 15, plu: 53 },
    { name: 'ANANÁ', price: 4500, category: 'Por unidad', stock: 8, plu: 54 },
    { name: 'HUEVOS (MAPLE X30)', price: 8900, category: 'Huevos y almacén', stock: 12, plu: 60 },
    { name: 'HUEVOS (DOCENA)', price: 3600, category: 'Huevos y almacén', stock: 20, plu: 61 },
    { name: 'BOLSA DE CARBÓN 4KG', price: 6500, category: 'Huevos y almacén', stock: 10 },
  ],
  FERRETERIA: [
    { name: 'TORNILLO AUTOPERFORANTE 8X1"', price: 45, category: 'Tornillería', stock: 800, tradePrice: 40 },
    { name: 'TARUGO FISCHER 8MM', price: 30, category: 'Tornillería', stock: 1200, tradePrice: 26 },
    { name: 'ARANDELA PLANA 1/4"', price: 20, category: 'Tornillería', stock: 600 },
    { name: 'CLAVO PUNTA PARÍS 2" (KG)', price: 4200, category: 'Tornillería', unit: 'KG', stock: 25, pieceSize: 25 },
    { name: 'CABLE UNIPOLAR 2,5MM (METRO)', price: 980, category: 'Electricidad', unit: 'MT', stock: 300, pieceSize: 100, tradePrice: 880 },
    { name: 'LÁMPARA LED 12W', price: 2900, category: 'Electricidad', stock: 40 },
    { name: 'CINTA AISLADORA', price: 1500, category: 'Electricidad', stock: 50 },
    { name: 'TOMACORRIENTE DOBLE', price: 3800, category: 'Electricidad', stock: 20 },
    { name: 'LÁTEX INTERIOR BLANCO 4L', price: 28500, category: 'Pinturería', stock: 12, tradePrice: 25600 },
    { name: 'RODILLO LANA 22CM', price: 7400, category: 'Pinturería', stock: 15 },
    { name: 'PINCEL N° 20', price: 3200, category: 'Pinturería', stock: 18 },
    { name: 'LIJA AL AGUA N° 220', price: 900, category: 'Pinturería', stock: 60 },
    { name: 'MARTILLO CARPINTERO 16OZ', price: 14500, category: 'Herramientas', stock: 6 },
    { name: 'DESTORNILLADOR PHILLIPS 3/16', price: 5200, category: 'Herramientas', stock: 10 },
    { name: 'CINTA MÉTRICA 5M', price: 8900, category: 'Herramientas', stock: 8 },
    { name: 'CAÑO PVC 110MM (METRO)', price: 6800, category: 'Sanitarios', unit: 'MT', stock: 48, pieceSize: 4 },
    { name: 'CINTA DE TEFLÓN', price: 700, category: 'Sanitarios', stock: 80 },
  ],
  INDUMENTARIA: [
    ...variants('REMERA BÁSICA', 'Remeras', { talle: ['S', 'M', 'L'], color: ['Negro', 'Blanco'] }, () => 14900, { stock: 6 }),
    ...variants('JEAN RECTO', 'Pantalones', { talle: ['38', '40', '42', '44'] }, () => 45900, { stock: 4 }),
    ...variants('BUZO CANGURO', 'Buzos', { talle: ['S', 'M', 'L'], color: ['Gris', 'Azul'] }, () => 32900, { stock: 3 }),
    { name: 'GORRA', price: 12500, category: 'Accesorios', stock: 10 },
    { name: 'MEDIAS X3', price: 6900, category: 'Accesorios', stock: 20 },
    { name: 'CINTURÓN DE CUERO', price: 18900, category: 'Accesorios', stock: 7 },
  ],
  GASTRONOMIA: [
    ...variants('PIZZA MUZZARELLA', 'Pizzas', { 'tamaño': ['Chica', 'Grande'] }, (a) => (a['tamaño'] === 'Grande' ? 14500 : 10500), { unlimited: true }),
    ...variants('PIZZA NAPOLITANA', 'Pizzas', { 'tamaño': ['Chica', 'Grande'] }, (a) => (a['tamaño'] === 'Grande' ? 16500 : 12000), { unlimited: true }),
    ...variants('PIZZA FUGAZZETA', 'Pizzas', { 'tamaño': ['Chica', 'Grande'] }, (a) => (a['tamaño'] === 'Grande' ? 15500 : 11500), { unlimited: true }),
    { name: 'EMPANADA DE CARNE', price: 1600, category: 'Empanadas', unlimited: true },
    { name: 'EMPANADA DE JAMÓN Y QUESO', price: 1600, category: 'Empanadas', unlimited: true },
    { name: 'EMPANADA DE POLLO', price: 1600, category: 'Empanadas', unlimited: true },
    { name: 'EMPANADA DE HUMITA', price: 1600, category: 'Empanadas', unlimited: true },
    { name: 'GASEOSA 1,5L', price: 3800, category: 'Bebidas', stock: 30 },
    { name: 'AGUA SIN GAS 500ML', price: 1500, category: 'Bebidas', stock: 40 },
    { name: 'CERVEZA LATA', price: 2600, category: 'Bebidas', stock: 48 },
    { name: 'FLAN CASERO', price: 3500, category: 'Postres', unlimited: true },
  ],
  MULTIRUBRO: [
    { name: 'TAZA DE CERÁMICA', price: 4500, category: 'Bazar', stock: 24 },
    { name: 'SET DE CUBIERTOS X24', price: 18900, category: 'Bazar', stock: 6 },
    { name: 'VASOS DE VIDRIO X6', price: 9800, category: 'Bazar', stock: 10 },
    { name: 'REPASADOR', price: 2500, category: 'Bazar', stock: 30 },
    ...variants('REMERA BÁSICA', 'Ropa', { talle: ['S', 'M', 'L'] }, () => 14900, { stock: 5 }),
    { name: 'CINTA BEBÉ (METRO)', price: 600, category: 'Por medida', unit: 'MT', stock: 200, pieceSize: 50 },
    { name: 'HILO DE ALGODÓN (METRO)', price: 250, category: 'Por medida', unit: 'MT', stock: 500, pieceSize: 100 },
    { name: 'CUADERNO A4 TAPA DURA', price: 5600, category: 'Librería', stock: 25 },
    { name: 'PILAS AA X4', price: 4200, category: 'Librería', stock: 30 },
  ],
  DISTRIBUIDORA: [
    { name: 'GASEOSA COLA 2,25L', price: 2900, category: 'Bebidas', ...bulto(6, 15600) },
    { name: 'AGUA MINERAL 2L', price: 1500, category: 'Bebidas', ...bulto(6, 7800) },
    { name: 'CERVEZA LATA 473ML', price: 2100, category: 'Bebidas', ...bulto(24, 45600) },
    { name: 'JUGO EN POLVO NARANJA', price: 650, category: 'Bebidas', ...bulto(18, 10800) },
    { name: 'ALFAJOR TRIPLE', price: 1100, category: 'Golosinas', ...bulto(24, 22800) },
    { name: 'CARAMELOS MASTICABLES X100', price: 2600, category: 'Golosinas', ...bulto(12, 28800) },
    { name: 'CHICLES X20', price: 3900, category: 'Golosinas', ...bulto(18, 63000) },
    { name: 'YERBA MATE 1KG', price: 5200, category: 'Almacén', ...bulto(10, 47000) },
    { name: 'FIDEOS GUISEROS 500G', price: 1300, category: 'Almacén', ...bulto(20, 23000) },
    { name: 'ACEITE DE GIRASOL 900ML', price: 3100, category: 'Almacén', ...bulto(12, 34800) },
    { name: 'LAVANDINA 1L', price: 1100, category: 'Limpieza', ...bulto(12, 11400) },
    { name: 'PAPEL HIGIÉNICO X4', price: 2400, category: 'Limpieza', ...bulto(12, 26400) },
  ],
  IMPRENTA: [
    { name: 'FOTOCOPIA B/N A4', price: 150, category: 'Impresiones', unlimited: true },
    { name: 'IMPRESIÓN COLOR A4', price: 600, category: 'Impresiones', unlimited: true },
    { name: 'ANILLADO HASTA 100 HOJAS', price: 2500, category: 'Impresiones', unlimited: true },
    { name: 'PLASTIFICADO A4', price: 1200, category: 'Impresiones', unlimited: true },
    { name: 'TARJETAS PERSONALES X100', price: 18000, category: 'Gráfica', unlimited: true },
    { name: 'VOLANTES A5 X1000', price: 65000, category: 'Gráfica', unlimited: true },
    { name: 'TALONARIO X50 DUPLICADO', price: 9500, category: 'Gráfica', unlimited: true },
    { name: 'STICKERS TROQUELADOS X50', price: 14000, category: 'Gráfica', unlimited: true },
    { name: 'LONA FRONT IMPRESA (M²)', price: 16000, category: 'Gran formato', unlimited: true },
    { name: 'VINILO DE CORTE (M²)', price: 22000, category: 'Gran formato', unlimited: true },
    { name: 'BANNER ROLL-UP 85X200', price: 78000, category: 'Gran formato', unlimited: true },
    { name: 'SELLO AUTOMÁTICO 38X14', price: 21000, category: 'Sellos y regalos', unlimited: true },
    { name: 'TAZA SUBLIMADA', price: 9500, category: 'Sellos y regalos', stock: 20 },
    { name: 'REMERA SUBLIMADA', price: 15000, category: 'Sellos y regalos', stock: 15 },
  ],
  // Nutricionista: no vende. Sin productos; los pacientes viven en la nube (en la demo, en el navegador)
  NUTRICION: [],
};

const skuPrefix = (profile: DemoProfile) => `DEMO-${profile}-`;
const KIOSKO_BARCODES = DEMO_PRODUCTS.map((p) => p.barcode);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const daysFromNow = (d: number, hour = 12) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(hour, 0, 0, 0); return t; };

/**
 * Prende el catálogo de los rubros elegidos (creándolo la primera vez) y apaga el de los demás.
 * Un almacén con carnicería ve los dos catálogos juntos.
 */
export async function applyDemoProfile(db: any, profileOrList: DemoProfile | DemoProfile[]) {
  const profiles = [...new Set(Array.isArray(profileOrList) ? profileOrList : [profileOrList])];
  // Lo de los otros rubros de ejemplo se apaga y sale de su categoría (la caja muestra todas
  // las categorías, tengan o no productos activos). Lo que cargó el visitante no se toca.
  // (en dos pasos: los del kiosco no tienen sku y un NOT sobre un sku vacío no los tomaría)
  const off = { isActive: false, categoryId: null };
  if (!profiles.includes('KIOSKO')) await db.product.updateMany({ where: { barcode: { in: KIOSKO_BARCODES } }, data: off });
  await db.product.updateMany({ where: { sku: { startsWith: 'DEMO-' }, NOT: { OR: profiles.map((p) => ({ sku: { startsWith: skuPrefix(p) } })) } }, data: off });

  for (const profile of profiles) {
    if (profile === 'KIOSKO') {
      const categoryIds = await ensureCategories(db, DEMO_PRODUCTS.map((p) => p.category));
      for (const p of DEMO_PRODUCTS) {
        await db.product.updateMany({ where: { barcode: p.barcode }, data: { isActive: true, categoryId: categoryIds.get(p.category) } });
      }
    } else {
      await showCatalog(db, profile);
    }
  }

  // Categorías de ejemplo que quedaron vacías
  try {
    await db.category.deleteMany({ where: { name: { in: DEMO_CATEGORY_NAMES }, products: { none: {} }, subcategories: { none: {} }, surcharge: null } });
  } catch { /* alguna quedó en uso: se deja */ }

  if (profiles.includes('IMPRENTA')) await seedImprenta(db);
  if (profiles.includes('DISTRIBUIDORA')) await seedDistribuidora(db);
  if (profiles.includes('VERDULERIA')) await seedVerduleria(db);
}

const DEMO_CATEGORY_NAMES = [...new Set([...Object.keys(CATEGORY_COLORS), ...Object.keys(DEMO_CATEGORY_COLORS)])];

async function ensureCategories(db: any, names: string[]) {
  const ids = new Map<string, string>();
  for (const name of [...new Set(names)]) {
    const cat = await db.category.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, color: CATEGORY_COLORS[name] || DEMO_CATEGORY_COLORS[name] || '#6366f1', icon: 'Package' },
    });
    ids.set(name, cat.id);
  }
  return ids;
}

/** Catálogo del rubro: lo crea la primera vez; si ya estaba (volvió a este rubro), lo prende. */
async function showCatalog(db: any, profile: Exclude<DemoProfile, 'KIOSKO'>) {
  const items = CATALOGS[profile];
  const categoryIds = await ensureCategories(db, items.map((i) => i.category));
  const groups = new Map<string, string>();
  let n = 0;
  for (const it of items) {
    n++;
    const sku = `${skuPrefix(profile)}${String(n).padStart(3, '0')}`;
    const categoryId = categoryIds.get(it.category);
    if (await db.product.findUnique({ where: { sku }, select: { id: true } })) {
      await db.product.update({ where: { sku }, data: { isActive: true, categoryId } });
      continue;
    }
    let variantGroupId: string | undefined;
    if (it.baseName) {
      if (!groups.has(it.baseName)) groups.set(it.baseName, `demo-${profile.toLowerCase()}-${groups.size + 1}`);
      variantGroupId = groups.get(it.baseName);
    }
    // El código de balanza va como código del producto (si nadie lo usa ya)
    const barcode = it.plu && !(await db.product.findUnique({ where: { barcode: String(it.plu) }, select: { id: true } })) ? String(it.plu) : null;
    await db.product.create({
      data: {
        name: it.name,
        sku,
        barcode,
        salePrice: it.price,
        costPrice: Math.round(it.price * 0.6),
        stock: it.unlimited ? 0 : it.stock ?? 20,
        minStock: it.unlimited ? 0 : Math.min(5, Math.max(1, Math.floor((it.stock ?? 20) / 4))),
        unlimitedStock: !!it.unlimited,
        unit: it.unit || 'UNIT',
        pieceSize: it.pieceSize ?? null,
        unitsPerPack: it.unitsPerPack || 1,
        packPrice: it.packPrice ?? null,
        tradePrice: it.tradePrice ?? null,
        baseName: it.baseName ?? null,
        variantGroupId: variantGroupId ?? null,
        variantAttrs: it.attrs ? JSON.stringify(it.attrs) : null,
        categoryId,
      },
    });
  }
}

const adminId = async (db: any) => (await db.user.findFirst({ where: { username: 'ADMIN' }, select: { id: true } }))?.id;

async function upsertClient(db: any, c: { name: string; phone?: string; address?: string; locality?: string; cuit?: string; ivaCondition?: string }) {
  const found = await db.client.findFirst({ where: { name: c.name } });
  return found || db.client.create({ data: c });
}

/** Imprenta: clientes y encargos en todos los estados, con seña y uno atrasado. */
async function seedImprenta(db: any) {
  if (await db.workOrder.count()) return;
  const userId = await adminId(db);
  if (!userId) return;
  const clients = {
    espiga: await upsertClient(db, { name: 'Panadería La Espiga', phone: '1155550123', address: 'Av. San Martín 1450' }),
    rios: await upsertClient(db, { name: 'Estudio Contable Ríos', phone: '1155550188', cuit: '30-71234567-8', ivaCondition: 'RESPONSABLE_INSCRIPTO' }),
    laura: await upsertClient(db, { name: 'Laura Méndez', phone: '1155550142' }),
    escuela: await upsertClient(db, { name: 'Escuela N° 12', phone: '1155550170', address: 'Belgrano 320' }),
  };
  const product = async (name: string) => db.product.findFirst({ where: { name, sku: { startsWith: skuPrefix('IMPRENTA') } } });

  const orders: Array<{
    client: any; status: string; priority: string; due: Date; deposit: number; notes?: string;
    items: Array<{ product?: string; description?: string; specs: string; quantity: number; price?: number }>;
  }> = [
    { client: clients.espiga, status: 'EN_PROCESO', priority: 'ALTA', due: daysFromNow(1, 10), deposit: 30000,
      items: [{ product: 'VOLANTES A5 X1000', specs: 'Ilustración 115 g, frente y dorso. Diseño enviado por WhatsApp.', quantity: 1 }] },
    { client: clients.rios, status: 'PENDIENTE', priority: 'MEDIA', due: daysFromNow(3, 18), deposit: 20000,
      items: [
        { product: 'TARJETAS PERSONALES X100', specs: 'Tres nombres distintos. Papel 300 g mate con laminado.', quantity: 3 },
        { product: 'SELLO AUTOMÁTICO 38X14', specs: 'Razón social y CUIT', quantity: 1 },
      ] },
    // Para hoy, unas horas después de la visita (a hora fija quedaba atrasado a la noche)
    { client: clients.laura, status: 'LISTO', priority: 'MEDIA', due: new Date(Date.now() + 3 * 3600e3), deposit: 9500,
      items: [{ product: 'TAZA SUBLIMADA', specs: 'Foto del cumpleaños y el nombre "Sofi"', quantity: 2 }] },
    { client: clients.escuela, status: 'EN_PROCESO', priority: 'ALTA', due: daysFromNow(-1, 12), deposit: 0, notes: 'Lo retira la secretaria',
      items: [{ product: 'ANILLADO HASTA 100 HOJAS', specs: 'Apuntes de 5° grado, tapa transparente', quantity: 12 }] },
    { client: clients.escuela, status: 'PENDIENTE', priority: 'BAJA', due: daysFromNow(6, 12), deposit: 0,
      items: [{ description: 'Lona para el acto', specs: 'Lona front 3 x 2 m con ojales, archivo de la escuela', quantity: 6, price: 16000 }] },
  ];

  const range = await numberRange(db);
  let number = range.from;
  for (const o of orders) {
    const items = [];
    for (const it of o.items) {
      const p = it.product ? await product(it.product) : null;
      const unitPrice = it.price ?? p?.salePrice ?? 0;
      items.push({
        productId: p?.id ?? null,
        description: p?.name ?? it.description ?? 'Trabajo',
        specs: it.specs, quantity: it.quantity, unitPrice, total: round2(unitPrice * it.quantity),
      });
    }
    const total = round2(items.reduce((s, i) => s + i.total, 0));
    const deposit = Math.min(o.deposit, total);
    await db.workOrder.create({
      data: {
        number: ++number, clientId: o.client.id, userId, status: o.status, priority: o.priority,
        receivedAt: daysFromNow(-2, 11), dueAt: o.due, notes: o.notes ?? null, total, deposit,
        readyAt: o.status === 'LISTO' ? new Date() : null,
        items: { create: items },
      },
    });
    // La seña queda a favor del cliente, como cuando se cobra en la caja (ver WorkOrdersService.collect)
    if (deposit > 0) {
      const client = await db.client.findUnique({ where: { id: o.client.id } });
      await db.accountMovement.create({
        data: {
          clientId: client.id, userId, type: 'PAYMENT', amount: deposit,
          balanceBefore: client.balance, balanceAfter: client.balance - deposit,
          description: `Seña del encargo N° ${number}`,
        },
      });
      await db.client.update({ where: { id: client.id }, data: { balance: client.balance - deposit } });
    }
  }
}

/** Distribuidora: vendedor y chofer, comercios por localidad, pedidos de preventa y un reparto armado. */
async function seedDistribuidora(db: any) {
  if (await db.preOrder.count()) return;
  const passwordHash = await bcrypt.hash('1234', 10);
  const seller = await db.user.upsert({
    where: { username: 'CARLOS' }, update: { isActive: true },
    create: { username: 'CARLOS', passwordHash, fullName: 'Carlos Gómez', role: 'CASHIER', workRole: 'VENDEDOR' },
  });
  const driver = await db.user.upsert({
    where: { username: 'DIEGO' }, update: { isActive: true },
    create: { username: 'DIEGO', passwordHash, fullName: 'Diego Ruiz', role: 'CASHIER', workRole: 'CHOFER' },
  });
  const shops = [
    await upsertClient(db, { name: 'Almacén Don José', phone: '1155550201', address: 'Mitre 845', locality: 'Quilmes' }),
    await upsertClient(db, { name: 'Kiosco El Paso', phone: '1155550202', address: 'Rivadavia 120', locality: 'Quilmes' }),
    await upsertClient(db, { name: 'Autoservicio Mari', phone: '1155550203', address: 'Zapiola 560', locality: 'Bernal' }),
    await upsertClient(db, { name: 'Despensa La Esquina', phone: '1155550204', address: 'Belgrano 77', locality: 'Bernal' }),
    await upsertClient(db, { name: 'Maxikiosco 24 hs', phone: '1155550205', address: 'Av. Las Flores 1200', locality: 'Wilde' }),
  ];
  const catalog = await db.product.findMany({ where: { sku: { startsWith: skuPrefix('DISTRIBUIDORA') } } });
  const byName = (name: string) => catalog.find((p: any) => p.name === name);

  // [comercio, [producto, bultos]] — los tres primeros salen en el reparto de mañana
  const orders: Array<[number, Array<[string, number]>]> = [
    [0, [['GASEOSA COLA 2,25L', 4], ['YERBA MATE 1KG', 2], ['FIDEOS GUISEROS 500G', 1]]],
    [1, [['ALFAJOR TRIPLE', 3], ['CHICLES X20', 1], ['AGUA MINERAL 2L', 2]]],
    [2, [['CERVEZA LATA 473ML', 2], ['ACEITE DE GIRASOL 900ML', 1], ['LAVANDINA 1L', 2]]],
    [3, [['PAPEL HIGIÉNICO X4', 1], ['CARAMELOS MASTICABLES X100', 1], ['GASEOSA COLA 2,25L', 2]]],
    [4, [['ALFAJOR TRIPLE', 2], ['JUGO EN POLVO NARANJA', 1], ['CERVEZA LATA 473ML', 1]]],
  ];

  const range = await numberRange(db);
  const lastRun = await db.deliveryRun.findFirst({ where: { runNumber: { gte: range.from, lt: range.to } }, orderBy: { runNumber: 'desc' } });
  const run = await db.deliveryRun.create({
    data: {
      runNumber: (lastRun ? lastRun.runNumber : range.from) + 1, date: daysFromNow(1, 8),
      driverName: driver.fullName, driverUserId: driver.id, vehicle: 'Kangoo AB 123 CD', status: 'ARMANDO',
    },
  });

  for (const [i, [shop, lines]] of orders.entries()) {
    const items = lines.map(([name, packs]) => {
      const p = byName(name);
      if (!p) return null;
      const size = p.unitsPerPack > 1 ? p.unitsPerPack : null;
      const quantity = packs * (size || 1);
      const unitPrice = size && p.packPrice ? round2(p.packPrice / size) : p.salePrice;
      return { productId: p.id, productName: p.name, quantity, packSize: size, unitPrice, total: round2(quantity * unitPrice) };
    }).filter(Boolean) as any[];
    const onRun = i < 3;
    await db.preOrder.create({
      data: {
        orderNumber: await nextDocNumber(db), clientId: shops[shop].id, userId: seller.id,
        deliveryDate: daysFromNow(onRun ? 1 : 2, 8), total: round2(items.reduce((s, it) => s + it.total, 0)),
        runId: onRun ? run.id : null, stopOrder: onRun ? i + 1 : null,
        items: { create: items },
      },
    });
  }
}

/**
 * Verdulería: el puestero del Mercado Central con dos compras (una pagada y otra que se le debe)
 * y la merma de la semana (lo que se tiró), para que se vean la deuda y el informe de pérdidas.
 */
async function seedVerduleria(db: any) {
  const SUPPLIER = 'Puesto 47 - Mercado Central';
  if (await db.supplier.findFirst({ where: { name: SUPPLIER }, select: { id: true } })) return;
  const userId = await adminId(db);
  if (!userId) return;
  const supplier = await db.supplier.create({ data: { name: SUPPLIER, contact: 'Rubén', phone: '1155550347' } });
  const catalog = await db.product.findMany({ where: { sku: { startsWith: skuPrefix('VERDULERIA') } } });
  const byName = (name: string) => catalog.find((p: any) => p.name === name);

  // [días atrás, estado de pago, [producto, kilos o unidades]] — el costo es el de la ficha (60 % del precio)
  const purchases: Array<[number, 'PAID' | 'OWED', Array<[string, number]>]> = [
    [3, 'PAID', [['PAPA', 50], ['CEBOLLA', 40], ['ZANAHORIA', 20], ['NARANJA DE JUGO', 36], ['BANANA', 22]]],
    [0, 'OWED', [['TOMATE REDONDO', 18], ['MANZANA ROJA', 18], ['ZAPALLO ANCO', 20], ['LECHUGA', 24], ['HUEVOS (MAPLE X30)', 10]]],
  ];
  for (const [ago, paymentStatus, lines] of purchases) {
    const items = lines.map(([name, qty]) => {
      const p = byName(name);
      return p ? { productId: p.id, productName: p.name, quantity: qty, cost: p.costPrice, total: round2(p.costPrice * qty), buyFormat: 'UNIT' } : null;
    }).filter(Boolean) as any[];
    if (!items.length) continue;
    await db.purchase.create({
      data: {
        supplierId: supplier.id, userId, total: round2(items.reduce((s, i) => s + i.total, 0)), paymentStatus,
        paymentMethod: paymentStatus === 'PAID' ? 'CASH' : null, notes: paymentStatus === 'OWED' ? 'Se paga el sábado' : null,
        createdAt: daysFromNow(-ago, 6), items: { create: items },
      },
    });
  }

  // Merma: lo golpeado o pasado que se tiró, como un egreso de Control de stock
  const losses: Array<[string, number, number]> = [['TOMATE REDONDO', 2.5, 1], ['LECHUGA', 3, 2], ['BANANA', 1.8, 4], ['FRUTILLA', 0.5, 5]];
  for (const [name, qty, ago] of losses) {
    const p = byName(name);
    if (!p) continue;
    const stockAfter = round2(Math.max(0, p.stock - qty));
    await db.inventoryMovement.create({
      data: { productId: p.id, userId, type: 'EXIT', quantity: qty, stockBefore: p.stock, stockAfter, reason: 'Rotura / Merma', createdAt: daysFromNow(-ago, 19) },
    });
    await db.product.update({ where: { id: p.id }, data: { stock: stockAfter } });
  }
}
