import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore } from '../../stores/planStore';
import { useTourStore } from '../common/tour/tourStore';
import { otherOverlayOpen } from '../common/WhatsNew';
import { useVentri, VentriImg } from '../common/Ventri';
import { openInviteStore } from '../referral/InviteStore';
import { type Achievement, type LogrosState, type Milestones, nextAchievement, milestoneParams } from './logros';

/**
 * Logros del negocio: "¡Venta número 10.000!", "Ayer fue tu mejor día", "1 año con Ventra"…
 * Un festejo cada vez, al dueño, fuera de la caja y nunca encima de otra ventana. Se revisa al
 * entrar y cada 30 minutos. Lo festejado queda anotado en esta PC.
 */
const KEY = 'ventra_logros';
const read = (): LogrosState => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || { seen: [] }; } catch { return { seen: [] }; } };
const write = (s: LogrosState) => { try { localStorage.setItem(KEY, JSON.stringify({ ...s, seen: (s.seen || []).slice(-60) })); } catch { /* sin guardado */ } };

const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function texts(a: Achievement): { emoji: string; kicker: string; big: string; line: string } {
  switch (a.kind) {
    case 'ventas': return { emoji: '🎉', kicker: 'Llegaste a', big: a.count.toLocaleString('es-AR'), line: a.count === 1 ? 'venta con Ventra' : 'ventas con Ventra. ¡Gracias por confiar!' };
    case 'record-dia': return { emoji: '🏆', kicker: 'Ayer fue tu mejor día', big: money(a.total), line: `Le ganaste a tu récord anterior de ${money(a.prev)}.` };
    case 'record-mes': return { emoji: '🚀', kicker: `${MESES[a.month][0].toUpperCase()}${MESES[a.month].slice(1)} fue tu mejor mes`, big: money(a.total), line: `Superaste tu mejor mes anterior (${money(a.prev)}).` };
    case 'aniversario': return { emoji: '🎂', kicker: '¡Feliz aniversario!', big: a.years === 1 ? '1 año' : `${a.years} años`, line: 'vendiendo con Ventra. ¡Por muchos más!' };
  }
}

export default function Achievements() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemo = usePlanStore((s) => s.isDemo);
  const hasCaja = usePlanStore((s) => s.features?.caja !== false);
  const tourActive = useTourStore((s) => !!s.activeTour);
  const ventri = useVentri();
  const [found, setFound] = useState<Achievement | null>(null);
  const [show, setShow] = useState<Achievement | null>(null);

  const isAdmin = user?.role === 'ADMIN'
    || sessionStorage.getItem('admin_unlocked') === 'true' || localStorage.getItem('admin_unlocked') === 'true';
  const enabled = isAuthenticated && isAdmin && !isDemo && hasCaja;

  // Buscar qué festejar: al entrar y cada 30 minutos
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const check = async () => {
      try {
        const { data } = await api.get<Milestones>('/sales/milestones', { params: milestoneParams() });
        if (!alive) return;
        const st = read();
        // Primera vez: las ventas que ya tenía no se festejan (solo lo que venga desde ahora)
        if (st.baseline == null) { st.baseline = data.salesCount; st.seen = st.seen || []; write(st); }
        setFound(nextAchievement(data, st));
      } catch { /* sin conexión con la caja: se prueba en un rato */ }
    };
    check();
    const t = setInterval(check, 30 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);

  // Mostrarlo cuando no molesta: fuera de la caja, sin recorrido y sin otra ventana abierta
  const canShow = !!found && !show && !tourActive && pathname !== '/pos' && pathname !== '/login' && pathname !== '/setup';
  useEffect(() => {
    if (!canShow) return;
    let calm = 0;
    const t = setInterval(() => {
      calm = otherOverlayOpen('[data-logro]') ? 0 : calm + 1;
      if (calm >= 3) { clearInterval(t); setShow(found); }
    }, 1000);
    return () => clearInterval(t);
  }, [canShow, found]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;
  const t = texts(show);

  function close() {
    if (!show) return;
    const st = read();
    write({ ...st, seen: [...(st.seen || []), show.id] });
    setShow(null);
    setFound(null);
  }

  return createPortal(
    <div data-logro className="fixed inset-0 z-[9400] bg-slate-900/60 flex items-center justify-center p-4 anim-veil" onClick={close}>
      <style>{CONFETTI_CSS}</style>
      <div role="dialog" aria-modal="true" aria-labelledby="logro-title" onClick={(e) => e.stopPropagation()}
        className="keep-style keep-animated relative w-full max-w-sm rounded-3xl overflow-hidden text-white text-center shadow-2xl anim-pop"
        style={{ background: 'linear-gradient(160deg,#062e23 0%,#0b5a43 55%,#17925f 100%)' }}>
        {/* Papelitos */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => (
            <span key={i} className="logro-confetti" style={{
              left: `${(i * 37) % 100}%`, background: ['#fde047', '#ffffff', '#5eead4', '#fca5a5', '#c4b5fd'][i % 5],
              animationDelay: `${(i % 7) * 120}ms`, animationDuration: `${1600 + (i % 5) * 260}ms`, transform: `rotate(${i * 29}deg)`,
            }} />
          ))}
        </div>
        <button onClick={close} aria-label="Cerrar" className="absolute top-3 right-3 z-10 p-1.5 rounded-full hover:bg-white/10"><X className="w-5 h-5" /></button>
        <div className="relative px-7 pt-8 pb-7">
          {ventri ? <div className="flex justify-center"><VentriImg cara="sorprendida" size={96} entra /></div> : <p className="text-[54px] leading-none">{t.emoji}</p>}
          <p className="mt-4 text-[12.5px] font-extrabold uppercase tracking-[0.16em] text-white/75">{t.kicker}</p>
          <h2 id="logro-title" className="mt-1 text-[44px] leading-none font-black text-yellow-300 tabular-nums">{t.big}</h2>
          <p className="mt-3 text-[15px] font-semibold text-white/90 leading-snug">{t.line}</p>
          <button onClick={close} className="mt-6 w-full h-11 rounded-full bg-yellow-300 hover:bg-yellow-200 text-emerald-950 text-[15px] font-extrabold">¡Genial!</button>
          <button onClick={() => { close(); openInviteStore(); }}
            className="mt-3 text-[12.5px] font-semibold text-white/75 hover:text-white underline underline-offset-2">
            ¿Conocés otro comercio? Invitalo y ganá un mes gratis
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CONFETTI_CSS = `
.logro-confetti { position: absolute; top: -12px; width: 8px; height: 14px; border-radius: 2px; opacity: 0.9;
  animation-name: logro-fall; animation-timing-function: cubic-bezier(0.3, 0.6, 0.5, 1); animation-iteration-count: 2; animation-fill-mode: forwards; }
@keyframes logro-fall { to { top: 105%; transform: rotate(540deg); opacity: 0.2; } }
@media (prefers-reduced-motion: reduce) { .logro-confetti { display: none; } }
`;
