import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Banknote, CreditCard, Smartphone, Users, Truck, ArrowDownLeft, ArrowUpRight, ChevronRight, Wallet } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, Sheet, PrimaryButton, MoneyInput, ListSkeleton, money, parseAmount, METHOD_LABELS } from './ui';

/**
 * Tesorería: dónde está la plata del negocio hoy. Efectivo en las cajas, lo cobrado
 * en el mes por cada medio, lo que te deben y lo que debés. Ingresos y retiros de caja.
 */
export default function MobileTreasuryScreen() {
  const navigate = useNavigate();
  const [data, setData] = useState<any | null>(null);
  const [receivable, setReceivable] = useState(0);
  const [payable, setPayable] = useState(0);
  const [moving, setMoving] = useState<'INCOME' | 'WITHDRAWAL' | null>(null);

  const load = useCallback(async () => {
    const [summary, clients, purchases] = await Promise.all([
      api.get('/sales/owner-summary', { params: { period: 'month' } }).then((r) => r.data).catch(() => null),
      api.get('/clients').then((r) => r.data || []).catch(() => []),
      api.get('/purchases').then((r) => r.data || []).catch(() => []),
    ]);
    setData(summary || { openSessions: [], paymentBreakdown: {} });
    setReceivable(clients.reduce((s: number, c: any) => s + (c.balance > 0 ? c.balance : 0), 0));
    setPayable(purchases.filter((p: any) => p.paymentStatus === 'OWED' && p.status !== 'CANCELLED').reduce((s: number, p: any) => s + p.total, 0));
  }, []);
  useEffect(() => { load(); }, [load]);

  const cash = (data?.openSessions || []).reduce((s: number, x: any) => s + x.expectedCash, 0);
  const methods = Object.entries(data?.paymentBreakdown || {}).filter(([k, v]) => k !== 'DEBT' && (v as number) > 0).sort((a, b) => (b[1] as number) - (a[1] as number)) as [string, number][];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title="Tesorería" subtitle="Dónde está tu plata">
        <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-4 py-3">
          <p className="text-[12px] text-rose-100">Efectivo en las cajas abiertas</p>
          <p className="text-[28px] font-bold tabular-nums tracking-tight">{money(cash)}</p>
          <p className="text-[12px] text-rose-100">{data?.openSessions?.length || 0} cajas abiertas</p>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={() => setMoving('INCOME')} className="h-11 rounded-2xl bg-white text-rose-700 font-semibold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98]">
            <ArrowDownLeft className="w-4 h-4" /> Ingresar
          </button>
          <button onClick={() => setMoving('WITHDRAWAL')} className="h-11 rounded-2xl bg-orange-200 text-orange-900 font-semibold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98]">
            <ArrowUpRight className="w-4 h-4" /> Retirar
          </button>
        </div>
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
        {!data ? <ListSkeleton rows={4} /> : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => navigate('/clients')} className="bg-white rounded-2xl border border-slate-200/80 p-4 text-left active:scale-[0.98] transition-transform">
                <span className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center"><Users className="w-[18px] h-[18px] text-amber-700" /></span>
                <p className="text-[12px] text-slate-500 mt-2">Te deben</p>
                <p className="text-[18px] font-bold text-slate-900 tabular-nums">{money(receivable)}</p>
              </button>
              <button onClick={() => navigate('/suppliers')} className="bg-white rounded-2xl border border-slate-200/80 p-4 text-left active:scale-[0.98] transition-transform">
                <span className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center"><Truck className="w-[18px] h-[18px] text-violet-700" /></span>
                <p className="text-[12px] text-slate-500 mt-2">Debés a proveedores</p>
                <p className="text-[18px] font-bold text-slate-900 tabular-nums">{money(payable)}</p>
              </button>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
              <p className="text-[13px] font-semibold text-slate-800">Cobrado este mes</p>
              <p className="text-[12px] text-slate-500 mb-2">Cuánto entró por cada medio de pago</p>
              {methods.length === 0 ? (
                <p className="text-[13px] text-slate-500 py-3">Todavía no hay cobros este mes.</p>
              ) : methods.map(([k, v]) => {
                const Icon = k === 'CASH' ? Banknote : /MERCADO|MP|QR|TRANSFER/i.test(k) ? Smartphone : CreditCard;
                return (
                  <div key={k} className="flex items-center gap-3 py-2.5 border-b last:border-0 border-slate-100">
                    <span className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center shrink-0"><Icon className="w-[18px] h-[18px] text-slate-600" /></span>
                    <span className="flex-1 text-[14px] text-slate-700">{METHOD_LABELS[k] || k}</span>
                    <span className="text-[15px] font-semibold text-slate-900 tabular-nums">{money(v)}</span>
                  </div>
                );
              })}
            </div>

            {(data.openSessions || []).length > 0 && (
              <button onClick={() => navigate('/cash-control')} className="w-full bg-white rounded-2xl border border-slate-200/80 p-4 text-left flex items-center gap-3 active:scale-[0.99]">
                <span className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0"><Wallet className="w-[18px] h-[18px] text-rose-600" /></span>
                <span className="flex-1">
                  <span className="block text-[14px] font-semibold text-slate-800">Ver cajas</span>
                  <span className="block text-[12px] text-slate-500">{data.openSessions.map((s: any) => `${s.terminalName} ${money(s.expectedCash)}`).join(' · ')}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300" />
              </button>
            )}
          </>
        )}
      </div>

      <CashMoveSheet type={moving} sessions={data?.openSessions || []} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load(); }} />
    </div>
  );
}

function CashMoveSheet({ type, sessions, onClose, onDone }: { type: 'INCOME' | 'WITHDRAWAL' | null; sessions: any[]; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (type) { setAmount(''); setNote(''); setSessionId(sessions[0]?.id || ''); } }, [type]);

  const value = parseAmount(amount);
  const save = async () => {
    if (!sessionId || value <= 0) return;
    setBusy(true);
    try {
      const text = (note.trim() || (type === 'INCOME' ? 'Ingreso de efectivo' : 'Retiro a caja fuerte')).toUpperCase();
      await api.post(`/cash/${sessionId}/movement`, {
        type,
        amount: value,
        // Mismo formato que la PC, así se lee igual en los reportes
        description: type === 'WITHDRAWAL' ? `[Otro] ${text} | METODO: CASH` : text,
      });
      toast.success(type === 'INCOME' ? 'Ingreso registrado' : 'Retiro registrado');
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo registrar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!type}
      onClose={onClose}
      title={type === 'INCOME' ? 'Ingresar efectivo' : 'Retirar efectivo'}
      footer={sessions.length ? <PrimaryButton onClick={save} loading={busy} disabled={value <= 0 || !sessionId}>{type === 'INCOME' ? 'Ingresar' : 'Retirar'} {value > 0 ? money(value) : ''}</PrimaryButton> : undefined}
    >
      {sessions.length === 0 ? (
        <p className="text-[14px] text-slate-600 py-6 text-center">No hay cajas abiertas.</p>
      ) : (
        <div className="space-y-4 pt-1">
          <p className="text-[13px] text-slate-500">
            {type === 'INCOME' ? 'Plata que ponés en el cajón (cambio, aporte).' : 'Plata que sacás del cajón (a la caja fuerte, para el banco).'}
          </p>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo (opcional)" className="w-full h-11 px-3.5 rounded-2xl bg-slate-100 text-[14px] outline-none focus:bg-white focus:ring-2 focus:ring-rose-200" />
          {sessions.length > 1 && (
            <div className="space-y-2">
              {sessions.map((s) => (
                <button key={s.id} onClick={() => setSessionId(s.id)} className={`w-full flex items-center justify-between px-3.5 h-12 rounded-2xl border text-left ${sessionId === s.id ? 'border-rose-600 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                  <span className="text-[14px] font-medium text-slate-800">{s.terminalName}</span>
                  <span className="text-[12px] text-slate-500">{money(s.expectedCash)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
