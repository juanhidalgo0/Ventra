import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, ChevronDown, Coffee, Loader2, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { money } from '../mobile/ui';

/**
 * Consumo de empleados (sin cargo): lo que cada empleado registró con su usuario en la caja,
 * mes a mes y valuado al costo. No toca la caja: solo descontó el stock. Ver
 * sales.service (employeeConsumptionReport) en el backend.
 */
interface ConsumptionItem { name: string; quantity: number; cost: number }
interface ConsumptionSale { id: string; saleNumber: number; createdAt: string; cost: number; items: ConsumptionItem[] }
interface Employee { userId: string; name: string; username: string; count: number; units: number; cost: number; products: ConsumptionItem[]; sales: ConsumptionSale[] }
interface Report { month: string; totalCost: number; count: number; employees: Employee[] }

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR');

export default function EmployeeConsumptionScreen() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const enabled = localStorage.getItem('employee_consumption') === '1';

  const load = async (m = month) => {
    setLoading(true);
    try {
      const { data } = await api.get('/sales/employee-consumption', { params: { month: m } });
      setReport(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cargar el consumo');
      setReport(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(month); }, [month]);

  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const next = monthKey(new Date(y, m - 1 + delta, 1));
    if (next <= monthKey(new Date())) setMonth(next);
  };

  const cancel = async (s: ConsumptionSale, who: string) => {
    if (!confirm(`¿Anular el consumo #${s.saleNumber} de ${who}? Los productos vuelven al stock.`)) return;
    try {
      await api.post(`/sales/${s.id}/cancel`);
      toast.success('Consumo anulado: los productos volvieron al stock');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo anular');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl w-full mx-auto space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Coffee className="w-5 h-5 text-emerald-600" /> Consumo de empleados</h1>
          <p className="text-[13px] text-slate-500">Sin cargo: descontó el stock y no tocó la caja. Valuado a lo que te costó la mercadería.</p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
          <button onClick={() => shift(-1)} className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center" aria-label="Mes anterior"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-2 text-[14px] font-semibold text-slate-800 min-w-[150px] text-center">{monthLabel(month)}</span>
          <button onClick={() => shift(1)} disabled={month >= monthKey(new Date())} className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center disabled:opacity-30" aria-label="Mes siguiente"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {!enabled && (
        <p className="text-[13px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          El consumo de empleados está apagado. Activalo en <a href="#/settings" className="underline font-bold">Configuración → Parámetros del sistema</a> para que aparezca el botón en la caja.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-[12px] font-semibold text-slate-500">Costo de lo consumido</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{money(report?.totalCost || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-[12px] font-semibold text-slate-500">Consumos registrados</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{report?.count || 0}</p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : !report?.employees.length ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-12 text-center text-[14px] text-slate-500">
          No hay consumos de empleados en {monthLabel(month).toLowerCase()}.
        </div>
      ) : (
        <div className="space-y-3">
          {report.employees.map((e) => (
            <div key={e.userId} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <button onClick={() => setOpen(open === e.userId ? null : e.userId)} className="w-full flex items-center gap-4 p-4 text-left hover:bg-slate-50">
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center shrink-0">{(e.name || '?').charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-slate-900 truncate">{e.name}</p>
                  <p className="text-[12.5px] text-slate-500">{e.count} {e.count === 1 ? 'consumo' : 'consumos'} · {qty(e.units)} unidades</p>
                </div>
                <p className="text-[16px] font-bold text-slate-900 tabular-nums">{money(e.cost)}</p>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open === e.userId ? 'rotate-180' : ''}`} />
              </button>
              {open === e.userId && (
                <div className="border-t border-slate-100 p-4 space-y-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Productos</p>
                    <div className="space-y-1">
                      {e.products.map((p) => (
                        <div key={p.name} className="flex justify-between gap-3 text-[13.5px]">
                          <span className="text-slate-700 truncate">{qty(p.quantity)} × {p.name}</span>
                          <span className="text-slate-500 tabular-nums shrink-0">{money(p.cost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Detalle</p>
                    <div className="space-y-2">
                      {e.sales.map((s) => (
                        <div key={s.id} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[12.5px] font-semibold text-slate-800">
                              {new Date(s.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · #{s.saleNumber}
                            </p>
                            <p className="text-[12.5px] text-slate-500 truncate">{s.items.map((i) => `${qty(i.quantity)} ${i.name}`).join(', ')}</p>
                          </div>
                          <span className="text-[13px] font-semibold text-slate-700 tabular-nums">{money(s.cost)}</span>
                          <button onClick={() => cancel(s, e.name)} className="w-8 h-8 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center" aria-label="Anular consumo" title="Anular (vuelve al stock)"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
