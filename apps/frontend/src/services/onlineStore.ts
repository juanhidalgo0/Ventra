import { initializeApp, getApps } from 'firebase/app';
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

// Reusa el mismo proyecto Firebase (público, client-safe) ya utilizado para las
// notificaciones de actualización del desktop (ver updatePush.ts) — pero con
// colecciones 100% propias de Ventra ("ventra_stores"), sin ningún vínculo con
// las colecciones de GoDelivery ("comercios"/"orders").
const firebaseConfig = {
  apiKey: 'AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA',
  authDomain: 'godelivery-magdalena.firebaseapp.com',
  projectId: 'godelivery-magdalena',
  storageBucket: 'godelivery-magdalena.firebasestorage.app',
  messagingSenderId: '848164656125',
  appId: '1:848164656125:web:eef2314205f5d8f887ff94',
};

function getDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
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
  const db = getDb();
  const ref = doc(db, 'ventra_stores', storeId);
  const snap = await getDoc(ref);
  const payload = { ...config, updatedAt: serverTimestamp() };
  if (snap.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, { ...DEFAULT_CONFIG, ...payload, createdAt: serverTimestamp() });
  }
}

// Verifica si un subdominio está disponible (o pertenece a esta misma tienda).
export async function isSubdomainAvailable(subdomain: string, storeId: string): Promise<boolean> {
  if (!subdomain) return false;
  const db = getDb();
  const q = query(collection(db, 'ventra_stores'), where('subdomain', '==', subdomain), limit(1));
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
  const db = getDb();
  const q = query(collection(db, 'ventra_stores', storeId, 'orders'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const orders = snap.docs.map(d => ({ id: d.id, ...d.data() })) as StoreOrder[];
      onChange(orders);
    },
    (err) => console.warn('[OnlineStore] Error escuchando pedidos:', err.message)
  );
}

export async function markOrderSyncedLocally(storeId: string, orderId: string): Promise<void> {
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
