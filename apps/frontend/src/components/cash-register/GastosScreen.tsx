import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { 
  Receipt, 
  Search, 
  Plus, 
  Wallet, 
  Trash2, 
  Calendar, 
  TrendingDown, 
  Info,
  DollarSign,
  User,
  AlertCircle,
  X,
  Maximize2,
  Minimize2,
  Edit2
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import GastosModal from '../pos/GastosModal';

export default function GastosScreen() {
  const { user } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [movements, setMovements] = useState<any[]>([]);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedTab, setSelectedTab] = useState<'ALL' | 'FIXED' | 'VARIABLE'>('ALL');
  const [showModal, setShowModal] = useState(false);
  const [selectedMovement, setSelectedMovement] = useState<any | null>(null);
  const [editingGasto, setEditingGasto] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isExpanded, setIsExpanded] = useState(false);

  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState<string>('all');
  const [allUsers, setAllUsers] = useState<any[]>([]);

  // Month & Year list for selectors
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const years = [2025, 2026, 2027, 2028];

  useEffect(() => {
    loadCurrentSession();
    loadMovements();
    api.get('/users').then(res => setAllUsers(res.data || [])).catch(() => {});
    
    // Check if redirect wants to open the modal immediately
    const modalParam = searchParams.get('modal');
    if (modalParam === 'gastos') {
      setShowModal(true);
      setSearchParams({});
    }
  }, [selectedMonth, selectedYear]);

  const loadCurrentSession = async () => {
    try {
      let uuid = localStorage.getItem('terminal_uuid');
      if (!uuid) {
        uuid = 'term_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('terminal_uuid', uuid);
      }
      const { data: termData } = await api.get(`/cash/terminal-name?terminalId=${uuid}`);
      const tName = termData.terminalName;
      const { data } = await api.get('/cash/current', { params: { terminalName: tName } });
      setCurrentSession(data);
    } catch {}
  };

  const loadMovements = async () => {
    setIsLoading(true);
    try {
      // Calculate date ranges for month/year filter
      const fromDate = new Date(selectedYear, selectedMonth, 1);
      const toDate = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);

      const { data } = await api.get('/cash/movements', {
        params: {
          type: 'EXPENSE',
          from: fromDate.toISOString(),
          to: toDate.toISOString()
        }
      });
      setMovements(data);
    } catch (err) {
      toast.error('Error al cargar gastos');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Seguro que querés eliminar este gasto? Esto anulará el egreso del efectivo de caja.')) return;
    try {
      await api.delete(`/cash/movement/${id}`);
      toast.success('Gasto eliminado correctamente');
      loadMovements();
      loadCurrentSession();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al eliminar el gasto. ¿La caja ya está cerrada?');
    }
  };

  const parseMovement = (mov: any) => {
    const desc = mov.description || '';
    const categoryMatch = desc.match(/^\[(.*?)\]/);
    let category = categoryMatch ? categoryMatch[1] : 'Otro';
    
    if (!categoryMatch && (desc.toLowerCase().includes('liquidación de sueldo') || desc.toLowerCase().includes('liquidacion de sueldo'))) {
      category = 'Sueldos / Adelantos';
    }
    
    const cleanDescription = desc.replace(/^\[.*?\]/, '').trim();
    
    // Determine Fijos vs Variables
    // Fijos: Servicios, Sueldos, Impuestos
    // Variables: Mercadería, Mantenimiento, Otro
    const isFixed = ['Servicios (Luz, Agua, etc)', 'Sueldos / Adelantos', 'Impuestos'].includes(category);
    
    return {
      category,
      description: cleanDescription || 'Gasto operativo',
      isFixed,
      ...mov
    };
  };

  const parsedMovements = movements.map(parseMovement);

  const categories = [
    'Otro',
    'Mercadería / Insumos',
    'Servicios (Luz, Agua, etc)',
    'Sueldos / Adelantos',
    'Mantenimiento',
    'Impuestos'
  ];

  // Filters
  const filteredMovements = parsedMovements.filter((mov) => {
    const matchesSearch = 
      mov.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      mov.category.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTab = 
      selectedTab === 'ALL' ||
      (selectedTab === 'FIXED' && mov.isFixed) ||
      (selectedTab === 'VARIABLE' && !mov.isFixed);

    const matchesCategory = 
      selectedCategoryFilter === 'all' || 
      mov.category === selectedCategoryFilter;

    const selectedUserObj = allUsers.find(u => u.id === selectedEmployeeFilter);
    const matchesEmployee = 
      selectedEmployeeFilter === 'all' ||
      mov.userId === selectedEmployeeFilter ||
      mov.user?.id === selectedEmployeeFilter ||
      (selectedUserObj && (
        mov.description.toLowerCase().includes(selectedUserObj.username?.toLowerCase()) ||
        mov.description.toLowerCase().includes(selectedUserObj.fullName?.toLowerCase())
      ));

    return matchesSearch && matchesTab && matchesCategory && matchesEmployee;
  });

  const filteredTotalAmount = filteredMovements.reduce((sum, m) => sum + m.amount, 0);
  const isFiltered = searchQuery !== '' || selectedCategoryFilter !== 'all' || selectedEmployeeFilter !== 'all' || selectedTab !== 'ALL';

  // Calculate totals
  const totalAmount = parsedMovements.reduce((sum, m) => sum + m.amount, 0);
  const totalCount = parsedMovements.length;

  const fixedAmount = parsedMovements.filter(m => m.isFixed).reduce((sum, m) => sum + m.amount, 0);
  const fixedCount = parsedMovements.filter(m => m.isFixed).length;

  const variableAmount = parsedMovements.filter(m => !m.isFixed).reduce((sum, m) => sum + m.amount, 0);
  const variableCount = parsedMovements.filter(m => !m.isFixed).length;

  const formatPrice = (price: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(price);
  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const getCategoryStyles = (cat: string) => {
    const map: any = {
      'Otro': 'bg-slate-50 text-slate-600 border-slate-300',
      'Mercadería / Insumos': 'bg-emerald-50 text-emerald-600 border-emerald-100',
      'Servicios (Luz, Agua, etc)': 'bg-blue-50 text-blue-600 border-blue-100',
      'Sueldos / Adelantos': 'bg-rose-50 text-rose-600 border-rose-100',
      'Mantenimiento': 'bg-amber-50 text-amber-600 border-amber-100',
      'Impuestos': 'bg-rose-50 text-rose-600 border-rose-100'
    };
    return map[cat] || 'bg-slate-50 text-slate-600 border-slate-300';
  };

  return (
    <div className="h-full flex flex-col gap-5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Receipt className="w-7 h-7 text-rose-500" /> Gastos
          </h1>
          <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest mt-0.5">Control de gastos operativos</p>
        </div>
      </div>

      {/* Grid Cards (Total, Fijos, Variables) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        {/* TOTAL */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }} 
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-xl shadow-rose-500/10 flex flex-col relative overflow-hidden"
        >
          <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
          <span className="text-[9px] font-bold uppercase tracking-widest text-rose-100">TOTAL</span>
          <span className="text-3xl font-bold mt-1 leading-none">{formatPrice(totalAmount)}</span>
          <span className="text-[11px] font-bold text-rose-100 mt-2 flex items-center gap-1">
            <TrendingDown className="w-3.5 h-3.5" /> {totalCount} gastos operativos
          </span>
        </motion.div>

        {/* FIJOS */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: 0.05 }}
          className="card p-6 flex flex-col relative overflow-hidden"
        >
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">FIJOS</span>
          <span className="text-3xl font-bold mt-1 text-slate-800 leading-none">{formatPrice(fixedAmount)}</span>
          <span className="text-[11px] font-bold text-slate-600 mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> {fixedCount} gastos fijos (Servicios, Sueldos, Impuestos)
          </span>
        </motion.div>

        {/* VARIABLES */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ delay: 0.1 }}
          className="card p-6 flex flex-col relative overflow-hidden"
        >
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">VARIABLES</span>
          <span className="text-3xl font-bold mt-1 text-slate-800 leading-none">{formatPrice(variableAmount)}</span>
          <span className="text-[11px] font-bold text-slate-600 mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> {variableCount} variables (Insumos, Mantenimiento)
          </span>
        </motion.div>
      </div>

      {/* Filter and controls bar */}
      <div className="card px-6 py-4 flex flex-col md:flex-row items-center gap-4 shrink-0 justify-between">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
          <input 
            type="text" 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
            placeholder="Buscar gasto..." 
            className="w-full bg-slate-50/50 border border-slate-300 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all placeholder:text-slate-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto shrink-0 justify-end">
          {/* Category selector */}
          <select 
            value={selectedCategoryFilter} 
            onChange={(e) => setSelectedCategoryFilter(e.target.value)} 
            className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all appearance-none cursor-pointer"
          >
            <option value="all">Todas las categorías</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Employee selector */}
          <select 
            value={selectedEmployeeFilter} 
            onChange={(e) => setSelectedEmployeeFilter(e.target.value)} 
            className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all appearance-none cursor-pointer"
          >
            <option value="all">Todos los empleados</option>
            {allUsers.map(u => (
              <option key={u.id} value={u.id}>{u.fullName || u.username}</option>
            ))}
          </select>

          {/* Month selector */}
          <select 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(Number(e.target.value))} 
            className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all appearance-none cursor-pointer capitalize min-w-[120px]"
          >
            {months.map((m, i) => (
              <option key={m} value={i}>{m}</option>
            ))}
          </select>

          {/* Year selector */}
          <select 
            value={selectedYear} 
            onChange={(e) => setSelectedYear(Number(e.target.value))} 
            className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all appearance-none cursor-pointer"
          >
            {years.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {isFiltered && (
            <button 
              onClick={() => {
                setSelectedCategoryFilter('all');
                setSelectedEmployeeFilter('all');
                setSearchQuery('');
                setSelectedTab('ALL');
              }}
              className="px-3.5 py-2.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-2xl text-xs font-bold hover:bg-rose-100 transition-all cursor-pointer"
            >
              Limpiar Filtros
            </button>
          )}

          {/* New Expense button */}
          <button 
            onClick={() => {
              if (!currentSession || currentSession.status !== 'OPEN') {
                toast.error('⚠️ No hay una caja abierta o la caja ya está cerrada. Registrá una sesión en la pantalla de Caja para cargar gastos.');
                return;
              }
              setShowModal(true);
            }} 
            className="btn-primary text-xs shrink-0"
          >
            <Plus className="w-4 h-4" /> Nuevo Gasto
          </button>
        </div>
      </div>

      {/* Tabs and Data Table */}
      <div className="flex-1 card flex flex-col overflow-hidden p-6 gap-5">
        {/* Navigation Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full shrink-0 gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-2 p-1.5 rounded-2xl bg-slate-50 border border-slate-300/60 overflow-x-auto custom-scrollbar">
              <button 
                onClick={() => setSelectedTab('ALL')} 
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${selectedTab === 'ALL' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
              >
                Todos ({totalCount})
              </button>
              <button 
                onClick={() => setSelectedTab('FIXED')} 
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${selectedTab === 'FIXED' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
              >
                Fijos ({fixedCount})
              </button>
              <button 
                onClick={() => setSelectedTab('VARIABLE')} 
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${selectedTab === 'VARIABLE' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
              >
                Variables ({variableCount})
              </button>
            </div>
            {isFiltered && (
              <div className="px-4 py-2 bg-rose-50 border border-rose-150 text-rose-700 rounded-2xl text-xs font-bold shrink-0">
                Monto Filtrado: <span className="text-rose-900 font-extrabold">{formatPrice(filteredTotalAmount)}</span>
              </div>
            )}
          </div>

          <button 
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 rounded-xl text-xs font-bold transition-all active:scale-[0.97] cursor-pointer shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ver Completo</span>
            <span className="sm:hidden">Expandir</span>
          </button>
        </div>

        {/* List of movements */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-slate-600 text-sm font-medium">
              Cargando movimientos...
            </div>
          ) : filteredMovements.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4">
              <div className="w-16 h-16 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-300">
                <Wallet className="w-8 h-8 text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-600">No hay gastos en este período.</p>
                <p className="text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-1">Registrá un egreso usando el botón "Nuevo Gasto"</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[700px] text-left border-collapse">
                <thead>
                  <tr className="text-[9px] font-bold text-slate-600 uppercase tracking-widest border-b border-slate-300 pb-3">
                    <th className="pb-3 text-left pl-2">Categoría</th>
                    <th className="pb-3 text-left">Descripción</th>
                    <th className="pb-3 text-left">Fecha/Hora</th>
                    <th className="pb-3 text-left"><span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Registrado por</span></th>
                    <th className="pb-3 text-right">Monto</th>
                    <th className="pb-3 text-right pr-2">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredMovements.map((mov) => (
                    <tr key={mov.id} onClick={() => setSelectedMovement(mov)} className="hover:bg-slate-50 transition-colors group cursor-pointer font-medium">
                      <td className="py-4 text-left pl-2">
                        <span className={`text-[10px] font-bold px-3 py-1 rounded-xl border uppercase tracking-tight inline-block ${getCategoryStyles(mov.category)}`}>
                          {mov.category}
                        </span>
                      </td>
                      <td className="py-4 text-left text-xs font-bold text-slate-700">
                        {mov.description}
                      </td>
                      <td className="py-4 text-left text-xs font-medium text-slate-600">
                        {formatDate(mov.createdAt)}
                      </td>
                      <td className="py-4 text-left text-xs font-semibold text-slate-700">
                        {mov.user?.fullName || 'Desconocido'}
                      </td>
                      <td className="py-4 text-right text-xs font-bold text-slate-800">
                        {formatPrice(mov.amount)}
                      </td>
                      <td className="py-4 text-right pr-2">
                        {currentSession && mov.sessionId === currentSession.id && (
                          <>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingGasto(mov);
                                setShowModal(true);
                              }} 
                              className="p-2 rounded-xl text-slate-600 hover:bg-rose-50 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer mr-1"
                              title="Editar gasto"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(mov.id);
                              }} 
                              className="p-2 rounded-xl text-slate-600 hover:bg-rose-50 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                              title="Eliminar gasto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* GastosModal for creation */}
      <AnimatePresence>
        {showModal && (
          <GastosModal 
            sessionId={currentSession?.id} 
            editingGasto={editingGasto}
            onClose={() => {
              setShowModal(false);
              setEditingGasto(null);
              loadMovements();
              loadCurrentSession();
            }} 
          />
        )}
      </AnimatePresence>

      {/* Detailed Expense Modal */}
      <AnimatePresence>
        {selectedMovement && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" 
            onClick={() => setSelectedMovement(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              onClick={(e) => e.stopPropagation()} 
              className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-xl border border-slate-400 p-6 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Detalle del Gasto</h3>
                  <p className="text-[9px] text-slate-600 font-semibold tracking-widest mt-0.5">COMPROBANTE OPERATIVO</p>
                </div>
                <button onClick={() => setSelectedMovement(null)} className="p-1.5 hover:bg-slate-150 rounded-lg text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-4 text-xs font-semibold text-slate-600">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-600 uppercase font-bold tracking-wider">Categoría</span>
                  <span className={`text-[10px] font-bold px-3 py-1 rounded-xl border uppercase tracking-tight ${getCategoryStyles(selectedMovement.category)}`}>
                    {selectedMovement.category}
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-150 p-4 rounded-xl space-y-1.5">
                  <span className="text-[9px] text-slate-600 uppercase font-bold tracking-wider block">Descripción</span>
                  <p className="text-slate-800 font-bold leading-relaxed">{selectedMovement.description || 'Gasto general de caja registradora'}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50/50 border border-slate-300 p-3 rounded-xl">
                    <span className="text-[9px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Fecha / Hora</span>
                    <span className="text-slate-700 text-[11px] font-bold">{new Date(selectedMovement.createdAt).toLocaleString('es-AR')}</span>
                  </div>
                  <div className="bg-slate-50/50 border border-slate-300 p-3 rounded-xl">
                    <span className="text-[9px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Usuario</span>
                    <span className="text-slate-700 text-[11px] font-bold">{selectedMovement.user?.fullName || 'Desconocido'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50/50 border border-slate-300 p-3 rounded-xl">
                    <span className="text-[9px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Terminal</span>
                    <span className="text-slate-700 text-[11px] font-bold uppercase">{selectedMovement.session?.terminalName || 'Terminal Principal'}</span>
                  </div>
                  <div className="bg-slate-50/50 border border-slate-300 p-3 rounded-xl">
                    <span className="text-[9px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Medio de Pago</span>
                    <span className="text-slate-700 text-[11px] font-bold">💵 Efectivo de Caja</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-300 flex justify-between items-center">
                  <span className="text-xs text-slate-700 font-bold uppercase tracking-wider">Total Egresado</span>
                  <span className="text-2xl font-black text-rose-600 tracking-tight">{formatPrice(selectedMovement.amount)}</span>
                </div>
              </div>

              <button onClick={() => setSelectedMovement(null)} className="w-full py-3 bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md active:scale-95 transition-all cursor-pointer">
                Cerrar Detalle
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded View for List on Mobile */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="fixed inset-0 z-[80] bg-slate-50 flex flex-col p-4 overflow-hidden"
          >
            {/* Header */}
            <div className="card flex items-center justify-between mb-4 p-4 shrink-0">
              <div>
                <h3 className="text-sm font-bold text-slate-850 flex items-center gap-2 uppercase tracking-wider">
                  <Receipt className="w-5 h-5 text-rose-500" /> Historial de Gastos Completo
                </h3>
                <p className="text-[9px] text-slate-600 font-bold uppercase tracking-wider mt-0.5">Vista ampliada del período seleccionado</p>
              </div>
              <button 
                onClick={() => setIsExpanded(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 rounded-xl text-xs font-bold transition-all active:scale-[0.97] cursor-pointer"
              >
                <Minimize2 className="w-4 h-4" /> Minimizar
              </button>
            </div>

            {/* Content box */}
            <div className="flex-1 card flex flex-col overflow-hidden p-4 gap-4">
              {/* Filters inside Expanded view */}
              <div className="flex flex-col gap-3 shrink-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                    <input 
                      type="text" 
                      value={searchQuery} 
                      onChange={(e) => setSearchQuery(e.target.value)} 
                      placeholder="Buscar gasto..." 
                      className="w-full bg-slate-50/50 border border-slate-300 rounded-2xl pl-11 pr-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all placeholder:text-slate-600"
                    />
                  </div>

                  {/* Category selector */}
                  <select 
                    value={selectedCategoryFilter} 
                    onChange={(e) => setSelectedCategoryFilter(e.target.value)} 
                    className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all appearance-none cursor-pointer"
                  >
                    <option value="all">Todas las categorías</option>
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  {/* Employee selector */}
                  <select 
                    value={selectedEmployeeFilter} 
                    onChange={(e) => setSelectedEmployeeFilter(e.target.value)} 
                    className="bg-slate-50 border border-slate-300 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:border-rose-500 transition-all appearance-none cursor-pointer"
                  >
                    <option value="all">Todos los empleados</option>
                    {allUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.fullName || u.username}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2 p-1.5 rounded-2xl bg-slate-50 border border-slate-300/60 overflow-x-auto custom-scrollbar">
                    <button 
                      onClick={() => setSelectedTab('ALL')} 
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${selectedTab === 'ALL' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
                    >
                      Todos ({totalCount})
                    </button>
                    <button 
                      onClick={() => setSelectedTab('FIXED')} 
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${selectedTab === 'FIXED' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
                    >
                      Fijos ({fixedCount})
                    </button>
                    <button 
                      onClick={() => setSelectedTab('VARIABLE')} 
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${selectedTab === 'VARIABLE' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-600'}`}
                    >
                      Variables ({variableCount})
                    </button>
                  </div>

                  {isFiltered && (
                    <div className="flex items-center gap-3">
                      <div className="px-4 py-1.5 bg-rose-50 border border-rose-150 text-rose-700 rounded-xl text-xs font-bold">
                        Monto Filtrado: <span className="text-rose-900 font-extrabold">{formatPrice(filteredTotalAmount)}</span>
                      </div>
                      <button 
                        onClick={() => {
                          setSelectedCategoryFilter('all');
                          setSelectedEmployeeFilter('all');
                          setSearchQuery('');
                          setSelectedTab('ALL');
                        }}
                        className="px-3.5 py-1.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-xs font-bold hover:bg-rose-100 transition-all cursor-pointer"
                      >
                        Limpiar Filtros
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto custom-scrollbar">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-sm font-medium">
                    Cargando movimientos...
                  </div>
                ) : filteredMovements.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4">
                    <div className="w-16 h-16 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-300">
                      <Wallet className="w-8 h-8 text-slate-300" />
                    </div>
                    <p className="text-sm font-bold text-slate-600">No hay gastos en este período.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full min-w-[750px] text-left border-collapse">
                      <thead>
                        <tr className="text-[9px] font-bold text-slate-600 uppercase tracking-widest border-b border-slate-300 pb-3">
                          <th className="pb-3 text-left pl-2">Categoría</th>
                          <th className="pb-3 text-left">Descripción</th>
                          <th className="pb-3 text-left">Fecha/Hora</th>
                          <th className="pb-3 text-left"><span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Registrado por</span></th>
                          <th className="pb-3 text-right">Monto</th>
                          <th className="pb-3 text-right pr-2">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredMovements.map((mov) => (
                          <tr key={mov.id} onClick={() => setSelectedMovement(mov)} className="hover:bg-slate-50 transition-colors group cursor-pointer font-medium">
                            <td className="py-4 text-left pl-2">
                              <span className={`text-[10px] font-bold px-3 py-1 rounded-xl border uppercase tracking-tight inline-block ${getCategoryStyles(mov.category)}`}>
                                {mov.category}
                              </span>
                            </td>
                            <td className="py-4 text-left text-xs font-bold text-slate-700">
                              {mov.description}
                            </td>
                            <td className="py-4 text-left text-xs font-medium text-slate-600">
                              {formatDate(mov.createdAt)}
                            </td>
                            <td className="py-4 text-left text-xs font-semibold text-slate-700">
                              {mov.user?.fullName || 'Desconocido'}
                            </td>
                            <td className="py-4 text-right text-xs font-bold text-slate-800">
                              {formatPrice(mov.amount)}
                            </td>
                            <td className="py-4 text-right pr-2">
                              {currentSession && mov.sessionId === currentSession.id && (
                                <>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingGasto(mov);
                                      setShowModal(true);
                                    }} 
                                    className="p-2 rounded-xl text-slate-600 hover:bg-rose-50 hover:text-rose-500 opacity-100 transition-all cursor-pointer mr-1"
                                    title="Editar gasto"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete(mov.id);
                                    }} 
                                    className="p-2 rounded-xl text-slate-600 hover:bg-rose-50 hover:text-rose-500 opacity-100 transition-all cursor-pointer"
                                    title="Eliminar gasto"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
