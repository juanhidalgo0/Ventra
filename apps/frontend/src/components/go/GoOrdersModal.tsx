import { Bike, Clock, ShoppingCart, X } from 'lucide-react';
import { GoOrder, loadGoOrderInCart } from './goOrders';
import { GoMark } from './GoOrderAlert';

/**
 * Pedidos de GO en curso, desde la caja. El repartidor llega al mostrador con la lista en el
 * celular: "Cobrar en la caja" arma el ticket y se cobra como cualquier venta (es opcional).
 */
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Buscando repartidor', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  accepted: { label: 'Viene a comprar', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  confirmed: { label: 'Viene a comprar', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  preparing: { label: 'Preparando', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  ready: { label: 'Listo', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  delivering: { label: 'Ya compró · en camino', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
};
const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`;
};

export default function GoOrdersModal({ orders, onClose }: { orders: GoOrder[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-xl max-h-[90vh] bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 bg-white border-b border-slate-200">
          <GoMark size={38} />
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-slate-900 leading-tight">Pedidos de GO</h2>
            <p className="text-[12.5px] text-slate-500 leading-snug">
              {orders.length ? `${orders.length} en curso` : 'Sin pedidos en curso'} · el repartidor paga en el mostrador como cualquier cliente
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {orders.length > 0 && (
            <p className="text-[12px] text-slate-500 leading-snug px-1">
              Es opcional: si preferís, cobrale normal. “Cobrar en la caja” carga el pedido en el ticket para ir más rápido.
            </p>
          )}
          {orders.length === 0 ? (
            <div className="py-14 text-center">
              <Bike className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-[14px] text-slate-500">No hay pedidos de GO en curso.</p>
            </div>
          ) : orders.map((o) => {
            const missing = o.items.filter((i) => i.shopStatus === 'missing').length;
            const st = STATUS[o.status] || { label: o.status, cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
            const total = o.shopPending ? o.estimatedSubtotal : o.subtotal;
            return (
              <div key={o.id} className="bg-white rounded-2xl ring-1 ring-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-start gap-3 px-4 pt-4 pb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[16px] font-bold text-slate-900 tabular-nums">{o.number ? `#${o.number}` : 'Pedido'}</span>
                      <span className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-full ring-1 ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[12px] text-slate-500 flex-wrap">
                      <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{ago(o.createdMs)}</span>
                      {o.driverName && <span className="inline-flex items-center gap-1"><Bike className="w-3.5 h-3.5" />{o.driverName}</span>}
                      <span>{o.items.length} producto{o.items.length === 1 ? '' : 's'}{missing ? ` · faltaron ${missing}` : ''}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[18px] font-bold text-slate-900 tabular-nums leading-tight">{money(total)}</div>
                    {o.shopPending && <div className="text-[11px] text-slate-400">aproximado</div>}
                  </div>
                </div>

                <ul className="mx-4 mb-3 rounded-xl bg-slate-50 divide-y divide-slate-100">
                  {o.items.map((i, k) => {
                    const gone = i.shopStatus === 'missing';
                    const qty = gone ? (i.orderedQty ?? i.qty) : i.qty;
                    return (
                      <li key={k} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                        <span className={`min-w-[30px] h-6 px-1.5 rounded-md text-[12px] font-semibold tabular-nums flex items-center justify-center ${gone ? 'bg-slate-100 text-slate-400' : 'bg-white ring-1 ring-slate-200 text-slate-700'}`}>{qty}×</span>
                        <span className={`flex-1 min-w-0 break-words ${gone ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                          {i.name}
                          {gone && <span className="no-underline text-amber-700 font-semibold"> · no había</span>}
                          {i.shopStatus === 'partial' && <span className="text-amber-600 font-semibold"> · había {i.qty} de {i.orderedQty}</span>}
                          {i.shopStatus === 'replaced' && i.replacement && <span className="text-amber-600 font-semibold"> · cambiado por {i.replacement.name}</span>}
                        </span>
                        {!gone && <span className="text-slate-400 tabular-nums shrink-0">{money(i.qty * i.price)}</span>}
                      </li>
                    );
                  })}
                </ul>

                <div className="px-4 pb-4">
                  <button
                    onClick={() => { if (loadGoOrderInCart(o)) onClose(); }}
                    className="w-full h-11 rounded-xl bg-[#0b0b0c] hover:bg-black text-white font-semibold text-[14px] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShoppingCart className="w-4 h-4" /> Cobrar en la caja
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
