// SOLO DESARROLLO: vista previa de las ventanas de caja con datos de ejemplo,
// sin backend ni login, para revisar el diseño en distintas resoluciones.
// Se abre con `npm run dev` en /cash-preview.html (no forma parte del build).
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import api from '../services/api';
import CajaInfoModal from '../components/pos/CajaInfoModal';
import CierreCajaModal from '../components/pos/CierreCajaModal';
import CierreDiaModal from '../components/cash-register/CierreDiaModal';
import AppToaster from '../components/common/AppToaster';
import HelpMenu from '../components/common/tour/HelpMenu';
import toast from 'react-hot-toast';

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();

const sale = (total: number, method: string) => ({ total, totalAmount: total, items: [], payments: [{ method, amount: total }] });

const session = {
  id: 'sess_fc8637a1',
  openedAt: iso(9 * 60 + 12),
  terminalName: 'Terminal 2',
  openingAmount: 30000,
  user: { fullName: 'Juan Hidalgo', username: 'admin', role: 'ADMIN' },
  cashMovements: [
    { id: 'm1', type: 'EXPENSE', amount: 8500, description: 'LIMPIEZA Y ARTÍCULOS | METODO: CASH', createdAt: iso(300) },
    { id: 'm2', type: 'EXPENSE', amount: 42000, description: 'PAGO PROVEEDOR COCA-COLA | METODO: CASH', createdAt: iso(200) },
    { id: 'm3', type: 'WITHDRAWAL', amount: 50000, description: 'RETIRO A CAJA FUERTE', createdAt: iso(90) },
  ],
  sales: [
    ...Array.from({ length: 38 }, (_, i) => sale(2800 + (i % 7) * 1350, 'CASH')),
    ...Array.from({ length: 12 }, (_, i) => sale(5200 + i * 400, 'CLOVER')),
    ...Array.from({ length: 9 }, (_, i) => sale(3100 + i * 650, 'MERCADOPAGO')),
    // Cargas virtuales (peor caso para la pantalla de validación)
    { total: 2200, totalAmount: 2200, payments: [{ method: 'CASH', amount: 2200 }], items: [{ productId: 'VIRTUAL_LOAD_1', productName: 'CARGA VIRTUAL (2000+200)', quantity: 1, total: 2200 }] },
    { total: 5500, totalAmount: 5500, payments: [{ method: 'CASH', amount: 5500 }], items: [{ productId: 'VIRTUAL_LOAD_2', productName: 'CARGA VIRTUAL (5000+500)', quantity: 1, total: 5500 }] },
  ],
};

const zSession = (id: string, name: string, counted: number, expected: number) => ({
  id, terminalName: 'Terminal 2', user: { fullName: name }, openedAt: iso(600), closedAt: iso(20),
  openingAmount: 30000, closingAmountCounted: counted, closingAmountExpected: expected, difference: counted - expected,
  totalRevenue: 186400, sales: session.sales, closingNotes: '', closingSummary: JSON.stringify({ totalRevenue: 186400, expenses: [], withdrawals: [] }),
});
const zReport = {
  id: 'z_20260918_01', generatedAt: iso(5), generatedBy: { fullName: 'Juan Hidalgo' },
  sessions: [zSession('s1', 'Juan Hidalgo', 152300, 152300), zSession('s2', 'María López', 98700, 99200)],
  summary: JSON.stringify({
    sessionCount: 2, paymentBreakdown: { CASH: 251000, CLOVER: 88400, MERCADOPAGO: 47100 },
    cashIncome: 0, cashExpense: 50500, cashWithdrawal: 50000, cashMovements: session.cashMovements.map(m => ({ ...m, user: { fullName: 'Juan Hidalgo' } })),
    totalCashCounted: 251000, totalCashExpected: 251500, posnetDeclarations: {}, sessions: [],
  }),
};

// Respuestas simuladas del backend
api.defaults.adapter = async (config: any) => {
  const url = String(config.url || '');
  let data: any = {};
  if (url.startsWith('/cash/current') || url.startsWith('/cash/session/')) data = session;
  else if (url.startsWith('/cash/z-reports')) data = [zReport];
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};

function Preview() {
  const [view, setView] = useState<'info' | 'cierre' | 'z' | 'zh' | null>(null);
  const btn = (v: typeof view, label: string) => (
    <button onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${view === v ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-slate-300'}`}>{label}</button>
  );
  return (
    <div className="min-h-screen bg-slate-100 p-3">
      <div className="fixed top-2 left-2 z-[999] flex gap-2 bg-white/90 p-2 rounded-xl shadow">
        {btn('info', 'Estado de caja')}{btn('cierre', 'Arqueo (Cierre X)')}{btn('z', 'Cierre del día (Z)')}{btn('zh', 'Reporte Z')}
        <button onClick={() => toast.success('✅ Caja abierta correctamente')} className="px-3 py-1.5 rounded-lg text-sm border bg-white">Aviso OK</button>
        <button onClick={() => toast.error('⚠️ Código no registrado: 7790895000997')} className="px-3 py-1.5 rounded-lg text-sm border bg-white">Aviso error</button>
        <button onClick={() => toast('Pedido online nuevo #218 · $ 8.450', { icon: '⚠️' })} className="px-3 py-1.5 rounded-lg text-sm border bg-white">Aviso</button>
        <button onClick={() => { const id = toast.loading('Sincronizando ventas…'); setTimeout(() => toast.success('3 ventas offline sincronizadas', { id }), 1500); }} className="px-3 py-1.5 rounded-lg text-sm border bg-white">Cargando</button>
      </div>
      {view === 'info' && <CajaInfoModal sessionId={session.id} terminalName="Terminal 2" onClose={() => setView(null)} onTriggerClose={() => setView('cierre')} onTriggerCloseAndZ={() => setView('z')} />}
      {view === 'cierre' && <CierreCajaModal session={session} onClose={() => setView(null)} onConfirm={async () => { setView(null); }} />}
      {view === 'z' && <CierreDiaModal zReport={zReport} onClose={() => setView(null)} />}
      <AppToaster />
      <HelpMenu pathname="/pos" side="left" />
      {view === 'zh' && <CierreDiaModal zReport={zReport} isHistory onClose={() => setView(null)} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
