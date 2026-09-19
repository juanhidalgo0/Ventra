import { useState, useEffect, useRef, useTransition, useMemo } from 'react';
import { useAutoTour } from '../common/tour/GuidedTour';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { usePOSStore } from '../../stores/posStore';
import { useAuthStore } from '../../stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { getClientId } from '../../utils/clientId';
import CategoryPickerModal from './CategoryPickerModal';
import toast from 'react-hot-toast';
import { Search, X, Minus, Plus, ShoppingCart, CreditCard, Banknote, Smartphone, Shuffle, Check, CheckCircle2, Package, RefreshCw, CornerDownLeft, CornerUpLeft, Receipt, Truck, Monitor, History, LayoutDashboard, Tag, LogOut, Wallet, Lock, Unlock, Settings, Key, DollarSign, Server, User, Eye, EyeOff, Moon, Sun, Grid, List, Menu, Sparkles, Star, Calculator, Trash2, PauseCircle, AlertTriangle, Clock, Printer, FileText, Maximize2, LayoutGrid, Zap , Vault, HandCoins, ReceiptText, TrendingDown, ClipboardList, Boxes } from 'lucide-react';
import { GoDeliveryLogo } from '../auth/ConnectionScreen';
import QRCode from 'qrcode';
import GastosModal from './GastosModal';
import ProveedoresModal from './ProveedoresModal';
import PaymentModal from './PaymentModal';
import CierreCajaModal from './CierreCajaModal';
import QuickSaleIcon from './QuickSaleIcon';
import { MangoLogo } from '../common/MangoLogo';
import QuickSaleModal, { buildQuickSaleProduct, QUICK_SALE_PRODUCT_ID } from './QuickSaleModal';
import ScrollRow from '../common/ScrollRow';
import { shortcutsLocked } from '../../utils/shortcutLock';
import HistorialModal from './HistorialModal';
import CierreDiaModal from '../cash-register/CierreDiaModal';
import CajaInfoModal from './CajaInfoModal';
import AbrirCajaModal from './AbrirCajaModal';
import CobroCtaCteModal from './CobroCtaCteModal';
import CalculatorModal from './CalculatorModal';
import CreateQuoteModal from './CreateQuoteModal';
import QuotesListModal from './QuotesListModal';
import AcopioModal from './AcopioModal';
import SubstitutesModal from './SubstitutesModal';
import { toggleFullscreen } from '../../utils/fullscreen';

interface Product { 
  id: string; 
  name: string; 
  barcode?: string; 
  salePrice: number; 
  stock: number; 
  category?: { id: string; name: string; color: string }; 
  isFavorite: boolean; 
  imageUrl?: string; 
  unlimitedStock?: boolean;
  location?: string;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  unit?: string;
  pieceSize?: number;
}
interface Category { id: string; name: string; color: string; _count?: { products: number }; }

// Beep sound for scanner success
const playBeep = () => { try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 1200; g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + 0.08); } catch {} };

// Distinct error alarm for scanner failure
const playErrorBeep = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(180, ctx.currentTime);
    osc1.frequency.linearRampToValueAtTime(110, ctx.currentTime + 0.25);

    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(220, ctx.currentTime);
    osc2.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.25);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.25);
    osc2.stop(ctx.currentTime + 0.25);
  } catch {}
};

export default function POSScreen() {
  const { cart, addToCart, removeFromCart, updateQuantity, clearCart, getTotal, getDiscounts, getFinalTotal, getItemCount, setPromotions, promotions, getAppliedPromotions, addPromoToCart, applySuggestedPromo, getCartItemsWithDiscounts, heldCarts, holdCart, resumeCart, deleteHeldCart, lastSale, setLastSale } = usePOSStore();
  const { discountsMap } = getCartItemsWithDiscounts();
  const { user, logout, login } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  // Código que no está en el inventario: el admin puede crearlo al toque, con los
  // datos autocompletados desde la base de productos (ver ProductModal).
  const notifyUnknownCode = (code: string) => {
    if (!isAdmin) {
      toast.error(`⚠️ Código no registrado: ${code}`, { id: code });
      return;
    }
    toast(
      (t) => (
        <span className="flex items-center gap-3">
          <span>Código no registrado: <b className="font-mono">{code}</b></span>
          <button
            onClick={() => { toast.dismiss(t.id); navigate(`/inventory?nuevo=${encodeURIComponent(code)}`); }}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
          >
            Crear producto
          </button>
        </span>
      ),
      { id: code, icon: '⚠️', duration: 7000 },
    );
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const cachedProducts = usePOSStore(state => state.products);
  const setCachedProducts = usePOSStore(state => state.setProducts);
  const cachedCategories = usePOSStore(state => state.categories);
  const setCachedCategories = usePOSStore(state => state.setCategories);
  const cachedPromotions = usePOSStore(state => state.promotions);
  const setCachedPromotions = usePOSStore(state => state.setPromotions);

  // O(1) Instant Barcode and SKU Hash Map Lookup for Scanner & Quick-add
  const barcodeMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of cachedProducts) {
      if (p.barcode) map.set(p.barcode.toUpperCase(), p);
      if (p.sku) map.set(p.sku.toUpperCase(), p);
      if (p.additionalBarcodes && Array.isArray(p.additionalBarcodes)) {
        for (const b of p.additionalBarcodes) {
          if (b?.barcode) map.set(b.barcode.toUpperCase(), p);
        }
      }
    }
    return map;
  }, [cachedProducts]);

  const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);
  const [isPending, startTransition] = useTransition();
  const [perfMode] = useState(() => localStorage.getItem('performance_mode') === 'true');
  
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [generateZAfterArqueo, setGenerateZAfterArqueo] = useState(false);
  const [zReportData, setZReportData] = useState<any>(null);
  const [adminUsername, setAdminUsername] = useState('ADMIN');
  const [adminPassword, setAdminPassword] = useState('');
  const [showHeldCartsModal, setShowHeldCartsModal] = useState(false);
  const [heldCartIndex, setHeldCartIndex] = useState(0);
  const [showHoldCartInputModal, setShowHoldCartInputModal] = useState(false);
  const [holdCartClientName, setHoldCartClientName] = useState('');
  const [comboVariantModalPromo, setComboVariantModalPromo] = useState<any | null>(null);
  const [selectedComboVariants, setSelectedComboVariants] = useState<{ [groupId: string]: string }>({});

  const [activeMobileTab, setActiveMobileTab] = useState<'products' | 'cart'>('products');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);

  // Real-time clock for POS header (HH:MM without seconds)
  const [currentTime, setCurrentTime] = useState<string>(() => 
    new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  );

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const categories = cachedCategories;
  // Con muchos rubros la tira horizontal no sirve: quedan a mano los más vendidos y el resto en un panel con buscador
  const [topCategoryIds, setTopCategoryIds] = useState<string[]>([]);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  useEffect(() => {
    api.get('/categories/top', { params: { days: 30, limit: 10 } })
      .then(({ data }) => setTopCategoryIds(data.map((t: any) => t.categoryId)))
      .catch(() => {});
  }, []);
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
  // Sin promociones activas el botón "Promos" no tiene sentido y ocupa lugar
  const hasActivePromos = useMemo(() => (cachedPromotions || []).some((p: any) => p.isActive), [cachedPromotions]);
  useEffect(() => { if (!hasActivePromos && showPromosOnly) setShowPromosOnly(false); }, [hasActivePromos, showPromosOnly]);
  const usableCategories = useMemo(
    () => categories.filter((cat: any) => cat.name.toLowerCase() !== 'varios' && ((cat._count?.products ?? 0) > 0 || cachedProducts.some(p => p.categoryId === cat.id))),
    [categories, cachedProducts],
  );
  const visibleCategories = useMemo(() => {
    if (usableCategories.length <= 14) return usableCategories;
    const byId = new Map(usableCategories.map((c: any) => [c.id, c]));
    const chosen = topCategoryIds.map(id => byId.get(id)).filter(Boolean).slice(0, 8);
    // Si no hay ventas todavía, se muestran los rubros con más productos
    if (chosen.length === 0) {
      chosen.push(...[...usableCategories].sort((a: any, b: any) => (b._count?.products ?? 0) - (a._count?.products ?? 0)).slice(0, 8));
    }
    const selected = selectedCategory ? byId.get(selectedCategory) : null;
    if (selected && !chosen.some((c: any) => c.id === selected.id)) chosen.unshift(selected);
    return chosen;
  }, [usableCategories, topCategoryIds, selectedCategory]);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [pendingArqueos, setPendingArqueos] = useState<any[]>([]);
  const [sessionToArqueo, setSessionToArqueo] = useState<any | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [showGastos, setShowGastos] = useState(false);
  const [showProveedores, setShowProveedores] = useState(false);
  const [showCierre, setShowCierre] = useState(false);
  const [showQuickSale, setShowQuickSale] = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [showCajaInfo, setShowCajaInfo] = useState(false);
  const [showAbrirCaja, setShowAbrirCaja] = useState(false);
  const [showCobroCtaCte, setShowCobroCtaCte] = useState(false);
  const [showCreateQuote, setShowCreateQuote] = useState(false);
  const [showQuotesList, setShowQuotesList] = useState(false);
  const [showAcopios, setShowAcopios] = useState(false);
  const [substituteProduct, setSubstituteProduct] = useState<any | null>(null);
  const isHardwareStore = localStorage.getItem('business_type') === 'FERRETERIA';
  const [posClients, setPosClients] = useState<any[]>([]);
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const selectedClient = usePOSStore(state => state.selectedClient);
  const setSelectedClient = usePOSStore(state => state.setSelectedClient);
  const [terminalName, setTerminalName] = useState('Terminal 1');
  const terminalNameRef = useRef('Terminal 1');
  const [productViewMode, setProductViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('pos_product_view_mode') as 'grid' | 'list') || 'grid';
  });
  const [selectedProductIndex, setSelectedProductIndex] = useState<number>(-1);
  const [isCartBusy, setIsCartBusy] = useState(false);
  const [showQuickBar, setShowQuickBar] = useState(() => {
    return localStorage.getItem('pos_show_quick_bar') !== 'false';
  });
  const [heldCartToDelete, setHeldCartToDelete] = useState<{ id: string; clientName: string } | null>(null);
  const [activePaymentSurcharge, setActivePaymentSurcharge] = useState(0);

  const quickCounterProducts = useMemo(() => {
    return cachedProducts.filter((p: any) => 
      p.isFavorite || 
      p.category?.name?.toLowerCase() === 'mostrador' || 
      p.category?.name?.toLowerCase() === 'varios' ||
      p.id === 'VIRTUAL_LOAD_1' ||
      p.id === 'VIRTUAL_LOAD_2'
    ).slice(0, 10);
  }, [cachedProducts]);

  useEffect(() => {
    setSelectedProductIndex(-1);
  }, [searchQuery, selectedCategory, showPromosOnly]);

  useEffect(() => {
    if (selectedProductIndex >= 0) {
      const el = document.getElementById(`product-btn-${selectedProductIndex}`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedProductIndex]);

  useEffect(() => {
    terminalNameRef.current = terminalName;
  }, [terminalName]);

  useEffect(() => {
    api.get('/clients').then(res => setPosClients(res.data || [])).catch(() => {});
  }, []);
  const [isOpeningCaja, setIsOpeningCaja] = useState(false);
  const [isLoading, setIsLoading] = useState(() => {
    return usePOSStore.getState().products.length === 0;
  });
  useAutoTour('pos', !isLoading);

  // Profile Edit States
  const [showProfile, setShowProfile] = useState(false);
  const [profileOldPassword, setProfileOldPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  // Return / Devolución States
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnSearchQuery, setReturnSearchQuery] = useState('');
  const [returnQty, setReturnQty] = useState(1);
  const [returnProductSelected, setReturnProductSelected] = useState<any | null>(null);

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
  const [reprintSale, setReprintSale] = useState<any | null>(null);

  const handleReprintLastTicket = () => {
    if (!lastSale) {
      toast('No hay ninguna venta reciente para reimprimir', { icon: 'ℹ️' });
      return;
    }
    setReprintSale(lastSale);
    toast.success(`🖨️ Imprimiendo Ticket #${lastSale.saleNumber || ''}`);
    setTimeout(() => {
      window.print();
    }, 150);
  };

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

    // Periodically check for active session and reload products if boot was offline (safety poll)
    const sessionInterval = setInterval(() => {
      loadCurrentSession();
      loadPendingArqueos();
      if (usePOSStore.getState().products.length === 0) {
        loadProducts();
        loadCategories();
        loadPromotions();
      }
    }, 20000);
    return () => clearInterval(sessionInterval);
  }, [user]);

  // Price prompt states for custom price products
  const [pricePromptProduct, setPricePromptProduct] = useState<any | null>(null);
  const [promptPriceValue, setPromptPriceValue] = useState<string>('');
  const [showVirtualPrompt, setShowVirtualPrompt] = useState(false);
  const [virtualPromptValue, setVirtualPromptValue] = useState('');

  // Quantity prompt states for Shift-key modifiers
  const [qtyPromptProduct, setQtyPromptProduct] = useState<any | null>(null);
  const [promptQtyValue, setPromptQtyValue] = useState<string>('');

  const [showCellularModal, setShowCellularModal] = useState(false);
  const [cellularQrCodeUrl, setCellularQrCodeUrl] = useState('');
  const [serverIpValue, setServerIpValue] = useState('');
  const [serverTunnelUrl, setServerTunnelUrl] = useState('');

  const handleOpenCellularModal = async () => {
    try {
      const { data } = await api.get('/cash/server-ip');
      const activePort = sessionStorage.getItem('active_backend_port') || '3001';
      const port = window.location.port ? window.location.port : activePort;
      const baseUrl = `http://${data.ip}:${port}`;
      const token = localStorage.getItem('accessToken') || '';
      const userObj = localStorage.getItem('user') || '';
      const serverUrl = `${baseUrl}/?token=${token}&user=${encodeURIComponent(userObj)}`;
      const qrUrl = await QRCode.toDataURL(serverUrl);
      setCellularQrCodeUrl(qrUrl);
      setServerIpValue(data.ip);
      setServerTunnelUrl('');
      setShowCellularModal(true);
    } catch (err) {
      toast.error('No se pudo obtener la IP del servidor');
    }
  };

  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<'catalog' | 'cart'>('catalog');

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [suggestedPromo, setSuggestedPromo] = useState<any | null>(null);
  const [promoProgress, setPromoProgress] = useState<number>(100);

  useEffect(() => {
    if (!suggestedPromo) {
      setPromoProgress(100);
      return;
    }
    setPromoProgress(100);
    const duration = 10000;
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.max(0, 100 - (elapsed / duration) * 100);
      setPromoProgress(pct);
      if (elapsed >= duration) {
        clearInterval(interval);
        setSuggestedPromo(null);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [suggestedPromo]);

  const checkPromoSuggestion = (product: any) => {
    if (!product) return;

    // Small timeout ensures Zustand has finished synchronous cart commits across all callers
    setTimeout(() => {
      const currentCart = usePOSStore.getState().cart;
      const allPromotions = usePOSStore.getState().promotions || [];
      const allProducts = usePOSStore.getState().products || [];

      const candidatePromos = allPromotions.filter(promo => 
        promo.isActive && 
        promo.products?.some((p: any) => String(p.productId) === String(product.id))
      );

      for (const promo of candidatePromos) {
        if (!promo.products || promo.products.length === 0) continue;

        if (promo.type === 'FIXED_COMBO') {
          const groupsMap = new Map<string, { groupId: string; quantity: number; productIds: string[] }>();
          promo.products.forEach((pp: any, idx: number) => {
            const gId = pp.groupId || `single_${pp.productId}_${idx}`;
            if (!groupsMap.has(gId)) {
              groupsMap.set(gId, {
                groupId: gId,
                quantity: pp.quantity || 1,
                productIds: []
              });
            }
            groupsMap.get(gId)!.productIds.push(String(pp.productId));
          });

          const groups = Array.from(groupsMap.values());
          let matchedGroups = 0;
          const missingItems: { product: any; quantity: number }[] = [];

          for (const g of groups) {
            // Check how many items of this group are in the current cart as loose items
            const inCartQty = g.productIds.reduce((sum, pid) => {
              const item = currentCart.find(ci => !ci.isPromo && !ci.isReturn && String(ci.productId) === String(pid));
              return sum + (item ? item.quantity : 0);
            }, 0);

            if (inCartQty >= g.quantity) {
              matchedGroups++;
            } else {
              if (inCartQty > 0) matchedGroups++;
              const needed = g.quantity - inCartQty;
              
              // Choose product to suggest for this missing group
              let suggestedProdId = g.productIds.find(pid => String(pid) === String(product.id)) || g.productIds[0];
              const fullProduct = allProducts.find(p => String(p.id) === String(suggestedProdId)) || 
                cachedProducts.find(p => String(p.id) === String(suggestedProdId)) || 
                promo.products.find((p: any) => String(p.productId) === String(suggestedProdId))?.product;

              if (fullProduct) {
                missingItems.push({
                  product: fullProduct,
                  quantity: needed
                });
              }
            }
          }

          // Only suggest if at least one component is in cart AND some components are missing
          if (matchedGroups > 0 && missingItems.length > 0 && missingItems.length < groups.length) {
            setSuggestedPromo({
              promo,
              missingItems
            });
            break;
          }
        } else {
          let missingItems: { product: any; quantity: number }[] = [];
          let inCartCount = 0;

          for (const pp of promo.products) {
            const cartItem = currentCart.find(item => String(item.productId) === String(pp.productId) && !item.isPromo);
            const inCartQty = cartItem ? cartItem.quantity : 0;
            if (inCartQty > 0) inCartCount++;
            if (inCartQty < pp.quantity) {
              const fullProduct = allProducts.find(p => String(p.id) === String(pp.productId)) || 
                cachedProducts.find(p => String(p.id) === String(pp.productId)) || 
                pp.product;
              if (fullProduct) {
                missingItems.push({
                  product: fullProduct,
                  quantity: pp.quantity - inCartQty
                });
              }
            }
          }

          if (inCartCount > 0 && missingItems.length > 0) {
            setSuggestedPromo({
              promo,
              missingItems
            });
            break;
          }
        }
      }
    }, 25);
  };

  const handleProductAdd = (product: any, e?: React.MouseEvent, customQty?: number) => {
    if (isCartBusy) return;
    let qty = customQty !== undefined ? customQty : 1;
    if (customQty === undefined && searchQuery.includes('*')) {
      const match = searchQuery.trim().match(/^(\d+(?:[.,]\d+)?)\*$/);
      if (match) {
        qty = parseFloat(match[1].replace(',', '.')) || 1;
      }
    }
    if (product.allowCustomPrice) {
      setPricePromptProduct(product);
      setPromptPriceValue('');
      setSearchQuery('');
    } else if (e?.shiftKey) {
      setQtyPromptProduct(product);
      setPromptQtyValue('');
      setSearchQuery('');
    } else {
      addToCart(product, undefined, qty);
      setSearchQuery('');
      playBeep();
      setSelectedProductIndex(-1);
      if (e?.currentTarget) {
        (e.currentTarget as HTMLElement).blur();
      }
      focusSearch();
      checkPromoSuggestion(product);
    }
  };

  // Offline sales background synchronizer
  useEffect(() => {
    const syncOfflineSales = async () => {
      const rawQueue = localStorage.getItem('pos_offline_sales_queue');
      if (!rawQueue) return;
      try {
        const queue = JSON.parse(rawQueue);
        if (!Array.isArray(queue) || queue.length === 0) return;

        const remaining: any[] = [];
        let syncedCount = 0;

        for (const item of queue) {
          try {
            await api.post('/sales', item);
            syncedCount++;
          } catch (e: any) {
            if (!e.response) {
              // Still offline, keep in queue
              remaining.push(item);
            }
          }
        }

        if (remaining.length > 0) {
          localStorage.setItem('pos_offline_sales_queue', JSON.stringify(remaining));
        } else {
          localStorage.removeItem('pos_offline_sales_queue');
        }

        if (syncedCount > 0) {
          toast.success(`✅ ${syncedCount} venta(s) offline sincronizada(s) con el servidor`);
        }
      } catch {}
    };

    window.addEventListener('online', syncOfflineSales);
    const interval = setInterval(syncOfflineSales, 20000);
    syncOfflineSales();

    return () => {
      window.removeEventListener('online', syncOfflineSales);
      clearInterval(interval);
    };
  }, []);

  // Ventas en espera: flechas para moverse, Enter reanuda, Supr elimina, Esc cierra.
  // Se escucha en captura para que Enter no dispare el cobro del POS.
  useEffect(() => {
    if (!showHeldCartsModal || heldCartToDelete) return;
    const onKey = (e: KeyboardEvent) => {
      const keys = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Delete'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const count = heldCarts.length;
      if (e.key === 'Escape') { setShowHeldCartsModal(false); focusSearch(); return; }
      if (count === 0) return;
      if (e.key === 'ArrowDown') setHeldCartIndex((i) => (i + 1) % count);
      else if (e.key === 'ArrowUp') setHeldCartIndex((i) => (i - 1 + count) % count);
      else {
        const target = heldCarts[Math.min(heldCartIndex, count - 1)];
        if (!target) return;
        if (e.key === 'Enter') {
          resumeCart(target.id);
          setShowHeldCartsModal(false);
          focusSearch();
        } else {
          setHeldCartToDelete({ id: target.id, clientName: target.clientName });
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showHeldCartsModal, heldCartToDelete, heldCarts, heldCartIndex, resumeCart]);

  useEffect(() => {
    if (heldCartIndex >= heldCarts.length && heldCarts.length > 0) setHeldCartIndex(heldCarts.length - 1);
  }, [heldCarts.length, heldCartIndex]);

  useEffect(() => {
    if (!showHeldCartsModal) return;
    document.querySelector(`[data-held-index="${heldCartIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [showHeldCartsModal, heldCartIndex]);

  // Keyboard shortcuts and global background barcode scanner
  useEffect(() => {
    // 1. Regular Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Con la ventana de cobro abierta solo responde esa ventana (Esc la cierra).
      if ((showPayment || shortcutsLocked()) && e.key !== 'Escape') return;
      // Hotkeys are ordered by how often each action is used mid-shift (most
      // frequent on the easiest-to-reach keys), NOT by menu position. F11 is
      // reserved exclusively for fullscreen — never repurpose it.
      if (e.key === 'F1') {
        e.preventDefault();
        if (currentSession) setShowQuickSale(true);
        else toast.error('No hay caja abierta');
      }
      if (e.key === 'F2' && e.shiftKey) {
        e.preventDefault();
        setHeldCartIndex(0);
        setShowHeldCartsModal(true);
        return;
      }
      if (e.key === 'Delete' && e.shiftKey) {
        e.preventDefault();
        if (cart.length > 0) {
          clearCart();
          toast.success('Ticket vaciado');
          focusSearch();
        }
        return;
      }
      if (e.key === 'F2') {
        e.preventDefault();
        if (cart.length > 0) {
          setHoldCartClientName('');
          setShowHoldCartInputModal(true);
        } else {
          toast('No hay productos en el ticket actual para pausar', { icon: 'ℹ️' });
        }
      }
      // F3 (calculadora) se maneja en MainLayout para que ande en toda la app
      if (e.key === 'F4') {
        e.preventDefault();
        handleReprintLastTicket();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        if (currentSession) setShowCobroCtaCte(true);
        else toast.error('No hay caja abierta');
      }
      if (e.key === 'F6') {
        e.preventDefault();
        setShowHistorial(true);
      }
      if (e.key === 'F7') {
        e.preventDefault();
        if (currentSession) setShowGastos(true);
        else toast.error('No hay caja abierta');
      }
      if (e.key === 'F8') {
        e.preventDefault();
        if (currentSession) setShowCajaInfo(true);
        else setShowAbrirCaja(true);
      }
      if (e.key === 'F9') {
        e.preventDefault();
        setShowProveedores(true);
      }
      if (e.key === 'F10') {
        e.preventDefault();
        setProfileOldPassword('');
        setProfileNewPassword('');
        setShowPasswords(false);
        setShowProfile(true);
      }
      // F11 (fullscreen) is handled globally in App.tsx — not here, to avoid
      // double-toggling when both listeners fire on the same keydown.
      if (e.key === 'F12') {
        e.preventDefault();
        if (isAdmin) navigate('/dashboard');
        else setShowAdminPrompt(true);
      }

      const activeElement = document.activeElement;
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';

      // '+' or '-' keys to modify quantity of the last added item when not typing in an input
      if (!isInput && cart.length > 0) {
        const lastItem = cart[cart.length - 1];
        if (e.key === '+' || e.code === 'NumpadAdd') {
          e.preventDefault();
          updateQuantity(lastItem.cartKey, lastItem.quantity + 1);
        } else if (e.key === '-' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          updateQuantity(lastItem.cartKey, lastItem.quantity - 1);
        }
      }

      if (e.key === 'Escape') { 
        setQtyPromptProduct(null);
        setShowQuickSale(false);
        setShowPayment(false); 
        setShowGastos(false); 
        setShowProveedores(false); 
        setShowCierre(false);
        setShowHistorial(false);
        setShowCajaInfo(false);
        setShowAbrirCaja(false);
        setShowCobroCtaCte(false);
        setShowHeldCartsModal(false);
        setShowCalculator(false);
        setShowCellularModal(false);
        setShowProfile(false);
        setShowHoldCartInputModal(false);
        setSuggestedPromo(null);
        setSearchQuery(''); 
        focusSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 2. Intelligent High-Speed Barcode Reader Listener (Capture Phase)
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      // If any modal/overlay is open, completely bypass global scanner and let elements handle events natively
      if (showPayment || showGastos || showProveedores || showCierre || showHistorial || showCajaInfo || showAbrirCaja || showProfile || showCobroCtaCte || showQuickSale) {
        buffer = '';
        return;
      }

      const activeElement = document.activeElement;
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';

      // If the user is currently typing in an input (like the search bar or price modals),
      // let the browser handle keypresses natively. Do not intercept or split barcode chars.
      if (isInput) {
        buffer = '';
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastKeyTime;
      lastKeyTime = now;

      // A hardware scanner emits sequential keystrokes in extremely rapid intervals (<50ms).
      const isScannerFast = timeDiff <= 50;

      // Extract character from e.code to bypass Shift modifiers and keyboard layouts
      let char = '';
      if (e.code.startsWith('Digit')) {
        char = e.code.slice(5); // "0" - "9"
      } else if (e.code.startsWith('Key')) {
        char = e.code.slice(3).toLowerCase(); // "a" - "z"
      }

      if (char && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isScannerFast) {
          e.preventDefault();
          e.stopPropagation();
          buffer += char;
          return;
        } else {
          // Slow keypress (manual) when no input is focused. Start the buffer.
          buffer = char;
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
          
          setIsCartBusy(true);
          try {
            // First check if EAN/code matches a combo in promotions
            const matchingPromo = usePOSStore.getState().promotions.find(p => p.isActive && p.code && p.code.toLowerCase() === scannedCode.toLowerCase());
            if (matchingPromo) {
              addPromoToCart(matchingPromo, cachedProducts);
              playBeep();
              focusConfirmBtn();
              return;
            }

            // Fast memory lookup: 0ms scan resolution via O(1) Hash Map
            const cachedMatch = barcodeMap.get(scannedCode.toUpperCase());

            let data = cachedMatch;
            if (!data) {
              const res = await api.get(`/products/barcode/${scannedCode}`);
              data = res.data;
            }

            if (data.allowCustomPrice) {
              setPricePromptProduct(data);
              setPromptPriceValue('');
            } else if (e.shiftKey) {
              setQtyPromptProduct(data);
              setPromptQtyValue('');
            } else {
              addToCart(data);
              playBeep();
              setTimeout(() => searchRef.current?.focus(), 50);
              checkPromoSuggestion(data);
            }
          } catch {
            notifyUnknownCode(scannedCode);
            setTimeout(() => searchRef.current?.focus(), 50);
          } finally {
            setIsCartBusy(false);
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
  }, [cart.length, currentSession, addToCart, cachedProducts, promotions, showPayment, showGastos, showProveedores, showCierre, showHistorial, showCajaInfo, showAbrirCaja, showProfile, showCobroCtaCte, isCartBusy, showQuickSale]);

  // Removed refocus of Confirm button on cart change to prevent stealing focus from barcode search input

  // Refocus Confirm button when any modal closes
  useEffect(() => {
    if (!showPayment && !showGastos && !showProveedores && !showCierre && !showHistorial && !showCajaInfo && !showAbrirCaja && !showProfile && !showCobroCtaCte) {
      focusConfirmBtn();
    }
  }, [showPayment, showGastos, showProveedores, showCierre, showHistorial, showCajaInfo, showAbrirCaja, showProfile, showCobroCtaCte]);

  const loadProducts = async (force = false) => {
    if (!force && cachedProducts.length > 200) {
      setIsLoading(false);
      return;
    }
    try {
      // 1. Fetch ultra-lightweight POS catalog (all active products with fast fields)
      const res = await api.get('/products/pos-catalog');
      const rawList = res.data?.products || (Array.isArray(res.data) ? res.data : []);
      const processedProducts = rawList.map((p: any) => {
        const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
        const nameLower = (p.name || '').toLowerCase();
        const nameNorm = nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
        const skuLower = (p.sku || '').toLowerCase();
        const skuNorm = skuLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
        return {
          ...p,
          _searchToken: `${nameLower} ${nameNorm} ${skuLower} ${skuNorm} ${barcodeList.join(' ')}`.trim()
        };
      });
      processedProducts.sort((a: any, b: any) => {
        const aSales = a.salesCount ?? a._count?.saleItems ?? 0;
        const bSales = b.salesCount ?? b._count?.saleItems ?? 0;
        if (bSales !== aSales) return bSales - aSales;
        return (a.name || '').localeCompare(b.name || '');
      });
      setCachedProducts(processedProducts);
      usePOSStore.getState().setProducts(processedProducts);
    } catch {
      // Fallback to standard products endpoint
      try {
        const { data } = await api.get('/products', { params: { take: 20000 } });
        const processed = data.map((p: any) => {
          const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
          const nameLower = (p.name || '').toLowerCase();
          const nameNorm = nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
          const skuLower = (p.sku || '').toLowerCase();
          const skuNorm = skuLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
          return {
            ...p,
            _searchToken: `${nameLower} ${nameNorm} ${skuLower} ${skuNorm} ${barcodeList.join(' ')}`.trim()
          };
        });
        processed.sort((a: any, b: any) => {
          const aSales = a.salesCount ?? a._count?.saleItems ?? 0;
          const bSales = b.salesCount ?? b._count?.saleItems ?? 0;
          if (bSales !== aSales) return bSales - aSales;
          return (a.name || '').localeCompare(b.name || '');
        });
        setCachedProducts(processed);
        usePOSStore.getState().setProducts(processed);
      } catch {}
    } finally { 
      setIsLoading(false); 
    }
  };

  const handleOpenCaja = async () => {
    setIsOpeningCaja(true);
    try {
      const { data } = await api.post('/cash/open', { terminalName, openingAmount: 0, openingNotes: '' });
      setCurrentSession(data);
      loadProducts(true);
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
          loadProducts(true);
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
      await api.post(`/cash/${sessionId}/close`, { clientId: getClientId() });
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
    let active = true;

    const fetchFilteredProducts = async () => {
      // If there's no search query and no category selected, just display the cached home products (already pre-sorted)
      if (!debouncedSearchQuery && !selectedCategory) {
        if (active) {
          const limit = perfMode ? 40 : 80;
          setDisplayedProducts(cachedProducts.slice(0, limit));
        }
        return;
      }

      // 1. Instant 0ms in-memory filtering
      if (cachedProducts.length > 0) {
        let localMatches = cachedProducts;
        if (selectedCategory) {
          localMatches = localMatches.filter((p: any) => p.categoryId === selectedCategory);
        }
        if (debouncedSearchQuery) {
          const rawTokens = debouncedSearchQuery.trim().split(/\s+/).filter(Boolean);
          localMatches = localMatches.filter((p: any) => 
            rawTokens.every(rawToken => {
              const lower = rawToken.toLowerCase();
              const norm = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
              return p._searchToken?.includes(lower) || p._searchToken?.includes(norm);
            })
          );

          // Sort matching products: MOST SOLD FIRST (user requested)
          const queryClean = debouncedSearchQuery.toLowerCase().trim();
          const queryNorm = queryClean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
          localMatches = [...localMatches].sort((a: any, b: any) => {
            const aSales = a.salesCount ?? a._count?.saleItems ?? 0;
            const bSales = b.salesCount ?? b._count?.saleItems ?? 0;
            if (bSales !== aSales) return bSales - aSales;

            const aName = (a.name || '').toLowerCase();
            const bName = (b.name || '').toLowerCase();
            const aNorm = aName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
            const bNorm = bName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
            const aStarts = aName.startsWith(queryClean) || aNorm.startsWith(queryNorm);
            const bStarts = bName.startsWith(queryClean) || bNorm.startsWith(queryNorm);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;

            return aName.localeCompare(bName);
          });
        }
        if (active) {
          const limit = perfMode ? 50 : 100;
          setDisplayedProducts(localMatches.slice(0, limit));
        }
        if (cachedProducts.length > 150) return;
      }

      // 2. Fallback to API if not in cache
      try {
        const { data } = await api.get('/products', {
          params: {
            search: debouncedSearchQuery || undefined,
            categoryId: selectedCategory || undefined,
            take: perfMode ? 40 : 80
          }
        });
        if (active) {
          const processed = data.map((p: any) => {
            const barcodeList = [p.barcode, ...(p.additionalBarcodes?.map((b: any) => b.barcode) || [])].filter(Boolean);
            const nameLower = (p.name || '').toLowerCase();
            const nameNorm = nameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
            const skuLower = (p.sku || '').toLowerCase();
            const skuNorm = skuLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
            return {
              ...p,
              _searchToken: `${nameLower} ${nameNorm} ${skuLower} ${skuNorm} ${barcodeList.join(' ')}`.trim()
            };
          });
          setDisplayedProducts(processed);
        }
      } catch (err) {
        console.error('Failed to search products:', err);
      }
    };

    fetchFilteredProducts();

    return () => {
      active = false;
    };
  }, [debouncedSearchQuery, selectedCategory, cachedProducts, perfMode]);

  const focusSearch = () => {
    const doFocus = () => {
      const el = searchRef.current || (document.getElementById('pos-search') as HTMLInputElement | null);
      if (el) {
        el.focus();
      }
    };
    doFocus();
    setTimeout(doFocus, 50);
    setTimeout(doFocus, 150);
    setTimeout(doFocus, 300);
  };

  useEffect(() => {
    if (!showPayment && !showGastos && !showProveedores && !showCierre && !showHistorial && !showCajaInfo && !showAbrirCaja && !showProfile && !showAdminPrompt && !showCobroCtaCte && !showHeldCartsModal && !showCalculator && !showCellularModal && !showHoldCartInputModal && !heldCartToDelete && !showQuickSale) {
      focusSearch();
    }
  }, [showPayment, showGastos, showProveedores, showCierre, showHistorial, showCajaInfo, showAbrirCaja, showProfile, showAdminPrompt, showCobroCtaCte, showHeldCartsModal, showCalculator, showCellularModal, showHoldCartInputModal, heldCartToDelete, showQuickSale]);

  // Refocus search when clicking any toast notification
  useEffect(() => {
    const handleToastClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[class*="toast"]') || target?.closest('[id*="toast"]') || target?.closest('.react-hot-toast')) {
        setTimeout(() => focusSearch(), 30);
      }
    };
    window.addEventListener('click', handleToastClick, true);
    return () => window.removeEventListener('click', handleToastClick, true);
  }, []);

  const [virtualType, setVirtualType] = useState<'1' | '2'>('1');

  const getGridColumns = () => {
    if (productViewMode === 'list') return 1;
    const el0 = document.getElementById('product-btn-0');
    const el1 = document.getElementById('product-btn-1');
    if (el0 && el1) {
      const r0 = el0.getBoundingClientRect();
      const r1 = el1.getBoundingClientRect();
      if (Math.abs(r0.top - r1.top) < 15) {
        let count = 1;
        while (true) {
          const elN = document.getElementById(`product-btn-${count}`);
          if (!elN) break;
          const rN = elN.getBoundingClientRect();
          if (Math.abs(rN.top - r0.top) > 15) break;
          count++;
        }
        return Math.max(1, count);
      }
    }
    const width = window.innerWidth;
    if (width >= 1280) return 4;
    if (width >= 1024) return 3;
    if (width >= 640) return 2;
    return 1;
  };

  // Combos/promos render before regular products in the grid and share the same
  // keyboard-navigable index space (0..comboCount-1 = combos, comboCount.. = products)
  // so arrow keys and Enter work on them exactly like regular product cards.
  const getVisibleCombos = () => (showPromosOnly || cleanSearchQuery !== '') ? filteredPromos : [];

  const handleBarcodeSearch = async (e: React.KeyboardEvent) => {
    const comboCount = getVisibleCombos().length;
    const totalNavigable = comboCount + displayedProducts.length;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedProductIndex(prev => {
        const next = prev + 1;
        const validNext = next < totalNavigable ? next : prev;
        document.getElementById(`product-btn-${validNext}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return validNext;
      });
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedProductIndex(prev => {
        const next = prev - 1;
        const validNext = next >= 0 ? next : 0;
        document.getElementById(`product-btn-${validNext}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return validNext;
      });
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedProductIndex(prev => {
        const cols = getGridColumns();
        if (prev === -1) {
          document.getElementById('product-btn-0')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return 0;
        }
        const next = prev + cols;
        const validNext = next < totalNavigable ? next : prev;
        document.getElementById(`product-btn-${validNext}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return validNext;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedProductIndex(prev => {
        const cols = getGridColumns();
        const next = prev - cols;
        if (next >= 0) {
          document.getElementById(`product-btn-${next}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return next;
        }
        return prev;
      });
      return;
    }
    if (e.key === 'Escape') {
      setSelectedProductIndex(-1);
      return;
    }
    if (e.key === 'Enter' && selectedProductIndex >= 0 && selectedProductIndex < comboCount) {
      e.preventDefault();
      handleAddPromoToCart(getVisibleCombos()[selectedProductIndex]);
      setSelectedProductIndex(-1);
      return;
    }
    if (e.key === 'Enter' && selectedProductIndex >= comboCount && selectedProductIndex < totalNavigable) {
      e.preventDefault();
      const product = displayedProducts[selectedProductIndex - comboCount];
      let multiplier = 1;
      const match = searchQuery.trim().match(/^(\d+(?:[.,]\d+)?)\*(.*)$/);
      if (match) {
        multiplier = parseFloat(match[1].replace(',', '.')) || 1;
      }
      handleProductAdd(product, e as any, multiplier);
      setSelectedProductIndex(-1);
      return;
    }

    if (e.code && e.code.startsWith('Digit') && e.shiftKey) {
      e.preventDefault();
      const digit = e.code.slice(5);
      setSearchQuery(prev => prev + digit);
      return;
    }
    if (e.code && e.code.startsWith('Numpad') && e.code.length === 7 && e.shiftKey) {
      e.preventDefault();
      const digit = e.code.slice(6);
      setSearchQuery(prev => prev + digit);
      return;
    }
    if (e.key === 'Enter') {
      const codeClean = searchQuery.trim().toUpperCase();
      const code1 = (localStorage.getItem('virtual1_code') || 'VIRTUAL1').trim().toUpperCase();
      const code2 = (localStorage.getItem('virtual2_code') || 'VIRTUAL2').trim().toUpperCase();

      if (codeClean === '1') {
        e.preventDefault();
        setSearchQuery('');
        setShowQuickSale(true);
        return;
      }

      if (codeClean === code1 || codeClean === code2) {
        e.preventDefault();
        setSearchQuery('');
        setVirtualType(codeClean === code1 ? '1' : '2');
        setShowVirtualPrompt(true);
        setVirtualPromptValue('');
        return;
      }
      
      if (!codeClean) {
        // If search is empty and cart has items, open payment modal
        if (cart.length > 0) {
          setShowPayment(true);
        }
        return;
      }

      let multiplier = 1;
      let targetCode = codeClean;
      let matchedProduct = null;
      let matchingPromo = null;

      // 1. First check if the entire query matches a promotion or a cached product directly
      matchingPromo = promotions.find(p => p.isActive && p.code && p.code.toUpperCase() === codeClean);
      if (!matchingPromo) {
        matchedProduct = barcodeMap.get(codeClean);
      }

      // 2. If no direct match in memory, check if it starts with a numeric prefix multiplier
      if (!matchingPromo && !matchedProduct) {
        // A. Check asterisk format first (just in case they still use it)
        const asteriskMatch = codeClean.match(/^(\d+(?:[.,]\d+)?)\*(.*)$/);
        if (asteriskMatch) {
          multiplier = parseFloat(asteriskMatch[1].replace(',', '.')) || 1;
          targetCode = asteriskMatch[2].trim();
        } else {
          // B. Check pure numeric prefix split (e.g. "67791234567890" where "7791234567890" is Alfajor)
          // Suffix must be at least 3 digits/characters for safety.
          for (let i = 1; i < codeClean.length; i++) {
            const prefix = codeClean.substring(0, i);
            const suffix = codeClean.substring(i);
            if (/^\d+$/.test(prefix) && suffix.length >= 3) {
              // Try matching suffix to promo
              const promoMatch = promotions.find(p => p.isActive && p.code && p.code.toUpperCase() === suffix);
              if (promoMatch) {
                matchingPromo = promoMatch;
                multiplier = parseInt(prefix) || 1;
                targetCode = suffix;
                break;
              }
              // Try matching suffix to cached product via O(1) map
              const prodMatch = barcodeMap.get(suffix);
              if (prodMatch) {
                matchedProduct = prodMatch;
                multiplier = parseInt(prefix) || 1;
                targetCode = suffix;
                break;
              }
            }
          }
        }
      }

      // If we found a promo, add it
      if (matchingPromo) {
        for (let k = 0; k < multiplier; k++) {
          addPromoToCart(matchingPromo, cachedProducts);
        }
        setSearchQuery('');
        playBeep();
        focusSearch();
        return;
      }

      // If we found a product, use it
      if (matchedProduct) {
        if (matchedProduct.allowCustomPrice) {
          setPricePromptProduct(matchedProduct);
          setPromptPriceValue('');
          setSearchQuery('');
        } else if (e.shiftKey) {
          setQtyPromptProduct(matchedProduct);
          setPromptQtyValue('');
          setSearchQuery('');
        } else {
          addToCart(matchedProduct, undefined, multiplier);
          setSearchQuery('');
          playBeep();
          focusSearch();
          checkPromoSuggestion(matchedProduct);
        }
        return;
      }

      // 3. Fallback: Query backend for targetCode/codeClean
      setIsCartBusy(true);
      try {
        const queryToUse = targetCode || codeClean;
        let finalData = null;
        try {
          const { data } = await api.get(`/products/barcode/${queryToUse}`);
          finalData = data;
        } catch {
          // If queryToUse failed, try the full codeClean just in case
          if (queryToUse !== codeClean) {
            const { data } = await api.get(`/products/barcode/${codeClean}`);
            finalData = data;
            multiplier = 1; // reset multiplier if direct match found
          }
        }

        if (!finalData) {
          throw new Error('Not found');
        }

        if (finalData.allowCustomPrice) {
          setPricePromptProduct(finalData);
          setPromptPriceValue('');
          setSearchQuery('');
        } else if (e.shiftKey) {
          setQtyPromptProduct(finalData);
          setPromptQtyValue('');
          setSearchQuery('');
        } else {
          addToCart(finalData, undefined, multiplier);
          setSearchQuery('');
          playBeep();
          focusSearch();
          checkPromoSuggestion(finalData);
        }
      } catch {
        playErrorBeep();
        notifyUnknownCode(codeClean);
        setSearchQuery('');
        focusSearch();
      } finally {
        setIsCartBusy(false);
      }
    }
  };

  const handleAddPromoToCart = (promo: any) => {
    if (promo.type === 'FIXED_COMBO' && promo.products && promo.products.length > 0) {
      // Group products by groupId
      const groupMap = new Map<string, any[]>();
      promo.products.forEach((pp: any, idx: number) => {
        const gId = pp.groupId || `single_${pp.productId}_${idx}`;
        if (!groupMap.has(gId)) groupMap.set(gId, []);
        groupMap.get(gId)!.push(pp);
      });

      const groups = Array.from(groupMap.entries());
      const hasMultiChoice = groups.some(([_, items]) => items.length > 1);

      if (hasMultiChoice) {
        // Initialize default selections (first item of each group)
        const initialSelections: { [groupId: string]: string } = {};
        groups.forEach(([gId, items]) => {
          initialSelections[gId] = items[0].productId;
        });
        setSelectedComboVariants(initialSelections);
        setComboVariantModalPromo(promo);
        return;
      }
    }

    addPromoToCart(promo, cachedProducts);
    playBeep();
  };

  const formatPrice = (price: number) => {
    const rounded = Math.round((Number(price) || 0) * 100) / 100;
    return new Intl.NumberFormat('es-AR', { 
      style: 'currency', 
      currency: 'ARS', 
      // Con decimales se muestran siempre los dos (3.564,60), como en modpresup
      minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
      maximumFractionDigits: rounded % 1 === 0 ? 0 : 2
    }).format(rounded);
  };

  const formatStockBadge = (stock: number, unlimitedStock?: boolean, pieceSize?: number, unit?: string) => {
    if (unlimitedStock) {
      return {
        text: 'ST: ∞',
        className: 'bg-slate-900/80 text-white backdrop-blur-xs'
      };
    }
    const num = Number(stock) || 0;
    let formatted: string;
    // Ferretería: si el producto se vende por pieza madre (rollo/barra), mostrar
    // "N piezas + sobrante" en vez del número crudo, para saber cuándo abrir una nueva.
    if (isHardwareStore && pieceSize && pieceSize > 0) {
      const fullPieces = Math.floor(num / pieceSize);
      const remainder = num % pieceSize;
      const unitLabel = unit === 'MT' ? 'm' : unit === 'KG' ? 'kg' : unit === 'L' ? 'L' : '';
      formatted = remainder > 0.001
        ? `${fullPieces}pz+${parseFloat(remainder.toFixed(2))}${unitLabel}`
        : `${fullPieces}pz`;
    } else if (Math.abs(num) >= 10000) {
      formatted = (num / 1000).toFixed(1).replace('.0', '') + 'k';
    } else {
      formatted = Math.round(num).toLocaleString('es-AR');
    }

    if (num <= 0) {
      if (num === 0) {
        return { 
          text: 'ST: 0', 
          className: 'bg-rose-600 text-white font-bold backdrop-blur-xs' 
        };
      }
      return { 
        text: `ST: ${formatted}`, 
        className: 'bg-slate-800/90 text-slate-200 border border-slate-700/60 font-medium backdrop-blur-xs' 
      };
    }

    if (num <= 5) {
      return { 
        text: `ST: ${formatted}`, 
        className: 'bg-amber-600 text-white font-black backdrop-blur-xs' 
      };
    }

    return { 
      text: `ST: ${formatted}`, 
      className: 'bg-slate-900/80 text-white font-bold backdrop-blur-xs font-mono' 
    };
  };

  const cleanSearchQuery = searchQuery.trim().toLowerCase();
  const cleanSearchQueryNorm = cleanSearchQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
  const filteredPromos = promotions.filter(p => {
    if (!p.isActive) return false;
    if (cleanSearchQuery === '') return showPromosOnly;
    const pNameLower = (p.name || '').toLowerCase();
    const pNameNorm = pNameLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/g, 'n');
    return pNameLower.includes(cleanSearchQuery) || pNameNorm.includes(cleanSearchQueryNorm);
  });

  const cartEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll cart to bottom on change
  useEffect(() => {
    cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cart.length]);

  // Calculate suggested promo price
  let suggestedPromoPrice = 0;
  if (suggestedPromo) {
    const promo = suggestedPromo.promo;
    let originalPrice = 0;
    if (promo.type === 'FIXED_COMBO') {
      const groupMap = new Map<string, any[]>();
      promo.products.forEach((pp: any, idx: number) => {
        const gId = pp.groupId || `single_${pp.productId}_${idx}`;
        if (!groupMap.has(gId)) groupMap.set(gId, []);
        groupMap.get(gId)!.push(pp);
      });
      groupMap.forEach(gItems => {
        const primary = gItems[0];
        const prod = cachedProducts.find((p: any) => p.id === primary.productId);
        originalPrice += (prod ? prod.salePrice : 0) * (primary.quantity || 1);
      });
    } else {
      originalPrice = promo.products.reduce((sum: number, pp: any) => {
        const prod = cachedProducts.find((p: any) => p.id === pp.productId);
        return sum + (prod ? prod.salePrice : 0) * pp.quantity;
      }, 0);
    }

    suggestedPromoPrice = originalPrice;
    if (promo.type === 'FIXED_COMBO') {
      suggestedPromoPrice = promo.fixedPrice ?? originalPrice;
    } else if (promo.type === 'DISCOUNT_PERCENT') {
      suggestedPromoPrice = originalPrice * (1 - (promo.discountPercentage || 0) / 100);
    } else if (promo.type === 'NX_M') {
      const factor = promo.nValue ? (promo.mValue || 0) / promo.nValue : 1;
      suggestedPromoPrice = originalPrice * factor;
    }
  }

  const MotionDiv = (perfMode ? 'div' : motion.div) as any;

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
        <div className="pos-header font-sans relative z-30 flex flex-nowrap items-center gap-2 shrink-0 w-full overflow-x-auto scrollbar-hide pb-1.5 md:pb-0">
          {/* 1. Estado Caja */}
          <button
            data-tour="pos-caja"
            onClick={() => { if (currentSession) setShowCajaInfo(true); else setShowAbrirCaja(true); }}
            className={`flex-auto group relative shrink-0 h-10 flex items-center justify-center gap-1.5 px-3.5 rounded-xl font-bold text-[13px] tracking-[-0.01em] transition-all active:scale-95 shadow-2xs border whitespace-nowrap ${
              currentSession 
                ? 'bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white border-transparent' 
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300'
            }`}
          >
            <Vault strokeWidth={2.25} className={`w-4 h-4 shrink-0 ${currentSession ? 'text-white' : 'text-amber-600'}`} />
            <span className="flex items-center gap-1.5">
              {currentSession ? 'Caja' : 'Abrir Caja'}
              {currentSession && <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 ring-2 ring-emerald-400/40" />}
            </span>
            <span className={`inline-flex opacity-0 group-hover:opacity-100 transition-opacity items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded ml-1 leading-none border ${currentSession ? 'bg-white/20 text-white border-white/25' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>F8</span>
          </button>

          {/* Mobile hamburger menu trigger */}
          <button 
            onClick={() => setShowMobileMenu(true)} 
            className="md:hidden w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-slate-850 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 transition-all active:scale-95 shadow-xs shrink-0"
          >
            <Menu strokeWidth={2.25} className="w-5 h-5" />
          </button>

          {/* Cobro Cta. Cte. */}
          <button data-tour="pos-ctacte" onClick={() => { if (currentSession) setShowCobroCtaCte(true); else toast.error('No hay caja abierta'); }} className="flex-auto group relative hidden md:flex shrink-0 items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 font-semibold text-[13px] tracking-[-0.01em] transition-all active:scale-95 shadow-sm whitespace-nowrap border border-transparent text-white">
            <HandCoins strokeWidth={2.25} className="w-4 h-4 text-white shrink-0" />
            <span>Cobro Cta. Cte.</span>
            <span className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/20 text-white border border-white/25 ml-1 leading-none">F5</span>
          </button>

          {/* Historial */}
          <button data-tour="pos-historial" onClick={() => setShowHistorial(true)} className="flex-auto group relative hidden md:flex shrink-0 items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-violet-600 hover:bg-violet-700 font-semibold text-[13px] tracking-[-0.01em] transition-all active:scale-95 shadow-sm whitespace-nowrap border border-transparent text-white cursor-pointer">
            <ReceiptText strokeWidth={2.25} className="w-4 h-4 text-white shrink-0" />
            <span>Historial</span>
            <span className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/20 text-white border border-white/25 ml-1 leading-none">F6</span>
          </button>

          {/* Gastos */}
          <button data-tour="pos-gastos" onClick={() => { if (currentSession) setShowGastos(true); else toast.error('No hay caja abierta'); }} className="flex-auto group relative hidden md:flex shrink-0 items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 font-semibold text-[13px] tracking-[-0.01em] transition-all active:scale-95 shadow-sm whitespace-nowrap border border-transparent text-white">
            <TrendingDown strokeWidth={2.25} className="w-4 h-4 text-white shrink-0" />
            <span>Gastos</span>
            <span className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/20 text-white border border-white/25 ml-1 leading-none">F7</span>
          </button>

          {/* Proveedores */}
          <button data-tour="pos-proveedores" onClick={() => setShowProveedores(true)} className="flex-auto group relative hidden md:flex shrink-0 items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 font-semibold text-[13px] tracking-[-0.01em] transition-all active:scale-95 shadow-sm whitespace-nowrap border border-transparent text-white cursor-pointer">
            <Truck strokeWidth={2.25} className="w-4 h-4 text-white shrink-0" />
            <span>Proveedores</span>
            <span className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity items-center text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/20 text-white border border-white/25 ml-1 leading-none">F9</span>
          </button>

          {/* Presupuestos (Solo Ferretería) */}
          {isHardwareStore && (
            <button
              data-tour="pos-presupuestos" onClick={() => setShowQuotesList(true)}
              className="flex-auto group relative hidden md:flex shrink-0 min-w-10 px-3 h-10 items-center justify-center rounded-xl bg-orange-600 hover:bg-orange-700 text-white border border-transparent transition-all active:scale-95 shadow-sm cursor-pointer"
            >
              <ClipboardList strokeWidth={2.25} className="w-4 h-4" />
              <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-slate-950 text-white dark:bg-white dark:text-slate-900 text-[10.5px] font-mono font-black px-2 py-0.5 rounded-md shadow-2xl z-50 whitespace-nowrap border border-slate-700 dark:border-slate-300">
                Presupuestos
              </span>
            </button>
          )}

          {/* Acopios (Solo Ferretería) */}
          {isHardwareStore && (
            <button
              data-tour="pos-acopios" onClick={() => setShowAcopios(true)}
              className="flex-auto group relative hidden md:flex shrink-0 min-w-10 px-3 h-10 items-center justify-center rounded-xl bg-teal-600 hover:bg-teal-700 text-white border border-transparent transition-all active:scale-95 shadow-sm cursor-pointer"
            >
              <Boxes strokeWidth={2.25} className="w-4 h-4" />
              <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-slate-950 text-white dark:bg-white dark:text-slate-900 text-[10.5px] font-mono font-black px-2 py-0.5 rounded-md shadow-2xl z-50 whitespace-nowrap border border-slate-700 dark:border-slate-300">
                Acopios
              </span>
            </button>
          )}


          {/* Utilidades: barra compacta de ancho fijo, separada de los botones de acción */}
          <div className="hidden md:flex items-center gap-0.5 h-10 p-1 ml-1 rounded-xl bg-white dark:bg-slate-850 border border-slate-250 dark:border-slate-750 shadow-2xs shrink-0">
            {/* Usuario (F10) */}
            <button
              data-tour="pos-usuario"
              onClick={() => {
                setProfileOldPassword('');
                setProfileNewPassword('');
                setShowPasswords(false);
                setShowProfile(true);
              }}
              className="group relative flex items-center justify-center gap-1.5 h-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 cursor-pointer shrink-0 pl-1 pr-2.5"
              title={`Usuario: ${user?.username || 'Usuario'} [F10]`}
            >
              <span className="w-6 h-6 rounded-md bg-rose-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                {(user?.username || 'U')[0].toUpperCase()}
              </span>
              <span className="truncate max-w-[90px] text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">{user?.username || 'Usuario'}</span>
            </button>

            {/* Cerrar sesión (sin atajo: es una acción sensible) */}
            <button
              data-tour="pos-logout"
              onClick={() => logout()}
              className="group relative flex items-center justify-center gap-1.5 h-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 cursor-pointer shrink-0 w-8 hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-950/40"
              title="Cerrar sesión"
            >
              <LogOut strokeWidth={2.25} className="w-4 h-4" />
            </button>

            <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />

            {/* Reloj en tiempo real de la PC */}
            <div className="hidden lg:flex items-center gap-1.5 px-2 text-slate-700 dark:text-slate-200 select-none whitespace-nowrap" title="Hora local del sistema">
              <Clock strokeWidth={2.25} className="w-4 h-4 text-slate-400" />
              <span className="text-[13px] font-bold tabular-nums">{currentTime}</span>
            </div>

            <span className="hidden lg:block w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />

            {/* Conectar celular (F8) */}
            <button data-tour="pos-celular" onClick={handleOpenCellularModal} className="group relative flex items-center justify-center gap-1.5 h-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 cursor-pointer shrink-0 w-8" title="Conectar celular">
              <Smartphone strokeWidth={2.25} className="w-4 h-4" />
            </button>

            {/* Pantalla completa (F11) */}
            <button data-tour="pos-fullscreen" onClick={() => toggleFullscreen()} className="group relative flex items-center justify-center gap-1.5 h-8 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-95 cursor-pointer shrink-0 w-8" title="Pantalla completa [F11]">
              <Maximize2 strokeWidth={2.25} className="w-4 h-4" />
            </button>

            {/* Panel de administración (F12) */}
            <button
              data-tour="pos-admin"
              onClick={() => {
                if (isAdmin) {
                  navigate('/dashboard');
                } else {
                  setShowAdminPrompt(true);
                }
              }}
              className="group relative flex items-center justify-center w-8 h-8 ml-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white transition-colors active:scale-95 cursor-pointer shrink-0"
              title="Panel de administración [F12]"
            >
              <Settings strokeWidth={2.25} className="w-4 h-4" />
            </button>

            {/* Marca Ventra */}
            <div className="keep-style flex items-center pl-2.5 ml-1 border-l border-slate-200 dark:border-slate-800 shrink-0 select-none">
              <MangoLogo className="w-8 h-8" />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col md:flex-row gap-3 md:gap-4 overflow-hidden relative">
          {currentSession ? (
            <>
              {/* LEFT: Products Panel */}
              <div data-tour="pos-products" className={`flex-1 min-w-0 pos-main-panel rounded-2xl flex flex-col overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm ${activeMobileTab === 'products' ? 'flex' : 'hidden md:flex'}`}>
            <div className="px-4 py-3 flex items-center gap-2.5 bg-white dark:bg-slate-900 z-10 border-b border-slate-200 dark:border-slate-800">
              <div data-tour="pos-search" className="flex-1 relative flex items-center">
                <Search className="absolute left-3.5 w-4 h-4 text-rose-500/70 dark:text-rose-400/70 pointer-events-none" />
                <input ref={searchRef} type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value.toUpperCase())} onKeyDown={handleBarcodeSearch} placeholder="Buscar por nombre o código de barra..." className="w-full bg-slate-50/70 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-9 h-10 text-xs sm:text-sm font-medium focus:bg-white dark:focus:bg-slate-900 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 outline-none text-slate-900 dark:text-white transition-all placeholder:text-slate-400 placeholder:font-normal" id="pos-search" autoFocus autoComplete="off" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>}
              </div>
              {/* Venta rápida (F1 o código "1") */}
              <button
                data-tour="pos-rapida"
                onClick={() => setShowQuickSale(true)}
                title="Venta rápida: productos sin código [F1]"
                className="group h-10 pl-3 pr-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-[13px] font-semibold flex items-center gap-1.5 shrink-0 transition-all active:scale-95 cursor-pointer"
              >
                <QuickSaleIcon className="w-[18px] h-[18px]" />
                <span className="hidden sm:inline">Venta rápida</span>
                <kbd className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-white dark:bg-rose-900/60 border border-rose-200 dark:border-rose-700 leading-none">F1</kbd>
              </button>
              {/* Calculadora (replaces old refresh button) */}
              <button 
                data-tour="pos-calculadora" onClick={() => setShowCalculator(true)} 
                className="group relative w-10 h-10 rounded-xl bg-white dark:bg-slate-850 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:border-emerald-300 dark:hover:border-emerald-800 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all active:scale-95 border border-slate-250 dark:border-slate-750 shadow-2xs flex items-center justify-center shrink-0 cursor-pointer" 
                title="Calculadora [F3]"
              >
                <Calculator className="w-4.5 h-4.5 group-hover:scale-110 transition-transform text-emerald-600 dark:text-emerald-400" />
                <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-slate-950 text-white dark:bg-white dark:text-slate-900 text-[10.5px] font-mono font-black px-2 py-0.5 rounded-md shadow-2xl z-50 whitespace-nowrap border border-slate-700 dark:border-slate-300">
                  Calculadora [F3]
                </span>
              </button>
              <button 
                data-tour="pos-vista" onClick={() => {
                  const nextMode = productViewMode === 'grid' ? 'list' : 'grid';
                  setProductViewMode(nextMode);
                  localStorage.setItem('pos_product_view_mode', nextMode);
                }} 
                className="w-10 h-10 rounded-xl bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all active:scale-95 border border-slate-250 dark:border-slate-750 shadow-2xs flex items-center justify-center shrink-0 cursor-pointer" 
                title={productViewMode === 'grid' ? "Ver como Lista" : "Ver como Cuadrícula"}
              >
                {productViewMode === 'grid' ? <List className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
              </button>
              <button
                data-tour="pos-devolucion" onClick={() => { setShowReturnModal(true); setReturnProductSelected(null); setReturnSearchQuery(''); setReturnQty(1); }}
                className="h-10 px-3.5 rounded-xl bg-white dark:bg-slate-850 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 dark:hover:bg-rose-950/30 dark:hover:text-rose-300 text-slate-700 dark:text-slate-200 transition-all active:scale-95 border border-slate-250 dark:border-slate-750 flex items-center gap-1.5 font-semibold text-xs cursor-pointer shrink-0 shadow-2xs"
                title="Registrar Devolución de Producto"
              >
                <CornerUpLeft className="w-4 h-4 text-rose-500 dark:text-rose-400" /> Devolución
              </button>
            </div>

            {/* Categories horizontal bar: los rubros scrollean, el botón de "todos" queda siempre fijo */}
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/70 shrink-0">
            <ScrollRow data-tour="pos-categorias">
              <button 
                onClick={() => { setSelectedCategory(null); setShowPromosOnly(false); }} 
                className={`px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  !selectedCategory && !showPromosOnly 
                    ? 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white font-bold shadow-xs border border-teal-700 dark:border-teal-600 ring-1 ring-teal-700/15'
                    : 'bg-white dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-250 font-medium border border-slate-250 dark:border-slate-750 shadow-2xs'
                }`}
              >
                Todos
              </button>
              
              {hasActivePromos && (
              <button
                onClick={() => { setShowPromosOnly(true); setSelectedCategory(null); }}
                className={`px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer ${
                  showPromosOnly 
                    ? 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white font-bold shadow-xs border border-teal-700 dark:border-teal-600 ring-1 ring-teal-700/15'
                    : 'bg-white dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-250 font-medium border border-slate-250 dark:border-slate-750 shadow-2xs'
                }`}
              >
                <Tag className="w-3.5 h-3.5 text-amber-500" /> Promos
              </button>
              )}

              {visibleCategories.map((cat) => {
                const isSelected = selectedCategory === cat.id;
                return (
                  <button 
                    key={cat.id} 
                    onClick={() => { setSelectedCategory(cat.id); setShowPromosOnly(false); }} 
                    className={`px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer ${
                      isSelected 
                        ? 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white font-bold shadow-xs border border-teal-700 dark:border-teal-600 ring-1 ring-teal-700/15'
                        : 'bg-white dark:bg-slate-850 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-250 font-medium border border-slate-250 dark:border-slate-750 shadow-2xs'
                    }`} 
                  >
                    {cat.name}
                  </button>
                );
              })}

            </ScrollRow>

              {usableCategories.length > visibleCategories.length && (
                <button
                  onClick={() => setShowCategoryPicker(true)}
                  className="px-3 sm:px-3.5 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all active:scale-95 flex items-center gap-1.5 shrink-0 cursor-pointer bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-900/50 text-teal-800 dark:text-teal-300 font-bold border border-teal-300 dark:border-teal-800 shadow-2xs"
                  title="Ver todos los rubros"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Todos los rubros</span> ({usableCategories.length})
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4 custom-scrollbar bg-slate-50/30 dark:bg-slate-900/30">
              {!currentSession ? (
                <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto py-8">
                  <MotionDiv {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 } })} className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl p-8 shadow-2xl w-full text-slate-800 dark:text-slate-200">
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

                      <div className="p-4 rounded-xl bg-rose-50/50 dark:bg-rose-900/20 border border-rose-100/50 dark:border-rose-800/30 flex items-start gap-2.5">
                        <span className="text-sm mt-0.5">🖥️</span>
                        <p className="text-[10px] text-rose-750 dark:text-rose-300 font-semibold leading-relaxed">
                          El fondo fijo que queda en el cajón no se registra: la caja cuenta solo las ventas y los movimientos de este turno.
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
                  </MotionDiv>
                </div>
              ) : (displayedProducts.length === 0 && !showPromosOnly) ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-20">
                  <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4"><Package className="w-8 h-8 text-slate-350" /></div>
                  <p className="text-slate-600 font-bold">No se encontraron productos.</p>
                </div>
              ) : (
                <div className={productViewMode === 'grid' 
                  ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4"
                  : "flex flex-col gap-2"
                }>
                  <AnimatePresence>
                    {/* Display Promos if active or if searched */}
                    {(showPromosOnly || cleanSearchQuery !== '') && filteredPromos.map((promo, comboIndex) => {
                      // Calculate list total price for visual Crossed-out design
                      const originalPrice = promo.products.reduce((sum: number, pp: any) => {
                        const prod = pp.product || cachedProducts.find((p: any) => p.id === pp.productId);
                        return sum + (prod ? prod.salePrice : 0) * pp.quantity;
                      }, 0);

                      let finalPrice = 0;
                      if (promo.type === 'FIXED_COMBO') finalPrice = promo.fixedPrice || 0;
                      else if (promo.type === 'DISCOUNT_PERCENT') finalPrice = originalPrice * (1 - (promo.discountPercentage || 0) / 100);
                      else if (promo.type === 'NX_M') finalPrice = originalPrice * ((promo.mValue || 1) / (promo.nValue || 1));

                      const savings = originalPrice > finalPrice ? originalPrice - finalPrice : 0;
                      const isComboSelected = selectedProductIndex === comboIndex;

                      return (
                        <button
                          id={`product-btn-${comboIndex}`}
                          key={promo.id}
                          onClick={() => handleAddPromoToCart(promo)}
                          className={productViewMode === 'grid'
                            ? `group bg-teal-800 dark:bg-teal-900 border rounded-2xl p-4 text-left shadow-md hover:shadow-xl hover:scale-[1.02] transition-all active:scale-[0.98] relative overflow-hidden flex flex-col justify-between min-h-[170px] cursor-pointer ${isComboSelected ? 'border-2 border-rose-400 ring-2 ring-rose-400/30' : 'border-teal-700/70 hover:border-rose-400/80 dark:border-teal-700/70 dark:hover:border-rose-400/80'}`
                            : `group bg-teal-800 dark:bg-teal-900 border rounded-2xl p-3.5 text-left shadow-sm hover:shadow-md transition-all active:scale-[0.99] flex items-center justify-between gap-4 cursor-pointer ${isComboSelected ? 'border-2 border-rose-400 ring-2 ring-rose-400/30' : 'border-teal-700/70 hover:border-rose-400/80 dark:border-teal-700/70'}`
                          }
                        >
                          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-rose-500/10 to-transparent rounded-bl-full pointer-events-none" />
                          
                          {productViewMode === 'grid' ? (
                            <>
                              <div>
                                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-lg uppercase tracking-wider leading-none">
                                      {promo.type === 'NX_M' ? `${promo.nValue}x${promo.mValue}` : 'COMBO'}
                                    </span>
                                    {promo.code && (
                                      <span className="text-[9px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded-md leading-none">
                                        CÓD: {promo.code}
                                      </span>
                                    )}
                                  </div>
                                  
                                  {savings > 0 ? (
                                    <span className="text-[9px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded-md uppercase tracking-wide leading-none">
                                      AHORRÁ {formatPrice(savings)}
                                    </span>
                                  ) : promo.type === 'DISCOUNT_PERCENT' ? (
                                    <span className="text-[9px] font-extrabold bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded-md uppercase tracking-wide leading-none">
                                      -{promo.discountPercentage}% OFF
                                    </span>
                                  ) : null}
                                </div>
                                
                                <h3 className="text-xs sm:text-sm font-black text-white group-hover:text-rose-200 transition-colors line-clamp-2 leading-snug tracking-tight mb-2">
                                  {promo.name}
                                </h3>
                              </div>

                              <div className="mt-auto pt-2">
                                <div className="w-full border-t border-dashed border-slate-700/80 mb-2.5" />
                                
                                <div className="flex items-end justify-between">
                                  <div>
                                    {originalPrice > finalPrice && originalPrice > 0 && (
                                      <span className="text-[11px] text-emerald-400/90 font-mono font-bold line-through block mb-0.5 leading-none">
                                        {formatPrice(originalPrice)}
                                      </span>
                                    )}
                                    <span className="text-base sm:text-lg font-black text-white font-mono leading-none tracking-tight">
                                      {formatPrice(finalPrice)}
                                    </span>
                                  </div>
                                  
                                  <div className="w-8 h-8 bg-slate-800 group-hover:bg-rose-500 text-slate-300 group-hover:text-slate-950 border border-slate-700 group-hover:border-rose-400 rounded-xl flex items-center justify-center transition-all duration-200 shadow-sm active:scale-90">
                                    <Plus className="w-4 h-4 stroke-[2.8]" />
                                  </div>
                                </div>
                              </div>
                            </>
                          ) : (
                            /* List View */
                            <>
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[9px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-lg uppercase tracking-wider">
                                    {promo.type === 'NX_M' ? `${promo.nValue}x${promo.mValue}` : 'COMBO'}
                                  </span>
                                  {promo.code && (
                                    <span className="text-[9px] font-mono font-bold bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded-md">
                                      CÓD: {promo.code}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h3 className="text-xs font-bold text-white group-hover:text-rose-200 transition-colors truncate">
                                    {promo.name}
                                  </h3>
                                  {savings > 0 && (
                                    <span className="text-[9.5px] font-bold text-emerald-400">
                                      Ahorrás {formatPrice(savings)}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <div className="text-right">
                                  {originalPrice > finalPrice && originalPrice > 0 && (
                                    <span className="text-[10px] text-emerald-400/90 font-mono font-bold line-through block leading-none">
                                      {formatPrice(originalPrice)}
                                    </span>
                                  )}
                                  <span className="text-sm sm:text-base font-black text-white font-mono">
                                    {formatPrice(finalPrice)}
                                  </span>
                                </div>
                                <div className="w-7 h-7 bg-slate-800 group-hover:bg-rose-500 text-slate-300 group-hover:text-slate-950 border border-slate-700 rounded-lg flex items-center justify-center transition-all active:scale-90 shadow-sm">
                                  <Plus className="w-3.5 h-3.5 stroke-[2.8]" />
                                </div>
                              </div>
                            </>
                          )}
                        </button>
                      );
                    })}

                    {!showPromosOnly && displayedProducts.map((product, index) => {
                      const navIndex = getVisibleCombos().length + index;
                      const stockBadge = formatStockBadge(product.stock, product.unlimitedStock, product.pieceSize, product.unit);
                      if (productViewMode === 'grid') {
                        return (
                          <button
                            id={`product-btn-${navIndex}`}
                            key={product.id}
                            onClick={(e) => {
                              handleProductAdd(product, e);
                            }}
                            style={{ contain: 'content', contentVisibility: 'auto' }}
                            className={`group p-3 text-left transition-all duration-150 active:scale-[0.98] select-none flex flex-col justify-between h-[258px] rounded-2xl ${
                              selectedProductIndex === navIndex
                                ? 'border-2 border-rose-500 dark:border-rose-400 bg-rose-50/40 dark:bg-rose-950/30 shadow-md ring-2 ring-rose-500/20'
                                : 'bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700/80 hover:border-rose-300 dark:hover:border-rose-500/50 hover:shadow-lg hover:-translate-y-0.5 shadow-sm'
                            }`}
                          >
                            {/* Top: Image Container */}
                            <div className="w-full h-[106px] rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-700/60 overflow-hidden flex-shrink-0 flex items-center justify-center relative mb-2 p-1.5 group-hover:bg-slate-100/70 dark:group-hover:bg-slate-850/60 transition-colors">
                              <img 
                                src={product.imageUrl || './product-placeholder.png'} 
                                alt={product.name} 
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = './product-placeholder.png';
                                }}
                              />
                              
                              {/* Stock Tag overlaid on Image */}
                              <div className="absolute bottom-1.5 left-1.5 z-10">
                                <span className={`text-[10px] font-bold px-1.5 py-1 rounded-md leading-none ${stockBadge.className}`}>
                                  {stockBadge.text}
                                </span>
                              </div>

                              {/* Category Tag overlaid on top-left of Image */}
                              {product.category?.name && (
                                <div className="absolute top-1.5 left-1.5 z-10">
                                  <span className="text-[9.5px] font-bold px-1.5 py-1 rounded-md bg-slate-900/80 backdrop-blur-xs text-white leading-none max-w-[110px] truncate block shadow-xs">
                                    {product.category.name}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Middle: Title & Barcode Info */}
                            <div className="flex-1 flex flex-col justify-start min-w-0 mb-1">
                              <h3 className="text-[13.5px] sm:text-sm font-bold text-slate-900 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors line-clamp-2 leading-snug min-h-[38px] max-h-[38px] overflow-hidden mb-1.5">
                                {product.name}
                              </h3>
                              {product.barcode && (
                                <div className="mt-0.5">
                                  <span className="text-[10.5px] font-mono font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600/80 inline-block leading-none tracking-tight select-all">
                                    {product.barcode}
                                  </span>
                                </div>
                              )}
                              {product.location && (
                                <div className="mt-1">
                                  <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/80 inline-flex items-center gap-1 leading-none">
                                    📍 {product.location}
                                  </span>
                                </div>
                              )}
                              {product.wholesalePrice && product.wholesaleMinQty && (
                                <div className="mt-1">
                                  <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/80 inline-flex items-center gap-0.5 leading-none">
                                    x{product.wholesaleMinQty}+ ${product.wholesalePrice}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Bottom: Price & Add Button */}
                            <div className="mt-auto pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
                              <span className="text-[17px] sm:text-lg font-black text-slate-900 dark:text-white tracking-tight font-mono">
                                {formatPrice(product.salePrice)}
                              </span>

                              <div className="flex items-center gap-1.5">
                                {/* No puede ser <button>: está dentro del botón de la tarjeta */}
                                {isHardwareStore && product.stock <= 0 && !product.unlimitedStock && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSubstituteProduct(product);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key !== 'Enter' && e.key !== ' ') return;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setSubstituteProduct(product);
                                    }}
                                    className="w-8 h-8 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center justify-center shadow-2xs transition-all cursor-pointer shrink-0"
                                    title="Ver productos sustitutos disponibles"
                                  >
                                    <Shuffle className="w-4 h-4 stroke-[2.5]" />
                                  </span>
                                )}
                                <div className="w-8 h-8 bg-teal-700 text-white dark:bg-teal-600 dark:text-white group-hover:bg-rose-600 group-hover:text-white dark:group-hover:bg-rose-600 dark:group-hover:text-white rounded-lg flex items-center justify-center transition-colors active:scale-90 shrink-0 shadow-sm">
                                  <Plus className="w-4 h-4 stroke-[2.8]" />
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      } else {
                        // List mode
                        return (
                          <button
                            id={`product-btn-${navIndex}`}
                            key={product.id}
                            onClick={(e) => {
                              handleProductAdd(product, e);
                            }}
                            className={`group border rounded-xl p-2.5 text-left transition-all duration-150 active:scale-[0.99] select-none flex items-center justify-between shadow-xs min-h-[58px] ${
                              selectedProductIndex === navIndex
                                ? 'border-2 border-rose-500 dark:border-rose-400 bg-rose-50/40 dark:bg-rose-950/30 shadow-md ring-2 ring-rose-500/20'
                                : 'bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 hover:border-rose-300 dark:hover:border-rose-500/50'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {/* Compact Image */}
                              <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center justify-center overflow-hidden p-1">
                                <img 
                                  src={product.imageUrl || './product-placeholder.png'} 
                                  alt={product.name} 
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = './product-placeholder.png';
                                  }}
                                />
                              </div>
                              
                              {/* Info */}
                              <div className="min-w-0 flex-1">
                                <h3 className="text-xs sm:text-sm font-bold text-slate-950 dark:text-white group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors leading-tight truncate">
                                  {product.name}
                                </h3>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {product.barcode && (
                                    <span className="text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-300 tracking-wider bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600/80 inline-block leading-none select-all">
                                      {product.barcode}
                                    </span>
                                  )}
                                  {product.location && (
                                    <span className="text-[9px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800/80 inline-flex items-center gap-1 leading-none">
                                      📍 {product.location}
                                    </span>
                                  )}
                                  {product.wholesalePrice && product.wholesaleMinQty && (
                                    <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/80 inline-flex items-center gap-0.5 leading-none">
                                      x{product.wholesaleMinQty}+ ${product.wholesalePrice}
                                    </span>
                                  )}
                                  {product.category?.name && (
                                    <span className="text-[8.5px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider bg-slate-800 text-white leading-none">
                                      {product.category.name}
                                    </span>
                                  )}
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded leading-none ${stockBadge.className}`}>
                                    {stockBadge.text}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Price & Plus */}
                            <div className="flex items-center gap-2 ml-4 shrink-0">
                              {/* No puede ser <button>: está dentro del botón de la fila */}
                              {isHardwareStore && product.stock <= 0 && !product.unlimitedStock && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSubstituteProduct(product);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setSubstituteProduct(product);
                                  }}
                                  className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 flex items-center justify-center shadow-2xs transition-all cursor-pointer shrink-0"
                                  title="Ver productos sustitutos disponibles"
                                >
                                  <Shuffle className="w-3.5 h-3.5 stroke-[2.5]" />
                                </span>
                              )}
                              <span className="text-sm sm:text-base font-black text-slate-950 dark:text-white font-mono">
                                {formatPrice(product.salePrice)}
                              </span>
                              <div className="w-7 h-7 bg-teal-700 text-white dark:bg-teal-600 dark:text-white group-hover:bg-rose-600 group-hover:text-white dark:group-hover:bg-rose-600 dark:group-hover:text-white rounded-lg flex items-center justify-center transition-colors active:scale-90 shrink-0 shadow-2xs">
                                <Plus className="w-3.5 h-3.5 stroke-[2.8]" />
                              </div>
                            </div>
                          </button>
                        );
                      }
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Cart Panel - Widened for better layout */}
          <div data-tour="pos-cart" className={`w-full md:w-[350px] lg:w-[400px] xl:w-[480px] flex-shrink-0 pos-main-panel rounded-2xl flex flex-col overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm ${activeMobileTab === 'cart' ? 'flex' : 'hidden md:flex'}`}>
            <div className="px-3.5 py-2.5 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Ticket en curso</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button 
                  data-tour="pos-reimprimir" onClick={handleReprintLastTicket} 
                  title={lastSale ? `Reimprimir Ticket #${lastSale.saleNumber} [F4]` : 'Reimprimir último ticket [F4]'}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs border active:scale-95 ${
                    lastSale 
                      ? 'bg-white dark:bg-slate-850 text-rose-600 dark:text-rose-400 border-rose-200/80 dark:border-rose-800/80 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-300' 
                      : 'bg-slate-100/70 dark:bg-slate-800/40 text-slate-400 dark:text-slate-500 border-dashed border-slate-250 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" />
                  <span>Reimprimir</span>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 leading-none">F4</span>
                </button>

                <button 
                  onClick={() => clearCart()} 
                  disabled={cart.length === 0}
                  className="text-xs font-semibold text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-2 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                  title="Vaciar todos los productos del ticket actual"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Vaciar</span>
                </button>
              </div>
            </div>

            {/* Cliente / Lista Gremio Selector (Solo Ferretería) */}
            {isHardwareStore && (
              <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50">
                {selectedClient ? (
                  <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <User className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{selectedClient.name}</p>
                        {selectedClient.priceList === 'TRADE' ? (
                          <span className="text-[9.5px] font-extrabold text-amber-600 dark:text-amber-400">
                            🔧 Tarifa Gremio {selectedClient.tradeDiscountPercentage ? `(-${selectedClient.tradeDiscountPercentage}%)` : ''}
                          </span>
                        ) : (
                          <span className="text-[9.5px] text-slate-500">Tarifa Mostrador</span>
                        )}
                      </div>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setSelectedClient(null)} 
                      className="text-slate-400 hover:text-rose-500 p-1 transition-colors cursor-pointer"
                      title="Quitar cliente"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      data-tour="pos-cliente" onClick={() => setShowClientSelector(!showClientSelector)}
                      className="w-full py-1.5 px-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-rose-400 text-slate-600 dark:text-slate-300 hover:text-rose-600 text-xs font-semibold flex items-center justify-between transition-all bg-white dark:bg-slate-800 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>Cliente Mostrador</span>
                      </span>
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">+ Asignar Gremio / Cliente</span>
                    </button>

                    {showClientSelector && (
                      <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 space-y-2">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            autoFocus
                            placeholder="Buscar cliente..."
                            value={clientSearchQuery}
                            onChange={e => setClientSearchQuery(e.target.value)}
                            className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:ring-1 focus:ring-rose-500"
                          />
                        </div>
                        <div className="max-h-40 overflow-y-auto space-y-1 custom-scrollbar">
                          {posClients
                            .filter(c => c.name.toLowerCase().includes(clientSearchQuery.toLowerCase()))
                            .map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setSelectedClient(c);
                                  setShowClientSelector(false);
                                  setClientSearchQuery('');
                                }}
                                className="w-full p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs flex items-center justify-between cursor-pointer"
                              >
                                <span className="font-bold text-slate-800 dark:text-slate-200 truncate">{c.name}</span>
                                {c.priceList === 'TRADE' && (
                                  <span className="text-[9px] font-extrabold text-amber-600 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                    🔧 Gremio {c.tradeDiscountPercentage ? `(-${c.tradeDiscountPercentage}%)` : ''}
                                  </span>
                                )}
                              </button>
                            ))}
                          {posClients.filter(c => c.name.toLowerCase().includes(clientSearchQuery.toLowerCase())).length === 0 && (
                            <p className="text-center py-3 text-xs text-slate-400">No se encontraron clientes</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/40 gap-2">
              <div className="flex items-center gap-2 flex-1">
                {cart.length > 0 && (
                  <div className="relative group/pause flex-1">
                    <button 
                      onClick={() => {
                        setHoldCartClientName('');
                        setShowHoldCartInputModal(true);
                      }} 
                      className="w-full bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-xs py-2 px-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95"
                    >
                      <PauseCircle className="w-4 h-4 stroke-[2.5] shrink-0" />
                      <span className="truncate">Pausar Ticket</span>
                      <kbd className="text-[9.5px] bg-black/20 text-white font-mono font-black px-1.5 py-0.5 rounded ml-0.5 shrink-0">F2</kbd>
                    </button>
                    <div className="pointer-events-none absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover/pause:opacity-100 transition-opacity duration-150 z-50 whitespace-nowrap">
                      <div className="bg-slate-950 text-white text-[10.5px] font-medium px-2.5 py-1 rounded-lg shadow-xl border border-slate-700 flex items-center gap-1">
                        <span>Poner ticket actual en espera</span>
                        <span className="font-mono font-bold text-amber-400">[F2]</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <button 
                  data-tour="pos-espera" onClick={() => { setHeldCartIndex(0); setShowHeldCartsModal(true); }} 
                  className="flex-1 bg-white hover:bg-slate-50 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs active:scale-95"
                  title="Ver los tickets guardados en espera"
                >
                  <History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>En Espera</span>
                  {heldCarts.length > 0 && (
                    <span className="ml-1 bg-amber-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px] font-black">
                      {heldCarts.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 custom-scrollbar">
              {isCartBusy && (
                <div className="bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 animate-pulse mb-3 shrink-0 shadow-xs">
                  <span className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></span>
                  <span>Buscando y agregando producto... Carrito bloqueado</span>
                </div>
              )}
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8 select-none my-auto">
                  <MangoLogo className="w-20 h-20 mb-3 opacity-25 grayscale" />
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-1">
                    Carrito vacío
                  </h4>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 max-w-[210px] leading-relaxed">
                    Escaneá un código o tocá un producto del catálogo para sumar al ticket
                  </p>
                  <div className="mt-3.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">
                    <kbd className="font-mono font-bold text-[9.5px] bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded shadow-2xs border border-slate-200 dark:border-slate-600">F6</kbd>
                    <span>Historial de tickets</span>
                  </div>
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
                    
                    const hasDiscount = originalTotal > promoTotal || (!isPromo && discount > 0);

                    return (
                      <MotionDiv 
                        key={item.cartKey} 
                        {...(perfMode ? {} : {
                          initial: { opacity: 0, x: -6 },
                          animate: { opacity: 1, x: 0 },
                          exit: { opacity: 0, height: 0 },
                          transition: { duration: 0.12 }
                        })}
                        className="py-3 border-b border-slate-200 dark:border-slate-800 last:border-0 group flex items-center gap-3.5"
                      >
                        {/* Product Image */}
                        {item.productId === QUICK_SALE_PRODUCT_ID ? (
                        <div className="keep-style w-10 h-10 rounded-lg bg-gradient-to-br from-rose-400 to-rose-600 text-white flex-shrink-0 flex items-center justify-center shadow-xs">
                          <QuickSaleIcon className="w-5 h-5" />
                        </div>
                        ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex-shrink-0 flex items-center justify-center overflow-hidden p-0.5 shadow-xs">
                          <img 
                            src={item.imageUrl || './product-placeholder.png'} 
                            alt={item.name} 
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-contain mix-blend-multiply"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = './product-placeholder.png';
                            }}
                          />
                        </div>
                        )}

                        {/* Product Name & High-Contrast Unit Price */}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-tight line-clamp-2 pr-1">{item.name}</h4>
                          {item.isPromo && item.productsMetadata && (
                            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300 mt-0.5 tracking-tight leading-relaxed">
                              {item.productsMetadata.map(pm => `${pm.quantity}x ${pm.name}`).join(' + ')}
                            </p>
                          )}
                          {item.quantity > 1 && (
                            <div className="mt-1 flex items-center">
                              <span className="text-[11px] sm:text-xs font-mono font-black text-slate-950 dark:text-slate-50 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 leading-none inline-block">
                                {formatPrice(item.price)} c/u
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Quantity Selector - Compact Horizontal */}
                        {item.isReturn ? (
                          <div className="flex items-center gap-2 px-2.5 py-1 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-xl shrink-0 select-none">
                            <span className="text-[11px] font-bold text-rose-700 dark:text-rose-400 tracking-wider uppercase">
                              {item.quantity} Devuelto
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
                            <button onClick={() => { updateQuantity(item.cartKey, item.quantity - 1); focusSearch(); }} className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-all shadow-xs active:scale-90 font-bold"><Minus className="w-3 h-3 stroke-[3]" /></button>
                            <span className="w-8 text-center text-sm font-black text-slate-950 dark:text-white font-mono">{item.quantity}</span>
                            <button onClick={() => { updateQuantity(item.cartKey, item.quantity + 1); focusSearch(); }} className="w-7 h-7 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600 transition-all shadow-xs active:scale-90 font-bold"><Plus className="w-3 h-3 stroke-[3]" /></button>
                          </div>
                        )}

                        {/* Total Price & Delete */}
                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="text-right min-w-[70px]">
                            {hasDiscount && (
                              <span className="text-[11px] text-slate-500 line-through font-medium block leading-none mb-0.5">
                                {formatPrice(originalTotal)}
                              </span>
                            )}
                            <p className="text-sm sm:text-base font-black text-slate-950 dark:text-white font-mono leading-none">{formatPrice(promoTotal)}</p>
                          </div>
                          <button onClick={() => { removeFromCart(item.cartKey); focusSearch(); }} className="text-slate-400 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition-all p-1 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg active:scale-90" title="Eliminar del carrito">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </MotionDiv>
                    );
                  })}
                  <div ref={cartEndRef} />
                </AnimatePresence>
              )}
            </div>

            <div data-tour="pos-totales" className="bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur-md px-4 py-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="bg-white dark:bg-slate-800/80 rounded-2xl p-3.5 border border-slate-200/90 dark:border-slate-700/80 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Items / Cantidad</span>
                  <span className="text-slate-950 dark:text-white font-black bg-slate-100 dark:bg-slate-750 px-2.5 py-0.5 rounded-lg font-mono border border-slate-200 dark:border-slate-700">{getItemCount()}</span>
                </div>
                {getAppliedPromotions().map((promo, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400 animate-in slide-in-from-bottom-1">
                    <span className="flex items-center gap-1"><Tag className="w-3 h-3 text-amber-500" /> {promo.name}</span>
                    <span className="font-mono">-{formatPrice(promo.discount)}</span>
                  </div>
                ))}
                {activePaymentSurcharge > 0 && (
                  <div className="flex items-center justify-between text-xs font-bold text-amber-600 dark:text-amber-400 animate-in slide-in-from-bottom-1">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Recargo Método de Pago
                    </span>
                    <span className="font-mono font-bold">+{formatPrice(activePaymentSurcharge)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-700/70">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Total a Pagar</span>
                  <span className="text-3xl sm:text-4xl font-black text-slate-950 dark:text-white tracking-tight font-mono">{formatPrice(getFinalTotal() + activePaymentSurcharge)}</span>
                </div>
              </div>

              <div className="flex gap-2">
                {isHardwareStore && (
                  <button
                    type="button"
                    onClick={() => {
                      if (cart.length === 0) {
                        toast.error('Agregá productos al carrito primero');
                        return;
                      }
                      setShowCreateQuote(true);
                    }}
                    disabled={cart.length === 0}
                    className="w-16 h-16 rounded-2xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white flex flex-col items-center justify-center shadow-md shadow-amber-500/20 disabled:opacity-30 disabled:grayscale transition-all active:scale-[0.98] shrink-0 cursor-pointer"
                    title="Guardar como Presupuesto / Cotización"
                  >
                    <FileText className="w-5 h-5 mb-0.5" />
                    <span className="text-[8.5px] font-black uppercase tracking-wider">Presup.</span>
                  </button>
                )}

                <button
                  data-tour="pos-confirm"
                  ref={confirmSaleRef}
                  onClick={() => { if (cart.length > 0 && currentSession && !isCartBusy) setShowPayment(true); }}
                  disabled={cart.length === 0 || !currentSession || isCartBusy}
                  className={`flex-1 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white h-16 text-lg font-black rounded-2xl shadow-xl shadow-emerald-600/25 disabled:opacity-30 disabled:grayscale disabled:shadow-none flex items-center justify-center cursor-pointer transition-all border border-emerald-500/60 active:scale-[0.99] tracking-wider ${isCartBusy ? 'opacity-70 cursor-not-allowed' : ''}`}
                  id="pos-confirm-sale"
                >
                  {isCartBusy ? (
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      <span className="text-base font-bold">Agregando producto...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2.5">
                      <span className="font-black tracking-wide text-lg sm:text-xl font-outfit">CONFIRMAR VENTA</span>
                      <CornerDownLeft className="w-5 h-5 stroke-[2.5]" />
                    </div>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
        ) : (
            <div className="flex-1 flex items-center justify-center bg-slate-50/50 dark:bg-slate-950/40 backdrop-blur-sm rounded-2xl border border-dashed border-slate-400 dark:border-slate-700 p-8 shadow-sm">
              <MotionDiv 
                {...(perfMode ? {} : { initial: { opacity: 0, scale: 0.95 }, animate: { opacity: 1, scale: 1 } })}
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
                  className="w-full py-4 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-2xl text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 cursor-pointer"
                >
                  <Unlock className="w-5 h-5 text-rose-200" /> Abrir Caja Registradora
                </button>
              </MotionDiv>
            </div>
          )}
        </div>

        {/* Floating Cart Button (Mobile only, catalog tab, only when cart has items) */}
        {activeMobileTab === 'products' && cart.length > 0 && (
          <button
            onClick={() => setActiveMobileTab('cart')}
            className="fixed bottom-20 right-4 z-40 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-full px-5 py-3 shadow-2xl flex items-center gap-2 animate-pulse cursor-pointer md:hidden"
          >
            <ShoppingCart className="w-5 h-5" />
            <span className="text-xs uppercase tracking-wider">Ver Carrito</span>
            <span className="bg-white text-rose-600 text-[10px] font-black rounded-full h-5 w-5 flex items-center justify-center">
              {cart.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
          </button>
        )}

        {/* Mobile Tab Bar */}
        {currentSession && (
          <div className="md:hidden flex bg-white dark:bg-slate-900 border-t border-slate-300 dark:border-slate-800 shrink-0 h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] relative z-30">
            <button
              onClick={() => setActiveMobileTab('products')}
              className={`flex-1 flex flex-col items-center justify-center gap-1 ${
                activeMobileTab === 'products' ? 'text-rose-600 font-extrabold' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Package className="w-5 h-5" />
              <span className="text-[10px] uppercase tracking-wider">Catálogo</span>
            </button>
            <button
              onClick={() => setActiveMobileTab('cart')}
              className={`flex-1 flex flex-col items-center justify-center gap-1 relative ${
                activeMobileTab === 'cart' ? 'text-rose-600 font-extrabold' : 'text-slate-600 dark:text-slate-400'
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
        {showCalculator && (
          <CalculatorModal 
            isOpen={showCalculator} 
            onClose={() => { 
              setShowCalculator(false); 
              focusSearch(); 
            }} 
          />
        )}
        {showPayment && (
          <PaymentModal 
            key="payment-modal" 
            total={getFinalTotal()} 
            sessionId={currentSession?.id} 
            onSurchargeChange={setActivePaymentSurcharge}
            onClose={() => { 
              setShowPayment(false); 
              setActivePaymentSurcharge(0);
              focusSearch(); 
            }} 
            onSuccess={() => { 
              clearCart(); 
              setShowPayment(false); 
              setActivePaymentSurcharge(0);
              loadProducts(true); 
              loadCurrentSession(); 
              focusSearch(); 
            }} 
          />
        )}
        {showGastos && <GastosModal key="gastos-modal" sessionId={currentSession?.id} terminalName={terminalName} onClose={() => { setShowGastos(false); loadCurrentSession(); focusSearch(); }} />}
        {showProveedores && <ProveedoresModal key="proveedores-modal" sessionId={currentSession?.id} onClose={() => { setShowProveedores(false); loadCurrentSession(); focusSearch(); }} />}
        {showCobroCtaCte && currentSession && (
          <CobroCtaCteModal 
            key="cobro-ctacte-modal" 
            sessionId={currentSession.id} 
            onClose={() => { setShowCobroCtaCte(false); focusSearch(); }} 
            onSuccess={() => { loadCurrentSession(); focusSearch(); }} 
          />
        )}
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
                type="password"
                autoFocus
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    try {
                      const { data } = await api.post('/auth/login', { username: adminUsername, password: adminPassword });
                      if (data.user.role !== 'ADMIN') {
                        toast.error('El usuario ingresado no es administrador');
                        return;
                      }
                      sessionStorage.setItem('admin_unlocked', 'true');
                      localStorage.setItem('admin_unlocked', 'true');
                      sessionStorage.setItem('adminAccessToken', data.accessToken);
                      sessionStorage.setItem('adminRefreshToken', data.refreshToken);
                      setShowAdminPrompt(false);
                      setAdminPassword('');
                      navigate('/dashboard');
                    } catch (err: any) {
                      toast.error(err.response?.data?.message || 'Credenciales incorrectas');
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
                      const { data } = await api.post('/auth/login', { username: adminUsername, password: adminPassword });
                      if (data.user.role !== 'ADMIN') {
                        toast.error('El usuario ingresado no es administrador');
                        return;
                      }
                      sessionStorage.setItem('admin_unlocked', 'true');
                      localStorage.setItem('admin_unlocked', 'true');
                      sessionStorage.setItem('adminAccessToken', data.accessToken);
                      sessionStorage.setItem('adminRefreshToken', data.refreshToken);
                      setShowAdminPrompt(false);
                      setAdminPassword('');
                      navigate('/dashboard');
                    } catch (err: any) {
                      toast.error(err.response?.data?.message || 'Credenciales incorrectas');
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
            isFollowedByZ={generateZAfterArqueo}
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
                    clientId: getClientId(),
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
                  setShowCierre(false);
                  try {
                    const res = await api.post('/cash/z-report/generate');
                    setZReportData(res.data);
                  } catch (err: any) {
                    toast.error(err.response?.data?.message || 'Error al generar cierre Z');
                  }
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
            onClose={() => {
              setZReportData(null);
              logout();
            }}
          />
        )}
        {showHistorial && <HistorialModal key="historial-modal" sessionId={currentSession?.id} onClose={() => { setShowHistorial(false); focusSearch(); }} />}
        {showCreateQuote && (
          <CreateQuoteModal
            cart={cart}
            total={getFinalTotal()}
            onClose={() => setShowCreateQuote(false)}
            onSuccess={() => {
              clearCart();
              setShowCreateQuote(false);
            }}
          />
        )}
        {showCategoryPicker && (
          <CategoryPickerModal
            categories={usableCategories}
            selectedCategory={selectedCategory}
            topCategoryIds={topCategoryIds}
            onSelect={id => { setSelectedCategory(id); setShowPromosOnly(false); }}
            onClose={() => setShowCategoryPicker(false)}
          />
        )}
        {showQuotesList && (
          <QuotesListModal
            onClose={() => setShowQuotesList(false)}
            onLoadCart={() => {
              setShowQuotesList(false);
              focusSearch();
            }}
          />
        )}
        {showAcopios && (
          <AcopioModal
            onClose={() => setShowAcopios(false)}
          />
        )}
        {substituteProduct && (
          <SubstitutesModal
            product={substituteProduct}
            onClose={() => setSubstituteProduct(null)}
            onSelectSubstitute={(sub) => {
              addToCart(sub);
              setSubstituteProduct(null);
            }}
          />
        )}
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
          <MotionDiv 
            {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })}
            className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowProfile(false)}
          >
            <MotionDiv 
              {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
              onClick={(e: any) => e.stopPropagation()} 
              className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-300 dark:border-slate-800 flex flex-col p-6 space-y-4 font-sans text-slate-800 dark:text-slate-100"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <User className="w-5 h-5 text-rose-600" /> Cambiar Contraseña
                </h3>
                <button onClick={() => setShowProfile(false)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 dark:text-slate-500"><X className="w-5 h-5" /></button>
              </div>

              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Contraseña Actual</label>
                  <div className="relative">
                    <input 
                      type={showPasswords ? "text" : "password"} 
                      value={profileOldPassword} 
                      onChange={(e) => setProfileOldPassword(e.target.value)} 
                      className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-10 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-250 outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                      placeholder="Ingresá tu contraseña actual..." 
                      required
                    />
                    <button type="button" onClick={() => setShowPasswords(!showPasswords)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-750 dark:text-slate-400 dark:hover:text-slate-300">
                      {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Nueva Contraseña</label>
                  <div className="relative">
                    <input 
                      type={showPasswords ? "text" : "password"} 
                      value={profileNewPassword} 
                      onChange={(e) => setProfileNewPassword(e.target.value)} 
                      className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pl-4 pr-10 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-250 outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                      placeholder="Nueva contraseña numérica..." 
                      required
                    />
                    <Key className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-405" />
                  </div>
                  <p className="text-[9px] text-slate-450 dark:text-slate-500 mt-1">Por razones de seguridad, la contraseña debe ser puramente numérica.</p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="submit" 
                    disabled={isSavingProfile}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="w-4.5 h-4.5" /> {isSavingProfile ? 'Guardando...' : 'Actualizar Datos'}
                  </button>
                  <button type="button" onClick={() => setShowProfile(false)} className="px-5 py-3.5 rounded-xl border border-slate-350 dark:border-slate-750 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                    Cancelar
                  </button>
                </div>
              </form>
            </MotionDiv>
          </MotionDiv>
        )}

        {showReturnModal && (
          <MotionDiv 
            {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })}
            className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setShowReturnModal(false); focusSearch(); }}
          >
            <MotionDiv 
              {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
              onClick={(e: any) => e.stopPropagation()} 
              className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-300 dark:border-slate-700 flex flex-col p-6 space-y-4 font-sans text-slate-800 dark:text-slate-200"
            >
              <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-700 pb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <CornerUpLeft className="w-5 h-5 text-rose-600" /> Registrar Devolución de Producto
                </h3>
                <button onClick={() => { setShowReturnModal(false); focusSearch(); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Buscar Producto a Devolver</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={returnSearchQuery} 
                      onChange={(e) => setReturnSearchQuery(e.target.value.toUpperCase())}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const code = returnSearchQuery.trim();
                          if (!code) return;
                          try {
                            const { data } = await api.get(`/products/barcode/${code}`);
                            setReturnProductSelected(data);
                          } catch {
                            const found = cachedProducts.find(p => p.name.toUpperCase().includes(code) || p.barcode === code);
                            if (found) {
                              setReturnProductSelected(found);
                            } else {
                              toast.error('No se encontró el producto');
                            }
                          }
                        }
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-305 dark:border-slate-700 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-750 dark:text-slate-250 outline-none focus:bg-white focus:border-rose-500 transition-all" 
                      placeholder="Escanea el código de barra o busca el nombre y presiona Enter..." 
                      autoFocus
                    />
                  </div>
                </div>

                {returnProductSelected && (
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Producto</span>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{returnProductSelected.name}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Precio Reembolso</span>
                        <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400">${returnProductSelected.salePrice}</p>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Cantidad a Devolver</label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="number" 
                      min="1" 
                      value={returnQty} 
                      onChange={(e) => setReturnQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 bg-slate-50 dark:bg-slate-800 border border-slate-305 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-extrabold text-slate-800 dark:text-slate-200 outline-none focus:bg-white focus:border-rose-500 transition-all" 
                    />
                    <span className="text-xs text-slate-500">unidades</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <button 
                    onClick={() => { setShowReturnModal(false); focusSearch(); }}
                    className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button 
                    disabled={!returnProductSelected}
                    onClick={() => {
                      if (!returnProductSelected) return;
                      addToCart(returnProductSelected, undefined, returnQty, true);
                      setShowReturnModal(false);
                      setReturnProductSelected(null);
                      setReturnSearchQuery('');
                      setReturnQty(1);
                      focusSearch();
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    Agregar Devolución
                  </button>
                </div>
              </div>
            </MotionDiv>
          </MotionDiv>
        )}
        
        {showQuickSale && (
          <QuickSaleModal
            onClose={() => setShowQuickSale(false)}
            onConfirm={(price, qty) => {
              addToCart(buildQuickSaleProduct(price), price, qty);
              playBeep();
              setShowQuickSale(false);
            }}
          />
        )}

        {showVirtualPrompt && (
          <MotionDiv 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowVirtualPrompt(false)}
          >
            <MotionDiv 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-300 dark:border-slate-700 flex flex-col p-6 space-y-4 font-sans text-slate-800 dark:text-slate-200"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-rose-600 animate-bounce" /> Registrar Carga Virtual {virtualType}
                </h3>
                <button onClick={() => setShowVirtualPrompt(false)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide">Monto de la Carga</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                  El sistema calculará el recargo correspondiente configurado (+{localStorage.getItem(virtualType === '1' ? 'virtual1_surcharge' : 'virtual2_surcharge') || '0'}%).
                </p>
              </div>

              <div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-rose-500 dark:text-rose-455 select-none pointer-events-none z-10 leading-none">$</span>
                  <input 
                    type="number" 
                    step="1"
                    min="1"
                    autoFocus
                    value={virtualPromptValue} 
                    onChange={(e) => setVirtualPromptValue(e.target.value)} 
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseFloat(virtualPromptValue);
                        if (!isNaN(val) && val > 0) {
                          const pct = Number(localStorage.getItem(virtualType === '1' ? 'virtual1_surcharge' : 'virtual2_surcharge') || '0');
                          const surchargeVal = Math.round(val * (pct / 100));
                          const finalPrice = val + surchargeVal;
                          const barcode = (localStorage.getItem(virtualType === '1' ? 'virtual1_code' : 'virtual2_code') || (virtualType === '1' ? 'VIRTUAL1' : 'VIRTUAL2')).trim().toUpperCase();
                          const virtualProduct = {
                            id: `VIRTUAL_LOAD_${virtualType}`,
                            name: `CARGA VIRTUAL (${val}+${surchargeVal})`,
                            barcode,
                            salePrice: finalPrice,
                            categoryId: 'VIRTUAL',
                            unlimitedStock: true,
                            stock: 999999
                          };
                          addToCart(virtualProduct, finalPrice, 1);
                          playBeep();
                          setShowVirtualPrompt(false);
                          setVirtualPromptValue('');
                          setTimeout(() => searchRef.current?.focus(), 50);
                        }
                      }
                    }}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl pl-10 pr-4 py-3 text-2xl font-bold text-slate-800 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-rose-500 transition-all" 
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => {
                    const val = parseFloat(virtualPromptValue);
                    if (!isNaN(val) && val > 0) {
                      const pct = Number(localStorage.getItem(virtualType === '1' ? 'virtual1_surcharge' : 'virtual2_surcharge') || '0');
                      const surchargeVal = Math.round(val * (pct / 100));
                      const finalPrice = val + surchargeVal;
                      const barcode = (localStorage.getItem(virtualType === '1' ? 'virtual1_code' : 'virtual2_code') || (virtualType === '1' ? 'VIRTUAL1' : 'VIRTUAL2')).trim().toUpperCase();
                      const virtualProduct = {
                        id: `VIRTUAL_LOAD_${virtualType}`,
                        name: `CARGA VIRTUAL (${val}+${surchargeVal})`,
                        barcode,
                        salePrice: finalPrice,
                        categoryId: 'VIRTUAL',
                        unlimitedStock: true,
                        stock: 999999
                      };
                      addToCart(virtualProduct, finalPrice, 1);
                      playBeep();
                      setShowVirtualPrompt(false);
                      setVirtualPromptValue('');
                      setTimeout(() => searchRef.current?.focus(), 50);
                    }
                  }}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4.5 h-4.5" /> Confirmar Carga
                </button>
                <button onClick={() => setShowVirtualPrompt(false)} className="px-5 py-3.5 rounded-xl border border-slate-350 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                  Cancelar
                </button>
              </div>
            </MotionDiv>
          </MotionDiv>
        )}

        {pricePromptProduct && (
          <MotionDiv 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPricePromptProduct(null)}
          >
            <MotionDiv 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-300 dark:border-slate-700 flex flex-col p-6 space-y-4 font-sans text-slate-800 dark:text-slate-200"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-rose-600" /> Precio Personalizado
                </h3>
                <button onClick={() => setPricePromptProduct(null)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{pricePromptProduct.name}</p>
                <p className="text-[10px] text-slate-550 dark:text-slate-400">Ingrese el precio para este producto en esta venta.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-650 dark:text-slate-400 uppercase tracking-wider mb-2">Monto ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-rose-500 dark:text-rose-455 select-none pointer-events-none z-10 leading-none">$</span>
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
                          checkPromoSuggestion(pricePromptProduct);
                        }
                      }
                    }}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl pl-10 pr-4 py-3 text-2xl font-bold text-slate-800 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-rose-500 transition-all" 
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
                      checkPromoSuggestion(pricePromptProduct);
                    }
                  }}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  <Check className="w-4.5 h-4.5" /> Agregar al Carrito
                </button>
                <button onClick={() => setPricePromptProduct(null)} className="px-5 py-3.5 rounded-xl border border-slate-350 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer">
                  Cancelar
                </button>
              </div>
            </MotionDiv>
          </MotionDiv>
        )}
        {qtyPromptProduct && (() => {
          const typedQty = parseFloat((promptQtyValue || '').replace(',', '.'));
          const qty = promptQtyValue.trim() === '' ? 1 : typedQty;
          const validQty = !isNaN(qty) && qty > 0;
          const closeQtyPrompt = () => { setQtyPromptProduct(null); focusSearch(); };
          const confirmQty = () => {
            if (!validQty) return;
            addToCart(qtyPromptProduct, undefined, qty);
            playBeep();
            setQtyPromptProduct(null);
            setTimeout(() => searchRef.current?.focus(), 50);
            checkPromoSuggestion(qtyPromptProduct);
          };
          const bump = (delta: number) => {
            const base = promptQtyValue.trim() === '' || isNaN(typedQty) ? 1 : typedQty;
            setPromptQtyValue(String(Math.max(1, Math.round((base + delta) * 1000) / 1000)));
          };
          const unitPrice = Number(qtyPromptProduct.salePrice) || 0;
          return (
          <div
            className="fixed inset-0 z-[150] bg-slate-900/50 flex items-center justify-center p-4"
            onClick={closeQtyPrompt}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Cantidad del producto"
              className="keep-style bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 font-sans"
            >
              <div className="flex items-start justify-between gap-3 px-5 pt-5">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Cantidad</p>
                  <h3 className="mt-1 text-lg font-extrabold leading-snug text-slate-900 dark:text-white break-words">{qtyPromptProduct.name}</h3>
                  {unitPrice > 0 && (
                    <p className="mt-0.5 text-[13px] font-semibold text-slate-500 dark:text-slate-400">{formatPrice(unitPrice)} c/u</p>
                  )}
                </div>
                <button onClick={closeQtyPrompt} className="p-1.5 -mr-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0" aria-label="Cerrar">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-5 pt-4">
                <div className="flex items-stretch gap-2">
                  <button type="button" onClick={() => bump(-1)} className="w-14 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform" aria-label="Restar uno">
                    <Minus className="w-5 h-5" />
                  </button>
                  <input
                    inputMode="decimal"
                    autoFocus
                    value={promptQtyValue}
                    onChange={(e) => setPromptQtyValue(e.target.value.replace(/[^\d.,]/g, ''))}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmQty(); }
                      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQtyPrompt(); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
                      else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
                    }}
                    placeholder="1"
                    aria-label="Cantidad"
                    className="flex-1 min-w-0 h-16 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-center text-3xl font-black tabular-nums text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-600 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 transition-colors"
                  />
                  <button type="button" onClick={() => bump(1)} className="w-14 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center active:scale-95 transition-transform" aria-label="Sumar uno">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between text-[13px]">
                  <span className="text-slate-500 dark:text-slate-400">Subtotal</span>
                  <span className="font-extrabold tabular-nums text-slate-900 dark:text-white">
                    {validQty && unitPrice > 0 ? formatPrice(unitPrice * qty) : '—'}
                  </span>
                </div>
              </div>

              <div className="px-5 pt-4 pb-5 grid grid-cols-[1fr_auto] gap-2">
                <button
                  onClick={confirmQty}
                  disabled={!validQty}
                  className="h-12 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 text-white text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition-colors"
                >
                  Agregar al carrito
                  <kbd className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/20 leading-none">Enter</kbd>
                </button>
                <button onClick={closeQtyPrompt} className="h-12 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold flex items-center gap-2">
                  Cancelar
                  <kbd className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 leading-none">Esc</kbd>
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {showHeldCartsModal && (
          <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div onClick={() => { setShowHeldCartsModal(false); focusSearch(); }} className="absolute inset-0" />
            <MotionDiv 
              {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
              className="relative bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-400 dark:border-slate-700 flex flex-col p-6 space-y-4 font-sans text-slate-800 dark:text-slate-100"
            >
              <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-700 pb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <History className="w-5 h-5 text-amber-500" /> Ventas en Espera
                </h3>
                <button onClick={() => { setShowHeldCartsModal(false); focusSearch(); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>

              <div className="overflow-y-auto max-h-[350px] space-y-2 custom-scrollbar">
                {heldCarts.length === 0 ? (
                  <div className="py-10 text-center text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center gap-2">
                    <History className="w-12 h-12 opacity-40 stroke-[1]" />
                    <p className="text-sm font-bold uppercase tracking-wider">No hay ventas en espera</p>
                  </div>
                ) : (
                  heldCarts.map((hc, hcIndex) => {
                    const itemCount = hc.cart.reduce((s, i) => s + i.quantity, 0);
                    const totalAmount = hc.cart.reduce((s, i) => s + i.price * i.quantity, 0);
                    const formattedDate = new Date(hc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    return (
                      <div
                        key={hc.id}
                        data-held-index={hcIndex}
                        onMouseEnter={() => setHeldCartIndex(hcIndex)}
                        className={`p-4 rounded-xl border-2 flex items-center justify-between gap-4 transition-colors ${
                          hcIndex === heldCartIndex
                            ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-400 dark:border-amber-600'
                            : 'bg-slate-50 dark:bg-slate-800/50 border-transparent'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-extrabold text-sm text-slate-800 dark:text-slate-200 truncate">{hc.clientName}</p>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                            <span>Hora: {formattedDate}</span>
                            <span>•</span>
                            <span>{itemCount} {itemCount === 1 ? 'artículo' : 'artículos'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-black text-sm text-slate-800 dark:text-slate-200">${totalAmount.toLocaleString()}</span>
                          <button 
                            onClick={() => {
                              resumeCart(hc.id);
                              setShowHeldCartsModal(false);
                              focusSearch();
                            }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider cursor-pointer active:scale-95 transition-all shadow-sm flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" /> Reanudar
                          </button>
                          <button 
                            onClick={() => setHeldCartToDelete({ id: hc.id, clientName: hc.clientName })}
                            className="bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 font-extrabold p-2 rounded-lg cursor-pointer active:scale-95 transition-all"
                            title="Eliminar venta en espera"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span><kbd className="font-mono font-bold px-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">↑ ↓</kbd> elegir</span>
                  <span><kbd className="font-mono font-bold px-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">Enter</kbd> reanudar</span>
                  <span><kbd className="font-mono font-bold px-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">Supr</kbd> eliminar</span>
                  <span><kbd className="font-mono font-bold px-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">Esc</kbd> cerrar</span>
                </p>
                <button onClick={() => { setShowHeldCartsModal(false); focusSearch(); }} className="px-5 py-2.5 rounded-xl border border-slate-400 dark:border-slate-750 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider cursor-pointer">
                  Cerrar
                </button>
              </div>
            </MotionDiv>
          </div>
        )}

        {/* Modern Centered Confirm Modal for Deleting Held Cart */}
        {heldCartToDelete && (
          <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div onClick={() => setHeldCartToDelete(null)} className="absolute inset-0" />
            <MotionDiv 
              {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
              className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 text-center z-10 space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 mx-auto flex items-center justify-center">
                <Trash2 className="w-6 h-6 stroke-[2.2]" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  ¿Eliminar venta en espera?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  ¿Estás seguro de que deseas eliminar la venta en espera de <strong className="text-slate-800 dark:text-slate-200">"{heldCartToDelete.clientName}"</strong>? Esta acción no se puede deshacer.
                </p>
              </div>
              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setHeldCartToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider cursor-pointer transition-all active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteHeldCart(heldCartToDelete.id);
                    setHeldCartToDelete(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider cursor-pointer transition-all active:scale-95 shadow-md shadow-rose-600/20"
                >
                  Eliminar
                </button>
              </div>
            </MotionDiv>
          </div>
        )}

        {showHoldCartInputModal && (
          <div className="fixed inset-0 z-[160] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div onClick={() => { setShowHoldCartInputModal(false); focusSearch(); }} className="absolute inset-0" />
            <MotionDiv 
              {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
              className="relative bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col p-6 space-y-5 font-sans text-slate-800 dark:text-slate-100 z-10"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3.5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 dark:text-white text-base tracking-tight">Poner Venta en Espera</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Guarda temporalmente el carrito actual</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setShowHoldCartInputModal(false); focusSearch(); }} 
                  className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nombre o Referencia del Cliente <span className="text-[10px] font-normal text-slate-400">(Opcional)</span>
                </label>
                <input 
                  type="text"
                  autoFocus
                  value={holdCartClientName}
                  onChange={(e) => setHoldCartClientName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const name = holdCartClientName.trim() || undefined;
                      holdCart(name);
                      setShowHoldCartInputModal(false);
                      setHoldCartClientName('');
                      toast.success('✅ Venta guardada en espera');
                      focusSearch();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowHoldCartInputModal(false);
                      focusSearch();
                    }
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all placeholder:text-slate-400 placeholder:font-normal"
                  placeholder="Ej: Juan, Mesa 3, Mostrador..."
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  💡 Si no indicas un nombre, se guardará automáticamente con un número correlativo.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => {
                    const name = holdCartClientName.trim() || undefined;
                    holdCart(name);
                    setShowHoldCartInputModal(false);
                    setHoldCartClientName('');
                    toast.success('✅ Venta guardada en espera');
                    focusSearch();
                  }}
                  className="flex-1 bg-slate-900 hover:bg-black dark:bg-white dark:hover:bg-slate-100 dark:text-slate-900 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4" /> Guardar Venta
                </button>
                <button 
                  onClick={() => { setShowHoldCartInputModal(false); focusSearch(); }} 
                  className="px-5 py-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </MotionDiv>
          </div>
        )}

        {showCellularModal && (
          <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div onClick={() => setShowCellularModal(false)} className="absolute inset-0" />
            <MotionDiv 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="relative bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl border border-slate-400 dark:border-slate-700 flex flex-col p-6 space-y-4 font-sans text-slate-800 dark:text-slate-100"
            >
              <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-700 pb-3">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-rose-600 animate-pulse" /> Conexión Móvil
                </h3>
                <button onClick={() => setShowCellularModal(false)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex flex-col items-center text-center space-y-3">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Escanea el código QR con la cámara de tu celular para acceder al sistema desde esta terminal.
                </p>
                
                {cellularQrCodeUrl && (
                  <div className="p-3 bg-white rounded-2xl border border-slate-350 shadow-inner flex items-center justify-center">
                    <img src={cellularQrCodeUrl} alt="Server IP QR" className="w-[180px] h-[180px]" />
                  </div>
                )}
                
                <div className="w-full bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-300 dark:border-slate-700">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Enlace de Servidor</p>
                  <p className="text-xs font-extrabold text-rose-600 dark:text-rose-400 mt-1 select-all break-all">
                    {serverTunnelUrl || `http://${serverIpValue}:${sessionStorage.getItem('active_backend_port') || '3001'}`}
                  </p>
                </div>
                
                {!serverTunnelUrl && (
                  <p className="text-[9px] text-amber-600 dark:text-amber-500 font-bold uppercase tracking-tight">
                    ⚠️ Recuerda: El celular debe estar conectado al mismo Wi-Fi que esta PC.
                  </p>
                )}
              </div>

              <div className="pt-2 text-right">
                <button onClick={() => setShowCellularModal(false)} className="px-5 py-2.5 rounded-xl border border-slate-400 dark:border-slate-750 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider cursor-pointer">
                  Cerrar
                </button>
              </div>
            </MotionDiv>
          </div>
        )}

        {/* Modal de Selección de Variante/Sabor de Combo */}
        {comboVariantModalPromo && (() => {
          const groupMap = new Map<string, any[]>();
          comboVariantModalPromo.products.forEach((pp: any, idx: number) => {
            const gId = pp.groupId || `single_${pp.productId}_${idx}`;
            if (!groupMap.has(gId)) groupMap.set(gId, []);
            groupMap.get(gId)!.push(pp);
          });
          const groups = Array.from(groupMap.entries());

          const handleConfirmComboSelection = () => {
            const metadata = groups.map(([gId, items]) => {
              const selectedPid = selectedComboVariants[gId] || items[0].productId;
              const selectedPP = items.find(i => i.productId === selectedPid) || items[0];
              const fullProd = cachedProducts.find(p => p.id === selectedPid) || selectedPP.product;
              return {
                productId: selectedPid,
                name: fullProd?.name || 'Producto',
                price: fullProd?.salePrice || 0,
                quantity: selectedPP.quantity || 1
              };
            });

            addPromoToCart(comboVariantModalPromo, cachedProducts, metadata);
            playBeep();
            setComboVariantModalPromo(null);
          };

          return (
            <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
              <div 
                onClick={() => setComboVariantModalPromo(null)} 
                className="absolute inset-0 bg-black/60 backdrop-blur-xs" 
              />
              <MotionDiv 
                initial={{ scale: 0.9, opacity: 0, y: 15 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 15 }}
                className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh] z-10"
              >
                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-purple-50 via-white to-pink-50 dark:from-purple-950/30 dark:via-slate-900 dark:to-pink-950/20 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-widest bg-purple-100 dark:bg-purple-900/40 px-2.5 py-0.5 rounded-full inline-block mb-1">
                      Personalizar Combo
                    </span>
                    <h3 className="text-base font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
                      {comboVariantModalPromo.name}
                      <span className="text-emerald-600 dark:text-emerald-400 font-extrabold text-sm bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-lg">
                        ${comboVariantModalPromo.fixedPrice || 0}
                      </span>
                    </h3>
                  </div>
                  <button 
                    onClick={() => setComboVariantModalPromo(null)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto custom-scrollbar space-y-5">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Selecciona los sabores u opciones que llevará el cliente para descontar su stock real:
                  </p>

                  {groups.map(([gId, items], gIdx) => {
                    const selectedPid = selectedComboVariants[gId] || items[0].productId;
                    const reqQty = items[0].quantity || 1;

                    return (
                      <div key={gId} className="space-y-2.5 bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-750">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                            Opción {gIdx + 1} ({reqQty} {reqQty === 1 ? 'unidad' : 'unidades'})
                          </span>
                          {items.length === 1 && (
                            <span className="text-[10px] font-bold text-slate-400 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                              Opción fija
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                          {items.map((pp: any) => {
                            const prod = cachedProducts.find(p => p.id === pp.productId) || pp.product;
                            const isSelected = selectedPid === pp.productId;
                            const isUnlimited = prod?.unlimitedStock ?? pp.product?.unlimitedStock;
                            const rawStock = prod?.stock !== undefined ? prod?.stock : pp.product?.stock;
                            const stock = typeof rawStock === 'number' ? rawStock : 0;

                            return (
                              <button
                                key={pp.productId}
                                type="button"
                                onClick={() => setSelectedComboVariants(prev => ({ ...prev, [gId]: pp.productId }))}
                                className={`w-full p-3 rounded-xl border-2 text-left flex items-center justify-between transition-all cursor-pointer ${
                                  isSelected
                                    ? 'border-purple-500 bg-white dark:bg-slate-800 shadow-md ring-2 ring-purple-100 dark:ring-purple-900/30'
                                    : 'border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-850 hover:border-purple-300 hover:bg-white'
                                }`}
                              >
                                <div className="min-w-0 flex-1 pr-2">
                                  <p className={`text-xs font-bold truncate ${isSelected ? 'text-purple-900 dark:text-purple-100' : 'text-slate-800 dark:text-slate-200'}`}>
                                    {prod?.name || 'Producto'}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-slate-400 font-medium">
                                      ${prod?.salePrice || 0} c/u
                                    </span>
                                    {isUnlimited ? (
                                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40">
                                        Stock: Ilimitado
                                      </span>
                                    ) : (
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                        stock < 0
                                          ? 'text-rose-600 font-black bg-rose-50 dark:bg-rose-950/40'
                                          : stock === 0
                                          ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/40'
                                          : 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40'
                                      }`}>
                                        Stock: {stock} un.
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                                  isSelected 
                                    ? 'bg-purple-600 text-white shadow-sm' 
                                    : 'border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                                }`}>
                                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setComboVariantModalPromo(null)}
                    className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmComboSelection}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-purple-200 dark:shadow-purple-950/50 transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4 stroke-[3]" /> Confirmar y Agregar Combo
                  </button>
                </div>
              </MotionDiv>
            </div>
          );
        })()}

        {/* Mobile Drawer Menu */}
        {showMobileMenu && (
          <div className="fixed inset-0 z-[200] flex justify-end md:hidden">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileMenu(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            />
            {/* Drawer Body */}
            <motion.div
              initial={{ x: '105%' }}
              animate={{ x: 0 }}
              exit={{ x: '105%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative w-72 max-w-full bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col z-10 border-l border-slate-300 dark:border-slate-800 outline-none"
            >
              <div className="p-4 border-b border-slate-350 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Menú de Acciones</span>
                <button onClick={() => setShowMobileMenu(false)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-655 dark:text-slate-400"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <button onClick={() => { setShowMobileMenu(false); setShowHistorial(true); }} className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left">
                  <History className="w-4 h-4 text-slate-550" /> Historial
                </button>
                <button onClick={() => { setShowMobileMenu(false); if (currentSession) setShowGastos(true); else toast.error('No hay caja abierta'); }} className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left">
                  <Receipt className="w-4 h-4 text-slate-550" /> Gastos
                </button>
                <button onClick={() => { setShowMobileMenu(false); if (currentSession) setShowCobroCtaCte(true); else toast.error('No hay caja abierta'); }} className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left">
                  <DollarSign className="w-4 h-4 text-emerald-500" /> Cobro Cta. Cte.
                </button>
                <button onClick={() => { setShowMobileMenu(false); setShowProveedores(true); }} className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left">
                  <Truck className="w-4 h-4 text-slate-550" /> Proveedores
                </button>
                <button 
                  onClick={async () => {
                    setShowMobileMenu(false);
                    try {
                      const { data } = await api.get('/cash/server-ip');
                      const activePort = sessionStorage.getItem('active_backend_port') || '3001';
                      const port = window.location.port ? window.location.port : activePort;
                      const baseUrl = `http://${data.ip}:${port}`;
                      const token = localStorage.getItem('accessToken') || '';
                      const userObj = localStorage.getItem('user') || '';
                      const serverUrl = `${baseUrl}/?token=${token}&user=${encodeURIComponent(userObj)}`;
                      const qrUrl = await QRCode.toDataURL(serverUrl);
                      setCellularQrCodeUrl(qrUrl);
                      setServerIpValue(data.ip);
                      setServerTunnelUrl('');
                      setShowCellularModal(true);
                    } catch (err) {
                      toast.error('No se pudo obtener la IP del servidor');
                    }
                  }}
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left"
                >
                  <Smartphone className="w-4 h-4 text-rose-500" /> Conectar Celular
                </button>
                <button 
                  onClick={() => {
                    setShowMobileMenu(false);
                    setProfileOldPassword('');
                    setProfileNewPassword('');
                    setShowPasswords(false);
                    setShowProfile(true);
                  }} 
                  className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left"
                >
                  <User className="w-4 h-4 text-slate-550" /> Mi Cuenta ({user?.username})
                </button>
                <button onClick={() => { setShowMobileMenu(false); setTheme(theme === 'light' ? 'dark' : 'light'); }} className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left">
                  {theme === 'light' ? <Moon className="w-4 h-4 text-rose-500" /> : <Sun className="w-4 h-4 text-amber-500" />} {theme === 'light' ? 'Modo Oscuro' : 'Modo Claro'}
                </button>
                <button onClick={() => { setShowMobileMenu(false); if (isAdmin) navigate('/dashboard'); else setShowAdminPrompt(true); }} className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-750 font-bold text-sm transition-all text-left">
                  <Settings className="w-4 h-4 text-slate-550" /> Configuración
                </button>
                <button onClick={() => { setShowMobileMenu(false); localStorage.removeItem('server_ip'); localStorage.removeItem('connection_mode'); logout(); navigate('/setup'); }} className="w-full flex items-center gap-3 py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold text-sm transition-all text-left">
                  <Server className="w-4 h-4 text-slate-550" /> Seleccionar Servidor
                </button>
              </div>
              <div className="p-4 border-t border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <button onClick={() => { setShowMobileMenu(false); logout(); }} className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm transition-all">
                  <LogOut className="w-4 h-4" /> Cerrar Sesión
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Combo Suggestion Toast - Non-intrusive, never covers cart, timer works in perfMode */}
      <AnimatePresence>
        {suggestedPromo && (
          <motion.div 
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 left-6 z-50 w-[calc(100vw-3rem)] sm:w-[380px] bg-white dark:bg-slate-900 border-2 border-rose-500 dark:border-rose-600 rounded-2xl shadow-2xl p-4 flex flex-col gap-3 select-none keep-animated"
          >
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 flex items-center justify-center border border-rose-200 dark:border-rose-800 shrink-0">
                  <Tag className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-widest leading-none">
                      ¡Llevá el Combo!
                    </span>
                    <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded leading-none">
                      {Math.ceil((promoProgress / 100) * 10)}s
                    </span>
                  </div>
                  <p className="text-xs font-black text-slate-900 dark:text-white mt-1 truncate max-w-[220px]">
                    {suggestedPromo.promo.name}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setSuggestedPromo(null)} 
                className="p-1 hover:bg-rose-100 dark:hover:bg-rose-900/20 rounded-lg text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
                title="Cerrar sugerencia"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Missing items */}
            <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1 custom-scrollbar">
              {suggestedPromo.missingItems.map((item: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[230px]">{item.product.name}</span>
                  <span className="font-black text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-800 shrink-0 font-mono text-[11px]">
                    +{item.quantity}
                  </span>
                </div>
              ))}
            </div>

            {/* Special promo price banner */}
            <div className="flex items-center justify-between gap-2 bg-rose-600 text-white px-3 py-2 rounded-xl font-bold">
              <span className="text-[10px] uppercase tracking-wider font-extrabold">Precio Especial:</span>
              <span className="text-base font-black font-mono">{formatPrice(suggestedPromoPrice)}</span>
            </div>
            
            {/* Action buttons */}
            <div className="flex gap-2">
              <button 
                onClick={() => {
                  if (suggestedPromo.missingItems && suggestedPromo.missingItems.length > 0) {
                    suggestedPromo.missingItems.forEach((mItem: any) => {
                      addToCart(mItem.product, undefined, mItem.quantity);
                    });
                  } else {
                    applySuggestedPromo(suggestedPromo.promo, cachedProducts);
                  }
                  playBeep();
                  setSuggestedPromo(null);
                }}
                className="flex-1 bg-slate-900 hover:bg-black dark:bg-white dark:text-slate-900 text-white py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-colors cursor-pointer text-center active:scale-95 shadow-sm"
              >
                FUSIONAR COMBO
              </button>
              <button 
                onClick={() => setSuggestedPromo(null)}
                className="px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer text-center active:scale-95 border border-slate-200 dark:border-slate-700"
              >
                Ignorar
              </button>
            </div>

            {/* Countdown progress bar with keep-animated */}
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-rose-600 keep-animated transition-[width] duration-75 ease-linear"
                style={{ width: `${promoProgress}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden printable receipt for 1-click reprinting */}
      {reprintSale && (
        <div id="printable-receipt" style={{ display: 'none' }}>
          <style>{`
            @media print {
              @page {
                size: 80mm 297mm;
                margin: 0 !important;
              }
              * {
                transform: none !important;
                animation: none !important;
              }
              html, body, #root {
                margin: 0 !important;
                padding: 0 !important;
                background: #fff !important;
                width: 80mm !important;
              }
              body * {
                visibility: hidden !important;
              }
              #printable-receipt, #printable-receipt * {
                visibility: visible !important;
              }
              #printable-receipt {
                display: block !important;
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 80mm !important;
                max-width: 80mm !important;
                font-family: 'Courier New', Courier, monospace !important;
                font-size: 8.5pt !important;
                line-height: 1.4 !important;
                color: #000 !important;
                background: #fff !important;
                padding: 4mm 4mm 12mm 4mm !important;
                margin: 0 !important;
                box-sizing: border-box !important;
              }
            }
          `}</style>
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', fontFamily: 'monospace', fontSize: '8pt', color: '#000', gap: '8px' }}>
            <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <h4 style={{ margin: 0, fontSize: '10.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {(localStorage.getItem('gd_store_name') || 'Ventra POS').toUpperCase()}
              </h4>
              <p style={{ margin: 0, fontWeight: 'bold' }}>REIMPRESIÓN DE TICKET</p>
              <p style={{ margin: 0, fontWeight: 'bold' }}>C.U.I.T. N° 20-35987452-9</p>
              <p style={{ margin: 0 }}>Punto de Venta N° 00004</p>
            </div>

            <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 'bold' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>N° COMP.:</span>
                <span>{'00004-' + (reprintSale.saleNumber || '').toString().padStart(8, '0')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>FECHA EMISIÓN:</span>
                <span>{new Date(reprintSale.createdAt || Date.now()).toLocaleDateString('es-AR')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>HORA EMISIÓN:</span>
                <span>{new Date(reprintSale.createdAt || Date.now()).toLocaleTimeString('es-AR')}</span>
              </div>
            </div>

            <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                <span style={{ width: '55%' }}>DETALLE</span>
                <span style={{ width: '20%', textAlign: 'center' }}>CANT.</span>
                <span style={{ width: '25%', textAlign: 'right' }}>TOTAL</span>
              </div>
              {reprintSale.items?.map((item: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ width: '55%', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.productName || item.product?.name || 'Producto'}
                  </span>
                  <span style={{ width: '20%', textAlign: 'center' }}>{(item.quantity || 1).toFixed(1)}</span>
                  <span style={{ width: '25%', textAlign: 'right' }}>${Math.round(item.total || item.unitPrice * (item.quantity || 1)).toLocaleString('es-AR')}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 'bold', fontSize: '9pt' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10pt', fontWeight: '900', borderTop: '1px dashed #000', paddingTop: '4px' }}>
                <span>TOTAL:</span>
                <span>${Math.round(reprintSale.total || 0).toLocaleString('es-AR')}</span>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '7pt', textAlign: 'center', borderTop: '1px dashed #000', paddingTop: '8px', fontWeight: 'bold' }}>
              ¡Muchas gracias por su compra!
            </p>
          </div>
        </div>
      )}
    </>
  );
}
