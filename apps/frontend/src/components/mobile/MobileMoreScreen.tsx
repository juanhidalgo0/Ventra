import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, Receipt, Users, BarChart3, Truck, ShoppingBag, Tag, ClipboardCheck,
  Landmark, FileText, Settings, LogOut, ChevronRight, Store, Bell,
} from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { money } from './ui';
import InstallAppCard from './InstallAppCard';
import PushCard from './PushCard';
import { useOnlineOrders, useOrdersVisible, isNewOrder } from '../../services/onlineStoreOrders';
import { usePlanStore, planAllows } from '../../stores/planStore';

interface Tile { path: string; label: string; hint: string; icon: any; tint: string }

const SECTIONS: { title: string; items: Tile[] }[] = [
  {
    title: 'Plata',
    items: [
      { path: '/cash-control', label: 'Cajas', hint: 'Abiertas y cierres', icon: Wallet, tint: 'bg-rose-50 text-rose-700' },
      { path: '/gastos', label: 'Gastos', hint: 'Del mes', icon: Receipt, tint: 'bg-red-50 text-red-600' },
      { path: '/clients', label: 'Fiado', hint: 'Quién te debe', icon: Users, tint: 'bg-amber-50 text-amber-700' },
      { path: '/treasury', label: 'Tesorería', hint: 'Bancos y billeteras', icon: Landmark, tint: 'bg-sky-50 text-sky-700' },
    ],
  },
  {
    title: 'Mercadería',
    items: [
      { path: '/stock-control', label: 'Stock', hint: 'Lo que falta', icon: ClipboardCheck, tint: 'bg-orange-100 text-orange-800' },
      { path: '/purchases', label: 'Compras', hint: 'Facturas', icon: ShoppingBag, tint: 'bg-rose-50 text-rose-700' },
      { path: '/suppliers', label: 'Proveedores', hint: 'Deudas y pagos', icon: Truck, tint: 'bg-violet-50 text-violet-700' },
      { path: '/promos', label: 'Promociones', hint: 'Vigentes', icon: Tag, tint: 'bg-pink-50 text-pink-700' },
    ],
  },
  {
    title: 'Negocio',
    items: [
      { path: '/reports', label: 'Reportes', hint: 'Análisis', icon: BarChart3, tint: 'bg-sky-50 text-sky-700' },
      { path: '/fiscal', label: 'Facturación', hint: 'ARCA', icon: FileText, tint: 'bg-slate-100 text-slate-700' },
      { path: '/online-store', label: 'Tienda online', hint: 'Tu catálogo web', icon: Store, tint: 'bg-emerald-50 text-emerald-700' },
      { path: '/notificaciones', label: 'Notificaciones', hint: 'Avisos al celular', icon: Bell, tint: 'bg-amber-50 text-amber-700' },
      { path: '/settings', label: 'Configuración', hint: 'Sistema', icon: Settings, tint: 'bg-slate-100 text-slate-700' },
    ],
  },
];

export default function MobileMoreScreen() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [owed, setOwed] = useState<number | null>(null);
  const planFeatures = usePlanStore((s) => s.features);
  // Solo las secciones que incluye el plan (Caja / Tienda / Full)
  const sections = SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => planAllows(planFeatures, i.path)) }))
    .filter((s) => s.items.length > 0);

  // Un dato vivo en el encabezado: cuánto te deben por fiado
  useEffect(() => {
    api.get('/clients')
      .then((r) => setOwed((r.data || []).reduce((s: number, c: any) => s + (c.balance > 0 ? c.balance : 0), 0)))
      .catch(() => {});
  }, []);

  const ordersVisible = useOrdersVisible();
  const newOrders = useOnlineOrders((s) => s.orders.filter(isNewOrder).length);
  const name = user?.fullName || user?.username || '';
  const store = localStorage.getItem('gd_store_name') || 'Tu comercio';

  return (
    <div className="min-h-full pb-8">
      <header className="bg-rose-600 text-white px-5 pt-[calc(env(safe-area-inset-top)+1.1rem)] pb-6 rounded-b-[24px] shadow-[0_6px_20px_-12px_rgba(14,110,82,0.8)]">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-orange-200 text-orange-900 flex items-center justify-center text-xl font-bold shrink-0">
            {(name || '?')[0]?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-[18px] font-bold truncate">{name}</p>
            <p className="text-[12.5px] text-rose-100 truncate">{store} · Dueño</p>
          </div>
        </div>
        {planFeatures.caja && owed !== null && owed > 0 && (
          <button onClick={() => navigate('/clients')} className="mt-4 w-full flex items-center justify-between rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-4 py-3 text-left active:bg-white/15">
            <span>
              <span className="block text-[12px] text-rose-100">Te deben por fiado</span>
              <span className="block text-[20px] font-bold tabular-nums">{money(owed)}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-rose-100" />
          </button>
        )}
      </header>

      <div className="px-4 pt-5 space-y-6">
        <InstallAppCard />
        <PushCard />
        {ordersVisible && (
          <button onClick={() => navigate('/pedidos')} className="w-full flex items-center gap-3 rounded-2xl bg-white border border-slate-200/80 p-4 text-left active:scale-[0.99] transition-transform">
            <span className="w-11 h-11 rounded-2xl bg-rose-600 text-white flex items-center justify-center shrink-0"><ShoppingBag className="w-5 h-5" /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-semibold text-slate-900">Pedidos online</span>
              <span className="block text-[12px] text-slate-500">{newOrders ? `${newOrders} ${newOrders === 1 ? 'pedido nuevo' : 'pedidos nuevos'}` : 'Lo que piden tus clientes en la tienda'}</span>
            </span>
            {newOrders > 0 && <span className="min-w-[24px] h-6 px-2 rounded-full bg-rose-600 text-white text-[12px] font-bold flex items-center justify-center">{newOrders}</span>}
            <ChevronRight className="w-4 h-4 text-slate-300" />
          </button>
        )}
        {sections.map((section) => (
          <section key={section.title}>
            <p className="text-[12.5px] font-semibold text-slate-500 px-1 mb-2">{section.title}</p>
            <div className="grid grid-cols-2 gap-3">
              {section.items.map(({ path, label, hint, icon: Icon, tint }) => (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className="bg-white rounded-2xl border border-slate-200/80 p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] active:scale-[0.97] transition-transform"
                >
                  <span className={`w-11 h-11 rounded-2xl flex items-center justify-center ${tint}`}>
                    <Icon className="w-[22px] h-[22px]" />
                  </span>
                  <span className="block mt-3 text-[15px] font-semibold text-slate-900">{label}</span>
                  <span className="block text-[12px] text-slate-500">{hint}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <button onClick={logout} className="w-full flex items-center gap-3 px-4 h-[56px] active:bg-slate-50 text-left">
            <span className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0"><LogOut className="w-[18px] h-[18px] text-red-600" /></span>
            <span className="flex-1 text-[14.5px] text-red-600 font-medium">Cerrar sesión</span>
          </button>
        </div>
      </div>
    </div>
  );
}
