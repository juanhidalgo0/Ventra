import { useState } from 'react';
import { Utensils, ShoppingBag, Bike } from 'lucide-react';
import { usePOSStore } from '../../stores/posStore';
import { lockShortcuts } from '../../utils/shortcutLock';

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

// ─── Comanda: aclaración por ítem y pizzas mitad y mitad ───

const isPizza = (p: any) => /pizza/i.test(`${p?.category?.name || ''} ${p?.baseName || ''} ${p?.name || ''}`);
const sizeOf = (p: any) => Object.values(parseAttrs(p?.variantAttrs)).join(' · ');
function parseAttrs(raw: any): Record<string, string> {
  if (!raw) return {};
  try { const v = typeof raw === 'string' ? JSON.parse(raw) : raw; return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
const shortName = (p: any) => String(p?.baseName || p?.name || '').replace(/^pizza\s+/i, '');

/** Cambia la aclaración de un ítem del ticket */
export function setItemNote(cartKey: string, note: string) {
  const st = usePOSStore.getState();
  usePOSStore.setState({ cart: st.cart.map((i) => (i.cartKey === cartKey ? { ...i, note: note.trim().slice(0, 120) || undefined } : i)) });
}

/**
 * Convierte una pizza del ticket en mitad y mitad con otra del mismo tamaño: se cobra la mitad
 * del precio de cada una (y la venta registra media pizza de cada una, ver getCheckoutPayload).
 */
export function makeHalf(cartKey: string, otherId: string) {
  const st = usePOSStore.getState();
  const item = st.cart.find((i) => i.cartKey === cartKey);
  const a = st.products.find((p) => p.id === item?.productId);
  const b = st.products.find((p) => p.id === otherId);
  if (!item || !a || !b) return;
  const pa = Number(a.salePrice) || 0, pb = Number(b.salePrice) || 0;
  const price = Math.round(((pa + pb) / 2) * 100) / 100;
  const size = sizeOf(a);
  const half = {
    ...item,
    cartKey: `half_${a.id}_${b.id}_${Date.now()}`,
    productId: a.id,
    name: `Pizza ½ ${shortName(a)} ½ ${shortName(b)}${size ? ` (${size})` : ''}`,
    price, regularPrice: price, originalSalePrice: price, isCustomPrice: true,
    half: { a: a.id, b: b.id, pa, pb },
  };
  usePOSStore.setState({ cart: st.cart.map((i) => (i.cartKey === cartKey ? half : i)) });
}

/** Debajo de cada ítem del ticket: su aclaración y, en las pizzas, "½ y ½" */
export function ItemComanda({ item }: { item: any }) {
  const products = usePOSStore((s) => s.products);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.note || '');
  const [picking, setPicking] = useState(false);
  const product = products.find((p) => p.id === item.productId);
  const canHalf = !item.half && !item.isPromo && !item.isReturn && product && isPizza(product);
  const others = canHalf ? products.filter((p) => p.id !== product.id && isPizza(p) && sizeOf(p) === sizeOf(product)) : [];

  const save = () => { setItemNote(item.cartKey, text); setEditing(false); };
  if (editing) {
    return (
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={120}
        onFocus={() => { (window as any).__releaseNoteLock = lockShortcuts(); }}
        onBlur={() => { (window as any).__releaseNoteLock?.(); save(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { e.stopPropagation(); setText(item.note || ''); setEditing(false); } }}
        placeholder="Ej.: sin cebolla, bien cocida"
        className="mt-1 w-full h-8 px-2 rounded-lg border border-amber-300 bg-amber-50/60 dark:bg-amber-950/30 text-[12px] outline-none focus:border-amber-500" />
    );
  }
  return (
    <div className="mt-1 relative">
      {item.note && (
        <button type="button" onClick={() => { setText(item.note || ''); setEditing(true); }} className="block text-left text-[11.5px] italic font-medium text-amber-700 dark:text-amber-300 leading-snug">“{item.note}”</button>
      )}
      <div className="flex gap-1.5 mt-0.5">
        {!item.note && (
          <button type="button" onClick={() => { setText(''); setEditing(true); }} className="text-[11px] font-semibold text-slate-400 hover:text-amber-700 dark:hover:text-amber-300">+ Aclaración</button>
        )}
        {canHalf && others.length > 0 && (
          <button type="button" onClick={() => setPicking((v) => !v)} className="text-[11px] font-semibold text-slate-400 hover:text-amber-700 dark:hover:text-amber-300">½ y ½</button>
        )}
      </div>
      {picking && (
        <div className="absolute z-30 left-0 top-full mt-1 w-56 max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1 anim-rise">
          <p className="px-2 pt-1.5 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">La otra mitad</p>
          {others.map((p) => (
            <button key={p.id} type="button" onClick={() => { makeHalf(item.cartKey, p.id); setPicking(false); }}
              className="w-full text-left px-2 py-1.5 rounded-lg text-[12.5px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-slate-800">
              {shortName(p)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Nota de la venta en gastronomía: tipo de pedido y, debajo, las aclaraciones de la comanda */
export function saleNote(order: { type: string; table: string; address: string }, cart: any[]): string {
  const lines = cart.filter((i) => i.note).map((i) => `${i.quantity}x ${i.name}: ${i.note}`);
  return [orderNote(order), ...lines].join('\n').slice(0, 1000);
}
