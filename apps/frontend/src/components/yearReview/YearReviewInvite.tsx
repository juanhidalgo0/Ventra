import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore } from '../../stores/planStore';
import { useTourStore } from '../common/tour/tourStore';
import { otherOverlayOpen } from '../common/WhatsNew';
import { useVentri, VentriImg } from '../common/Ventri';
import { fetchYearReview, isReviewSeason, reviewYear, MIN_TICKETS } from './yearReviewData';
import { openYearReview } from './YearReview';

/**
 * Del 1 de diciembre al 31 de enero, al dueño le aparece una invitación a ver su año (fuera de la
 * caja y nunca encima de otra ventana). "Más tarde" vuelve a ofrecerlo a los 3 días, hasta 3 veces.
 */
const key = (year: number) => `ventra_year_review_${year}`;
interface State { seen?: boolean; snoozes?: number; until?: number }
const read = (year: number): State => { try { return JSON.parse(localStorage.getItem(key(year)) || '{}'); } catch { return {}; } };
const write = (year: number, s: State) => { try { localStorage.setItem(key(year), JSON.stringify(s)); } catch { /* sin guardado */ } };

export default function YearReviewInvite() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemo = usePlanStore((s) => s.isDemo);
  const hasCaja = usePlanStore((s) => s.features?.caja !== false);
  const tourActive = useTourStore((s) => !!s.activeTour);
  const ventri = useVentri();
  const [eligible, setEligible] = useState(false);
  const [show, setShow] = useState(false);
  const year = reviewYear();

  const isAdmin = user?.role === 'ADMIN'
    || sessionStorage.getItem('admin_unlocked') === 'true' || localStorage.getItem('admin_unlocked') === 'true';

  const st = read(year);
  const due = isReviewSeason() && !st.seen && (st.snoozes || 0) < 3 && (!st.until || st.until < Date.now());

  // Solo si el año tiene ventas como para contar algo (una consulta, una vez)
  useEffect(() => {
    if (!isAuthenticated || !isAdmin || isDemo || !hasCaja || !due || eligible) return;
    let alive = true;
    fetchYearReview(year).then((r) => { if (alive && r.tickets >= MIN_TICKETS) setEligible(true); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isAdmin, isDemo, hasCaja, due]);

  const canShow = eligible && due && !show && !tourActive && pathname !== '/pos' && pathname !== '/login' && pathname !== '/setup';
  useEffect(() => {
    if (!canShow) return;
    let calm = 0;
    const t = setInterval(() => {
      calm = otherOverlayOpen('[data-year-invite]') ? 0 : calm + 1;
      if (calm >= 3) { clearInterval(t); setShow(true); }
    }, 1000);
    return () => clearInterval(t);
  }, [canShow]);

  if (!show) return null;

  const later = () => {
    write(year, { ...st, snoozes: (st.snoozes || 0) + 1, until: Date.now() + 3 * 86400000 });
    setShow(false);
  };
  const go = () => {
    write(year, { ...st, seen: true });
    setShow(false);
    openYearReview(year);
  };

  return createPortal(
    <div data-year-invite className="fixed inset-0 z-[9500] bg-slate-900/55 flex items-center justify-center p-4 anim-veil" onClick={later}>
      <div role="dialog" aria-modal="true" aria-labelledby="year-invite-title" onClick={(e) => e.stopPropagation()}
        className="keep-style relative w-full max-w-sm rounded-3xl overflow-hidden text-white shadow-2xl anim-pop"
        style={{ background: 'linear-gradient(160deg,#062e23 0%,#0b5a43 55%,#17925f 100%)' }}>
        <button onClick={later} aria-label="Cerrar" className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
        <div className="px-6 pt-7 pb-6">
          {ventri && <div className="mb-3"><VentriImg cara="picara" size={84} entra /></div>}
          <p className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-white/70">Ya está listo</p>
          <h2 id="year-invite-title" className="mt-1 text-[30px] leading-[1.05] font-black">Tu <span className="text-yellow-300">{year}</span> en Ventra</h2>
          <p className="mt-3 text-[14px] text-white/85 leading-snug">Tu mejor día, el producto estrella, la hora pico y mucho más, contado en historias.</p>
          <div className="mt-6 flex gap-2">
            <button onClick={go} className="flex-1 h-11 rounded-full bg-yellow-300 hover:bg-yellow-200 text-emerald-950 text-[14.5px] font-extrabold">Ver mi año</button>
            <button onClick={later} className="h-11 px-4 rounded-full bg-white/10 hover:bg-white/15 text-[13.5px] font-semibold">Más tarde</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
