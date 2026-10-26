import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { wsService } from '../../services/websocket';

/**
 * Aviso de pedido de GO: un cartel bien visible arriba (con el logo de GO, borde que parpadea,
 * sonido y vibración en tablets y celulares) que queda hasta que el cajero lo cierra o lo abre.
 * Antes era un mensajito de 8 segundos y en un kiosco con gente pasaba de largo.
 */
type Alert = { id: string; number?: string; count?: number; isShopper?: boolean };

/** El logo real de GO (public/godelivery-logo.jpg: "GO!" blanco sobre negro), en círculo con borde blanco
 *  para que se distinga sobre fondos oscuros */
export function GoMark({ size = 36, ring = false }: { size?: number; ring?: boolean }) {
  return (
    <img src="/godelivery-logo.jpg" alt="GO" width={size} height={size}
      className={`rounded-full shrink-0 object-cover ${ring ? 'ring-1 ring-white/25' : ''}`} style={{ width: size, height: size }} />
  );
}

function ding() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    const ctx = new Ctx();
    // Dos tonos cortos, dos veces: se escucha con ruido de kiosco sin ser molesto
    [0, 0.18, 0.6, 0.78].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = i % 2 ? 1320 : 990;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.18);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* sin audio */ }
}

export default function GoOrderAlert() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const navigate = useNavigate();
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    const onGoOrder = (e: { type: string; id?: string; number?: string; count?: number; isShopper?: boolean; status?: string }) => {
      const id = e.id || e.number || String(Date.now());
      if (e.type === 'new') {
        setAlerts((a) => (a.some((x) => x.id === id) ? a : [...a, { id, number: e.number, count: e.count, isShopper: e.isShopper }]));
        ding();
        try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* sin vibración */ }
        // Se va solo a los 3 minutos (para entonces el repartidor ya llegó)
        timers.current[id] = window.setTimeout(() => setAlerts((a) => a.filter((x) => x.id !== id)), 180_000);
      } else if (e.type === 'status' && ['cancelled', 'completed', 'delivered'].includes(String(e.status))) {
        setAlerts((a) => a.filter((x) => x.id !== id));
      }
    };
    wsService.on('go:order', onGoOrder);
    return () => {
      wsService.off('go:order', onGoOrder);
      Object.values(timers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  const close = (id: string) => setAlerts((a) => a.filter((x) => x.id !== id));
  if (!alerts.length) return null;

  // Franja arriba de la pantalla, dentro del diseño: corre el contenido hacia abajo mientras está y
  // no tapa nada. Con el estilo de la caja (blanco, grises, bordes finos): llama la atención el
  // puntito que late y el sonido, no un fondo que parpadea.
  return (
    <div className="shrink-0 w-full flex flex-col">
      <style>{`
        @keyframes go-alert-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
      `}</style>
      {alerts.map((a) => {
        const n = a.count || 0;
        return (
          <div key={a.id} role="alert"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#0b0b0c] border-b border-white/10 px-4 py-2"
            style={{ animation: 'go-alert-in .2s ease-out' }}>
            <GoMark size={30} ring />
            {/* En pantallas chicas los botones bajan a su propia fila (el texto no queda en una columna angosta) */}
            <div className="flex-1 min-w-[210px] leading-snug">
              <div className="flex items-center gap-2 text-[13.5px] text-white">
                <span className="relative flex w-2 h-2 shrink-0">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-rose-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-rose-500" />
                </span>
                <span>
                  <b className="font-semibold">Pedido GO{a.number ? ` #${a.number}` : ''}</b>
                  <span className="text-white/60">
                    {a.isShopper
                      ? ` · Un repartidor viene a comprar ${n} producto${n === 1 ? '' : 's'}: cobrale como a cualquier cliente.`
                      : ' · Hay un pedido nuevo para preparar.'}
                  </span>
                </span>
              </div>
              {a.isShopper && (
                <div className="text-[11.5px] text-white/40 mt-0.5 pl-4">
                  Es solo un aviso, no hace falta hacer nada. “Ver pedido” te muestra lo que pidió por si querés cargarlo en la caja.
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 ml-auto">
              <button onClick={() => { close(a.id); navigate('/go'); }}
                className="h-8 px-3 rounded-lg bg-white hover:bg-white/90 text-[#0b0b0c] text-[12.5px] font-semibold shrink-0">Ver pedido</button>
              <button onClick={() => close(a.id)} aria-label="Cerrar aviso" className="w-8 h-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
