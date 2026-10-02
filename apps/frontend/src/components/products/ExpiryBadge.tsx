import { useCallback, useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import api from '../../services/api';
import { useFeature } from '../../stores/businessStore';
import ExpiringProductsModal from '../dashboard/ExpiringProductsModal';

const NOTIFIED_KEY = 'expiry_notified_day';
const REFRESH_MS = 30 * 60 * 1000;

/** Avisa una vez por día con una notificación de escritorio. */
function notifyOncePerDay(expired: number, soon: number) {
  const today = new Date().toDateString();
  try { if (localStorage.getItem(NOTIFIED_KEY) === today) return; } catch { /* sin storage: avisa igual */ }
  if (typeof Notification === 'undefined') return;
  const show = () => {
    const parts = [];
    if (expired) parts.push(`${expired} vencido${expired > 1 ? 's' : ''}`);
    if (soon) parts.push(`${soon} por vencer`);
    new Notification('Ventra · Vencimientos', { body: `Tenés ${parts.join(' y ')}. Revisalos para no perder mercadería.` });
    try { localStorage.setItem(NOTIFIED_KEY, today); } catch { /* nada */ }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') show(); });
}

/** Ícono de la barra superior con la cantidad de lotes vencidos o por vencer. */
export default function ExpiryBadge({ className = '' }: { className?: string }) {
  const enabled = useFeature('expiry');
  const [counts, setCounts] = useState({ expired: 0, soon: 0 });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/products/expiring');
      const lots: any[] = data || [];
      const expired = lots.filter(l => l.daysLeft < 0).length;
      const next = { expired, soon: lots.length - expired };
      setCounts(next);
      if (lots.length > 0) notifyOncePerDay(next.expired, next.soon);
    } catch { /* sin conexión: queda el último valor */ }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [enabled, load]);

  const total = counts.expired + counts.soon;
  if (!enabled || total === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${counts.expired} vencidos · ${counts.soon} por vencer`}
        className={`relative shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 transition-colors cursor-pointer ${className}`}
      >
        <CalendarClock strokeWidth={2.25} className="w-4 h-4" />
        <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold leading-4 text-white text-center ring-2 ring-white dark:ring-slate-900 ${counts.expired ? 'bg-rose-500' : 'bg-amber-500'}`}>
          {total > 99 ? '99+' : total}
        </span>
      </button>
      {open && <ExpiringProductsModal onClose={() => { setOpen(false); load(); }} />}
    </>
  );
}
