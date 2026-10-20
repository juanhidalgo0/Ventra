import { useMemo, useState } from 'react';
import { usePOSStore, packOf } from '../../stores/posStore';
import { hasFeature } from '../../stores/businessStore';
import { parseVariantAttrs, variantAxes, variantLabel } from '../../utils/variants';
import { haptic } from '../../utils/haptics';
import { Sheet, PrimaryButton, MoneyInput, money, qty, parseAmount } from './ui';

/**
 * Vender desde el celular respetando el rubro, igual que la caja de la PC:
 * - Prendas y tamaños: un modelo con variantes pregunta cuál (talle, color, tamaño).
 * - Por metro, kilo o litro: pregunta cuánto, con decimales.
 * - Precio libre: pregunta el precio.
 * - Distribuidora: se suma de a bulto si el producto tiene bulto.
 */
export const MEASURE: Record<string, { short: string; name: string; chips: number[] }> = {
  MT: { short: 'm', name: 'metros', chips: [0.5, 1, 2, 5, 10] },
  KG: { short: 'kg', name: 'kilos', chips: [0.25, 0.5, 1, 2, 5] },
  L: { short: 'L', name: 'litros', chips: [0.5, 1, 2, 5, 10] },
};
export const isMeasured = (p: any) => !!MEASURE[p?.unit];

export function useRubroAdd() {
  const [group, setGroup] = useState<any | null>(null);
  const [measure, setMeasure] = useState<any | null>(null);
  const [priced, setPriced] = useState<any | null>(null);
  const [amount, setAmount] = useState('');

  const put = (p: any, price?: number, quantity = 1) => {
    const pack = price === undefined && !p.allowCustomPrice ? packOf(p, hasFeature('bulk')) : null;
    if (pack) usePOSStore.getState().addPackToCart(p, pack, 1);
    else usePOSStore.getState().addToCart(p, price, quantity);
    haptic(12);
  };

  /** Lo que pasa al tocar un producto (o al escanearlo) */
  const tap = (p: any) => {
    if (p?._isVariantGroup) { setGroup(p); return; }
    if (p.allowCustomPrice) { setAmount(''); setPriced(p); return; }
    if (isMeasured(p)) { setAmount(''); setMeasure(p); return; }
    put(p);
  };

  const sheets = (
    <>
      <VariantSheet group={group} onClose={() => setGroup(null)} onPick={(v) => { setGroup(null); tap(v); }} />

      <Sheet open={!!priced} onClose={() => setPriced(null)} title={priced?.name}
        footer={<PrimaryButton disabled={parseAmount(amount) <= 0} onClick={() => { put(priced, parseAmount(amount)); setPriced(null); }}>Agregar {parseAmount(amount) > 0 ? money(parseAmount(amount)) : ''}</PrimaryButton>}>
        <p className="text-[14px] text-slate-600 mb-3">¿A qué precio lo cobrás?</p>
        <MoneyInput value={amount} onChange={setAmount} autoFocus />
      </Sheet>

      <Sheet open={!!measure} onClose={() => setMeasure(null)} title={measure?.name}
        footer={<PrimaryButton disabled={parseAmount(amount) <= 0} onClick={() => { put(measure, undefined, parseAmount(amount)); setMeasure(null); }}>
          {parseAmount(amount) > 0 && measure ? `Agregar ${qty(parseAmount(amount))} ${MEASURE[measure.unit].short} · ${money(parseAmount(amount) * (measure.salePrice || 0))}` : 'Agregar'}
        </PrimaryButton>}>
        {measure && (
          <>
            <p className="text-[14px] text-slate-600 mb-3">¿Cuántos {MEASURE[measure.unit].name}? <span className="text-slate-400">({money(measure.salePrice)} el {MEASURE[measure.unit].short})</span></p>
            <input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
              className="w-full h-14 px-4 rounded-2xl bg-slate-50 border border-slate-200 text-[24px] font-bold text-slate-900 outline-none focus:border-rose-500 tabular-nums" />
            <div className="mt-3 flex flex-wrap gap-2">
              {MEASURE[measure.unit].chips.map((c) => (
                <button key={c} onClick={() => setAmount(qty(c))} className="h-10 px-4 rounded-full bg-slate-100 text-[14px] font-semibold text-slate-700 active:scale-95">
                  {qty(c)} {MEASURE[measure.unit].short}
                </button>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </>
  );

  return { tap, sheets };
}

/** Elegir talle / color / tamaño de un modelo, con su precio y stock */
function VariantSheet({ group, onClose, onPick }: { group: any | null; onClose: () => void; onPick: (v: any) => void }) {
  const variants: any[] = group?._variants || [];
  const axes = useMemo(() => variantAxes(variants), [variants]);
  const hasStock = (v: any) => v.unlimitedStock || (v.stock ?? 0) > 0;
  return (
    <Sheet open={!!group} onClose={onClose} title={group?.baseName || group?.name}>
      <p className="text-[13px] text-slate-500 mb-3">Elegí {axes.length ? axes.join(' y ').toLowerCase() : 'cuál'}</p>
      <div className="grid grid-cols-2 gap-2.5">
        {variants.map((v) => {
          const label = variantLabel(parseVariantAttrs(v.variantAttrs)) || v.name;
          return (
            <button key={v.id} onClick={() => onPick(v)}
              className={`text-left p-3 rounded-2xl border-2 active:scale-[0.98] ${hasStock(v) ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
              <span className="block text-[15px] font-bold text-slate-900 leading-tight">{label}</span>
              <span className="block text-[13px] text-slate-600 tabular-nums mt-0.5">{money(v.salePrice)}</span>
              <span className={`block text-[11.5px] mt-0.5 ${hasStock(v) ? 'text-slate-400' : 'text-red-600 font-medium'}`}>
                {v.unlimitedStock ? '' : (v.stock ?? 0) > 0 ? `${qty(v.stock)} en stock` : 'Sin stock'}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Precio que muestra la tarjeta: el del bulto si se vende de a bulto, "desde" si tiene variantes */
export function tilePrice(p: any): { main: string; sub?: string } {
  if (p?._isVariantGroup) {
    const prices = (p._variants || []).map((v: any) => Number(v.salePrice) || 0);
    const min = prices.length ? Math.min(...prices) : p.salePrice;
    const max = prices.length ? Math.max(...prices) : p.salePrice;
    return { main: min === max ? money(min) : `desde ${money(min)}`, sub: `${(p._variants || []).length} opciones` };
  }
  const pack = !p?.allowCustomPrice ? packOf(p, hasFeature('bulk')) : null;
  if (pack) return { main: money(pack.price), sub: `Bulto x${pack.size}` };
  if (p?.allowCustomPrice) return { main: 'Precio libre' };
  if (isMeasured(p)) return { main: money(p.salePrice), sub: `por ${MEASURE[p.unit].short}` };
  return { main: money(p.salePrice) };
}
