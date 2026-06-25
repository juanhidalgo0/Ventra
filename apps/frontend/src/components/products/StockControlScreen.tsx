import { useState, useEffect } from 'react';
import api from '../../services/api';
import { 
  ArrowRightLeft, 
  History, 
  Search, 
  ArrowUpRight, 
  ArrowDownRight, 
  Package, 
  User, 
  FileText,
  AlertCircle,
  ChevronDown,
  Plus,
  RefreshCw,
  Clock,
  UserCheck,
  CheckCircle2,
  FileSpreadsheet
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

export default function StockControlScreen() {
  const [activeTab, setActiveTab] = useState<'register' | 'history'>('register');
  const [movementType, setMovementType] = useState<'ENTRY' | 'EXIT'>('EXIT');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [movements, setMovements] = useState<any[]>([]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab]);

  const loadHistory = async () => {
    try {
      const { data } = await api.get('/products/movements/all');
      setMovements(data);
    } catch (err) {
      toast.error('Error al cargar historial');
    }
  };

  const handleSearch = async (val: string) => {
    setSearchQuery(val);
    if (val.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const { data } = await api.get('/products', { params: { search: val } });
      setSearchResults(data);
    } catch {} finally { setIsSearching(false); }
  };

  const handleSubmit = async () => {
    if (!selectedProduct || !quantity || !reason) {
      toast.error('Completar campos obligatorios');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.post(`/products/${selectedProduct.id}/movement`, {
        type: movementType,
        quantity: parseFloat(quantity.toString()),
        reason,
        note
      });
      toast.success('Movimiento registrado con éxito');
      setQuantity(0);
      setReason('');
      setNote('');
      setSelectedProduct(null);
      setSearchQuery('');
    } catch (err) {
      toast.error('Error al registrar movimiento');
    } finally { setIsSubmitting(false); }
  };

  const motives = movementType === 'ENTRY' 
    ? ['Compra de mercadería', 'Devolución de cliente', 'Ajuste de inventario', 'Carga inicial']
    : ['Vencimiento', 'Rotura / Merma', 'Consumo interno', 'Ajuste de inventario', 'Error de carga'];

  return (
    <div className="h-full flex flex-col gap-4 bg-slate-50/30 p-2 overflow-y-auto custom-scrollbar">
      {/* Tab Selector */}
      <div className="bg-white rounded-xl p-1 flex items-center gap-1 shrink-0 border border-slate-400">
        <button 
          onClick={() => setActiveTab('register')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'register' ? 'bg-slate-800 text-white' : 'text-slate-700 hover:text-slate-700 hover:bg-slate-50'}`}
        >
          <ArrowRightLeft className="w-4 h-4" /> Registrar Movimiento
        </button>
        <button 
          onClick={() => setActiveTab('history')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === 'history' ? 'bg-slate-800 text-white' : 'text-slate-700 hover:text-slate-700 hover:bg-slate-50'}`}
        >
          <History className="w-4 h-4" /> Historial de Movimientos
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'register' ? (
          <motion.div 
            key="register"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-4 gap-6"
          >
            {/* Main Form Column */}
            <div className="lg:col-span-3 bg-white p-8 rounded-xl border border-slate-400 space-y-8">
              
              <div className="space-y-4">
                 <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Tipo de Movimiento</h4>
                 <div className="grid grid-cols-2 gap-4">
                   <button 
                     onClick={() => setMovementType('ENTRY')}
                      className={`flex items-center justify-center gap-3 p-6 rounded-xl border transition-all ${movementType === 'ENTRY' ? 'bg-emerald-50 border-emerald-400' : 'bg-white border-slate-400 group hover:border-emerald-200'}`}
                   >
                       <ArrowUpRight className={`w-5 h-5 ${movementType === 'ENTRY' ? 'text-emerald-500' : 'text-slate-300'}`} />
                      <div className="text-left">
                         <p className={`text-sm font-bold ${movementType === 'ENTRY' ? 'text-emerald-700' : 'text-slate-600'}`}>Ingreso</p>
                         <p className="text-[10px] text-slate-600">Entrada de stock</p>
                      </div>
                   </button>
                   <button 
                     onClick={() => setMovementType('EXIT')}
                      className={`flex items-center justify-center gap-3 p-6 rounded-xl border transition-all ${movementType === 'EXIT' ? 'bg-rose-50 border-rose-400' : 'bg-white border-slate-400 group hover:border-rose-200'}`}
                   >
                       <ArrowDownRight className={`w-5 h-5 ${movementType === 'EXIT' ? 'text-rose-500' : 'text-slate-300'}`} />
                      <div className="text-left">
                         <p className={`text-sm font-bold ${movementType === 'EXIT' ? 'text-rose-700' : 'text-slate-600'}`}>Egreso</p>
                         <p className="text-[10px] text-slate-600">Salida de stock</p>
                      </div>
                   </button>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-6">
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3 block">Producto *</span>
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                      <input 
                        type="text" 
                        value={selectedProduct ? selectedProduct.name : searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        onFocus={() => selectedProduct && setSelectedProduct(null)}
                        placeholder="Escribe nombre o código..." 
                        className="w-full bg-slate-50 border border-slate-400 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all outline-none font-medium placeholder:text-slate-600" 
                      />
                      {searchResults.length > 0 && !selectedProduct && (
                        <div className="absolute top-full left-0 w-full mt-1 bg-white rounded-lg shadow-lg border border-slate-400 z-50 overflow-hidden">
                          {searchResults.map((p) => (
                            <button 
                              key={p.id}
                              onClick={() => { setSelectedProduct(p); setSearchResults([]); }}
                              className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                            >
                               <div className="text-left">
                                  <p className="text-xs font-bold text-slate-800">{p.name}</p>
                                  <p className="text-[10px] text-slate-600 font-bold uppercase">{p.barcode}</p>
                               </div>
                               <span className="text-[10px] font-bold text-indigo-500">Stock: {p.stock}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3 block">Cantidad *</span>
                    <input 
                      type="number" 
                      value={quantity}
                      onChange={(e) => setQuantity(parseFloat(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-400 rounded-lg px-3.5 py-2.5 text-sm focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all outline-none font-medium" 
                    />
                  </label>

                  <label className="block opacity-50">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3 block">Proveedor (Opcional)</span>
                    <div className="relative">
                       <select className="w-full bg-slate-50 border border-slate-400 rounded-lg px-4 py-2.5 text-sm outline-none font-bold appearance-none cursor-not-allowed" disabled>
                          <option>Seleccionar...</option>
                       </select>
                       <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                    </div>
                  </label>
                </div>

                <div className="space-y-6">
                  <div className="h-[92px]" />
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3 block">Motivo *</span>
                    <div className="relative">
                       <select 
                         value={reason}
                         onChange={(e) => setReason(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-400 rounded-lg px-3.5 py-2.5 text-sm focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all outline-none font-medium appearance-none cursor-pointer"
                       >
                          <option value="">Seleccionar motivo...</option>
                          {motives.map(m => <option key={m} value={m}>{m}</option>)}
                       </select>
                       <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 pointer-events-none" />
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3 block">Nota (Opcional)</span>
                    <textarea 
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Detalle adicional..." 
                      className="w-full h-28 bg-slate-50 border border-slate-400 rounded-lg px-3.5 py-2.5 text-sm focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all outline-none font-medium resize-none"
                    ></textarea>
                  </label>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-300 flex justify-end">
                 <button 
                   onClick={handleSubmit}
                   disabled={!selectedProduct || !quantity || !reason || isSubmitting}
                   className={`px-8 py-3 rounded-lg font-semibold text-sm transition-all ${
                     (!selectedProduct || !quantity || !reason || isSubmitting) 
                       ? 'bg-slate-100 text-slate-600 cursor-not-allowed' 
                       : (movementType === 'ENTRY' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-rose-600 text-white hover:bg-rose-700')
                   }`}
                 >
                    {isSubmitting ? 'Registrando...' : `Confirmar ${movementType === 'ENTRY' ? 'Ingreso' : 'Egreso'}`}
                 </button>
              </div>
            </div>

            {/* Info Column */}
            <div className="space-y-6">
               <div className="bg-white p-6 rounded-xl border border-slate-400 flex flex-col items-center justify-center text-center min-h-[280px]">
                  {selectedProduct ? (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="w-full space-y-6">
                       <div className="w-20 h-20 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto text-indigo-500">
                          <Package className="w-10 h-10" />
                       </div>
                       <div>
                          <h4 className="text-base font-bold text-gray-800">{selectedProduct.name}</h4>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">{selectedProduct.barcode}</p>
                       </div>
                       <div className="grid grid-cols-2 gap-4 py-4 border-y border-gray-50">
                          <div>
                             <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Stock Actual</p>
                             <p className={`text-xl font-bold ${selectedProduct.stock <= selectedProduct.minStock ? 'text-rose-500' : 'text-indigo-600'}`}>{selectedProduct.stock}</p>
                          </div>
                          <div>
                             <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Costo Unit.</p>
                             <p className="text-xl font-bold text-gray-800">$ {selectedProduct.costPrice}</p>
                          </div>
                       </div>
                       <p className="text-[10px] font-bold text-gray-400 uppercase">Categoría: {selectedProduct.category?.name || 'N/A'}</p>
                    </motion.div>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-xl bg-slate-50 flex items-center justify-center mb-6">
                        <Package className="w-8 h-8 text-slate-200" />
                      </div>
                      <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest leading-relaxed">
                        Selecciona un producto para ver su información detallada y stock actual.
                      </p>
                    </>
                  )}
               </div>

               <div className="bg-indigo-50/50 p-8 rounded-2xl border border-indigo-100/50 space-y-6">
                  <h4 className="text-[11px] font-bold text-indigo-700 uppercase tracking-widest flex items-center gap-2">
                     <AlertCircle className="w-4 h-4" /> Tips de Registro
                  </h4>
                  <ul className="space-y-4">
                     <li className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                        <p className="text-[10px] font-bold text-indigo-600/80 leading-relaxed uppercase tracking-widest">Usa <span className="font-bold">Ingreso</span> para compras o stock inicial.</p>
                     </li>
                     <li className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                        <p className="text-[10px] font-bold text-indigo-600/80 leading-relaxed uppercase tracking-widest">Usa <span className="font-bold">Egreso</span> para mermas, vencimientos o consumo propio.</p>
                     </li>
                     <li className="flex gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                        <p className="text-[10px] font-bold text-indigo-600/80 leading-relaxed uppercase tracking-widest">El historial se guarda automáticamente con quien lo cambie.</p>
                     </li>
                  </ul>
               </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="history"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col gap-4 overflow-hidden"
          >
            {/* AUDITORIA DE MOVIMIENTOS HEADER */}
            <div className="bg-white p-5 rounded-xl border border-slate-400 space-y-5">
               <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-800 tracking-tight">Auditoría de Movimientos</h3>
                  <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-all">
                     <FileSpreadsheet className="w-4 h-4" /> Exportar a Excel
                  </button>
               </div>
               
               <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-2">
                     <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-1">Mes</label>
                     <div className="relative">
                        <select className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-[11px] font-bold uppercase outline-none appearance-none cursor-pointer">
                           <option>Mayo</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-1">Año</label>
                     <div className="relative">
                        <select className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-[11px] font-bold uppercase outline-none appearance-none cursor-pointer">
                           <option>2026</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-1">Tipo de Movimiento</label>
                     <div className="relative">
                        <select className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-[11px] font-bold uppercase outline-none appearance-none cursor-pointer">
                           <option>Todos</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-1">Buscar Producto</label>
                     <div className="relative">
                        <input type="text" placeholder="Nombre o código..." className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-[11px] font-bold outline-none placeholder:text-slate-300" />
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                     </div>
                  </div>
               </div>
            </div>

            {/* TABLE */}
            <div className="flex-1 bg-white rounded-xl border border-slate-400 overflow-x-auto overflow-y-auto max-h-[calc(100vh-320px)] custom-scrollbar">
               <table className="w-full text-left">
                  <thead className="bg-slate-50/50 border-b border-gray-50">
                     <tr>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">FECHA/HORA</th>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">PRODUCTO</th>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">TIPO</th>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em] text-center">CANTIDAD</th>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em] text-center">STOCK</th>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">USUARIO</th>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">PROVEEDOR</th>
                        <th className="px-6 py-4 text-[9px] font-bold text-gray-400 uppercase tracking-[0.2em]">NOTA</th>
                     </tr>
                  </thead>
                  <tbody>
                     {movements.length > 0 ? (
                        movements.map(m => (
                           <tr key={m.id} className="hover:bg-slate-50/30 transition-colors border-b border-gray-50 last:border-0">
                              <td className="px-6 py-4 text-[10px] font-bold text-gray-400">{new Date(m.createdAt).toLocaleString()}</td>
                              <td className="px-6 py-4">
                                 <p className="text-[11px] font-bold text-gray-800">{m.product.name}</p>
                                 <p className="text-[9px] text-gray-400 font-bold">{m.product.barcode}</p>
                              </td>
                              <td className="px-6 py-4">
                                 <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${m.type === 'ENTRY' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                                    {m.type === 'ENTRY' ? 'Ingreso' : 'Egreso'}
                                 </span>
                              </td>
                              <td className={`px-6 py-4 text-center text-[11px] font-bold ${m.type === 'ENTRY' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                 {m.type === 'ENTRY' ? '+' : ''}{m.quantity}
                              </td>
                              <td className="px-6 py-4 text-center text-[11px] font-bold text-indigo-500">{m.stockAfter}</td>
                              <td className="px-6 py-4 text-[11px] font-bold text-gray-500 uppercase">{m.user.fullName}</td>
                              <td className="px-6 py-4 text-[11px] font-bold text-gray-400">---</td>
                              <td className="px-6 py-4 text-[11px] font-bold text-gray-400 truncate max-w-[120px]">{m.reference || '---'}</td>
                           </tr>
                        ))
                     ) : (
                        <tr>
                           <td colSpan={8} className="py-20 text-center">
                              <p className="text-[11px] font-bold text-slate-300 uppercase tracking-[0.3em]">No hay movimientos registrados</p>
                           </td>
                        </tr>
                     )}
                  </tbody>
               </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
