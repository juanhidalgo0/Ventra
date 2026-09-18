import { useMemo, useState } from 'react';
import { X, Search, LayoutGrid } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  parentCategoryId?: string | null;
  parentCategory?: { id: string; name: string } | null;
  _count?: { products?: number };
}

interface CategoryPickerModalProps {
  categories: Category[];
  selectedCategory: string | null;
  topCategoryIds: string[];
  onSelect: (categoryId: string | null) => void;
  onClose: () => void;
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Panel con todos los rubros, con buscador: reemplaza a la tira horizontal cuando son muchos. */
export default function CategoryPickerModal({ categories, selectedCategory, topCategoryIds, onSelect, onClose }: CategoryPickerModalProps) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = normalize(query.trim());
    const matching = categories.filter(c => !q || normalize(c.name).includes(q));

    const top = matching.filter(c => topCategoryIds.includes(c.id));
    const rest = [...matching].sort((a, b) => a.name.localeCompare(b.name, 'es'));

    const byLetter = new Map<string, Category[]>();
    for (const c of rest) {
      const letter = (normalize(c.name)[0] || '#').toUpperCase();
      byLetter.set(letter, [...(byLetter.get(letter) || []), c]);
    }
    return { top, byLetter: [...byLetter.entries()] };
  }, [categories, query, topCategoryIds]);

  const button = (c: Category) => (
    <button
      key={c.id}
      onClick={() => { onSelect(c.id); onClose(); }}
      className={`px-3 py-2 rounded-xl text-xs text-left transition-all active:scale-[0.98] border ${
        selectedCategory === c.id
          ? 'bg-teal-700 text-white border-teal-700 font-bold'
          : 'bg-white dark:bg-slate-850 hover:bg-teal-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-250 border-slate-250 dark:border-slate-750 font-medium'
      }`}
    >
      <span className="block truncate">{c.name}</span>
      {c._count?.products !== undefined && (
        <span className={`block text-[10px] ${selectedCategory === c.id ? 'text-teal-100' : 'text-slate-400'}`}>
          {c._count.products} productos
        </span>
      )}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-full"
      >
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4.5 h-4.5 text-teal-700 dark:text-teal-400" />
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Rubros ({categories.length})</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar rubro..."
              className="w-full bg-white dark:bg-slate-850 border border-slate-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-teal-500"
            />
          </div>
          <button
            onClick={() => { onSelect(null); onClose(); }}
            className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-250 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Ver todos
          </button>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar space-y-5">
          {groups.top.length > 0 && !query && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Más vendidos</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{groups.top.map(button)}</div>
            </div>
          )}

          {groups.byLetter.map(([letter, cats]) => (
            <div key={letter}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{letter}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{cats.map(button)}</div>
            </div>
          ))}

          {groups.byLetter.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-10">Ningún rubro coincide con "{query}"</p>
          )}
        </div>
      </div>
    </div>
  );
}
