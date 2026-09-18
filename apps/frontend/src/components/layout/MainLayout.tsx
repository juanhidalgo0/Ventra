import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Download, Loader2, WifiOff, RefreshCw, Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuthStore } from '../../stores/authStore';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { MangoLogo as GoDeliveryLogo } from '../common/MangoLogo';
import CalculatorModal from '../pos/CalculatorModal';
import { wsService } from '../../services/websocket';
import { getClientId } from '../../utils/clientId';
import { startOverlayWatchdog } from '../../utils/overlayWatchdog';
import GuidedTour from '../common/tour/GuidedTour';
import HelpMenu from '../common/tour/HelpMenu';
import { shortcutsLocked } from '../../utils/shortcutLock';
import { useSetupProgress } from '../../utils/setupProgress';
import { Rocket, ArrowRight } from 'lucide-react';

interface Props { children: React.ReactNode; }

export default function MainLayout({ children }: Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const { user } = useAuthStore();
  const [showUpdate, setShowUpdate] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [license, setLicense] = useState<any>(null);
  const [showCalculator, setShowCalculator] = useState(false);

  /**
   * Cierre X o Z: el servidor avisa y todas las terminales de ese cajero cierran
   * sesión, para que no quede ninguna abierta con el turno ya cerrado.
   * La terminal que hizo el cierre se maneja sola (termina de imprimir y sale).
   */
  useEffect(() => {
    wsService.connect();
    const onForceLogout = (data: { userId: string; reason: string; clientId?: string }) => {
      const current = useAuthStore.getState().user;
      if (!current || current.id !== data.userId) return;
      if (data.clientId && data.clientId === getClientId()) return;
      toast.success(
        data.reason === 'Z_REPORT'
          ? 'Se generó el Cierre Z: se cerró la sesión en esta terminal'
          : 'Se cerró la caja en otra terminal: se cerró la sesión acá también',
        { duration: 6000 },
      );
      useAuthStore.getState().logout();
    };
    wsService.on('auth:force-logout', onForceLogout);
    return () => wsService.off('auth:force-logout', onForceLogout);
  }, []);

  // Destraba la pantalla si queda una capa invisible tapando todo (ver overlayWatchdog)
  useEffect(() => startOverlayWatchdog(count => {
    toast.success(count === 1 ? 'Se destrabó la pantalla' : `Se destrabaron ${count} capas trabadas`, { id: 'overlay-watchdog' });
  }), []);

  // F3 abre la calculadora desde cualquier pantalla (se captura antes que otros atajos)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'F3' || shortcutsLocked()) return;
      e.preventDefault();
      e.stopPropagation();
      setShowCalculator(prev => !prev);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    let isMounted = true;
    api.get('/auth/license/status')
      .then(({ data }) => {
        if (isMounted) setLicense(data);
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, []);

  const getDemoDaysRemaining = () => {
    if (!license || !license.expiresAt) return 0;
    const exp = new Date(license.expiresAt);
    const today = new Date();
    const diff = exp.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const loadingMessages = [
    "Inicializando aplicación...",
    "Estableciendo conexión segura...",
    "Sincronizando inventario y stock...",
    "Cargando catálogo de productos...",
    "Preparando terminal de caja...",
    "Verificando base de datos local..."
  ];
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!isConnecting) return;
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [isConnecting]);

  useEffect(() => {
    let wasOffline = false;
    let isMounted = true;

    const checkConnection = async (isFirstCheck = false) => {
      if (isFirstCheck) {
        let connected = false;
        const maxAttempts = 15; // 15 attempts * 1.5s = ~22.5s maximum wait time
        
        for (let i = 1; i <= maxAttempts; i++) {
          if (!isMounted) return;
          setAttempts(i);
          try {
            await api.get('/cash/current');
            connected = true;
            break;
          } catch (e) {
            if (i < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          }
        }

        if (!isMounted) return;

        if (connected) {
          setIsOnline(true);
          setIsConnecting(false);
          setConnectionFailed(false);
        } else {
          setIsOnline(false);
          setConnectionFailed(true);
        }
      } else {
        // Standard background health checks
        try {
          await api.get('/cash/current');
          if (!isMounted) return;
          setIsOnline(true);
          if (wasOffline) {
            toast.success('Conexión restablecida con el servidor principal');
            wasOffline = false;
          }
        } catch (e) {
          if (!isMounted) return;
          setIsOnline(false);
          if (!wasOffline) {
            toast.error('Conexión perdida con el servidor. Operando en modo local.');
            wasOffline = true;
          }
        }
      }
    };

    setIsConnecting(true);
    setConnectionFailed(false);
    checkConnection(true);
    
    const interval = setInterval(() => checkConnection(false), 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [retryTrigger]);

  useEffect(() => {
    const isElectron = /electron/i.test(navigator.userAgent);
    if (isElectron) {
      try {
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.on('update_available', () => {
          toast.success('🚀 Nueva versión disponible. Descargando...', { duration: 6000 });
        });
        ipcRenderer.on('update_downloaded', () => {
          setShowUpdate(true);
        });
      } catch (e) {
        console.warn('Electron IPC not available');
      }
    }
  }, []);

  const handleRetry = () => {
    setRetryTrigger(prev => prev + 1);
  };

  const location = useLocation();
  const isPOS = location.pathname === '/pos';
  const navigate = useNavigate();
  const isAdminUser = user?.role === 'ADMIN';
  // Se recalcula al navegar, así refleja lo que se acaba de configurar.
  const setupPct = useSetupProgress(isAdminUser, location.pathname);

  if (connectionFailed) {
    return (
      <div className="h-screen w-full bg-[#f1f5f9] flex flex-col items-center justify-center relative overflow-hidden select-none">
        <div className="relative z-10 flex flex-col items-center max-w-md w-full px-6 text-center">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 100 }}
            className="w-20 h-20 rounded-3xl bg-rose-50 border border-rose-100 flex items-center justify-center mb-6 shadow-sm"
          >
            <WifiOff className="w-10 h-10 text-rose-600" />
          </motion.div>

          <h2 className="text-2xl font-black text-slate-800 tracking-tight leading-none mb-3">Sin Conexión con el Servidor</h2>
          <p className="text-slate-700 text-xs leading-relaxed mb-8">
            El Punto de Venta no pudo comunicarse con el servicio local de base de datos. Por favor, asegúrate de que el motor del backend se esté ejecutando y no esté bloqueado por el cortafuegos.
          </p>

          <motion.button 
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleRetry}
            className="w-full flex items-center justify-center gap-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm px-6 py-3.5 rounded-2xl shadow-md transition-all active:scale-[0.98]"
          >
            <RefreshCw className="w-4 h-4 text-white" />
            <span>REINTENTAR CONEXIÓN</span>
          </motion.button>
        </div>
      </div>
    );
  }

  if (isConnecting) {
    return (
      <div className="h-screen w-full bg-[#f1f5f9] flex flex-col items-center justify-center relative overflow-hidden select-none">
        <div className="relative z-10 flex flex-col items-center gap-10">
          <motion.div 
            animate={{ 
              y: [0, -6, 0],
              scale: [1, 1.02, 1]
            }} 
            transition={{ 
              repeat: Infinity, 
              duration: 3, 
              ease: "easeInOut" 
            }}
            className="flex items-center justify-center"
          >
            <GoDeliveryLogo className="w-32 h-32" />
          </motion.div>

          <div className="text-center flex flex-col items-center gap-1.5">
            <h1 className="text-3xl font-black text-slate-800 tracking-tight leading-none">Ventra POS</h1>
            <p className="text-rose-600 text-[10px] font-black tracking-widest uppercase mt-3 flex items-center justify-center gap-2">
              <span>Cargando Terminal POS</span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
              </span>
            </p>
          </div>

          <div className="flex flex-col items-center justify-center mt-2">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
              className="w-12 h-12 rounded-full border-4 border-slate-400 border-t-rose-600 flex items-center justify-center shadow-inner"
            />
            <div className="h-6 flex items-center justify-center overflow-hidden mt-6 min-w-[280px]">
              <AnimatePresence mode="wait">
                <motion.span
                  key={messageIndex}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.35, ease: "easeInOut" }}
                  className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block text-center"
                >
                  {loadingMessages[messageIndex]}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full flex bg-slate-50 dark:bg-slate-950 overflow-hidden relative transition-colors duration-300">
      {!isPOS && (
        <>
          {/* Backdrop mask for mobile menu */}
          <AnimatePresence>
            {showMobileMenu && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowMobileMenu(false)}
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-50 md:hidden"
              />
            )}
          </AnimatePresence>

          {/* Sidebar wrapper */}
          <div
            className={`h-full shrink-0 fixed inset-y-0 left-0 z-50 md:static md:translate-x-0 mobile-sidebar ${
              showMobileMenu ? 'open shadow-2xl' : ''
            }`}
            style={{ width: isCollapsed ? '80px' : '256px' }}
          >
            <Sidebar 
              isCollapsed={isCollapsed} 
              setIsCollapsed={setIsCollapsed} 
              onCloseMobile={() => setShowMobileMenu(false)}
            />
          </div>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col h-full relative overflow-hidden">
        {/* TopBar */}
        {!isPOS && (
          <header className="h-14 bg-white border-b border-slate-400 px-4 md:px-5 flex items-center justify-between shrink-0 sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMobileMenu(true)}
              className="md:hidden p-1.5 -ml-1 text-slate-700 hover:text-slate-700 hover:bg-slate-50 rounded-lg focus:outline-none"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 max-w-lg px-2 sm:px-6">
            <div className="relative group flex items-center w-full">
              <div className="absolute left-3 flex items-center justify-center pointer-events-none">
                <Search className="w-4 h-4 text-slate-650 group-focus-within:text-rose-500 transition-colors" />
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full bg-slate-50 border border-slate-400 text-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs sm:text-sm focus:bg-white focus:border-rose-455 focus:ring-2 focus:ring-rose-100 transition-all outline-none placeholder:text-slate-655"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {license?.isDemo && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 border border-rose-100 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm mr-2 select-none">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-600"></span>
                </span>
                <span>VERSION DEMO: {getDemoDaysRemaining()} DÍAS RESTANTES</span>
              </div>
            )}
            {isAdminUser && setupPct !== null && setupPct < 100 && (
              <button
                onClick={() => navigate('/settings')}
                title="Terminá de configurar tu sistema"
                className="hidden md:flex items-center gap-2.5 h-8 pl-3 pr-2 rounded-full bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-800 transition-colors group"
              >
                <Rocket className="w-3.5 h-3.5 text-orange-600" />
                <span className="text-[12px] font-semibold whitespace-nowrap">Configuración {setupPct}%</span>
                <span className="w-16 h-1.5 rounded-full bg-orange-200/70 overflow-hidden">
                  <span className="block h-full rounded-full bg-orange-600 transition-all" style={{ width: `${setupPct}%` }} />
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-orange-600 group-hover:translate-x-0.5 transition-transform" />
              </button>
            )}
            <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block" />

            <div className="flex items-center gap-3 pl-2">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold text-slate-800 leading-none">{user?.fullName}</p>
                <p className="text-[10px] font-medium text-rose-600 uppercase tracking-wide mt-0.5">{user?.role}</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center font-bold text-white text-sm">
                {user?.username?.[0]?.toUpperCase()}
              </div>
            </div>
          </div>
        </header>
        )}

        {/* Content Area */}
        <main className={`flex-1 min-w-0 min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950 relative flex flex-col ${isPOS ? 'p-0 md:p-4' : 'p-4'}`}>
          {showUpdate && (
            <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mx-2 mb-3 p-3 bg-rose-600 rounded-xl flex items-center justify-between z-50">
              <div className="flex items-center gap-3 text-white">
                <Download className="w-5 h-5 animate-bounce" />
                <p className="text-xs font-bold uppercase tracking-wide">¡Actualización lista para instalar!</p>
              </div>
              <button
                onClick={() => {
                  const { ipcRenderer } = window.require('electron');
                  ipcRenderer.send('restart_app');
                }}
                className="px-4 py-1.5 bg-white text-rose-600 rounded-lg text-xs font-bold hover:bg-rose-55 transition-all"
              >
                Reiniciar y Actualizar
              </button>
            </motion.div>
          )}
          <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
            {children}
          </div>
        </main>
      </div>

      {/* Ayuda: recorridos guiados y atajos de la pantalla actual */}
      <HelpMenu pathname={location.pathname} side={isPOS ? 'left' : 'right'} />
      <GuidedTour />

      {/* La calculadora (F3) vive acá para que funcione en cualquier sección y también en modo admin */}
      <CalculatorModal isOpen={showCalculator} onClose={() => setShowCalculator(false)} />
    </div>
  );
}
