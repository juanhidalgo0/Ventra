import { useState } from 'react';
import toast from 'react-hot-toast';
import { ReceiptText, Trash2 } from 'lucide-react';
import api from '../../services/api';

/**
 * Nota de crédito del proveedor (plan-boletas-ia.md, tanda 5.2), en la revisión de boletas. No es una
 * compra: resta de lo que le debés al proveedor. El stock solo se resta si devolviste la mercadería
 * (se tilda acá). Nunca cambia costos ni precios de venta.
 */
const pesos = (n: number) => `$ ${Math.round(Math.abs(Number(n) || 0)).toLocaleString('es-AR')}`;

export default function CreditNotePanel({ purchase, onDone, onDiscard }: { purchase: any; onDone: () => void; onDiscard: () => void }) {
  const d = purchase.draft || {};
  const items: any[] = d.items || [];
  const [total, setTotal] = useState<string>(String(Math.abs(Number(d.printedTotal) || Number(purchase.total) || 0) || ''));
  const [returnStock, setReturnStock] = useState(false);
  const [busy, setBusy] = useState(false);
  const supplierId = purchase.supplierId || d.matchedSupplier?.id;
  const linked = items.filter((it) => it.product?.id);

  const confirm = async () => {
    const t = Number(String(total).replace(',', '.'));
    if (!(t > 0)) return toast.error('Escribí el total de la nota de crédito');
    if (!supplierId) return toast.error('Falta el proveedor');
    setBusy(true);
    try {
      await api.post(`/purchases/${purchase.id}/credit-note`, {
        supplierId, invoiceNumber: d.invoiceNumber || purchase.invoiceNumber || null, total: t, returnStock,
        items: linked.map((it) => ({ productId: it.product.id, quantity: Number(it.quantity) || 0 })),
      });
      toast.success(`Nota de crédito cargada: le debés ${pesos(t)} menos a ${d.matchedSupplier?.name || 'este proveedor'}.${returnStock && linked.length ? ' Se restó el stock devuelto.' : ''}`, { duration: 7000 });
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo cargar la nota de crédito');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto rounded-2xl border border-violet-200 bg-white p-5">
        <div className="flex items-center gap-2.5">
          <ReceiptText className="w-5 h-5 text-violet-600" />
          <h3 className="text-[16px] font-bold text-slate-800 flex-1">Nota de crédito{d.invoiceNumber ? ` N° ${d.invoiceNumber}` : ''}</h3>
          <span className="text-[13px] font-semibold text-slate-600">{d.matchedSupplier?.name || d.supplierName || 'Proveedor'}</span>
        </div>
        <p className="mt-1.5 text-[13px] text-slate-600">No es una compra: <b>resta de lo que le debés al proveedor</b>. No cambia costos ni precios de venta.</p>
        <label className="mt-4 block text-[12.5px] font-semibold text-slate-700">Total de la nota de crédito</label>
        <div className="mt-1 relative max-w-[240px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-slate-500">$</span>
          <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className="w-full h-10 pl-7 pr-3 rounded-lg border border-slate-300 text-[14px] font-bold outline-none focus:border-violet-500" />
        </div>
        {items.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 divide-y divide-slate-100">
            {items.map((it, i) => (
              <div key={i} className="px-3 py-2 text-[13px] flex justify-between gap-3">
                <span className="min-w-0 truncate">{it.quantity} × {it.product?.name || it.name}{!it.product && <span className="ml-1.5 text-[11px] text-amber-700">sin asociar</span>}</span>
                <span className="shrink-0 tabular-nums text-slate-600">{pesos(it.total * 1.21)}</span>
              </div>
            ))}
          </div>
        )}
        <label className="mt-4 flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={returnStock} onChange={(e) => setReturnStock(e.target.checked)} className="w-5 h-5 mt-0.5 accent-violet-600 shrink-0" />
          <span className="text-[13px] text-slate-700"><b className="block text-slate-900">Devolví esta mercadería al proveedor</b>Se resta del stock{linked.length < items.length ? ` (solo los ${linked.length} renglones asociados a un producto)` : ''}. Si es un descuento o una diferencia de precio, dejalo sin tildar.</span>
        </label>
        <div className="mt-5 flex gap-2 justify-end">
          <button onClick={onDiscard} disabled={busy} className="h-10 px-4 rounded-xl border border-slate-300 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"><Trash2 className="w-4 h-4" /> Descartar</button>
          <button onClick={confirm} disabled={busy} className="h-10 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-bold cursor-pointer disabled:opacity-60">Confirmar nota de crédito</button>
        </div>
      </div>
    </div>
  );
}
