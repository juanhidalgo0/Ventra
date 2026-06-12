import { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Package, 
  Barcode, 
  DollarSign, 
  Percent, 
  Info,
  ChevronDown,
  Save,
  RefreshCw,
  Calculator,
  Tag,
  Plus,
  Check
} from 'lucide-react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';
import { usePOSStore } from '../../stores/posStore';

interface ProductModalProps {
  onClose: () => void;
  onSuccess: () => void;
  product?: any;
}

export default function ProductModal({ onClose, onSuccess, product }: ProductModalProps) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    barcode: product?.barcode || '',
    additionalBarcodes: product?.additionalBarcodes?.map((b: any) => b.barcode) || [],
    categoryId: product?.categoryId || '',
    costPrice: parseFloat((product?.costPrice || 0).toFixed(2)),
    salePrice: parseFloat((product?.salePrice || 0).toFixed(2)),
    stock: product?.stock || 0,
    minStock: product?.minStock || 5,
    unit: product?.unit || 'UNIT',
    presentationType: product?.presentationType || 'UNIT',
    unitsPerPack: product?.unitsPerPack || 1,
    margin: 0,
    imageUrl: product?.imageUrl || '',
    supplierId: product?.supplierId || '',
    allowCustomPrice: product?.allowCustomPrice || false,
    unlimitedStock: product?.unlimitedStock || false
  });

  const [newBarcode, setNewBarcode] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6366f1');

  // Similar product merge states
  const [similarProduct, setSimilarProduct] = useState<any>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadCategories();
    loadSuppliers();
    if (formData.costPrice && formData.salePrice) {
      const margin = ((formData.salePrice / formData.costPrice) - 1) * 100;
      setFormData(prev => ({ ...prev, margin: parseFloat(margin.toFixed(2)) }));
    }
  }, [product]);

  useEffect(() => {
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 150);
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data } = await api.get('/suppliers');
      setSuppliers(data);
    } catch {}
  };

  const loadCategories = async () => {
    try {
      const { data } = await api.get('/categories');
      setCategories(data);
    } catch {}
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 180;
        const MAX_HEIGHT = 180;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.55); // Highly compressed, ultra-lightweight JPEG
          setFormData(prev => ({ ...prev, imageUrl: compressed }));
          toast.success('📸 Imagen local procesada y comprimida');
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName) return;
    try {
      const { data } = await api.post('/categories', { 
        name: newCategoryName, 
        color: newCategoryColor 
      });
      setCategories([...categories, data]);
      setFormData({ ...formData, categoryId: data.id });
      setIsCreatingCategory(false);
      setNewCategoryName('');
      toast.success('Categoría creada');
    } catch {
      toast.error('Error al crear categoría');
    }
  };

  const handleAddBarcode = () => {
    if (!newBarcode || formData.additionalBarcodes.includes(newBarcode)) return;
    setFormData(prev => ({
      ...prev,
      additionalBarcodes: [...prev.additionalBarcodes, newBarcode]
    }));
    setNewBarcode('');
  };

  const handleRemoveBarcode = (barcode: string) => {
    setFormData(prev => ({
      ...prev,
      additionalBarcodes: prev.additionalBarcodes.filter(b => b !== barcode)
    }));
  };

  const handleCostChange = (cost: number) => {
    const validCost = isNaN(cost) ? 0 : cost;
    const validMargin = parseFloat(formData.margin as any) || 0;
    const sale = validCost * (1 + validMargin / 100);
    setFormData(prev => ({ 
      ...prev, 
      costPrice: isNaN(cost) ? '' as any : cost, 
      salePrice: isNaN(cost) ? '' as any : parseFloat(sale.toFixed(2)) 
    }));
  };

  const handleMarginChange = (margin: number) => {
    const validMargin = isNaN(margin) ? 0 : margin;
    const validCost = parseFloat(formData.costPrice as any) || 0;
    const sale = validCost * (1 + validMargin / 100);
    setFormData(prev => ({ 
      ...prev, 
      margin: isNaN(margin) ? '' as any : margin, 
      salePrice: isNaN(margin) ? '' as any : parseFloat(sale.toFixed(2)) 
    }));
  };

  const handleSaleChange = (sale: number) => {
    const validSale = isNaN(sale) ? 0 : sale;
    const validCost = parseFloat(formData.costPrice as any) || 0;
    if (validCost > 0) {
      const margin = ((validSale / validCost) - 1) * 100;
      setFormData(prev => ({ 
        ...prev, 
        salePrice: isNaN(sale) ? '' as any : sale, 
        margin: isNaN(sale) ? '' as any : parseFloat(margin.toFixed(2)) 
      }));
    } else {
      setFormData(prev => ({ 
        ...prev, 
        salePrice: isNaN(sale) ? '' as any : sale 
      }));
    }
  };

  const getSimilarity = (s1: string, s2: string): number => {
    const clean = (s: string) => s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); // remove accents

    // Helper to tokenize and filter stop words / units
    const getTokens = (str: string) => {
      const words = clean(str).split(/[^a-z0-9]+/);
      const stopWords = new Set(['x', 'y', 'de', 'con', 'l', 'lt', 'ltr', 'litros', 'ml', 'g', 'gr', 'grs', 'kg', 'kgs', 'cc', 'cm']);
      return words
        .map(w => w.trim())
        .filter(w => w.length > 0 && !stopWords.has(w));
    };

    const t1 = getTokens(s1);
    const t2 = getTokens(s2);

    if (t1.length === 0 || t2.length === 0) return 0.0;

    // Word similarity helper using Levenshtein distance
    const getWordSimilarity = (w1: string, w2: string): number => {
      if (w1 === w2) return 1.0;
      const track = Array(w2.length + 1).fill(null).map(() => Array(w1.length + 1).fill(null));
      for (let i = 0; i <= w1.length; i += 1) track[0][i] = i;
      for (let j = 0; j <= w2.length; j += 1) track[j][0] = j;
      for (let j = 1; j <= w2.length; j += 1) {
        for (let i = 1; i <= w1.length; i += 1) {
          const indicator = w1[i - 1] === w2[j - 1] ? 0 : 1;
          track[j][i] = Math.min(
            track[j][i - 1] + 1,
            track[j - 1][i] + 1,
            track[j - 1][i - 1] + indicator
          );
        }
      }
      const distance = track[w2.length][w1.length];
      const maxLength = Math.max(w1.length, w2.length);
      return (maxLength - distance) / maxLength;
    };

    // Calculate matches (fuzzy intersections)
    let matches = 0;
    const matched2 = new Set<number>();

    for (let i = 0; i < t1.length; i++) {
      let bestSim = 0;
      let bestIdx = -1;
      for (let j = 0; j < t2.length; j++) {
        if (matched2.has(j)) continue;
        const sim = getWordSimilarity(t1[i], t2[j]);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }
      // If words are very similar (e.g. 0.80+ similarity) count it as a match
      if (bestSim >= 0.80) {
        matches++;
        if (bestIdx !== -1) matched2.add(bestIdx);
      }
    }

    // Overlap coefficient based on matched tokens
    const minLength = Math.min(t1.length, t2.length);
    const overlap = matches / minLength;

    // Jaccard similarity based on matched tokens
    const unionLength = t1.length + t2.length - matches;
    const jaccard = matches / unionLength;

    // We can return a weighted score or the overlap/jaccard
    // If overlap is 1.0 (meaning all tokens of the shorter name match the longer one), or very high:
    if (overlap >= 0.88 && minLength >= 1) {
      return Math.max(overlap, jaccard); 
    }

    return jaccard;
  };

  const handleMergeBarcode = async () => {
    if (!similarProduct) return;
    setIsSubmitting(true);
    try {
      const existingBarcodes = similarProduct.additionalBarcodes?.map((b: any) => b.barcode) || [];
      const newBarcodes = [formData.barcode, ...formData.additionalBarcodes].filter(Boolean);
      const mergedBarcodes = Array.from(new Set([...existingBarcodes, ...newBarcodes]));
      
      // Update existing similar product with new additional barcodes
      await api.patch(`/products/${similarProduct.id}`, {
        additionalBarcodes: mergedBarcodes
      });
      
      toast.success(`✅ Código de barras agregado a: ${similarProduct.name}`);
      onSuccess();
      onClose();
    } catch {
      toast.error('Error al fusionar códigos de barra');
    } finally {
      setIsSubmitting(false);
      setShowMergeModal(false);
    }
  };

  const saveProduct = async (bypassSimilarity: boolean = false) => {
    setIsSubmitting(true);
    try {
      const sanitizedData = {
        ...formData,
        stock: parseInt(formData.stock as any) || 0,
        minStock: parseInt(formData.minStock as any) || 0,
        costPrice: parseFloat(formData.costPrice as any) || 0,
        salePrice: parseFloat(formData.salePrice as any) || 0,
        margin: parseFloat(formData.margin as any) || 0,
        unitsPerPack: Math.max(1, parseInt(formData.unitsPerPack as any) || 1)
      };

      if (!product && formData.barcode && !bypassSimilarity) {
        // Fetch all active products
        const { data: allProducts } = await api.get('/products?take=10000');
        const similar = allProducts.find((p: any) => getSimilarity(p.name, formData.name) >= 0.82);
        if (similar) {
          setSimilarProduct(similar);
          setShowMergeModal(true);
          setIsSubmitting(false);
          return;
        }
      }

      if (product) {
        await api.patch(`/products/${product.id}`, sanitizedData);
        toast.success('Producto actualizado');
      } else {
        await api.post('/products', sanitizedData);
        toast.success('Producto creado');
      }
      // Invalidar caché del POS para que recargue los productos actualizados
      usePOSStore.getState().setProducts([]);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error('Error al guardar producto');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.salePrice) {
      toast.error('Nombre y Precio de venta son obligatorios');
      return;
    }
    saveProduct(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <div onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative bg-white border border-slate-200 w-full max-w-4xl rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-rose-500 border border-rose-200">
              <Package className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-slate-800">{product ? 'Editar Producto' : 'Nuevo Producto'}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 md:p-6 grid grid-cols-12 gap-4 md:gap-6 overflow-y-auto max-h-[calc(100vh-160px)]">
          {/* Main Info (Left) */}
          <div className="col-span-12 lg:col-span-7 space-y-4">
            <div>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Nombre del producto *</span>
              <input 
                ref={nameInputRef}
                type="text" 
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value.toUpperCase() })}
                placeholder="Ej: COCA COLA ZERO 2.25L"
                className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Imagen del Producto</span>
                <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">💡 Recomendado: Carga local</span>
              </div>
              
              <div className="flex gap-3 items-stretch">
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input 
                      type="file" 
                      id="local-image-upload" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleImageUpload} 
                    />
                    <label 
                      htmlFor="local-image-upload"
                      className="flex-1 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 hover:border-rose-400 rounded-lg px-4 py-2.5 text-xs font-semibold text-rose-600 text-center cursor-pointer transition-all flex items-center justify-center gap-2 select-none"
                    >
                      <Plus className="w-4 h-4" /> Cargar Imagen Local
                    </label>
                  </div>
                  
                  <input 
                    type="text" 
                    value={formData.imageUrl.startsWith('data:') ? '📸 Imagen Local Procesada (Guardada)' : formData.imageUrl}
                    onChange={e => setFormData({ ...formData, imageUrl: e.target.value })}
                    disabled={formData.imageUrl.startsWith('data:')}
                    placeholder="O pegar URL de imagen externa..."
                    className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-rose-400 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
                  />
                  {formData.imageUrl.startsWith('data:') && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, imageUrl: '' })}
                      className="text-[10px] font-medium text-rose-500 text-left hover:text-rose-600 transition-colors"
                    >
                      ✕ Quitar imagen local para ingresar URL
                    </button>
                  )}
                </div>

                {/* Preview Box */}
                <div className="w-20 h-20 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden flex items-center justify-center text-slate-400 flex-shrink-0 self-center">
                  <img 
                    src={formData.imageUrl || './product-placeholder.png'} 
                    alt="Preview" 
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = './product-placeholder.png';
                    }}
                  />
                </div>
              </div>
              <p className="text-[10px] text-slate-400 italic leading-tight">
                * Las imágenes cargadas localmente son comprimidas de forma ultra-liviana para no saturar tu web.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Código Principal</span>
                <div className="relative flex items-center">
                  <Barcode className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input 
                    type="text" 
                    value={formData.barcode}
                    onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none"
                  />
                </div>
              </div>
               <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Categoría</span>
                  <button 
                    type="button" 
                    onClick={() => setIsCreatingCategory(!isCreatingCategory)}
                    className="text-[10px] font-semibold text-rose-500 hover:text-rose-600 transition-colors"
                  >
                    {isCreatingCategory ? 'Cancelar' : '+ Nueva'}
                  </button>
                </div>
                <div className="relative flex items-center">
                  {isCreatingCategory ? (
                    <div className="flex gap-1 w-full">
                      <input 
                        type="text"
                        autoFocus
                        placeholder="Nombre..."
                        value={newCategoryName}
                        onChange={e => setNewCategoryName(e.target.value)}
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 outline-none focus:border-rose-400"
                      />
                      <input 
                        type="color"
                        value={newCategoryColor}
                        onChange={e => setNewCategoryColor(e.target.value)}
                        className="w-9 h-9 p-0.5 bg-white border border-slate-200 rounded-lg cursor-pointer"
                      />
                      <button 
                        type="button"
                        onClick={handleCreateCategory}
                        className="p-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-all active:scale-[0.97] flex items-center justify-center"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Tag className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" />
                      <select 
                        value={formData.categoryId || ''}
                        onChange={e => setFormData({ ...formData, categoryId: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 outline-none appearance-none cursor-pointer"
                      >
                        <option value="">Sin categoría</option>
                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                    </>
                  )}
                </div>
              </div>
              <div>
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Proveedor</span>
                <div className="relative flex items-center">
                  <Package className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" />
                  <select 
                    value={formData.supplierId || ''}
                    onChange={e => setFormData({ ...formData, supplierId: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 outline-none appearance-none cursor-pointer"
                  >
                    <option value="">Sin proveedor</option>
                    {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Additional Barcodes */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
               <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Códigos Adicionales</span>
                  <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">{formData.additionalBarcodes.length} registrados</span>
               </div>
               <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newBarcode}
                    onChange={e => setNewBarcode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddBarcode())}
                    placeholder="Escanear otro..."
                    className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-rose-400"
                  />
                  <button 
                    type="button" 
                    onClick={handleAddBarcode}
                    className="px-3 py-2 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition-all"
                  >
                    Vincular
                  </button>
               </div>
               <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto custom-scrollbar">
                  {formData.additionalBarcodes.map(b => (
                    <div key={b} className="flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-1 rounded-md">
                       <span className="text-[10px] font-medium text-slate-600">{b}</span>
                       <button type="button" onClick={() => handleRemoveBarcode(b)} className="text-slate-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
               </div>
            </div>

            {/* Inventory Management */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
               <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Control de Stock</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <input 
                      type="checkbox" 
                      id="unlimitedStock"
                      checked={formData.unlimitedStock}
                      onChange={e => setFormData({ ...formData, unlimitedStock: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <label htmlFor="unlimitedStock" className="text-xs font-bold text-slate-700 cursor-pointer select-none flex items-center gap-1.5">
                      <span>Stock Ilimitado</span>
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-md">∞</span>
                    </label>
                  </div>
                  {formData.unlimitedStock ? (
                    <div className="w-full bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5 text-lg font-bold text-indigo-600 text-center">
                      ∞ Ilimitado
                    </div>
                  ) : (
                    <>
                      <input 
                        type="number" 
                        value={formData.stock}
                        onChange={e => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-lg font-bold text-slate-800 outline-none focus:border-rose-400"
                      />
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 5, 10, 24].map(val => (
                          <button 
                            key={val}
                            type="button"
                            onClick={() => setFormData({ ...formData, stock: formData.stock + val })}
                            className="py-1.5 bg-white border border-slate-200 rounded-md text-[10px] font-semibold text-slate-500 hover:text-rose-600 hover:border-rose-200 transition-all active:scale-[0.95]"
                          >
                            +{val}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
               </div>

               <div className={`rounded-xl p-4 space-y-2 ${formData.unlimitedStock ? 'bg-slate-50 border border-slate-200 opacity-50 pointer-events-none' : 'bg-amber-50 border border-amber-200'}`}>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider block ${formData.unlimitedStock ? 'text-slate-400' : 'text-amber-700'}`}>Alerta Bajo Stock</span>
                  <div className="relative">
                    <Package className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${formData.unlimitedStock ? 'text-slate-300' : 'text-amber-400'}`} />
                    <input 
                      type="number" 
                      value={formData.minStock}
                      onChange={e => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                      placeholder="Mínimo..."
                      disabled={formData.unlimitedStock}
                      className={`w-full bg-white border rounded-lg pl-9 pr-3 py-2.5 text-lg font-bold text-slate-800 outline-none ${formData.unlimitedStock ? 'border-slate-200' : 'border-amber-200 focus:border-amber-400'}`}
                    />
                  </div>
                  <p className={`text-[10px] italic ${formData.unlimitedStock ? 'text-slate-400' : 'text-amber-600'}`}>{formData.unlimitedStock ? 'No aplica con stock ilimitado' : 'El sistema te avisará al llegar a este número'}</p>
               </div>
            </div>

          </div>

          {/* Right Column (Presentation & Pricing) */}
          <div className="col-span-12 lg:col-span-5 space-y-4">
            {/* Presentación & Packaging */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Presentación del Producto</span>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Tipo de Presentación</label>
                  <select 
                    value={formData.presentationType}
                    onChange={e => setFormData({ ...formData, presentationType: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-850 outline-none focus:border-rose-450 cursor-pointer"
                  >
                    <option value="UNIT">Unidad Simple (Suelta)</option>
                    <option value="PACK">Paquete (Multi-unidad / Pack)</option>
                  </select>
                </div>
                {formData.presentationType === 'PACK' && (
                  <div>
                    <label className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-1 block">Unidades por Paquete</label>
                    <input 
                      type="number"
                      min={1}
                      value={formData.unitsPerPack || ''}
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        setFormData({ ...formData, unitsPerPack: isNaN(val) ? '' as any : val });
                      }}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-rose-450"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Pricing (Right) */}
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 md:p-5 space-y-4">
               <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider">Estructura de Precios</span>
                  <Calculator className="w-4 h-4 text-rose-400" />
               </div>

               <div className="space-y-3">
                  <div>
                     <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">Costo Unitario</label>
                     <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-400 font-bold pointer-events-none">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          value={formData.costPrice === 0 && formData.costPrice !== '' as any ? 0 : formData.costPrice || ''}
                          onChange={e => handleCostChange(parseFloat(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-3 py-2.5 text-base font-bold text-slate-800 outline-none focus:border-rose-400 transition-all"
                        />
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                     <div>
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">Margen %</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={formData.margin === 0 && formData.margin !== '' as any ? 0 : formData.margin || ''}
                          onChange={e => handleMarginChange(parseFloat(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-base font-bold text-slate-800 outline-none focus:border-rose-400 transition-all"
                        />
                     </div>
                     <div className="flex flex-col justify-end">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-center">
                           <span className="text-[9px] font-medium text-emerald-600 uppercase tracking-wider block mb-0.5">Utilidad</span>
                           <span className="text-sm font-bold text-emerald-600">+$ {((parseFloat(formData.salePrice as any) || 0) - (parseFloat(formData.costPrice as any) || 0)).toFixed(1)}</span>
                        </div>
                     </div>
                  </div>

                  <div className="pt-2">
                     <label className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider mb-1.5 block">Precio de Venta</label>
                     <div className="relative flex items-center">
                        <span className="absolute left-4 text-xl font-bold text-rose-500 pointer-events-none">$</span>
                        <input 
                          type="number" 
                          step="0.01"
                          value={formData.salePrice === 0 && formData.salePrice !== '' as any ? 0 : formData.salePrice || ''}
                          onChange={e => handleSaleChange(parseFloat(e.target.value))}
                          className="w-full bg-white border-2 border-rose-300 rounded-xl pl-9 pr-4 py-4 text-3xl font-bold text-slate-800 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition-all"
                        />
                     </div>
                  </div>

                  <div className="pt-2 flex items-center gap-2">
                     <input 
                       type="checkbox" 
                       id="allowCustomPrice"
                       checked={formData.allowCustomPrice}
                       onChange={e => setFormData({ ...formData, allowCustomPrice: e.target.checked })}
                       className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                     />
                     <label htmlFor="allowCustomPrice" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                       Permitir precio personalizado en POS
                     </label>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
          <button onClick={onClose} type="button" className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">Cancelar</button>
          <button 
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 active:scale-[0.97] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {product ? 'Actualizar Producto' : 'Crear Producto'}
          </button>
        </div>
      </motion.div>

      {showMergeModal && similarProduct && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div onClick={() => setShowMergeModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative bg-white border border-slate-200 w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-6 z-10 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto border border-amber-500/20 shadow-md">
              <Info className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-800 tracking-tight">¿Vincular como código alternativo?</h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-2.5">
                Hemos detectado un producto muy similar ya registrado en tu inventario:
              </p>
              <div className="mt-3 p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-1">
                <p className="text-sm font-bold text-slate-700">{similarProduct.name}</p>
                <p className="text-[10px] font-bold text-slate-450 uppercase tracking-wider">Código principal: {similarProduct.barcode || 'N/A'}</p>
                {similarProduct.category?.name && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-md text-white bg-slate-600 inline-block uppercase mt-1">
                    {similarProduct.category.name}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed mt-4">
                ¿Deseas agregar el código de barra <b>"{formData.barcode}"</b> como un código adicional para este producto existente?
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleMergeBarcode}
                disabled={isSubmitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4" /> Sí, agregar como código alternativo
              </button>

              <button
                type="button"
                onClick={() => saveProduct(true)}
                disabled={isSubmitting}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-bold active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-200"
              >
                <Plus className="w-4 h-4" /> No, crear producto nuevo
              </button>

              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="w-full py-2.5 text-xs text-slate-400 font-bold hover:text-slate-600 transition-colors uppercase tracking-wider cursor-pointer"
              >
                Volver a editar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
