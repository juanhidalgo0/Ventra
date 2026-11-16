import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Loader2, FileText, Check, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import FiscalDocModal from '../fiscal/FiscalDocModal';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const day = (d: string) => new Date(d).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' });

/**
 * Factura del mes: todas las compras de un cliente (escuela, organismo) que quedaron sin factura
 * en una sola factura de ARCA. Se eligen las ventas del mes; el mismo producto se suma en un
 * renglón y las devoluciones restan. Ninguna de esas ventas se puede facturar después por separado.
 */
export default function MonthlyInvoiceModal({ client, onClose }: { client: any; onClose: () => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [data, setData] = useState<any | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    const from = month;
    const to = new Date(Math.min(Date.now(), new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime() - 1));
    api.get(`/fiscal/clients/${client.id}/monthly`, { params: { from: from.toISOString(), to: to.toISOString() } })
      .then((r) => { setData(r.data); setPicked(new Set((r.data.sales || []).map((s: any) => s.id))); })
      .catch((err) => { setData(false); toast.error(err?.response?.data?.message || 'No se pudieron traer las ventas'); });
  }, [month, client.id]);

  const total = useMemo(() => (data?.sales || []).filter((s: any) => picked.has(s.id)).reduce((t: number, s: any) => t + s.amount, 0), [data, picked]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const isCurrent = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  const emit = async () => {
    if (!picked.size) return;
    setBusy(true);
    try {
      const { data: d } = await api.post(`/fiscal/clients/${client.id}/monthly`, { saleIds: [...picked] });
      if (d.status === 'AUTHORIZED') toast.success('Factura del mes emitida');
      else if (d.status === 'REJECTED') toast.error(d.error || 'ARCA rechazó la factura');
      else toast('La factura quedó en cola: sale sola apenas ARCA responda', { icon: '⏳' });
      setDoc(d.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo emitir la factura');
    } finally {
      setBusy(false);
    }
  };

  if (doc) return <FiscalDocModal docId={doc} onClose={onClose} />;

  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Factura del mes" className="w-full sm:max-w-lg max-h-[92vh] bg-white rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 flex items-start gap-3 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-bold text-slate-900">Factura del mes</p>
            <p className="text-[13px] text-slate-500 truncate">{client.name}{client.cuit ? ` · CUIT ${client.cuit}` : ''}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="px-5 py-3 flex items-center gap-2 border-b border-slate-100">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Mes anterior"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
          <p className="flex-1 text-center text-[14.5px] font-bold text-slate-800 capitalize">{MONTHS[month.getMonth()]} {month.getFullYear()}</p>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={isCurrent} className="w-9 h-9 rounded-lg hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center cursor-pointer" aria-label="Mes siguiente"><ChevronRight className="w-5 h-5 text-slate-600" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-3">
          {data === null ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
          ) : data === false ? (
            <p className="text-center text-[14px] text-slate-500 py-10">No se pudieron traer las ventas.</p>
          ) : (
            <>
              {!data.enabled && (
                <div className="flex gap-2 px-3.5 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> La facturación electrónica no está activada. Activala en Facturación para emitir.
                </div>
              )}
              {!data.client.cuit && !data.client.dni && (
                <div className="flex gap-2 px-3.5 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> El cliente no tiene CUIT: la factura sale a consumidor final. Cargásela en el cliente si la necesita a su nombre.
                </div>
              )}
              {data.sales.length === 0 ? (
                <p className="text-center text-[14px] text-slate-500 py-10">No hay ventas sin factura en {MONTHS[month.getMonth()]}.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-bold text-slate-700">Ventas sin factura ({data.sales.length})</p>
                    <button onClick={() => setPicked(picked.size === data.sales.length ? new Set() : new Set(data.sales.map((s: any) => s.id)))} className="text-[12.5px] font-semibold text-rose-700 cursor-pointer">
                      {picked.size === data.sales.length ? 'Sacar todas' : 'Elegir todas'}
                    </button>
                  </div>
                  <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                    {data.sales.map((s: any) => {
                      const on = picked.has(s.id);
                      return (
                        <button key={s.id} onClick={() => toggle(s.id)} aria-pressed={on} className="w-full text-left px-3.5 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50">
                          <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? 'bg-rose-600 border-rose-600' : 'border-slate-300 bg-white'}`}>{on && <Check className="w-4 h-4 text-white" />}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14px] font-semibold text-slate-900">{s.isReturn ? 'Devolución' : 'Venta'} N° {s.saleNumber} · {day(s.createdAt)}</span>
                            <span className="block text-[12px] text-slate-500 truncate">{s.summary}</span>
                          </span>
                          <span className={`text-[14.5px] font-bold tabular-nums shrink-0 ${s.amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{money(s.amount)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-slate-500">El mismo producto va en un solo renglón y las devoluciones restan. Después ninguna de estas ventas se puede facturar por separado.</p>
                </>
              )}
            </>
          )}
        </div>

        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] border-t border-slate-100 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-slate-600">{picked.size} {picked.size === 1 ? 'venta' : 'ventas'}</span>
            <span className="text-[20px] font-black text-slate-900 tabular-nums">{money(total)}</span>
          </div>
          <button onClick={emit} disabled={busy || !picked.size || !data?.enabled || total <= 0} className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-[15px] font-bold cursor-pointer flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Emitir una factura por {money(total)}
          </button>
        </div>
      </div>
    </div>
  );
}
