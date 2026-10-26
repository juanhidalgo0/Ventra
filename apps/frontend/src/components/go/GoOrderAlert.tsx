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

/** Logo de GO: el círculo negro con "GO!" y el punto rojo de la marca */
export function GoMark({ size = 36 }: { size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center rounded-full bg-[#0b0b0c] text-white font-black shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.36, letterSpacing: '-0.04em' }}>
      GO!
      <span className="absolute rounded-full bg-[#e11d48]" style={{ width: size * 0.2, height: size * 0.2, top: size * 0.04, right: size * 0.04 }} />
    </span>
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

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[min(520px,calc(100vw-24px))]">
      <style>{`
        @keyframes go-alert-blink { 0%,100% { box-shadow: 0 0 0 0 rgba(225,29,72,.75), 0 18px 40px rgba(0,0,0,.35); } 50% { box-shadow: 0 0 0 7px rgba(225,29,72,0), 0 18px 40px rgba(0,0,0,.35); } }
        @keyframes go-alert-in { from { transform: translateY(-18px) scale(.97); opacity: 0; } to { transform: none; opacity: 1; } }
      `}</style>
      {alerts.map((a) => {
        const n = a.count || 0;
        return (
          <div key={a.id} role="alert"
            className="flex items-center gap-3 rounded-2xl bg-[#0b0b0c] text-white px-4 py-3 border-2 border-[#e11d48]"
            style={{ animation: 'go-alert-in .25s ease-out, go-alert-blink 1.1s ease-in-out infinite' }}>
            <GoMark size={46} />
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-extrabold leading-tight">Pedido GO{a.number ? ` #${a.number}` : ''}</div>
              <div className="text-[13px] text-white/75 leading-snug mt-0.5">
                {a.isShopper
                  ? `Un repartidor viene a comprar ${n} producto${n === 1 ? '' : 's'}: cobrale como a cualquier cliente.`
                  : 'Hay un pedido nuevo para preparar.'}
              </div>
              {a.isShopper && (
                <div className="text-[11.5px] text-white/50 leading-snug mt-1">
                  Es solo un aviso, no hace falta hacer nada. Si querés, “Ver pedido” te muestra lo que pidió y lo podés cargar en la caja para cobrar más rápido; si no, cerralo y cobrá normal.
                </div>
              )}
            </div>
            <button onClick={() => { close(a.id); navigate('/go'); }}
              className="h-10 px-4 rounded-xl bg-[#e11d48] hover:bg-[#be123c] text-white text-[13px] font-bold shrink-0">Ver pedido</button>
            <button onClick={() => close(a.id)} aria-label="Cerrar aviso" className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
