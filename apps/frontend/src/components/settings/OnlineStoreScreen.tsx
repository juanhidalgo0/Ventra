import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { wsService } from '../../services/websocket';
import { usePOSStore } from '../../stores/posStore';
import { 
  Globe, 
  Eye, 
  Smartphone, 
  Palette, 
  Layout, 
  Settings, 
  Truck, 
  Store, 
  ShieldCheck, 
  MessageSquare, 
  Instagram, 
  Facebook, 
  MapPin, 
  Plus,
  ChevronRight,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Save,
  Link2,
  ExternalLink,
  RefreshCw,
  Clock,
  Sparkles,
  Wifi,
  ShoppingBag,
  Sliders,
  ChevronLeft
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function OnlineStoreScreen() {
  const { products: localProducts } = usePOSStore();
  const [simulatedSelectedProduct, setSimulatedSelectedProduct] = useState<any>(null);

  // Config States (stored in localStorage or state)
  const [storeName, setStoreName] = useState(() => localStorage.getItem('gd_store_name') || 'GO! TIENDA ONLINE');
  const [subdomain, setSubdomain] = useState(() => localStorage.getItem('gd_subdomain') || 'go-kiosco');
  const [whatsapp, setWhatsapp] = useState(() => localStorage.getItem('gd_whatsapp') || '5491123456789');
  const accentColor = '#e11d48'; // GoDelivery Cherry Red
  const [isStoreActive, setIsStoreActive] = useState(() => (localStorage.getItem('gd_store_active') || 'true') === 'true');
  const [viewMode, setViewMode] = useState<'GRID' | 'LIST'>(() => (localStorage.getItem('gd_view_mode') || 'GRID') as 'GRID' | 'LIST');
  const [deliveryMode, setDeliveryMode] = useState<'BOTH' | 'PICKUP' | 'DELIVERY'>(() => (localStorage.getItem('gd_delivery_mode') || 'BOTH') as 'BOTH' | 'PICKUP' | 'DELIVERY');
  const [deliveryFee, setDeliveryFee] = useState(() => Number(localStorage.getItem('gd_delivery_fee') || 800));
  const [freeShippingThreshold, setFreeShippingThreshold] = useState(() => Number(localStorage.getItem('gd_free_shipping') || 8000));
  
  const [schedules, setSchedules] = useState<{ open: string; close: string }[]>(() => {
    const saved = localStorage.getItem('gd_schedules');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return [{ open: '08:00', close: '20:00' }];
  });
  
  const [instagram, setInstagram] = useState(() => localStorage.getItem('gd_instagram') || '@go_kiosco');
  const [facebook, setFacebook] = useState(() => localStorage.getItem('gd_facebook') || 'go.kiosco');
  const [address, setAddress] = useState(() => localStorage.getItem('gd_address') || 'Av. Rivadavia 1234, CABA');

  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // GoDelivery Stats and Orders States
  const [statsData, setStatsData] = useState<any>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const loadStats = async () => {
    const googleUserStr = localStorage.getItem('google_authenticated_user');
    const googleUser = googleUserStr ? JSON.parse(googleUserStr) : null;
    const email = googleUser?.email;

    if (!email) {
      setStatsData(null);
      setStatsError('No se ha vinculado ninguna cuenta de Google en esta terminal. Conéctela desde el Dashboard.');
      return;
    }

    setIsLoadingStats(true);
    setStatsError(null);
    try {
      const { data } = await api.get('/products/godelivery/stats', {
        params: { email }
      });
      setStatsData(data);
      if (data?.commerce) {
        if (data.commerce.name) setStoreName(data.commerce.name);
        if (data.commerce.subdomain) {
          setSubdomain(data.commerce.subdomain);
          setPreviewSubdomain(data.commerce.subdomain);
        }
        if (data.commerce.whatsapp) setWhatsapp(data.commerce.whatsapp);
        if (data.commerce.address) setAddress(data.commerce.address);
        if (data.commerce.instagram) setInstagram(data.commerce.instagram);
        if (data.commerce.facebook) setFacebook(data.commerce.facebook);
        if (data.commerce.schedules) setSchedules(data.commerce.schedules);
      }
    } catch (err: any) {
      console.error(err);
      setStatsError(err.response?.data?.message || 'Error al conectar con GoDelivery. Asegúrate de tener configurado el archivo firebase-credentials.json en el servidor.');
    } finally {
      setIsLoadingStats(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  // Debounced subdomain for live preview to avoid constant reloading while typing
  const [previewSubdomain, setPreviewSubdomain] = useState(subdomain);

  useEffect(() => {
    const handler = setTimeout(() => {
      setPreviewSubdomain(subdomain);
    }, 800);
    return () => clearTimeout(handler);
  }, [subdomain]);

  useEffect(() => {
    wsService.connect();
    
    const handleSyncProgress = (data: any) => {
      if (data.isComplete) {
        setIsSyncing(false);
        if (data.error) {
          toast.error(`❌ Error en la sincronización: ${data.error}`);
        } else {
          toast.success(
            `🚀 Sincronización masiva finalizada con éxito:\n` +
            `• Sincronizados: ${data.current || 0} productos\n` +
            `• Omitidos (sin código de barras): ${data.omittedCount || 0}\n` +
            `• Fallidos: ${data.failedCount || 0}`,
            { duration: 6000 }
          );
        }
      } else {
        setIsSyncing(true);
      }
    };

    wsService.on('sync:progress', handleSyncProgress);
    return () => {
      wsService.off('sync:progress', handleSyncProgress);
    };
  }, []);

  // Sync handler calling backend API
  const handleForceSync = async () => {
    setIsSyncing(true);
    try {
      const googleUserStr = localStorage.getItem('google_authenticated_user');
      const googleUser = googleUserStr ? JSON.parse(googleUserStr) : null;
      const email = googleUser?.email;

      await api.post('/products/sync-all', { googleEmail: email });
      toast.success('🚀 Proceso de sincronización iniciado...');
    } catch (err: any) {
      setIsSyncing(false);
      const errMsg = err.response?.data?.message || 'Error al iniciar la sincronización';
      toast.error(`❌ ${errMsg}`);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const googleUserStr = localStorage.getItem('google_authenticated_user');
      const googleUser = googleUserStr ? JSON.parse(googleUserStr) : null;
      const email = googleUser?.email;

      if (!email) {
        throw new Error('Debes vincular tu cuenta de Google en esta terminal para sincronizar y guardar configuraciones con GoDelivery.');
      }

      await api.post('/products/godelivery/settings', {
        googleEmail: email,
        storeName,
        whatsapp,
        address,
        instagram,
        facebook,
        isActive: isStoreActive,
        viewMode,
        schedules
      });

      // Save to local storage as local backup
      localStorage.setItem('gd_store_name', storeName);
      localStorage.setItem('gd_subdomain', subdomain);
      localStorage.setItem('gd_whatsapp', whatsapp);
      localStorage.setItem('gd_accent_color', accentColor);
      localStorage.setItem('gd_store_active', String(isStoreActive));
      localStorage.setItem('gd_view_mode', viewMode);
      localStorage.setItem('gd_instagram', instagram);
      localStorage.setItem('gd_facebook', facebook);
      localStorage.setItem('gd_address', address);
      localStorage.setItem('gd_schedules', JSON.stringify(schedules));

      toast.success('✨ ¡Configuración de GoDelivery guardada y sincronizada con éxito!');
      loadStats();
    } catch (err: any) {
      console.error(err);
      const errMsg = err.response?.data?.message || err.message || 'Error al guardar la configuración';
      toast.error(`❌ ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Add a schedule slot
  const handleAddSchedule = () => {
    if (schedules.length >= 3) {
      toast.error('Puedes configurar hasta 3 rangos horarios de atención.');
      return;
    }
    setSchedules([...schedules, { open: '09:00', close: '20:00' }]);
  };

  // Remove a schedule slot
  const handleRemoveSchedule = (index: number) => {
    if (schedules.length <= 1) {
      toast.error('Debe haber al menos 1 rango horario configurado.');
      return;
    }
    const updated = schedules.filter((_, i) => i !== index);
    setSchedules(updated);
  };

  // Update a specific schedule slot
  const handleUpdateSchedule = (index: number, field: 'open' | 'close', value: string) => {
    const updated = schedules.map((item, i) => {
      if (i === index) {
        return { ...item, [field]: value };
      }
      return item;
    });
    setSchedules(updated);
  };

  if (isLoadingStats) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#f8fafc] gap-4">
        <div className="relative flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-rose-100 border-t-rose-500 rounded-full animate-spin" />
          <Globe className="w-6 h-6 text-rose-500 absolute animate-pulse-soft" />
        </div>
        <div className="text-center">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Cargando Tienda Online</h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Estableciendo conexión segura con GoDelivery Cloud...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-6 bg-[#f8fafc] p-6 overflow-y-auto custom-scrollbar pb-16">
      {/* Header Info */}
      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
           <div className="w-12 h-12 rounded-2xl bg-rose-55 flex items-center justify-center text-rose-600 shadow-inner">
              <Globe className="w-6 h-6 animate-pulse-soft" />
           </div>
           <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-800">Red de Negocios — GoDelivery Cloud</h3>
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] mt-1">Sincronización en tiempo real y portal web autogestionado</p>
           </div>
        </div>
        
        <div className="flex items-center gap-3 shrink-0">
          <button 
            onClick={handleForceSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-extrabold uppercase tracking-wider text-slate-650 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Sincronizar</span>
          </button>
          
          <a 
            href={`https://godelivery-magdalena.web.app/#/comercio/${subdomain}`}
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-extrabold uppercase tracking-wider text-slate-650 hover:bg-slate-50 transition-all cursor-pointer"
          >
            <ExternalLink className="w-4 h-4 text-slate-500" />
            <span>Ver Web</span>
          </a>

          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider text-white shadow-lg active:scale-95 transition-all cursor-pointer"
            style={{ backgroundColor: accentColor, boxShadow: `0 10px 15px -3px ${accentColor}30` }}
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Guardando...' : 'Guardar'}</span>
          </button>
        </div>
      </div>

      <div className="w-full max-w-4xl mx-auto">
        <div className="space-y-6">
          
          {/* Cloud Sync & GoDelivery Stats Status */}
          {isLoadingStats ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-extrabold uppercase tracking-wider text-slate-400">Cargando métricas de GoDelivery...</p>
            </div>
          ) : statsError ? (
            <div className="bg-white p-6 rounded-2xl border border-rose-100 shadow-sm flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0 border border-rose-100">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="text-xs font-black text-rose-800 uppercase tracking-wider">Estado Offline — Tienda Desconectada</h4>
                <p className="text-xs text-slate-500 font-bold mt-1.5">{statsError}</p>
                <button
                  onClick={loadStats}
                  className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[9px] font-extrabold uppercase tracking-wider text-slate-650 transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  <RefreshCw className="w-3 h-3 text-slate-500" />
                  Reintentar Conexión
                </button>
              </div>
            </div>
          ) : statsData ? (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-rose-500 animate-pulse-soft" /> Métricas Reales de Tienda Online (GoDelivery)
                  </span>
                  <button onClick={loadStats} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-inner">
                    <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Ventas Online</span>
                    <span className="text-lg font-black text-emerald-600">
                      {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(statsData.stats?.totalRevenue || 0)}
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-inner">
                    <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Pedidos Totales</span>
                    <span className="text-lg font-black text-slate-800">{statsData.stats?.totalOrders || 0}</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-inner">
                    <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Pedidos Pendientes</span>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-black text-slate-800">{statsData.stats?.pendingOrders || 0}</span>
                      {(statsData.stats?.pendingOrders || 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[8px] font-extrabold animate-pulse">NUEVO</span>
                      )}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-inner">
                    <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Productos en Nube</span>
                    <span className="text-lg font-black text-slate-800">{statsData.stats?.totalProducts || 0}</span>
                  </div>
                </div>
              </div>

              {/* Pedidos Recientes */}
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 border-b border-slate-100 pb-3">
                  <ShoppingBag className="w-4 h-4 text-rose-500" /> Últimos Pedidos Recibidos (Tienda Online)
                </h4>
                
                {statsData.recentOrders?.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 font-bold uppercase text-[9.5px]">
                    No se han registrado pedidos online todavía
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-[9px] uppercase text-slate-400 font-bold tracking-wider font-sans">
                          <th className="py-2.5 px-4 font-black">Código / Cliente</th>
                          <th className="py-2.5 px-4 font-black">Fecha</th>
                          <th className="py-2.5 px-4 text-right font-black">Total</th>
                          <th className="py-2.5 px-4 text-center font-black">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsData.recentOrders.map((o: any) => (
                          <tr key={o.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40 transition-all">
                            <td className="py-3 px-4 font-bold text-slate-800">
                              <div className="flex flex-col">
                                <span className="font-mono text-[9.5px] text-indigo-600 uppercase tracking-tight">#{o.id.substring(0, 8)}</span>
                                <span className="text-xs mt-0.5">{o.clientName}</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-slate-500 font-semibold">
                              {o.createdAt ? new Date(o.createdAt).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : 'Reciente'}
                            </td>
                            <td className="py-3 px-4 text-slate-800 font-extrabold text-right">
                              {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(o.total || 0)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className={`text-[8.5px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                o.status === 'pending' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                o.status === 'delivered' || o.status === 'completed' || o.status === 'entregado' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                'bg-rose-50 text-rose-600 border border-rose-100'
                              }`}>
                                {o.status === 'pending' ? 'Pendiente' : 
                                 o.status === 'delivered' || o.status === 'completed' || o.status === 'entregado' ? 'Entregado' : 
                                 o.status === 'accepted' ? 'Aceptado' : o.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center p-8 gap-3">
              <Globe className="w-8 h-8 text-slate-300 animate-pulse" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Conexión con GoDelivery pendiente de vinculación</p>
            </div>
          )}

          {/* Identidad Digital */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 border-b border-slate-100 pb-3">
               <Sparkles className="w-4 h-4 text-indigo-500" /> Identidad Digital de la Tienda
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Nombre Comercial Web</label>
                <input 
                  type="text" 
                  value={storeName} 
                  onChange={(e) => setStoreName(e.target.value.toUpperCase())}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-300 focus:ring-1 focus:ring-slate-350 transition-all shadow-inner" 
                  placeholder="GO! TIENDA ONLINE" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Subdominio Público GoDelivery</label>
                <div className="flex flex-col sm:flex-row sm:items-stretch gap-2 sm:gap-0 sm:border sm:border-slate-200 sm:rounded-xl sm:overflow-hidden bg-slate-50 focus-within:bg-white focus-within:border-slate-300 focus-within:ring-1 focus-within:ring-slate-350 transition-all sm:shadow-inner">
                  <div className="bg-slate-100 sm:bg-slate-150 px-3 py-2.5 flex items-center justify-center text-[9px] sm:text-[9.5px] font-bold sm:font-extrabold text-slate-500 tracking-wider border border-slate-200 sm:border-0 rounded-xl sm:rounded-none select-none">
                    godelivery-magdalena.web.app/#/comercio/
                  </div>
                  <input 
                    type="text" 
                    value={subdomain} 
                    onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    className="w-full sm:flex-1 bg-slate-50 sm:bg-transparent border border-slate-200 sm:border-0 rounded-xl sm:rounded-none px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white sm:focus:bg-transparent transition-all shadow-inner sm:shadow-none" 
                    placeholder="go-kiosco"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Horarios de Atención (Interactive Time Slots - Up to 3) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                 <Clock className="w-4 h-4 text-indigo-500 self-center" /> Horarios de Atención Web
              </h4>
              <button 
                type="button" 
                onClick={handleAddSchedule}
                disabled={schedules.length >= 3}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-[9px] font-extrabold uppercase tracking-wider text-indigo-650 transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
              >
                <Plus className="w-3 h-3" />
                <span>Agregar Horario</span>
              </button>
            </div>

            <div className="space-y-3">
              {schedules.map((schedule, index) => (
                <div key={index} className="flex items-center gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-150 shadow-inner">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1">Apertura (Desde)</span>
                      <input 
                        type="time" 
                        value={schedule.open} 
                        onChange={(e) => handleUpdateSchedule(index, 'open', e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-705 outline-none focus:border-slate-350 transition-all shadow-sm"
                      />
                    </div>
                    <div>
                      <span className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1">Cierre (Hasta)</span>
                      <input 
                        type="time" 
                        value={schedule.close} 
                        onChange={(e) => handleUpdateSchedule(index, 'close', e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-705 outline-none focus:border-slate-350 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  <button 
                    type="button"
                    onClick={() => handleRemoveSchedule(index)}
                    disabled={schedules.length <= 1}
                    className="p-2 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg transition-colors border border-rose-100 self-end disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Apariencia y Colores */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 border-b border-slate-100 pb-3">
               <Palette className="w-4 h-4 text-indigo-500" /> Apariencia y Diseño Web
            </h4>
            
            <div className="space-y-3">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Diseño de Catálogo Web</span>
               <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setViewMode('GRID')}
                    className={`p-3 rounded-xl border-2 cursor-pointer flex items-center gap-3 transition-all ${viewMode === 'GRID' ? 'border-slate-400 bg-slate-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                  >
                     <Layout className="w-4 h-4 text-slate-650" />
                     <div className="text-left leading-none">
                       <p className="text-[10px] font-bold text-slate-800 uppercase">Grilla</p>
                       <p className="text-[8px] text-slate-400 font-bold uppercase mt-1">2 Columnas</p>
                     </div>
                  </button>
                  <button 
                    onClick={() => setViewMode('LIST')}
                    className={`p-3 rounded-xl border-2 cursor-pointer flex items-center gap-3 transition-all ${viewMode === 'LIST' ? 'border-slate-400 bg-slate-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}
                  >
                     <Sliders className="w-4 h-4 text-slate-650" />
                     <div className="text-left leading-none">
                       <p className="text-[10px] font-bold text-slate-800 uppercase">Lista</p>
                       <p className="text-[8px] text-slate-400 font-bold uppercase mt-1">Compacto</p>
                     </div>
                  </button>
               </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
               <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Logo de Kiosco</span>
                  <div className="w-full h-28 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 gap-1.5 cursor-pointer hover:border-slate-300 transition-all group shadow-inner">
                     <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                     <span className="text-[9px] font-bold uppercase">Subir Logo PNG</span>
                  </div>
               </div>
               <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Banner de Portada</span>
                  <div className="w-full h-28 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 gap-1.5 cursor-pointer hover:border-slate-300 transition-all group shadow-inner">
                     <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                     <span className="text-[9px] font-bold uppercase">Subir Banner Web</span>
                  </div>
               </div>
            </div>
          </div>

          {/* Redes Sociales, Localización y Whatsapp */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 border-b border-slate-100 pb-3">
               <MessageSquare className="w-4 h-4 text-indigo-500" /> Redes Sociales y Localización
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Instagram</label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 w-4 h-4 flex items-center justify-center text-slate-400">
                    <Instagram className="w-4 h-4" />
                  </div>
                  <input 
                    type="text" 
                    value={instagram} 
                    onChange={(e) => setInstagram(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-300 transition-all shadow-inner" 
                    placeholder="@usuario" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Facebook</label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 w-4 h-4 flex items-center justify-center text-slate-400">
                    <Facebook className="w-4 h-4" />
                  </div>
                  <input 
                    type="text" 
                    value={facebook} 
                    onChange={(e) => setFacebook(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-300 transition-all shadow-inner" 
                    placeholder="nombre_pagina" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">WhatsApp</label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 w-4 h-4 flex items-center justify-center text-emerald-600 font-extrabold text-xs">
                    +
                  </div>
                  <input 
                    type="text" 
                    value={whatsapp} 
                    onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-300 transition-all shadow-inner" 
                    placeholder="5491123456789" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Dirección Física</label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 w-4 h-4 flex items-center justify-center text-slate-400">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <input 
                    type="text" 
                    value={address} 
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-300 transition-all shadow-inner" 
                    placeholder="Av. Rivadavia 1234" 
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
