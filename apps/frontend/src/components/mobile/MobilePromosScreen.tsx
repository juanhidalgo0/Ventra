import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Tag } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, Chips, Sheet, EmptyState, ListSkeleton, money, qty } from './ui';

type Filter = 'ACTIVE' | 'ALL';

/** Cómo se lee cada promo, en palabras del cliente. */
function describe(p: any) {
  if (p.type === 'NX_M') return `Llevá ${p.nValue} y pagá ${p.mValue}`;
  if (p.type === 'DISCOUNT_PERCENT') return `${p.discountPercentage}% de descuento`;
  if (p.type === 'FIXED_COMBO') return `Combo a ${money(p.fixedPrice || 0)}`;
  return p.type;
}

function status(p: any) {
  if (!p.isActive) return { label: 'Pausada', cls: 'bg-slate-100 text-slate-500' };
  if (p.endDate && new Date(p.endDate) < new Date()) return { label: 'Vencida', cls: 'bg-slate-100 text-slate-500' };
  if (p.limitType === 'STOCK' && p.limitStock && p.soldStock >= p.limitStock) return { label: 'Agotada', cls: 'bg-amber-50 text-amber-700' };
  return { label: 'Activa', cls: 'bg-emerald-50 text-emerald-700' };
}

/** Promociones en el celular: cuáles están vigentes y qué incluyen. Se crean desde la PC. */
export default function MobilePromosScreen() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    api.get('/promotions').then((r) => setRows(r.data || [])).catch(() => { setRows([]); toast.error('No pudimos traer las promociones'); });
  }, []);

  const active = useMemo(() => (rows || []).filter((p) => status(p).label === 'Activa'), [rows]);
  const list = filter === 'ACTIVE' ? active : rows || [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader
        back
        title="Promociones"
        subtitle={rows ? `${active.length} vigentes` : undefined}
      >
        <Chips<Filter> options={[{ id: 'ACTIVE', label: 'Vigentes', count: active.length }, { id: 'ALL', label: 'Todas', count: rows?.length }]} value={filter} onChange={setFilter} />
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-2.5">
        {rows === null ? <ListSkeleton /> : list.length === 0 ? (
          <EmptyState icon={Tag} title={filter === 'ACTIVE' ? 'No hay promos vigentes' : 'Todavía no hay promociones'} text="Las promos se aplican solas en la caja cuando el cliente lleva los productos." />
        ) : list.map((p) => {
          const st = status(p);
          return (
            <button key={p.id} onClick={() => setSelected(p)} className="w-full text-left bg-white rounded-2xl border border-slate-200/80 p-4 active:scale-[0.99] transition-transform">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-slate-900 leading-snug">{p.name}</p>
                  <p className="text-[13px] text-rose-700 font-medium mt-0.5">{describe(p)}</p>
                </div>
                <span className={`text-[11.5px] font-semibold px-2 py-1 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
              </div>
              <p className="text-[12px] text-slate-500 mt-2">
                {(p.products || []).length} productos
                {p.endDate ? ` · hasta el ${new Date(p.endDate).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}` : ''}
                {p.limitType === 'STOCK' && p.limitStock ? ` · vendidas ${qty(p.soldStock)} de ${qty(p.limitStock)}` : ''}
              </p>
            </button>
          );
        })}
      </div>

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected?.name}>
        {selected && (
          <div className="space-y-4 pt-1">
            <div className="rounded-2xl bg-rose-50 px-4 py-3">
              <p className="text-[18px] font-bold text-rose-800">{describe(selected)}</p>
              {selected.code && <p className="text-[12.5px] text-rose-700">Código {selected.code}</p>}
            </div>
            <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
              {(selected.products || []).map((pp: any) => (
                <div key={pp.id} className="flex items-center justify-between px-3.5 py-2.5 text-[13.5px]">
                  <span className="text-slate-800 min-w-0 truncate">{pp.product?.name || 'Producto'}</span>
                  <span className="text-slate-500 shrink-0 pl-2">× {pp.quantity}{pp.product?.salePrice ? ` · ${money(pp.product.salePrice)}` : ''}</span>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-slate-400 text-center">Las promos se crean y se editan desde la PC.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
