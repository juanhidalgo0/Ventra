import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ScanBarcode, ChevronRight, Copy, Sparkles } from 'lucide-react';
import api from '../../services/api';

/**
 * Primera boleta de un proveedor (plan-boletas-ia.md, tanda 3.3 y 3.4): todavía no se sabe cómo nombra
 * ese proveedor a tus productos, así que los renglones que no se reconocieron se asocian de corrido, uno
 * tras otro, con las sugerencias a la vista. Parado en un renglón, se pasa el lector por el producto:
 * si el código ya existe se asocia a ese; si no, queda como código del producto nuevo. Salta solo al
 * siguiente. Lo que se asocia acá se aprende: la próxima boleta de este proveedor sale en segundos.
 */
export interface FirstRow { productId: string; lineId?: string; name: string; sku?: string; barcode?: string; isNew?: boolean; candidates?: { id: string; name: string }[]; shared?: { name?: string | null; confidence?: string } | null }

export default function FirstInvoicePanel<T extends FirstRow>({ items, onAssociate, onSetBarcode, onOpenDuplicates }: {
  items: T[];
  onAssociate: (row: T, productId: string) => Promise<void> | void;
  onSetBarcode: (row: T, barcode: string) => void;
  onOpenDuplicates: () => void;
}) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const key = (r: T) => r.lineId || r.productId;

  const total = items.length;
  const known = items.filter((i) => !i.isNew).length;
  // Pendientes: los nuevos sin código de barras que todavía no se saltearon
  const pending = useMemo(() => items.filter((i) => i.isNew && !i.barcode && !skipped.includes(key(i))), [items, skipped]);
  const current = pending[0] || null;
  useEffect(() => { inputRef.current?.focus(); }, [current ? key(current) : '']);

  const scan = async () => {
    const c = code.trim();
    if (!c || !current) return;
    setBusy(true);
    try {
      // ¿Ya tenés un producto con ese código? Se asocia a ese. Si no, es el código del producto nuevo.
      const { data } = await api.get(`/products/barcode/${encodeURIComponent(c)}`, { silent: true } as any).catch(() => ({ data: null }));
      if (data?.id) await onAssociate(current, data.id);
      else { onSetBarcode(current, c); toast.success(`Código ${c} guardado para el producto nuevo`); }
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const pct = total ? Math.round((known / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 mb-3">
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-slate-800">Primera boleta de este proveedor</p>
          <p className="text-[12.5px] text-slate-600">La primera boleta de cada proveedor lleva unos minutos. Las próximas son segundos: Ventra aprende cómo llama este proveedor a cada producto.</p>
        </div>
        <button onClick={onOpenDuplicates} className="shrink-0 h-8 px-3 rounded-lg border border-slate-300 bg-white text-[12px] font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"><Copy className="w-3.5 h-3.5" /> Productos repetidos</button>
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-[12.5px] font-semibold text-slate-700"><span>{known} de {total} reconocidos</span><span>{pending.length ? `${pending.length} para asociar` : 'Listo'}</span></div>
        <div className="mt-1 h-2 rounded-full bg-white border border-sky-100 overflow-hidden"><div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
      {current && (
        <div className="mt-3 rounded-xl bg-white border border-slate-200 p-3">
          <p className="text-[12px] text-slate-500">En la boleta dice{current.sku ? ` (código ${current.sku})` : ''}:</p>
          <p className="text-[14px] font-bold text-slate-800">{current.name}</p>
          {current.shared?.name && current.shared.confidence !== 'alta' && <p className="text-[12px] text-sky-700">Otro comercio lo cargó como {current.shared.name}</p>}
          {current.candidates?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-[12px] text-slate-500 self-center">¿Es alguno de estos?</span>
              {current.candidates.map((c) => (
                <button key={c.id} disabled={busy} onClick={() => onAssociate(current, c.id)} className="h-7 px-2.5 rounded-full border border-slate-300 text-[12px] font-semibold text-slate-700 hover:bg-emerald-50 hover:border-emerald-300 cursor-pointer">{c.name}</button>
              ))}
            </div>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <ScanBarcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(); } }}
                placeholder="Pasá el lector por el producto" className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 text-[13px] outline-none focus:border-sky-500" />
            </div>
            <button onClick={() => setSkipped((s) => [...s, key(current)])} className="h-9 px-3 rounded-lg border border-slate-300 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer">Es nuevo, sin código <ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
