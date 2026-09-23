import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Receipt, ShoppingBag, ArrowDownRight, ArrowUpRight, Ban, ChevronLeft, ChevronRight, Search, X, Wallet } from 'lucide-react';
import api from '../../services/api';
import ExpenseSheet, { parseExpense } from './ExpenseSheet';
import { ScreenHeader, headerInput, Chips, Sheet, PrimaryButton, MoneyInput, EmptyState, ListSkeleton, money, qty, parseAmount, METHOD_LABELS } from './ui';

type Filter = 'ALL' | 'SALES' | 'EXPENSES';

interface Entry {
  id: string;
  kind: 'SALE' | 'EXPENSE' | 'INCOME' | 'WITHDRAWAL';
  at: Date;
  amount: number;
  title: string;
  detail: string;
  cancelled?: boolean;
  raw: any;
}

const MOVEMENT_TITLES: Record<string, string> = { EXPENSE: 'Gasto', INCOME: 'Ingreso de dinero', WITHDRAWAL: 'Retiro de caja' };

const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a: Date, b: Date) => dayStart(a).getTime() === dayStart(b).getTime();

function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Hoy';
  if (sameDay(d, yesterday)) return 'Ayer';
  const s = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}


export default function MobileMovementsScreen() {
  const [day, setDay] = useState(() => dayStart(new Date()));
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [limit, setLimit] = useState(60);

  const isToday = sameDay(day, new Date());

  const load = useCallback(async () => {
    setLoading(true);
    const from = day.toISOString();
    const toDate = new Date(day); toDate.setHours(23, 59, 59, 999);
    const to = toDate.toISOString();
    try {
      const [salesRes, movRes] = await Promise.all([
        api.get('/sales', { params: { from, to } }),
        api.get('/cash/movements', { params: { from, to } }).catch(() => ({ data: [] })),
      ]);
      const sales: Entry[] = (salesRes.data || []).map((s: any) => {
        const names = (s.items || []).map((i: any) => i.productName);
        return {
          id: s.id,
          kind: 'SALE' as const,
          at: new Date(s.createdAt),
          amount: s.total,
          title: names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` y ${names.length - 2} más` : '') : `Venta N.º ${s.saleNumber}`,
          detail: `${METHOD_LABELS[s.paymentMethodSummary] || s.paymentMethodSummary} · N.º ${s.saleNumber}`,
          cancelled: s.status !== 'COMPLETED',
          raw: s,
        };
      });
      const movements: Entry[] = (movRes.data || []).map((m: any) => ({
        id: m.id,
        kind: m.type,
        at: new Date(m.createdAt),
        amount: m.amount,
        title: m.type === 'INCOME' ? (m.description || MOVEMENT_TITLES.INCOME) : parseExpense(m).text,
        detail: `${m.type === 'EXPENSE' ? parseExpense(m).label : MOVEMENT_TITLES[m.type] || m.type} · ${m.session?.terminalName || ''}`.replace(/ · $/, ''),
        raw: m,
      }));
      setEntries([...sales, ...movements].sort((a, b) => b.at.getTime() - a.at.getTime()));
    } catch {
      toast.error('No pudimos traer los movimientos');
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => setLimit(60), [day, filter, search]);

  const visible = useMemo(() => {
    const t = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter === 'SALES' && e.kind !== 'SALE') return false;
      if (filter === 'EXPENSES' && e.kind === 'SALE') return false;
      if (t && !`${e.title} ${e.detail}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [entries, filter, search]);

  const totals = useMemo(() => {
    let sales = 0, out = 0, count = 0;
    for (const e of entries) {
      if (e.kind === 'SALE' && !e.cancelled) { sales += e.amount; count++; }
      if (e.kind === 'EXPENSE' || e.kind === 'WITHDRAWAL') out += e.amount;
    }
    return { sales, out, count };
  }, [entries]);

  const shiftDay = (delta: number) => {
    const d = new Date(day); d.setDate(d.getDate() + delta);
    if (d > new Date()) return;
    setDay(dayStart(d));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <ScreenHeader
        title="Movimientos"
        action={
          <button onClick={() => setExpenseOpen(true)} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
            <Plus className="w-[18px] h-[18px]" />
            <span className="text-[13px] font-semibold">Gasto</span>
          </button>
        }
      >
        <div className="flex items-center justify-between rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 h-11 px-1">
          <button onClick={() => shiftDay(-1)} className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-white/15" aria-label="Día anterior">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <span className="text-[14px] font-semibold text-white">{dayLabel(day)}</span>
          <button onClick={() => shiftDay(1)} disabled={isToday} className="w-9 h-9 rounded-xl flex items-center justify-center active:bg-white/15 disabled:opacity-30" aria-label="Día siguiente">
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="rounded-2xl bg-white px-3 py-2 shadow-sm">
            <p className="text-[11.5px] text-slate-500">Ventas · {totals.count}</p>
            <p className="text-[17px] font-bold text-emerald-700 tabular-nums">{money(totals.sales)}</p>
          </div>
          <div className="rounded-2xl bg-white px-3 py-2 shadow-sm">
            <p className="text-[11.5px] text-slate-500">Gastos y retiros</p>
            <p className="text-[17px] font-bold text-red-600 tabular-nums">{money(totals.out)}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Chips<Filter>
              options={[{ id: 'ALL', label: 'Todo' }, { id: 'SALES', label: 'Ventas' }, { id: 'EXPENSES', label: 'Gastos' }]}
              value={filter}
              onChange={setFilter}
            />
          </div>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-3 inset-y-0 my-auto w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto o número"
            className={`${headerInput} !h-10 !rounded-xl !text-[14px] pl-9 pr-9`}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 inset-y-0 my-auto w-7 h-7 flex items-center justify-center" aria-label="Borrar búsqueda">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
      </ScreenHeader>

      <div
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && limit < visible.length) setLimit((l) => l + 60);
        }}
      >
        {loading ? (
          <ListSkeleton />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={filter === 'EXPENSES' ? Receipt : ShoppingBag}
            title={search ? 'Sin resultados' : filter === 'EXPENSES' ? 'No hay gastos este día' : 'No hay movimientos este día'}
            text={isToday && !search ? 'Cuando vendas o cargues un gasto, aparece acá.' : undefined}
          />
        ) : (
          <div className="px-4 py-3">
            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {visible.slice(0, limit).map((e) => <EntryRow key={e.kind + e.id} entry={e} onClick={() => setSelected(e)} />)}
            </div>
          </div>
        )}
      </div>

      <DetailSheet entry={selected} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); load(); }} />
      <ExpenseSheet open={expenseOpen} onClose={() => setExpenseOpen(false)} onSaved={() => { setExpenseOpen(false); if (!isToday) setDay(dayStart(new Date())); else load(); }} />
    </div>
  );
}

function EntryRow({ entry: e, onClick }: { entry: Entry; onClick: () => void }) {
  const isSale = e.kind === 'SALE';
  const isIn = isSale || e.kind === 'INCOME';
  const Icon = isSale ? ShoppingBag : isIn ? ArrowDownRight : ArrowUpRight;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3.5 py-3 text-left active:bg-slate-50">
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${e.cancelled ? 'bg-slate-100' : isIn ? 'bg-emerald-50' : 'bg-red-50'}`}>
        <Icon className={`w-[18px] h-[18px] ${e.cancelled ? 'text-slate-400' : isIn ? 'text-emerald-700' : 'text-red-600'}`} />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-[14px] font-medium truncate ${e.cancelled ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{e.title}</span>
        <span className="block text-[12px] text-slate-500 truncate">
          {e.at.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} · {e.cancelled ? 'Anulada' : e.detail}
        </span>
      </span>
      <span className={`text-[14.5px] font-semibold tabular-nums shrink-0 ${e.cancelled ? 'text-slate-400 line-through' : isIn ? 'text-emerald-700' : 'text-red-600'}`}>
        {isIn ? '+' : '−'}{money(e.amount)}
      </span>
    </button>
  );
}

function DetailSheet({ entry, onClose, onChanged }: { entry: Entry | null; onClose: () => void; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setConfirming(false), [entry]);

  const s = entry?.raw;
  const isSale = entry?.kind === 'SALE';

  const cancelSale = async () => {
    setBusy(true);
    try {
      await api.post(`/sales/${s.id}/cancel`);
      toast.success('Venta anulada. El stock volvió a su lugar.');
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo anular la venta');
    } finally {
      setBusy(false);
    }
  };

  const deleteMovement = async () => {
    setBusy(true);
    try {
      await api.delete(`/cash/movement/${s.id}`);
      toast.success('Movimiento eliminado');
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  };

  const canUndo = isSale ? !entry?.cancelled : true;

  return (
    <Sheet
      open={!!entry}
      onClose={onClose}
      title={isSale ? `Venta N.º ${s?.saleNumber ?? ''}` : (entry ? MOVEMENT_TITLES[entry.kind] || 'Movimiento' : '')}
      footer={entry && canUndo ? (
        confirming ? (
          <div className="space-y-2">
            <p className="text-[13px] text-center text-slate-600">
              {isSale ? '¿Anular esta venta? El stock de los productos vuelve a sumarse.' : '¿Eliminar este movimiento de la caja?'}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} className="flex-1 h-12 rounded-2xl bg-slate-100 text-[15px] font-semibold text-slate-700">No</button>
              <div className="flex-1"><PrimaryButton tone="danger" loading={busy} onClick={isSale ? cancelSale : deleteMovement}>{isSale ? 'Sí, anular' : 'Sí, eliminar'}</PrimaryButton></div>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="w-full h-12 rounded-2xl border border-red-200 text-red-600 text-[15px] font-semibold flex items-center justify-center gap-2">
            <Ban className="w-4 h-4" /> {isSale ? 'Anular venta' : 'Eliminar movimiento'}
          </button>
        )
      ) : undefined}
    >
      {entry && (
        <div>
          <div className="text-center pb-4">
            <p className={`text-[32px] font-bold tabular-nums tracking-tight ${entry.cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{money(entry.amount)}</p>
            <p className="text-[13px] text-slate-500">
              {entry.at.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })} · {entry.at.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              {s?.user?.fullName ? ` · ${s.user.fullName}` : ''}
            </p>
            {entry.cancelled && <span className="inline-block mt-2 text-[12px] font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">Anulada</span>}
          </div>

          {isSale ? (
            <>
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {(s.items || []).map((i: any) => (
                  <div key={i.id} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13.5px] text-slate-800 leading-snug">{i.productName}</p>
                      <p className="text-[12px] text-slate-500 tabular-nums">{qty(i.quantity)} × {money(i.unitPrice)}{i.discount > 0 ? ` · −${money(i.discount)}` : ''}</p>
                    </div>
                    <p className="text-[13.5px] font-medium text-slate-800 tabular-nums">{money(i.total)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 mb-2 text-[12.5px] font-medium text-slate-500">Pagos</p>
              <div className="rounded-2xl bg-slate-50 px-3.5 py-2">
                {(s.payments || []).map((p: any) => (
                  <div key={p.id} className="flex justify-between py-1 text-[13.5px]">
                    <span className="text-slate-600">{METHOD_LABELS[p.method] || p.method}</span>
                    <span className="font-medium text-slate-800 tabular-nums">{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5 text-[13.5px]">
              <div className="flex justify-between"><span className="text-slate-500">Detalle</span><span className="text-slate-800 text-right">{s?.description || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Caja</span><span className="text-slate-800">{s?.session?.terminalName || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Cargado por</span><span className="text-slate-800">{s?.user?.fullName || '—'}</span></div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
