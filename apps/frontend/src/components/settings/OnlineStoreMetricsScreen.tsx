import { useState, useEffect } from 'react';
import { 
  Globe, 
  TrendingUp, 
  ShoppingBag, 
  DollarSign, 
  Coins, 
  Calendar, 
  RefreshCw, 
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

interface OrderItem {
  name: string;
  qty: number;
  price: number;
  cost: number;
  total: number;
  profit: number;
}

interface Order {
  id: string;
  orderId: string;
  clientName: string;
  total: number;
  subtotal: number;
  profit: number;
  status: string;
  createdAt: string;
  items: OrderItem[];
}

interface MetricsResponse {
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  totalOrders: number;
  orders: Order[];
}

export default function OnlineStoreMetricsScreen() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  const googleUserStr = localStorage.getItem('google_authenticated_user');
  const googleUser = googleUserStr ? JSON.parse(googleUserStr) : null;
  const email = googleUser?.email;

  const loadMetrics = async () => {
    if (!email) {
      setError('No hay ninguna cuenta de Google vinculada. Por favor, conéctela en la configuración de la tienda.');
      return;
    }

    setLoading(true);
    setError(null);

    let fromStr = '';
    let toStr = '';

    const today = new Date();
    if (period === 'today') {
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      fromStr = startOfToday.toISOString();
    } else if (period === 'week') {
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - 7);
      fromStr = startOfWeek.toISOString();
    } else if (period === 'month') {
      const startOfMonth = new Date(today);
      startOfMonth.setMonth(today.getMonth() - 1);
      fromStr = startOfMonth.toISOString();
    } else if (period === 'custom') {
      if (fromDate) fromStr = new Date(fromDate).toISOString();
      if (toDate) {
        const endOfToDate = new Date(toDate);
        endOfToDate.setHours(23, 59, 59, 999);
        toStr = endOfToDate.toISOString();
      }
    }

    try {
      const { data } = await api.get('/sales/godelivery/metrics', {
        params: { email, from: fromStr, to: toStr }
      });
      setMetrics(data);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.message || 'Error al obtener las métricas de la Tienda Online.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [period, fromDate, toDate]);

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(val);
  };

  if (!email) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-slate-50">
        <div className="max-w-md bg-white p-8 rounded-2xl border border-slate-300 shadow-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mx-auto mb-4 border border-amber-100">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h3 className="text-base font-black text-slate-800 uppercase tracking-wider">Tienda Online Desconectada</h3>
          <p className="text-xs text-slate-700 font-bold mt-2 leading-relaxed">
            Debes vincular una cuenta de Google en esta terminal desde la configuración de la Tienda Online para poder sincronizar y ver las métricas de GoDelivery.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-6 bg-slate-50 p-6 overflow-y-auto custom-scrollbar pb-16">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between shrink-0">
        <div className="flex items-center gap-4 text-left">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shadow-inner">
            <Globe className="w-6 h-6 animate-pulse-soft" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-800">Estadísticas de Tienda Online (GoDelivery)</h3>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.15em] mt-0.5">Control de facturación, costos y utilidades del canal digital</p>
          </div>
        </div>

        <button 
          onClick={loadMetrics}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-400 bg-white text-xs font-extrabold uppercase tracking-wider text-slate-650 hover:bg-slate-50 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 text-slate-700 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Period Selector */}
      <div className="bg-white p-4 rounded-2xl border border-slate-150 shadow-sm flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex bg-slate-100 border border-slate-400 rounded-xl p-1 shrink-0">
          <button 
            onClick={() => setPeriod('today')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'today' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            Hoy
          </button>
          <button 
            onClick={() => setPeriod('week')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'week' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            7 Días
          </button>
          <button 
            onClick={() => setPeriod('month')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'month' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            30 Días
          </button>
          <button 
            onClick={() => setPeriod('custom')} 
            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${period === 'custom' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-700 hover:text-slate-800'}`}
          >
            Personalizado
          </button>
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <input 
              type="date" 
              value={fromDate} 
              onChange={(e) => setFromDate(e.target.value)} 
              className="bg-slate-50 border border-slate-400 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none" 
            />
            <span className="text-xs font-black text-slate-600 uppercase">al</span>
            <input 
              type="date" 
              value={toDate} 
              onChange={(e) => setToDate(e.target.value)} 
              className="bg-slate-50 border border-slate-400 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none" 
            />
          </div>
        )}
      </div>

      {error ? (
        <div className="bg-rose-50 border border-rose-150 p-4 rounded-xl text-rose-700 text-xs font-bold flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : loading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12">
          <div className="w-12 h-12 border-4 border-rose-100 border-t-rose-600 rounded-full animate-spin mb-4" />
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">Analizando registros en la nube...</p>
        </div>
      ) : metrics ? (
        <div className="space-y-6">
          {/* KPI Dashboard Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">Facturación Digital</span>
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-505 flex items-center justify-center text-rose-600">
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <span className="text-2xl font-black text-slate-800 leading-none">{formatCurrency(metrics.totalRevenue)}</span>
              <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-2">Ingresos por productos</span>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">Costo de Mercadería</span>
                <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-505 flex items-center justify-center text-slate-700">
                  <Coins className="w-4 h-4" />
                </div>
              </div>
              <span className="text-2xl font-black text-slate-800 leading-none">{formatCurrency(metrics.totalCost)}</span>
              <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-2">Valor de compra local</span>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">Ganancia Neta</span>
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-505 flex items-center justify-center text-emerald-600">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <span className="text-2xl font-black text-emerald-600 leading-none">{formatCurrency(metrics.netProfit)}</span>
              <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mt-2">Margen total de utilidad</span>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">Pedidos Concluidos</span>
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-505 flex items-center justify-center text-rose-600">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
              <span className="text-2xl font-black text-slate-800 leading-none">{metrics.totalOrders}</span>
              <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-2">Entregas exitosas</span>
            </div>
          </div>

          {/* Orders list */}
          <div className="bg-white p-6 rounded-2xl border border-slate-150 shadow-sm space-y-4">
            <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.2em] flex items-center gap-2 border-b border-slate-300 pb-3">
              <ShoppingBag className="w-4 h-4 text-rose-500" /> Detalle de Ventas e Ítems Sincronizados
            </h4>

            {metrics.orders.length === 0 ? (
              <div className="text-center py-12 text-slate-600 font-bold uppercase text-[9.5px]">
                No hay ventas registradas en este período
              </div>
            ) : (
              <div className="space-y-3">
                {metrics.orders.map((o) => {
                  const isExpanded = !!expandedOrders[o.id];
                  return (
                    <div key={o.id} className="border border-slate-400 rounded-xl overflow-hidden shadow-xs hover:border-slate-300 transition-all bg-white">
                      {/* Accordion Header */}
                      <div 
                        onClick={() => toggleOrderExpand(o.id)}
                        className="p-4 flex items-center justify-between gap-4 cursor-pointer select-none text-left"
                      >
                        <div>
                          <span className="font-mono text-[10px] text-rose-600 uppercase tracking-tight block">#{o.orderId || o.id.substring(0, 8)}</span>
                          <span className="text-xs font-black text-slate-800 block mt-0.5">{o.clientName}</span>
                          <span className="text-[9px] text-slate-600 font-semibold block mt-0.5">
                            {new Date(o.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <span className="text-[9px] text-slate-600 font-bold uppercase tracking-wider block">Facturado</span>
                            <span className="text-xs font-extrabold text-slate-800">{formatCurrency(o.subtotal)}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] text-slate-600 font-bold uppercase tracking-wider block">Ganancia</span>
                            <span className="text-xs font-black text-emerald-600">{formatCurrency(o.profit)}</span>
                          </div>
                          <div className="text-slate-600">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </div>
                      </div>

                      {/* Accordion Content */}
                      {isExpanded && (
                        <div className="bg-slate-50/50 border-t border-slate-300 p-4 space-y-3">
                          <div className="text-[9px] font-black text-slate-600 uppercase tracking-wider mb-2">Desglose de Productos y Costos</div>
                          <div className="space-y-2">
                            {o.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between items-center bg-white border border-slate-300 p-3 rounded-lg shadow-2xs text-left">
                                <div>
                                  <div className="text-xs font-extrabold text-slate-800">{item.name}</div>
                                  <div className="text-[9.5px] text-slate-600 mt-1 font-semibold">
                                    Cantidad: <span className="text-slate-700 font-bold">{item.qty}</span> • Costo unitario: <span className="text-slate-700 font-bold">{formatCurrency(item.cost)}</span> • Venta: <span className="text-slate-700 font-bold">{formatCurrency(item.price)}</span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-xs font-extrabold text-slate-800">{formatCurrency(item.total)}</div>
                                  <div className="text-[10px] text-emerald-600 font-black mt-0.5">+{formatCurrency(item.profit)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white p-8 rounded-2xl border border-slate-150 shadow-sm text-center">
          <p className="text-xs text-slate-700 font-bold uppercase">No se pudieron recuperar datos de métricas</p>
        </div>
      )}
    </div>
  );
}
