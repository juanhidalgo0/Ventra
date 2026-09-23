import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Receipt, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, Chips, Sheet, PrimaryButton, EmptyState, ListSkeleton, money } from './ui';
import ExpenseSheet, { parseExpense } from './ExpenseSheet';

type Tab = 'ALL' | 'FIXED' | 'VARIABLE';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const BAR_COLORS = ['#0E6E52', '#93AE25', '#34AC7E', '#D9A70F', '#9EDDC3', '#58691A', '#94a3b8'];

/** Gastos del mes en el celular: total, fijos vs variables, en qué se va la plata y la lista. */
export default function MobileExpensesScreen() {
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [rows, setRows] = useState<any[] | null>(null);
  const [tab, setTab] = useState<Tab>('ALL');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const load = useCallback(() => {
    setRows(null);
    const from = new Date(month.y, month.m, 1);
    const to = new Date(month.y, month.m + 1, 0, 23, 59, 59);
    api.get('/cash/movements', { params: { type: 'EXPENSE', from: from.toISOString(), to: to.toISOString() } })
      .then((r) => setRows((r.data || []).map((mv: any) => ({ ...mv, parsed: parseExpense(mv) }))))
      .catch(() => { setRows([]); toast.error('No pudimos traer los gastos'); });
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const isCurrent = month.y === now.getFullYear() && month.m === now.getMonth();
  const shift = (d: number) => {
    const date = new Date(month.y, month.m + d, 1);
    if (date > now) return;
    setMonth({ y: date.getFullYear(), m: date.getMonth() });
  };

  const all = rows || [];
  const total = all.reduce((s, r) => s + r.amount, 0);
  const fixed = all.filter((r) => r.parsed.fixed).reduce((s, r) => s + r.amount, 0);
  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of all) map[r.parsed.label] = (map[r.parsed.label] || 0) + r.amount;
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const visible = all.filter((r) => tab === 'ALL' || (tab === 'FIXED' ? r.parsed.fixed : !r.parsed.fixed));

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader
        back
        title="Gastos"
        action={
          <button onClick={() => setAdding(true)} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
            <Plus className="w-[18px] h-[18px]" /><span className="text-[13px] font-bold">Gasto</span>
          </button>
        }
      >
        <div className="flex items-center justify-between rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 h-11 px-1">
          <button onClick={() => shift(-1)} className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-white/15" aria-label="Mes anterior"><ChevronLeft className="w-5 h-5" /></button>
          <span className="text-[14px] font-semibold capitalize">{MONTHS[month.m]} {month.y}</span>
          <button onClick={() => shift(1)} disabled={isCurrent} className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-white/15 disabled:opacity-30" aria-label="Mes siguiente"><ChevronRight className="w-5 h-5" /></button>
        </div>
        <div className="mt-3">
          <p className="text-[12px] text-rose-100">Gastaste en el mes</p>
          <p className="text-[30px] font-bold tabular-nums tracking-tight leading-tight">{money(total)}</p>
          <p className="text-[12px] text-rose-100">{all.length} gastos · fijos {money(fixed)} · variables {money(total - fixed)}</p>
        </div>
        <div className="mt-3">
          <Chips<Tab> options={[{ id: 'ALL', label: 'Todos' }, { id: 'FIXED', label: 'Fijos' }, { id: 'VARIABLE', label: 'Variables' }]} value={tab} onChange={setTab} />
        </div>
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
        {rows === null ? <ListSkeleton /> : all.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin gastos este mes" text="Cargá luz, sueldos, mercadería y lo que salga de la caja para ver tu ganancia real." />
        ) : (
          <>
            {tab === 'ALL' && byCategory.length > 1 && (
              <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
                <p className="text-[13px] font-semibold text-slate-800 mb-3">En qué se va la plata</p>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
                  {byCategory.map(([c, v], i) => <div key={c} style={{ width: `${(v / total) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />)}
                </div>
                <div className="mt-3 space-y-1.5">
                  {byCategory.map(([c, v], i) => (
                    <div key={c} className="flex items-center justify-between text-[13px]">
                      <span className="flex items-center gap-2 text-slate-600"><span className="w-2 h-2 rounded-full" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />{c}</span>
                      <span className="font-medium text-slate-800 tabular-nums">{money(v)} <span className="text-slate-400 text-[11.5px]">{Math.round((v / total) * 100)}%</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {visible.map((r) => (
                <button key={r.id} onClick={() => setSelected(r)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                  <span className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0"><Receipt className="w-[18px] h-[18px] text-red-600" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium text-slate-800 truncate">{r.parsed.text}</span>
                    <span className="block text-[12px] text-slate-500 truncate">
                      {new Date(r.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · {r.parsed.label}{r.parsed.fixed ? ' · fijo' : ''}
                    </span>
                  </span>
                  <span className="text-[14.5px] font-semibold text-red-600 tabular-nums shrink-0">−{money(r.amount)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <ExpenseSheet open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      <ExpenseDetail row={selected} onClose={() => setSelected(null)} onDeleted={() => { setSelected(null); load(); }} />
    </div>
  );
}

function ExpenseDetail({ row, onClose, onDeleted }: { row: any | null; onClose: () => void; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setConfirming(false), [row]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/cash/movement/${row.id}`);
      toast.success('Gasto eliminado');
      onDeleted();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title="Gasto"
      footer={row ? (confirming ? (
        <div className="flex gap-2">
          <button onClick={() => setConfirming(false)} className="flex-1 h-12 rounded-2xl bg-slate-100 text-[15px] font-semibold text-slate-700">No</button>
          <div className="flex-1"><PrimaryButton tone="danger" loading={busy} onClick={remove}>Sí, eliminar</PrimaryButton></div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="w-full h-12 rounded-2xl border border-red-200 text-red-600 text-[15px] font-semibold flex items-center justify-center gap-2">
          <Trash2 className="w-4 h-4" /> Eliminar gasto
        </button>
      )) : undefined}
    >
      {row && (
        <div className="pt-1 space-y-4">
          <div className="text-center">
            <p className="text-[32px] font-bold text-slate-900 tabular-nums tracking-tight">{money(row.amount)}</p>
            <p className="text-[14px] text-slate-700">{row.parsed.text}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5 text-[13.5px]">
            <div className="flex justify-between"><span className="text-slate-500">Categoría</span><span className="text-slate-800">{row.parsed.label}{row.parsed.fixed ? ' (fijo)' : ''}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Pagado con</span><span className="text-slate-800">{row.parsed.method}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Fecha</span><span className="text-slate-800">{new Date(row.createdAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Caja</span><span className="text-slate-800">{row.session?.terminalName || '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Cargado por</span><span className="text-slate-800">{row.user?.fullName || '—'}</span></div>
          </div>
          {confirming && <p className="text-[13px] text-center text-slate-600">Si lo eliminás, la plata vuelve a contar como efectivo en la caja.</p>}
        </div>
      )}
    </Sheet>
  );
}

