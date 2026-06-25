import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import { X, ShoppingBag, RefreshCw, Clock, ArrowRight, User, CornerDownRight, Receipt, History, Search, Calendar } from 'lucide-react';

export default function HistorialModal({ sessionId, onClose }: { sessionId?: string; onClose: () => void }) {
  const [sales, setSales] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'sales' | 'returns'>('sales');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterHour, setFilterHour] = useState('');
  const [filterMethod, setFilterMethod] = useState('ALL');
  const [viewAll, setViewAll] = useState(false);
  const [filterDate, setFilterDate] = useState('');

  useEffect(() => {
    loadSales();
  }, [sessionId, viewAll]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const loadSales = async () => {
    setIsLoading(true);
    try {
      const params: any = { limit: 100 };
      if (!viewAll) {
        if (!sessionId) {
          setIsLoading(false);
          return;
        }
        params.sessionId = sessionId;
      }
      const { data } = await api.get('/sales', { params });
      setSales(data);
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  const filteredSales = sales.filter(sale => {
    // 1. Filter by Tab
    if (activeTab === 'sales' && sale.status !== 'COMPLETED') return false;
    if (activeTab === 'returns' && sale.status === 'COMPLETED') return false;

    // 2. Filter by Payment Method
    if (filterMethod !== 'ALL' && sale.paymentMethodSummary !== filterMethod) return false;

    // 3. Filter by Hour
    if (filterHour) {
      const saleTime = new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (!saleTime.includes(filterHour)) return false;
    }

    // 4. Filter by Search Term (Ticket or Product)
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      const matchesTicket = sale.saleNumber.toString().includes(s);
      const matchesProduct = sale.items?.some((item: any) => item.productName.toLowerCase().includes(s));
      if (!matchesTicket && !matchesProduct) return false;
    }

    // 5. Filter by Date
    if (filterDate) {
      const saleDateString = new Date(sale.createdAt).toISOString().split('T')[0];
      if (saleDateString !== filterDate) return false;
    }

    return true;
  });

  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }} 
        exit={{ scale: 0.95, opacity: 0, y: 20 }} 
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl overflow-hidden shadow-xl border border-slate-400 dark:border-slate-700 flex flex-col h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 dark:bg-indigo-700 rounded-xl text-white">
              <History className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Historial Global</h2>
              <p className="text-xs text-slate-700 dark:text-slate-400 mt-0.5">Ventas correlativas y auditoría</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-500 hover:text-rose-500 transition-all"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* List Section */}
          <div className="w-3/5 flex flex-col border-r border-slate-300 dark:border-slate-800 overflow-hidden bg-slate-50/50 dark:bg-slate-900/50">
            {/* Tabs & Scope Toggle */}
            <div className="px-6 pt-3 flex items-center justify-between border-b border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
              <div className="flex gap-6">
                <button onClick={() => { setActiveTab('sales'); setSelectedSale(null); }} className={`pb-2.5 text-xs font-semibold transition-all relative ${activeTab === 'sales' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}>
                  Ventas ({sales.filter(s => s.status === 'COMPLETED').length})
                  {activeTab === 'sales' && <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-full" />}
                </button>
                <button onClick={() => { setActiveTab('returns'); setSelectedSale(null); }} className={`pb-2.5 text-xs font-semibold transition-all relative ${activeTab === 'returns' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}>
                  Devoluciones ({sales.filter(s => s.status !== 'COMPLETED').length})
                  {activeTab === 'returns' && <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400 rounded-full" />}
                </button>
              </div>

              {/* Toggler */}
              <div className="pb-2.5 flex items-center gap-2">
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={viewAll} 
                    onChange={(e) => {
                      setViewAll(e.target.checked);
                      setSelectedSale(null);
                    }}
                    className="sr-only peer" 
                  />
                  <div className="keep-style w-8 h-4 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-1 peer-focus:ring-indigo-350 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-350 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600 dark:peer-checked:bg-indigo-500"></div>
                  <span className="ml-2 text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Ver todas las cajas</span>
                </label>
              </div>
            </div>

            {/* Advanced Filters */}
            <div className="px-5 py-3 bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 shrink-0 space-y-2.5">
              <div className="flex gap-2.5">
                <div className="relative flex-1 flex items-center">
                  <Search className="absolute left-3 w-4 h-4 text-slate-600 dark:text-slate-400 pointer-events-none" />
                  <input 
                    type="text" 
                    placeholder="Buscar por Ticket # o Producto..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 placeholder:text-slate-600 dark:placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                  />
                </div>
                <div className="relative w-44 flex items-center">
                  <Calendar className="absolute left-3 w-4 h-4 text-slate-600 dark:text-slate-400 z-10 pointer-events-none" />
                  <input 
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 focus:border-indigo-400 outline-none transition-all cursor-pointer"
                  />
                </div>
                <div className="relative w-36 flex items-center">
                  <Clock className="absolute left-3 w-4 h-4 text-slate-600 dark:text-slate-400 z-10 pointer-events-none" />
                  <select 
                    value={filterHour}
                    onChange={(e) => setFilterHour(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 appearance-none cursor-pointer focus:border-indigo-400 outline-none transition-all"
                  >
                    <option value="">Hora</option>
                    {Array.from({ length: 24 }).map((_, i) => {
                      const h = i.toString().padStart(2, '0');
                      return <option key={h} value={h}>{h}:00 hs</option>;
                    })}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider shrink-0">Método:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['ALL', 'CASH', 'CLOVER', 'MERCADOPAGO', 'MIXED', 'DEBT'].map((m) => (
                    <button 
                      key={m} 
                      onClick={() => setFilterMethod(m)}
                      className={`px-2.5 py-1.5 rounded-md text-[10px] font-semibold transition-all ${filterMethod === m ? 'bg-indigo-600 dark:bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                    >
                      {m === 'ALL' ? 'Todos' : m === 'CASH' ? 'Efectivo' : m === 'MERCADOPAGO' ? 'MercadoPago' : m === 'DEBT' ? 'Cta.Cte' : m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-10 h-10 border-4 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em]">Sincronizando registros...</p>
                </div>
              ) : filteredSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-30">
                  <ShoppingBag className="w-16 h-16 mb-4 dark:text-slate-400" />
                  <p className="text-xs font-bold uppercase tracking-widest dark:text-slate-400">Sin resultados</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredSales.map((sale) => (
                    <button 
                       key={sale.id} 
                       onClick={() => setSelectedSale(sale)}
                       className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${selectedSale?.id === sale.id ? 'bg-indigo-600 dark:bg-indigo-500 text-white' : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-500/50 text-slate-700 dark:text-slate-200'}`}
                    >
                      <div className="flex items-center gap-4">
                        <span className={`text-xs font-bold min-w-[30px] ${selectedSale?.id === sale.id ? 'text-indigo-200 dark:text-indigo-100' : 'text-indigo-600 dark:text-indigo-400'}`}>#{sale.saleNumber}</span>
                        <div className="text-left">
                          <p className={`text-xs font-bold leading-none ${selectedSale?.id === sale.id ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>
                            {new Date(sale.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} - {new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className={`text-[9px] font-bold uppercase mt-1.5 ${selectedSale?.id === sale.id ? 'text-indigo-200 dark:text-indigo-100' : 'text-slate-600 dark:text-slate-400'}`}>
                            {sale.paymentMethodSummary === 'MIXED' ? 'Pago Mixto' : sale.paymentMethodSummary === 'CASH' ? 'Efectivo' : sale.paymentMethodSummary}
                            {sale.user && ` • ${sale.user.fullName || sale.user.username}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${selectedSale?.id === sale.id ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'}`}>{fmt(sale.total)}</p>
                        <p className={`text-[9px] font-bold uppercase mt-1 ${selectedSale?.id === sale.id ? 'text-indigo-200 dark:text-indigo-100' : 'text-gray-400 dark:text-slate-500'}`}>{sale.items?.length} ítems</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Detail Section */}
          <div className="w-2/5 flex flex-col bg-white dark:bg-slate-900 overflow-hidden relative">
            {!selectedSale ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-40">
                <Receipt className="w-12 h-12 mb-4 text-gray-300 dark:text-slate-600" />
                <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest leading-relaxed">Seleccioná un ticket para ver el detalle de los productos</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-300 dark:border-slate-800 shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Detalle Venta #{selectedSale.saleNumber}</span>
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400">{new Date(selectedSale.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between items-end">
                    <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{fmt(selectedSale.total)}</h3>
                    {selectedSale.user && (
                      <span className="text-[9px] font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-md border border-indigo-100 dark:border-indigo-800/50 uppercase tracking-wider">
                        Cajero: {selectedSale.user.fullName || selectedSale.user.username}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  {selectedSale.items?.map((item: any, i: number) => (
                    <div key={i} className="flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-tight">{item.productName}</p>
                        <p className="text-[9px] font-bold text-slate-600 dark:text-slate-400 mt-1 uppercase tracking-tight">{item.quantity} unidades x {fmt(item.unitPrice)}</p>
                      </div>
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{fmt(item.total)}</p>
                    </div>
                  ))}

                  <div className="pt-4 border-t border-dashed border-slate-400 dark:border-slate-700 space-y-2">
                    <div className="flex justify-between text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                      <span>Subtotal</span>
                      <span>{fmt(selectedSale.subtotal)}</span>
                    </div>
                    {selectedSale.discount > 0 && (
                      <div className="flex justify-between text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">
                        <span>Descuentos</span>
                        <span>-{fmt(selectedSale.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-slate-900 dark:text-slate-100 uppercase pt-1">
                      <span>Total Venta</span>
                      <span>{fmt(selectedSale.total)}</span>
                    </div>
                  </div>
                </div>

                <div className="p-6 border-t border-slate-300 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
                  <p className="text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest mb-3 text-center">Formas de Pago</p>
                  <div className="space-y-1.5">
                    {selectedSale.payments?.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm">
                        <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">{p.method}</span>
                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{fmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <User className="w-4 h-4" /> Registradas: {sales.length} ventas en esta sesión
          </div>
          <button onClick={onClose} className="px-5 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-sm">Cerrar Historial</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

