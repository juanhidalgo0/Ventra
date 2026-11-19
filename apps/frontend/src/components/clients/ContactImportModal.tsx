import { useRef, useState } from 'react';
import { FileSpreadsheet, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../services/api';
import { tradeListName, hasTradeList } from '../../stores/businessStore';

interface Summary {
  total: number;
  created: number;
  updated: number;
  withBalance: number;
  balanceTotal: number;
  trade: number;
  problems: string[];
  sample: { name: string; cuit: string | null; dni: string | null; locality: string | null; priceList: string; balance: number; existing: boolean }[];
}

const money = (n: number) => `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

/**
 * Importar clientes o proveedores desde una planilla de otro sistema (Excel o CSV).
 * Primero muestra qué va a hacer (nuevos, ya cargados, saldos) y recién al confirmar guarda.
 */
export default function ContactImportModal({ kind, onClose, onDone }: { kind: 'clients' | 'suppliers'; onClose: () => void; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [result, setResult] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const who = kind === 'clients' ? 'clientes' : 'proveedores';

  const send = async (f: File, dry: boolean) => {
    const form = new FormData();
    form.append('file', f);
    const { data } = await api.post<Summary>(`/contacts-import/${kind}${dry ? '/preview' : ''}`, form);
    return data;
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setFile(f); setPreview(null); setResult(null); setBusy(true);
    try { setPreview(await send(f, true)); }
    catch (e: any) { toast.error(e?.response?.data?.message || 'No pude leer la planilla'); setFile(null); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await send(file, false);
      setResult(r);
      toast.success(`Listo: ${r.created} ${who} nuevos y ${r.updated} actualizados`);
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo importar');
    } finally { setBusy(false); }
  };

  const s = result || preview;
  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-800">Importar {who} desde Excel</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="p-5 space-y-4">
          {!s && (
            <>
              <p className="text-[13px] text-slate-600">
                Subí la planilla que exportaste de tu sistema anterior (Excel o CSV). Se reconocen solas las columnas de nombre,
                razón social, CUIT o DNI, condición de IVA, teléfono, domicilio, localidad{kind === 'clients' ? ', lista de precios' : ', plazo de pago'} y saldo.
                Antes de guardar te muestro qué va a pasar.
              </p>
              <button onClick={() => inputRef.current?.click()} disabled={busy}
                className="w-full h-28 rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-500 flex flex-col items-center justify-center gap-1.5 text-slate-600 cursor-pointer">
                {busy ? <Loader2 className="w-6 h-6 animate-spin text-emerald-600" /> : <FileSpreadsheet className="w-6 h-6 text-emerald-600" />}
                <span className="text-sm font-semibold">{busy ? 'Leyendo…' : 'Elegir planilla'}</span>
              </button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </>
          )}

          {s && (
            <>
              {result && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold">
                  <CheckCircle2 className="w-4 h-4" /> Importación terminada
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 rounded-xl bg-slate-50"><p className="text-xl font-bold text-slate-800">{s.created}</p><p className="text-[11px] text-slate-500">{result ? 'cargados' : 'nuevos'}</p></div>
                <div className="p-3 rounded-xl bg-slate-50"><p className="text-xl font-bold text-slate-800">{s.updated}</p><p className="text-[11px] text-slate-500">ya estaban (se completan)</p></div>
                <div className="p-3 rounded-xl bg-slate-50"><p className="text-xl font-bold text-slate-800">{s.withBalance}</p><p className="text-[11px] text-slate-500">con saldo</p></div>
              </div>
              {s.withBalance > 0 && (
                <p className="text-[12.5px] text-slate-600">
                  Saldos: {money(s.balanceTotal)} en total. Entran como <b>"Saldo anterior al sistema"</b>
                  {kind === 'clients' ? ' en la cuenta corriente de cada cliente.' : ' (una compra a pagar, sin productos: no mueve stock ni la caja).'}
                  {' '}A los que ya estaban no se les toca el saldo.
                </p>
              )}
              {kind === 'clients' && hasTradeList() && s.trade > 0 && (
                <p className="text-[12.5px] text-slate-600">{s.trade} con lista <b>{tradeListName()}</b>; el resto, minorista.</p>
              )}
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                {s.sample.map((r, i) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between gap-2 text-[12.5px]">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{r.name}</p>
                      <p className="text-slate-500">{[r.cuit ? `CUIT ${r.cuit}` : r.dni ? `DNI ${r.dni}` : '', r.locality, kind === 'clients' && r.priceList === 'TRADE' ? tradeListName() : ''].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className="shrink-0 text-slate-600">{r.balance ? money(r.balance) : ''}{r.existing ? ' · ya está' : ''}</span>
                  </div>
                ))}
                {s.total > s.sample.length && <p className="px-3 py-2 text-[12px] text-slate-500">y {s.total - s.sample.length} más</p>}
              </div>
              {s.problems.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-900 space-y-1 max-h-40 overflow-y-auto">
                  <p className="font-bold flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Para revisar</p>
                  {s.problems.map((p, i) => <p key={i}>{p}</p>)}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                {result ? (
                  <button onClick={onClose} className="h-10 px-4 rounded-xl bg-slate-800 text-white text-sm font-semibold cursor-pointer">Cerrar</button>
                ) : (
                  <>
                    <button onClick={() => { setPreview(null); setFile(null); }} disabled={busy} className="h-10 px-4 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 cursor-pointer">Otra planilla</button>
                    <button onClick={confirm} disabled={busy || s.total === 0} className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50">
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />} Importar {s.total} {who}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
