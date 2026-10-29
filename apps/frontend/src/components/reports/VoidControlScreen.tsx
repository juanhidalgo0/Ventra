import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldAlert, Loader2, ChevronDown, Settings2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import api from '../../services/api';
import { money } from '../mobile/ui';

/**
 * Control de anulaciones: lo que los cajeros sacan del ticket (y lo que se borra del catálogo),
 * con un puntaje de sospecha y sus motivos. Solo lo ve el dueño; los cajeros no se enteran.
 * Ver pos-trail (backend) y services/posTrail (registro en la caja).
 */
type Level = 'normal' | 'revisar' | 'sospechoso';
interface VoidItem { productId: string; name: string; quantity: number; price: number; secondsInCart: number | null }
interface VoidEvent {
  id: string; action: string; at: string; terminal: string | null; userId: string | null; userName: string;
  items: VoidItem[]; amount: number; totalBefore: number; totalAfter: number; totalShown: boolean; secondsSinceTotal: number | null;
  count: number | null; heldSince: string | null; heldName: string | null;
  nextSale: { saleNumber: number; at: string; total: number } | null;
  score: number; level: Level; reasons: string[]; pending: boolean;
}
interface Cashier { userId: string; userName: string; sales: number; voids: number; amount: number; suspicious: number; review: number; per100: number | null; flagged: boolean }
interface Report { bigAmount: number; totals: { count: number; amount: number; suspicious: number; review: number }; cashiers: Cashier[]; events: VoidEvent[] }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
const RANGES = [
  { id: 'today', label: 'Hoy', from: () => daysAgo(0) },
  { id: '7', label: '7 días', from: () => daysAgo(6) },
  { id: '30', label: '30 días', from: () => daysAgo(29) },
];
const LEVELS = [
  { id: 'alertas', label: 'Para revisar' },
  { id: 'sospechoso', label: 'Sospechosas' },
  { id: 'all', label: 'Todas' },
];
const ACTION_LABEL: Record<string, string> = {
  ITEM_REMOVED: 'Quitó del ticket',
  QTY_REDUCED: 'Bajó la cantidad',
  CART_CLEARED: 'Vació el ticket',
  HELD_CART_DELETED: 'Borró un ticket en espera',
  PRODUCT_DELETED: 'Borró un producto del catálogo',
  PRODUCTS_BULK_DELETED: 'Borró productos del catálogo',
};
const LEVEL_STYLE: Record<Level, { strip: string; chip: string; label: string }> = {
  sospechoso: { strip: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200', label: 'Sospechoso' },
  revisar: { strip: 'bg-amber-400', chip: 'bg-amber-50 text-amber-800 border-amber-200', label: 'Revisar' },
  normal: { strip: 'bg-slate-200', chip: 'bg-slate-50 text-slate-600 border-slate-200', label: 'Normal' },
};
const time = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const when = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('es-AR');

/** Línea de tiempo de una quita: escaneo → total → quita → lo que pasó después */
function Timeline({ e }: { e: VoidEvent }) {
  const at = new Date(e.at).getTime();
  const steps: { at: number; text: string; tone?: 'bad' | 'good' }[] = [];
  const scans = e.items.map((i) => i.secondsInCart).filter((s): s is number => s != null);
  if (scans.length) steps.push({ at: at - Math.max(...scans) * 1000, text: e.items.length > 1 ? 'Escaneó los productos' : `Escaneó ${e.items[0].name}` });
  if (e.heldSince) steps.push({ at: new Date(e.heldSince).getTime(), text: `Dejó el ticket en espera${e.heldName ? ` (${e.heldName})` : ''}` });
  if (e.totalShown && e.secondsSinceTotal != null) steps.push({ at: at - e.secondsSinceTotal * 1000, text: `Abrió el cobro por ${money(e.totalBefore)}`, tone: 'bad' });
  steps.push({ at, text: `${ACTION_LABEL[e.action] || e.action}: ${money(e.amount)}${e.totalAfter > 0 ? ` · el ticket quedó en ${money(e.totalAfter)}` : ''}`, tone: 'bad' });
  if (e.nextSale) steps.push({ at: new Date(e.nextSale.at).getTime(), text: `Siguiente venta: #${e.nextSale.saleNumber} por ${money(e.nextSale.total)}`, tone: 'good' });
  else if (!e.action.startsWith('PRODUCT')) steps.push({ at: at + 180000, text: e.pending ? 'Esperando los 3 minutos siguientes…' : 'Ninguna venta en esa caja en los 3 minutos siguientes', tone: e.pending ? undefined : 'bad' });
  steps.sort((a, b) => a.at - b.at);
  return (
    <ol className="relative border-l-2 border-slate-200 ml-1.5 space-y-2.5">
      {steps.map((s, i) => (
        <li key={i} className="pl-4 relative">
          <span className={`absolute -left-[7px] top-1 w-3 h-3 rounded-full border-2 border-white ${s.tone === 'bad' ? 'bg-red-500' : s.tone === 'good' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          <p className="text-[12px] font-mono text-slate-500">{time(new Date(s.at).toISOString())}</p>
          <p className="text-[13.5px] text-slate-800">{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

export default function VoidControlScreen() {
  const [range, setRange] = useState('7');
  const [level, setLevel] = useState('alertas');
  const [userId, setUserId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bigAmount, setBigAmount] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const from = RANGES.find((r) => r.id === range)!.from();
      const { data } = await api.get('/pos-trail', { params: { from, to: daysAgo(0), level, ...(userId ? { userId } : {}) } });
      setReport(data);
      setBigAmount((v) => v || String(data.bigAmount));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cargar el control de anulaciones');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [range, level, userId]);

  const saveBig = async () => {
    try {
      await api.post('/pos-trail/settings', { bigAmount: Number(bigAmount.replace(/\D/g, '')) });
      toast.success('Listo: se usa para el puntaje desde ahora');
      setShowSettings(false);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    }
  };

  const cashiers = report?.cashiers || [];
  const flagged = useMemo(() => cashiers.filter((c) => c.flagged), [cashiers]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl w-full mx-auto space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-red-600" /> Control de anulaciones</h1>
          <p className="text-[13px] text-slate-500">Lo que se saca de los tickets y se borra del catálogo. Solo lo ves vos: en la caja no aparece nada.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
            {RANGES.map((r) => (
              <button key={r.id} onClick={() => setRange(r.id)} className={`px-3 h-8 rounded-lg text-[13px] font-semibold ${range === r.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{r.label}</button>
            ))}
          </div>
          <button onClick={() => setShowSettings((v) => !v)} className="w-10 h-10 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center" title="Ajustes" aria-label="Ajustes"><Settings2 className="w-4 h-4 text-slate-600" /></button>
        </div>
      </div>

      {showSettings && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px]">
            <span className="block text-[12px] font-semibold text-slate-600 mb-1">Desde qué monto quitado se considera grande</span>
            <input value={bigAmount} onChange={(e) => setBigAmount(e.target.value)} inputMode="numeric" className="w-full h-10 px-3 rounded-xl border border-slate-200 text-[14px] tabular-nums" />
          </label>
          <button onClick={saveBig} className="h-10 px-4 rounded-xl bg-slate-900 text-white text-[13px] font-semibold">Guardar</button>
          <p className="w-full text-[12px] text-slate-500">Los avisos al celular (solo de lo sospechoso) se prenden y apagan en Notificaciones del celular. Lo que es para revisar va en el resumen del día por WhatsApp.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Sospechosas', value: report?.totals.suspicious || 0, cls: 'text-red-600' },
          { label: 'Para revisar', value: report?.totals.review || 0, cls: 'text-amber-600' },
          { label: 'Anulaciones', value: report?.totals.count || 0, cls: 'text-slate-900' },
          { label: 'Quitado de tickets', value: money(report?.totals.amount || 0), cls: 'text-slate-900' },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-2xl p-4">
            <p className="text-[12px] font-semibold text-slate-500">{c.label}</p>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {flagged.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-[13.5px] text-red-800">
            <b>{flagged.map((c) => c.userName).join(', ')}</b> {flagged.length === 1 ? 'quita' : 'quitan'} del ticket el doble (o más) que el resto cada 100 ventas.
          </p>
        </div>
      )}

      {cashiers.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <p className="px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Por cajero</p>
          <div className="divide-y divide-slate-100">
            {cashiers.map((c) => (
              <button key={c.userId} onClick={() => setUserId(userId === c.userId ? '' : c.userId)} className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 ${userId === c.userId ? 'bg-slate-50' : ''}`}>
                <div className={`w-9 h-9 rounded-full font-bold flex items-center justify-center shrink-0 ${c.flagged || c.suspicious ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{(c.userName || '?').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-slate-900 truncate">{c.userName}{userId === c.userId && <span className="ml-2 text-[11px] font-semibold text-slate-500">(filtrando)</span>}</p>
                  <p className="text-[12.5px] text-slate-500">{c.voids} {c.voids === 1 ? 'anulación' : 'anulaciones'} en {c.sales} ventas{c.per100 != null ? ` · ${c.per100} cada 100` : ''}</p>
                </div>
                {c.suspicious > 0 && <span className="text-[12px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200">{c.suspicious} sosp.</span>}
                {c.review > 0 && <span className="text-[12px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-200">{c.review} rev.</span>}
                <span className="text-[14px] font-bold text-slate-900 tabular-nums w-24 text-right">{money(c.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {LEVELS.map((l) => (
          <button key={l.id} onClick={() => setLevel(l.id)} className={`px-3 h-8 rounded-lg text-[13px] font-semibold ${level === l.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{l.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : !report?.events.length ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-12 text-center text-[14px] text-slate-500 flex flex-col items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          {level === 'all' ? 'No se quitó nada de los tickets en estos días.' : 'Nada para revisar en estos días.'}
        </div>
      ) : (
        <div className="space-y-2">
          {report.events.map((e) => {
            const st = LEVEL_STYLE[e.level];
            return (
              <div key={e.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex">
                <div className={`w-1.5 shrink-0 ${st.strip}`} />
                <div className="flex-1 min-w-0">
                  <button onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full flex items-start gap-3 p-3.5 text-left hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${st.chip}`}>{st.label}</span>
                        {e.pending && <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> provisorio</span>}
                        <span className="text-[14px] font-bold text-slate-900">{ACTION_LABEL[e.action] || e.action}</span>
                        <span className="text-[13px] text-slate-500">· {e.userName}{e.terminal ? ` · ${e.terminal}` : ''}</span>
                      </div>
                      <p className="text-[12.5px] text-slate-600 truncate mt-0.5">
                        {e.count && e.count > 1 ? `${e.count} productos: ` : ''}{e.items.slice(0, 4).map((i) => `${qty(i.quantity)} × ${i.name}`).join(', ')}{e.items.length > 4 ? ` y ${e.items.length - 4} más` : ''}
                      </p>
                      {e.reasons.length > 0 && <p className="text-[12.5px] text-slate-500 mt-0.5">{e.reasons.join(' · ')}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[15px] font-bold text-slate-900 tabular-nums">{money(e.amount)}</p>
                      <p className="text-[12px] text-slate-500">{when(e.at)}</p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 mt-1 transition-transform ${open === e.id ? 'rotate-180' : ''}`} />
                  </button>
                  {open === e.id && (
                    <div className="border-t border-slate-100 p-4 grid sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Qué pasó</p>
                        <Timeline e={e} />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{e.action.startsWith('PRODUCT') ? 'Productos borrados' : 'Lo que se quitó'}</p>
                        <div className="space-y-1">
                          {e.items.map((i, k) => (
                            <div key={k} className="flex justify-between gap-3 text-[13.5px]">
                              <span className="text-slate-700 truncate">{qty(i.quantity)} × {i.name}{e.action.startsWith('PRODUCT') ? ' (stock)' : ''}</span>
                              <span className="text-slate-500 tabular-nums shrink-0">{money(i.price * i.quantity)}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[12px] text-slate-400 mt-3">Puntaje {e.score}. Sospechoso desde 60, revisar desde 30.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
