// SOLO DESARROLLO (grabación de videos): reemplaza a services/onlineStore en /reel-tienda.html
// (ver vite.reel.config.ts). Mismas funciones y tipos, con la tienda guardada en memoria en
// vez de Firebase. window.__reelStore permite a la grabación mandar pedidos "en vivo".

export const STORE_ID_KEY = 'ventra_store_id';
export class StoreOwnedElsewhereError extends Error {}

export interface TimeRange { from: string; to: string }
export interface DayHours { open: boolean; from: string; to: string; ranges?: TimeRange[] }
export const dayRanges = (h?: DayHours): TimeRange[] =>
  !h ? [] : h.ranges && h.ranges.length ? h.ranges : [{ from: h.from, to: h.to }];
export const withRanges = (h: DayHours, ranges: TimeRange[]): DayHours => ({ ...h, ranges, from: ranges[0]?.from ?? h.from, to: ranges[0]?.to ?? h.to });
export const PAYMENT_OPTIONS = ['Efectivo', 'Transferencia', 'Mercado Pago', 'Tarjeta de débito', 'Tarjeta de crédito'];

export interface StoreConfig {
  storeId: string; businessName: string; rubro: string; subdomain: string; whatsappNumber: string;
  primaryColor: string; secondaryColor: string; logoUrl?: string; bannerUrl?: string; address?: string;
  instagram?: string; isPublished: boolean; description?: string; announcement?: string; hours?: DayHours[];
  pickupEnabled?: boolean; deliveryEnabled?: boolean; goDeliveryEnabled?: boolean; deliveryCost?: number;
  freeDeliveryFrom?: number; deliveryZone?: string; minOrder?: number; paymentMethods?: string[];
  transferAlias?: string; showOutOfStock?: boolean; alwaysInStock?: boolean; ownerUid?: string; claimed?: boolean;
  updatedAt?: any; createdAt?: any;
}
export interface OnlineProduct { productId: string; name: string; description?: string; price: number; imageUrl?: string; category?: string; brand?: string; unit?: string; inStock: boolean }
export interface StoreOrderItem { productId: string; name: string; price: number; qty: number }
export type OrderStage = 'NEW' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';
export interface StoreOrder {
  id: string; items: StoreOrderItem[]; total: number; customerName: string; customerPhone: string; customerNote?: string;
  orderCode?: string; delivery?: 'PICKUP' | 'DELIVERY' | 'GODELIVERY'; address?: string; paymentMethod?: string;
  deliveryCost?: number; status: 'PENDING' | 'SYNCED'; stage?: OrderStage; stageAt?: any; syncedLocal?: boolean; createdAt?: any;
}

const STORE_ID = 'mia-store';
let config: StoreConfig = {
  storeId: STORE_ID, businessName: 'Mi Tienda', rubro: 'INDUMENTARIA', subdomain: '', whatsappNumber: '',
  primaryColor: '#0E6E52', secondaryColor: '#1e293b', logoUrl: '', bannerUrl: '', address: '', instagram: '',
  isPublished: false, description: '', announcement: '',
  hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d !== 0, from: '10:00', to: '20:00' })),
  pickupEnabled: true, deliveryEnabled: true, goDeliveryEnabled: false, deliveryCost: 2500, freeDeliveryFrom: 60000,
  deliveryZone: '', minOrder: 0, paymentMethods: ['Efectivo', 'Transferencia', 'Mercado Pago'], transferAlias: '', showOutOfStock: true,
};
let orders: StoreOrder[] = [];
const listeners = new Set<(o: StoreOrder[]) => void>();
const emit = () => listeners.forEach((fn) => fn([...orders]));

(window as any).__reelStore = {
  setConfig: (patch: Partial<StoreConfig>) => { config = { ...config, ...patch }; },
  getConfig: () => config,
  pushOrder: (o: StoreOrder) => { orders = [o, ...orders]; emit(); },
  setOrders: (list: StoreOrder[]) => { orders = list; emit(); },
};

// ?nueva: comercio sin tienda todavía (la crea la pantalla que la necesite, p. ej. la Agenda)
const FRESH = new URLSearchParams(location.search).has('nueva');
if (FRESH) {
  localStorage.removeItem(STORE_ID_KEY);
  config = { ...config, businessName: '', subdomain: '', whatsappNumber: '', isPublished: false, agenda: undefined } as any;
} else localStorage.setItem(STORE_ID_KEY, STORE_ID);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cupones en memoria (ver services/onlineStore.ts)
export type CouponType = 'percent' | 'fixed' | 'shipping';
export interface StoreCoupon { code: string; type: CouponType; value: number; minOrder?: number; maxDiscount?: number; maxUses?: number; uses?: number; oncePerCustomer?: boolean; validFrom?: string; validUntil?: string; active: boolean }
export const normCouponCode = (c: string) => c.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
let coupons: StoreCoupon[] = [{ code: 'VERANO10', type: 'percent', value: 10, maxDiscount: 5000, uses: 7, maxUses: 50, active: true, validUntil: '2026-12-31' }];
export async function fetchCoupons(_s: string) { await pause(150); return coupons.map((c) => ({ ...c })); }
export async function saveCoupon(_s: string, c: StoreCoupon, isNew: boolean) {
  if (isNew && coupons.some((x) => x.code === c.code)) throw new Error('Ya tenés un cupón con ese código');
  coupons = isNew ? [...coupons, { ...c, uses: 0 }] : coupons.map((x) => (x.code === c.code ? { ...x, ...c } : x));
}
export async function deleteCoupon(_s: string, code: string) { coupons = coupons.filter((x) => x.code !== code); }

export async function claimStore(_storeId: string): Promise<void> {}
export async function resolveStoreId(): Promise<string> { localStorage.setItem(STORE_ID_KEY, STORE_ID); return STORE_ID; }
export async function loadStoreConfig(_storeId: string): Promise<StoreConfig> { return { ...config }; }
export async function saveStoreConfig(_storeId: string, patch: Partial<StoreConfig>): Promise<void> {
  await pause(250);
  config = { ...config, ...patch };
  if (typeof patch.isPublished === 'boolean') import('../services/onlineStoreOrders').then((m) => m.setStorePublished(!!patch.isPublished)).catch(() => {});
}
export async function isSubdomainAvailable(subdomain: string): Promise<boolean> { await pause(150); return !!subdomain; }
export async function publishProductImages(_storeId: string, products: any[], onProgress?: (d: number, t: number) => void): Promise<Map<string, string>> {
  for (let i = 0; i < products.length; i++) { await pause(40); onProgress?.(i + 1, products.length); }
  return new Map(products.filter((p) => p.imageUrl).map((p) => [p.id, p.imageUrl]));
}
let publishedCatalog: OnlineProduct[] | null = null;
export async function syncCatalogToStore(_storeId?: string, list?: OnlineProduct[]): Promise<void> { await pause(200); publishedCatalog = list ? [...list] : publishedCatalog; }
export async function fetchAllProducts(): Promise<any[]> {
  const { default: api } = await import('../services/api');
  const { data } = await api.get('/products', { params: { skip: 0, take: 2000 } });
  return data?.products || data || [];
}
export async function loadPublishedCatalog(): Promise<OnlineProduct[] | null> { await pause(150); return publishedCatalog; }
export type CatalogDiff = { added: Set<string>; removed: Set<string>; changed: Set<string>; unknown: boolean };
export function diffCatalog(local: OnlineProduct[], published: OnlineProduct[] | null, ignoreStock: boolean): CatalogDiff {
  const diff: CatalogDiff = { added: new Set(), removed: new Set(), changed: new Set(), unknown: published === null };
  if (published === null) { local.forEach((p) => diff.added.add(p.productId)); return diff; }
  const sig = (p: any) => [p.name, Number(p.price) || 0, p.category || '', p.brand || '', ignoreStock ? '' : !!p.inStock, !!p.imageUrl].join('|');
  const pub = new Map(published.map((p) => [p.productId, sig(p)]));
  const ids = new Set<string>();
  for (const p of local) { ids.add(p.productId); const b = pub.get(p.productId); if (b === undefined) diff.added.add(p.productId); else if (b !== sig(p)) diff.changed.add(p.productId); }
  published.forEach((p) => { if (!ids.has(p.productId)) diff.removed.add(p.productId); });
  return diff;
}
export async function fetchStoreOrders(_storeId: string, from: Date, to: Date): Promise<StoreOrder[]> {
  await pause(200);
  return orders.filter((o: any) => { const d = o.createdAt?.toDate?.(); return d && d >= from && d < to; });
}
export async function fetchProductCosts(ids: string[]): Promise<Record<string, number>> {
  const { default: api } = await import('../services/api');
  const { data } = await api.get('/products');
  return Object.fromEntries((data || []).filter((p: any) => ids.includes(p.id)).map((p: any) => [p.id, p.costPrice || 0]));
}
export async function fetchOnlineSummary(): Promise<OnlineProduct[]> {
  const { default: api } = await import('../services/api');
  const { data } = await api.get('/products');
  return (data || []).filter((p: any) => p.showOnline).map((p: any) => toOnlineProduct(p, p.imageUrl ? 'x' : ''));
}
export async function countPendingCatalog(_storeId: string, cfg: any): Promise<number> {
  const local = await fetchOnlineSummary();
  const d = diffCatalog(local, publishedCatalog, !!cfg.alwaysInStock);
  return d.unknown ? (local.length ? -1 : 0) : d.added.size + d.removed.size + d.changed.size;
}
(window as any).__reelStore.setPublished = (list: OnlineProduct[] | null) => { publishedCatalog = list; };
export function subscribeToStoreOrders(_storeId: string, onChange: (orders: StoreOrder[]) => void): () => void {
  listeners.add(onChange);
  onChange([...orders]);
  return () => { listeners.delete(onChange); };
}
export async function claimOrder(): Promise<boolean> { return true; }
export async function releaseOrder(): Promise<void> {}
export async function markOrderSyncedLocally(): Promise<void> {}
export async function publishOnlineCatalog(_storeId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  const total = 8;
  for (let i = 1; i <= total; i++) { await pause(90); onProgress?.(i, total); }
  publishedCatalog = await fetchOnlineSummary();
  return total;
}
export async function updateOrderStage(_storeId: string, orderId: string, stage: OrderStage): Promise<void> {
  orders = orders.map((o) => (o.id === orderId ? { ...o, stage, stageAt: new Date() } : o));
  emit();
}

export function compressImageFile(file: File, maxWidth: number, maxHeight: number, quality = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
        if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No se pudo generar el canvas'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export async function publishOnlinePromos(_storeId: string, _ids: Set<string>): Promise<number> { return 0; }
export function toOnlineProduct(p: any, imageUrl = ''): OnlineProduct {
  return { productId: p.id, name: p.name, price: p.salePrice, imageUrl, category: p.category?.name || 'Varios', inStock: true };
}
export const ORDER_CHANNELS: { id: 'BOTH' | 'APP' | 'WHATSAPP'; title: string; text: string }[] = [
  { id: 'BOTH', title: 'App y WhatsApp', text: '' }, { id: 'APP', title: 'Solo la app', text: '' }, { id: 'WHATSAPP', title: 'Solo WhatsApp', text: '' },
];
