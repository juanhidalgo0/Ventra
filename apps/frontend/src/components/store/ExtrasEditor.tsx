import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Search, Check } from 'lucide-react';
import api from '../../services/api';
import { saveStoreConfig, type ExtraGroup } from '../../services/onlineStore';

const newId = () => Math.random().toString(36).slice(2, 8);
const input = 'w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[14.5px] outline-none focus:border-rose-500 focus:bg-white';

/**
 * Extras de la tienda (borde relleno, agregados): grupos de opciones con precio que se ofrecen
 * en una categoría entera o en productos puntuales. Los elige el cliente en la ficha del producto
 * y se suman al precio. Se guardan en la configuración de la tienda (ventra_stores.extraGroups).
 */
export default function ExtrasEditor({ storeId, initial, onSaved }: { storeId: string; initial: ExtraGroup[]; onSaved?: (g: ExtraGroup[]) => void }) {
  const [groups, setGroups] = useState<ExtraGroup[]>(initial);
  const [saving, setSaving] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; category?: string }[]>([]);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { setGroups(initial); }, [initial]);
  useEffect(() => {
    api.get('/products', { params: { take: 5000 } }).then(({ data }) => {
      const list = ((data?.products || data || []) as any[]).filter((p) => p.isActive !== false && p.showOnline);
      setProducts(list.map((p) => ({ id: p.id, name: p.name, category: p.category?.name })));
      setCats(Array.from(new Set(list.map((p) => p.category?.name || 'Varios'))).sort() as string[]);
    }).catch(() => {});
  }, []);

  const dirty = JSON.stringify(groups) !== JSON.stringify(initial);
  const set = (id: string, p: Partial<ExtraGroup>) => setGroups(groups.map((g) => (g.id === id ? { ...g, ...p } : g)));
  const add = () => setGroups([...groups, { id: newId(), name: '', min: 0, max: 1, categories: [], productIds: [], options: [{ id: newId(), name: '', price: 0 }], active: true }]);

  const save = async () => {
    const clean = groups
      .map((g) => ({ ...g, name: g.name.trim(), options: g.options.map((o) => ({ ...o, name: o.name.trim(), price: Number(o.price) || 0 })).filter((o) => o.name) }))
      .filter((g) => g.name || g.options.length);
    const bad = clean.find((g) => !g.name || !g.options.length || (!g.categories.length && !g.productIds.length));
    if (bad) return toast.error(bad.name ? `"${bad.name}": cargá opciones y elegí dónde se ofrece` : 'Cada grupo necesita un nombre');
    setSaving(true);
    try {
      await saveStoreConfig(storeId, { extraGroups: clean });
      setGroups(clean);
      onSaved?.(clean);
      toast.success('Extras guardados');
    } catch { toast.error('No se pudo guardar'); } finally { setSaving(false); }
  };

  const shownProducts = useMemo(() => {
    const t = q.trim().toLowerCase();
    return products.filter((p) => !t || p.name.toLowerCase().includes(t)).slice(0, 150);
  }, [products, q]);

  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <p className="text-[13px] text-slate-500">Ej.: <b>Borde relleno</b> (muzza +$2.000, muzza y roquefort +$2.500) para todas las pizzas, o <b>Agregados</b> (jamón, huevo) para elegir varios.</p>
      )}
      {groups.map((g) => (
        <div key={g.id} className={`rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3 ${g.active === false ? 'opacity-60' : ''}`}>
          <div className="flex gap-2">
            <input className={input} value={g.name} onChange={(e) => set(g.id, { name: e.target.value })} placeholder="Nombre del grupo (ej. Borde relleno)" />
            <button onClick={() => { if (confirm(`¿Borrar "${g.name || 'este grupo'}"?`)) setGroups(groups.filter((x) => x.id !== g.id)); }} className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0" aria-label="Borrar grupo"><Trash2 className="w-4 h-4 text-slate-500" /></button>
          </div>

          <div className="space-y-2">
            {g.options.map((o, i) => (
              <div key={o.id} className="flex gap-2 items-center">
                <input className={input} value={o.name} onChange={(e) => set(g.id, { options: g.options.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)) })} placeholder={i === 0 ? 'Borde de muzza' : i === 1 ? 'Borde de muzza y roquefort' : 'Otra opción'} />
                <div className="relative w-32 shrink-0">
                  <span className="absolute left-3 inset-y-0 flex items-center text-slate-400 text-[13px]">+$</span>
                  <input className={`${input} pl-8`} inputMode="numeric" value={o.price ? String(o.price) : ''} onChange={(e) => set(g.id, { options: g.options.map((x) => (x.id === o.id ? { ...x, price: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)) })} placeholder="0" />
                </div>
                {g.options.length > 1 && <button onClick={() => set(g.id, { options: g.options.filter((x) => x.id !== o.id) })} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0" aria-label="Quitar opción"><Trash2 className="w-3.5 h-3.5 text-slate-500" /></button>}
              </div>
            ))}
            <button onClick={() => set(g.id, { options: [...g.options, { id: newId(), name: '', price: 0 }] })} className="text-[13px] font-semibold text-rose-700">+ Agregar opción</button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block mb-1 text-[12px] font-medium text-slate-500">¿Cuántas puede elegir?</span>
              <select className={input} value={g.max} onChange={(e) => set(g.id, { max: Number(e.target.value) })}>
                <option value={1}>Solo una</option>
                {[2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>Hasta {n}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block mb-1 text-[12px] font-medium text-slate-500">¿Es obligatorio?</span>
              <select className={input} value={g.min > 0 ? 1 : 0} onChange={(e) => set(g.id, { min: Number(e.target.value) })}>
                <option value={0}>No, es opcional</option>
                <option value={1}>Sí, tiene que elegir</option>
              </select>
            </label>
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-500">Se ofrece en estas categorías</p>
            <div className="flex flex-wrap gap-1.5">
              {cats.length === 0 && <span className="text-[12.5px] text-slate-400">Publicá productos en la tienda para elegir categorías.</span>}
              {cats.map((c) => {
                const on = g.categories.includes(c);
                return <button key={c} onClick={() => set(g.id, { categories: on ? g.categories.filter((x) => x !== c) : [...g.categories, c] })}
                  className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{c}</button>;
              })}
            </div>
            <button onClick={() => { setPickingFor(pickingFor === g.id ? null : g.id); setQ(''); }} className="mt-2 text-[12.5px] font-semibold text-slate-600">
              {g.productIds.length ? `Y en ${g.productIds.length} producto${g.productIds.length === 1 ? '' : 's'} puntual${g.productIds.length === 1 ? '' : 'es'}` : 'O elegir productos puntuales'} ›
            </button>
            {!!g.excludeIds?.length && (
              <p className="mt-1.5 text-[12.5px] text-slate-500">
                Excepto: {g.excludeIds.map((id) => products.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || `${g.excludeIds.length} productos`}
                <button onClick={() => set(g.id, { excludeIds: [] })} className="ml-2 font-semibold text-rose-700">Quitar excepciones</button>
              </p>
            )}
            {pickingFor === g.id && (
              <div className="mt-2 rounded-xl border border-slate-200">
                <div className="relative border-b border-slate-100">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" className="w-full h-10 pl-9 pr-3 bg-transparent outline-none text-[13.5px]" />
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {shownProducts.map((p) => {
                    const on = g.productIds.includes(p.id);
                    return (
                      <button key={p.id} onClick={() => set(g.id, { productIds: on ? g.productIds.filter((x) => x !== p.id) : [...g.productIds, p.id] })} className="w-full flex items-center gap-2.5 px-3 py-2 text-left">
                        <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-rose-600 border-rose-600' : 'border-slate-300'}`}>{on && <Check className="w-3.5 h-3.5 text-white" />}</span>
                        <span className="flex-1 min-w-0 text-[13px] text-slate-800 truncate">{p.name}</span>
                        {p.category && <span className="text-[11.5px] text-slate-400 shrink-0">{p.category}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-[13px] text-slate-600">
            <input type="checkbox" className="w-4 h-4 accent-rose-600" checked={g.active !== false} onChange={(e) => set(g.id, { active: e.target.checked })} /> Se ofrece en la tienda
          </label>
        </div>
      ))}

      <div className="flex gap-2">
        <button onClick={add} className="h-11 px-4 rounded-xl bg-rose-50 text-rose-700 text-[13.5px] font-semibold flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nuevo grupo de extras</button>
        {dirty && <button onClick={save} disabled={saving} className="flex-1 h-11 rounded-xl bg-rose-600 text-white text-[14px] font-semibold disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar extras'}</button>}
      </div>
      <p className="text-[11.5px] text-slate-400">Los cambios se ven en la tienda al instante, sin volver a publicar los productos.</p>
    </div>
  );
}
