import { useState, useEffect, useRef } from 'react';
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
  const [limit, setLimit] = useState(100);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isInfiniteLoading, setIsInfiniteLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevLimitRef = useRef(100);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setLimit(100);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    setLimit(100);
  }, [filterDate, filterMethod, viewAll, sessionId]);

  useEffect(() => {
    const isPagination = limit > 100 && limit !== prevLimitRef.current;
    prevLimitRef.current = limit;
    loadSales(isPagination);
  }, [sessionId, viewAll, limit, debouncedSearch, filterDate, filterMethod]);

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

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isLoading || isInfiniteLoading) return;
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 60) {
        if (sales.length >= limit) {
          setLimit(prev => prev + 100);
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [sales.length, limit, isLoading, isInfiniteLoading]);

  const loadSales = async (isPagination = false) => {
    if (isPagination) {
      setIsInfiniteLoading(true);
    } else {
      setIsLoading(true);
    }
    try {
      const params: any = { limit };
      if (!viewAll) {
        if (!sessionId) {
          setIsLoading(false);
          setIsInfiniteLoading(false);
          return;
        }
        params.sessionId = sessionId;
      }
      if (debouncedSearch) {
        params.search = debouncedSearch;
      }
      if (filterDate) {
        params.from = `${filterDate}T00:00:00.000Z`;
        params.to = `${filterDate}T23:59:59.999Z`;
      }
      if (filterMethod && filterMethod !== 'ALL') {
        params.paymentMethod = filterMethod;
      }

      const { data } = await api.get('/sales', { params });
      setSales(data);
    } catch {
    } finally {
      setIsLoading(false);
      setIsInfiniteLoading(false);
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
  const perfMode = localStorage.getItem('performance_mode') === 'true';
  const MotionDiv = (perfMode ? 'div' : motion.div) as any;

  return (
    <MotionDiv 
      {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })} 
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <MotionDiv
        {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0, y: 20 }, animate: { scale: 1, opacity: 1, y: 0 }, exit: { scale: 0.95, opacity: 0, y: 20 } })}
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl overflow-hidden shadow-xl border border-slate-200 dark:border-slate-800 flex flex-col h-[90vh]"
        onClick={(e: any) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-50 dark:bg-sky-950/40 rounded-xl text-sky-600 dark:text-sky-400 shadow-xs border border-sky-100 dark:border-sky-900/50">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">Historial de Ventas</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Ventas correlativas y auditoría de terminal</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* List Section */}
          <div className="w-3/5 flex flex-col border-r border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50/40 dark:bg-slate-900/40">
            {/* Tabs & Scope Toggle */}
            <div className="px-6 pt-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
              <div className="flex gap-6">
                <button onClick={() => { setActiveTab('sales'); setSelectedSale(null); }} className={`pb-2.5 text-xs font-bold transition-all relative cursor-pointer ${activeTab === 'sales' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                  Ventas ({sales.filter(s => s.status === 'COMPLETED').length})
                  {activeTab === 'sales' && <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-600 dark:bg-rose-400 rounded-full" />}
                </button>
                <button onClick={() => { setActiveTab('returns'); setSelectedSale(null); }} className={`pb-2.5 text-xs font-bold transition-all relative cursor-pointer ${activeTab === 'returns' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                  Devoluciones ({sales.filter(s => s.status !== 'COMPLETED').length})
                  {activeTab === 'returns' && <motion.div layoutId="tab-active" className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-600 dark:bg-rose-400 rounded-full" />}
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
                  <div className="keep-style w-8 h-4 bg-slate-200 dark:bg-slate-700 rounded-full peer peer-focus:ring-1 peer-focus:ring-slate-400 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-slate-900 dark:peer-checked:bg-white"></div>
                  <span className="ml-2 text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Ver todas las cajas</span>
                </label>
              </div>
            </div>

            {/* Advanced Filters */}
            <div className="px-5 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0 space-y-2.5">
              <div className="flex gap-2.5">
                <div className="relative flex-1 flex items-center">
                  <Search className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input 
                    type="text" 
                    placeholder="Buscar por Ticket # o Producto..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-slate-900 dark:focus:border-white outline-none transition-all"
                  />
                </div>
                <div className="relative w-40 flex items-center">
                  <Calendar className="absolute left-3 w-4 h-4 text-slate-400 z-10 pointer-events-none" />
                  <input 
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 focus:border-slate-900 dark:focus:border-white outline-none transition-all cursor-pointer"
                  />
                </div>
                <div className="relative w-32 flex items-center">
                  <Clock className="absolute left-3 w-4 h-4 text-slate-400 z-10 pointer-events-none" />
                  <select 
                    value={filterHour}
                    onChange={(e) => setFilterHour(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 appearance-none cursor-pointer focus:border-slate-900 dark:focus:border-white outline-none transition-all"
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
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">Método:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'ALL', label: 'Todos', activeColor: 'bg-teal-700 text-white dark:bg-teal-600 dark:text-white border-teal-700 dark:border-teal-600 shadow-xs' },
                    { id: 'CASH', label: 'Efectivo', activeColor: 'bg-emerald-600 text-white border-emerald-600 shadow-xs' },
                    { id: 'CLOVER', label: 'Clover/Tarjeta', activeColor: 'bg-sky-600 text-white border-sky-600 shadow-xs' },
                    { id: 'MERCADOPAGO', label: 'MercadoPago', activeColor: 'bg-rose-600 text-white border-rose-600 shadow-xs' },
                    { id: 'MIXED', label: 'Mixto', activeColor: 'bg-purple-600 text-white border-purple-600 shadow-xs' },
                    { id: 'DEBT', label: 'Cta.Cte', activeColor: 'bg-amber-600 text-white border-amber-600 shadow-xs' }
                  ].map((m) => (
                    <button 
                      key={m.id} 
                      onClick={() => setFilterMethod(m.id)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer border ${filterMethod === m.id ? m.activeColor : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200/80 dark:border-slate-700'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-8 h-8 border-3 border-slate-900 dark:border-white border-t-transparent rounded-full animate-spin" />
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Cargando registros...</p>
                </div>
              ) : filteredSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-40">
                  <ShoppingBag className="w-14 h-14 mb-3 text-slate-400" />
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Sin ventas encontradas</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredSales.map((sale) => (
                    <button 
                       key={sale.id} 
                       onClick={() => setSelectedSale(sale)}
                       className={`w-full flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer ${selectedSale?.id === sale.id ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-sm border border-teal-700 dark:border-teal-600' : 'bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 text-slate-800 dark:text-slate-200'}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-mono font-bold min-w-[32px] ${selectedSale?.id === sale.id ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'}`}>#{sale.saleNumber}</span>
                        <div className="text-left">
                          <p className={`text-xs font-bold leading-tight ${selectedSale?.id === sale.id ? 'text-white dark:text-slate-900' : 'text-slate-900 dark:text-white'}`}>
                            {new Date(sale.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} - {new Date(sale.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className={`text-[9.5px] font-bold uppercase mt-1 ${selectedSale?.id === sale.id ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'}`}>
                            {sale.paymentMethodSummary === 'MIXED' ? 'Pago Mixto' : sale.paymentMethodSummary === 'CASH' ? 'Efectivo' : sale.paymentMethodSummary}
                            {sale.user && ` • ${sale.user.fullName || sale.user.username}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-mono font-black ${selectedSale?.id === sale.id ? 'text-white dark:text-slate-900' : 'text-slate-950 dark:text-white'}`}>{fmt(sale.total)}</p>
                        <p className={`text-[9px] font-bold uppercase mt-0.5 ${selectedSale?.id === sale.id ? 'text-slate-300 dark:text-slate-600' : 'text-slate-400 dark:text-slate-500'}`}>{sale.items?.length} ítems</p>
                      </div>
                    </button>
                  ))}

                  {isInfiniteLoading && (
                    <div className="flex justify-center py-4 text-slate-400 dark:text-slate-500">
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Detail Section */}
          <div className="w-2/5 flex flex-col bg-white dark:bg-slate-900 overflow-hidden relative">
            {!selectedSale ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center opacity-40">
                <Receipt className="w-12 h-12 mb-3 text-slate-400 dark:text-slate-600" />
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-relaxed">Seleccioná un ticket para ver el detalle</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 shrink-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Ticket #{selectedSale.saleNumber}</span>
                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{new Date(selectedSale.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-end justify-between">
                    <h3 className="text-2xl font-mono font-black text-slate-950 dark:text-white">{fmt(selectedSale.total)}</h3>
                    {selectedSale.user && (
                      <span className="text-[9.5px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                        {selectedSale.user.fullName || selectedSale.user.username}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar">
                  {selectedSale.items?.map((item: any, i: number) => (
                    <div key={i} className="flex justify-between items-start gap-3 pb-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">{item.productName}</p>
                        <p className="text-[10px] font-mono font-medium text-slate-500 dark:text-slate-400 mt-0.5">{item.quantity} un. x {fmt(item.unitPrice)}</p>
                      </div>
                      <p className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100 shrink-0">{fmt(item.total)}</p>
                    </div>
                  ))}

                  <div className="pt-3 border-t border-dashed border-slate-300 dark:border-slate-700 space-y-1.5">
                    <div className="flex justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span>Subtotal</span>
                      <span className="font-mono">{fmt(selectedSale.subtotal)}</span>
                    </div>
                    {selectedSale.discount > 0 && (
                      <div className="flex justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        <span>Descuentos</span>
                        <span className="font-mono">-{fmt(selectedSale.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black text-slate-950 dark:text-white pt-1 border-t border-slate-200 dark:border-slate-700">
                      <span>Total Venta</span>
                      <span className="font-mono">{fmt(selectedSale.total)}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
                  <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Formas de Pago</p>
                  <div className="space-y-1">
                    {selectedSale.payments?.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                        <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">{p.method}</span>
                        <span className="text-xs font-mono font-black text-slate-900 dark:text-white">{fmt(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <User className="w-4 h-4" /> Registradas: <strong className="text-slate-900 dark:text-slate-100">{sales.length}</strong> ventas
          </div>
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-xs">Cerrar Historial</button>
        </div>
      </MotionDiv>
    </MotionDiv>
  );
}

