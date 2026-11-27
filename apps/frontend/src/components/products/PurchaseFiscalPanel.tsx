import { Plus, X } from 'lucide-react';
import { PROVINCES, docKindInfo, type DocKind, type FiscalExtras, type FiscalTotals } from '../../utils/purchaseFiscal';

/**
 * Totales de una compra con comprobante (como los cargaba Limpissimo en Fidel): subtotal, descuento
 * general, IVA por alícuota (Factura A), percepciones de IVA, Ingresos Brutos (por provincia) y
 * Ganancias, redondeo y total. El presupuesto (en negro) no lleva IVA ni percepciones.
 */
interface Props {
  kind: Exclude<DocKind, ''>;
  totals: FiscalTotals;
  extras: FiscalExtras;
  setExtras: (fn: (prev: FiscalExtras) => FiscalExtras) => void;
}

const money = (n: number) => `$ ${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: string) => { const n = parseFloat(v.replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export default function PurchaseFiscalPanel({ kind, totals, extras, setExtras }: Props) {
  const info = docKindInfo(kind);
  const withTaxes = kind !== 'X';
  const set = (k: keyof FiscalExtras, v: any) => setExtras((prev) => ({ ...prev, [k]: v }));
  const setIibb = (i: number, patch: Partial<{ province: string; amount: number }>) =>
    setExtras((prev) => ({ ...prev, iibb: prev.iibb.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  const row = 'flex items-center justify-between gap-4 text-[13px]';
  const lbl = 'font-semibold text-slate-600';
  const val = 'font-semibold text-slate-800 tabular-nums';
  const inp = 'h-8 w-28 rounded-lg border border-slate-300 bg-white px-2 text-right text-[13px] font-semibold text-slate-800 outline-none focus:border-emerald-500 tabular-nums';
  const field = (value: number, onChange: (n: number) => void, title?: string) => (
    <input type="number" step="any" value={value || ''} placeholder="0" title={title}
      onChange={(e) => onChange(num(e.target.value))} onFocus={(e) => e.target.select()} className={inp} />
  );

  return (
    <div className="w-full max-w-[440px] space-y-2">
      <div className="flex items-center justify-between pb-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{info?.label}</span>
        <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${info?.blanco ? 'bg-sky-100 text-sky-800' : 'bg-slate-800 text-white'}`}>
          {info?.blanco ? 'En blanco' : 'En negro'}
        </span>
      </div>

      <div className={row}>
        <span className={lbl}>{kind === 'A' ? 'Subtotal (sin IVA)' : 'Subtotal'}</span>
        <span className={val}>{money(totals.subtotal)}</span>
      </div>
      <div className={row}>
        <span className={lbl}>Descuento</span>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <input type="number" step="any" min={0} max={100} value={extras.discountPct || ''} placeholder="0" title="Descuento en %"
              onChange={(e) => set('discountPct', Math.min(100, Math.max(0, num(e.target.value))))} onFocus={(e) => e.target.select()}
              className={`${inp.replace('w-28', 'w-20')} pr-6`} />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-slate-400">%</span>
          </div>
          <span className="text-[12px] text-slate-400">+ $</span>
          {field(extras.discountAmt, (n) => set('discountAmt', Math.max(0, n)), 'Descuento en pesos')}
        </div>
      </div>
      {totals.discount > 0 && (
        <div className={row}>
          <span className="text-[12px] text-slate-500">Se descuenta</span>
          <span className="text-[13px] font-semibold text-rose-700 tabular-nums">− {money(totals.discount)}</span>
        </div>
      )}

      {kind === 'A' && (
        <>
          <div className={`${row} border-t border-slate-200 pt-2`}>
            <span className={lbl}>Neto gravado</span>
            <span className={val}>{money(totals.net)}</span>
          </div>
          {totals.ivaDetail.filter((d) => d.base !== 0).map((d) => (
            <div key={d.rate} className={row}>
              <span className={lbl}>IVA {String(d.rate).replace('.', ',')}% <span className="font-normal text-slate-400">sobre {money(d.base)}</span></span>
              <span className={val}>{money(d.amount)}</span>
            </div>
          ))}
        </>
      )}

      {withTaxes && (
        <div className="border-t border-slate-200 pt-2 space-y-2">
          <div className={row}>
            <span className={lbl}>Percepción IVA</span>
            {field(extras.percIva, (n) => set('percIva', n))}
          </div>
          <div className={row}>
            <span className={lbl}>Percepción Ganancias</span>
            {field(extras.percGanancias, (n) => set('percGanancias', n))}
          </div>
          <div className="space-y-1.5">
            <div className={row}>
              <span className={lbl}>Percepción Ingresos Brutos</span>
              <button type="button" onClick={() => setExtras((prev) => ({ ...prev, iibb: [...prev.iibb, { province: prev.iibb.length ? '' : 'Santa Fe', amount: 0 }] }))}
                className="h-7 px-2 rounded-lg text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1 cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Provincia
              </button>
            </div>
            {extras.iibb.map((p, i) => (
              <div key={i} className="flex items-center justify-end gap-1.5">
                <select value={p.province} onChange={(e) => setIibb(i, { province: e.target.value })}
                  className="h-8 flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-[12.5px] font-medium text-slate-700 outline-none focus:border-emerald-500 cursor-pointer">
                  <option value="">Elegí la provincia</option>
                  {PROVINCES.map((pr) => <option key={pr} value={pr}>{pr}</option>)}
                </select>
                {field(p.amount, (n) => setIibb(i, { amount: n }))}
                <button type="button" onClick={() => setExtras((prev) => ({ ...prev, iibb: prev.iibb.filter((_, j) => j !== i) }))}
                  title="Sacar" className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${row} border-t border-slate-200 pt-2`}>
        <span className={lbl}>Redondeo</span>
        {field(extras.rounding, (n) => set('rounding', n), 'Lo que redondea la factura (puede ser negativo)')}
      </div>

      <div className="flex items-end justify-between gap-6 border-t border-slate-400/60 pt-2">
        <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest pb-1">Total</span>
        <div className="text-3xl font-extrabold text-slate-800 whitespace-nowrap tabular-nums">{money(totals.total)}</div>
      </div>
    </div>
  );
}
