import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { 
  ShoppingBag, 
  LayoutDashboard, 
  Package, 
  Monitor, 
  Users, 
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
  Smartphone,
  X
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { MangoLogo as BrandLogo } from '../common/MangoLogo';

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
      // Attempt login as ADMIN using standard backend route
      const { data } = await api.post('/auth/login', { username: 'ADMIN', password: adminPassword });
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

  const menuGroups = [
    {
      title: 'GENERAL',
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
        { label: 'Reportes', icon: BarChart3, path: '/reports' },
        { label: 'Resumen Fiscal', icon: Calculator, path: '/fiscal', badge: 'FULL' },
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
        ...(localStorage.getItem('business_type') === 'FERRETERIA' ? [
          { label: 'Presupuestos', icon: FileText, path: '/quotes' }
        ] : []),
        ...(user?.role === 'ADMIN' ? [
          { label: 'Acceso Remoto', icon: Smartphone, path: '/remote-access' }
        ] : [])
      ]
    }
  ];

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
              <span className="block text-[10px] font-semibold text-slate-400 tracking-[0.14em] mt-1">SISTEMA DE VENTAS</span>
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
            onClick={() => { navigate('/pos'); onCloseMobile?.(); }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-[13.5px] transition-all active:scale-[0.98] bg-rose-600 text-white hover:bg-rose-700 shadow-[0_6px_16px_-6px_rgba(14,110,82,0.55)] cursor-pointer"
          >
            <ShoppingBag className="w-[18px] h-[18px] shrink-0" />
            {!isCollapsed && <span>Punto de Venta</span>}
          </button>

          <button
            onClick={() => handleSidebarClick('/dashboard')}
            className={`relative w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-semibold text-[13.5px] transition-all active:scale-[0.98] cursor-pointer ${isActive('/dashboard') ? 'bg-rose-50 text-rose-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
          >
            {isActive('/dashboard') && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-rose-600 rounded-r-full" />}
            <LayoutDashboard className="w-[18px] h-[18px] shrink-0" />
            {!isCollapsed && <span>Dashboard</span>}
          </button>
        </div>

        {/* Dynamic Groups */}
        {menuGroups.map((group) => (
          <div key={group.title} className="space-y-0.5">
            {!isCollapsed && (
              <div className="flex items-center gap-2.5 px-2.5 mb-2.5 mt-5">
                <span className="text-[10.5px] font-bold text-slate-400 tracking-[0.14em]">{group.title}</span>
                <div className="flex-1 h-px bg-slate-100" />
              </div>
            )}
            {group.items.map((item) => {
              const isGroupExpanded = expandedGroups.includes(item.label);
              const itemActive = isActive(item.path || '') && !item.collapsible;
              return (
                <div key={item.label} className="space-y-0.5">
                  <button
                    onClick={() => item.collapsible ? toggleGroup(item.label) : (item.path && handleSidebarClick(item.path))}
                    className={`relative w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all group cursor-pointer ${itemActive ? 'text-rose-700 font-bold bg-rose-50' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
                  >
                    {itemActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-rose-600 rounded-r-full" />}
                    <item.icon className={`w-[18px] h-[18px] shrink-0 ${itemActive ? 'text-rose-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    {!isCollapsed && (
                      <div className="flex-1 flex items-center justify-between overflow-hidden">
                        <span className="text-[12.5px] font-semibold tracking-tight truncate">{item.label}</span>
                        {item.collapsible && (
                          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isGroupExpanded ? 'rotate-180' : ''}`} />
                        )}
                        {item.badge && <span className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[8.5px] font-bold shrink-0">{item.badge}</span>}
                      </div>
                    )}
                  </button>

                  {!isCollapsed && item.collapsible && isGroupExpanded && item.subItems && (
                    <div className="ml-[27px] border-l border-slate-150 space-y-0.5 my-1 pl-3">
                      {item.subItems.map((sub) => (
                        <button
                          key={sub.label}
                          onClick={() => { navigate(sub.path); onCloseMobile?.(); }}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer ${isActive(sub.path) ? 'text-rose-700 font-semibold bg-rose-50' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
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
          className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all cursor-pointer ${isActive('/settings') ? 'text-slate-900 font-bold bg-slate-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
        >
          <Settings className="w-[18px] h-[18px]" />
          {!isCollapsed && <span className="text-[13px] font-semibold">Configuración</span>}
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
                <Settings className="w-6 h-6 animate-spin" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Acceso Restringido</h3>
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
