import { useEffect, useMemo, useState } from 'react';
import { PackagePlus, X, Check } from 'lucide-react';
import api from '../../services/api';
import { useBusinessStore } from '../../stores/businessStore';

/**
 * Catálogo inicial: al empezar (rubro elegido y menos de 20 productos), ofrece cargar de una los
 * productos más vendidos del rubro entre todos los comercios de Ventra (últimos 90 días, se
 * recalcula cada semana en la nube). Se cargan sin precio: la caja lo pide la primera vez que se
 * venden y lo guarda. Se ofrece una sola vez por PC (o hasta que lo cierren).
 */
const SEEN_KEY = 'initial_catalog_offered';
interface Item { barcode: string | null; name: string; category: string | null; unit: string; imageUrl: string | null; rank: number; exists?: boolean }

export default function InitialCatalogOffer() {
  const profile = useBusinessStore((s) => s.profile);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    let alive = true;
    try { if (localStorage.getItem(SEEN_KEY)) return; } catch { return; }
    if (!profile || !localStorage.getItem('business_profile')) return;
    const t = window.setTimeout(async () => {
      try {
        const { data: count } = await api.get('/products/count');
        if ((typeof count === 'number' ? count : count?.count ?? 0) >= 20) return;
        const { data } = await api.get(`/products/initial-catalog/${profile}`);
        const list: Item[] = (data?.items || []).filter((i: Item) => !i.exists);
        if (alive && list.length >= 10) { setItems(list); setOpen(true); }
      } catch { /* sin vinculación o sin internet: no se ofrece */ }
    }, 4000);
    return () => { alive = false; window.clearTimeout(t); };
  }, [profile]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) { const k = i.category || 'Otros'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [items]);
  const key = (i: Item) => i.barcode || i.name;
  const chosen = items.filter((i) => !off.has(key(i)));

  const close = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* nada */ } setOpen(false); };
  const toggleGroup = (list: Item[], on: boolean) => setOff((prev) => {
    const n = new Set(prev); for (const i of list) { if (on) n.delete(key(i)); else n.add(key(i)); } return n;
  });

  const load = async () => {
    setBusy(true);
    let total = 0;
    for (let i = 0; i < chosen.length; i += 40) {
      try { const { data } = await api.post('/products/initial-catalog/import', { items: chosen.slice(i, i + 40) }); total += data?.created || 0; } catch { /* sigue con la próxima tanda */ }
      setDone(Math.min(chosen.length, i + 40));
    }
    setBusy(false);
    close();
    window.location.reload(); // la caja vuelve a leer el catálogo con los productos nuevos
    return total;
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9000] bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col border border-slate-200 dark:border-slate-700 shadow-2xl">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center shrink-0"><PackagePlus className="w-6 h-6" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">¿Empezás con los productos más vendidos de tu rubro?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Son los {items.length} que más se vendieron en los últimos 3 meses en comercios como el tuyo. Se cargan <b>sin precio</b>: la primera vez que vendas cada uno, la caja te lo pide y lo guarda.</p>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {groups.map(([cat, list]) => {
            const on = list.filter((i) => !off.has(key(i))).length;
            return (
              <div key={cat} className="rounded-xl border border-slate-200 dark:border-slate-700">
                <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/60 rounded-t-xl cursor-pointer">
                  <input type="checkbox" checked={on === list.length} onChange={(e) => toggleGroup(list, e.target.checked)} />
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{cat}</span>
                  <span className="text-xs text-slate-400 ml-auto">{on} de {list.length}</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 px-3 py-2">
                  {list.map((i) => (
                    <label key={key(i)} className="flex items-center gap-2 py-1 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer min-w-0">
                      <input type="checkbox" checked={!off.has(key(i))} onChange={(e) => toggleGroup([i], e.target.checked)} />
                      <span className="truncate">{i.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <button onClick={close} disabled={busy} className="px-4 h-11 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200">Ahora no</button>
          <button onClick={load} disabled={busy || !chosen.length} className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? `Cargando… ${done} de ${chosen.length}` : <><Check className="w-4 h-4" /> Cargar {chosen.length} productos</>}
          </button>
        </div>
      </div>
    </div>
  );
}
