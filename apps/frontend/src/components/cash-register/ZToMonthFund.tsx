import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Landmark, Loader2 } from 'lucide-react';
import api from '../../services/api';

const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
const parse = (v: string) => Number(v.replace(/\./g, '').replace(',', '.'));

/**
 * Después del Cierre Z: el efectivo contado de todos los turnos, menos el cambio que queda en el
 * cajón, pasa a la caja del mes. Se puede hacer una sola vez por Z (el servidor no lo repite).
 */
export default function ZToMonthFund({ zReport }: { zReport: any }) {
  const sessions: any[] = zReport?.sessions || [];
  const counted = sessions.reduce((s, x) => s + (Number(x.closingAmountCounted) || 0), 0);
  const float = sessions.reduce((s, x) => s + (Number(x.openingAmount) || 0), 0);
  const [keep, setKeep] = useState(String(Math.round(Math.min(float, counted))));
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const keepValue = Number.isFinite(parse(keep)) ? Math.max(0, parse(keep)) : 0;
  const amount = Math.round(Math.max(0, counted - keepValue) * 100) / 100;

  const send = async () => {
    if (!(amount > 0)) { toast.error('No queda efectivo para pasar'); return; }
    setBusy(true);
    try {
      await api.post('/cash/fund/from-z', { zReportId: zReport.id, amount });
      setDone(amount);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo pasar a la caja del mes');
    } finally {
      setBusy(false);
    }
  };

  if (done != null) {
    return (
      <div className="w-full mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2 text-left">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
        <p className="text-[13.5px] font-semibold text-emerald-800">{money(done)} pasaron a la caja del mes. Lo ves en Tesorería.</p>
      </div>
    );
  }
  if (!(counted > 0)) return null;
  return (
    <div className="w-full mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left space-y-2">
      <p className="flex items-center gap-2 text-[14px] font-bold text-slate-800"><Landmark className="w-4 h-4 text-slate-500" /> Pasar a la caja del mes</p>
      <div className="flex items-center justify-between text-[13px] text-slate-600">
        <span>Efectivo contado en el cierre</span><span className="font-semibold tabular-nums">{money(counted)}</span>
      </div>
      <label className="flex items-center justify-between gap-3 text-[13px] text-slate-600">
        <span>Queda en el cajón para el cambio</span>
        <input className="w-32 h-9 rounded-lg border border-slate-300 bg-white px-2 text-right text-[14px] font-semibold tabular-nums" inputMode="decimal" value={keep} onChange={(e) => setKeep(e.target.value)} />
      </label>
      <button onClick={send} disabled={busy || !(amount > 0)} className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Pasar {money(amount)} a la caja del mes
      </button>
    </div>
  );
}
