import { useEffect, useState } from 'react';
import { onPendingRequests } from '../../services/api';

/**
 * Barra de carga arriba y un aviso "Cargando datos…" mientras alguna pantalla espera
 * datos del servidor. Aparece solo si la espera pasa de medio segundo, para no parpadear.
 */
export default function GlobalLoadingBar() {
  const [pending, setPending] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => onPendingRequests(setPending), []);
  useEffect(() => {
    if (pending === 0) { setVisible(false); return; }
    const t = window.setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(t);
  }, [pending > 0]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[997] keep-style keep-animated">
      <div className="h-[3px] w-full overflow-hidden bg-rose-100">
        <div className="h-full w-1/3 bg-rose-600 rounded-full animate-[ventra-loading_1.1s_ease-in-out_infinite]" />
      </div>
      <div className="flex justify-center mt-2">
        <div className="flex items-center gap-2 rounded-full bg-white/95 border border-slate-200 shadow-md px-3.5 py-1.5 text-[12px] font-semibold text-slate-600">
          <span className="w-3.5 h-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin" />
          Cargando datos…
        </div>
      </div>
      <style>{`@keyframes ventra-loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </div>
  );
}
