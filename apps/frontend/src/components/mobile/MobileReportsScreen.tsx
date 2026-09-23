import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { TrendingUp, Package, Users } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, Chips, ListSkeleton, money, qty, METHOD_LABELS } from './ui';

type Range = 'WEEK' | 'MONTH' | 'LAST_MONTH' | 'YEAR';

function rangeDates(r: Range) {
  const now = new Date();
  const from = new Date(now);
  let to = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (r === 'WEEK') from.setDate(from.getDate() - 6);
  if (r === 'MONTH') from.setDate(1);
  if (r === 'LAST_MONTH') { from.setMonth(from.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); }
  if (r === 'YEAR') from.setMonth(0, 1);
  return { from, to };
}

const PAY_COLORS = ['#0E6E52', '#93AE25', '#34AC7E', '#D9A70F', '#9EDDC3', '#58691A'];

/** Reportes en el celular: cuánto vendiste y ganaste en el período, qué se vende y quién compra. */
export default function MobileReportsScreen() {
  const [range, setRange] = useState<Range>('MONTH');
  const [summary, setSummary] = useState<any | null>(null);
  const [dash, setDash] = useState<any | null>(null);

  useEffect(() => {
    setSummary(null); setDash(null);
    const { from, to } = rangeDates(range);
    const params = { from: from.toISOString(), to: to.toISOString() };
    Promise.all([api.get('/sales/today-summary', { params }), api.get('/sales/dashboard', { params })])
      .then(([s, d]) => { setSummary(s.data || {}); setDash(d.data || {}); })
      .catch(() => { setSummary({}); setDash({}); toast.error('No pudimos armar el reporte'); });
  }, [range]);

  const chart = useMemo(() => {
    const hist: any[] = dash?.history || [];
    if (range !== 'YEAR') {
      return hist.map((h) => ({ label: new Date(h.date + 'T12:00:00').getDate().toString(), sales: h.sales, profit: h.profit }));
    }
    const byMonth: Record<number, { sales: number; profit: number }> = {};
    for (const h of hist) {
      const m = new Date(h.date + 'T12:00:00').getMonth();
      byMonth[m] = byMonth[m] || { sales: 0, profit: 0 };
      byMonth[m].sales += h.sales; byMonth[m].profit += h.profit;
    }
    return Object.entries(byMonth).map(([m, v]) => ({ label: new Date(2000, +m, 1).toLocaleDateString('es-AR', { month: 'short' }), ...v }));
  }, [dash, range]);

  const revenue = summary?.totalRevenue || 0;
  const profit = summary?.netProfit || 0;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
  const pays = Object.entries(summary?.paymentBreakdown || {}).filter(([, v]) => (v as number) > 0).sort((a, b) => (b[1] as number) - (a[1] as number)) as [string, number][];
  const paysTotal = pays.reduce((s, [, v]) => s + v, 0);
  const best = chart.reduce((b, x, i) => (x.sales > (chart[b]?.sales ?? 0) ? i : b), 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title="Reportes">
        <Chips<Range>
          options={[{ id: 'WEEK', label: '7 días' }, { id: 'MONTH', label: 'Este mes' }, { id: 'LAST_MONTH', label: 'Mes pasado' }, { id: 'YEAR', label: 'Este año' }]}
          value={range}
          onChange={setRange}
        />
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-3 py-2.5">
            <p className="text-[11.5px] text-rose-100">Ventas</p>
            <p className="text-[19px] font-bold tabular-nums">{summary ? money(revenue) : '—'}</p>
          </div>
          <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-3 py-2.5">
            <p className="text-[11.5px] text-rose-100">Ganancia bruta</p>
            <p className="text-[19px] font-bold tabular-nums">{summary ? money(profit) : '—'}</p>
          </div>
        </div>
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
        {!summary || !dash ? <ListSkeleton rows={4} /> : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Tickets" value={String(summary.totalSales || 0)} />
              <Stat label="Ticket prom." value={money(summary.averageTicket)} />
              <Stat label="Margen" value={`${margin}%`} />
            </div>

            <Card title={range === 'YEAR' ? 'Ventas por mes' : 'Ventas por día'} right={chart[best]?.sales > 0 ? `Mejor: ${range === 'YEAR' ? chart[best].label : `día ${chart[best].label}`}` : undefined}>
              <div className="h-44 -mx-1 mt-2">
                {chart.length === 0 ? <p className="text-[13px] text-slate-500 py-10 text-center">Sin ventas en el período.</p> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                      <Tooltip cursor={{ fill: 'rgba(14,110,82,0.06)' }} formatter={(v: number, n: string) => [money(v), n === 'sales' ? 'Ventas' : 'Ganancia']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                      <Bar dataKey="sales" radius={[5, 5, 2, 2]} maxBarSize={20}>
                        {chart.map((_, i) => <Cell key={i} fill={i === best ? '#0E6E52' : '#9EDDC3'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card title="Cómo se llega a la ganancia">
              <Line label="Ventas" value={money(revenue)} />
              <Line label="Costo de la mercadería" value={`− ${money(summary.totalCost)}`} muted />
              <div className="border-t border-dashed border-slate-200 my-1.5" />
              <Line label="Ganancia bruta" value={money(profit)} strong />
              {summary.expenses > 0 && <Line label="Gastos, compras y pagos a proveedores" value={`− ${money(summary.expenses)}`} muted />}
              <p className="text-[11.5px] text-slate-400 mt-1.5">La ganancia bruta no descuenta gastos. Para la ganancia del día a día mirá Inicio.</p>
            </Card>

            {pays.length > 0 && (
              <Card title="Cómo te pagaron">
                <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100 mt-2">
                  {pays.map(([k, v], i) => <div key={k} style={{ width: `${(v / paysTotal) * 100}%`, background: PAY_COLORS[i % PAY_COLORS.length] }} />)}
                </div>
                <div className="mt-3 space-y-1.5">
                  {pays.map(([k, v], i) => (
                    <div key={k} className="flex items-center justify-between text-[13px]">
                      <span className="flex items-center gap-2 text-slate-600"><span className="w-2 h-2 rounded-full" style={{ background: PAY_COLORS[i % PAY_COLORS.length] }} />{METHOD_LABELS[k] || k}</span>
                      <span className="font-medium text-slate-800 tabular-nums">{money(v)} <span className="text-slate-400 text-[11.5px]">{Math.round((v / paysTotal) * 100)}%</span></span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {(dash.topProducts || []).length > 0 && (
              <Card title="Lo más vendido" icon={Package}>
                {dash.topProducts.map((p: any, i: number) => (
                  <div key={p.id + i} className="flex items-center gap-3 py-2 border-b last:border-0 border-slate-100">
                    <span className="w-6 h-6 rounded-lg bg-rose-50 text-rose-700 text-[11px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-slate-800 truncate">{p.name}</p>
                      <p className="text-[11.5px] text-slate-500">{qty(p.quantity)} unidades · quedan {qty(p.stock)}</p>
                    </div>
                    <p className="text-[13px] font-medium text-slate-800 tabular-nums">{money(p.revenue)}</p>
                  </div>
                ))}
              </Card>
            )}

            {(dash.topClients || []).length > 0 && (
              <Card title="Mejores clientes" icon={Users}>
                {dash.topClients.map((c: any, i: number) => (
                  <div key={c.id} className="flex items-center gap-3 py-2 border-b last:border-0 border-slate-100">
                    <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 text-[12px] font-semibold flex items-center justify-center shrink-0">{(c.name || '?')[0]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-slate-800 truncate">{c.name}</p>
                      <p className="text-[11.5px] text-slate-500">{c.salesCount} compras</p>
                    </div>
                    <p className="text-[13px] font-medium text-slate-800 tabular-nums">{money(c.totalSpent)}</p>
                  </div>
                ))}
              </Card>
            )}

            {revenue === 0 && (
              <div className="text-center py-6">
                <TrendingUp className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-[13px] text-slate-500 mt-2">No hay ventas en este período.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 px-3 py-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-[15px] font-bold text-slate-900 tabular-nums truncate">{value}</p>
    </div>
  );
}

function Card({ title, right, icon: Icon, children }: { title: string; right?: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4 text-slate-400" />}{title}</p>
        {right && <p className="text-[11px] text-slate-500">{right}</p>}
      </div>
      {children}
    </div>
  );
}

function Line({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-[13px] ${strong ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{label}</span>
      <span className={`text-[13px] tabular-nums ${strong ? 'font-bold text-rose-700' : muted ? 'text-slate-500' : 'font-medium text-slate-800'}`}>{value}</span>
    </div>
  );
}
