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
} from 'firebase/firestore';
import { getVentraDb, ensureVentraSession } from './ventraFirebase';

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

export const STORE_ID_KEY = 'ventra_store_id';

// Cada terminal/instalación de Ventra tiene su propia tienda online, identificada
// por un ID local generado una sola vez y persistido en localStorage.
export function getOrCreateStoreId(): string {
  let id = localStorage.getItem(STORE_ID_KEY);
  if (!id) {
    id = `store_${crypto.randomUUID().replace(/-/g, '')}`;
    localStorage.setItem(STORE_ID_KEY, id);
  }
  return id;
}

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
