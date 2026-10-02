import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarClock, PackageMinus, Wallet, Ban, FileWarning, CheckCheck } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useFeature } from '../../stores/businessStore';
import ExpiringProductsModal from '../dashboard/ExpiringProductsModal';

interface Item { id: string; type: string; title: string; body: string; url?: string | null; createdAt: string; readAt?: string | null }
interface Live { expired: number; soon: number; lowStock: number }

const REFRESH_MS = 2 * 60 * 1000;
const SHOWN_KEY = 'notif_desktop_shown_at';
const ICONS: Record<string, { icon: any; cls: string }> = {
  expiry: { icon: CalendarClock, cls: 'bg-amber-50 text-amber-600' },
  lowStock: { icon: PackageMinus, cls: 'bg-amber-50 text-amber-600' },
  cashDiff: { icon: Wallet, cls: 'bg-red-50 text-red-600' },
  saleCancel: { icon: Ban, cls: 'bg-slate-100 text-slate-600' },
  invoiceFail: { icon: FileWarning, cls: 'bg-red-50 text-red-600' },
  mpUnmatched: { icon: Wallet, cls: 'bg-sky-50 text-sky-600' },
};

function ago(date: string) {
  const min = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

/** Notificación de escritorio para los avisos nuevos (una vez cada uno). */
function notifyDesktop(items: Item[]) {
  if (typeof Notification === 'undefined') return;
  let shownAt = 0;
  try { shownAt = Number(localStorage.getItem(SHOWN_KEY)) || 0; } catch { /* sin storage */ }
  const fresh = items.filter((i) => !i.readAt && new Date(i.createdAt).getTime() > shownAt);
  if (!fresh.length) return;
  const newest = Math.max(...fresh.map((i) => new Date(i.createdAt).getTime()));
  try { localStorage.setItem(SHOWN_KEY, String(newest)); } catch { /* nada */ }
  // Primera vez en esta PC: no se dispara todo el historial de golpe
  if (!shownAt) return;
  const show = () => {
    const first = fresh[0];
    new Notification(fresh.length === 1 ? `Ventra · ${first.title}` : `Ventra · ${fresh.length} avisos nuevos`, {
      body: fresh.length === 1 ? first.body : fresh.slice(0, 3).map((i) => i.title).join(' · '),
    });
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') show(); });
}

/** Campanita con los avisos del comercio. Solo para administrador y encargado. */
export default function NotificationBell({ className = '' }: { className?: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const expiryEnabled = useFeature('expiry');
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [live, setLive] = useState<Live>({ expired: 0, soon: 0, lowStock: 0 });
  const [open, setOpen] = useState(false);
  const [showExpiring, setShowExpiring] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allowed = role === 'ADMIN' || role === 'SUPERVISOR';

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications');
      setItems(data.items || []);
      setUnread(data.unread || 0);
      setLive(data.live || { expired: 0, soon: 0, lowStock: 0 });
      notifyDesktop(data.items || []);
    } catch { /* sin conexión: queda lo último */ }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [allowed, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!allowed) return null;

  const expiring = expiryEnabled ? live.expired + live.soon : 0;
  const badge = unread + (expiring > 0 ? 1 : 0);

  const go = (url?: string | null) => {
    setOpen(false);
    if (!url) return;
    if (url === '#expiring') setShowExpiring(true);
    else navigate(url);
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Al abrir quedan leídos; el resaltado se ve hasta cerrar el panel
      api.post('/notifications/read-all').then(() => setUnread(0)).catch(() => {});
    }
  };

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        title="Notificaciones"
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 transition-colors cursor-pointer"
      >
        <Bell strokeWidth={2.25} className="w-4 h-4" />
        {badge > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold leading-4 text-white text-center ring-2 ring-white dark:ring-slate-900 ${live.expired || unread ? 'bg-rose-500' : 'bg-amber-500'}`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <p className="text-[14px] font-bold text-slate-800">Notificaciones</p>
            {items.some((i) => !i.readAt) && (
              <span className="flex items-center gap-1 text-[11.5px] font-semibold text-slate-500"><CheckCheck className="w-3.5 h-3.5" /> Marcadas como leídas</span>
            )}
          </div>

          {(expiring > 0 || live.lowStock > 0) && (
            <div className="p-2 border-b border-slate-100 space-y-1">
              <p className="px-2 pt-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Ahora</p>
              {expiring > 0 && (
                <button onClick={() => go('#expiring')} className="w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 text-left">
                  <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><CalendarClock className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800">
                    {[live.expired && `${live.expired} vencido${live.expired > 1 ? 's' : ''}`, live.soon && `${live.soon} por vencer`].filter(Boolean).join(' · ')}
                  </span>
                </button>
              )}
              {live.lowStock > 0 && (
                <button onClick={() => go('/stock-control')} className="w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50 text-left">
                  <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><PackageMinus className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800">
                    {live.lowStock} producto{live.lowStock > 1 ? 's' : ''} en stock mínimo
                  </span>
                </button>
              )}
            </div>
          )}

          <div className="max-h-[360px] overflow-y-auto p-2">
            {items.length === 0 && <p className="text-center text-[12.5px] text-slate-500 py-8">Sin avisos por ahora.</p>}
            {items.map((i) => {
              const ic = ICONS[i.type] || { icon: Bell, cls: 'bg-slate-100 text-slate-600' };
              const Icon = ic.icon;
              return (
                <button key={i.id} onClick={() => go(i.url)} className={`w-full flex items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50 ${!i.readAt ? 'bg-emerald-50/50' : ''}`}>
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ic.cls}`}><Icon className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-800 leading-snug">{i.title}</span>
                    {i.body && <span className="block text-[12px] text-slate-500 leading-snug line-clamp-2">{i.body}</span>}
                    <span className="block text-[11px] text-slate-400 mt-0.5">{ago(i.createdAt)}</span>
                  </span>
                  {!i.readAt && <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showExpiring && <ExpiringProductsModal onClose={() => { setShowExpiring(false); load(); }} />}
    </div>
  );
}
