import { useEffect, useState } from 'react';
import { X, Tags, Loader2, ArrowRight } from 'lucide-react';
import api from '../../services/api';
import BarcodeLabelModal from './BarcodeLabelModal';

const money = (n: number) => `$ ${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const PERIODS = [{ days: 1, label: 'Hoy' }, { days: 7, label: 'Últimos 7 días' }, { days: 30, label: 'Últimos 30 días' }];

interface Change { id: string; name: string; salePrice: number; prevSalePrice: number | null; changedAt: number }

/**
 * Etiquetas de los productos que cambiaron de precio (después de una boleta o una lista de
 * precios): se eligen y se imprimen con el precio nuevo, sin buscarlos uno por uno.
 */
export default function PriceChangesLabelsModal({ onClose, initialDays = 1 }: { onClose: () => void; initialDays?: number }) {
  const [days, setDays] = useState(initialDays);
  const [rows, setRows] = useState<Change[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    setRows(null);
    api.get('/products/price-changes', { params: { days } })
      .then(({ data }) => {
        const list: Change[] = data || [];
        setRows(list);
        setChecked(Object.fromEntries(list.map((r) => [r.id, true])));
      })
      .catch(() => setRows([]));
  }, [days]);

  const selected = (rows || []).filter((r) => checked[r.id]);

  if (printing) {
    return (
      <BarcodeLabelModal
        title="Etiquetas de los precios que cambiaron"
        initialItems={selected.map((r) => ({ productId: r.id, quantity: 1 }))}
        defaultShowPrice
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl"><Tags className="w-5 h-5" /></div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Etiquetas de los precios que cambiaron</h2>
              <p className="text-xs text-slate-500">Para cambiar las de la góndola después de una boleta o una lista de precios</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 pt-3 flex flex-wrap items-center gap-1.5 shrink-0">
          {PERIODS.map((p) => (
            <button key={p.days} onClick={() => setDays(p.days)} className={`px-3 py-1.5 rounded-full text-[12px] font-semibold ${days === p.days ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{p.label}</button>
          ))}
          {!!rows?.length && (
            <button onClick={() => { const all = rows.every((r) => checked[r.id]); setChecked(Object.fromEntries(rows.map((r) => [r.id, !all]))); }}
              className="ml-auto text-[12px] font-semibold text-rose-700">{rows.every((r) => checked[r.id]) ? 'Desmarcar todos' : 'Marcar todos'}</button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {!rows ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Buscando…</p>
          ) : !rows.length ? (
            <p className="text-center text-sm text-slate-500 py-10">No cambió ningún precio en este período.</p>
          ) : (
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {rows.map((r) => (
                <label key={r.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={!!checked[r.id]} onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked }))} className="w-4 h-4 accent-rose-600 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-800 truncate">{r.name}</span>
                    <span className="block text-[11px] text-slate-400">{new Date(r.changedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] tabular-nums text-slate-700">
                    {r.prevSalePrice !== null && <>{money(r.prevSalePrice)} <ArrowRight className="inline w-3 h-3 text-slate-400" /> </>}<b>{money(r.salePrice)}</b>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[12px] text-slate-600"><b>{selected.length}</b> {selected.length === 1 ? 'etiqueta' : 'etiquetas'} con el precio nuevo</p>
          <button onClick={() => setPrinting(true)} disabled={!selected.length}
            className="h-10 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-50">Preparar etiquetas</button>
        </div>
      </div>
    </div>
  );
}
