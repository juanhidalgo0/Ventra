import { useEffect, useMemo } from 'react';
import { X, Shirt } from 'lucide-react';
import { parseVariantAttrs, variantAxes, variantValues, variantLabel } from '../../utils/variants';

interface VariantPickerModalProps {
  /** El modelo colapsado: trae `_variants` con todas sus variantes activas */
  group: any;
  /** Encabezado alternativo, p. ej. cuando se está eligiendo el talle de un cambio */
  title?: string;
  onSelect: (variant: any) => void;
  onClose: () => void;
}

/** Al tocar un modelo en el POS, elegir el talle / color antes de agregarlo al carrito. */
export default function VariantPickerModal({ group, title, onSelect, onClose }: VariantPickerModalProps) {
  const variants: any[] = group?._variants || [];
  const axes = useMemo(() => variantAxes(variants), [variants]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Con dos atributos (talle x color) la grilla se lee mucho mejor que una lista de botones
  const grid = useMemo(() => {
    if (axes.length < 2) return null;
    const [rowAxis, colAxis] = axes;
    const rows = variantValues(variants, rowAxis);
    const cols = variantValues(variants, colAxis);
    const at = (row: string, col: string) =>
      variants.find((v) => {
        const a = parseVariantAttrs(v.variantAttrs);
        return a[rowAxis] === row && a[colAxis] === col;
      });
    return { rowAxis, colAxis, rows, cols, at };
  }, [axes, variants]);

  const hasStock = (v: any) => v.unlimitedStock || v.stock > 0;

  // Celdas grandes: esto se toca con el dedo en el mostrador, no con el mouse
  const cell = (v: any, label: string) => (
    <button
      key={v.id}
      onClick={() => { onSelect(v); onClose(); }}
      className={`group p-3 rounded-2xl border-2 text-left transition-all active:scale-[0.98] cursor-pointer flex flex-col gap-2 ${
        hasStock(v)
          ? 'bg-white dark:bg-slate-850 border-slate-250 dark:border-slate-750 hover:border-emerald-500 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 hover:shadow-md'
          : 'bg-slate-50 dark:bg-slate-850/50 border-slate-200 dark:border-slate-800 hover:border-slate-300'
      }`}
      title={v.name}
    >
      {/* La foto del color ayuda más que el nombre cuando el cliente señala "ese" */}
      {v.imageUrl && (
        <img
          src={v.imageUrl}
          alt={label}
          loading="lazy"
          className={`w-full h-24 object-contain rounded-xl bg-white dark:bg-slate-100 ${hasStock(v) ? '' : 'opacity-40 grayscale'}`}
        />
      )}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className={`text-base font-black truncate ${hasStock(v) ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-600'}`}>
          {label}
        </span>
        <span
          className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full shrink-0 ${
            hasStock(v)
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
              : 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
          }`}
        >
          {v.unlimitedStock ? '∞' : v.stock}
        </span>
      </div>
      <span className={`text-[11px] font-semibold -mt-1 ${hasStock(v) ? 'text-slate-500 dark:text-slate-400' : 'text-rose-500'}`}>
        {v.unlimitedStock ? 'Sin límite' : hasStock(v) ? `${v.stock} en stock` : 'Sin stock'}
      </span>
    </button>
  );

  // Pocas variantes no tienen que abrir una ventana enorme y medio vacía
  const widthClass = variants.length <= 4 ? 'max-w-md' : variants.length <= 9 ? 'max-w-2xl' : 'max-w-4xl';
  const cellsGrid = 'grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]';

  return (
    <div
      className="fixed inset-0 z-[120] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-slate-900 rounded-3xl w-full ${widthClass} shadow-2xl ring-1 ring-black/5 border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]`}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-teal-600/10 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
              <Shirt className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-900 dark:text-slate-50 truncate leading-tight">
                {title || group?.baseName || group?.name}
              </h2>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                {title ? group?.baseName || group?.name : `Elegí el talle · ${variants.length} variantes`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0"
            title="Cerrar (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar">
          {grid ? (
            <div className="space-y-4">
              {grid.rows.map((row) => (
                <div key={row}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">
                      {grid.rowAxis}
                    </span>
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                      {row}
                    </span>
                    <span className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
                  </div>
                  <div className={cellsGrid}>
                    {grid.cols.map((col) => {
                      const v = grid.at(row, col);
                      return v
                        ? cell(v, col)
                        : (
                          <div
                            key={`${row}-${col}`}
                            className="p-3 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-center min-h-[3.5rem]"
                          >
                            <span className="text-[11px] font-bold text-slate-300 dark:text-slate-700">{col}: no hay</span>
                          </div>
                        );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={cellsGrid}>
              {variants.map((v) => cell(v, variantLabel(parseVariantAttrs(v.variantAttrs)) || v.name))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
