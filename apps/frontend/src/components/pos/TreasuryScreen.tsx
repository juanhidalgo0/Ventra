import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Clock, Loader2, Receipt, Trash2, Truck, Wallet, X } from 'lucide-react';
import api from '../../services/api';
import { useConfirm } from '../common/ConfirmDialog';
import { PageHeader, Panel, StatCard, EmptyState, Segmented, ui } from '../ui/Page';

const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// Las mismas categorías que Gastos, para que allá se clasifiquen igual
const EXPENSE_CATEGORIES = ['Otro', 'Mercadería / Insumos', 'Servicios (Luz, Agua, etc)', 'Sueldos / Adelantos', 'Mantenimiento', 'Impuestos'];

type MoveKind = 'INCOME' | 'EXPENSE' | 'WITHDRAWAL';
const KIND_LABEL: Record<string, string> = { INCOME: 'Ingreso', EXPENSE: 'Gasto', WITHDRAWAL: 'Retiro' };

/** "[Otro] PAGO | METODO: CASH" → "PAGO" */
const cleanText = (desc?: string | null) => (desc || '').replace(/^\[.*?\]\s*/, '').replace(/\s*\|\s*METODO:\s*\S+\s*$/i, '').trim() || 'Sin detalle';

/**
 * Tesorería: el efectivo de las cajas abiertas y los ingresos y egresos cargados a mano.
 * Cada movimiento entra en una caja abierta, así el arqueo y el cierre lo tienen en cuenta.
 */
export default function TreasuryScreen() {
  const navigate = useNavigate();
  const [confirm, confirmDialog] = useConfirm();
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [movements, setMovements] = useState<any[] | null>(null);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [moving, setMoving] = useState<'INCOME' | 'OUT' | null>(null);

  const loadSessions = useCallback(() => {
    api.get('/cash/active').then(({ data }) => setSessions(data || [])).catch(() => setSessions([]));
  }, []);
  const loadMovements = useCallback(() => {
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);
    api.get('/cash/movements', { params: { from: month.toISOString(), to: to.toISOString() } })
      .then(({ data }) => setMovements(data || []))
      .catch(() => setMovements([]));
  }, [month]);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { setMovements(null); loadMovements(); }, [loadMovements]);

  const cash = (sessions || []).reduce((s, x) => s + (x.expectedAmount || 0), 0);
  const totals = useMemo(() => (movements || []).reduce((acc, m) => {
    if (m.type === 'INCOME') acc.income += m.amount; else acc.out += m.amount;
    return acc;
  }, { income: 0, out: 0 }), [movements]);

  const shiftMonth = (delta: number) => setMonth((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  const isCurrentMonth = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  const remove = async (m: any) => {
    const ok = await confirm({ title: '¿Eliminar este movimiento?', message: `${KIND_LABEL[m.type] || m.type} de ${money(m.amount)}. La caja vuelve a calcular su efectivo.`, confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/cash/movement/${m.id}`);
      toast.success('Movimiento eliminado');
      loadMovements();
      loadSessions();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo eliminar');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <PageHeader
          title="Tesorería"
          description="El efectivo de las cajas y los ingresos y egresos que se cargan a mano."
          actions={(
            <>
              <button onClick={() => setMoving('INCOME')} className={`${ui.btn} ${ui.btnPrimary}`}><ArrowDownLeft className="w-4 h-4" /> Registrar ingreso</button>
              <button onClick={() => setMoving('OUT')} className={`${ui.btn} ${ui.btnDark}`}><ArrowUpRight className="w-4 h-4" /> Registrar egreso</button>
            </>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Efectivo en cajas abiertas" value={sessions ? money(cash) : '…'} icon={Wallet} tone="brand" hint={`${sessions?.length || 0} ${sessions?.length === 1 ? 'caja abierta' : 'cajas abiertas'}`} />
          <StatCard label={`Ingresos de ${MONTHS[month.getMonth()]}`} value={money(totals.income)} icon={ArrowDownLeft} tone="success" valueTone="success" hint="Cargados a mano" />
          <StatCard label={`Egresos de ${MONTHS[month.getMonth()]}`} value={money(totals.out)} icon={ArrowUpRight} tone="danger" valueTone="danger" hint="Gastos y retiros" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          <Panel title="Cajas abiertas" icon={Wallet}>
            {!sessions ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
            ) : sessions.length === 0 ? (
              <EmptyState title="No hay cajas abiertas" description="Los movimientos se registran en una caja: abrí una desde el punto de venta." action={<button onClick={() => navigate('/pos')} className={`${ui.btn} ${ui.btnSecondary}`}>Ir a la caja</button>} className="py-5" />
            ) : (
              <div className="divide-y divide-slate-100">
                {sessions.map((s) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-slate-800 truncate">{s.terminalName}</p>
                      <p className="text-[12.5px] text-slate-500 truncate">{s.user?.fullName || s.user?.username} · desde las {new Date(s.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <p className="text-[15px] font-bold text-slate-900 tabular-nums shrink-0">{money(s.expectedAmount)}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button onClick={() => navigate('/gastos')} className={`${ui.btn} ${ui.btnSecondary}`}><Receipt className="w-4 h-4" /> Gastos</button>
              <button onClick={() => navigate('/suppliers')} className={`${ui.btn} ${ui.btnSecondary}`}><Truck className="w-4 h-4" /> Proveedores</button>
            </div>
          </Panel>

          <Panel
            className="lg:col-span-2"
            title="Movimientos del mes"
            icon={Clock}
            action={(
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => shiftMonth(-1)} aria-label="Mes anterior" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"><ChevronLeft className="w-4 h-4 text-slate-600" /></button>
                <span className="text-[13px] font-semibold text-slate-700 w-32 text-center capitalize">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
                <button onClick={() => shiftMonth(1)} disabled={isCurrentMonth} aria-label="Mes siguiente" className="w-8 h-8 rounded-lg hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center cursor-pointer"><ChevronRight className="w-4 h-4 text-slate-600" /></button>
              </div>
            )}
          >
            {!movements ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
            ) : movements.length === 0 ? (
              <EmptyState icon={Clock} title="Sin movimientos este mes" description="Los ingresos, gastos y retiros que se carguen aparecen acá." />
            ) : (
              <div className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <div key={m.id} className="py-2.5 flex items-center gap-3">
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${m.type === 'INCOME' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                      {m.type === 'INCOME' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-slate-800 truncate">{cleanText(m.description)}</p>
                      <p className="text-[12.5px] text-slate-500 truncate">
                        {KIND_LABEL[m.type] || m.type} · {new Date(m.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {m.session?.terminalName} · {m.user?.fullName || m.user?.username}
                      </p>
                    </div>
                    <p className={`text-[15px] font-bold tabular-nums shrink-0 ${m.type === 'INCOME' ? 'text-emerald-700' : 'text-red-600'}`}>{m.type === 'INCOME' ? '+' : '−'} {money(m.amount)}</p>
                    <button onClick={() => remove(m)} aria-label="Eliminar movimiento" className="w-8 h-8 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center shrink-0 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {confirmDialog}
      {moving && (
        <MoveModal
          direction={moving}
          sessions={sessions || []}
          onClose={() => setMoving(null)}
          onDone={() => { setMoving(null); loadMovements(); loadSessions(); }}
        />
      )}
    </div>
  );
}

function MoveModal({ direction, sessions, onClose, onDone }: { direction: 'INCOME' | 'OUT'; sessions: any[]; onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<MoveKind>(direction === 'INCOME' ? 'INCOME' : 'EXPENSE');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('Otro');
  const [sessionId, setSessionId] = useState(sessions[0]?.id || '');
  const [busy, setBusy] = useState(false);

  const value = Number(amount.replace(/\./g, '').replace(',', '.'));
  const save = async () => {
    if (!(value > 0)) { toast.error('Ingresá un monto válido'); return; }
    if (!reason.trim()) { toast.error('Escribí el motivo'); return; }
    setBusy(true);
    try {
      const text = reason.trim().toUpperCase();
      // Mismo formato que la caja y el celular, así se lee igual en Gastos y en los cierres
      const description = kind === 'INCOME' ? text : `[${kind === 'EXPENSE' ? category : 'Otro'}] ${text} | METODO: CASH`;
      await api.post(`/cash/${sessionId}/movement`, { type: kind, amount: value, description });
      toast.success(`${KIND_LABEL[kind]} registrado`);
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo registrar');
    } finally {
      setBusy(false);
    }
  };

  const label = 'block text-[12.5px] font-semibold text-slate-600 mb-1';
  const field = `${ui.field} w-full h-10`;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); save(); }}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-slate-900">{direction === 'INCOME' ? 'Registrar ingreso' : 'Registrar egreso'}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        {sessions.length === 0 ? (
          <EmptyState icon={Wallet} title="No hay cajas abiertas" description="Abrí una caja desde el punto de venta para poder registrar movimientos." action={<button type="button" onClick={() => navigate('/pos')} className={`${ui.btn} ${ui.btnPrimary}`}>Ir a la caja</button>} className="py-4" />
        ) : (
          <>
            {direction === 'OUT' && (
              <div>
                <Segmented<MoveKind> options={[{ id: 'EXPENSE', label: 'Gasto del negocio' }, { id: 'WITHDRAWAL', label: 'Retiro de efectivo' }]} value={kind} onChange={setKind} />
                <p className="text-[12.5px] text-slate-500 mt-1.5">
                  {kind === 'EXPENSE' ? 'Se paga algo del negocio: aparece en Gastos y baja la ganancia.' : 'La plata sale del cajón pero no es un gasto: a la caja fuerte, al banco o un socio que retira.'}
                </p>
              </div>
            )}
            <div>
              <label className={label}>Monto en efectivo</label>
              <input className={field} inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            {kind === 'EXPENSE' && (
              <div>
                <label className={label}>Categoría</label>
                <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={label}>Motivo</label>
              <input className={field} placeholder={direction === 'INCOME' ? 'Ej.: cambio para la caja' : 'Ej.: pago de luz'} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {sessions.length > 1 && (
              <div>
                <label className={label}>Caja</label>
                <select className={field} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                  {sessions.map((s) => <option key={s.id} value={s.id}>{s.terminalName} · {money(s.expectedAmount)}</option>)}
                </select>
              </div>
            )}
            <button type="submit" disabled={busy} className={`${ui.btn} ${ui.btnPrimary} w-full h-11`}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Registrar {value > 0 ? money(value) : ''}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
