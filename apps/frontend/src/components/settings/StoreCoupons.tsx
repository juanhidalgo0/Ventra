import { useEffect, useState } from 'react';
import { Plus, Trash2, Copy, Loader2, Ticket, Pencil, X, Percent, DollarSign, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { fetchCoupons, saveCoupon, deleteCoupon, normCouponCode, type StoreCoupon, type CouponType } from '../../services/onlineStore';

/**
 * Cupones de descuento de la tienda online. Se guardan al instante (no esperan a "Publicar").
 * Los códigos no son públicos: la tienda los valida con la nube (firebase/functions/coupons.js).
 */
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0);
const input = 'w-full h-11 bg-white border border-slate-300 rounded-xl px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 outline-none focus:border-rose-500 focus:ring-[3px] focus:ring-rose-500/15';
const label = 'block text-[12.5px] font-semibold text-slate-600 mb-1.5';
const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

const TYPES: { id: CouponType; label: string; icon: any }[] = [
  { id: 'percent', label: '% de descuento', icon: Percent },
  { id: 'fixed', label: 'Monto fijo', icon: DollarSign },
  { id: 'shipping', label: 'Envío gratis', icon: Truck },
];

function describe(c: StoreCoupon) {
  const what = c.type === 'percent' ? `${c.value}% off${c.maxDiscount ? ` (hasta ${money(c.maxDiscount)})` : ''}` : c.type === 'fixed' ? `${money(c.value)} off` : 'Envío gratis';
  const parts = [what];
  if (c.minOrder) parts.push(`desde ${money(c.minOrder)}`);
  if (c.oncePerCustomer) parts.push('1 por cliente');
  return parts.join(' · ');
}

function statusOf(c: StoreCoupon): { text: string; cls: string } {
  const t = today();
  if (!c.active) return { text: 'Pausado', cls: 'bg-slate-100 text-slate-500' };
  if (c.validUntil && t > c.validUntil) return { text: 'Vencido', cls: 'bg-slate-100 text-slate-500' };
  if (c.maxUses && (c.uses || 0) >= c.maxUses) return { text: 'Agotado', cls: 'bg-slate-100 text-slate-500' };
  if (c.validFrom && t < c.validFrom) return { text: 'Programado', cls: 'bg-sky-50 text-sky-700' };
  return { text: 'Activo', cls: 'bg-emerald-50 text-emerald-700' };
}

const blank = (): StoreCoupon => ({ code: '', type: 'percent', value: 10, minOrder: 0, maxDiscount: 0, maxUses: 0, oncePerCustomer: false, validFrom: '', validUntil: '', active: true });

export default function StoreCoupons({ storeId, storeUrl, onChanged }: { storeId: string; storeUrl?: string; onChanged?: () => void }) {
  const [list, setList] = useState<StoreCoupon[] | null>(null);
  const [editing, setEditing] = useState<{ c: StoreCoupon; isNew: boolean } | null>(null);
  const load = () => fetchCoupons(storeId).then(setList).catch(() => { setList([]); toast.error('No se pudieron cargar los cupones'); });
  useEffect(() => { load(); }, [storeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = (c: StoreCoupon) => {
    const text = `Usá el cupón ${c.code} en ${storeUrl || 'nuestra tienda online'}: ${describe(c)}.`;
    navigator.clipboard?.writeText(text).then(() => toast.success('Texto copiado: pegalo en WhatsApp o Instagram'), () => toast.error('No se pudo copiar'));
  };
  const toggle = async (c: StoreCoupon) => {
    try { await saveCoupon(storeId, { ...c, active: !c.active }, false); await load(); onChanged?.(); } catch (e: any) { toast.error(e.message || 'No se pudo guardar'); }
  };
  const remove = async (c: StoreCoupon) => {
    if (!window.confirm(`¿Borrar el cupón ${c.code}? Los pedidos que ya lo usaron no cambian.`)) return;
    try { await deleteCoupon(storeId, c.code); await load(); onChanged?.(); toast.success('Cupón borrado'); } catch (e: any) { toast.error(e.message || 'No se pudo borrar'); }
  };

  if (!list) return <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Cargando cupones…</div>;

  return (
    <div className="space-y-3">
      {list.length === 0 && !editing && (
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto"><Ticket className="w-6 h-6" /></div>
          <p className="mt-3 text-[14px] font-semibold text-slate-800">Todavía no tenés cupones</p>
          <p className="text-[13px] text-slate-500 mt-1 max-w-sm mx-auto">Creá un código como <b>VERANO10</b> y compartilo en Instagram o WhatsApp. Tus clientes lo escriben al hacer el pedido.</p>
        </div>
      )}

      {list.map((c) => {
        const st = statusOf(c);
        return (
          <div key={c.code} className="rounded-xl border border-slate-200 p-3.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-[15px] text-slate-900 tracking-wide">{c.code}</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span>
              </div>
              <p className="text-[12.5px] text-slate-500 mt-0.5 truncate">{describe(c)}</p>
              <p className="text-[12px] text-slate-400">
                Usado {c.uses || 0}{c.maxUses ? ` de ${c.maxUses}` : ''} {c.uses === 1 ? 'vez' : 'veces'}
                {c.validUntil ? ` · hasta el ${c.validUntil.split('-').reverse().join('/')}` : ''}
              </p>
            </div>
            <button onClick={() => share(c)} title="Copiar texto para compartir" className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"><Copy className="w-4 h-4" /></button>
            <button onClick={() => setEditing({ c: { ...c }, isNew: false })} title="Editar" className="w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => toggle(c)} className={`h-9 px-3 rounded-lg text-[12.5px] font-semibold ${c.active ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-700'}`}>{c.active ? 'Pausar' : 'Activar'}</button>
            <button onClick={() => remove(c)} title="Borrar" className="w-9 h-9 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
          </div>
        );
      })}

      {editing ? (
        <CouponForm storeId={storeId} initial={editing.c} isNew={editing.isNew} onCancel={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); onChanged?.(); }} />
      ) : (
        <button onClick={() => setEditing({ c: blank(), isNew: true })} className="h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nuevo cupón
        </button>
      )}
    </div>
  );
}

function CouponForm({ storeId, initial, isNew, onCancel, onSaved }: { storeId: string; initial: StoreCoupon; isNew: boolean; onCancel: () => void; onSaved: () => void }) {
  const [c, setC] = useState<StoreCoupon>(initial);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<StoreCoupon>) => setC((x) => ({ ...x, ...p }));
  const num = (v: string) => Number(v.replace(/\D/g, '')) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (c.type === 'percent' && (c.value < 1 || c.value > 100)) return toast.error('El porcentaje va de 1 a 100');
    if (c.type === 'fixed' && c.value < 1) return toast.error('Poné el monto del descuento');
    if (c.validFrom && c.validUntil && c.validUntil < c.validFrom) return toast.error('La fecha de fin es anterior a la de inicio');
    setSaving(true);
    try {
      await saveCoupon(storeId, { ...c, code: normCouponCode(c.code) }, isNew);
      toast.success(isNew ? 'Cupón creado' : 'Cupón guardado');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border-2 border-rose-200 bg-rose-50/30 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[14.5px] font-bold text-slate-900">{isNew ? 'Nuevo cupón' : `Editar ${c.code}`}</p>
        <button type="button" onClick={onCancel} className="w-8 h-8 rounded-lg hover:bg-white text-slate-400 flex items-center justify-center" aria-label="Cancelar"><X className="w-4 h-4" /></button>
      </div>

      <div>
        <span className={label}>Código</span>
        <input className={`${input} font-mono font-bold uppercase tracking-wide`} value={c.code} disabled={!isNew} autoFocus={isNew}
          onChange={(e) => set({ code: normCouponCode(e.target.value) })} placeholder="VERANO10" maxLength={20} required />
        {isNew && <p className="text-[11.5px] text-slate-500 mt-1">Letras y números, sin espacios. Es lo que escribe el cliente.</p>}
      </div>

      <div>
        <span className={label}>Tipo de descuento</span>
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" onClick={() => set({ type: t.id, value: t.id === 'percent' ? 10 : t.id === 'fixed' ? 2000 : 0 })}
                className={`h-11 rounded-xl border text-[13px] font-semibold flex items-center justify-center gap-1.5 ${c.type === t.id ? 'border-rose-500 bg-white text-rose-700 ring-2 ring-rose-500/15' : 'border-slate-200 bg-white text-slate-600'}`}>
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {c.type !== 'shipping' && (
          <div>
            <span className={label}>{c.type === 'percent' ? 'Porcentaje' : 'Monto'}</span>
            <div className="relative">
              {c.type === 'fixed' && <span className="absolute left-3.5 inset-y-0 flex items-center text-slate-400">$</span>}
              <input className={`${input} ${c.type === 'fixed' ? 'pl-7' : 'pr-8'}`} inputMode="numeric" value={c.value || ''} onChange={(e) => set({ value: Math.min(c.type === 'percent' ? 100 : 10_000_000, num(e.target.value)) })} />
              {c.type === 'percent' && <span className="absolute right-3.5 inset-y-0 flex items-center text-slate-400">%</span>}
            </div>
          </div>
        )}
        {c.type === 'percent' && (
          <div>
            <span className={label}>Tope del descuento (opcional)</span>
            <div className="relative"><span className="absolute left-3.5 inset-y-0 flex items-center text-slate-400">$</span>
              <input className={`${input} pl-7`} inputMode="numeric" placeholder="Sin tope" value={c.maxDiscount || ''} onChange={(e) => set({ maxDiscount: num(e.target.value) })} /></div>
          </div>
        )}
        <div>
          <span className={label}>Compra mínima (opcional)</span>
          <div className="relative"><span className="absolute left-3.5 inset-y-0 flex items-center text-slate-400">$</span>
            <input className={`${input} pl-7`} inputMode="numeric" placeholder="Sin mínimo" value={c.minOrder || ''} onChange={(e) => set({ minOrder: num(e.target.value) })} /></div>
        </div>
        <div>
          <span className={label}>Usos en total (opcional)</span>
          <input className={input} inputMode="numeric" placeholder="Sin límite" value={c.maxUses || ''} onChange={(e) => set({ maxUses: num(e.target.value) })} />
        </div>
        <div>
          <span className={label}>Desde (opcional)</span>
          <input type="date" className={input} value={c.validFrom || ''} onChange={(e) => set({ validFrom: e.target.value })} />
        </div>
        <div>
          <span className={label}>Hasta (opcional)</span>
          <input type="date" className={input} value={c.validUntil || ''} min={c.validFrom || undefined} onChange={(e) => set({ validUntil: e.target.value })} />
        </div>
      </div>

      <label className="flex items-center gap-2.5 text-[13.5px] text-slate-700">
        <input type="checkbox" className="w-4 h-4 accent-rose-600" checked={!!c.oncePerCustomer} onChange={(e) => set({ oncePerCustomer: e.target.checked })} />
        Una sola vez por cliente (según su teléfono)
      </label>

      {c.type === 'shipping' && <p className="text-[12px] text-slate-500">Descuenta el costo del envío a domicilio. No aplica a retiro en el local ni a envíos con GoDelivery.</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving || c.code.length < 3} className="h-11 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-semibold flex items-center gap-2 disabled:opacity-60">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} {isNew ? 'Crear cupón' : 'Guardar'}
        </button>
        <button type="button" onClick={onCancel} className="h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-600 text-[14px] font-semibold">Cancelar</button>
      </div>
    </form>
  );
}
