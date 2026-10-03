import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Eye, Loader2, Smartphone } from 'lucide-react';
import { useClientPreview, createPreviewBridge, buildPreviewHtml } from '../../services/clientPreview';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { IS_DEMO_BUILD } from '../../demo/flag';

/**
 * Vista del cliente (ver services/clientPreview.ts): la tienda o la página de turnos tal como
 * la ven los clientes, en un marco de celular (o a pantalla completa en el celular).
 */
export default function ClientPreview() {
  const open = useClientPreview((s) => s.open);
  const close = useClientPreview((s) => s.close);
  const mobile = useOwnerMobile().active;
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) { setHtml(null); setError(''); setClosing(false); return; }
    let alive = true;
    (async () => {
      try {
        const [{ default: raw }, { bridge }] = await Promise.all([
          import('../../../../../firebase/tienda/index.html?raw'),
          createPreviewBridge(open.storeId),
        ]);
        if (!alive) return;
        (window as any).__ventraClientPreview = bridge;
        const page = buildPreviewHtml(raw, open.section);
        if (page) setHtml(page); else setError('No se pudo armar la vista previa.');
      } catch (e) {
        console.warn('[Vista del cliente]', e);
        if (alive) setError('No se pudo cargar tu página. Revisá la conexión y probá de nuevo.');
      }
    })();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') shut(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!open) return null;
  const shut = () => { setClosing(true); setTimeout(close, 190); };
  const turnos = open.section === 'turnos';

  const frame = (
    <div className="relative w-full h-full bg-white">
      {html ? (
        <iframe title="Vista del cliente" srcDoc={html} className="w-full h-full border-0 ag-fade" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
          {error ? <p className="text-[14px] text-slate-500">{error}</p> : <><Loader2 className="w-7 h-7 text-rose-600 animate-spin" /><p className="text-[13px] text-slate-400">Armando tu página…</p></>}
        </div>
      )}
    </div>
  );

  const banner = (
    <div className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0"><Eye className="w-[18px] h-[18px]" /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-bold text-slate-900">Vista del cliente</p>
        <p className="text-[12.5px] text-slate-500 leading-snug">
          {open.note || (turnos ? 'Así reservan tus clientes. Probá pedir un turno.' : 'Así ven tu tienda tus clientes. Probá armar un pedido.')}
          {' '}{IS_DEMO_BUILD && turnos ? 'El turno que reserves aparece en tu agenda.' : 'Lo que hagas acá es de prueba: no se envía nada.'}
        </p>
      </div>
      <button onClick={shut} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 ag-press" aria-label="Cerrar vista del cliente"><X className="w-4 h-4 text-slate-600" /></button>
    </div>
  );

  if (mobile) {
    return createPortal(
      <div className="fixed inset-0 z-[95] flex flex-col">
        <div className={`flex-1 min-h-0 bg-white flex flex-col ag-sheet ${closing ? 'ag-sheet-out' : ''}`}>
          <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 border-b border-slate-100">{banner}</div>
          <div className="flex-1 min-h-0">{frame}</div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-6">
      <div className={`absolute inset-0 bg-slate-900/55 anim-veil ${closing ? 'ag-veil-out' : ''}`} onClick={shut} />
      <div className={`relative flex items-center gap-8 ag-sheet ${closing ? 'ag-sheet-out' : ''}`}>
        {/* Marco de celular */}
        <div className="relative w-[390px] h-[min(820px,calc(100dvh-48px))] rounded-[44px] bg-slate-900 p-3 shadow-2xl">
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-6 rounded-b-2xl bg-slate-900 z-10" aria-hidden />
          <div className="w-full h-full rounded-[34px] overflow-hidden">{frame}</div>
        </div>
        <div className="w-[300px] bg-white rounded-3xl p-5 shadow-2xl hidden lg:block">
          {banner}
          <div className="mt-4 rounded-2xl bg-slate-50 p-3.5 text-[12.5px] text-slate-600 leading-relaxed flex gap-2.5">
            <Smartphone className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <span>Es tu página real, con tus {turnos ? 'servicios, horarios y turnos libres' : 'productos y precios'}. Si todavía no la publicaste, así se va a ver cuando lo hagas.</span>
          </div>
        </div>
        {/* En pantallas angostas el aviso va arriba del celular */}
        <button onClick={shut} className="lg:hidden absolute -top-2 -right-12 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-lg ag-press" aria-label="Cerrar vista del cliente"><X className="w-5 h-5 text-slate-700" /></button>
      </div>
    </div>,
    document.body,
  );
}
