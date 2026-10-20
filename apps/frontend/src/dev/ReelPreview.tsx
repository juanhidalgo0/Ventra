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
// ?turno: la caja con un turno ya trabajado (ventas, gastos y un retiro), para mostrar el estado de
// la caja y el arqueo sobre la pantalla de cobro
if (new URLSearchParams(location.search).has('turno')) {
  const ago = (min: number) => new Date(now - min * 60e3).toISOString();
  const sale = (total: number, method: string) => ({ total, totalAmount: total, items: [], payments: [{ method, amount: total }] });
  session.sales = [
    ...Array.from({ length: 38 }, (_, i) => sale(2800 + (i % 7) * 1350, 'CASH')),
    ...Array.from({ length: 12 }, (_, i) => sale(5200 + i * 400, 'CLOVER')),
    ...Array.from({ length: 9 }, (_, i) => sale(3100 + i * 650, 'MERCADOPAGO')),
  ] as any;
  session.cashMovements = [
    { id: 'm1', type: 'EXPENSE', amount: 8500, description: 'LIMPIEZA Y ARTÍCULOS | METODO: CASH', createdAt: ago(150) },
    { id: 'm2', type: 'EXPENSE', amount: 42000, description: 'PAGO PROVEEDOR COCA-COLA | METODO: CASH', createdAt: ago(100) },
    { id: 'm3', type: 'WITHDRAWAL', amount: 50000, description: 'RETIRO A CAJA FUERTE', createdAt: ago(40) },
  ] as any;
}
// ?plan=full|tienda|agenda y ?rubro=distribuidora|kiosco: para ver la app en cada caso (capturas)
const qs = new URLSearchParams(location.search);
const PLAN = qs.get('plan');
if (PLAN) localStorage.setItem('demo_plan', PLAN);
const RUBRO = qs.get('rubro');
if (RUBRO) {
  const distrib = RUBRO === 'distribuidora';
  localStorage.setItem('business_profile', distrib ? 'DISTRIBUIDORA' : 'KIOSKO');
  localStorage.setItem('business_features', JSON.stringify(distrib
    ? { bulk: true, delivery: true, preorders: true, expiry: true }
    : { bulk: false, delivery: false, preorders: false }));
  localStorage.setItem('gd_store_name', distrib ? 'Distribuidora del Sur' : 'Maxikiosco Sofi');
  localStorage.setItem('onboarding_done', '1');
  const plan = PLAN || 'full';
  localStorage.setItem('business_intents', JSON.stringify(plan === 'tienda' ? ['online'] : plan.startsWith('agenda') ? ['turnos'] : ['mostrador']));
  const d = new Date().getDay();
  localStorage.setItem('ventra_route_days', JSON.stringify(distrib ? { Bavio: [d], Magdalena: [d], 'Verónica': [(d + 1) % 7] } : {}));
}
const ZCLIENTS = [
  { id: 'cl1', name: 'Almacén Don Tito', locality: 'Bavio', address: 'Ruta 11 km 5', balance: 0, isActive: true },
  { id: 'cl2', name: 'Kiosco La Esquina', locality: 'Magdalena', address: 'Calle 9 N 410', balance: 12400, creditLimit: 50000, isActive: true },
  { id: 'cl3', name: 'Despensa Marta', locality: 'Magdalena', address: 'Av. Mitre 220', balance: 0, isActive: true },
  { id: 'cl4', name: 'Autoservicio El Sol', locality: 'Verónica', address: 'Calle 15 N 820', balance: 64000, creditLimit: 50000, isActive: true },
];
const order = (id: string, n: number, c: number, total: number, bultos: number) => ({
  id, orderNumber: n, status: 'PENDING', clientId: ZCLIENTS[c].id, client: ZCLIENTS[c], total, createdAt: new Date().toISOString(),
  user: { fullName: 'Lucas' }, items: [{ id: id + 'i', productId: products[0]?.id, productName: products[0]?.name, quantity: bultos * 12, packSize: 12, unitPrice: total / (bultos * 12) }],
});
const ORDERS = [order('po1', 1045, 0, 126000, 8), order('po2', 1046, 1, 54000, 3), order('po3', 1047, 3, 98000, 6)];
const TODAY = {
  orders: { pending: 3, newToday: 2, bultos: 17, total: 278000, zones: [
    { zone: 'Magdalena', count: 1, bultos: 3, total: 54000 }, { zone: 'Bavio', count: 1, bultos: 8, total: 126000 }, { zone: 'Verónica', count: 1, bultos: 6, total: 98000 }] },
  runs: [
    { id: 'r1', runNumber: 12, status: 'EN_REPARTO', date: new Date().toISOString(), driverName: 'Carlos', stops: 9, registered: 6, bultos: 64, total: 512000, cashSoFar: 318000, transferSoFar: 62000, zones: ['Bavio', 'Magdalena'] },
    { id: 'r2', runNumber: 11, status: 'CERRADO', date: new Date().toISOString(), driverName: 'Carlos', stops: 7, registered: 7, bultos: 41, total: 296000, expectedCash: 210000, cashReceived: 210000, zones: ['Verónica'] },
  ],
  money: { collected: 590000, cash: 528000, transfer: 62000, other: 0, sold: 808000, soldCount: 16, onStreet: 512000, owed: 76400, debtorsCount: 2,
    topDebtors: [ZCLIENTS[3], ZCLIENTS[1]], overLimit: [ZCLIENTS[3]], overLimitCount: 1 },
};
let saleNo = 18996;
const seen = new Set<string>();

api.defaults.adapter = async (config: any) => {
  const url = String(config.url || '').split('?')[0];
  const m = (config.method || 'get').toLowerCase();
  let data: any = [];
  if (url.startsWith('/system/info')) data = { isDemo: !!PLAN };
  else if (url.startsWith('/sales/owner-summary')) data = {
    revenue: 486500, cost: 331000, grossProfit: 155500, expenses: 23000, profit: 132500, tickets: 74, averageTicket: 6574,
    previous: { revenue: 441000, profit: 118000, tickets: 69 },
    buckets: ['8', '10', '12', '14', '16', '18', '20'].map((label, i) => ({ label, revenue: [32000, 61000, 98000, 54000, 47000, 112000, 82500][i] })),
    paymentBreakdown: { CASH: 268000, CLOVER: 121500, MERCADOPAGO: 97000 },
    topProducts: products.slice(0, 5).map((p, i) => ({ name: p.name, quantity: 24 - i * 3, revenue: p.salePrice * (24 - i * 3) })),
    lowStock: { count: 3, items: products.slice(5, 8).map((p) => ({ id: p.id, name: p.name, stock: 2, minStock: 5 })) },
    openSessions: [{ id: 'sess_demo', terminalName: 'Caja 1', userName: 'Sofi', openedAt: new Date(now - 3 * 3600e3).toISOString(), expectedCash: 268000 }],
  };
  else if (url.startsWith('/delivery-runs/today')) data = TODAY;
  else if (url.startsWith('/delivery-runs/drivers')) data = [{ id: 'u1', name: 'Carlos', role: 'CASHIER', workRole: 'CHOFER' }];
  else if (url.startsWith('/delivery-runs')) data = TODAY.runs;
  else if (url.startsWith('/preorders/committed') || url.startsWith('/preorders/last-by-client')) data = {};
  else if (url.startsWith('/preorders')) data = ORDERS;
  else if (url === '/clients' && RUBRO === 'distribuidora') data = ZCLIENTS;
  else if (url.startsWith('/auth/license/status')) data = { isActive: true, status: 'ACTIVE', plan: 'PRO', expiresAt: '2099-01-01T00:00:00Z', daysRemaining: 9999 };
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
  else if (url.startsWith('/cash/session/')) data = session;
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
