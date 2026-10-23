import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Check, Pencil, Trash2, Loader2, PackagePlus, ImageOff } from 'lucide-react';
import api, { resolveServerUrl } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import ProductModal from './ProductModal';

/**
 * Productos que los empleados cargaron desde la caja (un código que no estaba en el sistema).
 * El dueño recibe el aviso y decide: dejarlo como está, editarlo (precio, categoría, foto) o
 * borrarlo. Un vigía (cada 30 s, una consulta liviana) avisa desde cualquier pantalla.
 */

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const SEEN_KEY = 'ventra_product_reviews_seen';
export const OPEN_REVIEWS_EVENT = 'ventra:open-product-reviews';

export function ProductReviewsSheet({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const load = () => api.get('/products/reviews/pending').then(({ data }) => setRows(data || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const done = async (id: string) => {
    await api.post(`/products/reviews/${id}/done`).catch(() => {});
    setRows((r) => (r || []).filter((x) => x.id !== id));
  };
  const keep = async (r: any) => { setBusy(r.id); await done(r.id); setBusy(null); toast.success(`${r.name} quedó como estaba`); };
  const edit = async (r: any) => {
    setBusy(r.id);
    try { setEditing((await api.get(`/products/${r.id}`)).data); } catch { toast.error('No se pudo abrir el producto'); } finally { setBusy(null); }
  };
  const remove = async (r: any) => {
    if (!window.confirm(`¿Borrar "${r.name}"? Si ya se vendió, queda en el historial.`)) return;
    setBusy(r.id);
    try { await api.delete(`/products/${r.id}`); await done(r.id); toast.success('Producto borrado'); }
    catch (err: any) { toast.error(err?.response?.data?.message || 'No se pudo borrar'); }
    finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Productos para revisar" onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-xl max-h-[92dvh] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <span className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0"><PackagePlus className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold text-slate-900 leading-tight">Productos para revisar</p>
            <p className="text-[12.5px] text-slate-500">Los cargaron tus empleados desde la caja. Dejalos como están, editalos o borralos.</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
          {rows === null ? <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
            : rows.length === 0 ? <p className="py-10 text-center text-[14px] text-slate-500">No hay productos para revisar.</p>
            : rows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-200 p-3 flex gap-3">
                <div className="w-16 h-16 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                  {r.imageUrl ? <img src={resolveServerUrl(r.imageUrl)} alt="" className="max-w-full max-h-full object-contain" /> : <ImageOff className="w-5 h-5 text-slate-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold text-slate-900 leading-tight">{r.name}</p>
                  <p className="text-[12.5px] text-slate-500">{r.barcode || 'Sin código'} · venta {money(r.salePrice)}{r.costPrice > 0 ? ` · costo ${money(r.costPrice)}` : ''}</p>
                  <p className="text-[12px] text-slate-400">{r.userName ? `Lo cargó ${r.userName}` : 'Cargado en la caja'} · {new Date(String(r.createdAt).replace(' ', 'T') + (String(r.createdAt).includes('Z') ? '' : 'Z')).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <button onClick={() => keep(r)} disabled={busy === r.id} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"><Check className="w-3.5 h-3.5" /> Está bien</button>
                    <button onClick={() => edit(r)} disabled={busy === r.id} className="h-8 px-3 rounded-lg border border-slate-300 text-slate-700 text-[12.5px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"><Pencil className="w-3.5 h-3.5" /> Editar</button>
                    <button onClick={() => remove(r)} disabled={busy === r.id} className="h-8 px-3 rounded-lg text-rose-700 text-[12.5px] font-bold flex items-center gap-1 cursor-pointer hover:bg-rose-50 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Borrar</button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
      {editing && (
        <ProductModal product={editing} onClose={() => setEditing(null)}
          onSuccess={async () => { const id = editing.id; setEditing(null); await done(id); toast.success('Producto actualizado'); }} />
      )}
    </div>
  );
}

/** Avisa al dueño (y al encargado) cuando un empleado carga un producto nuevo desde la caja */
export default function ProductReviewWatcher() {
  const role = useAuthStore((s) => s.user?.role);
  const [open, setOpen] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_REVIEWS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_REVIEWS_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (role !== 'ADMIN' && role !== 'SUPERVISOR') return;
    let alive = true;
    const check = async () => {
      try {
        const { data } = await api.get('/products/reviews/pending', { silent: true } as any);
        if (!alive) return;
        const rows: any[] = data || [];
        let seen: string[] = [];
        try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { /* nada */ }
        const fresh = rows.filter((r) => !seen.includes(r.id));
        // Al entrar avisa si hay pendientes; después, solo por los nuevos
        const show = first.current ? rows : fresh;
        if (show.length) {
          const r = show[0];
          toast((t) => (
            <span className="flex items-center gap-3">
              <span className="text-[13.5px]">
                <b>{show.length === 1 ? 'Producto nuevo para revisar' : `${show.length} productos nuevos para revisar`}</b>
                <span className="block text-slate-600">{show.length === 1 ? `${r.name}${r.userName ? ` · lo cargó ${r.userName}` : ''}` : 'Los cargaron tus empleados desde la caja'}</span>
              </span>
              <button onClick={() => { toast.dismiss(t.id); setOpen(true); }} className="shrink-0 h-9 px-3 rounded-lg bg-amber-500 text-white text-[13px] font-bold cursor-pointer">Revisar</button>
            </span>
          ), { duration: 12000, id: 'product-reviews' });
        }
        if (fresh.length) { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((x) => x.id)].slice(-300))); } catch { /* sin espacio */ } }
        first.current = false;
      } catch { /* sin servidor: se reintenta */ }
    };
    const start = window.setTimeout(check, 4000);
    const t = window.setInterval(check, 30000);
    return () => { alive = false; window.clearTimeout(start); window.clearInterval(t); };
  }, [role]);

  return open ? <ProductReviewsSheet onClose={() => setOpen(false)} /> : null;
}
