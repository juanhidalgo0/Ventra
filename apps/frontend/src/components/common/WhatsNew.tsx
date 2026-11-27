import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { X, Sparkles, Wrench, Zap } from 'lucide-react';
import { APP_VERSION } from '../../appVersion';
import { NOVEDADES, type Novedad, type TipoNovedad, type VersionNovedades } from '../../novedades';
import { useAuthStore } from '../../stores/authStore';
import { usePlanStore } from '../../stores/planStore';
import { useBusinessStore } from '../../stores/businessStore';
import { useTourStore } from './tour/tourStore';
import { useVentri, VentriDice } from './Ventri';

/**
 * Novedades de la versión: aparece sola una vez al dueño después de actualizar y se vuelve a abrir
 * desde Ayuda → Novedades (openWhatsNew). Nunca sale sola en la caja: no interrumpe una venta.
 * Si se saltearon versiones, junta todo lo que cambió desde la última que vio.
 */
const SEEN_KEY = 'ventra_novedades_vista';
const OPEN_EVENT = 'ventra:novedades';

export const openWhatsNew = () => window.dispatchEvent(new Event(OPEN_EVENT));

const cmpVersion = (a: string, b: string) => {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};

const readSeen = (): string | null => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (v: string) => { try { localStorage.setItem(SEEN_KEY, v); } catch { /* sin guardado: vuelve a salir */ } };

// ¿Esta PC ya usaba Ventra antes de que existieran las novedades? Se mira al cargar, antes de que
// los recorridos de esta sesión dejen marcas: una instalación nueva no recibe novedades de entrada.
const usedBefore = (() => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith('ventra_tours_seen') || k === 'business_profile' || k === 'ventra_broadcast_closed') return true;
    }
  } catch { /* sin guardado */ }
  return false;
})();

/** ¿Hay otra ventana o cartel abierto tapando la pantalla? */
export const otherOverlayOpen = (self = '[data-whatsnew]') =>
  Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0, [role="dialog"], [aria-modal="true"]')).some((el) => {
    if (el.closest(self)) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // Las decoraciones (luces de navidad, brillos) no cuentan: no reciben clics
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0' && s.pointerEvents !== 'none';
  });

/** Las versiones publicadas hasta la actual (las de más arriba que el número instalado no se muestran). */
export const publishedNovedades = (): VersionNovedades[] =>
  APP_VERSION ? NOVEDADES.filter((v) => cmpVersion(v.version, APP_VERSION) <= 0) : [];

const TIPOS: Record<TipoNovedad, { label: string; Icon: typeof Sparkles; cls: string }> = {
  nuevo: { label: 'Nuevo', Icon: Sparkles, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  mejora: { label: 'Mejor', Icon: Zap, cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  arreglo: { label: 'Arreglado', Icon: Wrench, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
};
const ORDEN: TipoNovedad[] = ['nuevo', 'mejora', 'arreglo'];

const fechaLarga = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
};

export default function WhatsNew() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemo = usePlanStore((s) => s.isDemo);
  const features = usePlanStore((s) => s.features);
  const profiles = useBusinessStore((s) => s.profiles);
  const tourActive = useTourStore((s) => !!s.activeTour);
  const ventri = useVentri();
  const [show, setShow] = useState<null | 'auto' | 'manual'>(null);

  // El candado cuenta como admin
  const isAdmin = user?.role === 'ADMIN'
    || sessionStorage.getItem('admin_unlocked') === 'true' || localStorage.getItem('admin_unlocked') === 'true';

  const applies = (n: Novedad) => {
    if (n.plan && features && features[n.plan] === false) return false;
    if (n.rubros?.length && !profiles.some((p) => n.rubros!.includes(p))) return false;
    return true;
  };

  /** Lo que todavía no vio: desde la última versión vista; si nunca vio ninguna, solo la actual. */
  const pending = useMemo(() => {
    const seen = readSeen();
    return publishedNovedades()
      .filter((v) => (seen ? cmpVersion(v.version, seen) > 0 : v.version === APP_VERSION))
      .map((v) => ({ ...v, items: v.items.filter(applies) }))
      .filter((v) => v.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, profiles, show]);

  // Instalación nueva: arranca al día, sin novedades viejas
  useEffect(() => {
    if (APP_VERSION && !readSeen() && !usedBefore) writeSeen(APP_VERSION);
  }, []);

  useEffect(() => {
    const onOpen = () => setShow('manual');
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Sola, una vez: al dueño, fuera de la caja y de los recorridos, con algo para contar
  const canAuto = isAuthenticated && isAdmin && !isDemo && !tourActive && !show
    && pathname !== '/pos' && pathname !== '/login' && pathname !== '/setup' && pending.length > 0;
  // …y nunca encima de otra ventana (primeros pasos, un cobro, un aviso): espera a que se cierre
  useEffect(() => {
    if (!canAuto) return;
    let calm = 0;
    const t = setInterval(() => {
      calm = otherOverlayOpen() ? 0 : calm + 1;
      if (calm >= 2) { clearInterval(t); setShow('auto'); }
    }, 1000);
    return () => clearInterval(t);
  }, [canAuto]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  // A mano: lo que no vio, o si ya vio todo, las últimas tres versiones
  const list = show === 'auto' || pending.length
    ? pending
    : publishedNovedades().slice(0, 3).map((v) => ({ ...v, items: v.items.filter(applies) })).filter((v) => v.items.length);

  function close() {
    if (APP_VERSION) writeSeen(APP_VERSION);
    setShow(null);
  }

  return createPortal(
    <div data-whatsnew className="fixed inset-0 z-[9500] bg-slate-900/50 flex items-end sm:items-center justify-center sm:p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="novedades-titulo"
        onClick={(e) => e.stopPropagation()}
        className="keep-style w-full sm:max-w-lg max-h-[88vh] flex flex-col bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3">
          <div className="min-w-0">
            <p className="eyebrow">Novedades</p>
            <h2 id="novedades-titulo" className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 leading-tight">
              {list.length ? `Qué hay de nuevo en Ventra ${list[0].version}` : 'Estás al día'}
            </h2>
          </div>
          <button onClick={close} aria-label="Cerrar" className="p-1.5 -mr-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 sm:px-6 pb-2">
          {ventri && list.length > 0 && show === 'auto' && (
            <VentriDice cara="picara" size={56} className="mb-4">¡Me actualicé! Te cuento rapidito qué cambió.</VentriDice>
          )}
          {!list.length && (
            <p className="text-[13.5px] text-slate-600 dark:text-slate-300 py-4">No hay novedades para mostrar en esta versión.</p>
          )}
          {list.map((v, vi) => (
            <section key={v.version} className={vi ? 'mt-5 pt-4 border-t border-slate-100 dark:border-slate-800' : ''}>
              {(list.length > 1 || show === 'manual') && (
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
                  Versión {v.version} · {fechaLarga(v.fecha)}
                </p>
              )}
              <ul className="space-y-3">
                {[...v.items].sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo)).map((n) => {
                  const t = TIPOS[n.tipo];
                  return (
                    <li key={n.titulo} className="flex gap-3">
                      <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${t.cls}`} title={t.label}>
                        <t.Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                          {n.titulo}
                          <span className={`ml-2 align-middle inline-block px-1.5 py-px rounded text-[10px] font-bold uppercase tracking-wide ${t.cls}`}>{t.label}</span>
                        </p>
                        {n.detalle && <p className="text-[12.5px] text-slate-600 dark:text-slate-400 leading-snug mt-0.5">{n.detalle}</p>}
                        {n.pedido && <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300">💬 Lo pidió un cliente</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-slate-400 leading-snug">Las volvés a ver en Ayuda → Novedades</span>
          <button onClick={close} className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-semibold shrink-0 active:scale-95 transition-transform">
            Entendido
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
