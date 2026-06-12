import { useState, useEffect } from 'react';
import { 
  Truck, 
  Search, 
  Plus, 
  ChevronDown, 
  Phone,
  Mail,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Wallet,
  Trash2,
  X,
  Save,
  RefreshCw,
  FileText,
  DollarSign
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

export default function SuppliersScreen() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [search, setSearch] = useState('');
  
  const [filterType, setFilterType] = useState<'day' | 'week' | 'month' | 'custom'>('month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    contact: '',
    phone: '',
    email: ''
  });

  const [paymentData, setPaymentData] = useState({
    amount: 0,
    method: 'Efectivo',
    reference: '',
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, [filterType, startDate, endDate]);

  const getFilterParams = () => {
    const params: any = {};
    const now = new Date();
    
    if (filterType === 'day') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      params.startDate = start.toISOString();
      params.endDate = end.toISOString();
    } else if (filterType === 'week') {
      const start = new Date();
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      params.startDate = start.toISOString();
      params.endDate = now.toISOString();
    } else if (filterType === 'month') {
      const start = new Date();
      start.setDate(now.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      params.startDate = start.toISOString();
      params.endDate = now.toISOString();
    } else if (filterType === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        params.startDate = start.toISOString();
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        params.endDate = end.toISOString();
      }
    }
    return params;
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const params = getFilterParams();
      const [supps, purchs] = await Promise.all([
        api.get('/suppliers', { params }),
        api.get('/purchases')
      ]);
      setSuppliers(supps.data);
      setPurchases(purchs.data);
      
      if (selectedSupplier) {
        const updatedSelected = supps.data.find((s: any) => s.id === selectedSupplier.id);
        if (updatedSelected) {
          setSelectedSupplier(updatedSelected);
        }
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
         toast.error('Sesión expirada. Por favor, inicia sesión de nuevo.');
      } else {
         toast.error('Error al cargar datos de proveedores');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/suppliers', formData);
      toast.success('Proveedor creado con éxito');
      setShowModal(false);
      setFormData({ name: '', contact: '', phone: '', email: '' });
      loadData();
    } catch {
      toast.error('Error al crear proveedor. Verifica los campos.');
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    try {
      await api.post(`/suppliers/${selectedSupplier.id}/payments`, paymentData);
      toast.success('Pago registrado correctamente');
      setShowPaymentModal(false);
      setPaymentData({ amount: 0, method: 'Efectivo', reference: '', notes: '' });
      loadData();
    } catch {
      toast.error('Error al registrar el pago');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Seguro que deseas eliminar este proveedor? Se borrarán sus datos asociados.')) return;
    try {
      await api.delete(`/suppliers/${id}`);
      toast.success('Proveedor eliminado');
      if (selectedSupplier?.id === id) setSelectedSupplier(null);
      loadData();
    } catch {
      toast.error('No se pudo eliminar el proveedor');
    }
  };

  const calculateDebt = (supplierId: string) => {
    return purchases
      .filter(p => p.supplierId === supplierId && p.paymentStatus === 'OWED')
      .reduce((sum, p) => sum + p.total, 0);
  };

  const totalDebt = suppliers.reduce((sum, s) => sum + calculateDebt(s.id), 0);
  const upToDateCount = suppliers.filter(s => calculateDebt(s.id) === 0).length;

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email?.toLowerCase().includes(search.toLowerCase()) ||
    s.phone?.includes(search)
  );

  return (
    <div className="h-full flex flex-col gap-4 bg-slate-50/30 p-2 md:p-6 overflow-y-auto custom-scrollbar">
      {/* Title */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between px-2">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2 md:gap-3">
            <Truck className="w-6 h-6 md:w-8 md:h-8 text-indigo-500" /> Proveedores
          </h2>
          <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Gestión integral de abastecimiento</p>
        </div>
        <div className="flex items-center gap-2">
           <button onClick={() => setShowModal(true)} className="flex-1 sm:flex-none justify-center bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer">
              <Plus className="w-4 h-4" /> Nuevo
           </button>
           <button 
             onClick={() => {
                if (!selectedSupplier) return toast.error('Selecciona un proveedor para pagar');
                setShowPaymentModal(true);
             }} 
             className="flex-1 sm:flex-none justify-center bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer"
           >
              <Wallet className="w-4 h-4" /> Registrar Pago
           </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        <div className="bg-gradient-to-br from-orange-500 to-rose-600 p-4 md:p-5 rounded-xl text-white relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
          <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-[0.2em] opacity-60 mb-2">Deuda Total</p>
          <p className="text-xl md:text-3xl font-bold">$ {totalDebt.toLocaleString()}</p>
          <div className="mt-2.5 flex items-center gap-1.5 text-[9px] font-bold bg-white/10 w-fit px-2.5 py-0.5 rounded-full">
            <AlertCircle className="w-3 h-3" /> <span>{suppliers.length - upToDateCount} deudores</span>
          </div>
        </div>

        <div className="bg-emerald-50 p-4 md:p-5 rounded-xl border border-emerald-200 relative overflow-hidden">
          <p className="text-[9px] md:text-[10px] font-bold text-emerald-600 uppercase tracking-[0.2em] mb-2">A Favor</p>
          <p className="text-xl md:text-3xl font-bold text-emerald-700">$ 0</p>
          <p className="text-[9px] md:text-[10px] font-bold text-emerald-500/60 mt-4 uppercase tracking-widest">0 proveedores</p>
        </div>

        <div className="bg-white p-4 md:p-5 rounded-xl border border-slate-200 relative overflow-hidden">
          <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Al Día</p>
          <p className="text-xl md:text-3xl font-bold text-slate-800">{upToDateCount}</p>
          <div className="mt-4 flex items-center gap-1.5 text-[9px] font-bold text-emerald-500 uppercase tracking-widest">
            <CheckCircle2 className="w-3 h-3" /> <span>Sin deudas</span>
          </div>
        </div>

        <div className="bg-indigo-50 p-4 md:p-5 rounded-xl border border-indigo-200 relative overflow-hidden">
          <p className="text-[9px] md:text-[10px] font-bold text-indigo-600 uppercase tracking-[0.2em] mb-2">Total Activos</p>
          <p className="text-xl md:text-3xl font-bold text-indigo-700">{suppliers.length}</p>
          <p className="text-[9px] md:text-[10px] font-bold text-indigo-500/60 mt-4 uppercase tracking-widest">En red</p>
        </div>
      </div>

      {/* Filters & Content */}
      <div className="bg-white rounded-xl border border-slate-200 flex-1 flex flex-col overflow-hidden min-h-[500px]">
        <div className="p-4 md:p-8 border-b border-slate-50 flex flex-col xl:flex-row gap-4 items-stretch xl:items-center justify-between">
           <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full xl:w-auto">
              <div className="flex p-1 bg-slate-50 rounded-xl border border-slate-100">
                <button className="px-4 py-1.5 rounded-lg bg-white shadow-sm text-[10px] font-bold uppercase tracking-widest text-slate-800">Activos ({suppliers.length})</button>
                <button className="px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Archivados</button>
              </div>
              <div className="relative w-full sm:w-80">
                 <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                 <input 
                   type="text" 
                   value={search}
                   onChange={e => setSearch(e.target.value)}
                   placeholder="Buscar por nombre..." 
                   className="w-full bg-slate-50 border-2 border-transparent rounded-2xl pl-12 pr-4 py-2.5 text-xs font-bold text-slate-800 focus:bg-white focus:border-indigo-500/50 outline-none transition-all"
                 />
              </div>
           </div>
           <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto justify-between xl:justify-end">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <Calendar className="w-4 h-4 text-indigo-500" />
                  <select 
                    value={filterType} 
                    onChange={e => setFilterType(e.target.value as any)}
                    className="bg-transparent text-[10px] font-bold text-slate-600 uppercase tracking-wider outline-none cursor-pointer pr-1"
                  >
                    <option value="day">Hoy</option>
                    <option value="week">Últimos 7 días</option>
                    <option value="month">Últimos 30 días</option>
                    <option value="custom">Período Personalizado</option>
                  </select>
              </div>
              {filterType === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <input 
                    type="date" 
                    value={startDate} 
                    onChange={e => setStartDate(e.target.value)} 
                    className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-[9px] font-bold text-slate-650 outline-none"
                  />
                  <span className="text-slate-400 text-xs">-</span>
                  <input 
                    type="date" 
                    value={endDate} 
                    onChange={e => setEndDate(e.target.value)} 
                    className="bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-[9px] font-bold text-slate-650 outline-none"
                  />
                </div>
              )}
              <div className="relative">
                 <select className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest outline-none appearance-none pr-10">
                    <option>Mayor deuda primero</option>
                 </select>
                 <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
              </div>
           </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
           {/* Left: List */}
           <div className={`${selectedSupplier ? 'hidden lg:block' : 'w-full'} lg:w-1/3 border-r border-slate-50 overflow-y-auto custom-scrollbar`}>
              {isLoading ? (
                <div className="p-10 text-center"><RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto" /></div>
              ) : filteredSuppliers.length > 0 ? (
                <div className="divide-y divide-slate-50">
                  {filteredSuppliers.map(s => {
                    const debt = calculateDebt(s.id);
                    const isSelected = selectedSupplier?.id === s.id;
                    return (
                      <div 
                        key={s.id} 
                        onClick={() => setSelectedSupplier(s)}
                        className={`p-6 hover:bg-slate-50 cursor-pointer transition-colors group relative ${isSelected ? 'bg-indigo-50/50 border-r-4 border-indigo-500' : ''}`}
                      >
                         <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-bold text-slate-800 group-hover:text-indigo-600 transition-colors uppercase truncate pr-4">{s.name}</h4>
                            {debt > 0 && <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-500 text-[8px] font-bold uppercase">Deuda</span>}
                         </div>
                         <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                               <Phone className="w-3 h-3" /> {s.phone || '---'}
                            </div>
                            <div className="w-1 h-1 rounded-full bg-slate-200" />
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 truncate">
                               <Mail className="w-3 h-3" /> {s.email || '---'}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                             <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Saldo Actual</p>
                             <p className={`text-sm font-bold ${debt > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>$ {debt.toLocaleString()}</p>
                          </div>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} 
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-200 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-10 text-center opacity-30">
                   <AlertCircle className="w-12 h-12 text-slate-300 mb-4" />
                   <p className="text-[10px] font-bold uppercase tracking-widest">No se encontraron proveedores activos</p>
                </div>
              )}
           </div>

           {/* Right: History/Details */}
           <div className={`${!selectedSupplier ? 'hidden lg:block' : 'flex-1'} bg-slate-50/10 overflow-y-auto custom-scrollbar p-4 md:p-10`}>
              {selectedSupplier ? (
                <div className="space-y-6 md:space-y-8">
                   <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => setSelectedSupplier(null)} 
                          className="lg:hidden p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all shadow-sm shrink-0 cursor-pointer"
                        >
                           <ChevronDown className="w-4 h-4 rotate-90" />
                        </button>
                        <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-lg md:text-2xl font-bold shrink-0 shadow-md">
                           {selectedSupplier.name[0].toUpperCase()}
                        </div>
                        <div>
                           <h3 className="text-lg md:text-2xl font-bold text-slate-800 uppercase leading-snug">{selectedSupplier.name}</h3>
                           <p className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-widest leading-none mt-0.5">{selectedSupplier.contact || 'Sin contacto'}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                         <a href={`tel:${selectedSupplier.phone}`} className="p-2.5 bg-white border border-slate-100 rounded-xl text-slate-400 hover:text-indigo-650 transition-all shadow-sm"><Phone className="w-4.5 h-4.5" /></a>
                         <a href={`mailto:${selectedSupplier.email}`} className="p-2.5 bg-white border border-slate-100 rounded-xl text-slate-400 hover:text-indigo-655 transition-all shadow-sm"><Mail className="w-4.5 h-4.5" /></a>
                      </div>
                   </div>

                    <div className="grid grid-cols-2 gap-6">
                       <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Saldo Pendiente</p>
                          <p className="text-4xl font-bold text-rose-500">$ {calculateDebt(selectedSupplier.id).toLocaleString()}</p>
                       </div>
                       <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Última Compra</p>
                          <p className="text-xl font-bold text-slate-800">
                            {purchases.filter(p => p.supplierId === selectedSupplier.id).length > 0 
                              ? new Date(Math.max(...purchases.filter(p => p.supplierId === selectedSupplier.id).map(p => new Date(p.createdAt).getTime()))).toLocaleDateString()
                              : 'Sin registros'}
                          </p>
                       </div>
                    </div>

                    {/* Estadísticas de Ventas */}
                    <div className="space-y-4">
                       <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                          <DollarSign className="w-5 h-5 text-emerald-500" /> Rendimiento y Ventas
                       </h4>
                       <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:grid-cols-3">
                          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-1">
                             <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Productos Vendidos</p>
                             <p className="text-xl md:text-2xl font-black text-indigo-600">{(selectedSupplier.stats?.productsSold || 0).toLocaleString()} u.</p>
                          </div>
                          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-1">
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total Facturado</p>
                              <p className="text-xl md:text-2xl font-black text-slate-800 whitespace-nowrap">
                                 <span className="text-slate-450 mr-1 font-semibold text-base">$</span>
                                 {(selectedSupplier.stats?.totalSales || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                              </p>
                           </div>
                           <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-1">
                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Ganancia Neta</p>
                              <p className="text-xl md:text-2xl font-black text-emerald-600 whitespace-nowrap">
                                 <span className="text-emerald-500/70 mr-1 font-semibold text-base">$</span>
                                 {(selectedSupplier.stats?.netProfit || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                              </p>
                           </div>
                       </div>
                    </div>

                   <div className="space-y-4">
                      <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                         <FileText className="w-5 h-5 text-indigo-500" /> Movimientos de Cuenta
                      </h4>
                      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
                         <table className="w-full min-w-[450px] text-left">
                            <thead>
                               <tr className="bg-slate-50/50 border-b border-slate-100">
                                  <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Fecha</th>
                                  <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Concepto</th>
                                  <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-right">Monto</th>
                               </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                               {purchases.filter(p => p.supplierId === selectedSupplier.id).map(p => (
                                 <tr key={p.id}>
                                    <td className="px-6 py-4 text-[11px] font-bold text-slate-400">{new Date(p.createdAt).toLocaleDateString()}</td>
                                    <td className="px-6 py-4 text-[11px] font-bold text-slate-700">Compra #{p.invoiceNumber || p.id.slice(0,8)}</td>
                                    <td className="px-6 py-4 text-right text-[11px] font-bold text-rose-500">$ {p.total.toLocaleString()}</td>
                                 </tr>
                               ))}
                            </tbody>
                         </table>
                         {purchases.filter(p => p.supplierId === selectedSupplier.id).length === 0 && (
                           <div className="p-10 text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">No hay movimientos registrados</div>
                         )}
                      </div>
                   </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                   <div className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center mx-auto mb-6">
                      <Wallet className="w-8 h-8 text-slate-200" />
                   </div>
                   <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.3em]">Selecciona un proveedor para ver su historial.</p>
                </div>
              )}
           </div>
        </div>
      </div>

      {/* New Supplier Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
               <div className="px-8 py-6 border-b border-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white"><Truck className="w-5 h-5" /></div>
                     <h3 className="text-lg font-bold text-slate-800">Nuevo Proveedor</h3>
                  </div>
                  <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:text-slate-800"><X className="w-5 h-5" /></button>
               </div>
               <form onSubmit={handleCreate} className="p-8 space-y-6">
                  <div className="group">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1 group-focus-within:text-indigo-500 transition-colors">Razón Social / Nombre *</span>
                    <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ej: Distribuidora Coca-Cola S.A." className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:bg-white focus:border-indigo-500/50 transition-all" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Teléfono de Contacto</span>
                        <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+54 11 ..." className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:bg-white focus:border-indigo-500/50 transition-all" />
                     </div>
                     <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Correo Electrónico</span>
                        <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="admin@distribuidora.com" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:bg-white focus:border-indigo-500/50 transition-all" />
                     </div>
                  </div>
                  <div className="group">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Persona de Contacto</span>
                    <input type="text" value={formData.contact} onChange={e => setFormData({...formData, contact: e.target.value})} placeholder="Nombre del vendedor..." className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:bg-white focus:border-indigo-500/50 transition-all" />
                  </div>
                  <div className="flex justify-end gap-4 pt-4">
                     <button type="button" onClick={() => setShowModal(false)} className="px-8 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Cancelar</button>
                     <button type="submit" className="px-10 py-4 bg-emerald-500 text-white rounded-2xl text-[11px] font-bold uppercase tracking-widest shadow-xl shadow-emerald-100 hover:scale-105 active:scale-95 transition-all">Crear Proveedor</button>
                  </div>
               </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Modal */}
      <AnimatePresence>
        {showPaymentModal && selectedSupplier && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowPaymentModal(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
               <div className="px-8 py-6 border-b border-slate-50 bg-emerald-50/50 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-100"><Wallet className="w-5 h-5" /></div>
                     <div>
                        <h3 className="text-lg font-bold text-slate-800 leading-none">Registrar Pago</h3>
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mt-1">Proveedor: {selectedSupplier.name}</p>
                     </div>
                  </div>
                  <button onClick={() => setShowPaymentModal(false)} className="p-2 text-slate-400 hover:text-slate-800"><X className="w-5 h-5" /></button>
               </div>
               <form onSubmit={handlePayment} className="p-8 space-y-6">
                  <div className="group">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Monto a Pagar *</span>
                    <div className="relative">
                       <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-300">$</span>
                       <input 
                         type="number" 
                         required 
                         autoFocus
                         value={paymentData.amount} 
                         onChange={e => setPaymentData({...paymentData, amount: parseFloat(e.target.value)})} 
                         className="w-full bg-slate-50 border-2 border-slate-100 rounded-3xl pl-12 pr-6 py-5 text-3xl font-bold text-slate-800 outline-none focus:bg-white focus:border-emerald-500/50 transition-all shadow-sm" 
                       />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Método de Pago</span>
                        <select 
                          value={paymentData.method} 
                          onChange={e => setPaymentData({...paymentData, method: e.target.value})} 
                          className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:bg-white focus:border-emerald-500/50 transition-all appearance-none cursor-pointer"
                        >
                           <option>Efectivo</option>
                           <option>Transferencia</option>
                           <option>Mercado Pago</option>
                           <option>Efectivo Caja</option>
                        </select>
                     </div>
                     <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Referencia / N° Op.</span>
                        <input type="text" value={paymentData.reference} onChange={e => setPaymentData({...paymentData, reference: e.target.value})} placeholder="Ej: 00012345" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:bg-white focus:border-emerald-500/50 transition-all" />
                     </div>
                  </div>

                  <div className="group">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Notas Internas</span>
                    <textarea value={paymentData.notes} onChange={e => setPaymentData({...paymentData, notes: e.target.value})} placeholder="Descripción opcional..." className="w-full h-24 bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold outline-none focus:bg-white focus:border-emerald-500/50 transition-all resize-none" />
                  </div>

                  <div className="flex justify-end gap-4 pt-4">
                     <button type="button" onClick={() => setShowPaymentModal(false)} className="px-8 py-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">Cancelar</button>
                     <button type="submit" className="px-10 py-4 bg-emerald-500 text-white rounded-2xl text-[11px] font-bold uppercase tracking-widest shadow-xl shadow-emerald-200 hover:scale-105 active:scale-95 transition-all flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5" /> Confirmar Pago
                     </button>
                  </div>
               </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
