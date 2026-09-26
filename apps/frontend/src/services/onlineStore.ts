import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  orderBy,
  runTransaction,
  deleteField,
  Timestamp,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getVentraDb, getVentraStorage, ensureVentraSession, STORE_ID_KEY } from './ventraFirebase';
import { resolveServerUrl } from './api';

// Proyecto Firebase propio de Ventra (ver ventraFirebase.ts).
const getDb = getVentraDb;

export class StoreOwnedElsewhereError extends Error {
  constructor() {
    super('Esta tienda online está vinculada a otra instalación de Ventra.');
  }
}

/**
 * Se asegura de que esta instalación sea la dueña de su tienda: si la tienda no
 * existe la crea, y si viene de la migración (sin dueño) la reclama. Las reglas
 * de Firestore solo dejan escribir a la sesión dueña.
 */
export async function claimStore(storeId: string): Promise<void> {
  const user = await ensureVentraSession();
  const db = getDb();
  const ref = doc(db, 'ventra_stores', storeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...DEFAULT_CONFIG, ownerUid: user.uid, claimed: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return;
  }
  const owner = snap.data().ownerUid;
  if (!owner) {
    await updateDoc(ref, { ownerUid: user.uid, claimed: true, updatedAt: serverTimestamp() });
  } else if (owner !== user.uid) {
    throw new StoreOwnedElsewhereError();
  }
}

export { STORE_ID_KEY };

/**
 * Id de la tienda online del comercio. Primero se abre la sesión (que, con la PC
 * vinculada, trae la tienda de la cuenta); si todavía no existe ninguna, se crea
 * un id nuevo y la tienda nace a nombre de esa sesión.
 */
export async function resolveStoreId(): Promise<string> {
  await ensureVentraSession();
  let id = localStorage.getItem(STORE_ID_KEY);
  if (!id) {
    id = `store_${crypto.randomUUID().replace(/-/g, '')}`;
    localStorage.setItem(STORE_ID_KEY, id);
  }
  return id;
}

/**
 * Horario de un día (índice 0 = domingo). Puede tener varios turnos, por ejemplo
 * 9 a 13 y 17 a 21 ("cortado"). from/to repiten el primer turno para las tiendas
 * publicadas con la versión anterior, que solo conocen un horario.
 */
export interface TimeRange { from: string; to: string }
export interface DayHours { open: boolean; from: string; to: string; ranges?: TimeRange[] }

export const dayRanges = (h?: DayHours): TimeRange[] =>
  !h ? [] : h.ranges && h.ranges.length ? h.ranges : [{ from: h.from, to: h.to }];

export const withRanges = (h: DayHours, ranges: TimeRange[]): DayHours => ({
  ...h,
  ranges,
  from: ranges[0]?.from ?? h.from,
  to: ranges[0]?.to ?? h.to,
});

export const PAYMENT_OPTIONS = ['Efectivo', 'Transferencia', 'Mercado Pago', 'Tarjeta de débito', 'Tarjeta de crédito'];

export const ORDER_CHANNELS: { id: 'BOTH' | 'APP' | 'WHATSAPP'; title: string; text: string }[] = [
  { id: 'BOTH', title: 'App y WhatsApp', text: 'El pedido te llega a la app y el cliente además te lo manda por WhatsApp.' },
  { id: 'APP', title: 'Solo la app', text: 'Te llega a la app con aviso al celular. El cliente no tiene que pasar por WhatsApp.' },
  { id: 'WHATSAPP', title: 'Solo WhatsApp', text: 'El cliente te lo manda por WhatsApp. No queda guardado en la app.' },
];


export interface StoreConfig {
  storeId: string;
  businessName: string;
  rubro: string; // KIOSKO | FERRETERIA | INDUMENTARIA | GASTRONOMIA | OTRO
  subdomain: string;
  whatsappNumber: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  bannerUrl?: string;
  address?: string;
  instagram?: string;
  isPublished: boolean;
  /** Frase corta bajo el nombre ("Todo para tu casa, envíos en el día") */
  description?: string;
  /** Aviso destacado arriba de la tienda ("Envío gratis desde $30.000") */
  announcement?: string;
  hours?: DayHours[];
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  /** Envío con GoDelivery: empresa independiente, el cliente le paga el envío a ella (no se informan precios). */
  goDeliveryEnabled?: boolean;
  deliveryCost?: number;
  /** Desde este monto el envío es gratis (0 = nunca) */
  freeDeliveryFrom?: number;
  /** Zona de entrega, texto libre ("Centro y barrios cercanos") */
  deliveryZone?: string;
  /** Tiempo estimado que ve el cliente ("30-45 min") */
  deliveryEta?: string;
  pickupEta?: string;
  minOrder?: number;
  paymentMethods?: string[];
  transferAlias?: string;
  showOutOfStock?: boolean;
  /** Todos los productos se venden como disponibles, aunque figuren sin stock (apagado por defecto) */
  alwaysInStock?: boolean;
  /**
   * Cómo llegan los pedidos: BOTH = a la app y además el cliente lo manda por WhatsApp (lo de siempre),
   * APP = solo a la app (aviso al celular, sin pasar por WhatsApp), WHATSAPP = solo por WhatsApp (no queda en la app).
   */
  orderChannel?: 'BOTH' | 'APP' | 'WHATSAPP';
  /** Extras con precio (borde relleno, agregados) que el cliente elige en la ficha del producto */
  extraGroups?: ExtraGroup[];
  /** Productos pausados ("hoy no hay"): se ven como no disponibles sin volver a publicar */
  pausedIds?: string[];
  /** Promos por cantidad publicadas desde Promociones (ej. docena de empanadas de cualquier gusto) */
  onlinePromos?: OnlinePromo[];
  /** Cuántas partes tiene el catálogo agrupado publicado (catalog/p0, p1...) */
  catalogParts?: number;
  ownerUid?: string;
  claimed?: boolean;
  updatedAt?: any;
  createdAt?: any;
}

const DEFAULT_CONFIG: Omit<StoreConfig, 'storeId'> = {
  businessName: 'Mi Tienda',
  rubro: 'KIOSKO',
  subdomain: '',
  whatsappNumber: '',
  // Mismo naranja "Mango" que ya es la identidad de marca de todo el POS
  // (ver tailwind.config.js) — así una tienda nueva arranca coherente con la
  // app en vez de heredar un rojo genérico sin relación con Ventra.
  primaryColor: '#0E6E52',
  secondaryColor: '#1e293b',
  logoUrl: '',
  bannerUrl: '',
  address: '',
  instagram: '',
  isPublished: false,
  description: '',
  announcement: '',
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d !== 0, from: '09:00', to: '20:00' })),
  pickupEnabled: true,
  deliveryEnabled: false,
  goDeliveryEnabled: false,
  deliveryCost: 0,
  freeDeliveryFrom: 0,
  deliveryZone: '',
  minOrder: 0,
  paymentMethods: ['Efectivo', 'Transferencia'],
  transferAlias: '',
  showOutOfStock: true,
};

export async function loadStoreConfig(storeId: string): Promise<StoreConfig> {
  const db = getDb();
  const ref = doc(db, 'ventra_stores', storeId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { storeId, ...DEFAULT_CONFIG, ...snap.data() } as StoreConfig;
  }
  return { storeId, ...DEFAULT_CONFIG };
}

/**
 * Logo y portada se suben a Storage: embebidos (base64) agrandaban el documento de la
 * tienda, que se lee en cada visita. Si la subida falla, quedan embebidos como antes.
 */
async function uploadInlineImage(storeId: string, name: string, src: string): Promise<string> {
  if (!src.startsWith('data:')) return src;
  try {
    const key = await fingerprint(src.length > 4000 ? src.slice(0, 2000) + src.length + src.slice(-2000) : src);
    const blob = await (await fetch(src)).blob();
    const ref = storageRef(getVentraStorage(), `ventra_stores/${storeId}/${name}_${key}.jpg`);
    await uploadBytes(ref, blob, { contentType: blob.type || 'image/jpeg', cacheControl: 'public,max-age=31536000,immutable' });
    return await getDownloadURL(ref);
  } catch (err) {
    console.warn('[OnlineStore] No se pudo subir la imagen de la tienda', name, err);
    return src;
  }
}

export async function saveStoreConfig(storeId: string, config: Partial<StoreConfig>): Promise<void> {
  await claimStore(storeId);
  // El catálogo agrupado (catalogParts) y las fechas los escribe solo la publicación: nunca se mandan desde acá
  const { ownerUid: _o, claimed: _c, storeId: _s, catalogParts: _p, catalogAt: _a, createdAt: _ca, updatedAt: _u, ...editable } = config as any;
  for (const field of ['logoUrl', 'bannerUrl'] as const) {
    if (typeof editable[field] === 'string') editable[field] = await uploadInlineImage(storeId, field, editable[field]);
  }
  await updateDoc(doc(getDb(), 'ventra_stores', storeId), { ...editable, updatedAt: serverTimestamp() });
  if (config.rubro === 'GASTRONOMIA') {
    import('../stores/businessStore').then(({ useBusinessStore }) => {
      const b = useBusinessStore.getState();
      if (b.profile === 'KIOSKO') b.setProfile('GASTRONOMIA');
    }).catch(() => {});
  }
  // Avisa a la barra lateral y a la caja si la tienda quedó publicada o no
  if (typeof config.isPublished === 'boolean') {
    import('./onlineStoreOrders').then((m) => m.setStorePublished(!!config.isPublished)).catch(() => {});
  }
}

// Verifica si un subdominio está disponible (o pertenece a esta misma tienda).
export async function isSubdomainAvailable(subdomain: string, storeId: string): Promise<boolean> {
  if (!subdomain) return false;
  const db = getDb();
  // Solo las tiendas ya reclamadas son visibles (ver reglas de Firestore)
  const q = query(collection(db, 'ventra_stores'), where('claimed', '==', true), where('subdomain', '==', subdomain), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return true;
  return snap.docs[0].id === storeId;
}

export interface OnlineProduct {
  productId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  category?: string;
  /** Categoría principal cuando category es una subcategoría (Bebidas > Cerveza) */
  parentCategory?: string;
  brand?: string;
  unit?: string;
  inStock: boolean;
  /** Opciones de un mismo producto (tamaño, talle): la tienda las muestra juntas en una ficha */
  variantGroupId?: string;
  baseName?: string;
  /** "GRANDE", "M · NEGRO" */
  variantLabel?: string;
}

/** Grupo de extras: min 0 = opcional, 1 = obligatorio; max = cuántas opciones puede elegir. Se ofrece en categorías o productos. */
export interface ExtraGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; price: number }[];
  categories: string[];
  productIds: string[];
  /** Productos de esas categorías que no lo llevan (ej. las pizzas rellenas no llevan borde relleno) */
  excludeIds?: string[];
  active?: boolean;
}

/** Combo "N unidades de estos productos (mezclados) a precio fijo", para aplicar en la tienda. */
export interface OnlinePromo { id: string; name: string; qty: number; price: number; productIds: string[] }

/** Un producto del sistema tal como se publica en la tienda. */
export function toOnlineProduct(p: any, imageUrl = ''): OnlineProduct {
  let attrs: Record<string, string> = {};
  try { attrs = p.variantAttrs ? (typeof p.variantAttrs === 'string' ? JSON.parse(p.variantAttrs) : p.variantAttrs) : {}; } catch { /* sin opciones */ }
  const variantLabel = Object.values(attrs || {}).map((v) => String(v || '').trim()).filter(Boolean).join(' · ');
  return {
    productId: p.id,
    name: p.name,
    description: p.description || '',
    price: p.salePrice,
    imageUrl,
    category: p.category?.name || 'Varios',
    parentCategory: p.category?.parentCategory?.name || '',
    brand: p.brand?.name || '',
    unit: p.unit || 'UNIT',
    inStock: !!p.unlimitedStock || p.stock > 0,
    ...(p.variantGroupId ? { variantGroupId: p.variantGroupId, baseName: p.baseName || p.name, variantLabel } : {}),
  };
}

/**
 * Publica en la tienda las promos por cantidad de Promociones: combos de un solo grupo
 * ("12 empanadas de cualquier gusto a $12.000"). Los combos de varios productos distintos
 * (pizza + gaseosa) por ahora solo se aplican en la caja.
 */
export async function publishOnlinePromos(storeId: string, onlineIds: Set<string>): Promise<number> {
  const { default: api } = await import('./api');
  // Si no se pudieron leer las promociones, se deja la tienda como estaba (nunca se borran por un error)
  const { data } = await api.get('/promotions');
  if (!Array.isArray(data)) throw new Error('Respuesta inválida de promociones');
  const now = Date.now();
  const promos: OnlinePromo[] = [];
  for (const pr of (data || []) as any[]) {
    if (!pr.isActive || pr.type !== 'FIXED_COMBO' || !(pr.fixedPrice > 0)) continue;
    if (pr.endDate && new Date(pr.endDate).getTime() < now) continue;
    if (pr.startDate && new Date(pr.startDate).getTime() > now) continue;
    const items = (pr.products || []) as any[];
    const groups = new Set(items.map((x) => x.groupId || `single_${x.productId}`));
    if (groups.size !== 1 || !items.length) continue;
    const qty = Math.max(1, Number(items[0].quantity) || 1);
    // Un combo de un solo producto sin cantidad no es una promo por cantidad
    if (qty < 2) continue;
    const productIds = items.map((x) => String(x.productId)).filter((id) => onlineIds.has(id));
    if (!productIds.length) continue;
    promos.push({ id: pr.id, name: pr.name, qty, price: Number(pr.fixedPrice), productIds });
  }
  await claimStore(storeId);
  await updateDoc(doc(getDb(), 'ventra_stores', storeId), { onlinePromos: promos, updatedAt: serverTimestamp() });
  return promos.length;
}

/**
 * Las fotos del POS viven en la PC (base64 en la base o enlaces /api/... del backend
 * local): desde internet no se pueden ver. Antes de publicar, cada foto se achica
 * y se sube a Firebase Storage; la tienda usa ese enlace público.
 * Se recuerda qué se subió (por huella de la foto) para no volver a subir lo mismo.
 */
const imageCacheKey = (storeId: string) => `ventra_store_images_${storeId}`;

async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function shrinkToJpeg(blob: Blob, maxSide = 700, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); return reject(new Error('Sin canvas')); }
      // Fondo blanco: las fotos con transparencia (PNG) no quedan negras en JPEG
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('No se pudo convertir la foto'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto inválida')); };
    img.src = url;
  });
}

export async function publishProductImages(
  storeId: string,
  products: { id: string; imageUrl?: string | null }[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> {
  await claimStore(storeId);
  let cache: Record<string, { key: string; url: string }> = {};
  try { cache = JSON.parse(localStorage.getItem(imageCacheKey(storeId)) || '{}'); } catch { /* caché vacía */ }

  const result = new Map<string, string>();
  const pending: { id: string; src: string }[] = [];
  for (const p of products) {
    const src = p.imageUrl || '';
    if (!src) continue;
    // Fotos que ya están en internet (enlaces https de terceros) se usan tal cual
    if (/^https?:\/\//.test(src) && !src.includes('/api/')) { result.set(p.id, src); continue; }
    pending.push({ id: p.id, src });
  }

  let done = 0;
  onProgress?.(0, pending.length);
  const storage = getVentraStorage();
  const queue = [...pending];
  const worker = async () => {
    while (queue.length) {
      const { id, src } = queue.shift()!;
      try {
        const key = await fingerprint(src.length > 4000 ? src.slice(0, 2000) + src.length + src.slice(-2000) : src);
        if (cache[id]?.key === key) {
          result.set(id, cache[id].url);
        } else {
          const res = await fetch(src.startsWith('data:') ? src : resolveServerUrl(src) || src);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const jpeg = await shrinkToJpeg(await res.blob());
          const ref = storageRef(storage, `ventra_stores/${storeId}/products/${id}_${key}.jpg`);
          await uploadBytes(ref, jpeg, { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000,immutable' });
          const url = await getDownloadURL(ref);
          cache[id] = { key, url };
          result.set(id, url);
        }
      } catch (err) {
        console.warn('[OnlineStore] No se pudo publicar la foto de', id, err);
      }
      done++;
      onProgress?.(done, pending.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  try { localStorage.setItem(imageCacheKey(storeId), JSON.stringify(cache)); } catch { /* sin espacio: se resube la próxima */ }
  return result;
}

// Sube (o reemplaza) el catálogo completo visible en la tienda online. Se usa
// batch writes para mantenerlo rápido incluso con cientos de productos.
export async function syncCatalogToStore(storeId: string, products: OnlineProduct[]): Promise<void> {
  await claimStore(storeId);
  const db = getDb();
  const productsRef = collection(db, 'ventra_stores', storeId, 'products');

  // Limpiar productos que ya no deben mostrarse
  const existingSnap = await getDocs(productsRef);
  const incomingIds = new Set(products.map(p => p.productId));
  const toDelete = existingSnap.docs.filter(d => !incomingIds.has(d.id));

  const chunks: any[][] = [];
  const allOps = [
    ...products.map(p => ({ type: 'set' as const, id: p.productId, data: p })),
    ...toDelete.map(d => ({ type: 'delete' as const, id: d.id })),
  ];
  for (let i = 0; i < allOps.length; i += 400) {
    chunks.push(allOps.slice(i, i + 400));
  }

  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(productsRef, op.id);
      if (op.type === 'set') {
        batch.set(ref, { ...op.data, updatedAt: serverTimestamp() });
      } else {
        batch.delete(ref);
      }
    }
    await batch.commit();
  }
  await publishCatalogParts(storeId, products);
}

/**
 * La tienda lee el catálogo de unos pocos documentos grandes (catalog/p0, p1...) en vez
 * de un documento por producto: una visita pasa de cientos de lecturas a 1-3.
 * Las partes y el aviso en la tienda (catalogParts) se escriben juntos, así nunca se
 * lee una mezcla de catálogo viejo y nuevo. Si no se puede, la tienda vuelve a leer
 * los productos sueltos (que se siguen publicando igual).
 */
const CATALOG_PART_BYTES = 600_000;

async function publishCatalogParts(storeId: string, products: OnlineProduct[]): Promise<void> {
  const db = getDb();
  const storeRef = doc(db, 'ventra_stores', storeId);
  const parts: OnlineProduct[][] = [];
  let current: OnlineProduct[] = [];
  let size = 0;
  for (const p of products) {
    const bytes = JSON.stringify(p).length + 50;
    if (current.length && size + bytes > CATALOG_PART_BYTES) { parts.push(current); current = []; size = 0; }
    current.push(p);
    size += bytes;
  }
  if (current.length || !parts.length) parts.push(current);

  try {
    const before = Number((await getDoc(storeRef)).data()?.catalogParts) || 0;
    const batch = writeBatch(db);
    parts.forEach((items, i) => batch.set(doc(storeRef, 'catalog', `p${i}`), { items }));
    for (let i = parts.length; i < before; i++) batch.delete(doc(storeRef, 'catalog', `p${i}`));
    batch.update(storeRef, { catalogParts: parts.length, catalogAt: serverTimestamp() });
    await batch.commit();
  } catch (err) {
    console.warn('[OnlineStore] No se pudo publicar el catálogo agrupado; la tienda lee los productos sueltos', err);
    await updateDoc(storeRef, { catalogParts: deleteField() }).catch(() => {});
  }
}

export interface StoreOrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  /** Aclaración del cliente ("sin aceitunas") */
  note?: string;
}

export type OrderStage = 'NEW' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';

export interface StoreOrder {
  id: string;
  items: StoreOrderItem[];
  total: number;
  customerName: string;
  customerPhone: string;
  customerNote?: string;
  /** Código corto que ve el cliente en WhatsApp (ej. "K7P2") */
  orderCode?: string;
  delivery?: 'PICKUP' | 'DELIVERY' | 'GODELIVERY' | 'TABLE';
  address?: string;
  paymentMethod?: string;
  deliveryCost?: number;
  /** Descuento de promos por cantidad (docena de empanadas) */
  discount?: number;
  status: 'PENDING' | 'SYNCED';
  /** Seguimiento del pedido en el local (sin valor = recién llegado) */
  stage?: OrderStage;
  stageAt?: any;
  syncedLocal?: boolean;
  createdAt?: any;
}

/** Pedidos de la tienda entre dos fechas (más nuevos primero), para las métricas. */
export async function fetchStoreOrders(storeId: string, from: Date, to: Date): Promise<StoreOrder[]> {
  await claimStore(storeId);
  const q = query(
    collection(getDb(), 'ventra_stores', storeId, 'orders'),
    where('createdAt', '>=', Timestamp.fromDate(from)),
    where('createdAt', '<', Timestamp.fromDate(to)),
    orderBy('createdAt', 'desc'),
    limit(3000),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as StoreOrder);
}

/** Costo actual de cada producto (id → costo), sin traer el resto de los datos. */
export async function fetchProductCosts(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const { default: api } = await import('./api');
  const { data } = await api.post('/products/costs', { ids });
  return data || {};
}

// Escucha en tiempo real los pedidos de la tienda, más nuevos primero.
export function subscribeToStoreOrders(storeId: string, onChange: (orders: StoreOrder[]) => void): () => void {
  // Leer pedidos requiere ser el dueño: primero la sesión/reclamo, después el listener.
  let unsub: (() => void) | null = null;
  let cancelled = false;
  claimStore(storeId)
    .then(() => {
      if (cancelled) return;
      const q = query(collection(getDb(), 'ventra_stores', storeId, 'orders'), orderBy('createdAt', 'desc'), limit(50));
      unsub = onSnapshot(
        q,
        (snap) => {
          const orders = snap.docs.map(d => ({ id: d.id, ...d.data() })) as StoreOrder[];
          onChange(orders);
        },
        (err) => console.warn('[OnlineStore] Error escuchando pedidos:', err.message)
      );
    })
    .catch((err) => console.warn('[OnlineStore] No se pudo acceder a la tienda:', err.message));
  return () => {
    cancelled = true;
    unsub?.();
  };
}

/**
 * Toma un pedido para pasarlo a presupuesto. Como la tienda es de la cuenta, varios
 * equipos pueden estar escuchando: la transacción asegura que lo tome uno solo.
 * Devuelve false si otro equipo ya lo tomó.
 */
export async function claimOrder(storeId: string, orderId: string): Promise<boolean> {
  await ensureVentraSession();
  const ref = doc(getDb(), 'ventra_stores', storeId, 'orders', orderId);
  return runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().syncedLocal) return false;
    tx.update(ref, { syncedLocal: true, syncedLocalAt: serverTimestamp() });
    return true;
  });
}

/** Si no se pudo crear el presupuesto, el pedido vuelve a quedar pendiente. */
export async function releaseOrder(storeId: string, orderId: string): Promise<void> {
  await updateDoc(doc(getDb(), 'ventra_stores', storeId, 'orders', orderId), { syncedLocal: false });
}

export async function markOrderSyncedLocally(storeId: string, orderId: string): Promise<void> {
  await ensureVentraSession();
  const db = getDb();
  await updateDoc(doc(db, 'ventra_stores', storeId, 'orders', orderId), {
    syncedLocal: true,
    syncedLocalAt: serverTimestamp(),
  });
}

// Comprime una imagen a un data URL liviano (JPEG), manteniendo proporción.
export function compressImageFile(file: File, maxWidth: number, maxHeight: number, quality = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo generar el canvas'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Publica en la tienda los productos marcados "mostrar en la tienda" (con sus
 * fotos subidas a la nube). Es lo mismo que "Sincronizar" en la PC, usado desde el celular.
 */
/** Todos los productos del POS, en tandas (con miles de productos un solo pedido quedaba corto). */
export async function fetchAllProducts(): Promise<any[]> {
  const { default: api } = await import('./api');
  const PAGE = 2000;
  const all: any[] = [];
  const seen = new Set<string>();
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await api.get('/products', { params: { skip, take: PAGE } });
    const page = (data?.products || data || []) as any[];
    for (const p of page) if (!seen.has(p.id)) { seen.add(p.id); all.push(p); }
    if (page.length < PAGE) break;
  }
  return all;
}

/** Los productos de la tienda como se publicarían, sin fotos (solo si tienen): liviano para el celular. */
export async function fetchOnlineSummary(): Promise<OnlineProduct[]> {
  const { default: api } = await import('./api');
  const { data } = await api.get('/products/online-summary');
  return ((data || []) as any[]).map((p) => toOnlineProduct(p, p.hasImage ? 'x' : ''));
}

/**
 * Cuántos productos tienen cambios sin publicar (marcados, quitados o con precio/stock/foto distintos).
 * -1: hay productos pero la tienda todavía no tiene el catálogo agrupado (no se sabe cuántos).
 */
export async function countPendingCatalog(storeId: string, config: StoreConfig): Promise<number> {
  const [local, published] = await Promise.all([fetchOnlineSummary(), loadPublishedCatalog(storeId, config.catalogParts)]);
  const d = diffCatalog(local, published, !!config.alwaysInStock || config.rubro === 'GASTRONOMIA');
  if (d.unknown) return local.length ? -1 : 0;
  return d.added.size + d.removed.size + d.changed.size;
}

/** Lo que hoy ve el público. null si la tienda todavía no publicó el catálogo agrupado. */
export async function loadPublishedCatalog(storeId: string, parts?: number): Promise<OnlineProduct[] | null> {
  if (!parts) return null;
  const snaps = await Promise.all(Array.from({ length: parts }, (_, i) => getDoc(doc(getDb(), 'ventra_stores', storeId, 'catalog', `p${i}`))));
  if (snaps.some((s) => !s.exists())) return null;
  return snaps.flatMap((s) => ((s.data() as any).items || []) as OnlineProduct[]);
}

export type CatalogDiff = { added: Set<string>; removed: Set<string>; changed: Set<string>; unknown: boolean };

/**
 * Qué cambió en los productos respecto de lo publicado: marcados nuevos, quitados y con
 * precio, nombre, categoría, foto o stock distintos. Las fotos se comparan por "tiene o no"
 * (la publicada es un enlace de la nube y la local una foto embebida).
 */
export function diffCatalog(local: OnlineProduct[], published: OnlineProduct[] | null, ignoreStock: boolean): CatalogDiff {
  const diff: CatalogDiff = { added: new Set(), removed: new Set(), changed: new Set(), unknown: published === null };
  if (published === null) {
    local.forEach((p) => diff.added.add(p.productId));
    return diff;
  }
  const sig = (p: OnlineProduct) => [p.name, Number(p.price) || 0, p.category || '', p.parentCategory || '', p.brand || '', p.unit || '',
    p.description || '', ignoreStock ? '' : !!p.inStock, !!p.imageUrl, p.variantGroupId || '', p.variantLabel || ''].join('|');
  const pub = new Map(published.map((p) => [p.productId, sig(p)]));
  const localIds = new Set<string>();
  for (const p of local) {
    localIds.add(p.productId);
    const before = pub.get(p.productId);
    if (before === undefined) diff.added.add(p.productId);
    else if (before !== sig(p)) diff.changed.add(p.productId);
  }
  published.forEach((p) => { if (!localIds.has(p.productId)) diff.removed.add(p.productId); });
  return diff;
}

export async function publishOnlineCatalog(storeId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const all = await fetchAllProducts();
  let online = all.filter((p) => p.showOnline);
  // Igual que "Sincronizar" en la PC: si todavía no se marcó ninguno, se publica todo el inventario
  if (online.length === 0 && all.length > 0) {
    const { default: api } = await import('./api');
    await api.post('/products/bulk-set-show-online', { showOnline: true });
    online = all;
  }
  const images = await publishProductImages(storeId, online, onProgress);
  await syncCatalogToStore(storeId, online.map((p) => toOnlineProduct(p, images.get(p.id) || '')));
  await publishOnlinePromos(storeId, new Set(online.map((p) => String(p.id)))).catch((e) => console.warn('[OnlineStore] Promos sin publicar', e));
  return online.length;
}

/** Cambia el estado de un pedido (Nuevo → Preparando → Listo → Entregado, o Cancelado). */
export async function updateOrderStage(storeId: string, orderId: string, stage: OrderStage): Promise<void> {
  await ensureVentraSession();
  await updateDoc(doc(getDb(), 'ventra_stores', storeId, 'orders', orderId), { stage, stageAt: serverTimestamp() });
}
