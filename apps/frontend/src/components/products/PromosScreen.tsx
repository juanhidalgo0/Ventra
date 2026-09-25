import { useState, useEffect } from 'react';
import { QtyPromoSheet } from '../mobile/MobilePromosScreen';
import { 
  Plus, 
  Search, 
  RefreshCw, 
  Tag, 
  CheckCircle2, 
  TrendingUp, 
  DollarSign,
  Package,
  X,
  Edit2,
  Trash2,
  Calendar,
  ShoppingCart
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';
import PromotionModal from './PromotionModal';

export default function PromosScreen() {
  const [promos, setPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedPromo, setSelectedPromo] = useState<any>(null);
  const [selectedType, setSelectedType] = useState<string>('ALL');

  const [showQtyPromo, setShowQtyPromo] = useState(false);
  useEffect(() => {
    loadPromos();
  }, []);

  const loadPromos = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/promotions');
      setPromos(data);
    } catch (err) {
      toast.error('Error al cargar promociones');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar esta promoción?')) return;
    try {
      await api.delete(`/promotions/${id}`);
      loadPromos();
    } catch {
      toast.error('Error al eliminar');
    }
  };

  const filteredPromos = promos.filter(p => {
    const matchesSearch = p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.type.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = selectedType === 'ALL' || p.type === selectedType;
    return matchesSearch && matchesType;
  });

  const activePromos = promos.filter(p => p.isActive).length;

  return (
    <div className="h-full flex flex-col gap-4 bg-slate-50/30 p-2 overflow-y-auto custom-scrollbar">
      {/* Header Bar */}
      <div className="card p-4 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
         <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <button onClick={loadPromos} className="p-2 rounded-xl border border-gray-105 text-gray-400 hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shrink-0">
               <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 
               <span className="text-[10px] font-bold uppercase tracking-widest">Actualizar</span>
            </button>
            <div className="hidden sm:block h-6 w-[1px] bg-slate-200" />
            <div className="flex gap-1 bg-slate-50 p-1 rounded-xl border border-slate-300 overflow-x-auto whitespace-nowrap scrollbar-hide">
               {[
                 { key: 'ALL', label: 'Todos' },
                 { key: 'NX_M', label: 'N x M' },
                 { key: 'FIXED_COMBO', label: 'Combo Fijo' },
                 { key: 'DISCOUNT_PERCENT', label: 'Oferta %' }
               ].map((type) => (
                 <button
                   key={type.key}
                   onClick={() => setSelectedType(type.key)}
                   className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer ${selectedType === type.key ? 'bg-emerald-600 text-white shadow-md shadow-emerald-150' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-600'}`}
                 >
                   {type.label}
                 </button>
               ))}
            </div>
         </div>
         <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative group w-full sm:w-auto">
               <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-emerald-500 transition-colors" />
               <input 
                 type="text" 
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}
                 placeholder="Buscar promoción..." 
                 className="bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-[10px] font-bold outline-none focus:bg-white focus:border-emerald-250 transition-all w-full sm:w-64" 
               />
            </div>
            {/* Lo más usado en gastronomía: media docena o docena de empanadas mezclando gustos */}
            <button
              onClick={() => setShowQtyPromo(true)}
              className="px-5 py-2.5 bg-white border border-emerald-300 text-emerald-700 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-50 transition-all active:scale-95 cursor-pointer w-full sm:w-auto"
            >
              <Package className="w-4 h-4" /> Precio por cantidad (docena)
            </button>
            <button 
              onClick={() => { setSelectedPromo(null); setShowModal(true); }}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 shadow-md shadow-emerald-100 transition-all active:scale-95 cursor-pointer w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" /> Nueva Promoción
            </button>
         </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: 'Total Promociones', val: promos.length, icon: Tag, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Promociones Activas', val: activePromos, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Veces Aplicadas', val: '0', icon: TrendingUp, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Ganancia Estimada', val: '$0.00', icon: DollarSign, color: 'bg-emerald-50 text-emerald-600' }
        ].map((card) => (
          <div key={card.label} className="card p-4 md:p-6 flex items-center gap-4">
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl ${card.color.split(' ')[0]} flex items-center justify-center ${card.color.split(' ')[1]} shadow-sm`}>
               <card.icon className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <div>
               <h4 className="text-lg md:text-2xl font-bold text-gray-800 tracking-tighter">{card.val}</h4>
               <p className="text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mt-0.5">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main List Area */}
      <div className="flex-1 card flex flex-col p-4 md:p-8 overflow-hidden min-h-[400px]">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <div>
            <h3 className="text-sm font-bold text-gray-800 tracking-tight flex items-center gap-3">
               Todas las Promociones
            </h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Promociones registradas</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {promos.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-20">
               <div className="w-20 h-20 rounded-2xl bg-[#fff7ed] flex items-center justify-center mb-6">
                  <Tag className="w-10 h-10 text-orange-200" />
               </div>
               <h4 className="text-[11px] font-bold text-slate-700 uppercase tracking-[0.2em] mb-2">No hay promociones creadas</h4>
               <p className="text-[10px] text-slate-600 font-bold max-w-[280px] uppercase tracking-widest mb-8">Comenzá creando tu primera promoción para aumentar tus ventas.</p>
               <button 
                onClick={() => setShowModal(true)}
                className="px-8 py-3.5 bg-[#10b981] text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-xl shadow-emerald-200 hover:bg-[#059669] transition-all active:scale-95"
               >
                 + Crear Primera Promoción
               </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence>
                {filteredPromos.map((promo) => (
                  <motion.div 
                    key={promo.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group bg-emerald-50/35 border border-emerald-100/80 p-5 rounded-2xl hover:bg-white hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/5 transition-all"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${promo.type === 'NX_M' ? 'bg-emerald-100 text-emerald-700' : promo.type === 'DISCOUNT_PERCENT' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-600 text-white shadow-sm'}`}>
                        {promo.type === 'NX_M' ? <ShoppingCart className="w-5 h-5" /> : promo.type === 'DISCOUNT_PERCENT' ? <Tag className="w-5 h-5" /> : <Package className="w-5 h-5" />}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setSelectedPromo(promo); setShowModal(true); }} className="p-2 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(promo.id)} className="p-2 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>

                    <div className="space-y-1 mb-4">
                      <h4 className="text-sm font-bold text-slate-800 leading-tight">
                        {promo.type === 'NX_M' ? `${promo.nValue} x ${promo.mValue}` : promo.type === 'DISCOUNT_PERCENT' ? `${promo.name || 'Oferta'}` : promo.name}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                          {promo.type === 'NX_M' ? 'Promoción de cantidad' : promo.type === 'DISCOUNT_PERCENT' ? 'Oferta de porcentaje' : 'Combo de productos'}
                        </span>
                        {promo.code && (
                          <span className="text-[9px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100/80 px-2 py-0.5 rounded-md tracking-wider">
                            COD: {promo.code.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="bg-white/70 border border-emerald-100/50 rounded-2xl p-3 mb-4">
                       <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest mb-2">Componentes</p>
                       <div className="space-y-1">
                          {(() => {
                            if (promo.type === 'FIXED_COMBO') {
                              const groupMap = new Map<string, any[]>();
                              promo.products.forEach((pp: any, idx: number) => {
                                const gId = pp.groupId || `g_${pp.productId}_${idx}`;
                                if (!groupMap.has(gId)) groupMap.set(gId, []);
                                groupMap.get(gId)!.push(pp);
                              });
                              const groups = Array.from(groupMap.values());
                              return (
                                <>
                                  {groups.slice(0, 3).map((gItems, gIdx) => (
                                    <div key={gIdx} className="text-[10px] font-bold text-slate-700 flex justify-between gap-1">
                                      <span className="truncate">
                                        {gItems.length === 1 
                                          ? gItems[0].product.name 
                                          : `${gItems[0].product.name} (+${gItems.length - 1} opciones)`}
                                      </span>
                                      <span className="text-slate-600 shrink-0">x{gItems[0].quantity}</span>
                                    </div>
                                  ))}
                                  {groups.length > 3 && <p className="text-[9px] text-emerald-600 font-bold">+{groups.length - 3} grupos más...</p>}
                                </>
                              );
                            }

                            return (
                              <>
                                {promo.products.slice(0, 3).map((pp: any) => (
                                   <div key={pp.id} className="text-[10px] font-bold text-slate-700 flex justify-between">
                                      <span className="truncate">{pp.product.name}</span>
                                      <span className="text-slate-600">x{pp.quantity}</span>
                                   </div>
                                ))}
                                {promo.products.length > 3 && <p className="text-[9px] text-emerald-600 font-bold">+{promo.products.length - 3} más...</p>}
                              </>
                            );
                          })()}
                       </div>
                    </div>

                    <div className="flex items-center justify-between">
                       <div className="flex items-center gap-1.5 text-emerald-600 font-bold text-lg">
                          {promo.type === 'FIXED_COMBO' ? `$${promo.fixedPrice}` : promo.type === 'DISCOUNT_PERCENT' ? `-${promo.discountPercentage}%` : <TrendingUp className="w-5 h-5" />}
                       </div>
                       <div className="flex items-center gap-1 text-[9px] font-bold text-slate-600 uppercase tracking-tight">
                          <Calendar className="w-3 h-3 text-slate-300" /> 
                          {promo.limitType === 'DATE' && promo.endDate ? (
                            <span>Hasta {new Date(promo.endDate).toLocaleDateString('es-AR')}</span>
                          ) : promo.limitType === 'STOCK' && promo.limitStock !== null ? (
                            <span>Agotar: {promo.soldStock}/{promo.limitStock}</span>
                          ) : (
                            <span className="text-slate-300">Siempre activo</span>
                          )}
                       </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <PromotionModal 
            promotion={selectedPromo}
            onClose={() => setShowModal(false)}
            onSuccess={() => { loadPromos(); setShowModal(false); }}
          />
        )}
      </AnimatePresence>
      <QtyPromoSheet open={showQtyPromo} onClose={() => setShowQtyPromo(false)} onCreated={() => { setShowQtyPromo(false); loadPromos(); }} />
    </div>
  );
}
