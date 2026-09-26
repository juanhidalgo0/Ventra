import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, HelpCircle } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Para acciones que sacan o borran algo: el botón sale en rojo */
  danger?: boolean;
}

/**
 * Confirmación con el estilo de la app, en lugar del confirm() del navegador.
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title: '¿Ocultar la tienda?' }))) return;
 *   ...y renderizar {confirmDialog}
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, JSX.Element] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const close = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }, []);

  return [confirm, <ConfirmDialog key="confirm-dialog" opts={opts} onClose={close} />];
}

function ConfirmDialog({ opts, onClose }: { opts: ConfirmOptions | null; onClose: (v: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!opts) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts, onClose]);

  const Icon = opts?.danger ? AlertTriangle : HelpCircle;
  return createPortal(
    <AnimatePresence>
      {opts && (
        <motion.div
          className="fixed inset-0 z-[9500] bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
          onMouseDown={() => onClose(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-[400px] bg-white rounded-2xl shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] p-6"
            initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }} transition={{ duration: 0.14 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={`w-11 h-11 rounded-full flex items-center justify-center ${opts.danger ? 'bg-red-50 text-red-600' : 'bg-rose-50 text-rose-600'}`}>
              <Icon className="w-5 h-5" />
            </div>
            <h2 id="confirm-title" className="mt-4 text-[17px] font-bold text-slate-900 tracking-tight">{opts.title}</h2>
            {opts.message && <p className="mt-1.5 text-[14px] text-slate-600 leading-relaxed">{opts.message}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => onClose(false)} className="h-10 px-4 rounded-xl border border-slate-300 text-[14px] font-semibold text-slate-700 hover:bg-slate-50">
                {opts.cancelLabel || 'Cancelar'}
              </button>
              <button
                ref={okRef}
                type="button"
                onClick={() => onClose(true)}
                className={`h-10 px-4 rounded-xl text-[14px] font-bold text-white ${opts.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-rose-600 hover:bg-rose-700'}`}
              >
                {opts.confirmLabel || 'Aceptar'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
