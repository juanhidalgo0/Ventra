import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { usePOSStore } from './stores/posStore';
import LoginPage from './components/auth/LoginPage';
import ConnectionScreen from './components/auth/ConnectionScreen';
import MainLayout from './components/layout/MainLayout';
import POSScreen from './components/pos/POSScreen';
import { motion, MotionConfig, AnimatePresence } from 'framer-motion';
import api, { resolveServerUrl } from './services/api';
import LicenseBlockScreen from './components/auth/LicenseBlockScreen';
import { wsService } from './services/websocket';
import Updater from './components/updater/Updater';
import GlobalLoadingBar from './components/common/GlobalLoadingBar';
import SyncDownloadBanner from './components/common/SyncDownloadBanner';
import { startOnlineOrdersSync, stopOnlineOrdersSync } from './services/onlineStoreOrders';

import { CheckCircle2, XCircle } from 'lucide-react';
import { MangoLogo } from './components/common/MangoLogo';
import { toggleFullscreen } from './utils/fullscreen';
import { shortcutsLocked } from './utils/shortcutLock';
import { useOwnerMobile } from './utils/ownerMobile';

// Code-split / Lazy-loaded screens
const ProductsScreen = lazy(() => import('./components/products/ProductsScreen'));
const CashRegisterScreen = lazy(() => import('./components/cash-register/CashRegisterScreen'));
const CashControlScreen = lazy(() => import('./components/cash-register/CashControlScreen'));
const HistorialScreen = lazy(() => import('./components/pos/HistorialScreen'));
const GastosScreen = lazy(() => import('./components/cash-register/GastosScreen'));
const CuentasCorrientesScreen = lazy(() => import('./components/clients/CuentasCorrientesScreen'));
const PromosScreen = lazy(() => import('./components/products/PromosScreen'));
const DashboardScreen = lazy(() => import('./components/dashboard/DashboardScreen'));
const ReportsScreen = lazy(() => import('./components/dashboard/ReportsScreen'));
const FiscalScreen = lazy(() => import('./components/dashboard/FiscalScreen'));
const PurchasesScreen = lazy(() => import('./components/products/PurchasesScreen'));
const StockControlScreen = lazy(() => import('./components/products/StockControlScreen'));
const StockAuditScreen = lazy(() => import('./components/products/StockAuditScreen'));
const MarketingScreen = lazy(() => import('./components/marketing/MarketingScreen'));
const TreasuryScreen = lazy(() => import('./components/pos/TreasuryScreen'));
const OnlineStoreScreen = lazy(() => import('./components/settings/OnlineStoreScreen'));
const OnlineStoreMetricsScreen = lazy(() => import('./components/settings/OnlineStoreMetricsScreen'));
const EarningsDivisionScreen = lazy(() => import('./components/settings/EarningsDivisionScreen'));
const SettingsScreen = lazy(() => import('./components/settings/SettingsScreen'));
const RemoteAccessScreen = lazy(() => import('./components/settings/RemoteAccessScreen'));
const SuppliersScreen = lazy(() => import('./components/suppliers/SuppliersScreen'));
const MobileHomeScreen = lazy(() => import('./components/mobile/MobileHomeScreen'));
const MobileMoreScreen = lazy(() => import('./components/mobile/MobileMoreScreen'));
const MobileSellScreen = lazy(() => import('./components/mobile/MobileSellScreen'));
const MobileMovementsScreen = lazy(() => import('./components/mobile/MobileMovementsScreen'));
const MobileProductsScreen = lazy(() => import('./components/mobile/MobileProductsScreen'));
const MobileCashScreen = lazy(() => import('./components/mobile/MobileCashScreen'));
const MobileExpensesScreen = lazy(() => import('./components/mobile/MobileExpensesScreen'));
const MobileClientsScreen = lazy(() => import('./components/mobile/MobileClientsScreen'));
const MobileSuppliersScreen = lazy(() => import('./components/mobile/MobileSuppliersScreen'));
const MobilePurchasesScreen = lazy(() => import('./components/mobile/MobilePurchasesScreen'));
const MobilePromosScreen = lazy(() => import('./components/mobile/MobilePromosScreen'));
const MobileTreasuryScreen = lazy(() => import('./components/mobile/MobileTreasuryScreen'));
const MobileStoreScreen = lazy(() => import('./components/mobile/MobileStoreScreen'));
const OnlineOrdersScreen = lazy(() => import('./components/orders/OnlineOrdersScreen'));
const MobileReportsScreen = lazy(() => import('./components/mobile/MobileReportsScreen'));
const MobileFiscalScreen = lazy(() => import('./components/mobile/MobileFiscalScreen'));
const MobileNotificationsScreen = lazy(() => import('./components/mobile/MobileNotificationsScreen'));
const StoreHomeScreen = lazy(() => import('./components/store/StoreHomeScreen'));
const AgendaScreen = lazy(() => import('./components/agenda/AgendaScreen'));
const MobileSettingsScreen = lazy(() => import('./components/mobile/MobileSettingsScreen'));
const MobileSettingsSection = lazy(() => import('./components/mobile/MobileSettingsScreen').then((m) => ({ default: m.MobileSettingsSection })));

/** En la app del dueño en el celular, algunas pestañas tienen su propia pantalla. */
function OwnerMobileOr({ mobile, children }: { mobile: React.ReactNode; children: React.ReactNode }) {
  return <>{useOwnerMobile().active ? mobile : children}</>;
}

function ConnectionGuard({ children }: { children: React.ReactNode }) {
  const hasConnection = !!localStorage.getItem('server_ip');
  return hasConnection ? <>{children}</> : <Navigate to="/setup" />;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <ConnectionGuard>{children}</ConnectionGuard> : <Navigate to="/login" />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore();
  const isAdminUnlocked = sessionStorage.getItem('admin_unlocked') === 'true';
  return isAuthenticated && (user?.role === 'ADMIN' || isAdminUnlocked) ? <>{children}</> : <Navigate to="/pos" replace />;
}

export default function App() {
  // Get active port from URL query params (passed by Electron in production)
  const urlParams = new URLSearchParams(window.location.search);
  const backendPort = urlParams.get('backend_port');
  if (backendPort) {
    sessionStorage.setItem('active_backend_port', backendPort);
  }

  useEffect(() => {
    if ((window as any).__TAURI__) {
      const invokeFn = (window as any).__TAURI__.core?.invoke || (window as any).__TAURI__.invoke;
      if (invokeFn) {
        invokeFn('get_backend_port')
          .then((port: number) => {
            if (port) {
              const currentPort = sessionStorage.getItem('active_backend_port');
              if (currentPort !== port.toString()) {
                console.log("[App] Retrieved dynamic backend port:", port);
                sessionStorage.setItem('active_backend_port', port.toString());
              }
            }
          })
          .catch((e: any) => console.error("[App] Failed to fetch backend port from Tauri", e));
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        if (shortcutsLocked()) return;
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Synchronously parse token and user credentials from URL before rendering routes
  const getParamSync = (name: string) => {
    const stdParams = new URLSearchParams(window.location.search);
    if (stdParams.has(name)) return stdParams.get(name);
    const hashIdx = window.location.hash.indexOf('?');
    if (hashIdx !== -1) {
      const hashParams = new URLSearchParams(window.location.hash.substring(hashIdx));
      if (hashParams.has(name)) return hashParams.get(name);
    }
    return null;
  };

  const syncToken = getParamSync('token');
  const syncUser = getParamSync('user');

  if (syncToken) {
    const host = window.location.hostname;
    const hostWithPort = window.location.port ? `${host}:${window.location.port}` : host;
    localStorage.setItem('server_ip', hostWithPort);
    localStorage.setItem('saved_client_ip', hostWithPort);
    localStorage.setItem('connection_mode', 'CLIENT');
    localStorage.setItem('accessToken', syncToken);
    
    if (syncUser) {
      try {
        const decodedUser = decodeURIComponent(syncUser);
        localStorage.setItem('user', decodedUser);
      } catch (e) {
        console.error("Failed to parse user param synchronously", e);
      }
    }
    // Instantly update Zustand store state before render destructuring
    useAuthStore.getState().checkAuth();
    
    // Clear URL parameters immediately for security and router cleanliness
    const cleanUrl = window.location.origin + window.location.pathname + '#/pos';
    window.history.replaceState(null, '', cleanUrl);
  }

  // Clear cached connection and credentials on new app startup to force both screens (unless auto-connecting via QR)
  if (!sessionStorage.getItem('session_initialized')) {
    sessionStorage.setItem('session_initialized', 'true');
    if (!syncToken) {
      localStorage.removeItem('server_ip');
      localStorage.removeItem('connection_mode');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    }
  }

  const { autoLoginAdmin, isAuthenticated, user, checkAuth } = useAuthStore();
  const [perfMode, setPerfMode] = useState(() => localStorage.getItem('performance_mode') === 'true');
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/pos' || location.pathname === '/') {
      const isAdminUnlocked = sessionStorage.getItem('admin_unlocked') === 'true' || localStorage.getItem('admin_unlocked') === 'true';
      if (isAdminUnlocked && user && user.role !== 'ADMIN') {
        sessionStorage.removeItem('admin_unlocked');
        sessionStorage.removeItem('adminAccessToken');
        sessionStorage.removeItem('adminRefreshToken');
        localStorage.removeItem('admin_unlocked');
      }
    }
  }, [location.pathname, user]);
  
  const [licenseStatus, setLicenseStatus] = useState<any>(null);
  const [checkingLicense, setCheckingLicense] = useState(false);

  // Cache Warming State
  const { products, isWarmed, setProducts, setCategories, setClients, setIsWarmed, setPromotions } = usePOSStore();
  const [warmingProgress, setWarmingProgress] = useState(0);
  const [warmingStatus, setWarmingStatus] = useState('Iniciando base de datos...');
  const [warmingError, setWarmingError] = useState<string | null>(null);

  const checkLicense = async (retries = 3) => {
    try {
      const { data } = await api.get('/auth/license/status');
      setLicenseStatus(data);
    } catch (err: any) {
      if (err.response?.status === 402) {
        setLicenseStatus(err.response.data);
      } else if (retries > 0) {
        // Backend may still be starting up — retry after 3s
        setTimeout(() => checkLicense(retries - 1), 3000);
        return;
      } else {
        // If we can't reach the server, do not allow access
        console.warn('[App] License check failed after retries, blocking app:', err.message);
        setLicenseStatus({ 
          isActive: false, 
          machineUuid: 'ERROR_CONEXION', 
          expiresAt: new Date(0).toISOString() 
        });
      }
    } finally {
      setCheckingLicense(false);
    }
  };

  useEffect(() => {
    // Sync body attribute initially
    if (perfMode) {
      document.body.setAttribute('data-performance-mode', 'true');
    } else {
      document.body.removeAttribute('data-performance-mode');
    }

    const handleStorageChange = () => {
      const mode = localStorage.getItem('performance_mode') === 'true';
      setPerfMode(mode);
      if (mode) {
        document.body.setAttribute('data-performance-mode', 'true');
      } else {
        document.body.removeAttribute('data-performance-mode');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('performance-mode-changed', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('performance-mode-changed', handleStorageChange);
    };
  }, [perfMode]);

  useEffect(() => {
    const isAuthPath = location.pathname === '/login' || location.pathname === '/setup';
    if (isAuthPath) {
      document.body.classList.add('on-auth-screen');
    } else {
      document.body.classList.remove('on-auth-screen');
    }

    const serverIp = localStorage.getItem('server_ip') || sessionStorage.getItem('server_ip');
    if (serverIp) {
      autoLoginAdmin().then(() => {
        checkLicense();
      });
    } else {
      setCheckingLicense(false);
      setLicenseStatus(null);
    }
  }, [location.pathname]);

  // Re-check license periodically when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      checkLicense();
    }, 60000); // verify every 60 seconds in background
    return () => clearInterval(interval);
  }, [isAuthenticated]);
 
  // Listen for real-time product updates from the backend via WebSockets
  useEffect(() => {
    if (!isAuthenticated) return;

    wsService.connect();

    const handleProductUpdated = (updatedProd: any) => {
      console.log('📡 Real-time product update received via WS:', updatedProd);
      const barcodeList = [updatedProd.barcode, ...(updatedProd.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
      const processed = {
        ...updatedProd,
        _searchToken: `${updatedProd.name?.toLowerCase() || ''} ${updatedProd.sku?.toLowerCase() || ''} ${barcodeList.join(' ')}`.trim()
      };

      setProducts(usePOSStore.getState().products.map(p => p.id === updatedProd.id ? processed : p));
    };

    wsService.on('product:updated', handleProductUpdated);

    return () => {
      wsService.off('product:updated', handleProductUpdated);
    };
  }, [isAuthenticated, setProducts]);

  // Escucha en segundo plano los pedidos de la tienda online propia (Ventra) y
  // los guarda como Presupuesto local, además de llegarle al comercio por WhatsApp.
  useEffect(() => {
    if (!isAuthenticated) {
      stopOnlineOrdersSync();
      return;
    }
    startOnlineOrdersSync();
    return () => stopOnlineOrdersSync();
  }, [isAuthenticated]);

  // Cache Warming useEffect
  useEffect(() => {
    if (!isAuthenticated) {
      setIsWarmed(false);
      return;
    }

    const refreshCacheSilently = async () => {
      try {
        const [categoriesRes, promotionsRes, clientsRes] = await Promise.all([
          api.get('/categories'),
          api.get('/promotions'),
          api.get('/clients')
        ]);
        setCategories(categoriesRes.data);
        setPromotions(promotionsRes.data);
        setClients(clientsRes.data);

        let rawProducts = [];
        try {
          const catalogRes = await api.get('/products/pos-catalog');
          rawProducts = catalogRes.data?.products || (Array.isArray(catalogRes.data) ? catalogRes.data : []);
        } catch {
          const productsRes = await api.get('/products?take=20000');
          rawProducts = productsRes.data || [];
        }

        const processedProducts = rawProducts.map((p: any) => {
          const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
          return {
            ...p,
            imageUrl: resolveServerUrl(p.imageUrl),
            _searchToken: `${p.name.toLowerCase()} ${p.sku?.toLowerCase() || ''} ${barcodeList.join(' ')}`.trim()
          };
        });
        processedProducts.sort((a: any, b: any) => {
          const aSales = a.salesCount ?? a._count?.saleItems ?? 0;
          const bSales = b.salesCount ?? b._count?.saleItems ?? 0;
          if (bSales !== aSales) return bSales - aSales;
          return (a.name || '').localeCompare(b.name || '');
        });
        setProducts(processedProducts);
      } catch (err) {
        console.error('Silent cache refresh failed:', err);
      }
    };

    if (isWarmed) {
      return;
    }

    let retryCount = 0;
    const warmCache = async () => {
      try {
        if (retryCount === 0) {
          setWarmingError(null);
        }
        setWarmingProgress(10);
        setWarmingStatus('Iniciando conexión con el servidor...');
        await new Promise(r => setTimeout(r, 200));

        setWarmingProgress(35);
        setWarmingStatus('Cargando categorías de productos...');
        const categoriesRes = await api.get('/categories');
        setCategories(categoriesRes.data);

        setWarmingProgress(60);
        setWarmingStatus('Cargando catálogo de productos en memoria...');
        let rawProducts = [];
        try {
          const catalogRes = await api.get('/products/pos-catalog');
          rawProducts = catalogRes.data?.products || (Array.isArray(catalogRes.data) ? catalogRes.data : []);
        } catch {
          const productsRes = await api.get('/products?take=20000');
          rawProducts = productsRes.data || [];
        }
        
        const processedProducts = rawProducts.map((p: any) => {
          const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
          return {
            ...p,
            imageUrl: resolveServerUrl(p.imageUrl),
            _searchToken: `${p.name.toLowerCase()} ${p.sku?.toLowerCase() || ''} ${barcodeList.join(' ')}`.trim()
          };
        });
        processedProducts.sort((a: any, b: any) => {
          const aSales = a.salesCount ?? a._count?.saleItems ?? 0;
          const bSales = b.salesCount ?? b._count?.saleItems ?? 0;
          if (bSales !== aSales) return bSales - aSales;
          return (a.name || '').localeCompare(b.name || '');
        });
        setProducts(processedProducts);

        setWarmingProgress(80);
        setWarmingStatus('Cargando promociones y combos activos...');
        try {
          const promotionsRes = await api.get('/promotions');
          setPromotions(promotionsRes.data || []);
        } catch (promoErr) {
          console.warn('[Warmup] Promociones no disponibles temporalmente:', promoErr);
          setPromotions([]);
        }

        setWarmingProgress(95);
        setWarmingStatus('Sincronizando cuentas de clientes...');
        try {
          const clientsRes = await api.get('/clients');
          setClients(clientsRes.data || []);
        } catch (clientErr) {
          console.warn('[Warmup] Clientes no disponibles temporalmente:', clientErr);
          setClients([]);
        }

        setWarmingProgress(100);
        setWarmingStatus('¡Sistema listo!');
        setWarmingError(null);
        await new Promise(r => setTimeout(r, 150));
        setIsWarmed(true);
      } catch (err: any) {
        retryCount++;
        // During the first 7 attempts (~14-16s) while the backend finishes booting up,
        // do not display an alarming red error box. Keep a clean, polite status.
        if (retryCount <= 7) {
          setWarmingStatus('Iniciando servicios del servidor...');
          setWarmingProgress(15 + Math.min(retryCount * 5, 20));
          setTimeout(warmCache, 2000);
        } else {
          console.error('Failed to warm cache after retries:', err);
          const detailedError = err.response?.data?.message || err.message || 'Error desconocido';
          setWarmingError(`Error al sincronizar datos del servidor: ${detailedError}. Reintentando conectar...`);
          setTimeout(warmCache, 3500);
        }
      }
    };

    warmCache();
  }, [isAuthenticated, isWarmed]);

  useEffect(() => {
    if (location.pathname === '/pos') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [location.pathname]);

  const [globalImportStatus, setGlobalImportStatus] = useState<any>(null);

  useEffect(() => {
    wsService.connect();
    
    const handleProgress = (data: any) => {
      const isDone = data.progress === 100;
      const updated = {
        show: true,
        progress: data.progress,
        total: data.total,
        current: data.current,
        status: data.status,
        details: data.details,
        recentItems: [data.details?.lastItem, ...((window as any).globalImportStatus?.recentItems || [])].filter(Boolean).slice(0, 5),
        isMinimized: isDone ? false : ((window as any).globalImportStatus?.isMinimized ?? false),
        isComplete: isDone,
        error: null
      };
      (window as any).globalImportStatus = updated;
      window.dispatchEvent(new CustomEvent('import-progress-update'));
    };

    wsService.on('import:progress', handleProgress);

    const handleUpdate = () => {
      setGlobalImportStatus((window as any).globalImportStatus ? { ...(window as any).globalImportStatus } : null);
    };
    window.addEventListener('import-progress-update', handleUpdate);

    return () => {
      wsService.off('import:progress');
      window.removeEventListener('import-progress-update', handleUpdate);
    };
  }, []);

  // License loading screen bypassed

  if (isAuthenticated && !isWarmed) {
    const stagger = perfMode ? {} : { initial: 'hidden', animate: 'visible', variants: {
      hidden: {},
      visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } }
    }};
    const item = perfMode ? {} : { variants: {
      hidden: { opacity: 0, y: 10 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } }
    }};
    const WarmDiv = (perfMode ? 'div' : motion.div) as any;
    return (
      <>
      <SyncDownloadBanner />
      <WarmDiv
        {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25 } })}
        className="fixed inset-0 bg-slate-50/80 backdrop-blur-md flex flex-col items-center justify-center p-4 z-50"
      >
        <WarmDiv
          {...(perfMode ? {} : { initial: { opacity: 0, scale: 0.96, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { duration: 0.35, ease: 'easeOut' } })}
          className="w-full max-w-[400px] bg-white p-8 rounded-3xl border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center text-center"
        >
          <WarmDiv {...stagger} className="flex flex-col items-center">
            <WarmDiv {...item}>
              <MangoLogo className="w-16 h-16 mb-6 shadow-sm animate-pulse" />
            </WarmDiv>

            <WarmDiv {...item}>
              <h2 className="text-xl font-bold tracking-tight mb-2 text-slate-900">Ventra POS</h2>
              <p className="text-rose-600 text-[11px] font-bold uppercase tracking-wider mb-6">Precalentando entorno...</p>
            </WarmDiv>

            <WarmDiv {...item} className="w-full">
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-4 relative">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-600"
                  animate={{ width: `${warmingProgress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
                {/* Shine sweep lives on the track, not inside the resizing fill —
                    otherwise it visibly warps every time the fill's width changes. */}
                {!perfMode && warmingProgress > 0 && warmingProgress < 100 && (
                  <motion.div
                    className="absolute inset-y-0 w-10 bg-white/50 blur-sm"
                    animate={{ left: ['-15%', '115%'] }}
                    transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </div>

              {perfMode ? (
                <p className="text-[13px] font-semibold text-slate-500 mb-1">{warmingStatus}</p>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.p
                    key={warmingStatus}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="text-[13px] font-semibold text-slate-500 mb-1"
                  >
                    {warmingStatus}
                  </motion.p>
                </AnimatePresence>
              )}
              {warmingError && <p className="text-[11px] font-bold text-rose-600 mt-2 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100">{warmingError}</p>}
            </WarmDiv>
          </WarmDiv>
        </WarmDiv>
      </WarmDiv>
      </>
    );
  }

  return (
    <MotionConfig reducedMotion={perfMode ? "always" : "user"}>
      <Routes>
        <Route path="/setup" element={<ConnectionScreen />} />
        <Route path="/login" element={<ConnectionGuard><LoginPage /></ConnectionGuard>} />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <MainLayout>
                <Suspense fallback={
                  <div className="h-full w-full flex flex-col items-center justify-center p-8 text-slate-400">
                    <div className="w-8 h-8 border-3 border-rose-600 border-t-transparent rounded-full animate-spin mb-3" />
                    <span className="text-xs font-semibold text-slate-500">Cargando módulo...</span>
                  </div>
                }>
                  <Routes>
                    <Route path="/" element={<Navigate to="/pos" />} />
                    <Route path="/pos" element={<OwnerMobileOr mobile={<MobileSellScreen />}><POSScreen /></OwnerMobileOr>} />
                    <Route path="/dashboard" element={<DashboardScreen />} />
                    <Route path="/products" element={<OwnerMobileOr mobile={<MobileProductsScreen />}><ProductsScreen /></OwnerMobileOr>} />
                    <Route path="/clients" element={<OwnerMobileOr mobile={<MobileClientsScreen />}><CuentasCorrientesScreen /></OwnerMobileOr>} />
                    <Route path="/cash" element={<CashRegisterScreen />} />
                    <Route path="/historial" element={<OwnerMobileOr mobile={<MobileMovementsScreen />}><HistorialScreen /></OwnerMobileOr>} />
                    <Route path="/gastos" element={<OwnerMobileOr mobile={<MobileExpensesScreen />}><GastosScreen /></OwnerMobileOr>} />
                    <Route path="/reports" element={<OwnerMobileOr mobile={<MobileReportsScreen />}><ReportsScreen /></OwnerMobileOr>} />
                    
                    <Route path="/inventory" element={<ProductsScreen />} />
                    <Route path="/promos" element={<OwnerMobileOr mobile={<MobilePromosScreen />}><PromosScreen /></OwnerMobileOr>} />
                    <Route path="/purchases" element={<OwnerMobileOr mobile={<MobilePurchasesScreen />}><PurchasesScreen /></OwnerMobileOr>} />
                    <Route path="/stock-control" element={<OwnerMobileOr mobile={<MobileProductsScreen initialFilter="LOW" title="Control de stock" back />}><StockControlScreen /></OwnerMobileOr>} />
                    <Route path="/marketing" element={<MarketingScreen />} />
                    
                    {/* New Routes from Images */}
                    <Route path="/cash-control" element={<OwnerMobileOr mobile={<MobileCashScreen />}><CashControlScreen /></OwnerMobileOr>} />
                    <Route path="/treasury" element={<OwnerMobileOr mobile={<MobileTreasuryScreen />}><TreasuryScreen /></OwnerMobileOr>} />
                    <Route path="/online-store" element={<OwnerMobileOr mobile={<MobileStoreScreen />}><OnlineStoreScreen /></OwnerMobileOr>} />
                    <Route path="/tienda" element={<AdminRoute><StoreHomeScreen /></AdminRoute>} />
                    <Route path="/pedidos" element={<AdminRoute><OnlineOrdersScreen /></AdminRoute>} />
                    <Route path="/agenda" element={<AdminRoute><AgendaScreen /></AdminRoute>} />
                    <Route path="/online-store/metrics" element={<OnlineStoreMetricsScreen />} />
                    <Route path="/earnings-division" element={<EarningsDivisionScreen />} />
                    <Route path="/stock-audit" element={<StockAuditScreen />} />
                    <Route path="/suppliers" element={<OwnerMobileOr mobile={<MobileSuppliersScreen />}><SuppliersScreen /></OwnerMobileOr>} />
                    <Route path="/fiscal" element={<OwnerMobileOr mobile={<MobileFiscalScreen />}><FiscalScreen /></OwnerMobileOr>} />
                    <Route path="/notificaciones" element={<AdminRoute><MobileNotificationsScreen /></AdminRoute>} />
                    <Route path="/settings" element={<AdminRoute><OwnerMobileOr mobile={<MobileSettingsScreen />}><SettingsScreen /></OwnerMobileOr></AdminRoute>} />
                    <Route path="/settings/:tab" element={<AdminRoute><OwnerMobileOr mobile={<MobileSettingsSection />}><Navigate to="/settings" replace /></OwnerMobileOr></AdminRoute>} />
                    <Route path="/remote-access" element={<RemoteAccessScreen />} />

                    {/* App móvil del dueño (MainLayout decide cuándo se muestran) */}
                    <Route path="/inicio" element={<AdminRoute><MobileHomeScreen /></AdminRoute>} />
                    <Route path="/mas" element={<MobileMoreScreen />} />

                    {/* Fallback for other routes */}
                    <Route path="*" element={<div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4">
                      <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center">
                        <Settings className="w-6 h-6 animate-spin-slow" />
                      </div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Pantalla en desarrollo</p>
                    </div>} />
                  </Routes>
                </Suspense>
              </MainLayout>
            </PrivateRoute>
        }
      />
    </Routes>
    <Updater />
    <SyncDownloadBanner />
    <GlobalLoadingBar />

    {/* Floating global import progress overlay (minimized on the left) */}
    {globalImportStatus && globalImportStatus.show && !globalImportStatus.isComplete && !globalImportStatus.error && globalImportStatus.isMinimized && (
      <motion.div 
        initial={{ opacity: 0, y: 50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 50, scale: 0.95 }}
        className="fixed bottom-6 left-6 z-[99999] bg-white dark:bg-slate-900 border border-slate-350 dark:border-slate-800 rounded-2xl p-4 shadow-2xl flex items-center gap-4 max-w-sm font-sans"
      >
        <div className="relative flex items-center justify-center shrink-0">
          <svg className="w-10 h-10 transform -rotate-90">
            <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-slate-100 dark:text-slate-800" fill="transparent" />
            <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" className="text-rose-500" fill="transparent" strokeDasharray="100.5" strokeDashoffset={100.5 - (100.5 * globalImportStatus.progress) / 100} />
          </svg>
          <span className="absolute text-[10px] font-bold text-slate-800 dark:text-slate-200">{globalImportStatus.progress}%</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide truncate">Importando productos...</p>
          <p className="text-[9px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{globalImportStatus.status || `${globalImportStatus.current} de ${globalImportStatus.total} procesados`}</p>
        </div>
        <button 
          onClick={() => {
            (window as any).globalImportStatus = { ...(window as any).globalImportStatus, isMinimized: false };
            window.dispatchEvent(new CustomEvent('import-progress-update'));
            if (window.location.pathname !== '/products') {
              window.location.href = '/products';
            }
          }}
          className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[9px] font-extrabold uppercase tracking-wide active:scale-95 transition-all cursor-pointer"
        >
          Ver
        </button>
      </motion.div>
    )}

    {/* Global Full-Screen Import Progress Modal */}
    <AnimatePresence>
      {globalImportStatus && globalImportStatus.show && !globalImportStatus.isMinimized && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99999] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm font-sans"
        >
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-300 dark:border-slate-800"
          >
            <div className="relative h-1.5 bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <motion.div 
                className={`h-full ${globalImportStatus.error ? 'bg-red-500' : 'bg-rose-500'}`}
                initial={{ width: 0 }}
                animate={{ width: `${globalImportStatus.progress}%` }}
              />
            </div>

            <div className="p-8 space-y-8">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                    {globalImportStatus.isComplete ? '¡Misión Cumplida!' : globalImportStatus.error ? 'Ocurrió un problema' : 'Sincronizando Inventario'}
                  </h3>
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    {globalImportStatus.current} de {globalImportStatus.total} productos procesados
                  </p>
                </div>
                
                <div className="relative w-16 h-16 shrink-0">
                  <svg className="w-full h-full -rotate-90">
                    <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6" className="text-slate-100 dark:text-slate-800" fill="transparent" />
                    <motion.circle
                      cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6" strokeDasharray="175.9"
                      initial={{ strokeDashoffset: 175.9 }}
                      animate={{ strokeDashoffset: 175.9 - (175.9 * globalImportStatus.progress) / 100 }}
                      fill="transparent"
                      className={`${globalImportStatus.error ? 'text-red-500' : 'text-rose-500'}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{globalImportStatus.progress}%</span>
                  </div>
                </div>
              </div>

              {!globalImportStatus.isComplete && !globalImportStatus.error && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    <p className="text-xs font-semibold text-rose-600 truncate">
                      {globalImportStatus.status}
                    </p>
                  </div>
                  
                  <div className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-4 space-y-2">
                    <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-300 dark:border-slate-800 pb-2">Últimos artículos:</p>
                    <div className="space-y-1.5">
                      {globalImportStatus.recentItems?.map((item: any, idx: number) => (
                        <motion.div 
                          key={`${item}-${idx}`}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1 - (idx * 0.2), x: 0 }}
                          className="flex items-center gap-2"
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          <span className="text-xs text-slate-600 dark:text-slate-400 truncate">{item}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {globalImportStatus.isComplete && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 p-5 rounded-xl text-center">
                    <p className="text-2xl font-bold text-emerald-600">{globalImportStatus.details?.imported}</p>
                    <p className="text-xs font-medium text-emerald-500 mt-1">Nuevos</p>
                  </div>
                  <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 p-5 rounded-xl text-center">
                    <p className="text-2xl font-bold text-rose-600">{globalImportStatus.details?.updated}</p>
                    <p className="text-xs font-medium text-rose-500 mt-1">Actualizados</p>
                  </div>
                </div>
              )}

              {globalImportStatus.error && (
                <div className="bg-red-50 dark:bg-red-950/20 p-5 rounded-xl border border-red-200 dark:border-red-900 space-y-3">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-6 h-6 text-red-500" />
                    <p className="text-sm font-bold text-red-600">Error en la importación</p>
                  </div>
                  <p className="text-xs text-red-500 dark:text-red-400">
                    {globalImportStatus.error}
                  </p>
                </div>
              )}

              {(!globalImportStatus.isComplete && !globalImportStatus.error) ? (
                <div className="flex gap-3 w-full">
                  <button 
                    onClick={() => {
                      const updated = { ...((window as any).globalImportStatus || {}), isMinimized: true };
                      (window as any).globalImportStatus = updated;
                      setGlobalImportStatus(updated);
                      window.dispatchEvent(new CustomEvent('import-progress-update'));
                    }}
                    className="flex-1 py-3 bg-slate-150 hover:bg-slate-200 text-slate-700 dark:text-slate-250 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg text-xs font-semibold transition-all cursor-pointer border border-slate-300 dark:border-slate-700 active:scale-[0.98]"
                  >
                    Minimizar a Segundo Plano
                  </button>
                  <button 
                    disabled={true}
                    className="flex-1 py-3 rounded-lg text-xs font-semibold bg-rose-100 text-rose-500 dark:bg-rose-950/20 dark:text-rose-400 cursor-not-allowed"
                  >
                    Procesando...
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => {
                    const updated = { ...((window as any).globalImportStatus || {}), show: false };
                    (window as any).globalImportStatus = updated;
                    setGlobalImportStatus(updated);
                    window.dispatchEvent(new CustomEvent('import-progress-update'));
                  }}
                  className="w-full py-3 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer active:scale-[0.98] transition-all"
                >
                  {globalImportStatus.isComplete ? 'Finalizar' : 'Cerrar y Reintentar'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </MotionConfig>
  );
}

// Missing icon helper for fallback
function Settings(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
}
