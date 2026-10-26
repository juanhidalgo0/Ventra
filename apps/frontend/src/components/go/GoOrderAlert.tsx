import { useEffect } from 'react';
import { wsService } from '../../services/websocket';

/**
 * Aviso de pedido de GO: solo sonido (y vibración en tablets y celulares). Lo que se ve es el botón
 * de GO de la caja (POSScreen), con el logo y la cantidad de pedidos en curso; el dueño no quiere
 * carteles que ocupen lugar en la pantalla de cobro.
 */

/** El logo real de GO (public/godelivery-logo.jpg: "GO!" blanco sobre negro) */
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
  useEffect(() => {
    const onGoOrder = (e: { type: string }) => {
      if (e.type !== 'new') return;
      ding();
      try { navigator.vibrate?.([300, 150, 300]); } catch { /* sin vibración */ }
    };
    wsService.on('go:order', onGoOrder);
    return () => wsService.off('go:order', onGoOrder);
  }, []);
  return null;
}
