import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { X, Lightbulb, Loader2, Send } from 'lucide-react';
import { APP_VERSION } from '../../appVersion';
import { usePlanStore } from '../../stores/planStore';
import { useVentri, VentriImg } from './Ventri';

/**
 * "Sugerí una idea": el comerciante cuenta qué le falta o qué cambiaría y le llega a Ventra
 * (función ventraIdea: queda guardada y avisa al celular y por mail). Cuando se hace, sale en las
 * novedades con "Lo pidió un cliente".
 */
const URL = 'https://us-central1-ventra-9cba5.cloudfunctions.net/ventraIdea';
const OPEN_EVENT = 'ventra:suggest-idea';
export const openSuggestIdea = () => window.dispatchEvent(new Event(OPEN_EVENT));

const where = (): 'pc' | 'web' | 'celular' => {
  const w = window as any;
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) return 'pc';
  return window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 768 ? 'celular' : 'web';
};

export default function SuggestIdea() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const ventri = useVentri();

  useEffect(() => {
    const onOpen = () => { setOpen(true); setSent(false); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const send = async () => {
    if (text.trim().length < 5) { toast.error('Contanos un poco más'); return; }
    setBusy(true);
    try {
      const plan = usePlanStore.getState();
      const store = (() => { try { return localStorage.getItem('gd_store_name') || ''; } catch { return ''; } })();
      const r = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          text: text.trim(), contact: contact.trim() || undefined, store, version: APP_VERSION || null, where: where(),
          tenant: plan.isDemo ? 'demo' : (plan.email || String((window as any).__VENTRA_TENANT || '') || null),
          screen: location.hash.split('?')[0].slice(0, 80),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'No se pudo mandar');
      setSent(true);
      setText('');
    } catch (e: any) {
      toast.error(e?.message === 'Failed to fetch' ? 'Sin internet: probá de nuevo cuando vuelva' : (e?.message || 'No se pudo mandar'));
    } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9300] bg-slate-900/55 flex items-end sm:items-center justify-center sm:p-4 anim-veil" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="idea-title" onClick={(e) => e.stopPropagation()}
        className="keep-style w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl anim-pop overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <div className="min-w-0">
            <p className="eyebrow">Tu opinión</p>
            <h2 id="idea-title" className="text-[20px] font-black text-slate-900 dark:text-slate-100 mt-1 leading-tight">
              {sent ? '¡Gracias! Ya nos llegó' : '¿Qué le falta a Ventra?'}
            </h2>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Cerrar" className="p-1.5 -mr-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>

        {sent ? (
          <div className="px-6 pt-3 pb-6">
            <div className="flex items-end gap-3">
              {ventri ? <VentriImg cara="guino" size={80} entra /> : <Lightbulb className="w-10 h-10 text-amber-500" />}
              <p className="text-[14px] text-slate-600 dark:text-slate-300 leading-relaxed">
                Leemos todas las ideas. Cuando hagamos la tuya, la vas a ver en las novedades con la marca <b>“Lo pidió un cliente”</b>.
              </p>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setSent(false)} className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-[13.5px] font-semibold text-slate-700 dark:text-slate-200">Mandar otra</button>
              <button onClick={() => setOpen(false)} className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13.5px] font-bold">Listo</button>
            </div>
          </div>
        ) : (
          <div className="px-6 pt-2 pb-6">
            <p className="text-[13px] text-slate-500 dark:text-slate-400">Algo que te gustaría que haga, algo que cambiarías o algo que te molesta. Lo lee una persona.</p>
            <textarea
              autoFocus value={text} onChange={(e) => setText(e.target.value.slice(0, 1000))} rows={5}
              placeholder="Ej.: me gustaría que el cierre de caja me avise si falta plata del cambio…"
              className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-3 text-[14px] text-slate-900 dark:text-slate-100 resize-none focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-400"
            />
            <input
              value={contact} onChange={(e) => setContact(e.target.value.slice(0, 80))}
              placeholder="Tu WhatsApp, si querés que te escribamos (opcional)"
              className="mt-2 w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 text-[13.5px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-400"
            />
            <button onClick={send} disabled={busy || text.trim().length < 5}
              className="mt-4 w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Mandar idea
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
