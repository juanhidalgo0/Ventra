import { Utensils, ShoppingBag, Bike } from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';

/**
 * Modo gastronomía de la caja (rubro GASTRONOMIA): la misma caja, con lo que pide un local de
 * comidas. Carta con pestañas grandes, tarjetas sin código de barras ni stock (se cocina a
 * pedido) y el tipo de pedido arriba del ticket: Mesa, Para llevar o Delivery. El tipo viaja
 * con la venta como nota y sale impreso en el ticket.
 */

const EMOJI: [RegExp, string][] = [
  [/pizza/i, '🍕'], [/empanad/i, '🥟'], [/hamburgues|burger/i, '🍔'], [/lomit|s[aá]ndwich|sanguch|milanes/i, '🥪'],
  [/papa|frita/i, '🍟'], [/pasta|ñoqui|ravioli|fideo|sorrentin/i, '🍝'], [/ensalad|veggie|vegetari/i, '🥗'],
  [/carne|parrill|asado|bife/i, '🥩'], [/pollo/i, '🍗'], [/sushi|roll/i, '🍣'], [/taco|mexican|burrito/i, '🌮'],
  [/cerveza|birra/i, '🍺'], [/vino/i, '🍷'], [/trago|c[oó]ctel|aperitiv/i, '🍹'], [/caf[eé]|infusi|t[eé]\b/i, '☕'],
  [/helad/i, '🍨'], [/postre|dulce|torta|tarta/i, '🍰'], [/medialuna|factura|panader/i, '🥐'], [/desayuno|merienda/i, '🥞'],
  [/bebida|gaseosa|agua|jugo|refresco|soda/i, '🥤'], [/promo|combo/i, '🎁'],
];

/** Emoji para una categoría (o un producto) de la carta */
export function foodEmoji(name?: string | null): string {
  const n = String(name || '');
  return EMOJI.find(([re]) => re.test(n))?.[1] || '🍽️';
}

/** La nota que viaja con la venta: "MESA 4", "PARA LLEVAR", "DELIVERY · Av. Mitre 123" */
export function orderNote(order: { type: string; table: string; address: string }): string {
  if (order.type === 'MESA') return `MESA ${order.table.trim() || '?'}`;
  if (order.type === 'DELIVERY') return `DELIVERY${order.address.trim() ? ` · ${order.address.trim()}` : ''}`;
  return 'PARA LLEVAR';
}

/** ¿La nota de una venta es un tipo de pedido? (para destacarla en el ticket) */
export const isOrderNote = (notes?: string | null) => !!notes && /^(MESA |PARA LLEVAR|DELIVERY)/.test(notes);

const TYPES = [
  { id: 'MESA', label: 'Mesa', icon: Utensils },
  { id: 'LLEVAR', label: 'Para llevar', icon: ShoppingBag },
  { id: 'DELIVERY', label: 'Delivery', icon: Bike },
] as const;

/** Tipo de pedido, arriba del ticket */
export function OrderTypeBar() {
  const order = usePOSStore((s) => s.order);
  const setOrder = usePOSStore((s) => s.setOrder);
  return (
    <div data-tour="pos-pedido" className="px-4 pb-3 shrink-0">
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/50">
        {TYPES.map(({ id, label, icon: Icon }) => {
          const on = order.type === id;
          return (
            <button key={id} type="button" onClick={() => setOrder({ type: id })}
              className={`h-10 rounded-xl text-[12.5px] font-bold flex items-center justify-center gap-1.5 transition-colors active:scale-[0.97] ${on ? 'bg-amber-500 text-white shadow-sm' : 'text-amber-900/80 dark:text-amber-200/80 hover:bg-amber-100/70 dark:hover:bg-amber-900/30'}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          );
        })}
      </div>
      {order.type === 'MESA' && (
        <div className="mt-2 flex items-center gap-2 anim-rise">
          <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">Mesa</span>
          <div className="flex gap-1 flex-1 overflow-x-auto no-scrollbar">
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => (
              <button key={n} type="button" onClick={() => setOrder({ table: n })}
                className={`w-9 h-9 shrink-0 rounded-lg text-[13px] font-bold border transition-colors ${order.table === n ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900' : 'bg-white dark:bg-slate-850 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}>{n}</button>
            ))}
          </div>
          <input value={/^\d{1,2}$/.test(order.table) && Number(order.table) <= 12 ? '' : order.table} onChange={(e) => setOrder({ table: e.target.value.slice(0, 6) })}
            placeholder="Otra" className="w-14 h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-[13px] text-center outline-none focus:border-amber-500" />
        </div>
      )}
      {order.type === 'DELIVERY' && (
        <input value={order.address} onChange={(e) => setOrder({ address: e.target.value.slice(0, 120) })}
          placeholder="Dirección de entrega (opcional)"
          className="mt-2 w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-[13px] outline-none focus:border-amber-500 anim-rise" />
      )}
    </div>
  );
}
