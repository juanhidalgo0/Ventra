import { useState, useEffect } from 'react';
import { ShoppingCart, Search, Plus, Box, ChevronDown, History, Scan, RefreshCw, X, Receipt, Edit, Sparkles, Barcode } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import NewPurchaseScreen from './NewPurchaseScreen';
import SuggestedReplenishmentModal from './SuggestedReplenishmentModal';
import BarcodeLabelModal from './BarcodeLabelModal';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

export default function PurchasesScreen() {
  const [view, setView] = useState<'list' | 'new'>(() => {
    return (localStorage.getItem('purchases_active_view') as 'list' | 'new') || 'list';
  });
  const [purchases, setPurchases] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<any>(null);
  const [editingPurchase, setEditingPurchase] = useState<any | null>(null);
  const [showSuggestedReplenishment, setShowSuggestedReplenishment] = useState(false);
  const [labelsPurchase, setLabelsPurchase] = useState<any | null>(null);

  const handleSetView = (newView: 'list' | 'new') => {
    setView(newView);
    localStorage.setItem('purchases_active_view', newView);
  };

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

  const handleRestorePurchase = async (id: string) => {
    if (!window.confirm('¿Estás seguro de restaurar esta compra? Esto activará y agregará todos los productos incluidos en la boleta con su stock y precios de costo correspondientes.')) return;
    setIsLoading(true);
    try {
      await api.post(`/purchases/${id}/restore`);
      toast.success('✅ Productos de la compra restaurados con éxito');
      setSelectedPurchase(null);
      loadPurchases();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al restaurar productos de la compra');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeletePurchase = async (id: string) => {
    if (!window.confirm('¿Estás seguro de eliminar esta compra? El stock asociado será deducido.')) return;
    setIsLoading(true);
    try {
      await api.delete(`/purchases/${id}`);
      toast.success('✅ Compra eliminada correctamente');
      setSelectedPurchase(null);
      loadPurchases();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al eliminar la compra');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAllPurchases = async () => {
    if (!window.confirm('⚠️ ¿Estás seguro de eliminar TODAS las compras registradas? Esto deducirá el stock de todos los artículos comprados de forma definitiva.')) return;
    setIsLoading(true);
    try {
      await api.delete('/purchases');
      toast.success('✅ Historial de compras vaciado correctamente');
      loadPurchases();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al vaciar historial de compras');
    } finally {
      setIsLoading(false);
    }
  };

  if (view === 'new') {
    return <NewPurchaseScreen onBack={() => { handleSetView('list'); setEditingPurchase(null); }} initialPurchase={editingPurchase} />;
  }

  const totalSpent = purchases.reduce((sum, p) => sum + p.total, 0);

  return (
    <div className="h-full flex flex-col gap-4 bg-slate-50/30 p-2 overflow-y-auto custom-scrollbar">
      {/* Title & Subtitle */}
      <div className="flex items-center justify-between px-2">
         <div>
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
               <ShoppingCart className="w-5 h-5 text-rose-500" /> Compras
            </h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Registro de compras a proveedores</p>
         </div>
         <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input type="text" placeholder="Buscar..." className="bg-white border border-gray-100 rounded-xl pl-9 pr-4 py-2 text-[10px] font-bold outline-none focus:border-rose-200 transition-all w-32" />
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
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-300 w-full sm:w-auto justify-between sm:justify-start">
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
           <div className="relative w-full sm:w-64 flex items-center">
             <Search className="absolute left-4 w-4 h-4 text-gray-400 pointer-events-none" />
             <input 
                type="text" 
                placeholder="Buscar proveedor..." 
                className="w-full bg-slate-50 border border-transparent rounded-2xl pl-11 pr-4 py-2.5 text-[11px] focus:bg-white focus:border-emerald-500/50 transition-all outline-none font-bold placeholder:text-gray-300"
             />
           </div>
             <button 
               onClick={() => setShowSuggestedReplenishment(true)}
               className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest shadow-md shadow-rose-100 transition-all cursor-pointer whitespace-nowrap"
               title="Calcular faltantes de stock mínimo y armar pedidos a proveedores"
             >
                <Sparkles className="w-3.5 h-3.5" /> Pedido Sugerido
             </button>
            <button 
              onClick={() => handleSetView('new')}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest shadow-md shadow-emerald-100 transition-all cursor-pointer"
            >
               <Plus className="w-4 h-4" /> Nueva Compra
            </button>
            {purchases.length > 0 && (
              <button 
                onClick={handleDeleteAllPurchases}
                className="bg-rose-50 hover:bg-rose-100 text-rose-600 px-5 py-2.5 rounded-xl border border-rose-200 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer whitespace-nowrap animate-in fade-in zoom-in duration-200"
              >
                 <X className="w-3.5 h-3.5" /> Eliminar Todas
              </button>
            )}
        </div>
      </div>

      {/* History Area */}
      <div className="flex-1 card flex flex-col p-4 md:p-8 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center rounded-2xl">
             <RefreshCw className="w-8 h-8 text-rose-500 animate-spin" />
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
              <History className="w-5 h-5 text-rose-500" /> Historial de Compras
           </h3>
        </div>

        <div className="flex-1 overflow-auto">
          {purchases.length > 0 ? (
            <table className="w-full min-w-[600px] text-left">
              <thead>
                <tr className="border-b border-slate-50">
                   <th className="pb-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Fecha</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Proveedor</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest">Factura</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest text-center">Estado</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest text-right">Total</th>
                   <th className="pb-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {purchases.map((p) => (
                  <tr key={p.id} onClick={() => setSelectedPurchase(p)} className="hover:bg-slate-50/50 transition-colors cursor-pointer group">
                     <td className="py-4 text-[11px] font-bold text-slate-600 group-hover:text-rose-600 transition-colors">{new Date(p.createdAt).toLocaleDateString()}</td>
                     <td className="py-4 text-[11px] font-bold text-slate-700 uppercase">{p.supplier.name}</td>
                     <td className="py-4 text-[11px] font-bold text-slate-600">{p.invoiceNumber || '---'}</td>
                     <td className="py-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest ${p.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                           {p.paymentStatus === 'PAID' ? 'Pagada' : 'A deber'}
                        </span>
                        {p.status === 'PENDING' && (
                          <span className="ml-2 px-3 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-widest bg-amber-100 text-amber-800 border border-amber-200">
                             Borrador IA
                          </span>
                        )}
                     </td>
                     <td className="py-4 text-right text-[12px] font-bold text-slate-800">$ {p.total.toLocaleString()}</td>
                     <td className="py-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {p.status === 'PENDING' ? (
                            <button 
                              onClick={() => {
                                setEditingPurchase(p);
                                handleSetView('new');
                              }}
                              className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[9px] font-extrabold uppercase tracking-wider rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1"
                              title="Editar y Confirmar Boleta"
                            >
                               <Edit className="w-3 h-3" /> Confirmar
                            </button>
                          ) : null}
                          {p.status !== 'PENDING' && p.items?.length > 0 && (
                            <button 
                              onClick={() => setLabelsPurchase(p)}
                              className="p-1.5 hover:bg-slate-100 text-slate-700 rounded-lg border border-transparent hover:border-slate-300 transition-all cursor-pointer"
                              title="Imprimir etiquetas con código de barras de esta compra"
                            >
                               <Barcode className="w-4 h-4" />
                            </button>
                          )}
                          <button 
                            onClick={() => handleDeletePurchase(p.id)}
                            className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg border border-transparent hover:border-rose-200 transition-all cursor-pointer"
                            title="Eliminar Compra"
                          >
                             <X className="w-4 h-4" />
                          </button>
                        </div>
                     </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-20 opacity-40">
               <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-6">
                  <Box className="w-8 h-8 text-slate-200" />
               </div>
               <p className="text-[11px] font-bold text-slate-600 uppercase tracking-[0.3em] mb-2">No hay compras registradas en este mes.</p>
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
              className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl border border-slate-400 overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-300 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-500 flex items-center justify-center">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Detalles de Compra</h3>
                    <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mt-0.5">ID: #{selectedPurchase.id?.substring(0, 8).toUpperCase()}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedPurchase(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 hover:text-rose-500 transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {/* Meta details cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-slate-50 border border-slate-300 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Fecha</span>
                    <span className="text-xs font-bold text-slate-800">{new Date(selectedPurchase.createdAt).toLocaleString('es-AR')}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-300 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Proveedor</span>
                    <span className="text-xs font-extrabold text-slate-800 uppercase truncate block">{selectedPurchase.supplier?.name}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-300 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Factura</span>
                    <span className="text-xs font-bold text-slate-800">{selectedPurchase.invoiceNumber || '---'}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-300 p-4 rounded-xl">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Operador</span>
                    <span className="text-xs font-bold text-slate-800">{selectedPurchase.user?.fullName || '---'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-50 border border-slate-300 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Estado de Pago</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest inline-block ${selectedPurchase.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-600 border border-emerald-200' : 'bg-rose-100 text-rose-600 border border-rose-200'}`}>
                        {selectedPurchase.paymentStatus === 'PAID' ? 'Pagada' : 'A Deber'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-300 p-4 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1">Forma de Pago</span>
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{selectedPurchase.paymentMethod || 'No especificada'}</span>
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <Box className="w-4 h-4 text-rose-500" /> Artículos Detallados
                  </h4>
                  <div className="bg-white rounded-xl border border-slate-400 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-300">
                        <tr>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider">Producto</th>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider text-center">Cantidad</th>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider text-right">Costo Unit.</th>
                          <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-wider text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedPurchase.items?.map((item: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 text-xs font-bold text-slate-700">{item.productName || 'Producto'}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-800 text-center">{item.quantity}</td>
                            <td className="px-4 py-3 text-xs font-semibold text-slate-700 text-right">$ {item.cost.toLocaleString()}</td>
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
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-300 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 shrink-0">
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleRestorePurchase(selectedPurchase.id)}
                    className="bg-rose-600 hover:bg-rose-750 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Restaurar Compra
                  </button>
                  <button 
                    onClick={() => handleDeletePurchase(selectedPurchase.id)}
                    className="bg-rose-50 hover:bg-rose-100 text-rose-600 px-4 py-2 rounded-xl border border-rose-200 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Eliminar Boleta
                  </button>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3">
                  <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">Total de la Compra</span>
                  <span className="text-2xl font-extrabold text-rose-600 tracking-tighter">$ {selectedPurchase.total.toLocaleString()}</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {showSuggestedReplenishment && (
        <SuggestedReplenishmentModal
          onClose={() => setShowSuggestedReplenishment(false)}
        />
      )}

      {labelsPurchase && (
        <BarcodeLabelModal
          title={`Etiquetas de la compra a ${labelsPurchase.supplier?.name || 'proveedor'}`}
          initialItems={labelsPurchase.items.map((it: any) => ({ productId: it.productId, quantity: it.quantity, buyFormat: it.buyFormat }))}
          onClose={() => setLabelsPurchase(null)}
        />
      )}
    </div>
  );
}
