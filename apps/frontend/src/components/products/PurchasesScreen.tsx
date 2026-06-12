import { useState, useEffect } from 'react';
import { ShoppingCart, Search, Plus, Box, ChevronDown, History, Scan, RefreshCw, X, Receipt } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import NewPurchaseScreen from './NewPurchaseScreen';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

export default function PurchasesScreen() {
  const [view, setView] = useState<'list' | 'new'>('list');
  const [purchases, setPurchases] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<any>(null);

  useEffect(() => {
    if (view === 'list') {
      loadPurchases();
    }
  }, [view]);

  const loadPurchases = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/purchases');
      setPurchases(data);
    } catch (err) {
      toast.error('Error al cargar historial de compras');
    } finally {
      setIsLoading(false);
    }
  };

  if (view === 'new') {
    return <NewPurchaseScreen onBack={() => setView('list')} />;
  }

  const totalSpent = purchases.reduce((sum, p) => sum + p.total, 0);

  return (
    <div className="h-full flex flex-col gap-4 bg-slate-50/30 p-2 overflow-y-auto custom-scrollbar">
      {/* Title & Subtitle */}
      <div className="flex items-center justify-between px-2">
         <div>
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
               <ShoppingCart className="w-5 h-5 text-indigo-500" /> Compras
            </h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Registro de compras a proveedores</p>
         </div>
         <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input type="text" placeholder="Buscar..." className="bg-white border border-gray-100 rounded-xl pl-9 pr-4 py-2 text-[10px] font-bold outline-none focus:border-indigo-200 transition-all w-32" />
         </div>
      </div>

      {/* Scanner Alert Bar */}
      <div className="bg-[#f0fdf4] border border-emerald-100 px-6 py-3 rounded-2xl flex items-center gap-3">
         <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
         <Scan className="w-4 h-4 text-emerald-500" />
         <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">
           Escáner activo — Escaneá un producto para iniciar una compra rápida
         </p>
      </div>

      {/* Filters and Action Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100 w-full sm:w-auto justify-between sm:justify-start">
            <div className="relative">
               <select className="bg-white shadow-sm rounded-lg text-[10px] font-bold text-gray-800 uppercase tracking-tighter px-4 py-2 outline-none appearance-none cursor-pointer">
                  <option>Mayo</option>
               </select>
               <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>
            <div className="relative">
               <select className="bg-transparent text-[10px] font-bold text-gray-400 uppercase tracking-tighter px-4 py-2 outline-none appearance-none cursor-pointer hover:text-gray-600 transition-colors">
                  <option>2026</option>
               </select>
               <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-300 pointer-events-none" />
            </div>
          </div>
          <div className="px-4 py-2 bg-[#f0fdf4] border border-emerald-100 rounded-xl flex items-center justify-between sm:justify-start gap-2">
             <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-[0.2em]">Gastado:</span>
             <span className="text-sm md:text-base font-bold text-emerald-700">$ {totalSpent.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
           <div className="relative w-full sm:w-64">
             <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
             <input 
                type="text" 
                placeholder="Buscar proveedor..." 
                className="w-full bg-slate-50 border border-transparent rounded-2xl pl-11 pr-4 py-2.5 text-[11px] focus:bg-white focus:border-emerald-500/50 transition-all outline-none font-bold placeholder:text-gray-300"
             />
           </div>
           <button 
             onClick={() => setView('new')}
             className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest shadow-md shadow-emerald-100 transition-all cursor-pointer"
           >
              <Plus className="w-4 h-4" /> Nueva Compra
           </button>
        </div>
      </div>

      {/* History Area */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col p-4 md:p-8 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center rounded-2xl">
             <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        )}

        <div className="flex items-center gap-4 mb-4 md:mb-6">
          <div className="p-1 bg-slate-50 rounded-xl flex items-center gap-1">
             {[
               { id: 'all', label: 'Todas', active: true },
               { id: 'paid', label: 'Pagadas' },
               { id: 'pending', label: 'Con deuda' }
             ].map((f) => (
               <button key={f.id} className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${f.active ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                 {f.label}
               </button>
             ))}
          </div>
        </div>

        <div className="flex items-center justify-between mb-4 md:mb-6">
           <h3 className="text-sm font-bold text-gray-800 tracking-tight flex items-center gap-3">
              <History className="w-5 h-5 text-indigo-500" /> Historial de Compras
           </h3>
        </div>

        <div className="flex-1 overflow-auto">
          {purchases.length > 0 ? (
            <table className="w-full min-w-[600px] text-left">
              <thead>
                <tr className="border-b border-slate-50">
                   <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Fecha</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Proveedor</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Factura</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Estado</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {purchases.map((p) => (
                  <tr key={p.id} onClick={() => setSelectedPurchase(p)} className="hover:bg-slate-50/50 transition-colors cursor-pointer group">
                     <td className="py-4 text-[11px] font-bold text-slate-400 group-hover:text-indigo-600 transition-colors">{new Date(p.createdAt).toLocaleDateString()}</td>
                     <td className="py-4 text-[11px] font-bold text-slate-700 uppercase">{p.supplier.name}</td>
                     <td className="py-4 text-[11px] font-bold text-slate-400">{p.invoiceNumber || '---'}</td>
                     <td className="py-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest ${p.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                           {p.paymentStatus === 'PAID' ? 'Pagada' : 'A deber'}
                        </span>
                     </td>
                     <td className="py-4 text-right text-[12px] font-bold text-slate-800">$ {p.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-40">
               <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-6">
                  <Box className="w-8 h-8 text-slate-200" />
               </div>
               <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.3em] mb-2">No hay compras registradas en este mes.</p>
               <p className="text-[9px] text-slate-300 font-bold uppercase tracking-widest">Mostrando compras de mayo 2026</p>
            </div>
          )}
        </div>
      </div>

      {/* Purchases Detail Modal */}
      <AnimatePresence>
        {selectedPurchase && (
          <motion.div 
            key="purchase-details-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedPurchase(null)}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.98, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.98, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-500 flex items-center justify-center">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Detalles de Compra</h3>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">ID: #{selectedPurchase.id?.substring(0, 8).toUpperCase()}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedPurchase(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-500 transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {/* Meta details cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Fecha</span>
                    <span className="text-xs font-bold text-slate-800">{new Date(selectedPurchase.createdAt).toLocaleString('es-AR')}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Proveedor</span>
                    <span className="text-xs font-extrabold text-slate-800 uppercase truncate block">{selectedPurchase.supplier?.name}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Factura</span>
                    <span className="text-xs font-bold text-slate-800">{selectedPurchase.invoiceNumber || '---'}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Operador</span>
                    <span className="text-xs font-bold text-slate-800">{selectedPurchase.user?.fullName || '---'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Estado de Pago</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest inline-block ${selectedPurchase.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' : 'bg-rose-100 text-rose-600 border border-rose-200'}`}>
                        {selectedPurchase.paymentStatus === 'PAID' ? 'Pagada' : 'A Deber'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Forma de Pago</span>
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{selectedPurchase.paymentMethod || 'No especificada'}</span>
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <Box className="w-4 h-4 text-indigo-500" /> Artículos Detallados
                  </h4>
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-wider">Producto</th>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-wider text-center">Cantidad</th>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-wider text-right">Costo Unit.</th>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-wider text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedPurchase.items?.map((item: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 text-xs font-bold text-slate-700">{item.productName || 'Producto'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-800 text-center">{item.quantity}</td>
                            <td className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">$ {item.cost.toLocaleString()}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-800 text-right">$ {(item.cost * item.quantity).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Notes */}
                {selectedPurchase.notes && (
                  <div className="bg-amber-50/50 border border-amber-200/60 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wider block mb-1">Notas</span>
                    <p className="text-xs font-medium text-slate-600 italic">"{selectedPurchase.notes}"</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
                <span className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">Total de la Compra</span>
                <span className="text-2xl font-extrabold text-rose-600 tracking-tighter">$ {selectedPurchase.total.toLocaleString()}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
