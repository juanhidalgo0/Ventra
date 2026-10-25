import { Bike, ShoppingCart, X } from 'lucide-react';
import { GoOrder, loadGoOrderInCart } from './goOrders';

/**
 * Pedidos de GO en curso, desde la caja. El repartidor llega al mostrador con la lista en el
 * celular: "Cobrar en la caja" arma el ticket y se cobra como cualquier venta.
 */
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const STATUS: Record<string, string> = {
  pending: 'Buscando repartidor', accepted: 'El repartidor viene a comprar', confirmed: 'El repartidor viene a comprar',
  preparing: 'Preparando', ready: 'Listo', delivering: 'Ya compró: en camino',
};

export default function GoOrdersModal({ orders, onClose }: { orders: GoOrder[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[90vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <Bike className="w-5 h-5 text-emerald-700 shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-slate-900">Pedidos de GO</h2>
            <p className="text-[12.5px] text-slate-500">El repartidor paga en el mostrador como cualquier cliente.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {orders.length === 0 ? (
            <p className="py-10 text-center text-[14px] text-slate-500">No hay pedidos de GO en curso.</p>
          ) : orders.map((o) => {
            const missing = o.items.filter((i) => i.shopStatus === 'missing').length;
            return (
              <div key={o.id} className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14.5px] font-semibold text-slate-800 break-words">
                      {o.number ? `Pedido #${o.number}` : 'Pedido'}{o.driverName ? ` · ${o.driverName}` : ''}
                    </p>
                    <p className="text-[12.5px] text-slate-500">
                      {STATUS[o.status] || o.status} · {o.items.length} producto{o.items.length === 1 ? '' : 's'}{missing ? ` · faltaron ${missing}` : ''}
                    </p>
                  </div>
                  <span className="text-[15px] font-bold text-slate-800 tabular-nums shrink-0">{money(o.shopPending ? o.estimatedSubtotal : o.subtotal)}</span>
                </div>
                <ul className="text-[13px] text-slate-600 space-y-0.5">
                  {o.items.map((i, k) => (
                    <li key={k} className="flex gap-2">
                      <span className="w-8 text-slate-400 tabular-nums shrink-0">{i.shopStatus === 'missing' ? (i.orderedQty ?? i.qty) : i.qty}×</span>
                      <span className={`flex-1 min-w-0 break-words ${i.shopStatus === 'missing' ? 'line-through text-slate-400' : ''}`}>
                        {i.name}
                        {i.shopStatus === 'missing' && <span className="text-amber-700 font-semibold"> · no había</span>}
                        {i.shopStatus === 'partial' && <span className="text-amber-600 font-semibold"> · había {i.qty} de {i.orderedQty}</span>}
                        {i.shopStatus === 'replaced' && i.replacement && <span className="text-amber-600 font-semibold"> · cambiado por {i.replacement.name}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => { if (loadGoOrderInCart(o)) onClose(); }}
                  className="w-full h-11 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[14px] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ShoppingCart className="w-4 h-4" /> Cobrar en la caja
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
