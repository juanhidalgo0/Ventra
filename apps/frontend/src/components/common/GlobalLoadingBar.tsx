import { useEffect, useState } from 'react';
import { onPendingRequests } from '../../services/api';

/**
 * Barrita fina arriba mientras alguna pantalla espera datos del servidor. Aparece solo si la
 * espera pasa de un segundo (para no parpadear) y no tapa nada: el cartel "Cargando datos…"
 * que salía en el medio molestaba, sobre todo con consultas de fondo.
 * Las consultas automáticas van con `silent: true` y no la muestran.
 */
export default function GlobalLoadingBar() {
  const [pending, setPending] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => onPendingRequests(setPending), []);
  useEffect(() => {
    if (pending === 0) { setVisible(false); return; }
    const t = window.setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(t);
  }, [pending > 0]);

  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[997] keep-style keep-animated">
      <div className="h-[3px] w-full overflow-hidden bg-rose-100">
        <div className="h-full w-1/3 bg-rose-600 rounded-full animate-[ventra-loading_1.1s_ease-in-out_infinite]" />
      </div>
      <style>{`@keyframes ventra-loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </div>
  );
}
