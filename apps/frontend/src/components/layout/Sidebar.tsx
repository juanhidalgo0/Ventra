import { useNavigate, useLocation } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { useOnlineOrders, useOrdersVisible, isNewOrder } from '../../services/onlineStoreOrders';
import { useAuthStore } from '../../stores/authStore';
import { 
  ShoppingBag, 
  LayoutDashboard, 
  Package, 
  Monitor, 
  Users, 
  Banknote,
  Truck, 
  Receipt, 
  History, 
  BarChart3, 
  Settings, 
  LogOut,
  ChevronDown,
  Box,
  Wallet,
  Network,
  Users2,
  FileText,
  Calculator,
  AlertCircle,
  ChevronRight,
  ClipboardCheck,
  Globe,
  CalendarDays,
  Smartphone,
  X
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { MangoLogo as BrandLogo } from '../common/MangoLogo';
import { hasFeature, useBusinessStore } from '../../stores/businessStore';
import { usePlanStore, isAgendaOnly } from '../../stores/planStore';
import { menuAllows } from '../../stores/businessStore';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
  onCloseMobile?: () => void;
}

export default function Sidebar({ isCollapsed, setIsCollapsed, onCloseMobile }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuthStore();
  
  // State for expanded groups
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [showAdminUnlockModal, setShowAdminUnlockModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [pendingAdminPath, setPendingAdminPath] = useState<string | null>(null);

  const handleSidebarClick = (path: string) => {
    const isAdminUnlocked = localStorage.getItem('admin_unlocked') === 'true';
    
    if (path === '/settings' && user?.role !== 'ADMIN' && !isAdminUnlocked) {
      setPendingAdminPath(path);
      setShowAdminUnlockModal(true);
      setAdminPassword('');
    } else {
      navigate(path);
      onCloseMobile?.();
    }
  };

  const handleVerifyAdminPassword = async () => {
    if (!adminPassword) return;
    setIsVerifying(true);
    try {
      // Clave del administrador del comercio (el usuario con rol ADMIN, se llame como se llame)
      const { data } = await api.post('/auth/admin-unlock', { password: adminPassword });
      localStorage.setItem('admin_unlocked', 'true');
      sessionStorage.setItem('admin_unlocked', 'true');
      sessionStorage.setItem('adminAccessToken', data.accessToken);
      sessionStorage.setItem('adminRefreshToken', data.refreshToken);
      setShowAdminUnlockModal(false);
      
      const targetPath = pendingAdminPath || '/settings';
      navigate(targetPath);
      setPendingAdminPath(null);
      onCloseMobile?.();
    } catch (err) {
      toast.error('❌ Contraseña de Administrador incorrecta');
    } finally {
      setIsVerifying(false);
    }
  };

  const toggleGroup = (label: string) => {
    setExpandedGroups(prev => 
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  };

  const ordersVisible = useOrdersVisible();
  const newOrders = useOnlineOrders((s) => s.orders.filter(isNewOrder).length);

  const planFeatures = usePlanStore((s) => s.features);
  const intents = useBusinessStore((s) => s.intents);
  const agendaOnly = isAgendaOnly(planFeatures);
  // Botón principal y subtítulo según lo que hace el comercio con Ventra
  const home = planFeatures.caja
    ? { path: '/pos', label: 'Punto de Venta', icon: ShoppingBag, subtitle: 'Sistema de ventas' }
    : agendaOnly
      ? { path: '/agenda', label: 'Mi agenda', icon: CalendarDays, subtitle: 'Turnos online' }
      : { path: '/tienda', label: 'Mi tienda', icon: Globe, subtitle: 'Tienda online' };

  const menuGroups = [
    {
      title: 'General',
      items: [
        { 
          label: 'Productos', 
          icon: Box, 
          path: '/products', 
          collapsible: true,
          subItems: [
            { label: 'Inventario', path: '/inventory' },
            { label: 'Promociones y Combos', path: '/promos' },
            { label: 'Compras', path: '/purchases' },
            { label: 'Control de Stock', path: '/stock-control' },
            { label: 'Auditoría de Stock', path: '/stock-audit' },
          ]
        },
        { 
          label: 'Caja & Tesorería', 
          icon: Wallet, 
          path: '/cash', 
          collapsible: true,
          subItems: [
            { label: 'Control de Caja', path: '/cash-control' },
            { label: 'Cuentas Corrientes', path: '/clients' },
            { label: 'Tesorería', path: '/treasury' },
          ]
        },
        { label: 'Clientes', icon: Users, path: '/clients' },
        { label: 'Proveedores', icon: Truck, path: '/suppliers' },
        { label: 'Gastos', icon: Receipt, path: '/gastos' },
        { label: 'Historial de Ventas', icon: History, path: '/historial' },
        ...((ordersVisible || !planFeatures.caja) && user?.role === 'ADMIN' ? [{ label: 'Pedidos online', icon: ShoppingCart, path: '/pedidos', badge: newOrders }] : []),
        ...(user?.role === 'ADMIN' && !agendaOnly ? [{ label: 'Agenda de turnos', icon: CalendarDays, path: '/agenda' }] : []),
        // Sin caja, los turnos se cobran en la agenda: clientes y cobros propios
        ...(user?.role === 'ADMIN' && !planFeatures.caja && planFeatures.agenda ? [
          { label: agendaOnly ? 'Clientes' : 'Clientes de la agenda', icon: Users, path: '/agenda/clientes' },
          { label: agendaOnly ? 'Cobros' : 'Cobros de turnos', icon: Banknote, path: '/agenda/cobros' },
        ] : []),
        { label: 'Reportes', icon: BarChart3, path: '/reports' },
        { label: 'Facturación', icon: Calculator, path: '/fiscal' },
        { 
          label: 'Tienda Online', 
          icon: Globe, 
          path: '/online-store',
          collapsible: true,
          subItems: [
            { label: 'Configuración', path: '/online-store' },
            { label: 'Métricas y Ventas', path: '/online-store/metrics' },
          ]
        },
        { label: 'División de Ganancias', icon: Calculator, path: '/earnings-division' },
        ...(hasFeature('quotes') ? [
          { label: 'Presupuestos', icon: FileText, path: '/quotes' }
        ] : []),
        ...(user?.role === 'ADMIN' && !agendaOnly ? [
          { label: 'Acceso Remoto', icon: Smartphone, path: '/remote-access' }
        ] : [])
      ]
    }
  ];

  // Solo lo que incluye el plan (Caja / Tienda / Full)
  const visibleGroups = menuGroups.map((group) => ({
    ...group,
    items: group.items
      .map((item: any) => (item.subItems ? { ...item, subItems: item.subItems.filter((sub: any) => menuAllows(planFeatures, intents, sub.path)) } : item))
      .filter((item: any) => menuAllows(planFeatures, intents, item.path) || (item.subItems && item.subItems.length > 0)),
  })).filter((group) => group.items.length > 0);

  const isActive = (path: string) => location.pathname === path;

  return (
    <aside className={`h-full bg-white border-r border-slate-200 flex flex-col shrink-0 transition-all duration-300 shadow-[1px_0_0_rgba(15,23,42,0.02)] ${isCollapsed ? 'w-20' : 'w-64'}`}>
      {/* Header Profile Box */}
      <div className="p-4 pb-3.5 shrink-0 flex items-center justify-between gap-2 border-b border-slate-100">
        <div className="flex items-center gap-3 py-1 flex-1 overflow-hidden">
          <BrandLogo className="w-10 h-10 shrink-0 shadow-sm" />
          {!isCollapsed && (
            <div className="min-w-0 leading-none">
              <span className="block font-bold text-[16px] text-slate-900 tracking-tight truncate">Ventra</span>
              <span className="block text-[11.5px] font-medium text-slate-400 mt-1">{home.subtitle}</span>
            </div>
          )}
        </div>
        {onCloseMobile && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseMobile();
            }}
            className="md:hidden p-2 text-slate-700 hover:text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-400 shrink-0 cursor-pointer relative z-[100]"
            title="Cerrar menú"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-3.5 space-y-4 py-3">
        {/* Main Action Buttons */}
        <div className="space-y-1.5">
          <button
            onClick={() => { navigate(home.path); onCloseMobile?.(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-[13.5px] transition-all active:scale-[0.98] bg-rose-600 text-white hover:bg-rose-700 shadow-[0_6px_16px_-6px_rgba(14,110,82,0.55)] cursor-pointer"
          >
            <home.icon className="w-[18px] h-[18px] shrink-0" />
            {!isCollapsed && <span>{home.label}</span>}
          </button>

          {planFeatures.caja && <button
            onClick={() => handleSidebarClick('/dashboard')}
            className={`relative w-full flex items-center gap-3 px-3 h-9 rounded-lg font-medium text-[13.5px] transition-colors cursor-pointer ${isActive('/dashboard') ? 'bg-rose-50 text-rose-700 font-semibold' : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'}`}
          >
            {isActive('/dashboard') && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-rose-600 rounded-r-full" />}
            <LayoutDashboard className="w-[18px] h-[18px] shrink-0" />
            {!isCollapsed && <span>Dashboard</span>}
          </button>}
        </div>

        {/* Dynamic Groups */}
        {visibleGroups.map((group) => (
          <div key={group.title} className="space-y-0.5">
            {!isCollapsed && (
              <div className="flex items-center gap-2.5 px-3 mb-1.5 mt-4">
                <span className="text-[11.5px] font-semibold text-slate-400">{group.title}</span>
              </div>
            )}
            {group.items.map((item) => {
              const isGroupExpanded = expandedGroups.includes(item.label);
              const itemActive = isActive(item.path || '') && !item.collapsible;
              return (
                <div key={item.label} className="space-y-0.5">
                  <button
                    onClick={() => item.collapsible ? toggleGroup(item.label) : (item.path && handleSidebarClick(item.path))}
                    className={`relative w-full flex items-center gap-3 px-3 h-9 rounded-lg transition-colors group cursor-pointer ${itemActive ? 'text-rose-700 bg-rose-50' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'}`}
                  >
                    {itemActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-rose-600 rounded-r-full" />}
                    <item.icon className={`w-[17px] h-[17px] shrink-0 ${itemActive ? 'text-rose-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    {!isCollapsed && (
                      <div className="flex-1 flex items-center justify-between overflow-hidden">
                        <span className={`text-[13px] truncate ${itemActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                        {!!(item as any).badge && <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[10.5px] font-bold flex items-center justify-center">{(item as any).badge}</span>}
                        {item.collapsible && (
                          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isGroupExpanded ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                    )}
                  </button>

                  {!isCollapsed && item.collapsible && isGroupExpanded && item.subItems && (
                    <div className="ml-[23px] border-l border-slate-200 space-y-0.5 my-1 pl-3">
                      {item.subItems.map((sub) => (
                        <button
                          key={sub.label}
                          onClick={() => { navigate(sub.path); onCloseMobile?.(); }}
                          className={`w-full text-left px-3 h-8 rounded-lg text-[12.5px] font-medium transition-colors cursor-pointer ${isActive(sub.path) ? 'text-rose-700 font-semibold bg-rose-50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/70'}`}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom Section */}
      <div className="p-3.5 pt-3 shrink-0 border-t border-slate-100">
        <button
          onClick={() => handleSidebarClick('/settings')}
          className={`w-full flex items-center gap-3 px-3 h-9 rounded-lg transition-colors cursor-pointer ${isActive('/settings') ? 'text-slate-900 font-semibold bg-slate-100' : 'text-slate-600 font-medium hover:text-slate-900 hover:bg-slate-100/70'}`}
        >
          <Settings className="w-[17px] h-[17px]" />
          {!isCollapsed && <span className="text-[13px]">Configuración</span>}
        </button>
      </div>

      {/* Admin Unlock Password Modal */}
      {showAdminUnlockModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowAdminUnlockModal(false)}>
          <div 
            onClick={(e) => e.stopPropagation()} 
            className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-xl border border-slate-400 flex flex-col p-6 space-y-4"
          >
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-2">
                <Settings className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Acceso restringido</h3>
              <p className="text-xs text-slate-700 leading-relaxed">
                Esta sección requiere credenciales de Administrador. Por favor, ingresa la contraseña numérica del usuario <b>ADMIN</b> para continuar.
              </p>
            </div>

            <div className="space-y-3">
              <input 
                type="password" 
                value={adminPassword} 
                onChange={(e) => setAdminPassword(e.target.value)} 
                className="w-full text-center bg-white border border-slate-400 rounded-xl px-4 py-3 text-lg font-bold text-slate-800 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all tracking-[0.25em]" 
                placeholder="••••" 
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleVerifyAdminPassword();
                }}
                autoFocus
              />
              
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAdminUnlockModal(false)} className="flex-1 py-2.5 rounded-xl font-medium text-slate-700 hover:bg-slate-50 transition-all text-xs border border-slate-400">Cancelar</button>
                <button 
                  onClick={handleVerifyAdminPassword} 
                  disabled={isVerifying || !adminPassword}
                  className="flex-1 py-2.5 rounded-xl font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-all text-xs active:scale-[0.97] flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isVerifying ? 'Verificando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
