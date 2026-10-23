import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useOwnerMobile } from '../../utils/ownerMobile';

/** Lo escucha la pantalla de Compras para recargarse sola */
export const PURCHASES_CHANGED_EVENT = 'ventra:purchases-changed';
const SEEN_KEY = 'ventra_pending_purchases_seen';
const EVERY_MS = 15000;

/**
 * En la PC: cuando alguien escanea una boleta con el celular, queda como compra por revisar y
 * llega por la sincronización. Esto la detecta (cada 15 s, una consulta liviana) y avisa desde
 * cualquier pantalla, con un botón para ir a revisarla. Compras también se actualiza sola.
 */
export default function ScannedPurchasesWatcher() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const mobile = useOwnerMobile().active;
  const first = useRef(true);

  useEffect(() => {
    if (mobile || (role !== 'ADMIN' && role !== 'SUPERVISOR')) return;
    let alive = true;
    const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; } };
    const check = async () => {
      try {
        const { data } = await api.get('/purchases/pending', { silent: true } as any);
        if (!alive) return;
        const rows: any[] = data || [];
        const seen = new Set(readSeen());
        const fresh = rows.filter((p) => !seen.has(p.id));
        if (fresh.length) {
          window.dispatchEvent(new CustomEvent(PURCHASES_CHANGED_EVENT));
          // La primera vez solo se anotan (no avisa por boletas viejas)
          if (!first.current) {
            const p = fresh[0];
            toast((t) => (
              <span className="flex items-center gap-3">
                <span className="text-[13.5px]">
                  <b>{fresh.length === 1 ? 'Llegó una boleta escaneada' : `Llegaron ${fresh.length} boletas escaneadas`}</b>
                  <span className="block text-slate-600">{fresh.length === 1 ? `${p.supplierName || 'Proveedor'} · ${p.items} ${p.items === 1 ? 'producto' : 'productos'}${p.userName ? ` · la cargó ${p.userName}` : ''}` : 'Están en Compras para revisar'}</span>
                </span>
                <button onClick={() => { toast.dismiss(t.id); navigate('/purchases'); }} className="shrink-0 h-9 px-3 rounded-lg bg-rose-600 text-white text-[13px] font-bold cursor-pointer">Revisar</button>
              </span>
            ), { duration: 15000, id: 'scanned-purchase' });
          }
          try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((p) => p.id)].slice(-200))); } catch { /* sin espacio */ }
        }
        first.current = false;
      } catch { /* sin servidor: se reintenta */ }
    };
    check();
    const t = window.setInterval(check, EVERY_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [mobile, role]);

  return null;
}
