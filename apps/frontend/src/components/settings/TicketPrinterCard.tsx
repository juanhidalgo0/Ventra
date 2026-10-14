import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Printer } from 'lucide-react';
import {
  canPrintSilently, listPrinters, getTicketPrinter, setTicketPrinter, getReportPrinter, setReportPrinter,
  getAutoPrintInvoice, setAutoPrintInvoice,
} from '../../utils/ticketPrinter';

/**
 * Impresoras de esta PC: una para tickets y facturas (la térmica) y otra para cierres y reportes
 * (la común). Solo en la app de escritorio, que imprime sin el cuadro de Windows.
 */
export default function TicketPrinterCard() {
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState(getTicketPrinter());
  const [reportPrinter, setReportPrinterState] = useState(getReportPrinter());
  const [auto, setAuto] = useState(getAutoPrintInvoice());

  useEffect(() => { listPrinters().then(setPrinters); }, []);
  if (!canPrintSilently()) return null;

  const select = 'w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[14px] bg-white';

  return (
    <div className="card p-6 space-y-4">
      <h3 className="text-[15px] font-bold text-slate-900 tracking-tight flex items-center gap-2.5 pb-3 border-b border-slate-100">
        <Printer className="w-4.5 h-4.5 text-rose-500" /> Impresoras de esta PC
      </h3>
      <div>
        <label className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">Tickets y facturas</label>
        <select
          value={printer}
          onChange={(e) => { setPrinter(e.target.value); setTicketPrinter(e.target.value); toast.success('Impresora de tickets guardada'); }}
          className={select}
        >
          <option value="">Predeterminada de Windows</option>
          {printers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <p className="text-[12.5px] text-slate-500 mt-1.5">Normalmente la térmica. El ticket sale directo, sin el cuadro de impresión.</p>
      </div>
      <div>
        <label className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">Cierres de caja y reportes</label>
        <select
          value={reportPrinter}
          onChange={(e) => { setReportPrinterState(e.target.value); setReportPrinter(e.target.value); toast.success('Impresora de reportes guardada'); }}
          className={select}
        >
          <option value="">Preguntar cada vez</option>
          {printers.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <p className="text-[12.5px] text-slate-500 mt-1.5">Normalmente la común (hoja A4). Si elegís una, el arqueo, el cierre del día y los reportes salen directo por ella.</p>
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
          <span className="block text-[12.5px] text-slate-500">Al facturar, el comprobante sale solo por la impresora de tickets, sin tocar nada.</span>
        </span>
      </label>
    </div>
  );
}
