import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Minus, Plus, RefreshCw, Trash2, Users2 } from 'lucide-react';
import api from '../../services/api';
import { setStoreSetting } from '../../services/storeSettings';
import { PageHeader, Panel, Segmented, ui } from '../ui/Page';

interface ProfitSplit {
  revenue: number;
  cost: number;
  expenses: number;
  goodsPayments: number;
  profit: number;
  salesCount: number;
  noCostRevenue: number;
  noCostProducts: number;
}
interface Partner { name: string; percentage: number }
type Period = 'month' | 'lastMonth' | 'custom';

const MAX_PARTNERS = 20;
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Partes iguales que suman justo 100: el último socio se lleva los centésimos que sobran. */
const equalShares = (count: number) => {
  const base = Math.floor((100 / count) * 100) / 100;
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? round2(100 - base * (count - 1)) : base));
};

const readPartners = (): Partner[] => {
  try {
    const saved = JSON.parse(localStorage.getItem('earnings_division_partners') || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* config corrupta: los valores de siempre */ }
  return [{ name: 'Socio 1', percentage: 50 }, { name: 'Socio 2', percentage: 50 }];
};

const dayInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * División de ganancias: cuánto le toca a cada socio de lo que ganó el negocio en el período.
 * Los socios y sus porcentajes son del comercio: viajan a las otras cajas.
 */
export default function EarningsDivisionScreen() {
  const [period, setPeriod] = useState<Period>('month');
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); return dayInput(new Date(d.getFullYear(), d.getMonth(), 1)); });
  const [toDate, setToDate] = useState(() => dayInput(new Date()));
  const [data, setData] = useState<ProfitSplit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [partners, setPartners] = useState<Partner[]>(readPartners);

  // Se guarda cuando se cambian los socios, no al abrir (los valores por defecto pisaban los de otra caja)
  const partnersTouched = useRef(false);
  useEffect(() => {
    if (partnersTouched.current) setStoreSetting('earnings_division_partners', JSON.stringify(partners));
    partnersTouched.current = true;
  }, [partners]);

  const range = useMemo(() => {
    const now = new Date();
    if (period === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    if (period === 'lastMonth') return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999) };
    if (!fromDate || !toDate) return null;
    return { from: new Date(`${fromDate}T00:00:00`), to: new Date(`${toDate}T23:59:59.999`) };
  }, [period, fromDate, toDate]);

  const load = () => {
    if (!range) return;
    setLoading(true);
    setError(false);
    api.get('/sales/profit-split', { params: { from: range.from.toISOString(), to: range.to.toISOString() } })
      .then(({ data }) => setData(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(load, [range]);

  const setCount = (count: number) => {
    const next = Math.max(1, Math.min(MAX_PARTNERS, count));
    setPartners((prev) => {
      if (next === prev.length) return prev;
      if (next < prev.length) return prev.slice(0, next);
      return [...prev, ...Array.from({ length: next - prev.length }, (_, i) => ({ name: `Socio ${prev.length + i + 1}`, percentage: 0 }))];
    });
  };
  const update = (i: number, patch: Partial<Partner>) => setPartners((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const shareEqually = () => {
    const shares = equalShares(partners.length);
    setPartners((prev) => prev.map((p, i) => ({ ...p, percentage: shares[i] })));
  };

  const sum = round2(partners.reduce((s, p) => s + (p.percentage || 0), 0));
  const valid = Math.abs(sum - 100) < 0.01;
  // A pérdida no se reparte nada: cada socio queda en cero y se avisa arriba
  const toShare = Math.max(0, data?.profit || 0);

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <PageHeader
          title="División de ganancias"
          description="Cuánto le corresponde a cada socio de lo que ganó el negocio."
          actions={<button onClick={load} disabled={loading} className={`${ui.btn} ${ui.btnSecondary}`}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar</button>}
        />

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Segmented<Period> options={[{ id: 'month', label: 'Este mes' }, { id: 'lastMonth', label: 'Mes pasado' }, { id: 'custom', label: 'Elegir fechas' }]} value={period} onChange={setPeriod} />
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" aria-label="Desde" className={ui.field} value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
              <span className="text-[13px] text-slate-500">al</span>
              <input type="date" aria-label="Hasta" className={ui.field} value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">No se pudo calcular la ganancia. Probá de nuevo con Actualizar.</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
          <Panel className="lg:col-span-2" title="Ganancia del período">
            {!data ? (
              <p className="py-6 text-center text-[13px] text-slate-500">{loading ? 'Calculando…' : 'Sin datos'}</p>
            ) : (
              <div className="space-y-2 text-[14px]">
                <Row label={`Ventas (${data.salesCount})`} value={money(data.revenue)} />
                <Row label="Costo de lo vendido" value={`− ${money(data.cost)}`} />
                <Row label="Gastos del negocio" value={`− ${money(data.expenses)}`} />
                <div className="flex items-baseline justify-between gap-3 pt-2.5 border-t border-slate-200">
                  <span className="font-semibold text-slate-900">{data.profit < 0 ? 'Pérdida' : 'Ganancia a repartir'}</span>
                  <span className={`text-[22px] font-bold tabular-nums tracking-tight ${data.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(data.profit)}</span>
                </div>
                <p className="text-[12.5px] text-slate-500 leading-relaxed pt-1">
                  Incluye lo vendido fiado y usa el costo actual de cada producto.
                  {data.goodsPayments > 0 && ` Los ${money(data.goodsPayments)} pagados en mercadería no se restan como gasto porque ya están en el costo.`}
                </p>
                {data.noCostProducts > 0 && (
                  <p className="flex gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] font-medium text-amber-800 leading-relaxed">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{money(data.noCostRevenue)} en ventas de {data.noCostProducts} {data.noCostProducts === 1 ? 'producto' : 'productos'} sin costo cargado: la ganancia real es menor. Cargá los costos antes de repartir.</span>
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel
            className="lg:col-span-3"
            title="Socios"
            icon={Users2}
            action={<button onClick={shareEqually} className={`${ui.btn} ${ui.btnSecondary}`}>Partes iguales</button>}
          >
            <div className="flex items-center justify-between gap-3 pb-3">
              <span className="text-[13px] font-medium text-slate-600">Cantidad de socios</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setCount(partners.length - 1)} disabled={partners.length <= 1} aria-label="Un socio menos" className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center cursor-pointer"><Minus className="w-4 h-4 text-slate-600" /></button>
                <span className="w-9 text-center text-[15px] font-bold text-slate-900 tabular-nums">{partners.length}</span>
                <button onClick={() => setCount(partners.length + 1)} disabled={partners.length >= MAX_PARTNERS} aria-label="Un socio más" className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center cursor-pointer"><Plus className="w-4 h-4 text-slate-600" /></button>
              </div>
            </div>

            <div className="space-y-2">
              {partners.map((p, i) => (
                <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-xl border border-slate-200 p-2">
                  <input
                    aria-label={`Nombre del socio ${i + 1}`}
                    className={`${ui.field} flex-1 min-w-[140px]`}
                    value={p.name}
                    placeholder={`Socio ${i + 1}`}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                  <div className="relative w-24 shrink-0">
                    <input
                      aria-label={`Porcentaje de ${p.name || `socio ${i + 1}`}`}
                      type="number" min="0" max="100" step="any"
                      className={`${ui.field} w-full pr-6 text-right`}
                      placeholder="0"
                      value={p.percentage || ''}
                      onChange={(e) => update(i, { percentage: Math.max(0, parseFloat(e.target.value) || 0) })}
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-slate-400 pointer-events-none">%</span>
                  </div>
                  <p className="flex-1 sm:flex-none sm:w-32 text-right text-[16px] font-bold text-slate-900 tabular-nums">{money(toShare * ((p.percentage || 0) / 100))}</p>
                  {partners.length > 1 && (
                    <button onClick={() => setPartners((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar a ${p.name || `socio ${i + 1}`}`} className="w-8 h-8 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center shrink-0 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
            </div>

            <p className={`mt-3 rounded-xl px-3 py-2 text-[13px] font-medium ${valid ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {valid ? 'Los porcentajes suman 100%.' : sum < 100 ? `Suman ${sum}%: falta repartir ${round2(100 - sum)}%.` : `Suman ${sum}%: sobran ${round2(sum - 100)}%.`}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-900 tabular-nums">{value}</span>
    </div>
  );
}
