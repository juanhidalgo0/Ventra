import { useEffect, useState } from 'react';
import { X, Printer, Loader2, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import TicketReceipt from '../pos/TicketReceipt';
import { nombreComprobante, numeroComprobante, qrImagen } from '../pos/InvoiceModal';
import { canPrintSilently, getAutoPrintInvoice, printSilently } from '../../utils/ticketPrinter';

export const formatPrice = (p: number) => {
  const rounded = Math.round((Number(p) || 0) * 100) / 100;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: rounded % 1 === 0 ? 0 : 2,
  }).format(rounded);
};

/** Mismo CSS de impresión que el ticket del cobro: solo sale el comprobante, a 80 mm. */
const PRINT_CSS = `
  @media print {
    @page { size: 80mm 297mm; margin: 0 !important; }
    * { transform: none !important; animation: none !important; }
    html, body, #root { margin: 0 !important; padding: 0 !important; background: #fff !important; width: 80mm !important; }
    body * { visibility: hidden !important; }
    #printable-receipt, #printable-receipt * { visibility: visible !important; }
    #printable-receipt {
      display: block !important; position: absolute !important; left: 0 !important; top: 0 !important;
      width: 80mm !important; max-width: 80mm !important;
      font-family: 'Courier New', Courier, monospace !important; font-size: 8.5pt !important; line-height: 1.4 !important;
      color: #000 !important; background: #fff !important; padding: 4mm 4mm 12mm 4mm !important; margin: 0 !important; box-sizing: border-box !important;
    }
  }
`;

/**
 * Ver y reimprimir un comprobante emitido (factura o nota de crédito), tal como salió.
 */
export default function FiscalDocModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [doc, setDoc] = useState<any | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const storeName = (localStorage.getItem('gd_store_name') || 'Ventra POS').toUpperCase();

  useEffect(() => {
    let vivo = true;
    api.get(`/fiscal/documents/${encodeURIComponent(docId)}`)
      .then(async ({ data }) => {
        if (!vivo) return;
        setDoc(data);
        setQr(await qrImagen(data.qrUrl));
      })
      .catch(() => { toast.error('No se pudo leer el comprobante'); onClose(); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const imprimir = async () => {
    if (canPrintSilently() && getAutoPrintInvoice()) {
      const aviso = toast.loading('Imprimiendo...');
      try {
        await printSilently();
        toast.success('Comprobante impreso', { id: aviso });
        return;
      } catch (err: any) {
        toast.error(`${err?.message || 'No se pudo imprimir'}. Elegí la impresora en el cuadro.`, { id: aviso });
      }
    }
    setTimeout(() => window.print(), 60);
  };

  const venta = doc ? { saleNumber: doc.saleNumber, createdAt: doc.saleCreatedAt, total: doc.saleTotal ?? doc.total, items: doc.lines || [] } : null;

  return (
    <div className="fixed inset-0 z-[140] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <style>{PRINT_CSS}</style>
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-900 dark:text-slate-50 leading-tight truncate">
                {doc ? `${nombreComprobante(doc.type)} ${doc.number ? numeroComprobante(doc.pointOfSale, doc.number) : ''}` : 'Comprobante'}
              </h2>
              {doc && <p className="text-[11px] font-semibold text-slate-500 truncate">Venta #{doc.saleNumber} · {formatPrice(doc.total)}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto custom-scrollbar flex-1">
          {!doc || !venta ? (
            <div className="py-16 flex items-center justify-center text-slate-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Cargando…</div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-inner">
              <TicketReceipt createdSale={venta} storeName={storeName} invoice={doc} invoiceQr={qr} formatPrice={formatPrice} />
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer">
            Cerrar
          </button>
          <button
            onClick={imprimir}
            disabled={!doc || doc.status !== 'AUTHORIZED'}
            className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" /> Imprimir
          </button>
        </div>
      </div>

      {doc && venta && (
        <div id="printable-receipt" style={{ display: 'none' }}>
          <TicketReceipt createdSale={venta} storeName={storeName} invoice={doc} invoiceQr={qr} reprint formatPrice={formatPrice} />
        </div>
      )}
    </div>
  );
}
