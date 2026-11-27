import { docKindInfo } from '../../utils/purchaseFiscal';

const money = (n: number) => `$ ${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Fact. A" en azul (en blanco) o "Presup." en negro: para saber de un vistazo si se le puede transferir o dar cheque */
export function FiscalBadge({ fiscal, className = '' }: { fiscal?: any; className?: string }) {
  const info = docKindInfo(fiscal?.kind);
  if (!info) return null;
  return (
    <span title={info.blanco ? `${info.label}: en blanco` : 'Presupuesto: en negro'}
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold normal-case tracking-normal whitespace-nowrap ${info.blanco ? 'bg-sky-100 text-sky-800' : 'bg-slate-800 text-white'} ${className}`}>
      {info.short} · {info.blanco ? 'En blanco' : 'En negro'}
    </span>
  );
}

/** El detalle de la factura en la compra ya cargada: descuento, IVA por alícuota, percepciones y redondeo */
export function FiscalSummary({ fiscal }: { fiscal?: any }) {
  const info = docKindInfo(fiscal?.kind);
  if (!info) return null;
  const rows: [string, number][] = [
    [fiscal.kind === 'A' ? 'Subtotal sin IVA' : 'Subtotal', fiscal.subtotal],
    ...(fiscal.discount ? [[`Descuento${fiscal.discountPct ? ` (${fiscal.discountPct}%)` : ''}`, -fiscal.discount] as [string, number]] : []),
    ...(fiscal.kind === 'A' ? [['Neto gravado', fiscal.net] as [string, number]] : []),
    ...((fiscal.ivaDetail || []).filter((d: any) => d.amount).map((d: any) => [`IVA ${String(d.rate).replace('.', ',')}%`, d.amount] as [string, number])),
    ...(fiscal.percIva ? [['Percepción IVA', fiscal.percIva] as [string, number]] : []),
    ...((fiscal.iibb || []).map((p: any) => [`Percepción IIBB${p.province ? ` ${p.province}` : ''}`, p.amount] as [string, number])),
    ...(fiscal.percGanancias ? [['Percepción Ganancias', fiscal.percGanancias] as [string, number]] : []),
    ...(fiscal.rounding ? [['Redondeo', fiscal.rounding] as [string, number]] : []),
  ];
  return (
    <div className="bg-slate-50 border border-slate-300 p-4 rounded-xl space-y-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Comprobante</span>
        <FiscalBadge fiscal={fiscal} />
      </div>
      {rows.map(([label, v], i) => (
        <div key={i} className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-600">{label}</span>
          <span className={`font-bold tabular-nums ${v < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{v < 0 ? `− ${money(-v)}` : money(v)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs border-t border-slate-300 pt-1.5">
        <span className="font-extrabold text-slate-700 uppercase tracking-wider text-[10px]">Total</span>
        <span className="font-extrabold text-slate-900 tabular-nums">{money(fiscal.total)}</span>
      </div>
    </div>
  );
}
