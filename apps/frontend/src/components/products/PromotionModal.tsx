import { useState, useEffect, useRef } from 'react';
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
  Minus,
  Layers,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

interface PromotionModalProps {
  onClose: () => void;
  onSuccess: () => void;
  promotion?: any;
}

interface ComboGroup {
  id: string;
  name: string;
  quantity: number;
  products: {
    productId: string;
    name: string;
    salePrice: number;
    barcode?: string;
  }[];
}

export default function PromotionModal({ onClose, onSuccess, promotion }: PromotionModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [activeTargetGroupId, setActiveTargetGroupId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      name: p.product?.name || 'Producto',
      quantity: p.quantity,
      salePrice: p.product?.salePrice || 0,
      groupId: p.groupId || null
    })) || []
  });

  // Groups for FIXED_COMBO
  const [comboGroups, setComboGroups] = useState<ComboGroup[]>(() => {
    if (!promotion?.products || promotion.products.length === 0) {
      return [];
    }
    const map = new Map<string, ComboGroup>();
    const order: string[] = [];

    promotion.products.forEach((pp: any, idx: number) => {
      const gId = pp.groupId || `group_${idx + 1}`;
      if (!map.has(gId)) {
        map.set(gId, {
          id: gId,
          name: `Opción ${order.length + 1}`,
          quantity: pp.quantity || 1,
          products: []
        });
        order.push(gId);
      }
      map.get(gId)!.products.push({
        productId: pp.productId,
        name: pp.product?.name || 'Producto',
        salePrice: pp.product?.salePrice || 0,
        barcode: pp.product?.barcode
      });
    });

    return order.map(id => map.get(id)!);
  });

  useEffect(() => {
    if (searchQuery.trim().length >= 2) {
      const delay = setTimeout(async () => {
        try {
          const { data } = await api.get('/products', { params: { search: searchQuery, take: 50 } });
          setSearchResults(data);
        } catch {}
      }, 250);
      return () => clearTimeout(delay);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const handleAddNewGroup = () => {
    // If there is already an empty group, focus search on it
    const emptyGroup = comboGroups.find(g => g.products.length === 0);
    if (emptyGroup) {
      setActiveTargetGroupId(emptyGroup.id);
      toast.success(`Escribe en el buscador para añadir producto a ${emptyGroup.name}`);
      searchInputRef.current?.focus();
      return;
    }

    const newGroupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const newGroupName = `Opción ${comboGroups.length + 1}`;
    setComboGroups(prev => [
      ...prev,
      {
        id: newGroupId,
        name: newGroupName,
        quantity: 1,
        products: []
      }
    ]);
    setActiveTargetGroupId(newGroupId);
    toast.success(`Se creó ${newGroupName}. Busca el producto arriba para agregarlo.`);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  };

  const addProductToFixedCombo = (product: any, targetGroupId?: string | null) => {
    // 1. If targetGroupId is specified and exists:
    if (targetGroupId && comboGroups.some(g => g.id === targetGroupId)) {
      setComboGroups(prev => prev.map(g => {
        if (g.id === targetGroupId) {
          if (g.products.some(p => p.productId === product.id)) {
            toast.error('Este producto ya está en este grupo');
            return g;
          }
          return {
            ...g,
            products: [...g.products, {
              productId: product.id,
              name: product.name,
              salePrice: product.salePrice,
              barcode: product.barcode
            }]
          };
        }
        return g;
      }));
      const groupName = comboGroups.find(g => g.id === targetGroupId)?.name || 'grupo';
      toast.success(`Agregado a ${groupName}`);
    } else {
      // 2. Check if there is an empty group waiting for a product:
      const emptyGroupIndex = comboGroups.findIndex(g => g.products.length === 0);
      if (emptyGroupIndex !== -1) {
        setComboGroups(prev => prev.map((g, idx) => {
          if (idx === emptyGroupIndex) {
            return {
              ...g,
              products: [{
                productId: product.id,
                name: product.name,
                salePrice: product.salePrice,
                barcode: product.barcode
              }]
            };
          }
          return g;
        }));
        toast.success(`Agregado a ${comboGroups[emptyGroupIndex].name}`);
      } else {
        // 3. Create a new group
        const newGroupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        setComboGroups(prev => [
          ...prev,
          {
            id: newGroupId,
            name: `Opción ${prev.length + 1}`,
            quantity: 1,
            products: [{
              productId: product.id,
              name: product.name,
              salePrice: product.salePrice,
              barcode: product.barcode
            }]
          }
        ]);
        toast.success('Nuevo producto / grupo agregado al combo');
      }
    }

    setSearchQuery('');
    setSearchResults([]);
    setActiveTargetGroupId(null);
  };

  const addProductForOtherTypes = (product: any) => {
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

  const handleSelectProduct = (product: any) => {
    if (formData.type === 'FIXED_COMBO') {
      addProductToFixedCombo(product, activeTargetGroupId);
    } else {
      addProductForOtherTypes(product);
    }
  };

  const removeProductFromGroup = (groupId: string, productId: string) => {
    setComboGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        return {
          ...g,
          products: g.products.filter(p => p.productId !== productId)
        };
      }
      return g;
    }).filter(g => g.products.length > 0)); // remove empty groups
  };

  const removeGroup = (groupId: string) => {
    setComboGroups(prev => {
      const remaining = prev.filter(g => g.id !== groupId);
      // Renumber options
      return remaining.map((g, idx) => ({
        ...g,
        name: `Opción ${idx + 1}`
      }));
    });
    if (activeTargetGroupId === groupId) {
      setActiveTargetGroupId(null);
    }
  };

  const updateGroupQuantity = (groupId: string, quantity: number) => {
    setComboGroups(prev => prev.map(g => 
      g.id === groupId ? { ...g, quantity: Math.max(1, quantity) } : g
    ));
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

    let productsPayload: any[] = [];

    if (formData.type === 'FIXED_COMBO') {
      const filledGroups = comboGroups.filter(g => g.products.length > 0);
      if (filledGroups.length === 0) {
        toast.error('Agrega al menos un producto o grupo de opciones al combo');
        return;
      }
      productsPayload = filledGroups.flatMap(g => 
        g.products.map(p => ({
          productId: p.productId,
          quantity: g.quantity,
          groupId: g.id
        }))
      );
    } else {
      if (formData.products.length === 0) {
        toast.error('Selecciona al menos un producto');
        return;
      }
      productsPayload = formData.products.map((p: any) => ({
        productId: p.productId,
        quantity: p.quantity,
        groupId: null
      }));
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        products: productsPayload
      };

      if (promotion?.id) {
        await api.patch(`/promotions/${promotion.id}`, payload);
        toast.success('Promoción actualizada');
      } else {
        await api.post('/promotions', payload);
        toast.success('Promoción creada');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error('Error al guardar promoción: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalOriginal = () => {
    if (formData.type === 'FIXED_COMBO') {
      return comboGroups.reduce((acc, g) => {
        if (g.products.length === 0) return acc;
        const avgPrice = g.products.reduce((s, p) => s + p.salePrice, 0) / g.products.length;
        return acc + (avgPrice * g.quantity);
      }, 0);
    }
    return formData.products.reduce((acc: number, p: any) => acc + (p.salePrice * p.quantity), 0);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // No onClick on this wrapper (backdrop) — prevents accidental dismissal
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-8 py-5 flex items-center justify-between border-b border-orange-100/60 bg-gradient-to-r from-orange-50/40 to-white">
          <div>
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              {promotion ? 'Editar Promoción' : 'Nueva Promoción'}
            </h2>
            <p className="text-xs text-slate-500 font-semibold">Configura combos flexibles, ofertas N×M y descuentos</p>
          </div>
          <button
            type="button"
            onClick={() => setShowExitConfirm(true)}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            title="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-12 py-3.5 flex items-center justify-center gap-4 border-b border-orange-50/50 bg-orange-50/20">
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
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8">
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
                      Ej: Smirnoff + Speed $8500
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
                     Seleccionaste: {formData.type === 'NX_M' ? 'N x M' : formData.type === 'DISCOUNT_PERCENT' ? 'Oferta %' : 'Combo Fijo (Con soporte para opciones alternativas)'}
                   </p>
                   <p className="text-[10px] text-blue-400 font-medium mt-1">En el siguiente paso podrás agregar productos y definir opciones alternativas para cada parte del combo.</p>
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
                  <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    {formData.type === 'FIXED_COMBO' 
                      ? 'Define los componentes del combo y añade sabores u opciones alternativas si lo deseas'
                      : 'Selecciona los productos y define las condiciones de la oferta'}
                  </p>
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
                          placeholder={formData.type === 'DISCOUNT_PERCENT' ? "Ej: Oferta Coca-Cola 20%..." : "Ej: Combo Smirnoff + Speed..."}
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

                  {/* Product Search Box */}
                  <div className="relative">
                    <div className="flex items-center justify-between mb-1.5 ml-1">
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                        {activeTargetGroupId 
                          ? `🔍 Buscando producto alternativo para ${comboGroups.find(g => g.id === activeTargetGroupId)?.name || 'el grupo seleccionado'}...`
                          : 'Buscar productos para agregar'}
                      </span>
                      {activeTargetGroupId && (
                        <button 
                          type="button" 
                          onClick={() => setActiveTargetGroupId(null)}
                          className="text-[10px] font-bold text-rose-500 hover:text-rose-700 underline"
                        >
                          Cancelar asignación a grupo
                        </button>
                      )}
                    </div>
                    
                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        ref={searchInputRef}
                        type="text" 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={activeTargetGroupId ? "Escribe para buscar el sabor u opción alternativa..." : "Buscar por nombre, código de barras o SKU..."}
                        className={`w-full bg-white border rounded-xl pl-10 pr-4 py-3 text-xs font-bold text-slate-800 outline-none transition-all ${
                          activeTargetGroupId 
                            ? 'border-purple-500 ring-2 ring-purple-100 focus:border-purple-600' 
                            : 'border-slate-400 focus:border-orange-500'
                        }`}
                      />
                    </div>
                    
                    {/* Scrollable search suggestions list (up to 50 results) */}
                    {searchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-300 rounded-2xl shadow-2xl z-30 max-h-64 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
                        {searchResults.map(p => (
                          <button 
                            key={p.id} 
                            type="button"
                            onClick={() => handleSelectProduct(p)} 
                            className="w-full flex items-center justify-between p-3.5 hover:bg-orange-50/50 transition-all text-left group"
                          >
                            <div className="min-w-0 pr-3">
                              <p className="text-xs font-bold text-slate-800 group-hover:text-orange-600 transition-colors truncate">{p.name}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{p.barcode || p.sku || 'Sin código'}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg">${p.salePrice}</span>
                              {activeTargetGroupId ? (
                                <span className="block text-[9px] font-bold text-purple-600 mt-1">+ Añadir como alternativa</span>
                              ) : (
                                <span className="block text-[9px] font-bold text-slate-400 mt-1">+ Agregar</span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* FIXED_COMBO Group-based Product List */}
                  {formData.type === 'FIXED_COMBO' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between ml-1">
                        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-purple-600" />
                          Componentes del combo ({comboGroups.length} {comboGroups.length === 1 ? 'grupo' : 'grupos'})
                        </span>
                        <p className="text-[10px] text-slate-500 font-medium">Cada grupo requiere que el cliente elija 1 de sus opciones</p>
                      </div>

                      {comboGroups.length === 0 ? (
                        <div className="min-h-[140px] border-2 border-dashed border-slate-300 rounded-2xl p-6 bg-slate-50/40 flex flex-col items-center justify-center text-slate-400">
                          <Box className="w-8 h-8 mb-2 opacity-50" />
                          <p className="text-xs font-bold text-slate-600">Aún no hay productos en el combo</p>
                          <p className="text-[10px] text-slate-400 mt-1">Busca un producto arriba (ej: Smirnoff) para crear el primer componente del combo.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {comboGroups.map((group, gIdx) => (
                            <div 
                              key={group.id} 
                              className={`p-4 rounded-2xl border-2 transition-all ${
                                activeTargetGroupId === group.id 
                                  ? 'border-purple-500 bg-purple-50/20 shadow-md' 
                                  : 'border-slate-200 bg-white hover:border-slate-300'
                              }`}
                            >
                              {/* Group Header */}
                              <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-purple-100 text-purple-700 font-black text-[10px] uppercase tracking-wider">
                                    Opción {gIdx + 1}
                                  </span>
                                  {group.products.length > 1 && (
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                                      <Sparkles className="w-3 h-3" />
                                      {group.products.length} alternativas válidas (Cualquiera activa el combo)
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1">
                                    <span className="text-[10px] font-bold text-slate-600 px-1">Cantidad:</span>
                                    <button 
                                      type="button"
                                      onClick={() => updateGroupQuantity(group.id, group.quantity - 1)} 
                                      className="w-5 h-5 flex items-center justify-center bg-white rounded text-slate-700 hover:bg-slate-200 font-bold"
                                    >
                                      <Minus className="w-3 h-3" />
                                    </button>
                                    <span className="text-xs font-black text-slate-800 w-4 text-center">{group.quantity}</span>
                                    <button 
                                      type="button"
                                      onClick={() => updateGroupQuantity(group.id, group.quantity + 1)} 
                                      className="w-5 h-5 flex items-center justify-center bg-white rounded text-slate-700 hover:bg-slate-200 font-bold"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  </div>

                                  <button 
                                    type="button"
                                    onClick={() => removeGroup(group.id)} 
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                    title="Eliminar este grupo"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Products in this group */}
                              <div className="space-y-2">
                                {group.products.length === 0 ? (
                                  <div className="p-3 bg-purple-50/60 border border-dashed border-purple-200 rounded-xl text-center">
                                    <p className="text-xs font-bold text-purple-700">Esperando productos para {group.name}</p>
                                    <p className="text-[10px] text-purple-500 font-medium mt-0.5">Escribe en el buscador de arriba para agregar el producto o sabor principal.</p>
                                  </div>
                                ) : (
                                  group.products.map((prod, pIdx) => (
                                    <div key={prod.productId}>
                                      {pIdx > 0 && (
                                        <div className="flex items-center justify-center my-1.5">
                                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-black text-[9px] uppercase tracking-widest border border-slate-200">
                                            O
                                          </span>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                                        <div className="min-w-0 flex-1 pr-2">
                                          <p className="text-xs font-bold text-slate-800 truncate">{prod.name}</p>
                                          <p className="text-[10px] text-slate-500 font-medium">${prod.salePrice} c/u {prod.barcode && `• ${prod.barcode}`}</p>
                                        </div>
                                        <button 
                                          type="button"
                                          onClick={() => removeProductFromGroup(group.id, prod.productId)} 
                                          className="text-slate-400 hover:text-rose-500 p-1 hover:bg-rose-50 rounded transition-colors"
                                          title="Quitar esta opción del grupo"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                              {/* Add Alternative Button */}
                              <button 
                                type="button"
                                onClick={() => {
                                  setActiveTargetGroupId(group.id);
                                  searchInputRef.current?.focus();
                                }}
                                className={`mt-3 w-full py-2 px-3 rounded-xl border border-dashed text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                  activeTargetGroupId === group.id
                                    ? 'border-purple-500 bg-purple-50 text-purple-700 font-extrabold shadow-sm'
                                    : 'border-purple-300 text-purple-600 hover:bg-purple-50/50'
                                }`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                                {activeTargetGroupId === group.id 
                                  ? 'Escribe arriba para añadir sabor/variante...' 
                                  : 'Agregar opción alternativa a este grupo (ej: otro sabor)'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add next group button */}
                      {comboGroups.length > 0 && (
                        <button 
                          type="button"
                          onClick={handleAddNewGroup}
                          className="w-full py-3.5 border-2 border-dashed border-purple-300 hover:border-purple-500 bg-purple-50/30 hover:bg-purple-50/70 rounded-2xl text-xs font-black text-purple-700 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.99]"
                        >
                          <Plus className="w-4 h-4" />
                          Agregar otro producto o grupo al combo (ej: Speed)
                        </button>
                      )}
                    </div>
                  ) : (
                    /* Flat Product List for NX_M and DISCOUNT_PERCENT */
                    <div className="space-y-2">
                      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1.5 block ml-1">Productos de la oferta</span>
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
                                {formData.type !== 'DISCOUNT_PERCENT' && (
                                  <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1">
                                    <button onClick={() => updateProductQuantity(p.productId, p.quantity - 1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md text-slate-600 hover:text-slate-800"><Minus className="w-3 h-3" /></button>
                                    <span className="text-xs font-bold text-slate-800 w-4 text-center">{p.quantity}</span>
                                    <button onClick={() => updateProductQuantity(p.productId, p.quantity + 1)} className="w-6 h-6 flex items-center justify-center bg-white rounded-md text-slate-600 hover:text-slate-800"><Plus className="w-3 h-3" /></button>
                                  </div>
                                )}
                                <button onClick={() => removeProduct(p.productId)} className="text-slate-300 hover:text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

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
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                        <input 
                          type="number" 
                          value={formData.fixedPrice || ''} 
                          onChange={e => setFormData({ ...formData, fixedPrice: parseFloat(e.target.value) || 0 })} 
                          placeholder="0.00"
                          className="w-full bg-slate-50 border border-slate-400 rounded-xl pl-8 pr-4 py-4 text-xl font-black text-slate-800 focus:bg-white focus:border-orange-500 transition-all outline-none" 
                        />
                      </div>
                      <p className="text-[10px] text-slate-600 font-bold mt-2 ml-1 uppercase tracking-widest">Valor estimado de referencia: ${calculateTotalOriginal().toFixed(2)}</p>
                    </div>
                  )}

                  {/* Condición de Finalización */}
                  <div className="pt-4 border-t border-slate-300">
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
                          <p className="text-[9px] text-slate-600 mt-1 ml-1 font-bold">La promoción se desactivará automáticamente después de vender esta cantidad de combos.</p>
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
                    <div className="w-20 h-20 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-500 animate-in zoom-in duration-500 shadow-sm">
                       <CheckCircle2 className="w-10 h-10" />
                    </div>
                    <div>
                       <h3 className="text-xl font-bold text-slate-800 tracking-tight">¡Todo listo para activar!</h3>
                       <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mt-1">Revisa el resumen antes de guardar</p>
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
                          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Precio / Beneficio</p>
                          <p className="text-lg font-black text-slate-800">
                             {formData.type === 'NX_M' ? `${formData.nValue} x ${formData.mValue}` : formData.type === 'DISCOUNT_PERCENT' ? `-${formData.discountPercentage}%` : `$${formData.fixedPrice}`}
                          </p>
                       </div>
                    </div>

                    <div className="pt-4 border-t border-slate-300">
                       <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Condición de Finalización</p>
                       <span className="text-xs font-bold text-slate-700">
                         {formData.limitType === 'STOCK' ? `Hasta agotar stock (${formData.limitStock} unidades)` : formData.limitType === 'DATE' ? `Hasta el ${formData.endDate}` : 'Siempre activa / Sin límite'}
                       </span>
                    </div>

                    {formData.code && (
                      <div className="pt-4 border-t border-slate-300">
                         <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Código / Barcode del Combo</p>
                         <span className="text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-lg inline-block">
                           {formData.code}
                         </span>
                      </div>
                    )}

                    <div className="pt-4 border-t border-slate-300">
                       <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3">Componentes y Opciones</p>
                       {formData.type === 'FIXED_COMBO' ? (
                         <div className="space-y-3">
                           {comboGroups.map((g, idx) => (
                             <div key={g.id} className="bg-white p-3 rounded-xl border border-slate-200">
                               <div className="flex justify-between items-center mb-1.5">
                                 <span className="text-xs font-black text-purple-700">Opción {idx + 1} (Requiere {g.quantity} {g.quantity === 1 ? 'unidad' : 'unidades'})</span>
                                 <span className="text-[10px] text-slate-400 font-bold">{g.products.length} {g.products.length === 1 ? 'producto' : 'alternativas'}</span>
                               </div>
                               <div className="space-y-1">
                                 {g.products.map((p, pIdx) => (
                                   <div key={p.productId} className="text-xs text-slate-600 font-semibold flex justify-between">
                                     <span>• {p.name}</span>
                                     <span className="text-slate-400">${p.salePrice}</span>
                                   </div>
                                 ))}
                               </div>
                             </div>
                           ))}
                         </div>
                       ) : (
                         <div className="space-y-2">
                            {formData.products.map((p: any) => (
                               <div key={p.productId} className="flex justify-between text-xs font-bold text-slate-600">
                                  <span>{p.name} {p.quantity > 1 && `(x${p.quantity})`}</span>
                                  <span>${(p.salePrice * p.quantity).toFixed(2)}</span>
                               </div>
                            ))}
                         </div>
                       )}
                    </div>
                 </div>

                 <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex gap-3 items-start">
                    <Tag className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-800 font-bold leading-relaxed uppercase tracking-tight">
                       Esta promoción se aplicará automáticamente en el Punto de Venta al escanear o agregar cualquiera de las opciones configuradas.
                    </p>
                 </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 bg-slate-50 border-t border-slate-300 flex items-center justify-between">
          <button 
            onClick={() => setStep(prev => Math.max(1, prev - 1))}
            disabled={step === 1}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-slate-400 text-[11px] font-bold uppercase tracking-widest text-slate-700 hover:bg-white disabled:opacity-30 transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            {step} / 3
          </div>

          {step < 3 ? (
            <button 
              onClick={() => setStep(prev => prev + 1)}
              className="flex items-center gap-2 px-6 py-2.5 bg-orange-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-orange-600 transition-all active:scale-[0.97] cursor-pointer shadow-md shadow-orange-100"
            >
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button 
              onClick={handleSave}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-700 transition-all active:scale-[0.97] disabled:opacity-50 cursor-pointer shadow-md shadow-emerald-100"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Finalizar y Activar
            </button>
          )}
        </div>

        {/* Exit Confirmation Dialog */}
        <AnimatePresence>
          {showExitConfirm && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 10 }}
                className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-4"
              >
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto shadow-sm">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800 tracking-tight">¿Deseas salir?</h3>
                  <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                    Se perderán los cambios y la configuración de esta promoción.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowExitConfirm(false)}
                    className="btn-secondary"
                  >
                    Seguir editando
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn-danger"
                  >
                    Sí, salir
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
