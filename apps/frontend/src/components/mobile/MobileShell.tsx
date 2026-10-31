import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, ShoppingCart, ArrowLeftRight, Package, LayoutGrid, ChevronLeft, Store, ClipboardList, CalendarDays, Users, Banknote, Truck, Printer, Stethoscope } from 'lucide-react';
import { useBusinessStore, isConsultorio } from '../../stores/businessStore';
import { useWorkRole } from '../../services/workRole';
import { usePlanStore, isAgendaOnly } from '../../stores/planStore';
import SubscriptionBanner from '../subscription/SubscriptionBanner';
import OfflineStartBanner from '../common/OfflineStartBanner';

const TABS = [
  { path: '/inicio', label: 'Inicio', icon: Home },
  { path: '/pos', label: 'Vender', icon: ShoppingCart },
  { path: '/historial', label: 'Movimientos', icon: ArrowLeftRight },
  { path: '/products', label: 'Productos', icon: Package },
  { path: '/mas', label: 'Más', icon: LayoutGrid },
];

/** Títulos de las pantallas que se abren desde "Más" y todavía no tienen versión móvil propia. */
const SCREEN_TITLES: Record<string, string> = {
  '/cash-control': 'Cajas y cierres',
  '/cash': 'Caja',
  '/gastos': 'Gastos',
  '/clients': 'Cuentas corrientes',
  '/treasury': 'Tesorería',
  '/stock-control': 'Control de stock',
  '/stock-audit': 'Auditoría de stock',
  '/purchases': 'Compras',
  '/suppliers': 'Proveedores',
  '/promos': 'Promociones',
  '/reports': 'Reportes',
  '/dashboard': 'Estadísticas',
  '/fiscal': 'Facturación',
  '/online-store': 'Tienda online',
  '/pedidos': 'Pedidos online',
  '/preventa': 'Preventa',
  '/reparto': 'Reparto',
  '/agenda': 'Agenda',
  '/agenda/clientes': 'Clientes',
  '/agenda/cobros': 'Cobros',
  '/pacientes': 'Pacientes',
  '/notificaciones': 'Notificaciones',
  '/settings': 'Configuración',
};

/** Distribuidora: el día gira alrededor de los pedidos y el reparto (vender en el mostrador está en Inicio y en Más) */
const DISTRIB_TABS = [
  { path: '/inicio', label: 'Inicio', icon: Home },
  { path: '/preventa', label: 'Pedidos', icon: ClipboardList },
  { path: '/reparto', label: 'Reparto', icon: Truck },
  { path: '/products', label: 'Productos', icon: Package },
  { path: '/mas', label: 'Más', icon: LayoutGrid },
];

/** Imprenta y trabajos a pedido: los encargos son lo del día */
const WORKORDER_TABS = [
  { path: '/inicio', label: 'Inicio', icon: Home },
  { path: '/encargos', label: 'Encargos', icon: Printer },
  { path: '/pos', label: 'Vender', icon: ShoppingCart },
  { path: '/products', label: 'Productos', icon: Package },
  { path: '/mas', label: 'Más', icon: LayoutGrid },
];

/** Plan Tienda (sin sistema de ventas): la tienda y sus pedidos reemplazan a Inicio, Vender y Movimientos. */
const TIENDA_TABS = [
  { path: '/tienda', label: 'Inicio', icon: Store },
  { path: '/pedidos', label: 'Pedidos', icon: ClipboardList },
  { path: '/products', label: 'Productos', icon: Package },
  { path: '/mas', label: 'Más', icon: LayoutGrid },
];

/** Plan Agenda (solo turnos): la agenda es el inicio. */
const AGENDA_TABS = [
  { path: '/agenda', label: 'Agenda', icon: CalendarDays },
  { path: '/agenda/clientes', label: 'Clientes', icon: Users },
  { path: '/agenda/cobros', label: 'Cobros', icon: Banknote },
  { path: '/mas', label: 'Más', icon: LayoutGrid },
];

/** Nutricionista: los pacientes son el inicio; no hay caja ni productos. */
const NUTRI_TABS = [
  { path: '/pacientes', label: 'Pacientes', icon: Stethoscope },
  { path: '/agenda', label: 'Agenda', icon: CalendarDays },
  { path: '/agenda/cobros', label: 'Cobros', icon: Banknote },
  { path: '/mas', label: 'Más', icon: LayoutGrid },
];

type Tab = { path: string; label: string; icon: any };

/**
 * Tareas de foco (tomar un pedido, una parada del reparto): la barra de pestañas se esconde para
 * dejar todo el lugar a la tarea y que no compita con su botón principal.
 */
const useFocus = create<{ n: number; add: (d: number) => void }>((set) => ({ n: 0, add: (d) => set((s) => ({ n: Math.max(0, s.n + d) })) }));
export function useMobileFocus(active = true) {
  useEffect(() => {
    if (!active) return;
    useFocus.getState().add(1);
    return () => useFocus.getState().add(-1);
  }, [active]);
}
const isTab = (tabs: Tab[], pathname: string) => tabs.some((t) => t.path === pathname);
/** Pantallas de "Más" que ya tienen su versión móvil (traen su propio encabezado con "volver"). */
export const NATIVE_MOBILE_PATHS = ['/preventa', '/reparto', '/informes', '/encargos', '/hoy', '/empezar', '/cash-control', '/gastos', '/clients', '/suppliers', '/stock-control', '/purchases', '/promos', '/treasury', '/earnings-division', '/reports', '/fiscal', '/settings', '/online-store', '/pedidos', '/agenda', '/agenda/clientes', '/agenda/cobros', '/pacientes', '/notificaciones'];
/** Las pantallas que no son pestañas se abren desde "Más" y la marcan activa. */
const tabFor = (tabs: Tab[], pathname: string) => tabs.find((t) => pathname === t.path)?.path ?? (pathname === '/inventory' ? '/products' : pathname.startsWith('/pacientes/') ? '/pacientes' : '/mas');

const PULL_LIMIT = 80;

/**
 * Deslizar hacia abajo estando arriba de todo recarga la app (y con ella todos los datos),
 * en cualquier pantalla. Las que tienen su propio "deslizar para actualizar" (Inicio,
 * con data-pull-refresh) se manejan solas. Las hojas y ventanas abiertas no se ven
 * afectadas: se dibujan fuera de <main>.
 */
function usePullToReload() {
  const [pull, setPull] = useState(0);
  const [reloading, setReloading] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pullRef = useRef(0);

  const scrollerAt = (target: EventTarget | null, root: HTMLElement) => {
    let el = target as HTMLElement | null;
    while (el && el !== root) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return null;
  };

  const handlers = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      // Los eventos de React atraviesan los portales: un toque en una hoja abierta (que se
      // dibuja fuera de <main>) también llega acá. Solo cuenta lo que está dentro de <main>.
      if (reloading || e.touches.length !== 1 || !e.currentTarget.contains(target)
        || target.closest('[data-pull-refresh], input, textarea, select')) { start.current = null; return; }
      const sc = scrollerAt(target, e.currentTarget);
      start.current = !sc || sc.scrollTop <= 0 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      // Solo un gesto hacia abajo y más vertical que horizontal
      if (dy <= 0 || dx > dy) { if (pullRef.current) { pullRef.current = 0; setPull(0); } if (dy < 0) start.current = null; return; }
      pullRef.current = Math.min(PULL_LIMIT + 30, dy * 0.5);
      setPull(pullRef.current);
    },
    onTouchEnd: () => {
      const go = pullRef.current >= PULL_LIMIT;
      start.current = null;
      pullRef.current = 0;
      if (!go) { setPull(0); return; }
      setReloading(true);
      setPull(56);
      try { navigator.vibrate?.(10); } catch { /* */ }
      window.location.reload();
    },
  };
  return { pull, reloading, handlers };
}

/** Marco de la app del dueño en el celular: contenido arriba y barra de pestañas abajo. */
export default function MobileShell({ children, tabs: staffTabs }: { children: React.ReactNode; tabs?: Tab[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const distrib = useBusinessStore((s) => !!s.features.preorders);
  const workorders = useBusinessStore((s) => !!s.features.workorders);
  const consultorio = useBusinessStore((s) => isConsultorio(s.profile));
  const planTabs = usePlanStore((s) => (consultorio && s.features.agenda ? NUTRI_TABS : s.features.caja ? (distrib ? DISTRIB_TABS : workorders ? WORKORDER_TABS : TABS) : isAgendaOnly(s.features) ? AGENDA_TABS : TIENDA_TABS));
  const tabs: Tab[] = staffTabs || planTabs;
  const focus = useFocus((s) => s.n > 0);
  const active = tabFor(tabs, pathname);
  const inTab = isTab(tabs, pathname) || NATIVE_MOBILE_PATHS.includes(pathname) || pathname.startsWith('/settings/') || pathname.startsWith('/pacientes/');
  const scrollsItself = pathname === '/inicio' || pathname === '/mas';
  const { pull, reloading, handlers } = usePullToReload();

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#F6F8F7] overflow-hidden keep-animated mobile-app">
      {pull > 0 && (
        <div className="fixed inset-x-0 z-50 flex justify-center pointer-events-none" style={{ top: `calc(env(safe-area-inset-top) + ${Math.min(pull, 90) - 36}px)` }}>
          <span className="w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center">
            <span
              className={`w-4 h-4 border-2 border-rose-600 border-t-transparent rounded-full ${reloading ? 'animate-spin' : ''}`}
              style={reloading ? undefined : { transform: `rotate(${pull * 5}deg)`, opacity: Math.min(1, pull / PULL_LIMIT) }}
            />
          </span>
        </div>
      )}
      <OfflineStartBanner inline />
      {!inTab && (
        <div className="shrink-0 bg-rose-600 text-white pt-[env(safe-area-inset-top)] rounded-b-[20px] shadow-[0_6px_20px_-12px_rgba(14,110,82,0.8)] relative z-10">
          <div className="h-14 flex items-center gap-2 px-2">
            <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-white/15" aria-label="Volver">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <p className="flex-1 text-[17px] font-bold tracking-tight truncate">{SCREEN_TITLES[pathname] || ''}</p>
          </div>
        </div>
      )}

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden" {...handlers}>
        <SubscriptionBanner />
        <div className={`flex-1 min-h-0 flex flex-col ${scrollsItself ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'} ${inTab ? '' : 'p-3 overflow-y-auto'}`}>
          {children}
        </div>
      </main>

      <nav
        hidden={focus}
        className="shrink-0 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)] z-40"
        aria-label="Secciones"
      >
        <div className="flex h-16">
          {tabs.map(({ path, label, icon: Icon }) => {
            const isActive = active === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="relative flex-1 flex flex-col items-center justify-center gap-1 active:scale-95 transition-transform"
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <motion.span
                    layoutId="mobile-tab-pill"
                    className="absolute top-1.5 h-8 w-14 rounded-full bg-rose-50"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <Icon className={`relative w-[22px] h-[22px] ${isActive ? 'text-rose-600' : 'text-slate-400'}`} strokeWidth={isActive ? 2.3 : 1.9} />
                <span className={`relative text-[10.5px] leading-none ${isActive ? 'font-semibold text-rose-700' : 'font-medium text-slate-500'}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/**
 * La app del celular para empleados: solo las pestañas de lo que hace cada uno.
 * Chofer: su reparto. Vendedor: sus pedidos. Mostrador o cajero: vender (y en la distribuidora,
 * los pedidos para cobrarlos en el mostrador). Lo demás del negocio queda para el dueño.
 */
export function StaffMobileShell({ children }: { children: React.ReactNode }) {
  const role = useWorkRole();
  const distrib = useBusinessStore((s) => !!s.features.preorders);
  const workorders = useBusinessStore((s) => !!s.features.workorders);
  const more = { path: '/mas', label: 'Más', icon: LayoutGrid };
  const jobs = { path: '/encargos', label: 'Encargos', icon: Printer };
  const sell = { path: '/pos', label: 'Vender', icon: ShoppingCart };
  const orders = { path: '/preventa', label: 'Pedidos', icon: ClipboardList };
  const route = { path: '/reparto', label: 'Reparto', icon: Truck };
  const tabs = role === 'CHOFER' ? [route, more]
    : role === 'TALLER' || role === 'DISENO' ? [jobs, more]
    : role === 'VENDEDOR' ? [orders, more]
    : role === 'MOSTRADOR' ? [sell, orders, more]
    : distrib ? [sell, orders, route, more]
    : workorders ? [jobs, sell, more]
    : [sell, more];
  return <MobileShell tabs={tabs}>{children}</MobileShell>;
}
