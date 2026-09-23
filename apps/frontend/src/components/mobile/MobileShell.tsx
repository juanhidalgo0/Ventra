import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, ShoppingCart, ArrowLeftRight, Package, LayoutGrid, ChevronLeft } from 'lucide-react';
import SubscriptionBanner from '../subscription/SubscriptionBanner';

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
  '/notificaciones': 'Notificaciones',
  '/settings': 'Configuración',
};

const isTab = (pathname: string) => TABS.some((t) => t.path === pathname);
/** Pantallas de "Más" que ya tienen su versión móvil (traen su propio encabezado con "volver"). */
export const NATIVE_MOBILE_PATHS = ['/cash-control', '/gastos', '/clients', '/suppliers', '/stock-control', '/purchases', '/promos', '/treasury', '/reports', '/fiscal', '/settings', '/online-store', '/pedidos', '/notificaciones'];
/** Las pantallas que no son pestañas se abren desde "Más" y la marcan activa. */
const tabFor = (pathname: string) => TABS.find((t) => pathname === t.path)?.path ?? (pathname === '/inventory' ? '/products' : '/mas');

/** Marco de la app del dueño en el celular: contenido arriba y barra de pestañas abajo. */
export default function MobileShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = tabFor(pathname);
  const inTab = isTab(pathname) || NATIVE_MOBILE_PATHS.includes(pathname) || pathname.startsWith('/settings/');
  const scrollsItself = pathname === '/inicio' || pathname === '/mas';

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#F6F8F7] overflow-hidden keep-animated mobile-app">
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

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <SubscriptionBanner />
        <div className={`flex-1 min-h-0 flex flex-col ${scrollsItself ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'} ${inTab ? '' : 'p-3 overflow-y-auto'}`}>
          {children}
        </div>
      </main>

      <nav
        className="shrink-0 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)] z-40"
        aria-label="Secciones"
      >
        <div className="flex h-16">
          {TABS.map(({ path, label, icon: Icon }) => {
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
