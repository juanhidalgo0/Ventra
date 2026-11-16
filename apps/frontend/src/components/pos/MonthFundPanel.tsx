import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Landmark, Loader2, Scale, Store, Truck, X } from 'lucide-react';
import api from '../../services/api';
import { Panel, ui } from '../ui/Page';

export const MONTH_FUND_ID = 'caja-del-mes';

const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Entradas que son pase de plata entre cajas (no ingresos del negocio) y el ajuste del balance. */
export const isFundTransfer = (m: any) => /^\[(z|reparto|balance):/.test(m?.description || '');

/** "[z:…] Efectivo del Cierre Z…" → "Efectivo del Cierre Z…"; el balance, legible. */
export const fundText = (m: any) => {
  const d: string = m?.description || '';
  if (d.startsWith('[balance:')) {
    const c = /contado=(-?[\d.]+)/.exec(d)?.[1];
    const e = /esperado=(-?[\d.]+)/.exec(d)?.[1];
    return c != null && e != null ? `Balance del mes: contado ${money(Number(c))}, esperado ${money(Number(e))}` : 'Balance del mes';
  }
  return d.replace(/^\[[^\]]*\]\s*/, '').replace(/\s*\|\s*METODO:\s*\S+\s*$/i, '').trim() || 'Sin detalle';
};

/**
 * Caja del mes en Tesorería: cuánto hay guardado, de dónde entró (mostrador y repartos) y qué salió.
 * A fin de mes se cuenta la plata y se hace el balance: la diferencia queda anotada y sigue el mes siguiente.
 */
export default function MonthFundPanel({ month, refreshKey, onChanged }: { month: Date; refreshKey: number; onChanged: () => void }) {
  const [fund, setFund] = useState<any | null>(null);
  const [balancing, setBalancing] = useState(false);
  const key = monthKey(month);

  const load = useCallback(() => {
    api.get('/cash/fund', { params: { month: key } }).then(({ data }) => setFund(data)).catch(() => setFund(false));
  }, [key]);
  useEffect(() => { setFund(null); load(); }, [load, refreshKey]);

  if (fund === false) return null;
  const t = fund?.totals || {};
  const income = (t.fromZ || 0) + (t.fromReparto || 0) + (t.fromCollections || 0) + (t.otherIncome || 0);
  const out = (t.expenses || 0) + (t.withdrawals || 0);
  const now = new Date();
  const isPast = month < new Date(now.getFullYear(), now.getMonth(), 1);
  const row = (icon: React.ReactNode, label: string, value: number, sign: '+' | '−' | '', tone = 'text-slate-900') => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-2 text-[13.5px] text-slate-600 min-w-0">{icon}<span className="truncate">{label}</span></span>
      <span className={`text-[14px] font-semibold tabular-nums shrink-0 ${tone}`}>{sign} {money(value)}</span>
    </div>
  );

  return (
    <Panel
      title={`Caja del mes · ${MONTHS[month.getMonth()]} ${month.getFullYear()}`}
      icon={Landmark}
      action={fund && !fund.closed ? (
        <button onClick={() => setBalancing(true)} className={`${ui.btn} ${ui.btnSecondary} h-9`}><Scale className="w-4 h-4" /> Hacer el balance</button>
      ) : null}
    >
      {!fund ? (
        <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 text-slate-400 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <div>
            <p className="text-[12.5px] font-semibold text-slate-500">{isPast ? `Quedó al cierre de ${MONTHS[month.getMonth()]}` : 'Hay guardado ahora'}</p>
            <p className="text-[34px] font-black text-slate-900 tabular-nums leading-tight">{money(isPast ? fund.closing : fund.balance)}</p>
            <p className="text-[12.5px] text-slate-500 mt-1">
              Arrancó el mes con {money(fund.opening)} · entró {money(income)} · salió {money(out)}
            </p>
            {fund.closed ? (
              <p className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold ${Math.abs(fund.closed.difference) < 0.01 ? 'bg-emerald-50 text-emerald-800' : fund.closed.difference < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                <CheckCircle2 className="w-4 h-4" />
                Balance hecho{fund.closed.by ? ` por ${fund.closed.by}` : ''}: {Math.abs(fund.closed.difference) < 0.01 ? 'dio justo' : fund.closed.difference < 0 ? `faltaron ${money(-fund.closed.difference)}` : `sobraron ${money(fund.closed.difference)}`}
              </p>
            ) : (
              <p className="mt-3 text-[12.5px] text-slate-500">Al terminar el mes, contá la plata guardada y tocá <b>Hacer el balance</b>.</p>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {row(<Store className="w-4 h-4 text-slate-400" />, 'Del mostrador (Cierres Z)', t.fromZ || 0, '+', 'text-emerald-700')}
            {row(<Truck className="w-4 h-4 text-slate-400" />, 'De los repartos (lo que trae el chofer)', t.fromReparto || 0, '+', 'text-emerald-700')}
            {(t.fromCollections || 0) > 0 && row(<span className='w-4' />, 'Cobros de cuentas corrientes', t.fromCollections, '+', 'text-emerald-700')}
            {(t.otherIncome || 0) > 0 && row(<span className="w-4" />, 'Otros ingresos', t.otherIncome, '+', 'text-emerald-700')}
            {row(<span className="w-4" />, 'Gastos pagados de acá', t.expenses || 0, '−', 'text-red-600')}
            {row(<span className="w-4" />, 'Retiros', t.withdrawals || 0, '−', 'text-red-600')}
            {Math.abs(t.adjustments || 0) >= 0.01 && row(<span className="w-4" />, 'Diferencia del balance', Math.abs(t.adjustments), t.adjustments > 0 ? '+' : '−', t.adjustments > 0 ? 'text-amber-700' : 'text-red-600')}
          </div>
        </div>
      )}
      {balancing && fund && (
        <BalanceModal
          monthLabel={`${MONTHS[month.getMonth()]} ${month.getFullYear()}`}
          monthKey={key}
          expected={fund.closing}
          onClose={() => setBalancing(false)}
          onDone={() => { setBalancing(false); load(); onChanged(); }}
        />
      )}
    </Panel>
  );
}

function BalanceModal({ monthLabel, monthKey: key, expected, onClose, onDone }: { monthLabel: string; monthKey: string; expected: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const value = Number(amount.replace(/\./g, '').replace(',', '.'));
  const has = amount.trim() !== '' && Number.isFinite(value) && value >= 0;
  const diff = has ? Math.round((value - expected) * 100) / 100 : 0;

  const save = async () => {
    if (!has) { toast.error('Ingresá cuánto contaste'); return; }
    setBusy(true);
    try {
      await api.post('/cash/fund/close-month', { month: key, counted: value, notes });
      toast.success(`Balance de ${monthLabel} guardado`);
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el balance');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(); }} className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-bold text-slate-900">Balance de {monthLabel}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-[12.5px] font-semibold text-slate-500">Según el sistema tendría que haber</p>
          <p className="text-[24px] font-black text-slate-900 tabular-nums">{money(expected)}</p>
        </div>
        <div>
          <label className="block text-[12.5px] font-semibold text-slate-600 mb-1">¿Cuánto contaste?</label>
          <input className={`${ui.field} w-full h-10`} inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {has && (
            <p className={`text-[13px] font-semibold mt-1.5 ${Math.abs(diff) < 0.01 ? 'text-emerald-700' : diff < 0 ? 'text-red-600' : 'text-amber-700'}`}>
              {Math.abs(diff) < 0.01 ? 'Da justo' : diff < 0 ? `Faltan ${money(-diff)}` : `Sobran ${money(diff)}`}
            </p>
          )}
        </div>
        <div>
          <label className="block text-[12.5px] font-semibold text-slate-600 mb-1">Nota (opcional)</label>
          <input className={`${ui.field} w-full h-10`} placeholder="Ej.: faltan $500 de un vuelto" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <p className="text-[12.5px] text-slate-500">La diferencia queda anotada y el mes siguiente arranca con lo que contaste.</p>
        <button type="submit" disabled={busy} className={`${ui.btn} ${ui.btnPrimary} w-full h-11`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Guardar el balance
        </button>
      </form>
    </div>
  );
}
