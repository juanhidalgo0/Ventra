import { useState, useEffect } from 'react';
import { 
  X, 
  Tag, 
  Package, 
  ShoppingCart, 
  Box, 
  Check, 
  ChevronRight, 
  ChevronLeft,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

interface PromotionModalProps {
  onClose: () => void;
  onSuccess: () => void;
  promotion?: any;
}

export default function PromotionModal({ onClose, onSuccess, promotion }: PromotionModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    name: promotion?.name || '',
    code: promotion?.code || '',
    type: promotion?.type || 'FIXED_COMBO', // NX_M | FIXED_COMBO | DISCOUNT_PERCENT
    nValue: promotion?.nValue || 3,
    mValue: promotion?.mValue || 2,
    fixedPrice: promotion?.fixedPrice || 0,
    discountPercentage: promotion?.discountPercentage || 0,
    limitType: promotion?.limitType || 'NONE', // NONE | STOCK | DATE
    limitStock: promotion?.limitStock || 100,
    endDate: promotion?.endDate ? new Date(promotion.endDate).toISOString().split('T')[0] : '',
    products: promotion?.products?.map((p: any) => ({
      productId: p.productId,
      name: p.product.name,
      quantity: p.quantity,
      salePrice: p.product.salePrice
    })) || []
  });

  useEffect(() => {
    if (searchQuery.length > 2) {
      const delay = setTimeout(async () => {
        try {
          const { data } = await api.get('/products', { params: { search: searchQuery, take: 5 } });
          setSearchResults(data);
        } catch {}
      }, 300);
      return () => clearTimeout(delay);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const addProduct = (product: any) => {
    if (formData.type === 'DISCOUNT_PERCENT' && formData.products.length >= 1) {
      toast.error('Las ofertas de porcentaje aplican a un solo producto');
      return;
    }
    if (formData.products.find((p: any) => p.productId === product.id)) {
      toast.error('Producto ya agregado');
      return;
    }
    setFormData({
      ...formData,
      products: [...formData.products, {
        productId: product.id,
        name: product.name,
        quantity: 1,
        salePrice: product.salePrice
      }]
    });
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeProduct = (productId: string) => {
    setFormData({
      ...formData,
      products: formData.products.filter((p: any) => p.productId !== productId)
    });
  };

  const updateProductQuantity = (productId: string, quantity: number) => {
    setFormData({
      ...formData,
      products: formData.products.map((p: any) => 
        p.productId === productId ? { ...p, quantity: Math.max(1, quantity) } : p
      )
    });
  };

  const handleSave = async () => {
    if (!formData.name && (formData.type === 'FIXED_COMBO' || formData.type === 'DISCOUNT_PERCENT')) {
       toast.error('El nombre de la promoción es obligatorio');
       return;
    }
    if (formData.products.length === 0) {
      toast.error('Selecciona al menos un producto');
      return;
    }

    setLoading(true);
    try {
      if (promotion?.id) {
        await api.patch(`/promotions/${promotion.id}`, formData);
        toast.success('Promoción actualizada');
      } else {
        await api.post('/promotions', formData);
        toast.success('Promoción creada');
      }
      onSuccess();
      onClose();
    } catch (err) {
      toast.error('Error al guardar promoción');
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalOriginal = () => {
    return formData.products.reduce((acc: number, p: any) => acc + (p.salePrice * p.quantity), 0);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
    >
      <div 
        onClick={onClose} 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
      />

      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.9, y: 20 }} 
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-400 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-8 py-6 flex items-center justify-between border-b border-orange-100/50">
          <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Nueva Promoción</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-12 py-4 flex items-center justify-center gap-4 border-b border-orange-50/50 bg-orange-50/20">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step === s ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : step > s ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {step > s ? <Check className="w-4 h-4" /> : s}
              </div>
              {s < 3 && <div className={`w-12 h-[2px] mx-2 ${step > s ? 'bg-emerald-500' : 'bg-slate-100'}`} />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="text-center space-y-2">
                  <h3 className="text-base font-bold text-slate-800">Selecciona el tipo de promoción</h3>
                  <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Elige la modalidad que mejor se adapte a tu estrategia de ventas</p>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <button 
                    onClick={() => setFormData({ ...formData, type: 'NX_M' })}
                    className={`group relative p-4 rounded-xl border-2 transition-all text-left flex flex-col gap-3 ${formData.type === 'NX_M' ? 'border-blue-500 bg-blue-50/30' : 'border-slate-300 bg-white hover:border-blue-200'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-white shadow-lg shadow-blue-200">
                      <ShoppingCart className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">N x M</h4>
                      <p className="text-[9px] font-bold text-slate-600 mt-0.5 leading-tight">Lleva N y paga M</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-1.5 text-[8px] font-bold text-slate-600">
                      Ej: Lleva 3, paga 2
                    </div>
                    {formData.type === 'NX_M' && <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white"><CheckCircle2 className="w-3 h-3" /></div>}
                  </button>

                  <button 
                    onClick={() => setFormData({ ...formData, type: 'FIXED_COMBO' })}
                    className={`group relative p-4 rounded-xl border-2 transition-all text-left flex flex-col gap-3 ${formData.type === 'FIXED_COMBO' ? 'border-purple-500 bg-purple-50/30' : 'border-slate-300 bg-white hover:border-purple-200'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center text-white shadow-lg shadow-purple-200">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Combo Fijo</h4>
                      <p className="text-[9px] font-bold text-slate-600 mt-0.5 leading-tight">Agrupados a precio especial</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-1.5 text-[8px] font-bold text-slate-600">
                      Ej: Gaseosa + Snack por $X
                    </div>
                    {formData.type === 'FIXED_COMBO' && <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center text-white"><CheckCircle2 className="w-3 h-3" /></div>}
                  </button>

                  <button 
                    onClick={() => setFormData({ ...formData, type: 'DISCOUNT_PERCENT', name: formData.name || 'Oferta %' })}
                    className={`group relative p-4 rounded-xl border-2 transition-all text-left flex flex-col gap-3 ${formData.type === 'DISCOUNT_PERCENT' ? 'border-amber-500 bg-amber-50/30' : 'border-slate-300 bg-white hover:border-amber-200'}`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-white shadow-lg shadow-amber-200">
                      <Tag className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Oferta %</h4>
                      <p className="text-[9px] font-bold text-slate-600 mt-0.5 leading-tight">Descuento porcentual</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-1.5 text-[8px] font-bold text-slate-600">
                      Ej: Producto con 20% off
                    </div>
                    {formData.type === 'DISCOUNT_PERCENT' && <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-white"><CheckCircle2 className="w-3 h-3" /></div>}
                  </button>
                </div>
                
                <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                   <p className="text-[11px] font-bold text-blue-600 flex items-center gap-2">
                     <Check className="w-4 h-4" /> 
                     Seleccionaste: {formData.type === 'NX_M' ? 'N x M' : formData.type === 'DISCOUNT_PERCENT' ? 'Oferta %' : 'Combo Fijo'}
                   </p>
                   <p className="text-[10px] text-blue-400 font-medium mt-1">En el siguiente paso podrás configurar los detalles de tu promoción</p>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="text-center space-y-2">
                  <h3 className="text-base font-bold text-slate-800">
                    {formData.type === 'NX_M' ? 'Configura tu N x M' : formData.type === 'DISCOUNT_PERCENT' ? 'Configura tu Oferta %' : 'Define tu Combo Fijo'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Selecciona los productos y define las condiciones de la oferta</p>
                </div>

                <div className="space-y-4">
                  {(formData.type === 'FIXED_COMBO' || formData.type === 'DISCOUNT_PERCENT') && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">
                          {formData.type === 'DISCOUNT_PERCENT' ? 'Nombre de la Oferta' : 'Nombre del Combo'}
                        </span>
                        <input 
                          type="text" 
                          value={formData.name}
                          onChange={e => setFormData({ ...formData, name: e.target.value })}
                          placeholder={formData.type === 'DISCOUNT_PERCENT' ? "Ej: Oferta Coca-Cola 20%..." : "Ej: Combo Merienda, Super Oferta..."}
                          className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">
                          Código de Activación / Barcode (Opcional)
                        </span>
                        <input 
                          type="text" 
                          value={formData.code}
                          onChange={e => setFormData({ ...formData, code: e.target.value })}
                          placeholder="Ej: combo1, 77912345..."
                          className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none"
                        />
                      </div>
                    </div>
                  )}

                  {formData.type === 'NX_M' && (
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">
                        Código de Activación / Barcode (Opcional)
                      </span>
                      <input 
                        type="text" 
                        value={formData.code}
                        onChange={e => setFormData({ ...formData, code: e.target.value })}
                        placeholder="Ej: promo3x2, 77998765..."
                        className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none"
                      />
                    </div>
                  )}

                  <div className="relative">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">Buscar productos para agregar</span>
                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                      <input 
                        type="text" 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Buscar productos..."
                        className="w-full bg-white border border-slate-400 rounded-xl pl-10 pr-4 py-3 text-xs font-bold text-slate-800 focus:border-orange-500 transition-all outline-none"
                      />
                    </div>
                    
                    {searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-300 rounded-2xl shadow-xl z-20 overflow-hidden divide-y divide-slate-50">
                        {searchResults.map(p => (
                          <button key={p.id} onClick={() => addProduct(p)} className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-all text-left">
                            <div>
                              <p className="text-xs font-bold text-slate-800">{p.name}</p>
                              <p className="text-[10px] text-slate-600 mt-0.5">{p.barcode}</p>
                            </div>
                            <span className="text-[11px] font-bold text-indigo-600">${p.salePrice}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">Productos del combo</span>
                    <div className="min-h-[120px] border-2 border-dashed border-slate-300 rounded-2xl p-4 bg-slate-50/30 flex flex-col gap-2">
                      {formData.products.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center opacity-30 py-4">
                          <Box className="w-8 h-8 mb-2" />
                          <p className="text-[10px] font-bold uppercase tracking-widest">Selecciona productos de la lista de arriba</p>
                        </div>
                      ) : (
                        formData.products.map((p: any) => (
                          <div key={p.productId} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-300 shadow-sm">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 truncate">{p.name}</p>
                              <p className="text-[10px] text-slate-600 font-medium">${p.salePrice} c/u</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1">
                                <button onClick={() => updateProductQuantity(p.productId, p.quantity - 1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md text-slate-600 hover:text-slate-800"><Minus className="w-3 h-3" /></button>
                                <span className="text-xs font-bold text-slate-800 w-4 text-center">{p.quantity}</span>
                                <button onClick={() => updateProductQuantity(p.productId, p.quantity + 1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md text-slate-600 hover:text-slate-800"><Plus className="w-3 h-3" /></button>
                              </div>
                              <button onClick={() => removeProduct(p.productId)} className="text-slate-300 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {formData.type === 'NX_M' ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">Lleva (N)</span>
                        <input type="number" value={formData.nValue || ''} onChange={e => setFormData({ ...formData, nValue: parseInt(e.target.value) || 0 })} className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none" />
                      </div>
                      <div>
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">Paga (M)</span>
                        <input type="number" value={formData.mValue || ''} onChange={e => setFormData({ ...formData, mValue: parseInt(e.target.value) || 0 })} className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none" />
                      </div>
                    </div>
                  ) : formData.type === 'DISCOUNT_PERCENT' ? (
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">Porcentaje de Descuento (%)</span>
                      <div className="relative">
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 font-bold">%</span>
                        <input 
                          type="number" 
                          value={formData.discountPercentage || ''} 
                          onChange={e => setFormData({ ...formData, discountPercentage: parseFloat(e.target.value) || 0 })} 
                          className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none" 
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">💰 Precio final del combo</span>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 font-bold">$</span>
                        <input 
                          type="number" 
                          value={formData.fixedPrice || ''} 
                          onChange={e => setFormData({ ...formData, fixedPrice: parseFloat(e.target.value) || 0 })} 
                          className="w-full bg-slate-50 border border-slate-400 rounded-xl pl-8 pr-4 py-4 text-lg font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none" 
                        />
                      </div>
                      <p className="text-[10px] text-slate-600 font-bold mt-2 ml-1 uppercase tracking-widest">Valor original: ${calculateTotalOriginal().toFixed(2)}</p>
                    </div>
                  )}

                  {/* Condición de Finalización */}
                  <div className="pt-4 border-t border-slate-400/50">
                    <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest mb-3 block ml-1">Condición de Finalización</span>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { key: 'NONE', label: 'Sin Límite', desc: 'Siempre activa' },
                        { key: 'STOCK', label: 'Hasta Agotar Stock', desc: 'Límite de unidades' },
                        { key: 'DATE', label: 'Hasta Fecha', desc: 'Expiración por fecha' }
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setFormData({ ...formData, limitType: opt.key })}
                          className={`p-3 rounded-xl border-2 text-left flex flex-col justify-between transition-all cursor-pointer ${formData.limitType === opt.key ? 'border-orange-500 bg-orange-50/20 text-orange-700' : 'border-slate-300 bg-white hover:border-slate-400 text-slate-700'}`}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wider">{opt.label}</span>
                          <span className="text-[8px] opacity-70 mt-1">{opt.desc}</span>
                        </button>
                      ))}
                    </div>

                    <div className="mt-4">
                      {formData.limitType === 'STOCK' && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                          <label className="block text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 ml-1">Límite de Stock Promocional (Unidades)</label>
                          <input 
                            type="number" 
                            value={formData.limitStock || ''} 
                            onChange={e => setFormData({ ...formData, limitStock: parseFloat(e.target.value) || 0 })}
                            placeholder="Ej: 100" 
                            className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none" 
                          />
                          <p className="text-[9px] text-slate-600 mt-1 ml-1 font-bold">La promoción se desactivará automáticamente después de vender esta cantidad de productos.</p>
                        </div>
                      )}

                      {formData.limitType === 'DATE' && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                          <label className="block text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 ml-1">Fecha de Finalización</label>
                          <input 
                            type="date" 
                            value={formData.endDate || ''} 
                            onChange={e => setFormData({ ...formData, endDate: e.target.value })} 
                            className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none" 
                          />
                          <p className="text-[9px] text-slate-600 mt-1 ml-1 font-bold">La promoción estará activa hasta las 23:59:59 del día seleccionado.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8 py-4"
              >
                 <div className="flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-20 h-20 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-500 animate-in zoom-in duration-500">
                       <CheckCircle2 className="w-10 h-10" />
                    </div>
                    <div>
                       <h3 className="text-xl font-bold text-slate-800 tracking-tight">¡Todo listo!</h3>
                       <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mt-1">Revisa el resumen antes de activar</p>
                    </div>
                 </div>

                 <div className="bg-slate-50 border border-slate-300 rounded-2xl p-6 space-y-4">
                    <div className="flex justify-between items-start">
                       <div>
                          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Tipo de Promoción</p>
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${formData.type === 'NX_M' ? 'bg-blue-100 text-blue-600' : formData.type === 'DISCOUNT_PERCENT' ? 'bg-amber-100 text-amber-600' : 'bg-purple-100 text-purple-600'}`}>
                             {formData.type === 'NX_M' ? 'Lleva N, Paga M' : formData.type === 'DISCOUNT_PERCENT' ? 'Oferta %' : 'Combo Fijo'}
                          </span>
                       </div>
                       <div className="text-right">
                          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Beneficio</p>
                          <p className="text-lg font-bold text-slate-800">
                             {formData.type === 'NX_M' ? `${formData.nValue} x ${formData.mValue}` : formData.type === 'DISCOUNT_PERCENT' ? `-${formData.discountPercentage}%` : `$${formData.fixedPrice}`}
                          </p>
                       </div>
                    </div>

                    <div className="pt-4 border-t border-slate-400/50">
                       <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Condición de Finalización</p>
                       <span className="text-xs font-bold text-slate-700">
                         {formData.limitType === 'STOCK' ? `Hasta agotar stock (${formData.limitStock} unidades)` : formData.limitType === 'DATE' ? `Hasta el ${formData.endDate}` : 'Siempre activa / Sin límite'}
                       </span>
                    </div>

                    {formData.code && (
                      <div className="pt-4 border-t border-slate-400/50">
                         <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Código / Barcode del Combo</p>
                         <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-lg inline-block">
                           {formData.code}
                         </span>
                      </div>
                    )}

                    <div className="pt-4 border-t border-slate-400/50">
                       <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3">Productos Incluidos</p>
                       <div className="space-y-2">
                          {formData.products.map((p: any) => (
                             <div key={p.productId} className="flex justify-between text-xs font-bold text-slate-600">
                                <span>{p.name} {p.quantity > 1 && `(x${p.quantity})`}</span>
                                <span>${(p.salePrice * p.quantity).toFixed(2)}</span>
                             </div>
                          ))}
                       </div>
                    </div>
                 </div>

                 <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl flex gap-3 items-start">
                    <Tag className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-700 font-bold leading-relaxed uppercase tracking-tight">
                       Esta promoción se aplicará automáticamente en el Punto de Venta al detectar los productos vinculados.
                    </p>
                 </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-8 py-6 bg-slate-50 border-t border-slate-300 flex items-center justify-between">
          <button 
            onClick={() => setStep(prev => Math.max(1, prev - 1))}
            disabled={step === 1}
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-400 text-[11px] font-bold uppercase tracking-widest text-slate-700 hover:bg-white disabled:opacity-30 transition-all"
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            {step} / 3
          </div>

          {step < 3 ? (
            <button 
              onClick={() => setStep(prev => prev + 1)}
              className="flex items-center gap-2 px-6 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 transition-all active:scale-[0.97]"
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button 
              onClick={handleSave}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-all active:scale-[0.97] disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Finalizar y Activar
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
