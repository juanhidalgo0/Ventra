import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Lock, Store, ShoppingCart } from 'lucide-react';
import { usePlanStore, planAllows, planAreaOf, planHome } from '../../stores/planStore';

const UPGRADE_URL = 'https://ventra.store/cuenta.html';

function openUpgrade() {
  const tauri = (window as any).__TAURI__;
  const invoke = tauri?.core?.invoke || tauri?.invoke;
  if (invoke) invoke('open_browser', { url: UPGRADE_URL }).catch(() => window.open(UPGRADE_URL, '_blank'));
  else window.open(UPGRADE_URL, '_blank', 'noopener');
}

/**
 * Muestra la pantalla solo si el plan la incluye. Las pantallas de inicio (vender, Inicio
 * del celular) llevan a lo que el plan sí tiene; el resto muestra cómo mejorar el plan.
 * El límite real está en el servidor (LicenseGuard): esto es para que se entienda.
 */
export default function PlanGate({ mobile, children }: { mobile: boolean; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { features, planName, load, loaded } = usePlanStore();

  useEffect(() => {
    load();
    // Si el dueño cambia de plan, se ve sin reiniciar la app
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // Hasta saber el plan, las pantallas de un plan no se montan: si no, el POS alcanzaba a
  // abrirse (y a lanzar su recorrido de bienvenida) antes de llevar a la tienda.
  if (!loaded && planAreaOf(pathname)) {
    return <div className="flex-1 flex items-center justify-center"><span className="w-7 h-7 border-[3px] border-rose-600 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (planAllows(features, pathname)) return <>{children}</>;

  if (pathname === '/' || pathname === '/pos' || pathname === '/inicio') {
    return <Navigate to={planHome(features, mobile)} replace />;
  }

  const area = planAreaOf(pathname);
  const Icon = area === 'tienda' ? Store : ShoppingCart;
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 p-6 text-center shadow-sm">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center relative">
          <Icon className="w-7 h-7 text-rose-600" />
          <span className="absolute -right-1.5 -bottom-1.5 w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center">
            <Lock className="w-3.5 h-3.5 text-white" />
          </span>
        </span>
        <h2 className="mt-4 text-[17px] font-bold text-slate-900">
          {area === 'tienda' ? 'La tienda online no está en tu plan' : 'El sistema de ventas no está en tu plan'}
        </h2>
        <p className="mt-1.5 text-[13.5px] text-slate-500 leading-relaxed">
          {planName ? `Tenés ${planName}. ` : ''}
          {area === 'tienda'
            ? 'Con Ventra Full sumás tu tienda online: catálogo web, pedidos y avisos al celular.'
            : 'Con Ventra Full sumás la caja: vender, cierres X y Z, facturación, cuentas corrientes y reportes.'}
        </p>
        <button onClick={openUpgrade} className="mt-5 w-full h-11 rounded-xl bg-rose-600 text-white text-[14px] font-semibold active:scale-[0.99]">
          Pasarme a Ventra Full
        </button>
      </div>
    </div>
  );
}
