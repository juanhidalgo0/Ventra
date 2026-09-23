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

export interface StoreConfig {
  storeId: string;
  businessName: string;
  rubro: string; // KIOSKO | FERRETERIA | INDUMENTARIA | OTRO
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
  minOrder?: number;
  paymentMethods?: string[];
  transferAlias?: string;
  showOutOfStock?: boolean;
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

export async function saveStoreConfig(storeId: string, config: Partial<StoreConfig>): Promise<void> {
  await claimStore(storeId);
  const { ownerUid: _o, claimed: _c, storeId: _s, ...editable } = config as any;
  await updateDoc(doc(getDb(), 'ventra_stores', storeId), { ...editable, updatedAt: serverTimestamp() });
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
  brand?: string;
  unit?: string;
  inStock: boolean;
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
}

export interface StoreOrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

export interface StoreOrder {
  id: string;
  items: StoreOrderItem[];
  total: number;
  customerName: string;
  customerPhone: string;
  customerNote?: string;
  /** Código corto que ve el cliente en WhatsApp (ej. "K7P2") */
  orderCode?: string;
  delivery?: 'PICKUP' | 'DELIVERY' | 'GODELIVERY';
  address?: string;
  paymentMethod?: string;
  deliveryCost?: number;
  status: 'PENDING' | 'SYNCED';
  syncedLocal?: boolean;
  createdAt?: any;
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
export async function publishOnlineCatalog(storeId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const { default: api } = await import('./api');
  const { data } = await api.get('/products', { params: { take: 5000 } });
  const all = (data?.products || data || []) as any[];
  let online = all.filter((p) => p.showOnline);
  // Igual que "Sincronizar" en la PC: si todavía no se marcó ninguno, se publica todo el inventario
  if (online.length === 0 && all.length > 0) {
    await api.post('/products/bulk-set-show-online', { showOnline: true });
    online = all;
  }
  const images = await publishProductImages(storeId, online, onProgress);
  await syncCatalogToStore(storeId, online.map((p) => ({
    productId: p.id,
    name: p.name,
    description: p.description || '',
    price: p.salePrice,
    imageUrl: images.get(p.id) || '',
    category: p.category?.name || 'Varios',
    brand: p.brand?.name || '',
    unit: p.unit || 'UNIT',
    inStock: p.unlimitedStock || p.stock > 0,
  })));
  return online.length;
}
