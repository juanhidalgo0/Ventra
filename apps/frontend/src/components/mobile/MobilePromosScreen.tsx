import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Tag, Plus, Check } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, Chips, Sheet, EmptyState, ListSkeleton, PrimaryButton, money, qty, parseAmount } from './ui';
import { resolveStoreId, publishOnlinePromos } from '../../services/onlineStore';

type Filter = 'ACTIVE' | 'ALL';

/** Cómo se lee cada promo, en palabras del cliente. */
function describe(p: any) {
  if (p.type === 'NX_M') return `Llevá ${p.nValue} y pagá ${p.mValue}`;
  if (p.type === 'DISCOUNT_PERCENT') return `${p.discountPercentage}% de descuento`;
  if (p.type === 'FIXED_COMBO') {
    // Un solo grupo con cantidad: "12 a $14.000", mezclando los productos del grupo
    const items = p.products || [];
    const groups = new Set(items.map((x: any) => x.groupId || x.productId));
    if (groups.size === 1 && items.length > 1 && (items[0]?.quantity || 1) > 1) return `${items[0].quantity} a ${money(p.fixedPrice || 0)} (surtidos)`;
    return `Combo a ${money(p.fixedPrice || 0)}`;
  }
  return p.type;
}

function status(p: any) {
  if (!p.isActive) return { label: 'Pausada', cls: 'bg-slate-100 text-slate-500' };
  if (p.endDate && new Date(p.endDate) < new Date()) return { label: 'Vencida', cls: 'bg-slate-100 text-slate-500' };
  if (p.limitType === 'STOCK' && p.limitStock && p.soldStock >= p.limitStock) return { label: 'Agotada', cls: 'bg-amber-50 text-amber-700' };
  return { label: 'Activa', cls: 'bg-emerald-50 text-emerald-700' };
}

/** Promociones en el celular: cuáles están vigentes y qué incluyen. Las de precio por cantidad se crean acá; el resto desde la PC. */
export default function MobilePromosScreen() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [selected, setSelected] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => api.get('/promotions').then((r) => setRows(r.data || [])).catch(() => { setRows([]); toast.error('No pudimos traer las promociones'); });
  useEffect(() => { load(); }, []);

  const active = useMemo(() => (rows || []).filter((p) => status(p).label === 'Activa'), [rows]);
  const list = filter === 'ACTIVE' ? active : rows || [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader
        back
        title="Promociones"
        subtitle={rows ? `${active.length} vigentes` : undefined}
        action={
          <button onClick={() => setCreating(true)} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
            <Plus className="w-[18px] h-[18px]" />
            <span className="text-[13px] font-semibold">Nueva</span>
          </button>
        }
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
            <p className="text-[12px] text-slate-400 text-center">Para editarla o pausarla, entrá desde la PC.</p>
          </div>
        )}
      </Sheet>
      <QtyPromoSheet open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
    </div>
  );
}

/**
 * Precio por cantidad mezclando productos: "12 empanadas de cualquier gusto a $14.000".
 * Es un combo de un solo grupo: la caja y la tienda lo aplican solos cuando se juntan las unidades.
 * Con media docena y docena se cargan dos promos (6 y 12) sobre los mismos productos.
 */
function QtyPromoSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [products, setProducts] = useState<any[] | null>(null);
  const [name, setName] = useState('');
  const [units, setUnits] = useState('12');
  const [price, setPrice] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cat, setCat] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(''); setUnits('12'); setPrice(''); setPicked(new Set()); setCat('');
    api.get('/products', { params: { take: 5000 } })
      .then(({ data }) => setProducts(((data?.products || data || []) as any[]).filter((p) => p.isActive !== false && !String(p.id).startsWith('VIRTUAL'))))
      .catch(() => setProducts([]));
  }, [open]);

  const cats = useMemo(() => Array.from(new Set((products || []).map((p) => p.category?.name).filter(Boolean))).sort() as string[], [products]);
  const shown = (products || []).filter((p) => !cat || p.category?.name === cat);
  const toggle = (id: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickCategory = (c: string) => {
    setCat(c);
    const ids = (products || []).filter((p) => p.category?.name === c).map((p) => p.id);
    setPicked(new Set(ids));
    if (!name) setName(`${Number(units) === 6 ? 'Media docena' : Number(units) === 12 ? 'Docena' : `${units} unidades`} de ${c.toLowerCase()}`);
  };
  const n = Math.round(Number(units) || 0);
  const regular = useMemo(() => {
    const prices = (products || []).filter((p) => picked.has(p.id)).map((p) => p.salePrice || 0);
    return prices.length ? Math.min(...prices) * n : 0;
  }, [products, picked, n]);

  const save = async () => {
    const amount = parseAmount(price);
    if (n < 2) return toast.error('La cantidad tiene que ser 2 o más');
    if (amount <= 0) return toast.error('Poné el precio de la promo');
    if (!picked.size) return toast.error('Elegí qué productos entran');
    setBusy(true);
    try {
      await api.post('/promotions', {
        name: name.trim() || `${n} a ${money(amount)}`,
        type: 'FIXED_COMBO', fixedPrice: amount, isActive: true, limitType: 'NONE', endDate: null,
        products: Array.from(picked).map((productId) => ({ productId, quantity: n, groupId: 'mix' })),
      });
      // Queda publicada en la tienda online sin tener que volver a publicar el catálogo
      try {
        const storeId = await resolveStoreId();
        const online = new Set((products || []).filter((p) => p.showOnline).map((p) => String(p.id)));
        await publishOnlinePromos(storeId, online);
      } catch { /* sin tienda: queda para la caja */ }
      toast.success('Promo creada');
      onCreated();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo crear la promo');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white';
  return (
    <Sheet open={open} onClose={onClose} title="Precio por cantidad" footer={<PrimaryButton onClick={save} loading={busy}>Crear promo</PrimaryButton>}>
      <div className="space-y-4 pt-1">
        <p className="text-[13px] text-slate-500 -mt-1">Ej.: 12 empanadas de cualquier gusto a $14.000. Se aplica sola, en la caja y en la tienda, aunque el cliente mezcle gustos. Para media docena y docena, creá dos promos.</p>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">Cantidad</p>
          <div className="flex gap-2">
            {['6', '12'].map((u) => (
              <button key={u} onClick={() => setUnits(u)} className={`h-11 px-4 rounded-xl text-[14px] font-semibold border ${units === u ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{u === '6' ? 'Media docena' : 'Docena'}</button>
            ))}
            <input value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="w-20 h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[15px] text-center outline-none focus:border-rose-500" />
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">Precio de {n || '…'} unidades</p>
          <div className="flex items-center h-12 px-3 rounded-xl bg-slate-50 border border-slate-200 focus-within:border-rose-500 focus-within:bg-white">
            <span className="text-[16px] text-slate-400 mr-1">$</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} className="flex-1 min-w-0 bg-transparent outline-none text-[18px] font-semibold text-slate-900 tabular-nums" />
          </div>
          {regular > 0 && <p className="text-[12px] text-slate-500 mt-1">Sueltas salen desde {money(regular)}{parseAmount(price) > 0 && parseAmount(price) < regular ? ` · ahorran ${money(regular - parseAmount(price))}` : ''}</p>}
        </div>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">¿Qué productos entran? {picked.size ? `(${picked.size})` : ''}</p>
          {cats.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {cats.map((c) => (
                <button key={c} onClick={() => pickCategory(c)} className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border ${cat === c ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>{c}</button>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {products === null ? <div className="p-3"><ListSkeleton rows={4} /></div> : shown.slice(0, 300).map((p) => (
              <button key={p.id} onClick={() => toggle(p.id)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left">
                <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${picked.has(p.id) ? 'bg-rose-600 border-rose-600' : 'border-slate-300'}`}>{picked.has(p.id) && <Check className="w-3.5 h-3.5 text-white" />}</span>
                <span className="flex-1 min-w-0 text-[13.5px] text-slate-800 truncate">{p.name}</span>
                <span className="text-[12.5px] text-slate-500 tabular-nums">{money(p.salePrice || 0)}</span>
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-slate-400 mt-1">Tocá una categoría para elegir todos sus productos de una vez.</p>
        </div>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">Nombre de la promo</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Docena de empanadas" className={input} />
        </div>
      </div>
    </Sheet>
  );
}
