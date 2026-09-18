import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Loader2, ImageOff, Check } from 'lucide-react';
import api from '../../services/api';

export interface ImageOption {
  url: string;
  thumb: string;
  title: string;
  source: string;
  score?: number;
}

interface ImageSearchPickerProps {
  initialQuery: string;
  onClose: () => void;
  onSelect: (option: ImageOption) => void;
}

/** Buscador de fotos en catálogos de tiendas para elegir la imagen de un producto a mano. */
export default function ImageSearchPicker({ initialQuery, onClose, onSelect }: ImageSearchPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ImageOption[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await api.get<ImageOption[]>('/products/images/search', { params: { q }, timeout: 60000 });
      setResults(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo buscar');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { search(initialQuery); }, []);

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Buscar foto</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={e => { e.preventDefault(); search(query); }} className="p-4 flex gap-2 border-b border-slate-100">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ej: tee termofusión 25 mm"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-rose-400 outline-none"
          />
          <button type="submit" disabled={isLoading} className="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-60">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
          </button>
        </form>

        <div className="p-4 overflow-y-auto">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {results && results.length === 0 && !isLoading && (
            <div className="flex flex-col items-center gap-2 py-10 text-slate-500 text-sm">
              <ImageOff className="w-8 h-8" />
              No se encontraron fotos. Probá con menos palabras o sin la medida.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {results?.map(r => (
              <button
                key={r.url}
                type="button"
                onClick={() => onSelect(r)}
                className="group text-left rounded-xl border border-slate-200 hover:border-emerald-500 overflow-hidden bg-white"
                title={r.title}
              >
                <div className="aspect-square bg-white flex items-center justify-center relative">
                  <img src={r.thumb} alt={r.title} loading="lazy" referrerPolicy="no-referrer" className="max-w-full max-h-full object-contain" />
                  <span className="absolute inset-0 bg-emerald-600/0 group-hover:bg-emerald-600/10 flex items-center justify-center">
                    <Check className="w-7 h-7 text-emerald-600 opacity-0 group-hover:opacity-100" />
                  </span>
                </div>
                <div className="px-2 py-1.5 border-t border-slate-100">
                  <p className="text-[11px] text-slate-700 line-clamp-2 leading-tight">{r.title}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{r.source}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
