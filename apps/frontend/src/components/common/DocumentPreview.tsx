import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { X, Printer, FileDown, Loader2, MessageCircle } from 'lucide-react';
import { printableToCanvas, sheetsToPdfBlob } from '../../utils/printToPdf';
import { printA4 } from '../../utils/printA4';
import { openExternal } from '../../utils/externalLinks';
import { waPhone } from '../../services/agendaCore';

const A4_PX = 794; // 210 mm a 96 ppp

export interface PreviewOption { key: string; label: string; help?: string }

const isTouch = () => typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || /Android|iPhone|iPad/i.test(navigator.userAgent));

/** Varias hojas fotografiadas una debajo de la otra, en una sola imagen */
async function sheetsToPng(sheets: HTMLElement[]): Promise<Blob> {
  const canvases = [];
  for (const s of sheets) canvases.push(await printableToCanvas(s));
  const gap = 24;
  const out = document.createElement('canvas');
  out.width = Math.max(...canvases.map((c) => c.width));
  out.height = canvases.reduce((h, c) => h + c.height, 0) + gap * (canvases.length - 1);
  const g = out.getContext('2d')!;
  g.fillStyle = '#e2e8f0';
  g.fillRect(0, 0, out.width, out.height);
  let y = 0;
  for (const c of canvases) { g.drawImage(c, 0, y); y += c.height + gap; }
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo armar la imagen'))), 'image/png'));
}

export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}

/**
 * Hojas A4 en pantalla antes de imprimir (sin el cuadro de Windows), con lo que se hace con
 * ellas: imprimir, guardar el PDF o mandarlas por WhatsApp. `render(paper)` dibuja las hojas:
 * con paper = true para la pantalla (cada hoja con `data-sheet`) y false para imprimir.
 */
export default function DocumentPreview({
  title, subtitle, options, option, onOption, render, fileName, whatsapp, onClose, loading, notice, printable = true,
}: {
  title: string;
  subtitle?: string;
  options?: PreviewOption[];
  option?: string;
  onOption?: (key: string) => void;
  render: (paper: boolean) => ReactNode;
  /** Nombre del archivo sin extensión */
  fileName: string;
  /** Mensaje y teléfono (opcional) para WhatsApp; sin esto no hay botón */
  whatsapp?: { phone?: string | null; text: string; hint?: string };
  onClose: () => void;
  loading?: boolean;
  /** Aviso fijo arriba de las hojas (no sale impreso) */
  notice?: ReactNode;
  /** false: todavía no hay nada para imprimir (los botones quedan apagados) */
  printable?: boolean;
}) {
  const [busy, setBusy] = useState<'print' | 'pdf' | 'wa' | null>(null);
  const [zoom, setZoom] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sheetsRef = useRef<HTMLDivElement>(null);
  const help = options?.find((o) => o.key === option)?.help;

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, (el.clientWidth - 40) / A4_PX));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const sheets = () => Array.from(sheetsRef.current?.querySelectorAll<HTMLElement>('[data-sheet]') || []);

  const print = async () => {
    if (loading || busy || !printable) return;
    setBusy('print');
    try { await printA4(render(false)); }
    catch { toast.error('No se pudo imprimir'); }
    finally { setBusy(null); }
  };

  const savePdf = async () => {
    if (loading || busy || !printable) return;
    setBusy('pdf');
    try {
      saveBlob(await sheetsToPdfBlob(sheets()), `${fileName}.pdf`);
      toast.success('PDF guardado en Descargas');
    } catch { toast.error('No se pudo armar el PDF'); }
    finally { setBusy(null); }
  };

  const sendWhatsApp = async () => {
    if (loading || busy || !whatsapp || !printable) return;
    const chat = `https://wa.me/${whatsapp.phone ? waPhone(whatsapp.phone) : ''}?text=${encodeURIComponent(whatsapp.text)}`;
    setBusy('wa');
    try {
      // Celular: el PDF va directo por el menú de compartir
      if (isTouch() && navigator.canShare) {
        const file = new File([await sheetsToPdfBlob(sheets())], `${fileName}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: whatsapp.text }).catch(() => {});
          return;
        }
      }
      // PC: WhatsApp no deja adjuntar desde otro programa. La hoja queda copiada como imagen y se
      // abre el chat: se pega con Ctrl+V. La copia arranca en el mismo clic (si no, el navegador la frena).
      const png = sheetsToPng(sheets());
      let copied = false;
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('sin portapapeles');
        const write = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        openExternal(chat);
        await write;
        copied = true;
      } catch {
        openExternal(chat);
      }
      if (copied) {
        toast.success('Abrimos WhatsApp. En el chat, pegá la hoja con Ctrl+V.', { duration: 7000 });
      } else {
        saveBlob(await png, `${fileName}.png`);
        toast('Abrimos WhatsApp. La hoja quedó en Descargas como imagen: adjuntala en el chat.', { icon: '📎', duration: 8000 });
      }
    } catch {
      toast.error('No se pudo preparar la hoja para WhatsApp');
    } finally {
      setBusy(null);
    }
  };

  // Enter imprime y Escape cierra; la pantalla de atrás no se entera
  const keys = useRef({ print, onClose });
  keys.current = { print, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== 'F8' && e.key !== 'F9') return;
      const t = e.target as HTMLElement | null;
      if (e.key === 'Enter' && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') keys.current.onClose();
      else if (e.key === 'Enter') keys.current.print();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const btn = 'flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-[13.5px] font-bold transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-default';

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[920px] h-[96vh] sm:h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-200 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15.5px] font-bold text-slate-900 leading-tight truncate">{title}</h2>
            {subtitle && <p className="text-[12px] text-slate-500 truncate">{subtitle}</p>}
          </div>
          {options && options.length > 1 && (
            <div className="flex p-1 rounded-xl bg-slate-100 border border-slate-200 shrink-0 order-3 sm:order-none w-full sm:w-auto">
              {options.map((o) => (
                <button key={o.key} onClick={() => onOption?.(o.key)}
                  className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-colors ${option === o.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer shrink-0" aria-label="Cerrar">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {help && <p className="px-5 py-2 text-[12px] text-slate-600 bg-slate-50 border-b border-slate-200">{help}</p>}
        {notice && <div className="border-b border-slate-200">{notice}</div>}

        <div ref={bodyRef} className="flex-1 overflow-auto bg-slate-200/70 py-5 custom-scrollbar">
          {loading ? (
            <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
          ) : (
            <div ref={sheetsRef} style={{ zoom }}>{render(true)}</div>
          )}
        </div>

        <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3.5 border-t border-slate-200">
          {whatsapp && (
            <button onClick={sendWhatsApp} disabled={loading || !!busy || !printable} className={`${btn} bg-[#25D366] hover:bg-[#1fbe5b] text-white`} aria-label="Mandar por WhatsApp" title={whatsapp.hint}>
              {busy === 'wa' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />} <span className="hidden sm:inline">WhatsApp</span>
            </button>
          )}
          <button onClick={savePdf} disabled={loading || !!busy || !printable} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
            {busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} <span className="hidden sm:inline">Guardar</span> PDF
          </button>
          <span className="flex-1" />
          <button onClick={print} disabled={loading || !!busy || !printable} className={`${btn} bg-slate-900 hover:bg-slate-800 text-white sm:min-w-[150px]`}>
            {busy === 'print' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Imprimir
            <kbd className="hidden sm:inline ml-1 text-[10.5px] font-mono bg-white/15 px-1.5 py-0.5 rounded">Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
