import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Lock, Unlock, DollarSign, Clock, CreditCard, Smartphone, Banknote, CheckCircle2, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';

export default function CashRegisterScreen() {
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [terminalName, setTerminalName] = useState('Terminal 1');
  const [openingAmount, setOpeningAmount] = useState(() => {
    const saved = localStorage.getItem('default_opening_amount');
    return saved ? Number(saved) : 30000;
  });
  const [closingAmount, setClosingAmount] = useState(0);
  const [closingNotes, setClosingNotes] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    // Smart terminal detection to resolve local PC identity
    let uuid = localStorage.getItem('terminal_uuid');
    if (!uuid) {
      uuid = 'term_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('terminal_uuid', uuid);
    }
    api.get(`/cash/terminal-name?terminalId=${uuid}`)
      .then(({ data }) => {
        setTerminalName(data.terminalName);
        loadSession(data.terminalName);
      })
      .catch(() => {
        setTerminalName('Terminal 1');
        loadSession('Terminal 1');
      });
  }, []);

  const loadSession = async (tName: string) => {
    try {
      const { data } = await api.get('/cash/current', { params: { terminalName: tName } });
      setSession(data);
    } catch {} finally {
      setIsLoading(false);
    }
  };

  const handleOpen = async () => {
    try {
      const { data } = await api.post('/cash/open', { terminalName, openingAmount, openingNotes: '' });
      setSession(data); toast.success('✅ Caja abierta');
    } catch (err: any) { toast.error(err.response?.data?.message || 'Error'); }
  };

  const handleClose = async () => {
    try {
      await api.post(`/cash/${session.id}/close`, { closingAmountCounted: closingAmount, closingNotes });
      toast.success('✅ Caja cerrada'); setSession(null); setShowCloseConfirm(false);
    } catch (err: any) { toast.error(err.response?.data?.message || 'Error'); }
  };

  const fmt = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);
  const fmtTime = (d: string) => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  if (isLoading) return <div className="h-full card flex items-center justify-center text-gray-400">Cargando...</div>;

  // Calculate session totals
  const salesTotal = session?.sales?.reduce((s: number, v: any) => s + v.total, 0) || 0;
  const salesCount = session?.sales?.length || 0;

  // Calculate VIRTUAL1 and VIRTUAL2 sales breakdown
  const virtual1SalesBreakdown = session?.sales?.reduce((acc: Record<string, number>, v: any) => {
    let saleVirtualTotal = 0;
    if (v.items) {
      for (const item of v.items) {
        if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
          saleVirtualTotal += item.total || (item.unitPrice * item.quantity) || 0;
        }
      }
    }
    if (saleVirtualTotal > 0) {
      const saleTotal = v.total || v.totalAmount || 0;
      for (const p of v.payments || []) {
        const proportion = saleTotal > 0 ? (p.amount / saleTotal) : 0;
        const virtualPaymentAmount = saleVirtualTotal * proportion;
        acc[p.method] = (acc[p.method] || 0) + virtualPaymentAmount;
      }
    }
    return acc;
  }, { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 }) || { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };

  const virtual2SalesBreakdown = session?.sales?.reduce((acc: Record<string, number>, v: any) => {
    let saleVirtualTotal = 0;
    if (v.items) {
      for (const item of v.items) {
        if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
          saleVirtualTotal += item.total || (item.unitPrice * item.quantity) || 0;
        }
      }
    }
    if (saleVirtualTotal > 0) {
      const saleTotal = v.total || v.totalAmount || 0;
      for (const p of v.payments || []) {
        const proportion = saleTotal > 0 ? (p.amount / saleTotal) : 0;
        const virtualPaymentAmount = saleVirtualTotal * proportion;
        acc[p.method] = (acc[p.method] || 0) + virtualPaymentAmount;
      }
    }
    return acc;
  }, { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 }) || { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };

  const cashPaymentsBase = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const cashPayments = cashPaymentsBase - (virtual1SalesBreakdown['CASH'] || 0) - (virtual2SalesBreakdown['CASH'] || 0);

  const cloverPaymentsBase = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CLOVER').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const cloverPayments = cloverPaymentsBase - (virtual1SalesBreakdown['CLOVER'] || 0) - (virtual2SalesBreakdown['CLOVER'] || 0);

  const mpPaymentsBase = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'MERCADOPAGO').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const mpPayments = mpPaymentsBase - (virtual1SalesBreakdown['MERCADOPAGO'] || 0) - (virtual2SalesBreakdown['MERCADOPAGO'] || 0);

  const debtPaymentsBase = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'DEBT').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const debtPayments = debtPaymentsBase - (virtual1SalesBreakdown['DEBT'] || 0) - (virtual2SalesBreakdown['DEBT'] || 0);

  const expenses = session?.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const withdrawals = session?.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const expectedCash = (session?.openingAmount || 0) + cashPayments - expenses - withdrawals;

  return (
    <div className="h-full card p-5 overflow-y-auto custom-scrollbar bg-slate-50/20">
      <div className="flex items-center gap-2 mb-6">
        {session ? <Unlock className="w-5 h-5 text-emerald-500" /> : <Lock className="w-5 h-5 text-gray-400" />}
        <h1 className="text-xl font-bold text-gray-800">Gestión de Caja</h1>
      </div>

      {!session ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mt-10 mx-auto">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4"><Lock className="w-8 h-8 text-rose-500" /></div>
            <h2 className="text-lg font-semibold text-gray-700 mb-1">Abrir Caja</h2>
            <p className="text-sm text-gray-400">Ingresá los datos para iniciar la sesión</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">Terminal</label>
              <input value={terminalName} disabled={true} className="input-field bg-slate-100 text-slate-700 font-bold select-none cursor-not-allowed" placeholder="Terminal 1" />
              <p className="text-[9px] text-slate-600 font-semibold mt-1">🖥️ Dispositivo detectado localmente.</p>
            </div>
            <div>
              <label className="block text-sm text-gray-500 mb-1">Monto inicial ($)</label>
              <input 
                type="number" 
                value={openingAmount || ''} 
                onChange={(e) => setOpeningAmount(Number(e.target.value))} 
                disabled={true}
                className="input-field text-xl font-bold bg-slate-100 text-slate-600 cursor-not-allowed select-none"
                placeholder="30000" 
              />
              <p className="text-[10px] text-amber-500 font-bold mt-1.5 ml-1">🔒 Monto bloqueado. Configurado por el Administrador desde el panel general.</p>
            </div>
            <button onClick={handleOpen} className="w-full btn-primary py-3 flex items-center justify-center gap-2"><Unlock className="w-5 h-5" /> Abrir Caja</button>
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 shadow-sm">
              <p className="text-[10px] text-emerald-600 mb-0.5 flex items-center gap-1 uppercase tracking-wider font-bold"><DollarSign className="w-3 h-3" />Ventas Totales</p>
              <p className="text-xl font-bold text-emerald-700 leading-none">{fmt(salesTotal)}</p>
              <p className="text-[9px] text-emerald-500 mt-1 font-medium">{salesCount} ventas realizadas</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 shadow-sm">
              <p className="text-[10px] text-blue-600 mb-0.5 flex items-center gap-1 uppercase tracking-wider font-bold"><Banknote className="w-3 h-3" />Efectivo</p>
              <p className="text-xl font-bold text-blue-700 leading-none">{fmt(cashPayments)}</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 shadow-sm">
              <p className="text-[10px] text-amber-600 mb-0.5 flex items-center gap-1 uppercase tracking-wider font-bold"><CreditCard className="w-3 h-3" />Clover</p>
              <p className="text-xl font-bold text-amber-700 leading-none">{fmt(cloverPayments)}</p>
            </div>
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-100 shadow-sm">
              <p className="text-[10px] text-sky-600 mb-0.5 flex items-center gap-1 uppercase tracking-wider font-bold"><Smartphone className="w-3 h-3" />Mercado Pago</p>
              <p className="text-xl font-bold text-sky-700 leading-none">{fmt(mpPayments)}</p>
            </div>
            <div className="p-3 rounded-xl bg-pink-50 border border-pink-100 shadow-sm">
              <p className="text-[10px] text-pink-600 mb-0.5 flex items-center gap-1 uppercase tracking-wider font-bold"><Wallet className="w-3 h-3" />Cta. Corriente</p>
              <p className="text-xl font-bold text-pink-700 leading-none">{fmt(debtPayments)}</p>
              <p className="text-[8px] text-pink-400 mt-1 uppercase font-bold tracking-tight">No afecta caja</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 text-center shadow-sm">
              <p className="text-[9px] text-gray-400 mb-0.5 uppercase tracking-wider font-bold">Apertura</p>
              <p className="text-base font-bold text-gray-700 leading-none">{fmt(session.openingAmount)}</p>
            </div>
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-center shadow-sm">
              <p className="text-[9px] text-red-400 mb-0.5 uppercase tracking-wider font-bold">Gastos</p>
              <p className="text-base font-bold text-red-600 leading-none">{fmt(expenses + withdrawals)}</p>
            </div>
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-center shadow-sm">
              <p className="text-[9px] text-rose-400 mb-0.5 uppercase tracking-wider font-bold">Efectivo esperado</p>
              <p className="text-base font-bold text-rose-700 leading-none">{fmt(expectedCash)}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-300 text-center shadow-sm">
              <p className="text-[9px] text-slate-600 mb-0.5 uppercase tracking-wider font-bold">Terminal</p>
              <p className="text-base font-bold text-slate-700 leading-none truncate">{session.terminalName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-400 mb-6 font-medium">
            <Clock className="w-4 h-4 text-rose-400 animate-pulse" />Abierta desde {fmtTime(session.openedAt)} — {session.terminalName} — {session.user?.fullName}
          </div>

          {!showCloseConfirm ? (
            <button onClick={() => setShowCloseConfirm(true)} className="btn-danger py-3.5 px-6 flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-md"><Lock className="w-4 h-4" /> Cerrar Caja</button>
          ) : (
            <div className="p-5 rounded-2xl border border-red-200 bg-red-50/50 space-y-4 max-w-md shadow-sm">
              <h3 className="font-bold text-red-700 flex items-center gap-2"><Lock className="w-4.5 h-4.5" />Confirmar Cierre de Caja</h3>
              <div>
                <label className="block text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1.5">Monto contado ($)</label>
                <input type="number" value={closingAmount || ''} onChange={(e) => setClosingAmount(Number(e.target.value))} className="w-full bg-white border border-red-200 rounded-xl px-4 py-3 text-lg font-bold text-red-800 outline-none focus:border-red-400 transition-all shadow-inner" placeholder="Contá el efectivo..." autoFocus />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1.5">Notas (opcional)</label>
                <input value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} className="w-full bg-white border border-red-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-700 outline-none focus:border-red-400 transition-all shadow-inner" placeholder="Notas del cierre..." />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={handleClose} className="flex-1 btn-danger"><CheckCircle2 className="w-5 h-5" />Confirmar Cierre</button>
                <button onClick={() => setShowCloseConfirm(false)} className="btn-secondary">Cancelar</button>
              </div>
            </div>
          )}

          {/* Detailed expenses view of the current shift */}
          {session.cashMovements && session.cashMovements.length > 0 && (
            <div className="mt-8 border-t border-slate-400/60 pt-6">
              <h3 className="text-sm font-bold text-slate-800 mb-4 uppercase tracking-wider">Detalle de Gastos y Egresos del Turno</h3>
              <div className="card overflow-x-auto max-h-[300px] custom-scrollbar">
                <table className="w-full text-left text-xs font-semibold text-slate-600 border-collapse">
                  <thead>
                    <tr className="border-b border-slate-400 bg-slate-50/50 text-[10px] uppercase text-slate-600 tracking-wider">
                      <th className="py-3.5 px-4 text-left">Categoría</th>
                      <th className="py-3.5 px-4 text-left">Descripción</th>
                      <th className="py-3.5 px-4 text-left">Hora</th>
                      <th className="py-3.5 px-4 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.cashMovements.map((mov: any) => {
                      const desc = mov.description || '';
                      const categoryMatch = desc.match(/^\[(.*?)\]/);
                      const category = categoryMatch ? categoryMatch[1] : 'Otro';
                      const cleanDescription = desc.replace(/^\[.*?\]/, '').trim();
                      
                      const getCatStyles = (cat: string) => {
                        const map: any = {
                          'Otro': 'bg-slate-50 text-slate-600 border-slate-150',
                          'Mercadería / Insumos': 'bg-emerald-50 text-emerald-600 border-emerald-150',
                          'Servicios (Luz, Agua, etc)': 'bg-blue-50 text-blue-600 border-blue-150',
                          'Sueldos / Adelantos': 'bg-rose-50 text-rose-600 border-rose-150',
                          'Mantenimiento': 'bg-amber-50 text-amber-600 border-amber-150',
                          'Impuestos': 'bg-rose-50 text-rose-600 border-rose-150'
                        };
                        return map[cat] || 'bg-slate-50 text-slate-600 border-slate-150';
                      };

                      return (
                        <tr key={mov.id} className="border-b border-slate-300 last:border-0 hover:bg-slate-50/40 transition-colors">
                          <td className="py-3 px-4">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-lg border uppercase ${getCatStyles(category)}`}>
                              {category}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-700 font-bold">{cleanDescription || 'Gasto operativo'}</td>
                          <td className="py-3 px-4 text-slate-600 font-medium">{new Date(mov.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="py-3 px-4 text-right font-black text-rose-600">
                            - {fmt(mov.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
