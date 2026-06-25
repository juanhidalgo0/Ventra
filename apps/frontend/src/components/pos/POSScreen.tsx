import { useState, useEffect, useRef, useTransition } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { usePOSStore } from '../../stores/posStore';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { Search, X, Minus, Plus, ShoppingCart, CreditCard, Banknote, Smartphone, Shuffle, Check, Package, RefreshCw, CornerDownLeft, Receipt, Truck, Monitor, History, LayoutDashboard, Tag, LogOut, Wallet, Lock, Unlock, Settings, Key, DollarSign, Server, User, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { GoDeliveryLogo } from '../auth/ConnectionScreen';
import GastosModal from './GastosModal';
import ProveedoresModal from './ProveedoresModal';
import PaymentModal from './PaymentModal';
import CierreCajaModal from './CierreCajaModal';
import HistorialModal from './HistorialModal';
import CierreDiaModal from '../cash-register/CierreDiaModal';
import CajaInfoModal from './CajaInfoModal';
import AbrirCajaModal from './AbrirCajaModal';

interface Product { id: string; name: string; barcode?: string; salePrice: number; stock: number; category?: { id: string; name: string; color: string }; isFavorite: boolean; imageUrl?: string; unlimitedStock?: boolean; }
interface Category { id: string; name: string; color: string; _count?: { products: number }; }

// Beep sound for scanner
const playBeep = () => { try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 1200; g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + 0.08); } catch {} };

export default function POSScreen() {
  const { cart, addToCart, removeFromCart, updateQuantity, clearCart, getTotal, getDiscounts, getFinalTotal, getItemCount, setPromotions, promotions, getAppliedPromotions, addPromoToCart, getCartItemsWithDiscounts } = usePOSStore();
  const { discountsMap } = getCartItemsWithDiscounts();
  const { user, logout, login } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const cachedProducts = usePOSStore(state => state.products);
  const setCachedProducts = usePOSStore(state => state.setProducts);
  const cachedCategories = usePOSStore(state => state.categories);
  const setCachedCategories = usePOSStore(state => state.setCategories);
  const cachedPromotions = usePOSStore(state => state.promotions);
  const setCachedPromotions = usePOSStore(state => state.setPromotions);

  const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);
  const [isPending, startTransition] = useTransition();
  const [perfMode] = useState(() => localStorage.getItem('performance_mode') === 'true');
  
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [generateZAfterArqueo, setGenerateZAfterArqueo] = useState(false);
  const [zReportData, setZReportData] = useState<any>(null);
  const [adminUsername, setAdminUsername] = useState('admin');
  const [adminPassword, setAdminPassword] = useState('');

  const [activeMobileTab, setActiveMobileTab] = useState<'products' | 'cart'>('products');

  // --- Dark Mode State ---
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved !== null ? saved === 'dark' : true;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [isDarkMode]);
  // -----------------------

  const categories = cachedCategories;
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => clearTimeout(handler);
  }, [searchQuery]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showPromosOnly, setShowPromosOnly] = useState(false);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [pendingArqueos, setPendingArqueos] = useState<any[]>([]);
  const [sessionToArqueo, setSessionToArqueo] = useState<any | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showGastos, setShowGastos] = useState(false);
  const [showProveedores, setShowProveedores] = useState(false);
  const [showCierre, setShowCierre] = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [showCajaInfo, setShowCajaInfo] = useState(false);
  const [showAbrirCaja, setShowAbrirCaja] = useState(false);
  const [terminalName, setTerminalName] = useState('Terminal 1');
  const terminalNameRef = useRef('Terminal 1');
  useEffect(() => {
    terminalNameRef.current = terminalName;
  }, [terminalName]);
  const [isOpeningCaja, setIsOpeningCaja] = useState(false);
  const [isLoading, setIsLoading] = useState(() => {
    return usePOSStore.getState().products.length === 0;
  });

  // Profile Edit States
  const [showProfile, setShowProfile] = useState(false);
  const [profileOldPassword, setProfileOldPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileOldPassword || !profileNewPassword) {
      toast.error('Ambas contraseñas son obligatorias');
      return;
    }
    if (!/^\d+$/.test(profileNewPassword)) {
      toast.error('La contraseña debe ser numérica');
      return;
    }
    setIsSavingProfile(true);
    try {
      await api.post('/auth/change-password', {
        oldPassword: profileOldPassword,
        newPassword: profileNewPassword
      });
      toast.success('✅ Contraseña actualizada con éxito');
      setShowProfile(false);
      setProfileOldPassword('');
      setProfileNewPassword('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al actualizar contraseña');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const confirmSaleRef = useRef<HTMLButtonElement>(null);

  const focusConfirmBtn = () => {
    setTimeout(() => {
      if (confirmSaleRef.current && !confirmSaleRef.current.disabled) {
        confirmSaleRef.current.focus();
      }
    }, 100);
  };

  // Handle modal query params from nav
  useEffect(() => {
    const modal = searchParams.get('modal');
    if (modal === 'gastos') { setShowGastos(true); setSearchParams({}); }
    if (modal === 'proveedores') { setShowProveedores(true); setSearchParams({}); }
  }, [searchParams]);

  useEffect(() => {
    // Smart terminal detection
    let uuid = localStorage.getItem('terminal_uuid');
    if (!uuid) {
      uuid = 'term_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('terminal_uuid', uuid);
    }
    api.get(`/cash/terminal-name?terminalId=${uuid}`)
      .then(({ data }) => {
        setTerminalName(data.terminalName);
        terminalNameRef.current = data.terminalName;
        loadCurrentSession();
        loadPendingArqueos();
      })
      .catch(() => {
        setTerminalName('Terminal 1');
        terminalNameRef.current = 'Terminal 1';
        loadCurrentSession();
        loadPendingArqueos();
      });

    loadProducts();
    loadCategories();
    loadPromotions();

    // Periodically check for active session and reload products if boot was offline
    const sessionInterval = setInterval(() => {
      loadCurrentSession();
      loadPendingArqueos();
      if (usePOSStore.getState().products.length === 0) {
        loadProducts();
        loadCategories();
        loadPromotions();
      }
    }, 4000);
    return () => clearInterval(sessionInterval);
  }, [user]);

  // Price prompt states for custom price products
  const [pricePromptProduct, setPricePromptProduct] = useState<any | null>(null);
  const [promptPriceValue, setPromptPriceValue] = useState<string>('');

  const handleProductAdd = (product: any) => {
    if (product.allowCustomPrice) {
      setPricePromptProduct(product);
      setPromptPriceValue('');
      setSearchQuery('');
    } else {
      addToCart(product);
      setSearchQuery('');
      playBeep();
      focusSearch();
    }
  };

  // Keyboard shortcuts and global background barcode scanner
  useEffect(() => {
    // 1. Regular Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F4') { e.preventDefault(); if (cart.length > 0 && currentSession) setShowPayment(true); }
      if (e.key === 'Escape') { 
        setShowPayment(false); 
        setShowGastos(false); 
        setShowProveedores(false); 
        setShowCierre(false);
        setShowHistorial(false);
        setShowCajaInfo(false);
        setShowAbrirCaja(false);
        setSearchQuery(''); 
        focusSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 2. Intelligent High-Speed Barcode Reader Listener (Capture Phase)
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      if (isInput) {
        return;
      }
      
      const now = Date.now();
      const timeDiff = now - lastKeyTime;
      lastKeyTime = now;

      // A hardware scanner emits sequential numeric keystrokes in extremely rapid intervals (<25ms).
      // Manual typing typically takes >80ms. Reset buffer if latency is too long.
      const isScannerFast = timeDiff <= 25;

      if (isScannerFast) {
        // If it's a numeric key, intercept and prevent default to avoid typing it in the search box
        if (e.key.length === 1 && e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          buffer += e.key;
          
          // Clear any initial characters that leaked into the search input on the slow first keypress
          if (buffer.length === 2) {
            if (searchRef.current) searchRef.current.value = '';
            setSearchQuery('');
          }
          return;
        }
      } else {
        // Slow keypress (manual). Reset buffer to the current key if it's numeric.
        buffer = '';
        if (e.key.length === 1 && e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          buffer = e.key;
        }
      }

      if (e.key === 'Enter') {
        // Scanner emits 'Enter' at the end of a successful barcode scan.
        if (buffer.length >= 2) {
          // Scanned barcode signature confirmed! Intercept the Enter event.
          e.preventDefault();
          e.stopPropagation();
          const scannedCode = buffer;
          buffer = ''; // reset buffer immediately
          if (searchRef.current) searchRef.current.value = '';
          setSearchQuery('');
          
          try {
            // First check if EAN/code matches a combo in promotions
            const matchingPromo = usePOSStore.getState().promotions.find(p => p.isActive && p.code && p.code.toLowerCase() === scannedCode.toLowerCase());
            if (matchingPromo) {
              addPromoToCart(matchingPromo, cachedProducts);
              playBeep();
              focusConfirmBtn();
              return;
            }

            const { data } = await api.get(`/products/barcode/${scannedCode}`);
            if (data.allowCustomPrice) {
              setPricePromptProduct(data);
              setPromptPriceValue('');
            } else {
              addToCart(data);
              playBeep();
              setTimeout(() => searchRef.current?.focus(), 50);
            }
          } catch {
            toast.error(`⚠️ Código no registrado: ${scannedCode}`, { id: scannedCode });
            setTimeout(() => searchRef.current?.focus(), 50);
          }
        } else {
          buffer = '';
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [cart.length, currentSession, addToCart, cachedProducts, promotions]);

  // Removed refocus of Confirm button on cart change to prevent stealing focus from barcode search input

  // Refocus Confirm button when any modal closes
  useEffect(() => {
    if (!showPayment && !showGastos && !showProveedores && !showCierre && !showHistorial && !showCajaInfo && !showAbrirCaja && !showProfile) {
      focusConfirmBtn();
    }
  }, [showPayment, showGastos, showProveedores, showCierre, showHistorial, showCajaInfo, showAbrirCaja, showProfile]);

  const loadProducts = async (force = false) => {
    if (!force && cachedProducts.length > 0) {
      setIsLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/products', { params: { take: 100000 } });
      const processedProducts = data.map((p: any) => {
        const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
        return {
          ...p,
          _searchToken: `${p.name.toLowerCase()} ${p.sku?.toLowerCase() || ''} ${barcodeList.join(' ')}`.trim()
        };
      });
      setCachedProducts(processedProducts);
    } catch {} finally { setIsLoading(false); }
  };

  const handleOpenCaja = async () => {
    setIsOpeningCaja(true);
    try {
      const { data } = await api.post('/cash/open', { terminalName, openingAmount: 0, openingNotes: '' });
      setCurrentSession(data);
      toast.success('✅ Caja abierta correctamente');
      loadProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al abrir caja');
    } finally {
      setIsOpeningCaja(false);
    }
  };

  const loadCategories = async () => { try { const { data } = await api.get('/categories'); setCachedCategories(data); } catch {} };
  const loadCurrentSession = async () => {
    try {
      const { data } = await api.get('/cash/current', { params: { terminalName: terminalNameRef.current } });
      setCurrentSession(prev => {
        if (!prev && data) {
          // Reconnection or boot restored! Load all associated POS datasets.
          loadProducts();
          loadCategories();
          loadPromotions();
        }
        return data;
      });
    } catch {}
  };
  const loadPromotions = async () => { try { const { data } = await api.get('/promotions'); setCachedPromotions(data); } catch {} };
  const loadPendingArqueos = async () => {
    try {
      const { data } = await api.get('/cash/pending-arqueos');
      setPendingArqueos(data);
    } catch (err) {
      console.error('Error loading pending arqueos', err);
    }
  };
  const handleInstantClose = async (sessionId: string, doZ: boolean = false) => {
    try {
      await api.post(`/cash/${sessionId}/close`, {});
      toast.success('✅ Caja cerrada correctamente. Arqueo pendiente.');
      setCurrentSession(null);
      const { data } = await api.get('/cash/pending-arqueos');
      setPendingArqueos(data);
      const sessionToArqueo = data.find((a: any) => a.id === sessionId);
      if (sessionToArqueo) {
        setSessionToArqueo(sessionToArqueo);
        setGenerateZAfterArqueo(doZ);
        setShowCierre(true);
      } else {
        setShowAbrirCaja(true);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al cerrar caja');
    }
  };

  useEffect(() => {
    startTransition(() => {
      let filtered = cachedProducts;
      
      if (selectedCategory) {
        filtered = filtered.filter(p => p.categoryId === selectedCategory);
      }
      
      if (debouncedSearchQuery) {
        const queryClean = debouncedSearchQuery.toLowerCase().trim();
        filtered = filtered.filter(p => 
          p._searchToken?.includes(queryClean) || 
          p.name?.toLowerCase().includes(queryClean) || 
          p.barcode?.includes(queryClean) || 
          p.sku?.toLowerCase().includes(queryClean)
        );
      }
      
      // Limit products displayed to prevent DOM and React VDOM rendering lag (80 for normal mode, 40 for performance mode)
      const limit = perfMode ? 40 : 80;
      filtered = filtered.slice(0, limit);

      setDisplayedProducts(filtered);
    });
  }, [debouncedSearchQuery, selectedCategory, cachedProducts, perfMode]);

  const focusSearch = () => {
    setTimeout(() => {
      if (searchRef.current) {
        searchRef.current.focus();
      }
    }, 50);
  };

  const handleBarcodeSearch = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (!searchQuery) {
        // If search is empty and cart has items, open payment modal
        if (cart.length > 0) {
          setShowPayment(true);
        }
        return;
      }
      
      const codeClean = searchQuery.trim();
      
      // 1. Check if it's a promotion code
      const matchingPromo = promotions.find(p => p.isActive && p.code && p.code.toLowerCase() === codeClean.toLowerCase());
      if (matchingPromo) {
        addPromoToCart(matchingPromo, cachedProducts);
        setSearchQuery('');
        playBeep();
        focusSearch();
        return;
      }

      // 2. Barcode/code search — accept any non-empty code (numeric or alphanumeric)
      try {
        const { data } = await api.get(`/products/barcode/${codeClean}`);
        if (data.allowCustomPrice) {
          setPricePromptProduct(data);
          setPromptPriceValue('');
          // Clear query immediately so it's clean when prompt closes
          setSearchQuery('');
        } else {
          addToCart(data);
          setSearchQuery('');
          playBeep();
          focusSearch();
        }
      } catch {
        toast.error(`⚠️ Código no registrado: ${codeClean}`, { id: codeClean });
        setSearchQuery('');
        focusSearch();
      }
    }
  };

  const handleAddPromoToCart = (promo: any) => {
    addPromoToCart(promo, cachedProducts);
    playBeep();
  };

  const formatPrice = (price: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(price);

  const filteredPromos = promotions.filter(p => 
    p.isActive && 
    (debouncedSearchQuery === '' || p.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()))
  );

  const cartEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll cart to bottom on change
  useEffect(() => {
    cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cart.length]);

  return (
    <>
      <div className="flex flex-col h-full gap-3 overflow-hidden">
        {/* Pending Arqueo Notification Banner */}
        {pendingArqueos.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 shrink-0 shadow-md flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center gap-3.5 relative z-10 w-full sm:w-auto">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold text-sm shrink-0">
                ⚠️
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-900 tracking-tight leading-none">Tienes arqueos de caja pendientes</h4>
                <p className="text-[11px] text-amber-700 font-semibold mt-1.5 leading-relaxed">
                  Tus turnos anteriores en {pendingArqueos.map(p => `"${p.terminalName}" (cerrado el ${new Date(p.closedAt).toLocaleString('es-AR')})`).join(', ')} aún no tienen el conteo de caja.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setSessionToArqueo(pendingArqueos[0]);
                setShowCierre(true);
              }}
              className="w-full sm:w-auto px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider shadow-sm transition-all active:scale-95 cursor-pointer z-10 whitespace-nowrap"
            >
              Completar Arqueo Pendiente
            </button>
          </motion.div>
        )}

        {/* TOP: Quick Actions Bar */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* 1. Estado Caja */}
          <button 
            onClick={() => { if (currentSession) setShowCajaInfo(true); else setShowAbrirCaja(true); }} 
            className={`flex-1 min-w-[140px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all active:scale-95 shadow-md border ${
              currentSession 
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/10 border-emerald-500/20' 
                : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/10 border-rose-500/20'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span className="flex items-center gap-1.5">
              {currentSession ? 'Caja Abierta' : 'Caja Cerrada'}
              {currentSession && <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />}
            </span>
          </button>

          {/* 2. Gastos */}
          <button onClick={() => { if (currentSession) setShowGastos(true); else toast.error('No hay caja abierta'); }} className="flex-1 min-w-[110px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-400 dark:border-slate-600 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95 shadow-sm">
            <Receipt className="w-4 h-4" /> Gastos
          </button>

          {/* 3. Proveedores */}
          <button onClick={() => setShowProveedores(true)} className="flex-1 min-w-[130px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-600 text-white font-bold text-sm hover:bg-rose-700 transition-all active:scale-95 shadow-md border border-rose-500/20">
            <Truck className="w-4 h-4" /> Proveedores
          </button>

          {/* 4. Historial */}
          <button onClick={() => setShowHistorial(true)} className="flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-400 dark:border-slate-600 font-bold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95 shadow-sm">
            <History className="w-4 h-4" /> Historial
          </button>


          {/* 6. Cerrar Sesión */}
          <button onClick={() => logout()} className="flex-1 min-w-[140px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white dark:bg-slate-800 hover:bg-rose-550 dark:hover:bg-rose-900/30 hover:text-rose-600 dark:hover:text-rose-400 text-slate-700 dark:text-slate-300 font-bold text-sm transition-all active:scale-95 border border-slate-400 dark:border-slate-600 shadow-sm">
            <LogOut className="w-4 h-4" /> Cerrar Sesión
          </button>

          {/* 6.5 Account Menu Button */}
          <button 
            onClick={() => {
              setProfileOldPassword('');
              setProfileNewPassword('');
              setShowPasswords(false);
              setShowProfile(true);
            }} 
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm transition-all active:scale-95 border border-slate-400 dark:border-slate-600 shadow-sm shrink-0"
            title="Cuenta de Usuario"
          >
            <User className="w-4 h-4" /> {user?.username || 'Usuario'}
          </button>

          {/* 6.6 Dark Mode Toggle */}
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)} 
            className="w-12 h-12 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all active:scale-95 border border-slate-400 dark:border-slate-600 shadow-sm shrink-0"
            title="Alternar Modo Oscuro"
          >
            {isDarkMode ? <Moon className="w-5 h-5 text-indigo-400" /> : <Sun className="w-5 h-5 text-amber-500" />}
          </button>

          {/* 7. Dashboard (Configuration Icon) */}
          <button 
            onClick={() => {
              if (isAdmin) {
                navigate('/dashboard');
              } else {
                setShowAdminPrompt(true);
              }
            }} 
            className="w-12 h-12 flex items-center justify-center rounded-xl bg-rose-600 text-white hover:bg-rose-700 transition-all active:scale-95 shadow-md border border-rose-500/10 shrink-0"
            title="Configuración / Dashboard"
          >
            <Settings className="w-5 h-5 animate-pulse-soft" />
          </button>

          {/* 8. Server Selection Button */}
          <button 
            onClick={() => {
              localStorage.removeItem('server_ip');
              localStorage.removeItem('connection_mode');
              logout();
              navigate('/setup');
            }} 
            className="w-12 h-12 flex items-center justify-center rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 transition-all active:scale-95 border border-slate-400 dark:border-slate-600 shadow-sm shrink-0"
            title="Seleccionar Servidor"
          >
            <Server className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row gap-3 md:gap-4 overflow-hidden relative">
          {currentSession ? (
            <>
              {/* LEFT: Products Panel */}
              <div className={`flex-1 min-w-0 card flex flex-col overflow-hidden bg-white dark:bg-slate-900 border border-slate-400/80 dark:border-slate-700 shadow-md ${activeMobileTab === 'products' ? 'flex' : 'hidden md:flex'}`}>
            <div className="px-5 pt-4 pb-3 flex items-center gap-3 bg-slate-50/50 dark:bg-slate-900/50 backdrop-blur-sm z-10 border-b border-slate-300 dark:border-slate-700">
              <div className="flex-1 relative flex items-center">
                <Search className="absolute left-4 w-4 h-4 text-slate-600 dark:text-slate-400 pointer-events-none" />
                <input ref={searchRef} type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value.toUpperCase())} onKeyDown={handleBarcodeSearch} placeholder="Buscar por nombre o código..." className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-2xl pl-11 pr-10 py-2.5 text-sm focus:bg-slate-100 dark:focus:bg-slate-900 focus:border-rose-500 outline-none text-slate-800 dark:text-slate-100 transition-all font-semibold uppercase" id="pos-search" autoFocus autoComplete="off" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>}
              </div>
              <button onClick={() => loadProducts(true)} className="p-2.5 rounded-2xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all active:scale-95 border border-slate-400 dark:border-slate-600" title="Refrescar"><RefreshCw className="w-4 h-4" /></button>
            </div>

            <div className="px-5 pb-3 flex flex-wrap gap-2 border-b border-slate-300 dark:border-slate-700">
              <button onClick={() => { setSelectedCategory(null); setShowPromosOnly(false); }} className={`px-5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all ${!selectedCategory && !showPromosOnly ? 'bg-rose-600 text-white shadow-md border border-rose-500/10' : 'bg-slate-100 dark:bg-slate-800 text-slate-650 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-400 dark:border-slate-600'}`}>
                Todos
              </button>
              <button onClick={() => { setShowPromosOnly(true); setSelectedCategory(null); }} className={`px-5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2 ${showPromosOnly ? 'bg-emerald-500 text-white shadow-md border border-emerald-500/10' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-250 dark:border-emerald-700 hover:bg-emerald-100/55'}`}>
                <Tag className="w-3.5 h-3.5" /> Promos
              </button>
              {categories.filter(cat => cachedProducts.some(p => p.categoryId === cat.id)).map((cat) => (
                <button key={cat.id} onClick={() => { setSelectedCategory(cat.id); setShowPromosOnly(false); }} className={`px-5 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all ${selectedCategory === cat.id ? 'text-white shadow-md border-transparent' : 'bg-slate-100 dark:bg-slate-800 text-slate-650 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-400 dark:border-slate-600'}`} style={selectedCategory === cat.id ? { backgroundColor: cat.color, borderColor: cat.color } : {}}>
                  {cat.name}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4 custom-scrollbar bg-slate-50/30 dark:bg-slate-900/30">
              {!currentSession ? (
                <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto py-8">
                  <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-800 border border-slate-400/80 dark:border-slate-700 rounded-2xl p-8 shadow-2xl w-full text-slate-800 dark:text-slate-200">
                    <div className="w-16 h-16 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center mx-auto mb-5 border border-rose-500/20">
                      <Lock className="w-8 h-8" />
                    </div>
                    
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight mb-1">Apertura de Caja</h3>
                    <p className="text-slate-700 dark:text-slate-400 text-xs font-semibold max-w-[280px] mx-auto mb-6 leading-relaxed">Iniciá tu turno en el Punto de Venta completando los datos de la terminal.</p>
                    
                    <div className="space-y-4 text-left">
                      <div>
                        <label className="block text-[9px] font-bold text-rose-600 uppercase tracking-widest mb-1.5 ml-1">Nombre de Terminal</label>
                        <div className="relative">
                          <Monitor className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 dark:text-slate-400" />
                          <input 
                            type="text" 
                            value={terminalName} 
                            readOnly
                            className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-400 dark:border-slate-600 rounded-2xl pl-11 pr-4 py-2.5 text-sm font-bold text-slate-700 dark:text-slate-300 outline-none select-none cursor-not-allowed transition-all" 
                            placeholder="Terminal 1" 
                          />
                        </div>
                        <p className="text-[9.5px] text-slate-600 font-semibold mt-2 ml-1 leading-relaxed">
                          🔒 El nombre de la terminal se autodetecta por hardware para prevenir modificaciones no autorizadas.
                        </p>
                      </div>

                      <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-900/20 border border-indigo-100/50 dark:border-indigo-800/30 flex items-start gap-2.5">
                        <span className="text-sm mt-0.5">🖥️</span>
                        <p className="text-[10px] text-indigo-750 dark:text-indigo-300 font-semibold leading-relaxed">
                          La caja se inicializará automáticamente con **monto inicial cero ($0)**. Toda venta o movimiento de efectivo de este turno será registrado e integrado a las estadísticas.
                        </p>
                      </div>

                      <button 
                        onClick={handleOpenCaja} 
                        disabled={isOpeningCaja}
                        className="w-full btn-primary bg-rose-600 hover:bg-rose-700 text-white h-12 text-sm rounded-2xl shadow-lg shadow-rose-500/20 font-bold uppercase tracking-wider flex items-center justify-center gap-2 mt-6 cursor-pointer"
                      >
                        {isOpeningCaja ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Abriendo Caja...</span>
                          </>
                        ) : (
                          <>
                            <Unlock className="w-4 h-4" />
                            <span>Abrir Caja e Iniciar Turno</span>
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                </div>
              ) : (displayedProducts.length === 0 && !showPromosOnly) ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-20">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4"><Package className="w-8 h-8 text-slate-350" /></div>
                  <p className="text-slate-600 font-bold">No se encontraron productos.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
                  <AnimatePresence>
                    {/* Display Promos if active or if searched */}
                    {(showPromosOnly || searchQuery !== '') && filteredPromos.map((promo) => {
                      // Calculate list total price for visual Crossed-out design
                      const originalPrice = promo.products.reduce((sum: number, pp: any) => {
                        const prod = pp.product || cachedProducts.find((p: any) => p.id === pp.productId);
                        return sum + (prod ? prod.salePrice : 0) * pp.quantity;
                      }, 0);

                      return (
                        <button 
                          key={promo.id}
                          onClick={() => handleAddPromoToCart(promo)}
                          className="group bg-gradient-to-br from-emerald-500 to-emerald-600 border border-emerald-400 rounded-2xl p-5 text-left shadow-md hover:shadow-xl hover:scale-[1.02] transition-all active:scale-[0.98] relative overflow-hidden flex flex-col justify-between min-h-[160px]"
                        >
                          <div className="absolute -top-2 -right-2 w-16 h-16 bg-white/10 rounded-full blur-xl" />
                          <div>
                            <div className="flex items-center justify-between gap-1.5 mb-2.5">
                              <span className="text-[9px] font-bold bg-white/20 text-white px-2.5 py-1 rounded-lg uppercase tracking-widest leading-none">
                                {promo.type === 'NX_M' ? `${promo.nValue}x${promo.mValue}` : 'COMBO'}
                              </span>
                              
                              {promo.type === 'DISCOUNT_PERCENT' && (
                                <span className="text-[9px] font-extrabold bg-rose-500 text-white px-2 py-0.5 rounded-lg uppercase tracking-wider">
                                  -{promo.discountPercentage}% OFF
                                </span>
                              )}
                            </div>
                            <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-2 leading-tight h-10 overflow-hidden mb-2">{promo.name}</h3>
                          </div>

                          <div className="mt-auto">
                            <div className="w-full border-t border-dashed border-white/20 my-2.5" />
                            
                            <div className="flex items-end justify-between pt-1">
                              <div>
                                {originalPrice > 0 && (
                                  <span className="text-[10px] text-emerald-200/80 line-through font-bold block mb-0.5 leading-none">
                                    {formatPrice(originalPrice)}
                                  </span>
                                )}
                                <span className="text-base sm:text-lg font-black text-white leading-none">
                                  {promo.type === 'FIXED_COMBO' && formatPrice(promo.fixedPrice || 0)}
                                  {promo.type === 'DISCOUNT_PERCENT' && formatPrice(originalPrice * (1 - (promo.discountPercentage || 0) / 100))}
                                  {promo.type === 'NX_M' && formatPrice(originalPrice * ((promo.mValue || 1) / (promo.nValue || 1)))}
                                </span>
                              </div>
                              
                              <div className="w-7 h-7 bg-white/15 hover:bg-white/25 rounded-lg flex items-center justify-center text-white/90 shadow transition-colors duration-200">
                                <Plus className="w-4 h-4 stroke-[2.5]" />
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}

                               {!showPromosOnly && displayedProducts.map((product) => (
                      <button 
                        key={product.id}
                        onClick={() => {
                          handleProductAdd(product);
                        }}
                        style={{ contain: 'content', contentVisibility: 'auto' }}
                        className="group bg-white dark:bg-slate-800 border border-slate-400/80 dark:border-slate-700 rounded-2xl p-2.5 text-left hover:border-red-500 dark:hover:border-red-500/80 hover:shadow-xl hover:shadow-red-500/5 transition-all duration-305 active:scale-[0.97] select-none relative overflow-hidden flex flex-col h-[234px] shadow-sm"
                      >
                        <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-bl-full pointer-events-none z-0" />
                        
                        {/* Top: Large Image Container */}
                        <div className="w-full h-[120px] rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-300 dark:border-slate-700 overflow-hidden flex-shrink-0 flex items-center justify-center relative group-hover:border-red-350 dark:group-hover:border-red-500/50 transition-all shadow-inner mb-2 z-10">
                          <img 
                            src={product.imageUrl || './product-placeholder.png'} 
                            alt={product.name} 
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain p-1.5 group-hover:scale-108 transition-transform duration-500 mix-blend-multiply dark:mix-blend-normal dark:invert dark:hue-rotate-180"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = './product-placeholder.png';
                            }}
                          />
                          
                          {/* Stock Tag overlaid on Image */}
                          <div className="absolute bottom-1.5 left-1.5 z-15">
                            {product.unlimitedStock ? (
                              <span className="text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-md border tracking-wider uppercase bg-indigo-500/85 backdrop-blur-[2px] text-white border-transparent">
                                ST: ∞
                              </span>
                            ) : (
                              <span className={`text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-md border tracking-wider uppercase transition-all ${
                                product.stock <= 5 
                                  ? 'bg-red-50 text-red-700 border-red-200 shadow-sm shadow-red-500/5' 
                                  : 'bg-slate-900/75 backdrop-blur-[2px] text-white border-transparent'
                              }`}>
                                ST: {product.stock}
                              </span>
                            )}
                          </div>
                          
                          {/* Category Tag overlaid on top-left of Image */}
                          {product.category?.name && (
                            <div className="absolute top-1.5 left-1.5 z-15">
                              <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded-md inline-block uppercase tracking-wider shadow-sm text-white" style={{ backgroundColor: `${product.category.color}ef` }}>
                                {product.category.name}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Bottom: Info Area */}
                        <div className="flex-1 flex flex-col justify-start min-w-0 z-10">
                          <h3 className="text-xs font-bold text-slate-850 dark:text-slate-200 group-hover:text-red-650 dark:group-hover:text-red-400 transition-colors line-clamp-2 leading-tight max-h-8 overflow-hidden mb-1 pr-1">
                            {product.name}
                          </h3>
                          {product.barcode && (
                            <p className="text-[9px] font-mono font-medium text-slate-600 dark:text-slate-400 leading-none line-clamp-1">
                              {product.barcode}
                            </p>
                          )}
                        </div>

                        {/* Locked Bottom Info Row (always exactly in same position) */}
                        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between z-15">
                          <div className="bg-red-50 dark:bg-red-900/20 border border-red-100/60 dark:border-red-800/30 px-2.5 py-1.5 rounded-xl shadow-inner-sm transition-colors group-hover:bg-red-100/40 dark:group-hover:bg-red-900/40">
                            <p className="text-xs sm:text-sm font-black text-red-600 dark:text-red-400 leading-none">
                              {formatPrice(product.salePrice)}
                            </p>
                          </div>
                          
                          {/* Premium Snapping bright-red plus button */}
                          <div className="w-[26px] h-[26px] bg-red-600 text-white rounded-lg flex items-center justify-center transition-colors duration-150 shadow-md group-hover:bg-red-700 group-active:bg-red-800 shrink-0">
                            <Plus className="w-4 h-4 stroke-[2.8]" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Cart Panel - Widened for better layout */}
          <div className={`w-full md:w-[350px] lg:w-[400px] xl:w-[480px] flex-shrink-0 card flex flex-col overflow-hidden bg-white dark:bg-slate-900 border-l border-slate-400/80 dark:border-slate-700 shadow-2xl ${activeMobileTab === 'cart' ? 'flex' : 'hidden md:flex'}`}>
            <div className="px-6 pt-5 pb-4 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-300 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.2em]">Ticket en curso</span>
              </div>
              <button onClick={() => clearCart()} className="text-[10px] font-bold text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 uppercase tracking-wider transition-colors">Vaciar Carrito</button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 custom-scrollbar">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-slate-450 dark:text-slate-500 py-10 opacity-60">
                  <ShoppingCart className="w-16 h-16 mb-4 stroke-[1]" />
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">Escaneá o seleccioná productos</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {cart.map((item) => {
                    const isPromo = item.isPromo;
                    const discount = discountsMap[item.productId] || 0;
                    
                    let originalTotal = item.price * item.quantity;
                    let promoTotal = originalTotal - discount;

                    if (isPromo && item.productsMetadata) {
                      const originalPrice = item.productsMetadata.reduce((s, p) => s + p.price * p.quantity, 0);
                      originalTotal = originalPrice * item.quantity;
                      promoTotal = item.price * item.quantity;
                    }
                    
                    const hasDiscount = isPromo || discount > 0;

                    return (
                      <motion.div 
                        key={item.cartKey} 
                        layout 
                        initial={{ opacity: 0, x: -10 }} 
                        animate={{ opacity: 1, x: 0 }} 
                        exit={{ opacity: 0, x: -10, height: 0 }} 
                        className="py-3 border-b border-slate-300 dark:border-slate-700/50 last:border-0 group flex items-center gap-4"
                      >
                        {/* Product Name - Flexible */}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight line-clamp-2 pr-2">{item.name}</h4>
                          {item.isPromo && item.productsMetadata && (
                            <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 tracking-tight leading-relaxed">
                              {item.productsMetadata.map(pm => `${pm.quantity}x ${pm.name}`).join(' + ')}
                            </p>
                          )}
                          {item.quantity > 1 && <p className="text-[9px] font-bold text-slate-600 dark:text-slate-400 mt-0.5">{formatPrice(item.price)} c/u</p>}
                        </div>

                        {/* Quantity Selector - Compact Horizontal */}
                        <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-150 dark:border-slate-700 shrink-0">
                          <button onClick={() => updateQuantity(item.cartKey, item.quantity - 1)} className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-slate-700 dark:text-slate-300 border border-slate-400 dark:border-slate-600 transition-all shadow-sm active:scale-90"><Minus className="w-2.5 h-2.5" /></button>
                          <span className="w-8 text-center text-xs font-bold text-slate-800 dark:text-slate-200">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.cartKey, item.quantity + 1)} className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-slate-700 dark:text-slate-300 border border-slate-400 dark:border-slate-600 transition-all shadow-sm active:scale-90"><Plus className="w-2.5 h-2.5" /></button>
                        </div>

                        {/* Total Price & Delete */}
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right min-w-[70px]">
                            {hasDiscount && (
                              <span className="text-[10px] text-slate-600 line-through font-bold block leading-none mb-0.5">
                                {formatPrice(originalTotal)}
                              </span>
                            )}
                            <p className="text-sm font-bold text-rose-600 leading-none">{formatPrice(promoTotal)}</p>
                          </div>
                          <button onClick={() => removeFromCart(item.cartKey)} className="text-slate-600 hover:text-rose-650 transition-all p-1.5 hover:bg-rose-50 rounded-lg active:scale-90">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                  <div ref={cartEndRef} />
                </AnimatePresence>
              )}
            </div>

            <div className="bg-slate-50/70 dark:bg-slate-900/70 backdrop-blur-md px-5 py-5 border-t border-slate-400/80 dark:border-slate-700 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">Items / Cantidad</span>
                  <span className="text-slate-800 dark:text-slate-200">{getItemCount()}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-550 dark:text-slate-400">
                  <span>Subtotal</span>
                  <span>{formatPrice(getTotal())}</span>
                </div>
                {getAppliedPromotions().map((promo, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 animate-in slide-in-from-bottom-1">
                    <span className="flex items-center gap-1"><Tag className="w-3 h-3" /> {promo.name}</span>
                    <span>-{formatPrice(promo.discount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xl font-bold text-slate-850 dark:text-slate-100 pt-2 border-t border-slate-400 dark:border-slate-700">
                  <span>Total</span>
                  <span className="text-2xl font-bold text-rose-600 dark:text-rose-500">{formatPrice(getFinalTotal())}</span>
                </div>
              </div>
              <button
                ref={confirmSaleRef}
                onClick={() => { if (cart.length > 0 && currentSession) setShowPayment(true); }}
                disabled={cart.length === 0 || !currentSession}
                className="w-full btn-success h-16 text-lg rounded-xl shadow-lg shadow-emerald-500/20 disabled:shadow-none disabled:grayscale flex items-center justify-center cursor-pointer focus:ring-4 focus:ring-emerald-300 focus:outline-none"
                id="pos-confirm-sale"
              >
                Confirmar Venta <CornerDownLeft className="w-5 h-5 ml-2" />
              </button>
            </div>
          </div>
        </>
        ) : (
            <div className="flex-1 flex items-center justify-center bg-slate-50/50 dark:bg-slate-950/40 backdrop-blur-sm rounded-2xl border border-dashed border-slate-400 dark:border-slate-700 p-8 shadow-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }} 
                className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-300 dark:border-slate-800 shadow-xl text-center space-y-6"
              >
                <div className="w-20 h-20 bg-rose-550/10 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 rounded-3xl flex items-center justify-center mx-auto shadow-md">
                  <Lock className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-850 dark:text-slate-100">Caja Registradora Cerrada</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">Para comenzar a vender y utilizar las funciones del Punto de Venta (POS), debés abrir una sesión de caja.</p>
                </div>
                <button
                  onClick={() => setShowAbrirCaja(true)}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-2xl text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 cursor-pointer"
                >
                  <Unlock className="w-5 h-5 text-indigo-200" /> Abrir Caja Registradora
                </button>
              </motion.div>
            </div>
          )}
        </div>

        {/* Mobile Tab Bar */}
        {currentSession && (
          <div className="md:hidden flex bg-white border-t border-slate-400 shrink-0 h-16 relative z-30">
            <button
              onClick={() => setActiveMobileTab('products')}
              className={`flex-1 flex flex-col items-center justify-center gap-1 ${
                activeMobileTab === 'products' ? 'text-rose-600 font-extrabold' : 'text-slate-700'
              }`}
            >
              <Package className="w-5 h-5" />
              <span className="text-[10px] uppercase tracking-wider">Catálogo</span>
            </button>
            <button
              onClick={() => setActiveMobileTab('cart')}
              className={`flex-1 flex flex-col items-center justify-center gap-1 relative ${
                activeMobileTab === 'cart' ? 'text-rose-600 font-extrabold' : 'text-slate-700'
              }`}
            >
              <div className="relative">
                <ShoppingCart className="w-5 h-5" />
                {cart.length > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-rose-600 text-white text-[8px] font-black rounded-full h-4 w-4 flex items-center justify-center border border-white">
                    {cart.reduce((sum, item) => sum + item.quantity, 0)}
                  </span>
                )}
              </div>
              <span className="text-[10px] uppercase tracking-wider">Carrito</span>
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showPayment && <PaymentModal key="payment-modal" total={getFinalTotal()} sessionId={currentSession?.id} onClose={() => { setShowPayment(false); focusSearch(); }} onSuccess={() => { clearCart(); setShowPayment(false); loadProducts(true); loadCurrentSession(); focusSearch(); }} />}
        {showGastos && <GastosModal key="gastos-modal" sessionId={currentSession?.id} terminalName={terminalName} onClose={() => { setShowGastos(false); loadCurrentSession(); focusSearch(); }} />}
        {showProveedores && <ProveedoresModal key="proveedores-modal" sessionId={currentSession?.id} onClose={() => { setShowProveedores(false); loadCurrentSession(); focusSearch(); }} />}
        {showAdminPrompt && (
          <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl border border-slate-400">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800 leading-none">Acceso Admin</h3>
                  <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mt-1">Autorización Requerida</p>
                </div>
              </div>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 outline-none focus:border-rose-500 mb-3 text-sm font-semibold"
                placeholder="Usuario (ej. admin)"
              />
              <input
                type="password"
                autoFocus
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    try {
                      await login(adminUsername, adminPassword);
                      setShowAdminPrompt(false);
                      setAdminPassword('');
                      navigate('/dashboard');
                    } catch (err) {
                      toast.error('Credenciales incorrectas');
                    }
                  }
                  if (e.key === 'Escape') setShowAdminPrompt(false);
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-3 outline-none focus:border-rose-500 mb-6 text-sm font-semibold"
                placeholder="Contraseña"
              />
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowAdminPrompt(false)} className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 font-medium text-sm">Cancelar</button>
                <button 
                  onClick={async () => {
                    try {
                      await login(adminUsername, adminPassword);
                      setShowAdminPrompt(false);
                      setAdminPassword('');
                      navigate('/dashboard');
                    } catch (err) {
                      toast.error('Credenciales incorrectas');
                    }
                  }} 
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 font-medium text-sm"
                >
                  Acceder
                </button>
              </div>
            </div>
          </div>
        )}
        {showCierre && (
          <CierreCajaModal 
            key="cierre-modal"
            session={sessionToArqueo || currentSession} 
            onClose={() => {
              setShowCierre(false);
              setSessionToArqueo(null);
              focusSearch();
            }} 
            onConfirm={async (data) => {
              try {
                const metadata = {
                  bills: data.bills,
                  posnetDeclarations: data.posnetDeclarations,
                  closedBy: user?.fullName || 'Administrador'
                };
                const serializedNotes = (data.notes || '') + " [METADATA]" + JSON.stringify(metadata);
                
                const posnetDeclaredSum = Object.values(data.posnetDeclarations || {}).reduce((a: any, b: any) => a + Number(b), 0);
                const closingAmountCounted = data.cashToWithdraw; // Only send physical cash for backend difference calculation

                if (sessionToArqueo) {
                  await api.post(`/cash/${sessionToArqueo.id}/arqueo`, {
                    closingAmountCounted,
                    closingNotes: serializedNotes,
                    posnetDeclarations: data.posnetDeclarations
                  });
                  toast.success('✅ Arqueo completado correctamente');
                  setSessionToArqueo(null);
                  loadPendingArqueos();
                } else {
                  await api.post(`/cash/${currentSession.id}/close`, {
                    closingAmountCounted,
                    closingNotes: serializedNotes,
                    posnetDeclarations: data.posnetDeclarations
                  });
                  toast.success('Caja cerrada correctamente');
                  setCurrentSession(null);
                  setShowAbrirCaja(true);
                }

                if (generateZAfterArqueo) {
                  setGenerateZAfterArqueo(false);
                  setTimeout(async () => {
                    setShowCierre(false);
                    try {
                      const res = await api.post('/cash/z-report/generate');
                      setZReportData(res.data);
                    } catch (err: any) {
                      toast.error('Error al generar cierre Z');
                    }
                  }, 2500);
                }
              } catch (err: any) {
                toast.error(err.response?.data?.message || 'Error al completar arqueo');
                throw err;
              }
            }} 
          />
        )}
        {zReportData && (
          <CierreDiaModal
            zReport={zReportData}
            onClose={() => setZReportData(null)}
          />
        )}
        {showHistorial && <HistorialModal key="historial-modal" sessionId={currentSession?.id} onClose={() => { setShowHistorial(false); focusSearch(); }} />}
        {showCajaInfo && (
          <CajaInfoModal 
            key="caja-info-modal" 
            sessionId={currentSession?.id} 
            terminalName={terminalName}
            onClose={() => { setShowCajaInfo(false); focusSearch(); }} 
            onTriggerClose={() => {
              setShowCajaInfo(false);
              if (currentSession) {
                handleInstantClose(currentSession.id, false);
              }
            }}
            onTriggerCloseAndZ={() => {
              setShowCajaInfo(false);
              if (currentSession) {
                handleInstantClose(currentSession.id, true);
              }
            }}
          />
        )}
        {showAbrirCaja && (
          <AbrirCajaModal 
            key="abrir-caja-modal" 
            terminalName={terminalName} 
            onClose={() => { setShowAbrirCaja(false); focusSearch(); }} 
            onSuccess={(session) => {
              setCurrentSession(session);
              setShowAbrirCaja(false);
              loadProducts();
            }} 
          />
        )}
        {showProfile && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowProfile(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-400 flex flex-col p-6 space-y-4 font-sans text-slate-800"
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <User className="w-5 h-5 text-rose-600" /> Cambiar Contraseña
                </h3>
                <button onClick={() => setShowProfile(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Contraseña Actual</label>
                  <div className="relative">
                    <input 
                      type={showPasswords ? "text" : "password"} 
                      value={profileOldPassword} 
                      onChange={(e) => setProfileOldPassword(e.target.value)} 
                      className="w-full bg-slate-50 border border-slate-205 rounded-xl pl-4 pr-10 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                      placeholder="Ingresá tu contraseña actual..." 
                      required
                    />
                    <button type="button" onClick={() => setShowPasswords(!showPasswords)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600">
                      {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Nueva Contraseña</label>
                  <div className="relative">
                    <input 
                      type={showPasswords ? "text" : "password"} 
                      value={profileNewPassword} 
                      onChange={(e) => setProfileNewPassword(e.target.value)} 
                      className="w-full bg-slate-50 border border-slate-205 rounded-xl pl-4 pr-10 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                      placeholder="Nueva contraseña numérica..." 
                      required
                    />
                    <Key className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  </div>
                  <p className="text-[9px] text-slate-450 mt-1">Por razones de seguridad, la contraseña debe ser puramente numérica.</p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="submit" 
                    disabled={isSavingProfile}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="w-4.5 h-4.5" /> {isSavingProfile ? 'Guardando...' : 'Actualizar Datos'}
                  </button>
                  <button type="button" onClick={() => setShowProfile(false)} className="px-5 py-3.5 rounded-xl border border-slate-400 text-slate-700 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}

        {pricePromptProduct && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPricePromptProduct(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-400 flex flex-col p-6 space-y-4 font-sans text-slate-800"
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-rose-600" /> Precio Personalizado
                </h3>
                <button onClick={() => setPricePromptProduct(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-700">{pricePromptProduct.name}</p>
                <p className="text-[10px] text-slate-600">Ingrese el precio para este producto en esta venta.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Monto ($)</label>
                <div className="flex items-center bg-slate-50 border border-slate-400 rounded-xl focus-within:bg-white focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-500 transition-all shadow-inner overflow-hidden">
                  <span className="flex items-center justify-center w-12 h-full text-xl font-bold text-rose-500 border-r border-slate-400 select-none flex-shrink-0 py-3.5">$</span>
                  <input 
                    type="number" 
                    step="0.01"
                    min="0"
                    autoFocus
                    value={promptPriceValue} 
                    onChange={(e) => setPromptPriceValue(e.target.value)} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const price = parseFloat(promptPriceValue);
                        if (!isNaN(price) && price >= 0) {
                          addToCart(pricePromptProduct, price);
                          playBeep();
                          setPricePromptProduct(null);
                          setTimeout(() => searchRef.current?.focus(), 50);
                        }
                      }
                    }}
                    className="flex-1 bg-transparent px-4 py-3.5 text-2xl font-bold text-slate-800 outline-none" 
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => {
                    const price = parseFloat(promptPriceValue);
                    if (!isNaN(price) && price >= 0) {
                      addToCart(pricePromptProduct, price);
                      playBeep();
                      setPricePromptProduct(null);
                      setTimeout(() => searchRef.current?.focus(), 50);
                    }
                  }}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  <Check className="w-4.5 h-4.5" /> Agregar al Carrito
                </button>
                <button onClick={() => setPricePromptProduct(null)} className="px-5 py-3.5 rounded-xl border border-slate-400 text-slate-700 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
