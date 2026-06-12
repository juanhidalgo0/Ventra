import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { usePOSStore } from './stores/posStore';
import LoginPage from './components/auth/LoginPage';
import ConnectionScreen from './components/auth/ConnectionScreen';
import MainLayout from './components/layout/MainLayout';
import POSScreen from './components/pos/POSScreen';
import DashboardScreen from './components/dashboard/DashboardScreen';
import ProductsScreen from './components/products/ProductsScreen';
import CashRegisterScreen from './components/cash-register/CashRegisterScreen';
import HistorialScreen from './components/pos/HistorialScreen';
import GastosScreen from './components/cash-register/GastosScreen';
import ReportsScreen from './components/dashboard/ReportsScreen';
import { MotionConfig } from 'framer-motion';
import api from './services/api';
import LicenseBlockScreen from './components/auth/LicenseBlockScreen';

import CuentasCorrientesScreen from './components/clients/CuentasCorrientesScreen';
import CashControlScreen from './components/cash-register/CashControlScreen';
import TreasuryScreen from './components/pos/TreasuryScreen';
import OnlineStoreScreen from './components/settings/OnlineStoreScreen';
import SettingsScreen from './components/settings/SettingsScreen';
import StockAuditScreen from './components/products/StockAuditScreen';
import PromosScreen from './components/products/PromosScreen';
import PurchasesScreen from './components/products/PurchasesScreen';
import StockControlScreen from './components/products/StockControlScreen';
import SuppliersScreen from './components/suppliers/SuppliersScreen';
import FiscalScreen from './components/dashboard/FiscalScreen';

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
        if ((window as any).__TAURI__) {
          const invokeFn = (window as any).__TAURI__.core?.invoke || (window as any).__TAURI__.invoke;
          if (invokeFn) {
            invokeFn('toggle_fullscreen').catch((err: any) => console.error("F11 error:", err));
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Clear cached connection and credentials on new app startup to force both screens
  if (!sessionStorage.getItem('session_initialized')) {
    sessionStorage.setItem('session_initialized', 'true');
    localStorage.removeItem('server_ip');
    localStorage.removeItem('connection_mode');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  }

  const { autoLoginAdmin, isAuthenticated } = useAuthStore();
  const [perfMode, setPerfMode] = useState(() => localStorage.getItem('performance_mode') === 'true');
  const location = useLocation();
  
  const [licenseStatus, setLicenseStatus] = useState<any>(null);
  const [checkingLicense, setCheckingLicense] = useState(true);

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
        // After all retries, don't block the app — just log
        console.warn('[App] License check failed after retries, allowing app to continue:', err.message);
        setLicenseStatus({ isActive: true }); // Assume active if we can't reach server
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
      setCheckingLicense(true);
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

  // Cache Warming useEffect
  useEffect(() => {
    if (!isAuthenticated) {
      setIsWarmed(false);
      return;
    }

    const refreshCacheSilently = async () => {
      try {
        const [categoriesRes, productsRes, promotionsRes, clientsRes] = await Promise.all([
          api.get('/categories'),
          api.get('/products?take=100000'),
          api.get('/promotions'),
          api.get('/clients')
        ]);
        setCategories(categoriesRes.data);
        setPromotions(promotionsRes.data);
        setClients(clientsRes.data);
        const processedProducts = productsRes.data.map((p: any) => {
          const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
          return {
            ...p,
            _searchToken: `${p.name.toLowerCase()} ${p.sku?.toLowerCase() || ''} ${barcodeList.join(' ')}`.trim()
          };
        });
        setProducts(processedProducts);
      } catch (err) {
        console.error('Silent cache refresh failed:', err);
      }
    };

    if (isWarmed) {
      return;
    }

    const warmCache = async () => {
      setWarmingError(null);
      try {
        setWarmingProgress(10);
        setWarmingStatus('Cargando configuraciones del sistema...');
        await new Promise(r => setTimeout(r, 200));

        setWarmingProgress(35);
        setWarmingStatus('Cargando categorías de productos...');
        const categoriesRes = await api.get('/categories');
        setCategories(categoriesRes.data);

        setWarmingProgress(60);
        setWarmingStatus('Cargando catálogo de productos en memoria...');
        const productsRes = await api.get('/products?take=100000');
        
        const processedProducts = productsRes.data.map((p: any) => {
          const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
          return {
            ...p,
            _searchToken: `${p.name.toLowerCase()} ${p.sku?.toLowerCase() || ''} ${barcodeList.join(' ')}`.trim()
          };
        });
        setProducts(processedProducts);

        setWarmingProgress(80);
        setWarmingStatus('Cargando promociones y combos activos...');
        const promotionsRes = await api.get('/promotions');
        setPromotions(promotionsRes.data);

        setWarmingProgress(95);
        setWarmingStatus('Sincronizando cuentas de clientes...');
        const clientsRes = await api.get('/clients');
        setClients(clientsRes.data);

        setWarmingProgress(100);
        setWarmingStatus('¡Sistema listo!');
        await new Promise(r => setTimeout(r, 150));
        setIsWarmed(true);
      } catch (err: any) {
        console.error('Failed to warm cache:', err);
        const detailedError = err.response?.data?.message || err.message || 'Error desconocido';
        setWarmingError(`Error al sincronizar datos del servidor: ${detailedError}. Reintentando conectar...`);
        setTimeout(warmCache, 4000);
      }
    };

    warmCache();
  }, [isAuthenticated, isWarmed]);

  if (checkingLicense) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3">
        <div className="w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-bold uppercase tracking-widest">Validando Licencia del Sistema...</p>
      </div>
    );
  }

  if (isAuthenticated && !isWarmed) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex flex-col items-center justify-center text-white px-6 z-50">
        <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl p-8 rounded-2xl border border-white/5 shadow-[0_0_50px_rgba(0,0,0,0.3)] flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-rose-500 to-indigo-500 text-white flex items-center justify-center mb-6 shadow-lg shadow-rose-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          
          <h2 className="text-2xl font-black tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400">GO! Punto de Venta</h2>
          <p className="text-indigo-400 text-xs font-black uppercase tracking-widest mb-6">Precalentando base de datos</p>
          
          <div className="w-full h-2 bg-slate-800/80 rounded-full overflow-hidden mb-4 border border-white/5 p-[1px]">
            <div className="h-full bg-gradient-to-r from-rose-500 via-purple-500 to-indigo-500 rounded-full transition-all duration-300" style={{ width: `${warmingProgress}%` }} />
          </div>
          
          <p className="text-xs font-bold text-slate-400 mb-1">{warmingStatus}</p>
          {warmingError && <p className="text-[11px] font-bold text-amber-500 mt-2 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20 animate-pulse">{warmingError}</p>}
        </div>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion={perfMode ? "always" : "user"}>
      {licenseStatus && !licenseStatus.isActive && (
        <LicenseBlockScreen 
          statusData={licenseStatus} 
          onActivated={() => {
            setCheckingLicense(true);
            checkLicense();
          }} 
        />
      )}
      <Routes>
        <Route path="/setup" element={<ConnectionScreen />} />
        <Route path="/login" element={<ConnectionGuard><LoginPage /></ConnectionGuard>} />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <MainLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/pos" />} />
                <Route path="/pos" element={<POSScreen />} />
                <Route path="/dashboard" element={<AdminRoute><DashboardScreen /></AdminRoute>} />
                <Route path="/products" element={<ProductsScreen />} />
                <Route path="/clients" element={<CuentasCorrientesScreen />} />
                <Route path="/cash" element={<CashRegisterScreen />} />
                <Route path="/historial" element={<HistorialScreen />} />
                <Route path="/gastos" element={<GastosScreen />} />
                <Route path="/reports" element={<AdminRoute><ReportsScreen /></AdminRoute>} />
                
                <Route path="/inventory" element={<ProductsScreen />} />
                <Route path="/promos" element={<PromosScreen />} />
                <Route path="/purchases" element={<PurchasesScreen />} />
                <Route path="/stock-control" element={<StockControlScreen />} />
                
                {/* New Routes from Images */}
                <Route path="/cash-control" element={<CashControlScreen />} />
                <Route path="/treasury" element={<TreasuryScreen />} />
                <Route path="/online-store" element={<OnlineStoreScreen />} />
                <Route path="/stock-audit" element={<StockAuditScreen />} />
                <Route path="/suppliers" element={<SuppliersScreen />} />
                <Route path="/fiscal" element={<FiscalScreen />} />
                <Route path="/settings" element={<AdminRoute><SettingsScreen /></AdminRoute>} />

                {/* Fallback for other routes */}
                <Route path="*" element={<div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center">
                    <Settings className="w-6 h-6 animate-spin-slow" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.3em]">Pantalla en desarrollo</p>
                </div>} />
              </Routes>
            </MainLayout>
          </PrivateRoute>
        }
      />
    </Routes>
    </MotionConfig>
  );
}

// Missing icon helper for fallback
function Settings(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
}
