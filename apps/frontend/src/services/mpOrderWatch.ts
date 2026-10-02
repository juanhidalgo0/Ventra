import { doc, onSnapshot } from 'firebase/firestore';
import { ensureVentraSession, getVentraDb } from './ventraFirebase';

/**
 * Escucha en vivo el estado de un cobro del Point (lo escribe la nube cuando Mercado Pago
 * avisa). `onReady` se llama cuando la escucha quedó andando: desde ahí la caja puede
 * consultar menos seguido. Si no hay sesión o internet, no hace nada y sigue la consulta.
 */
export function watchPointOrder(orderId: string, onOrder: (o: any) => void, onReady?: () => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  ensureVentraSession()
    .then(() => {
      if (cancelled) return;
      stop = onSnapshot(
        doc(getVentraDb(), 'ventra_mp_orders', orderId),
        (snap) => {
          onReady?.();
          const view = snap.exists() ? snap.data().view : null;
          if (view) onOrder(view);
        },
        () => { /* sin permiso o sin conexión: queda la consulta */ },
      );
    })
    .catch(() => { /* PC sin vincular: queda la consulta */ });
  return () => {
    cancelled = true;
    stop?.();
  };
}
