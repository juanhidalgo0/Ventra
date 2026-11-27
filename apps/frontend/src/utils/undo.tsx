import toast from 'react-hot-toast';
import { Undo2 } from 'lucide-react';

/**
 * Deshacer, como en Gmail: lo que se borra desaparece de la pantalla al instante, pero el borrado de
 * verdad (`run`) se hace recién a los 8 segundos. Mientras tanto, "Deshacer" (o Ctrl+Z) lo trae de
 * vuelta (`onUndo`) sin que se haya tocado nada. Si la app se cierra antes, se borra en ese momento.
 *
 *   undoable({ message: 'Producto borrado', hide: () => quitarDeLaLista(id), run: () => api.delete(...), onUndo: recargar })
 */
interface Pending { id: string; run: () => Promise<unknown>; onUndo: () => void; timer: number; done: boolean }

const DELAY_MS = 8000;
const pending: Pending[] = [];

async function commit(p: Pending, onError?: (e: any) => void) {
  if (p.done) return;
  p.done = true;
  clearTimeout(p.timer);
  remove(p);
  toast.dismiss(p.id);
  try {
    await p.run();
  } catch (e: any) {
    p.onUndo();
    if (onError) onError(e);
    else toast.error(e?.response?.data?.message || 'No se pudo borrar. Quedó como estaba.');
  }
}

function remove(p: Pending) {
  const i = pending.indexOf(p);
  if (i >= 0) pending.splice(i, 1);
}

function undo(p: Pending) {
  if (p.done) return;
  p.done = true;
  clearTimeout(p.timer);
  remove(p);
  toast.dismiss(p.id);
  p.onUndo();
  toast.success('Listo, quedó como estaba', { duration: 1800 });
}

export function undoable({ message, run, onUndo, hide, onError }: {
  message: string;
  /** El borrado de verdad (se hace a los 8 segundos) */
  run: () => Promise<unknown>;
  /** Volver a mostrarlo (normalmente recargar la lista) */
  onUndo: () => void;
  /** Sacarlo de la pantalla ya */
  hide?: () => void;
  onError?: (e: any) => void;
}) {
  hide?.();
  const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const p: Pending = { id, run, onUndo, done: false, timer: 0 };
  p.timer = window.setTimeout(() => commit(p, onError), DELAY_MS);
  pending.push(p);
  toast.custom((t) => (
    <div className={`keep-style pointer-events-auto flex items-center gap-3 rounded-xl bg-slate-900 text-white pl-4 pr-1.5 py-1.5 shadow-xl text-[13.5px] min-w-[260px] max-w-[92vw] ${t.visible ? 'anim-pop' : 'opacity-0'}`}>
      <span className="flex-1 min-w-0 truncate font-medium">{message}</span>
      <button onClick={() => undo(p)}
        className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-yellow-300 font-bold hover:bg-white/10 shrink-0">
        <Undo2 className="w-4 h-4" /> Deshacer
      </button>
      <span className="relative w-6 h-6 shrink-0" aria-hidden>
        <svg viewBox="0 0 24 24" className="w-6 h-6 -rotate-90">
          <circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
          <circle cx="12" cy="12" r="9" fill="none" stroke="#fde047" strokeWidth="2.5" strokeDasharray="56.5" className="undo-ring" style={{ animationDuration: `${DELAY_MS}ms` }} />
        </svg>
      </span>
    </div>
  ), { id, duration: DELAY_MS + 400, position: 'bottom-center' });
}

/** Ctrl+Z fuera de un campo de texto: deshace lo último que se borró */
export function undoLast(): boolean {
  const p = pending[pending.length - 1];
  if (!p) return false;
  undo(p);
  return true;
}

/** Al cerrar la app: lo pendiente se borra ya (para no dejar a medias lo que el usuario pidió) */
export function flushPendingUndo() {
  for (const p of [...pending]) void commit(p);
}

let installed = false;
export function installUndoKeys() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (undoLast()) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('pagehide', flushPendingUndo);
  window.addEventListener('beforeunload', flushPendingUndo);
}
