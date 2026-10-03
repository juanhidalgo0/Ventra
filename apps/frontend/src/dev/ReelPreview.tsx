// SOLO DESARROLLO: la app real (menú + Vender) con un backend simulado y datos de ejemplo,
// para grabar videos y capturas de marketing sin login ni tocar la base de datos.
// Se abre con `npm run dev` en /reel-preview.html (no forma parte del build).
import './reelPreviewBoot';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import AppToaster from '../components/common/AppToaster';
import App from '../App';
import '../index.css';
import api from '../services/api';
import catalog from './reelCatalog.json';

const CATS = [
  { id: 'c1', name: 'Almacén' }, { id: 'c2', name: 'Bebidas' }, { id: 'c3', name: 'Golosinas' },
  { id: 'c4', name: 'Limpieza' }, { id: 'c5', name: 'Snacks' }, { id: 'c6', name: 'Mascotas' },
];
const catFor = (n: string) =>
  /AMSTEL|CAMPARI|COCA|MANAOS|SCHNEIDER|ISENBECK/.test(n) ? 'c2'
  : /BON O BON|FERRERO|MILKA|MOGUL|SPRING|FANTOCHE|TERRABUSI|TODDY/.test(n) ? 'c3'
  : /ALA|LADY|FELPITA|AIR PUR|BANDERITA|RAID|COLGATE|S.LIBRE/.test(n) ? 'c4'
  : /TAKIS|LAYS|PIPAS/.test(n) ? 'c5'
  : /CAT CHOW|WHISKAS/.test(n) ? 'c6' : 'c1';

const products = (catalog as any[]).map((p, i) => {
  const categoryId = catFor(p.name);
  return {
    id: p.id, name: p.name, barcode: p.barcode, sku: null, salePrice: p.salePrice, price: p.salePrice,
    costPrice: Math.round(p.salePrice * 0.7), stock: 20 + (i * 7) % 60, minStock: 5, unit: 'UNIT',
    imageUrl: p.imageUrl, categoryId, category: CATS.find((c) => c.id === categoryId), isActive: true,
    additionalBarcodes: [], salesCount: 200 - i, unlimitedStock: false, allowCustomPrice: false, isKit: false,
  };
});

const now = Date.now();
const session = {
  id: 'sess_demo', openedAt: new Date(now - 3 * 3600e3).toISOString(), terminalName: 'Caja 1', openingAmount: 20000,
  status: 'OPEN', user: { fullName: 'Sofi', username: 'sofi', role: 'ADMIN' }, cashMovements: [], sales: [],
};
let saleNo = 18996;
const seen = new Set<string>();

api.defaults.adapter = async (config: any) => {
  const url = String(config.url || '').split('?')[0];
  const m = (config.method || 'get').toLowerCase();
  let data: any = [];
  if (url.startsWith('/auth/license/status')) data = { isActive: true, status: 'ACTIVE', plan: 'PRO', expiresAt: '2099-01-01T00:00:00Z', daysRemaining: 9999 };
  else if (url.startsWith('/products/pos-catalog')) data = { products };
  else if (url.startsWith('/products/barcode/')) {
    const code = decodeURIComponent(url.split('/').pop() || '');
    const p = products.find((x) => x.barcode === code);
    if (!p) return Promise.reject({ response: { status: 404, data: { message: 'No encontrado' } }, config });
    data = p;
  }
  else if (url.startsWith('/products/images/search')) data = products.filter((p) => p.imageUrl).slice(0, 8).map((p) => ({ url: p.imageUrl, thumb: p.imageUrl, title: p.name, source: 'Catálogo de ejemplo' }));
  else if (url.startsWith('/products/search-external-image/')) data = { imageUrl: products.find((p) => p.imageUrl)?.imageUrl || null };
  else if (/^\/products\/[^/]+$/.test(url) && !url.startsWith('/products/low-stock')) {
    const id = decodeURIComponent(url.split('/').pop() || '');
    const p: any = products.find((x) => x.id === id);
    if (!p) return Promise.reject({ response: { status: 404, data: { message: 'No encontrado' } }, config });
    if (m === 'patch') Object.assign(p, JSON.parse(config.data || '{}'));
    data = p;
  }
  else if (url.startsWith('/products')) data = products;
  else if (url.startsWith('/categories/top')) data = CATS;
  else if (url.startsWith('/categories')) data = CATS.map((c) => ({ ...c, _count: { products: products.filter((p) => p.categoryId === c.id).length } }));
  else if (url.startsWith('/cash/terminal-name')) data = { terminalName: 'Caja 1' };
  else if (url.startsWith('/cash/current')) data = session;
  else if (url.startsWith('/cash/server-ip')) data = { ip: '192.168.0.10' };
  else if (url.startsWith('/fiscal/config')) data = { enabled: false };
  else if (url === '/sales' && m === 'post') {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    data = { ...body, id: 'sale_' + saleNo, saleNumber: saleNo++, createdAt: new Date().toISOString(), total: body?.total ?? body?.totalAmount };
  }
  else if (m !== 'get') data = { ok: true };
  if (!seen.has(m + ' ' + url)) { seen.add(m + ' ' + url); console.log('[reel-mock]', m.toUpperCase(), url); }
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
