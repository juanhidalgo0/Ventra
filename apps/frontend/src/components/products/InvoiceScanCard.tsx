import { useEffect, useState } from 'react';
import { Camera, FileText, MessageCircle, Monitor, X, ChevronDown, Check } from 'lucide-react';
import api from '../../services/api';
import { useOwnerAccess } from '../../utils/managerAccess';
import { comingSoon } from '../../utils/comingSoon';
import { openAskBusiness } from '../common/AskBusiness';

const HIDE_KEY = 'invoice_scan_card_closed';
/** Lo lee NewPurchaseScreen al abrir: entra directo a "Cargar boleta del proveedor" */
export const OPEN_SCAN_KEY = 'purchases_open_scan';

/** Para el botón "Cargar boleta" desde cualquier pantalla: abre la compra nueva con la carga ya abierta */
export function requestInvoiceScan() {
  try {
    sessionStorage.setItem(OPEN_SCAN_KEY, '1'); // Compras lo ve y abre la carga (NewPurchaseScreen lo borra)
  } catch { /* sin almacenamiento: abre la compra igual */ }
}

const prettyPhone = (n?: string) => {
  const d = String(n || '').replace(/\D/g, '');
  // 5492212048533 → +54 9 221 204-8533
  return /^549\d{10}$/.test(d) ? `+54 9 ${d.slice(3, 6)} ${d.slice(6, 9)}-${d.slice(9)}` : (d ? `+${d}` : '');
};

/**
 * Cómo cargar la mercadería con la boleta del proveedor, en Inventario y en Compras.
 * La forma más fácil es mandarle la foto al WhatsApp de Ventra (wa-owner-invoice.js): pregunta lo
 * dudoso con botones, o la deja en Compras para revisarla en la PC (avisa al toque). La otra, desde
 * la PC: foto, PDF o Excel. La primera vez se ve entero; con "Entendido" queda una barra finita.
 */
export default function InvoiceScanCard({ onUploadPc, className = '', startClosed = false }: { onUploadPc: () => void; className?: string; startClosed?: boolean }) {
  const isOwner = useOwnerAccess();
  const photosOn = !comingSoon('aiInvoiceScan');
  // startClosed (Inventario): arranca como barra finita; "¿Cómo funciona?" la abre solo por esa vez
  const [open, setOpen] = useState(() => { if (startClosed) return false; try { return localStorage.getItem(HIDE_KEY) !== '1'; } catch { return true; } });
  const [wa, setWa] = useState<{ linked: boolean; number?: string } | null>(null);

  useEffect(() => {
    if (!isOwner || !photosOn) return;
    let alive = true;
    api.get('/ai/whatsapp', { silent: true } as any).then(({ data }) => { if (alive) setWa(data); }).catch(() => {});
    return () => { alive = false; };
  }, [isOwner, photosOn]);

  const close = () => { setOpen(false); try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* nada */ } };
  const showWa = isOwner && photosOn;
  const phone = prettyPhone(wa?.number);

  if (!open) {
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 ${className}`}>
        <FileText className="w-4 h-4 text-rose-500 shrink-0" />
        <span className="text-[13px] font-semibold text-slate-700 flex-1 min-w-[180px]">
          ¿Llegó mercadería? Cargala con la boleta del proveedor{showWa ? ', también mandándole la foto al WhatsApp de Ventra' : ''}.
        </span>
        <button onClick={() => setOpen(true)} className="h-8 px-3 rounded-lg text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer inline-flex items-center gap-1">
          ¿Cómo funciona? <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button onClick={onUploadPc} className="h-8 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-bold cursor-pointer inline-flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Cargar boleta
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50/70 to-white p-4 md:p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0"><Camera className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-slate-800">Cargá la mercadería con una foto de la boleta</h3>
          <p className="text-[13px] text-slate-600 mt-0.5">
            {photosOn ? 'Le sacás una foto a la boleta del proveedor' : 'Subís el PDF o el Excel de la boleta del proveedor'} y Ventra lee los productos, las cantidades y los costos.
            Revisás lo dudoso y confirmás: se suma el stock y se actualizan los costos (y los precios de venta, si querés, manteniendo tu margen).
            Nada cambia hasta que confirmás.
          </p>
        </div>
        <button onClick={close} title="Cerrar" className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 flex items-center justify-center cursor-pointer shrink-0"><X className="w-4 h-4" /></button>
      </div>

      <div className={`mt-4 grid gap-3 ${showWa ? 'md:grid-cols-2' : ''}`}>
        {showWa && (
          <div className="rounded-xl border border-emerald-200 bg-white p-3.5 flex flex-col">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-emerald-600" />
              <span className="text-[13.5px] font-bold text-slate-800">Por WhatsApp</span>
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Lo más fácil</span>
            </div>
            {wa?.linked ? (
              <p className="text-[12.5px] text-slate-600 mt-1.5 flex-1">
                Desde tu celular, mandale la foto al WhatsApp de Ventra{phone ? <> (<b className="text-slate-800 whitespace-nowrap">{phone}</b>)</> : ''}. Elegís si la confirmás ahí mismo, respondiendo solo lo dudoso con botones, o si <b>la revisás en la PC</b>: te aparece acá un aviso para abrirla.
              </p>
            ) : (
              <>
                <p className="text-[12.5px] text-slate-600 mt-1.5 flex-1">
                  Vinculá tu WhatsApp una vez (tarda un minuto) y después solo le mandás la foto de la boleta al número de Ventra, aunque no estés en el local.
                </p>
                <button onClick={() => openAskBusiness({ whatsapp: true })} className="mt-2.5 h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-bold cursor-pointer inline-flex items-center justify-center gap-1.5 self-start">
                  <MessageCircle className="w-3.5 h-3.5" /> Vincular mi WhatsApp
                </button>
              </>
            )}
            {wa?.linked && <span className="mt-2 text-[11.5px] font-semibold text-emerald-700 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Tu WhatsApp ya está vinculado</span>}
          </div>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-slate-600" />
            <span className="text-[13.5px] font-bold text-slate-800">Desde la PC</span>
          </div>
          <p className="text-[12.5px] text-slate-600 mt-1.5 flex-1">
            {photosOn ? 'Subí fotos de la boleta, el PDF o el Excel que te manda el proveedor.' : 'Subí el PDF o el Excel que te manda el proveedor.'} La revisás en pantalla grande y la confirmás.
          </p>
          <button onClick={onUploadPc} className="mt-2.5 h-9 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-bold cursor-pointer inline-flex items-center justify-center gap-1.5 self-start">
            <FileText className="w-3.5 h-3.5" /> Cargar boleta
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-slate-500">
          Consejo: buena luz, la boleta entera y derecha; si es larga, varias fotos. Ventra aprende cómo nombra cada proveedor a tus productos: cada boleta tiene menos dudas.
        </p>
        <button onClick={close} className="h-8 px-3 rounded-lg text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">Entendido</button>
      </div>
    </div>
  );
}
