import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Printer } from 'lucide-react';
import {
  canPrintSilently, listPrinters, getTicketPrinter, setTicketPrinter, getAutoPrintInvoice, setAutoPrintInvoice,
} from '../../utils/ticketPrinter';

/** Impresora de tickets de esta PC. Solo en la app de escritorio. */
export default function TicketPrinterCard() {
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState(getTicketPrinter());
  const [auto, setAuto] = useState(getAutoPrintInvoice());

  useEffect(() => { listPrinters().then(setPrinters); }, []);
  if (!canPrintSilently()) return null;

  return (
    <div className="card p-6 space-y-4">
      <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
        <Printer className="w-4.5 h-4.5 text-rose-500" /> Impresora de tickets
      </h3>
      <div>
        <label className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">Impresora de esta PC</label>
        <select
          value={printer}
          onChange={(e) => { setPrinter(e.target.value); setTicketPrinter(e.target.value); toast.success('Impresora guardada'); }}
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[14px] bg-white"
        >
          <option value="">Predeterminada de Windows</option>
          {printers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => { setAuto(e.target.checked); setAutoPrintInvoice(e.target.checked); }}
          className="mt-1 w-4 h-4 accent-rose-600"
        />
        <span>
          <span className="block text-[14px] font-semibold text-slate-800">Imprimir la factura automáticamente</span>
          <span className="block text-[12.5px] text-slate-500">Al facturar, el comprobante sale directo por esta impresora, sin el cuadro de Windows. Los tickets comunes se imprimen solo con F9.</span>
        </span>
      </label>
    </div>
  );
}
