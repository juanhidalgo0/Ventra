import { useMemo, useRef, useState } from 'react';
import { X, FileText, Loader2, Check, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

interface Item { productId: string; name: string; code: string; hasImage: boolean; image: string }
interface Result { token: string; images: number; unmatched: number; matched: number; withImage: number; items: Item[] }

/**
 * Fotos desde un catálogo en PDF (el del proveedor o el del sistema anterior): el servidor
 * empareja cada foto con el producto cuyo código está al lado; acá se revisa y se confirma.
 * Por defecto solo se ponen a los que no tienen foto.
 */
export default function PdfPhotosModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [replace, setReplace] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const read = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast.error('Elegí un archivo PDF');
    setReading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/products/images/from-pdf/preview', form, { timeout: 300000 } as any);
      setRes(data);
      setOff(new Set());
      if (!data.matched) toast.error('No encontramos fotos con códigos de tus productos en ese PDF');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo leer el PDF');
    } finally {
      setReading(false);
    }
  };

  const chosen = useMemo(() => (res?.items || []).filter((i) => (replace || !i.hasImage) && !off.has(i.productId)), [res, replace, off]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (res?.items || []).filter((i) => !q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  }, [res, filter]);
  const toggle = (id: string) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    if (!res || !chosen.length) return;
    setSaving(true);
    try {
      let saved = 0;
      // De a tandas: así un catálogo grande no queda en un solo pedido largo
      for (let i = 0; i < chosen.length; i += 100) {
        const { data } = await api.post('/products/images/from-pdf/apply', { token: res.token, productIds: chosen.slice(i, i + 100).map((x) => x.productId) }, { timeout: 120000 } as any);
        saved += data.saved || 0;
      }
      toast.success(`Listo: ${saved} ${saved === 1 ? 'foto puesta' : 'fotos puestas'}`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron guardar las fotos');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-rose-600" />
            <div>
              <h3 className="text-base font-bold text-slate-800">Fotos desde un catálogo PDF</h3>
              <p className="text-[12px] text-slate-500">Cada foto va al producto cuyo código está escrito al lado (código interno o de barras)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        {!res ? (
          <div className="p-8 flex flex-col items-center text-center gap-3">
            <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
            <button onClick={() => input.current?.click()} disabled={reading}
              className="h-12 px-6 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center gap-2 cursor-pointer disabled:opacity-60">
              {reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {reading ? 'Leyendo el PDF… (puede tardar un minuto)' : 'Elegir el PDF'}
            </button>
            <p className="text-[12.5px] text-slate-500 max-w-md">Sirve para el catálogo o la lista de precios con fotos que te pasa un proveedor o tu sistema anterior. Antes de guardar vas a ver cada foto con su producto.</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
              <span className="text-slate-700"><b>{res.matched}</b> fotos con su producto{res.unmatched ? ` · ${res.unmatched} sin un código de tus productos al lado (logos o productos que no tenés cargados)` : ''}</span>
              {res.withImage > 0 && (
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-rose-600" />
                  Cambiar también las de {res.withImage} {res.withImage === 1 ? 'producto que ya tiene' : 'productos que ya tienen'} foto
                </label>
              )}
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar producto o código" className="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 text-[12.5px] w-56" />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {shown.map((i) => {
                const blocked = i.hasImage && !replace;
                const on = !blocked && !off.has(i.productId);
                return (
                  <button key={i.productId} type="button" disabled={blocked} onClick={() => toggle(i.productId)}
                    title={blocked ? 'Ya tiene foto: tildá "Cambiar también…" para reemplazarla' : on ? 'Se pone esta foto (tocá para no ponerla)' : 'No se pone (tocá para ponerla)'}
                    className={`relative text-left rounded-xl border p-2 transition cursor-pointer disabled:cursor-default ${on ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-200 opacity-50'}`}>
                    <img src={i.image} alt="" className="w-full aspect-square object-contain bg-white rounded-lg" />
                    {on && <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center"><Check className="w-3.5 h-3.5" /></span>}
                    <span className="block mt-1.5 text-[11px] font-mono text-slate-500">{i.code}</span>
                    <span className="block text-[11.5px] font-semibold text-slate-800 leading-tight line-clamp-2">{i.name}</span>
                    {i.hasImage && <span className="block text-[10.5px] text-amber-700 mt-0.5">Ya tiene foto</span>}
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-3">
              <button onClick={() => setRes(null)} className="text-[13px] font-semibold text-slate-600 hover:underline cursor-pointer">Elegir otro PDF</button>
              <button onClick={save} disabled={saving || !chosen.length}
                className="h-10 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Poner {chosen.length} {chosen.length === 1 ? 'foto' : 'fotos'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
