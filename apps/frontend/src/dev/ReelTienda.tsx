// SOLO DESARROLLO: la app real en modo "Ventra Tienda" (plan sin caja) con una tienda de ropa
// de ejemplo, para grabar el reel de la tienda online. Backend simulado (sin login ni base) y
// la tienda en memoria (reelStoreMock, vía vite.reel.config.ts). No forma parte del build.
// Se abre con: npx vite --config vite.reel.config.ts  →  /reel-tienda.html
import './reelPreviewBoot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import AppToaster from '../components/common/AppToaster';
import App from '../App';
import '../index.css';
import api from '../services/api';
import toast from 'react-hot-toast';

// La grabación cierra los avisos antes de tocar botones que quedan debajo
(window as any).__toast = toast;

localStorage.setItem('user', JSON.stringify({ id: 'demo', username: 'mia', fullName: 'Mía', role: 'ADMIN' }));

const FOTO = (n: number) => `${location.origin}/src/dev/reel-fotos/p${n}.jpg`;
const CATS = [{ id: 'c1', name: 'Abrigo' }, { id: 'c2', name: 'Tops y blusas' }, { id: 'c3', name: 'Básicos' }, { id: 'c4', name: 'Calzado y accesorios' }];
const RAW = [
  { n: 1, name: 'Sweater tejido crema', price: 38900, cat: 'c1' },
  { n: 8, name: 'Sweater trenzado terracota', price: 41500, cat: 'c1' },
  { n: 2, name: 'Cuello tejido mostaza', price: 19900, cat: 'c4' },
  { n: 3, name: 'Top de encaje negro', price: 24900, cat: 'c2' },
  { n: 4, name: 'Blusa de gasa nude', price: 32500, cat: 'c2' },
  { n: 5, name: 'Remera básica blanca', price: 14900, cat: 'c3' },
  { n: 6, name: 'Jean recto índigo', price: 45900, cat: 'c3' },
  { n: 7, name: 'Zapatillas animal print', price: 52000, cat: 'c4' },
];
const products = RAW.map((r, i) => ({
  id: 'p' + r.n, name: r.name, barcode: '779000000' + r.n, sku: null, salePrice: r.price, price: r.price,
  costPrice: Math.round(r.price * 0.55), stock: [12, 8, 15, 6, 9, 24, 11, 4][i], minStock: 5, unit: 'UNIT',
  imageUrl: FOTO(r.n), categoryId: r.cat, category: CATS.find((c) => c.id === r.cat), isActive: true, showOnline: true,
  additionalBarcodes: [], salesCount: 100 - i, unlimitedStock: false, allowCustomPrice: false, isKit: false,
}));

// ?plan=agenda|full|caja (por defecto, tienda) · ?nueva: comercio recién creado (bienvenida)
const PLAN = new URLSearchParams(location.search).get('plan');
const NUEVA = new URLSearchParams(location.search).has('nueva');
if (NUEVA) ['onboarding_done', 'business_intents', 'business_profile', 'business_features', 'gd_store_name', 'getting_started_hidden', 'agenda_link_shared'].forEach((k) => localStorage.removeItem(k));

api.defaults.adapter = async (config: any) => {
  const url = String(config.url || '').split('?')[0];
  const m = (config.method || 'get').toLowerCase();
  let data: any = [];
  if (url.startsWith('/subscription/status')) data = PLAN === 'agenda'
    ? { state: 'ACTIVE', enforced: true, plan: 'agenda', planName: 'Ventra Agenda', features: { caja: false, tienda: false, agenda: true }, daysLeft: 30 }
    : PLAN === 'full'
      ? { state: 'ACTIVE', enforced: true, plan: 'full', planName: 'Ventra Full', features: { caja: true, tienda: true, agenda: true }, daysLeft: 30 }
      : PLAN === 'caja'
        ? { state: 'ACTIVE', enforced: true, plan: 'caja', planName: 'Ventra Caja', features: { caja: true, tienda: false, agenda: false }, daysLeft: 30 }
        : { state: 'ACTIVE', enforced: true, plan: 'tienda', planName: 'Ventra Tienda', features: { caja: false, tienda: true, agenda: true }, daysLeft: 30 };
  else if (url.startsWith('/settings/activation')) data = { products: NUEVA ? 0 : products.length, users: 1, hasSales: !NUEVA };
  else if (url === '/settings' && m === 'get') data = {};
  else if (url.startsWith('/auth/license/status')) data = { isActive: true, status: 'ACTIVE', plan: 'PRO', expiresAt: '2099-01-01T00:00:00Z', daysRemaining: 9999 };
  else if (url.startsWith('/products/low-stock-ids')) data = [{ id: 'p7', minStock: 5 }];
  else if (url.startsWith('/products/pos-catalog')) data = { products };
  else if (url.startsWith('/products/count')) data = { count: products.length };
  else if (url.startsWith('/products')) data = products;
  else if (url.startsWith('/categories')) data = CATS.map((c) => ({ ...c, _count: { products: products.filter((p) => p.categoryId === c.id).length } }));
  else if (url.startsWith('/promotions')) data = [];
  else if (url.startsWith('/cash/current')) data = null;
  else if (url.startsWith('/system/info')) data = { isDemo: new URLSearchParams(location.search).has('demo') };
  else if (m !== 'get') data = { ok: true };
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <AppToaster />
    </HashRouter>
  </React.StrictMode>,
);
