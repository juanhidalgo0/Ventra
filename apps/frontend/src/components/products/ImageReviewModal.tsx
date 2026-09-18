import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check, SkipForward, Ban, Search, Loader2, ImageOff, Images } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import type { ImageOption } from './ImageSearchPicker';

interface Suggestion {
  id: string;
  displayName: string;
  brand: string | null;
  category: string | null;
  query: string;
  products: { id: string; name: string }[];
  candidates: ImageOption[];
}

interface ImageReviewModalProps {
  onClose: () => void;
  onChanged: () => void;
}

const PAGE = 20;

/**
 * Revisión rápida de fotos dudosas: un artículo por vez, con sus candidatas.
 * Teclado: 1-8 elige, Enter acepta, N descarta, S salta.
 */
export default function ImageReviewModal({ onClose, onChanged }: ImageReviewModalProps) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [selected, setSelected] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const current = items[0];

  const load = useCallback(async (skip: number) => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/products/images/hardware/suggestions', { params: { skip, take: PAGE } });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      toast.error('No se pudieron cargar las fotos para revisar');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(0); }, [load]);

  useEffect(() => {
    setSelected(0);
    setSearchText(current?.query || '');
  }, [current?.id]);

  const advance = (resolved: boolean) => {
    if (resolved) {
      setDone(d => d + 1);
      setTotal(t => t - 1);
      onChanged();
    }
    const rest = items.slice(1);
    const nextSkip = resolved ? skipped : skipped + 1;
    if (!resolved) setSkipped(nextSkip);
    if (rest.length === 0) load(nextSkip);
    else setItems(rest);
  };

  const accept = async () => {
    const option = current?.candidates[selected];
    if (!current || !option || isSaving) return;
    setIsSaving(true);
    try {
      const { data } = await api.post(`/products/images/hardware/suggestions/${current.id}/accept`, { url: option.url }, { timeout: 60000 });
      toast.success(`Foto asignada a ${data.assigned} producto${data.assigned === 1 ? '' : 's'}`, { duration: 1200 });
      advance(true);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo asignar la foto');
    } finally {
      setIsSaving(false);
    }
  };

  const reject = async () => {
    if (!current || isSaving) return;
    setIsSaving(true);
    try {
      await api.post(`/products/images/hardware/suggestions/${current.id}/reject`);
      advance(true);
    } catch {
      toast.error('No se pudo descartar');
    } finally {
      setIsSaving(false);
    }
  };

  const research = async () => {
    if (!current || !searchText.trim()) return;
    setIsSearching(true);
    try {
      const { data } = await api.post(`/products/images/hardware/suggestions/${current.id}/search`, { query: searchText }, { timeout: 60000 });
      setItems(prev => [{ ...prev[0], query: data.query, candidates: data.candidates }, ...prev.slice(1)]);
      setSelected(0);
      if (data.candidates.length === 0) toast('Sin resultados para esa búsqueda', { icon: '🔍' });
    } catch {
      toast.error('No se pudo buscar');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter') accept();
      else if (e.key.toLowerCase() === 'n') reject();
      else if (e.key.toLowerCase() === 's') advance(false);
      else if (/^[1-8]$/.test(e.key) && current && Number(e.key) <= current.candidates.length) setSelected(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl"><Images className="w-5 h-5" /></div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Revisar fotos</h2>
              <p className="text-xs text-slate-500">
                {total} artículos para revisar{done > 0 && ` · ${done} resueltos en esta sesión`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {isLoading && (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-rose-600" /></div>
          )}

          {!isLoading && !current && (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-600">
              <Check className="w-10 h-10 text-emerald-600" />
              <p className="font-semibold">No quedan fotos para revisar</p>
              {skipped > 0 && (
                <button onClick={() => { setSkipped(0); load(0); }} className="text-sm text-rose-600 hover:underline">
                  Volver a ver los {skipped} salteados
                </button>
              )}
            </div>
          )}

          {!isLoading && current && (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-bold text-slate-800 leading-tight">{current.displayName}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {[current.brand, current.category].filter(Boolean).join(' · ')}
                  {current.products.length > 1 && ` · la foto se asigna a ${current.products.length} productos (todas las medidas)`}
                </p>
                {current.products.length > 1 && (
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">{current.products.map(p => p.name).join(' / ')}</p>
                )}
              </div>

              <form onSubmit={e => { e.preventDefault(); research(); }} className="flex gap-2">
                <input
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:border-rose-400 outline-none"
                  placeholder="Buscar con otras palabras..."
                />
                <button type="submit" disabled={isSearching} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
                </button>
              </form>

              {current.candidates.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-slate-500 text-sm">
                  <ImageOff className="w-8 h-8" /> Sin fotos. Probá buscar con otras palabras o descartalo.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {current.candidates.map((c, i) => (
                    <button
                      key={c.url}
                      type="button"
                      onClick={() => setSelected(i)}
                      onDoubleClick={() => { setSelected(i); accept(); }}
                      className={`text-left rounded-xl border-2 overflow-hidden transition-colors ${selected === i ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-slate-200 hover:border-slate-400'}`}
                    >
                      <div className="aspect-square bg-white flex items-center justify-center relative p-1">
                        <img src={c.thumb} alt={c.title} referrerPolicy="no-referrer" className="max-w-full max-h-full object-contain" />
                        <span className={`absolute top-1 left-1 w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center ${selected === i ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                      </div>
                      <div className="px-2 py-1.5 border-t border-slate-100">
                        <p className="text-[11px] text-slate-700 line-clamp-2 leading-tight">{c.title}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{c.source}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {current && !isLoading && (
          <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">Teclas: <b>1-8</b> elegir · <b>Enter</b> aceptar · <b>N</b> sin foto · <b>S</b> saltar</p>
            <div className="flex gap-2">
              <button onClick={reject} disabled={isSaving} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5">
                <Ban className="w-4 h-4" /> Ninguna sirve
              </button>
              <button onClick={() => advance(false)} disabled={isSaving} className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-100 flex items-center gap-1.5">
                <SkipForward className="w-4 h-4" /> Saltar
              </button>
              <button
                onClick={accept}
                disabled={isSaving || current.candidates.length === 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Usar foto {selected + 1}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
