import { useState, useEffect } from 'react';
import api from '../../services/api';
import { 
  Users, 
  Search, 
  UserPlus, 
  AlertCircle, 
  TrendingDown, 
  Clock, 
  RefreshCw,
  FileText,
  ChevronRight,
  Filter,
  DollarSign,
  UserCheck,
  X,
  Maximize2,
  Minimize2,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import PaymentModal from '../pos/PaymentModal';

export default function CuentasCorrientesScreen() {
  const [clients, setClients] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'debt' | 'credit' | 'none'>('all');
  const [isLoading, setIsLoading] = useState(true);

  // New Client Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  
  // Edit Client Modal States
  const [editingClient, setEditingClient] = useState<any | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Client History States
  const [selectedClientForHistory, setSelectedClientForHistory] = useState<any | null>(null);
  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [clientMovements, setClientMovements] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'PURCHASES' | 'PAYMENTS'>('ALL');

  const handleViewMovements = async (client: any) => {
    setSelectedClientForHistory(client);
    setShowMovementsModal(true);
    setIsLoadingHistory(true);
    setHistoryFilter('ALL');
    try {
      const { data } = await api.get(`/clients/${client.id}`);
      setClientMovements(data.movements || []);
    } catch (err) {
      console.error('Error fetching client movements:', err);
      toast.error('Error al cargar el historial del cliente');
    } finally {
      setIsLoadingHistory(false);
    }
  };
  
  // Debt Payment States
  const [clientToAbonar, setClientToAbonar] = useState<any>(null);
  const [showAbonoAmountModal, setShowAbonoAmountModal] = useState(false);
  const [abonoAmount, setAbonoAmount] = useState<number>(0);
  const [showAbonoPaymentModal, setShowAbonoPaymentModal] = useState(false);
  const [currentSession, setCurrentSession] = useState<any>(null);

  const [newClient, setNewClient] = useState({
    name: '',
    dni: '',
    phone: '',
    address: '',
    email: '',
    creditLimit: '',
    authorizedPickups: '',
    balance: 0,
    priceList: 'RETAIL',
    tradeDiscountPercentage: ''
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadClients();
    loadSession();
  }, []);

  const loadSession = async () => {
    try {
      const { data } = await api.get('/cash/session/current');
      setCurrentSession(data);
    } catch {}
  };

  const loadClients = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/clients');
      setClients(data);
    } catch {} finally { setIsLoading(false); }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClient.name.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: newClient.name.trim(),
        dni: newClient.dni.trim() || null,
        phone: newClient.phone.trim() || null,
        address: newClient.address.trim() || null,
        email: newClient.email.trim() || null,
        creditLimit: newClient.creditLimit !== '' && !isNaN(Number(newClient.creditLimit)) ? Number(newClient.creditLimit) : null,
        authorizedPickups: newClient.authorizedPickups?.trim() || null,
        balance: Number(newClient.balance) || 0,
        priceList: newClient.priceList || 'RETAIL',
        tradeDiscountPercentage: newClient.tradeDiscountPercentage !== '' && !isNaN(Number(newClient.tradeDiscountPercentage)) ? Number(newClient.tradeDiscountPercentage) : null
      };
      await api.post('/clients', payload);
      toast.success('Cliente registrado con éxito');
      setShowAddModal(false);
      setNewClient({ name: '', dni: '', phone: '', address: '', email: '', creditLimit: '', authorizedPickups: '', balance: 0, priceList: 'RETAIL', tradeDiscountPercentage: '' });
      loadClients();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al registrar el cliente. Verifique que el DNI no esté duplicado.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient.name.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: editingClient.name.trim(),
        dni: editingClient.dni?.trim() || null,
        phone: editingClient.phone?.trim() || null,
        address: editingClient.address?.trim() || null,
        email: editingClient.email?.trim() || null,
        creditLimit: editingClient.creditLimit !== '' && editingClient.creditLimit !== null && !isNaN(Number(editingClient.creditLimit)) ? Number(editingClient.creditLimit) : null,
        authorizedPickups: editingClient.authorizedPickups?.trim() || null,
        balance: Number(editingClient.balance) || 0,
        priceList: editingClient.priceList || 'RETAIL',
        tradeDiscountPercentage: editingClient.tradeDiscountPercentage !== '' && editingClient.tradeDiscountPercentage !== null && !isNaN(Number(editingClient.tradeDiscountPercentage)) ? Number(editingClient.tradeDiscountPercentage) : null
      };
      await api.patch(`/clients/${editingClient.id}`, payload);
      toast.success('Cliente actualizado con éxito');
      setShowEditModal(false);
      setEditingClient(null);
      loadClients();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al actualizar el cliente.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClient = async (id: string, name: string) => {
    if (!window.confirm(`¿Está seguro de que desea eliminar al cliente "${name}"? Esta acción borrará permanentemente sus movimientos de cuenta corriente.`)) {
      return;
    }
    try {
      await api.delete(`/clients/${id}`);
      toast.success('Cliente eliminado con éxito');
      setShowEditModal(false);
      setEditingClient(null);
      loadClients();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al eliminar el cliente.');
    }
  };

  const filteredClients = clients.filter(c => {
    const nameMatch = c.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const dniMatch = c.dni?.toLowerCase().includes(searchQuery.toLowerCase());
    const phoneMatch = c.phone?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSearch = nameMatch || dniMatch || phoneMatch;
    
    if (activeFilter === 'debt') return matchesSearch && c.balance > 0;
    if (activeFilter === 'credit') return matchesSearch && c.balance < 0;
    if (activeFilter === 'none') return matchesSearch && c.balance === 0;
    return matchesSearch;
  });

  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

  const totalDebt = clients.reduce((acc, c) => acc + (c.balance > 0 ? c.balance : 0), 0);
  const activeCount = clients.length;
  const overdueCount = 0; // Logic for overdue
  const withDebtCount = clients.filter(c => c.balance > 0).length;

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col gap-4 md:gap-6 bg-[#f8fafc] p-4 md:p-6 overflow-y-auto custom-scrollbar">
      {/* Header Info */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Cuentas Corrientes</h1>
          <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.3em] mt-1">Control de deudas y pagos de clientes</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-400 rounded-xl">
             <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Buenos días</span>
             <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-[10px]">A</div>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
        {[
          { label: 'DEUDA TOTAL', value: fmt(totalDebt), sub: '0 clientes', color: 'bg-[#F97F1E]', textColor: 'text-white', icon: TrendingDown },
          { label: 'ACTIVOS', value: activeCount.toString(), sub: 'cuentas habilitadas', color: 'bg-[#f0fdf4]', textColor: 'text-emerald-600', icon: UserCheck, border: 'border-emerald-100' },
          { label: 'VENCIDOS', value: overdueCount.toString(), sub: 'con facturas vencidas', color: 'bg-[#fff7ed]', textColor: 'text-orange-600', icon: AlertCircle, border: 'border-orange-100' },
          { label: 'CON DEUDA', value: withDebtCount.toString(), sub: 'deben algo', color: 'bg-[#f5f3ff]', textColor: 'text-purple-600', icon: Clock, border: 'border-purple-100' }
        ].map((card) => (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={card.label} className={`${card.color} ${card.border ? `border ${card.border}` : ''} p-5 md:p-7 rounded-2xl shadow-sm relative overflow-hidden group`}>
            <div className="relative z-10">
              <p className={`text-[10px] font-bold tracking-[0.2em] mb-4 ${card.textColor === 'text-white' ? 'text-white/70' : 'text-slate-600'}`}>{card.label}</p>
              <h3 className={`text-2xl md:text-3xl font-bold mb-1.5 ${card.textColor}`}>{card.value}</h3>
              <p className={`text-[11px] font-bold opacity-60 uppercase tracking-widest ${card.textColor}`}>{card.sub}</p>
            </div>
            <card.icon className={`absolute -right-6 -bottom-6 w-28 h-28 opacity-10 ${card.textColor} group-hover:scale-110 transition-transform duration-500`} />
          </motion.div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-white p-4 md:p-5 rounded-2xl border border-slate-300 shadow-sm space-y-4 md:space-y-5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1 relative flex items-center">
            <Search className="absolute left-5 w-4 h-4 text-slate-350 pointer-events-none" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre, DNI o teléfono..." 
              className="w-full bg-slate-50/50 border border-slate-300 rounded-2xl pl-12 pr-4 py-3 text-sm font-bold text-slate-600 focus:bg-white focus:border-rose-200 transition-all outline-none shadow-inner"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadClients} className="p-3 rounded-2xl bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all"><RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} /></button>
            <button 
              onClick={() => setShowAddModal(true)}
              className="h-12 px-6 rounded-2xl bg-[#10b981] text-white text-[10px] font-bold uppercase tracking-[0.2em] shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2 w-full sm:w-auto justify-center cursor-pointer"
            >
              <UserPlus className="w-4 h-4" /> Nuevo Cliente
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'Todos', count: clients.length },
              { id: 'debt', label: 'Con deuda', count: withDebtCount },
              { id: 'credit', label: 'A favor', count: clients.filter(c => c.balance < 0).length },
              { id: 'none', label: 'Sin deuda', count: clients.filter(c => c.balance === 0).length }
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id as any)}
                className={`px-4 py-2 rounded-xl text-[9px] md:text-[10px] font-bold uppercase tracking-widest transition-all ${activeFilter === f.id ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
          <button 
            onClick={() => setShowListModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all active:scale-[0.97] cursor-pointer shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Ver Lista Completa</span>
          </button>
        </div>
      </div>

      {/* Main List */}
      <div className="bg-white rounded-2xl border border-slate-300 shadow-sm overflow-hidden">
        {clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 px-10">
            <div className="w-20 h-20 rounded-2xl bg-slate-50 flex items-center justify-center mb-8 shadow-inner">
              <FileText className="w-8 h-8 text-slate-200" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 tracking-tight mb-2">No hay clientes registrados</h3>
            <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest max-w-xs leading-relaxed">
              Agregá tu primer cliente para comenzar a gestionar fiaos.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto p-4 md:p-6">
             {/* Table placeholder for actual data */}
             <table className="w-full min-w-[550px] text-left">
               <thead>
                 <tr className="border-b border-slate-50">
                    <th className="pb-6 text-[10px] font-bold text-slate-600 uppercase tracking-widest px-4">Cliente</th>
                    <th className="pb-6 text-[10px] font-bold text-slate-600 uppercase tracking-widest px-4">DNI / Teléfono</th>
                    <th className="pb-6 text-[10px] font-bold text-slate-600 uppercase tracking-widest px-4 text-right">Saldo Actual</th>
                    <th className="pb-6 text-[10px] font-bold text-slate-600 uppercase tracking-widest px-4 text-center">Acciones</th>
                 </tr>
               </thead>
               <tbody>
                 {filteredClients.map(client => {
                    if (!client) return null;
                    const displayName = client.name || 'Cliente sin nombre';
                    const initialLetter = displayName ? displayName[0].toUpperCase() : '?';
                    return (
                      <tr key={client.id} className="border-b border-slate-50/50 hover:bg-slate-50/50 transition-colors group">
                        <td className="py-5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-600 shrink-0">{initialLetter}</div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-800">{displayName}</span>
                              {localStorage.getItem('business_type') === 'FERRETERIA' && client.priceList === 'TRADE' && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-100 text-amber-850 border border-amber-300 shrink-0">
                                  🔧 GREMIO {client.tradeDiscountPercentage ? `(-${client.tradeDiscountPercentage}%)` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-5 px-4">
                           <p className="text-[11px] font-bold text-slate-700 uppercase">{client.dni || 'S/D'}</p>
                           <p className="text-[10px] font-bold text-slate-600">{client.phone || 'S/D'}</p>
                        </td>
                        <td className="py-5 px-4 text-right">
                           <span className={`text-sm font-bold ${(client.balance || 0) > 0 ? 'text-rose-500' : (client.balance || 0) < 0 ? 'text-emerald-500' : 'text-slate-600'}`}>
                             {fmt(client.balance || 0)}
                           </span>
                        </td>
                        <td className="py-5 px-4 text-center">
                           <div className="flex items-center justify-center gap-2">
                             {(client.balance || 0) > 0 && (
                               <button 
                                 onClick={() => { setClientToAbonar(client); setAbonoAmount(Math.abs(client.balance)); setShowAbonoAmountModal(true); }}
                                 className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border border-emerald-100"
                               >
                                 <DollarSign className="w-3.5 h-3.5" /> Abonar
                               </button>
                             )}
                              <button 
                                onClick={() => handleViewMovements(client)}
                                className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 border border-rose-100"
                                title="Ver Historial / Pagos"
                              >
                                <FileText className="w-3.5 h-3.5" /> Historial
                              </button>
                              <button 
                                onClick={() => { setEditingClient(client); setShowEditModal(true); }}
                                className="p-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-all"
                                title="Editar / Eliminar Cliente"
                              >
                                 <ChevronRight className="w-4 h-4" />
                              </button>
                           </div>
                        </td>
                      </tr>
                    );
                 })}
               </tbody>
             </table>
          </div>
        )}
      </div>

      {/* Create Client Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl border border-slate-300 p-6 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Registrar Nuevo Cliente</h3>
                  <p className="text-[9px] text-slate-600 font-semibold tracking-widest mt-0.5">FICHA DE CUENTA CORRIENTE</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <form onSubmit={handleCreateClient} className="space-y-4 text-xs font-semibold text-slate-600">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Nombre Completo *</label>
                  <input 
                    type="text"
                    required
                    value={newClient.name}
                    onChange={(e) => setNewClient({...newClient, name: e.target.value})}
                    placeholder="Ej. Juan Pérez"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">DNI / CUIT</label>
                    <input 
                      type="text"
                      value={newClient.dni}
                      onChange={(e) => setNewClient({...newClient, dni: e.target.value})}
                      placeholder="Sin puntos"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Teléfono</label>
                    <input 
                      type="text"
                      value={newClient.phone}
                      onChange={(e) => setNewClient({...newClient, phone: e.target.value})}
                      placeholder="Ej. 11 2345 6789"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Dirección</label>
                  <input 
                    type="text"
                    value={newClient.address}
                    onChange={(e) => setNewClient({...newClient, address: e.target.value})}
                    placeholder="Calle, número, localidad"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Email</label>
                  <input 
                    type="email"
                    value={newClient.email}
                    onChange={(e) => setNewClient({...newClient, email: e.target.value})}
                    placeholder="ejemplo@correo.com"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Saldo Inicial (Deuda)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-600 text-sm">$</span>
                    <input 
                      type="number"
                      value={newClient.balance}
                      onChange={(e) => setNewClient({...newClient, balance: Number(e.target.value)})}
                      placeholder="0"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                    />
                  </div>
                  <p className="text-[9px] text-slate-600 mt-1 italic">Ingrese un valor si el cliente arrastra una deuda previa.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Límite de Crédito / Saldo Máximo (opcional)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-600 text-sm">$</span>
                    <input 
                      type="number"
                      value={newClient.creditLimit}
                      onChange={(e) => setNewClient({...newClient, creditLimit: e.target.value})}
                      placeholder="Ej. 500000"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                    />
                  </div>
                  <p className="text-[9px] text-slate-500 mt-1">Alerta en el POS si el cliente supera este monto adeudado.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Personas Autorizadas a Retirar Materiales</label>
                  <input 
                    type="text"
                    value={newClient.authorizedPickups}
                    onChange={(e) => setNewClient({...newClient, authorizedPickups: e.target.value})}
                    placeholder="Ej. Juan Pérez, Albañil Mario, Chofer Carlos"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                  <p className="text-[9px] text-slate-500 mt-1">Nombres separados por coma. Podrán seleccionarse al cobrar en POS para firma en ticket.</p>
                </div>

                {/* Lista de Precios / Gremio (Solo Ferretería) */}
                {localStorage.getItem('business_type') === 'FERRETERIA' && (
                  <div className="grid grid-cols-2 gap-3 p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl">
                    <div className="space-y-1">
                      <label className="text-[10px] text-amber-900 uppercase font-bold tracking-wider block">Lista de Precios</label>
                      <select
                        value={newClient.priceList || 'RETAIL'}
                        onChange={(e) => setNewClient({...newClient, priceList: e.target.value})}
                        className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 outline-none focus:border-amber-500 font-bold text-xs text-slate-700 cursor-pointer"
                      >
                        <option value="RETAIL">Mostrador (Minorista)</option>
                        <option value="TRADE">🔧 Gremio / Instalador</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-amber-900 uppercase font-bold tracking-wider block">% Descuento Gremio</label>
                      <div className="relative">
                        <input 
                          type="number"
                          min="0"
                          max="100"
                          value={newClient.tradeDiscountPercentage || ''}
                          onChange={(e) => setNewClient({...newClient, tradeDiscountPercentage: e.target.value})}
                          placeholder="Ej. 10"
                          className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 outline-none focus:border-amber-500 font-bold text-xs text-slate-700"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-300 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-650 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-3 bg-[#10b981] hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer text-center disabled:opacity-55"
                  >
                    {isSaving ? 'Guardando...' : 'Registrar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Client Modal */}
      <AnimatePresence>
        {showEditModal && editingClient && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setShowEditModal(false); setEditingClient(null); }}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl border border-slate-300 p-6 space-y-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Modificar / Eliminar Cliente</h3>
                  <p className="text-[9px] text-slate-600 font-semibold tracking-widest mt-0.5">EDITAR FICHA DE CLIENTE</p>
                </div>
                <button onClick={() => { setShowEditModal(false); setEditingClient(null); }} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <form onSubmit={handleUpdateClient} className="space-y-4 text-xs font-semibold text-slate-600">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Nombre Completo *</label>
                  <input 
                    type="text"
                    required
                    value={editingClient.name}
                    onChange={(e) => setEditingClient({...editingClient, name: e.target.value})}
                    placeholder="Ej. Juan Pérez"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">DNI / CUIT</label>
                    <input 
                      type="text"
                      value={editingClient.dni || ''}
                      onChange={(e) => setEditingClient({...editingClient, dni: e.target.value})}
                      placeholder="Sin puntos"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Teléfono</label>
                    <input 
                      type="text"
                      value={editingClient.phone || ''}
                      onChange={(e) => setEditingClient({...editingClient, phone: e.target.value})}
                      placeholder="Ej. 11 2345 6789"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Dirección</label>
                  <input 
                    type="text"
                    value={editingClient.address || ''}
                    onChange={(e) => setEditingClient({...editingClient, address: e.target.value})}
                    placeholder="Calle, número, localidad"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Email</label>
                  <input 
                    type="email"
                    value={editingClient.email || ''}
                    onChange={(e) => setEditingClient({...editingClient, email: e.target.value})}
                    placeholder="ejemplo@correo.com"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Saldo Actual (Edición directa deshabilitada)</label>
                  <input 
                    type="number"
                    disabled
                    value={editingClient.balance}
                    className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 outline-none font-bold text-slate-500 cursor-not-allowed"
                  />
                  <p className="text-[9px] text-slate-450 mt-1 font-medium">⚠️ El saldo se ajusta automáticamente mediante cobros o compras a crédito.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Límite de Crédito / Saldo Máximo (opcional)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-600 text-sm">$</span>
                    <input 
                      type="number"
                      value={editingClient.creditLimit || ''}
                      onChange={(e) => setEditingClient({...editingClient, creditLimit: e.target.value})}
                      placeholder="Ej. 500000"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                    />
                  </div>
                  <p className="text-[9px] text-slate-500 mt-1">Alerta en el POS si el cliente supera este monto adeudado.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-600 uppercase font-bold tracking-wider block">Personas Autorizadas a Retirar Materiales</label>
                  <input 
                    type="text"
                    value={editingClient.authorizedPickups || ''}
                    onChange={(e) => setEditingClient({...editingClient, authorizedPickups: e.target.value})}
                    placeholder="Ej. Juan Pérez, Albañil Mario, Chofer Carlos"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 font-bold transition-all text-slate-700"
                  />
                  <p className="text-[9px] text-slate-500 mt-1">Nombres separados por coma. Podrán seleccionarse al cobrar en POS para firma en ticket.</p>
                </div>

                {/* Lista de Precios / Gremio (Solo Ferretería) */}
                {localStorage.getItem('business_type') === 'FERRETERIA' && (
                  <div className="grid grid-cols-2 gap-3 p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl">
                    <div className="space-y-1">
                      <label className="text-[10px] text-amber-900 uppercase font-bold tracking-wider block">Lista de Precios</label>
                      <select
                        value={editingClient.priceList || 'RETAIL'}
                        onChange={(e) => setEditingClient({...editingClient, priceList: e.target.value})}
                        className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 outline-none focus:border-amber-500 font-bold text-xs text-slate-700 cursor-pointer"
                      >
                        <option value="RETAIL">Mostrador (Minorista)</option>
                        <option value="TRADE">🔧 Gremio / Instalador</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-amber-900 uppercase font-bold tracking-wider block">% Descuento Gremio</label>
                      <div className="relative">
                        <input 
                          type="number"
                          min="0"
                          max="100"
                          value={editingClient.tradeDiscountPercentage || ''}
                          onChange={(e) => setEditingClient({...editingClient, tradeDiscountPercentage: e.target.value})}
                          placeholder="Ej. 10"
                          className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 outline-none focus:border-amber-500 font-bold text-xs text-slate-700"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-3 border-t border-slate-300">
                  <button 
                    type="button"
                    onClick={() => handleDeleteClient(editingClient.id, editingClient.name)}
                    className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-250 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" /> Eliminar
                  </button>
                  <button 
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all cursor-pointer text-center disabled:opacity-55"
                  >
                    {isSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </form>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Client Movements / Ticket History Modal */}
      <AnimatePresence>
        {showMovementsModal && selectedClientForHistory && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => { setShowMovementsModal(false); setSelectedClientForHistory(null); }}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="bg-white rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl border border-slate-300 p-6 flex flex-col max-h-[85vh] space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 shrink-0">
                <div>
                  <h3 className="text-base font-black text-slate-800">Historial de Cuenta Corriente</h3>
                  <p className="text-xs font-bold text-rose-600 mt-0.5">CLIENTE: {selectedClientForHistory.name.toUpperCase()}</p>
                </div>
                <button onClick={() => { setShowMovementsModal(false); setSelectedClientForHistory(null); }} className="p-1.5 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-slate-650 transition-all"><X className="w-5 h-5" /></button>
              </div>

              {/* Client Balance Summary */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex justify-between items-center shrink-0">
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Estado de Cuenta</span>
                <span className={`text-base font-black ${selectedClientForHistory.balance > 0 ? 'text-rose-500' : selectedClientForHistory.balance < 0 ? 'text-emerald-500' : 'text-slate-600'}`}>
                  {selectedClientForHistory.balance > 0 ? `Debe: ${fmt(selectedClientForHistory.balance)}` : selectedClientForHistory.balance < 0 ? `A favor: ${fmt(Math.abs(selectedClientForHistory.balance))}` : 'Al día / Sin Saldo'}
                </span>
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
                {(['ALL', 'PURCHASES', 'PAYMENTS'] as const).map((filter) => {
                  const label = filter === 'ALL' ? 'Todos' : filter === 'PURCHASES' ? 'Compras' : 'Pagos';
                  const active = historyFilter === filter;
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setHistoryFilter(filter)}
                      className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                        active 
                          ? 'bg-white text-rose-600 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* History Timeline */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                {isLoadingHistory ? (
                  <div className="py-12 text-center text-sm font-bold text-slate-400 animate-pulse">Cargando movimientos...</div>
                ) : clientMovements.filter(m => {
                  if (historyFilter === 'PURCHASES') return m.type === 'DEBT';
                  if (historyFilter === 'PAYMENTS') return m.type === 'PAYMENT';
                  return true;
                }).length === 0 ? (
                  <div className="py-12 text-center text-sm font-bold text-slate-400">No se registran movimientos para este filtro</div>
                ) : (
                  <div className="space-y-3">
                    {clientMovements
                      .filter((mov) => {
                        if (historyFilter === 'PURCHASES') return mov.type === 'DEBT';
                        if (historyFilter === 'PAYMENTS') return mov.type === 'PAYMENT';
                        return true;
                      })
                      .map((mov) => {
                        const isPayment = mov.type === 'PAYMENT';
                        const formattedDate = new Date(mov.createdAt).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });

                        return (
                          <div 
                            key={mov.id} 
                            className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row justify-between items-stretch md:items-start gap-3 ${isPayment ? 'bg-emerald-50/20 border-emerald-100/60' : 'bg-rose-50/10 border-rose-100/40'}`}
                          >
                            <div className="space-y-1 text-left flex-1">
                              <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md ${isPayment ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {isPayment ? 'Abono / Pago' : 'Crédito / Compra'}
                              </span>
                              <p className="text-xs font-bold text-slate-800 pt-1">
                                {mov.description || (isPayment ? 'Pago Registrado' : 'Venta Registrada')}
                              </p>
                              <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> {formattedDate}
                              </p>
                              
                              {/* Product Items Details for Purchases (DEBT) */}
                              {!isPayment && mov.sale?.items && mov.sale.items.length > 0 && (
                                <div className="mt-2.5 pt-2 border-t border-dashed border-rose-200/40 space-y-1">
                                  <p className="text-[8px] font-black uppercase text-rose-500 tracking-wider">Detalle de Productos:</p>
                                  <div className="space-y-0.5">
                                    {mov.sale.items.map((item: any) => (
                                      <div key={item.id} className="flex justify-between items-center text-[10px] text-slate-500 font-bold gap-3">
                                        <span>• {item.quantity}x {item.productName}</span>
                                        <span className="text-slate-650">{fmt(item.total)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="text-right space-y-1 flex flex-row md:flex-col justify-between md:justify-start items-center md:items-end border-t md:border-t-0 border-slate-100 pt-2 md:pt-0 shrink-0">
                              <p className={`text-sm font-black ${isPayment ? 'text-emerald-600' : 'text-rose-650'}`}>
                                {isPayment ? '-' : '+'} {fmt(mov.amount)}
                              </p>
                              <p className="text-[9px] text-slate-450 font-bold">
                                Saldo: {fmt(mov.balanceAfter)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="pt-3 border-t border-slate-200 shrink-0">
                <button
                  onClick={() => { setShowMovementsModal(false); setSelectedClientForHistory(null); }}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs uppercase tracking-wider rounded-2xl transition-all"
                >
                  Cerrar Historial
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded List Modal */}
      <AnimatePresence>
        {showListModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowListModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="bg-white rounded-2xl w-full max-w-2xl overflow-hidden shadow-xl border border-slate-300 p-6 flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3 shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-600" /> Fichas de Cuentas Corrientes
                  </h3>
                  <p className="text-[9px] text-slate-600 font-semibold tracking-widest mt-0.5">LISTA COMPLETA DE CLIENTES</p>
                </div>
                <button onClick={() => setShowListModal(false)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              {/* Filters & Search inside Modal */}
              <div className="py-4 space-y-3 shrink-0">
                <div className="relative flex items-center">
                  <Search className="absolute left-4 w-4 h-4 text-slate-350 pointer-events-none" />
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por nombre, DNI o teléfono..." 
                    className="w-full bg-slate-50/50 border border-slate-300 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold text-slate-600 focus:bg-white focus:border-rose-200 transition-all outline-none shadow-inner"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'all', label: 'Todos', count: clients.length },
                    { id: 'debt', label: 'Con deuda', count: withDebtCount },
                    { id: 'credit', label: 'A favor', count: clients.filter(c => c.balance > 0).length },
                    { id: 'none', label: 'Sin deuda', count: clients.filter(c => c.balance === 0).length }
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setActiveFilter(f.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${activeFilter === f.id ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                    >
                      {f.label} ({f.count})
                    </button>
                  ))}
                </div>
              </div>

              {/* Scrollable List Container */}
              <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-50 rounded-xl bg-slate-50/30">
                {filteredClients.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-12 px-6">
                    <FileText className="w-10 h-10 text-slate-200 mb-3" />
                    <p className="text-xs font-bold text-slate-700 uppercase">Sin resultados</p>
                    <p className="text-[10px] text-slate-450 mt-1 font-semibold">No se encontraron clientes para la búsqueda.</p>
                  </div>
                ) : (
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white shadow-sm border-b border-slate-300 z-10">
                      <tr>
                        <th className="py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider px-4">Cliente</th>
                        <th className="py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider px-4">DNI / Teléfono</th>
                        <th className="py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider px-4 text-right">Saldo</th>
                        <th className="py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider px-4 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredClients.map(client => {
                        if (!client) return null;
                        const displayName = client.name || 'Cliente sin nombre';
                        const initialLetter = displayName ? displayName[0].toUpperCase() : '?';
                        return (
                          <tr key={client.id} className="hover:bg-white transition-colors bg-white/50">
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-3.5">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-600 text-xs">{initialLetter}</div>
                                <span className="text-xs font-bold text-slate-800">{displayName}</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <p className="text-[10px] font-bold text-slate-700 uppercase">{client.dni || 'S/D'}</p>
                              <p className="text-[9px] font-bold text-slate-600">{client.phone || 'S/D'}</p>
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <span className={`text-xs font-bold ${(client.balance || 0) > 0 ? 'text-rose-500' : (client.balance || 0) < 0 ? 'text-emerald-500' : 'text-slate-600'}`}>
                                {fmt(client.balance || 0)}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                {(client.balance || 0) > 0 && (
                                  <button 
                                    onClick={() => { setClientToAbonar(client); setAbonoAmount(Math.abs(client.balance)); setShowListModal(false); setShowAbonoAmountModal(true); }}
                                    className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-all font-bold"
                                    title="Abonar"
                                  >
                                    <DollarSign className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                 <button 
                                  onClick={() => { setShowListModal(false); handleViewMovements(client); }}
                                  className="p-2 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all font-bold"
                                  title="Ver Historial"
                                 >
                                  <FileText className="w-3.5 h-3.5" />
                                 </button>
                                 <button 
                                  onClick={() => { setEditingClient(client); setShowEditModal(true); }}
                                  className="p-2 rounded-lg bg-slate-50 text-slate-450 hover:bg-emerald-50 hover:text-emerald-600 transition-all"
                                  title="Editar / Eliminar Cliente"
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="pt-4 border-t border-slate-300 flex justify-end shrink-0">
                <button 
                  onClick={() => setShowListModal(false)}
                  className="px-6 py-2.5 bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAbonoAmountModal && clientToAbonar && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-xl border border-slate-300 p-6"
            >
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4">Abonar a {clientToAbonar.name}</h3>
              <div className="mb-6">
                <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Monto a abonar</label>
                <input 
                  type="number" 
                  value={abonoAmount || ''} 
                  onChange={(e) => setAbonoAmount(Number(e.target.value))} 
                  className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-lg font-bold text-slate-800 focus:bg-white focus:border-emerald-500 outline-none transition-all"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && abonoAmount > 0) {
                      if (!currentSession) {
                        toast.error('Caja cerrada. Debes abrir la caja antes de registrar un cobro.');
                        return;
                      }
                      setShowAbonoAmountModal(false);
                      setShowAbonoPaymentModal(true);
                    }
                  }}
                />
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowAbonoAmountModal(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs uppercase tracking-wider rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => {
                    if (!currentSession) {
                      toast.error('Caja cerrada. Debes abrir la caja antes de registrar un cobro.');
                      return;
                    }
                    if (abonoAmount > 0) {
                      setShowAbonoAmountModal(false);
                      setShowAbonoPaymentModal(true);
                    }
                  }}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md transition-all"
                >
                  Continuar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAbonoPaymentModal && clientToAbonar && currentSession && (
          <PaymentModal 
            key="abono-payment-modal"
            total={abonoAmount}
            sessionId={currentSession.id}
            onClose={() => setShowAbonoPaymentModal(false)}
            onSuccess={() => {
              setShowAbonoPaymentModal(false);
              loadClients();
              toast.success('Abono registrado correctamente');
            }}
            isDebtPayment={true}
            debtClient={clientToAbonar}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
