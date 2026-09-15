import { useState, useMemo } from 'react';
import {
  X, 
  Shuffle, 
  Search, 
  Check, 
  Package, 
  Plus, 
  AlertCircle,
  Tag
} from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';

interface SubstitutesModalProps {
  product: any;
  onClose: () => void;
  onSelectSubstitute: (substituteProduct: any) => void;
}

export default function SubstitutesModal({ product, onClose, onSelectSubstitute }: SubstitutesModalProps) {
  const cachedProducts = usePOSStore(state => state.products);
  const [search, setSearch] = useState('');

  // Find substitutes: same category, or sharing keywords, with stock > 0
  const substitutes = useMemo(() => {
    if (!product || !cachedProducts) return [];

    const cleanTokens = (name: string) => {
      return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 1 && !['de', 'para', 'con', 'sin', 'un', 'el', 'la', 'los', 'las'].includes(w));
    };

    const targetTokens = cleanTokens(product.name);

    return cachedProducts
      .filter(p => p.id !== product.id && (p.unlimitedStock || (p.stock && p.stock > 0)))
      .map(p => {
        let score = 0;
        // Same category gives base score
        if (product.categoryId && p.categoryId === product.categoryId) {
          score += 5;
        }
        // Token matches
        const pTokens = cleanTokens(p.name);
        const matchCount = targetTokens.filter(t => pTokens.includes(t)).length;
        score += matchCount * 3;

        return { product: p, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.product);
  }, [product, cachedProducts]);

  const filteredSubstitutes = substitutes.filter(p => {
    if (!search) return true;
    const term = search.toLowerCase();
    return p.name.toLowerCase().includes(term) || (p.barcode && p.barcode.includes(term));
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-slate-900 w-full max-w-2xl h-[75vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Shuffle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-tight text-slate-800 dark:text-white">Productos Equivalentes / Sustitutos</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  Mostrador
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Alternativas recomendadas con stock disponible inmediato</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Out of Stock Product Warning */}
        <div className="p-4 bg-amber-50/80 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-3 shrink-0">
          <div>
            <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">
              Producto Solicitado (Sin Stock)
            </span>
            <p className="text-xs font-black text-slate-900 dark:text-white mt-0.5">
              {product.name}
            </p>
            <span className="text-[10px] font-mono text-rose-600 dark:text-rose-400 font-bold">
              Stock actual: {product.stock} un. • Precio: $${product.salePrice.toLocaleString()}
            </span>
          </div>
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
            Agotado
          </span>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar entre los sustitutos..."
              className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Substitutes List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
          {filteredSubstitutes.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Package className="w-12 h-12 stroke-1 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">No se encontraron productos alternativos con stock</p>
              <p className="text-[11px] text-slate-400 mt-1">Verificá en inventario si existen productos similares en otra categoría.</p>
            </div>
          ) : (
            filteredSubstitutes.map((sub) => (
              <div 
                key={sub.id}
                className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700 rounded-xl flex items-center justify-between gap-3 transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {sub.name}
                    </p>
                    {sub.location && (
                      <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-200 dark:border-amber-800">
                        📍 {sub.location}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      Stock: {sub.stock} {sub.unit || 'un.'}
                    </span>
                    <span>•</span>
                    <span className="font-black text-slate-800 dark:text-slate-200">
                      $${sub.salePrice.toLocaleString()}
                    </span>
                    {sub.barcode && (
                      <>
                        <span>•</span>
                        <span>{sub.barcode}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectSubstitute(sub)}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  Agregar al Ticket
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
