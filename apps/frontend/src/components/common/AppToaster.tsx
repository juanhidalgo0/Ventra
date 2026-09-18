import { useEffect } from 'react';
import { Toaster, ToastBar, toast, useToasterStore, type Toast } from 'react-hot-toast';
import { CheckCircle2, XCircle, AlertTriangle, Info, Loader2, X } from 'lucide-react';

const MAX_VISIBLE = 3;

// Emojis al principio del texto ("✅ Caja abierta") ya los representa el ícono:
// se quitan al mostrar para no duplicar.
const LEADING_EMOJI = /^[\p{Extended_Pictographic}☀-➿️‍\s]+/u;

function cleanMessage(message: Toast['message'], t: Toast) {
  const resolved = typeof message === 'function' ? message(t) : message;
  return typeof resolved === 'string' ? resolved.replace(LEADING_EMOJI, '') : resolved;
}

function ToastIcon({ t }: { t: Toast }) {
  if (t.icon && typeof t.icon !== 'string') return <>{t.icon}</>;
  if (t.type === 'loading') return <Loader2 className="w-[18px] h-[18px] text-slate-300 animate-spin" />;
  if (t.type === 'success') return <CheckCircle2 className="w-[18px] h-[18px] text-emerald-400" />;
  if (t.type === 'error') return <XCircle className="w-[18px] h-[18px] text-red-400" />;
  if (t.icon === '⚠️') return <AlertTriangle className="w-[18px] h-[18px] text-amber-400" />;
  return <Info className="w-[18px] h-[18px] text-sky-300" />;
}

/**
 * Avisos de la app: pastilla oscura y compacta abajo al centro, que no tapa
 * la barra superior ni el ticket. Máximo 3 a la vez; los errores duran más.
 */
export default function AppToaster() {
  const { toasts } = useToasterStore();

  // Nunca más de MAX_VISIBLE en pantalla: los más viejos se van primero
  useEffect(() => {
    toasts
      .filter((t) => t.visible)
      .filter((_, i) => i >= MAX_VISIBLE)
      .forEach((t) => toast.dismiss(t.id));
  }, [toasts]);

  return (
    <Toaster
      position="bottom-center"
      gutter={8}
      containerClassName="keep-animated"
      containerStyle={{ bottom: 20 }}
      toastOptions={{
        duration: 2500,
        success: { duration: 2000 },
        error: { duration: 5000 },
        loading: { duration: Infinity },
      }}
    >
      {(t) => (
        <ToastBar toast={t} style={{ padding: 0, background: 'transparent', boxShadow: 'none', maxWidth: 520 }}>
          {() => (
            <div
              className={`keep-style flex items-center gap-2.5 pl-3.5 pr-2 py-2.5 rounded-xl bg-slate-900 text-white shadow-[0_10px_30px_-8px_rgba(15,23,42,0.55)] ring-1 ${
                t.type === 'error' ? 'ring-red-500/60' : 'ring-white/10'
              }`}
              role={t.type === 'error' ? 'alert' : 'status'}
            >
              <span className="shrink-0 flex items-center"><ToastIcon t={t} /></span>
              <div className="flex-1 min-w-0 text-[13.5px] font-medium leading-snug break-words [&_b]:font-bold">
                {cleanMessage(t.message, t)}
              </div>
              {t.type !== 'loading' && (
                <button
                  onClick={() => {
                    toast.dismiss(t.id);
                    const posInput = document.getElementById('pos-search') as HTMLInputElement | null;
                    if (posInput) setTimeout(() => posInput.focus(), 30);
                  }}
                  className="shrink-0 p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Cerrar aviso"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
