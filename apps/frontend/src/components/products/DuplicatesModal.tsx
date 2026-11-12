import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Loader2, Copy, Check } from 'lucide-react';
import api from '../../services/api';

/**
 * Productos repetidos (ProductMergeService en el backend): el mismo producto cargado dos veces, con otro
 * nombre o por una boleta. Se elige cuál queda y los demás se juntan en ese (pasan sus códigos de
 * barras, stock y lotes; nada se borra y se puede separar). "Son distintos" no lo vuelve a ofrecer.
 * Se abre desde la revisión de boletas y al terminar la primera boleta de un proveedor (tanda 3.5).
 */
interface DupProduct { id: string; name: string; barcode: string | null; extraBarcodes: string[]; salePrice: number; stock: number; sold: number }
interface DupGroup { key: string; kind: 'igual' | 'parecido'; looksDistinct: boolean; why: string | null; keepId: string; products: DupProduct[] }

const pesos = (n: number) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

export default function DuplicatesModal({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get('/products/duplicates?limit=100');
      const list: DupGroup[] = (data?.groups || []).filter((g: DupGroup) => !g.looksDistinct);
      setGroups(list);
      setKeep(Object.fromEntries(list.map((g) => [g.key, g.keepId])));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudieron buscar los repetidos');
      setGroups([]);
    }
  };
  useEffect(() => { load(); }, []);

  const merge = async (g: DupGroup) => {
    const keepId = keep[g.key] || g.keepId;
    const kept = g.products.find((p) => p.id === keepId);
    if (!window.confirm(`¿Juntar en "${kept?.name}"? Los otros se ocultan y le pasan sus códigos de barras y su stock. Se puede separar después.`)) return;
    setBusy(g.key);
    try {
      await api.post('/products/merge', { keepId, mergeIds: g.products.map((p) => p.id).filter((id) => id !== keepId) });
      toast.success('Listo: quedaron juntos');
      setGroups((prev) => (prev || []).filter((x) => x.key !== g.key));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudieron juntar');
    } finally {
      setBusy(null);
    }
  };
  const distinct = async (g: DupGroup) => {
    setBusy(g.key);
    try {
      await api.post('/products/duplicates/distinct', { ids: g.products.map((p) => p.id) });
      setGroups((prev) => (prev || []).filter((x) => x.key !== g.key));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[230] bg-black/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-xl border border-slate-300 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-200">
          <Copy className="w-5 h-5 text-rose-500" />
          <h3 className="flex-1 text-[15px] font-bold text-slate-800">Productos repetidos</h3>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <p className="px-5 pt-3 text-[12.5px] text-slate-600">El mismo producto cargado dos veces: elegí cuál queda y juntalos. Nada se borra y se puede separar después.</p>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!groups ? (
            <div className="py-10 flex items-center justify-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin keep-animated" /> Buscando repetidos…</div>
          ) : !groups.length ? (
            <div className="py-10 text-center text-[13.5px] text-slate-600"><Check className="w-8 h-8 mx-auto text-emerald-600 mb-2" />No hay productos repetidos.</div>
          ) : groups.map((g) => (
            <div key={g.key} className="rounded-xl border border-slate-200 p-3">
              <div className="space-y-1.5">
                {g.products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2.5 text-[13px] cursor-pointer">
                    <input type="radio" name={g.key} checked={(keep[g.key] || g.keepId) === p.id} onChange={() => setKeep((k) => ({ ...k, [g.key]: p.id }))} className="accent-rose-600" />
                    <span className="flex-1 min-w-0 truncate font-semibold text-slate-800">{p.name}</span>
                    <span className="shrink-0 text-slate-500 tabular-nums">{p.barcode || 'sin código'} · stock {p.stock} · vendidos {p.sold} · {pesos(p.salePrice)}</span>
                  </label>
                ))}
              </div>
              {g.why && <p className="mt-1.5 text-[11.5px] text-amber-700">{g.why}</p>}
              <div className="mt-2.5 flex gap-2 justify-end">
                <button onClick={() => distinct(g)} disabled={busy === g.key} className="h-8 px-3 rounded-lg border border-slate-300 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50">Son distintos</button>
                <button onClick={() => merge(g)} disabled={busy === g.key} className="h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[12px] font-bold cursor-pointer disabled:opacity-50">Juntar en el elegido</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
