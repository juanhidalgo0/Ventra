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
  Check,
  Bookmark
} from 'lucide-react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';
import { usePOSStore } from '../../stores/posStore';

function buildCategoryTree(cats: any[]) {
  const parents = cats.filter(c => !c.parentCategory && !c.parentCategoryId);
  const children = cats.filter(c => c.parentCategory || c.parentCategoryId);
  
  const result: any[] = [];
  parents.forEach(parent => {
    result.push(parent);
    const subcats = children.filter(c => c.parentCategoryId === parent.id || c.parentCategory?.id === parent.id);
    subcats.forEach(sub => {
      result.push({
        ...sub,
        name: `   └ ${sub.name}`, // Indented subcategory
        isSubcategory: true
      });
    });
  });
  
  // Add any orphaned children at the end
  const addedIds = new Set(result.map(r => r.id));
  cats.forEach(c => {
    if (!addedIds.has(c.id)) {
      result.push(c);
    }
  });
  
  return result;
}

interface ProductModalProps {
  onClose: () => void;
  onSuccess: (product?: any) => void;
  product?: any;
}

export default function ProductModal({ onClose, onSuccess, product }: ProductModalProps) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    barcode: product?.barcode || '',
    sku: product?.sku || '',
    additionalBarcodes: product?.additionalBarcodes?.map((b: any) => b.barcode) || [],
    categoryId: product?.categoryId || '',
    brandId: product?.brandId || '',
    costPrice: product?.presentationType === 'PACK'
      ? parseFloat(((product?.costPrice || 0) * (product?.unitsPerPack || 1)).toFixed(2))
      : parseFloat((product?.costPrice || 0).toFixed(2)),
    salePrice: product?.presentationType === 'PACK'
      ? parseFloat(((product?.salePrice || 0) * (product?.unitsPerPack || 1)).toFixed(2))
      : parseFloat((product?.salePrice || 0).toFixed(2)),
    stock: product?.presentationType === 'PACK'
      ? Math.floor((product?.stock || 0) / (product?.unitsPerPack || 1))
      : (product?.stock || 0),
    minStock: product?.presentationType === 'PACK'
      ? Math.floor((product?.minStock || 0) / (product?.unitsPerPack || 1))
      : (product?.minStock || 5),
    unit: product?.unit || 'UNIT',
    presentationType: product?.presentationType || 'UNIT',
    unitsPerPack: product?.unitsPerPack || 1,
    pieceSize: product?.pieceSize || '',
    location: product?.location || '',
    wholesalePrice: product?.wholesalePrice || '',
    wholesaleMinQty: product?.wholesaleMinQty || '',
    tradePrice: product?.tradePrice || '',
    isKit: product?.isKit || false,
    equivalents: product?.equivalents || '',
    margin: 0,
    imageUrl: product?.imageUrl || '',
    supplierId: product?.supplierId || '',
    allowCustomPrice: product?.allowCustomPrice || false,
    unlimitedStock: product?.unlimitedStock || false
  });

  const [kitItems, setKitItems] = useState<{ childProductId: string; quantity: number; name: string; salePrice?: number }[]>(() => {
    return product?.kitItems?.map((k: any) => ({
      childProductId: k.childProductId,
      quantity: k.quantity,
      name: k.childProduct?.name || 'Componente',
      salePrice: k.childProduct?.salePrice || 0
    })) || [];
  });

  const [newBarcode, setNewBarcode] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6366f1');
  const [newCategoryParentId, setNewCategoryParentId] = useState('');
  
  const [isCreatingBrand, setIsCreatingBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');

  // Similar product merge states
  const [similarProduct, setSimilarProduct] = useState<any>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const costInputRef = useRef<HTMLInputElement>(null);
  const unitSalePriceInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const isHardwareStore = localStorage.getItem('business_type') === 'FERRETERIA' || (product?.unit && product.unit !== 'UNIT') || Boolean(product?.location) || Boolean(product?.wholesalePrice);

  const [suggestedImageUrl, setSuggestedImageUrl] = useState<string | null>(null);
  const [isSearchingImage, setIsSearchingImage] = useState(false);
  const [rejectedBarcodeSuggestion, setRejectedBarcodeSuggestion] = useState<string | null>(null);
  const [activeLargeImage, setActiveLargeImage] = useState<{ url: string; isSuggestion: boolean } | null>(null);

  useEffect(() => {
    if (suggestedImageUrl) {
      setActiveLargeImage({ url: suggestedImageUrl, isSuggestion: true });
    }
  }, [suggestedImageUrl]);

  useEffect(() => {
    const barcode = formData.barcode;
    if (formData.imageUrl || product?.imageUrl) {
      setSuggestedImageUrl(null);
      return;
    }
    if (barcode && /^\d+$/.test(barcode) && barcode.length >= 8 && barcode.length <= 14) {
      if (rejectedBarcodeSuggestion === barcode) return;

      const searchTimer = setTimeout(async () => {
        setIsSearchingImage(true);
        setSuggestedImageUrl(null);
        try {
          const { data } = await api.get(`/products/search-external-image/${barcode}`);
          if (data.imageUrl) {
            setSuggestedImageUrl(data.imageUrl);
          }
        } catch (err) {
          console.error('Error searching image for barcode:', err);
        } finally {
          setIsSearchingImage(false);
        }
      }, 700);

      return () => clearTimeout(searchTimer);
    } else {
      setSuggestedImageUrl(null);
    }
  }, [formData.barcode, rejectedBarcodeSuggestion, formData.imageUrl, product?.imageUrl]);

  useEffect(() => {
    if (!formData.barcode) {
      setRejectedBarcodeSuggestion(null);
      setSuggestedImageUrl(null);
    }
  }, [formData.barcode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      const target = e.target as HTMLElement;
      
      // Allow native Enter behavior for buttons, submits, and textareas
      if (e.key === 'Enter' && (target.tagName === 'BUTTON' || (target as any).type === 'submit')) {
        return;
      }
      if (e.key === 'Enter' && target.tagName === 'TEXTAREA') {
        return;
      }

      e.preventDefault();
      if (!modalRef.current) return;

      // Select only writing/input fields, skipping buttons, checkboxes, close buttons etc.
      const query = 'input:not([type]):not([disabled]), input[type="text"]:not([disabled]), input[type="number"]:not([disabled]), input[type="url"]:not([disabled]), select:not([disabled]), textarea:not([disabled])';
      const writingFields = Array.from(
        modalRef.current.querySelectorAll(query)
      ) as HTMLElement[];

      const index = writingFields.indexOf(target);
      if (index > -1) {
        if (e.shiftKey) {
          // Go backward on Shift+Tab or Shift+Enter
          const prevElement = writingFields[index - 1] || writingFields[writingFields.length - 1];
          if (prevElement) prevElement.focus();
        } else {
          // Go forward on Tab or Enter
          const nextElement = writingFields[index + 1] || writingFields[0];
          if (nextElement) nextElement.focus();
        }
      } else {
        // Fallback to first writing field if focus is elsewhere
        if (writingFields.length > 0) {
          writingFields[0].focus();
        }
      }
    }
  };

  useEffect(() => {
    loadCategories();
    loadBrands();
    loadSuppliers();
    if (formData.costPrice && formData.salePrice) {
      const margin = ((formData.salePrice / formData.costPrice) - 1) * 100;
      setFormData(prev => ({ ...prev, margin: parseFloat(margin.toFixed(2)) }));
    }
  }, [product]);

  useEffect(() => {
    setTimeout(() => {
      if (costInputRef.current) {
        costInputRef.current.focus();
        costInputRef.current.select();
      } else {
        nameInputRef.current?.focus();
      }
    }, 150);
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data } = await api.get('/suppliers');
      setSuppliers(data);
    } catch {}
  };

  const loadBrands = async () => {
    try {
      const { data } = await api.get('/brands');
      setBrands(data);
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
        color: newCategoryColor,
        parentCategoryId: newCategoryParentId || null
      });
      setCategories([...categories, data]);
      setFormData({ ...formData, categoryId: data.id });
      setIsCreatingCategory(false);
      setNewCategoryName('');
      setNewCategoryParentId('');
      toast.success('Categoría creada');
    } catch {
      toast.error('Error al crear categoría');
    }
  };

  const handleCreateBrand = async () => {
    if (!newBrandName) return;
    try {
      const { data } = await api.post('/brands', { name: newBrandName });
      setBrands([...brands, data]);
      setFormData({ ...formData, brandId: data.id });
      setIsCreatingBrand(false);
      setNewBrandName('');
      toast.success('Marca creada');
    } catch {
      toast.error('Error al crear marca');
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

  const handleUnitCostChange = (unitCost: number) => {
    const validUnitCost = isNaN(unitCost) ? 0 : unitCost;
    const packCost = validUnitCost * (formData.unitsPerPack || 1);
    handleCostChange(packCost);
  };

  const handleUnitSalePriceChange = (unitSale: number) => {
    const validUnitSale = isNaN(unitSale) ? 0 : unitSale;
    const packSale = validUnitSale * (formData.unitsPerPack || 1);
    handleSaleChange(packSale);
  };

  const handleMarginChange = (margin: number) => {
    const validMargin = isNaN(margin) ? 0 : margin;
    const validCost = parseFloat(formData.costPrice as any) || 0;
    let sale = validCost * (1 + validMargin / 100);
    if (!isNaN(sale) && sale > 0) {
      sale = Math.ceil(sale / 10) * 10;
    }
    setFormData(prev => ({ 
      ...prev, 
      margin: isNaN(margin) ? '' as any : margin, 
      salePrice: isNaN(margin) ? '' as any : sale 
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
      let activeCategoryId = formData.categoryId;
      let activeBrandId = formData.brandId;

      if (isCreatingCategory && newCategoryName.trim()) {
        try {
          const { data: newCat } = await api.post('/categories', { 
            name: newCategoryName.trim(), 
            color: newCategoryColor,
            parentCategoryId: newCategoryParentId || null
          });
          activeCategoryId = newCat.id;
          setCategories([...categories, newCat]);
          setIsCreatingCategory(false);
          setNewCategoryName('');
          setNewCategoryParentId('');
        } catch (catErr) {
          toast.error('Error al crear la nueva categoría');
          setIsSubmitting(false);
          return;
        }
      }

      if (isCreatingBrand && newBrandName.trim()) {
        try {
          const { data: newBrand } = await api.post('/brands', { 
            name: newBrandName.trim()
          });
          activeBrandId = newBrand.id;
          setBrands([...brands, newBrand]);
          setIsCreatingBrand(false);
          setNewBrandName('');
        } catch (brandErr) {
          toast.error('Error al crear la nueva marca');
          setIsSubmitting(false);
          return;
        }
      }

      const isPack = formData.presentationType === 'PACK';
      const uPerPack = Math.max(1, parseInt(formData.unitsPerPack as any) || 1);

      const rawUnitCost = (parseFloat(formData.costPrice as any) || 0) / (isPack ? uPerPack : 1);
      const rawUnitSale = (parseFloat(formData.salePrice as any) || 0) / (isPack ? uPerPack : 1);

      let cleanUnitSale = Math.round(rawUnitSale * 100) / 100;
      if (Math.abs(cleanUnitSale - Math.round(cleanUnitSale)) < 0.01) {
        cleanUnitSale = Math.round(cleanUnitSale);
      }

      let cleanUnitCost = Math.round(rawUnitCost * 100) / 100;

      const sanitizedData = {
        ...formData,
        categoryId: activeCategoryId,
        brandId: activeBrandId || null,
        sku: formData.sku || null,
        location: formData.location?.trim() || null,
        wholesalePrice: formData.wholesalePrice !== '' && formData.wholesalePrice !== null && !isNaN(parseFloat(formData.wholesalePrice as any)) ? parseFloat(formData.wholesalePrice as any) : null,
        wholesaleMinQty: formData.wholesaleMinQty !== '' && formData.wholesaleMinQty !== null && !isNaN(parseFloat(formData.wholesaleMinQty as any)) ? parseFloat(formData.wholesaleMinQty as any) : null,
        stock: (parseFloat(formData.stock as any) || 0) * (isPack ? uPerPack : 1),
        minStock: (parseFloat(formData.minStock as any) || 0) * (isPack ? uPerPack : 1),
        costPrice: cleanUnitCost,
        salePrice: cleanUnitSale,
        tradePrice: formData.tradePrice !== '' && formData.tradePrice !== null && !isNaN(parseFloat(formData.tradePrice as any)) ? parseFloat(formData.tradePrice as any) : null,
        isKit: Boolean(formData.isKit),
        kitItems: formData.isKit ? kitItems.map(k => ({ childProductId: k.childProductId, quantity: Number(k.quantity) || 1 })) : [],
        equivalents: formData.equivalents?.trim() || null,
        margin: parseFloat(formData.margin as any) || 0,
        unitsPerPack: uPerPack,
        pieceSize: ['MT', 'KG', 'L'].includes(formData.unit) && formData.pieceSize !== '' && formData.pieceSize !== null && !isNaN(parseFloat(formData.pieceSize as any)) && parseFloat(formData.pieceSize as any) > 0
          ? parseFloat(formData.pieceSize as any)
          : null
      };

      let savedProduct = null;
      if (product && product.id) {
        const res = await api.patch(`/products/${product.id}`, sanitizedData);
        savedProduct = res.data;
        toast.success('Producto actualizado');
      } else {
        const res = await api.post('/products', sanitizedData);
        savedProduct = res.data;
        toast.success('Producto creado');
      }
      // Invalidar caché del POS para que recargue los productos actualizados
      usePOSStore.getState().setProducts([]);
      onSuccess(savedProduct);
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al guardar producto');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        ref={modalRef}
        id="product-modal-container"
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative bg-white border border-slate-200 dark:border-slate-800 w-full max-w-6xl rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-rose-500 border border-rose-200">
              <Package className="w-5 h-5" />
            </div>
            <h2 className="text-base font-bold text-slate-800">{(product && product.id) ? 'Editar Producto' : 'Nuevo Producto'}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 md:p-6 grid grid-cols-12 gap-4 md:gap-6 overflow-y-auto max-h-[calc(100vh-160px)]">
          {/* Main Info (Left) */}
          <div className="col-span-12 lg:col-span-7 space-y-4">
            <div>
              <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider mb-1.5 block">Nombre del producto *</span>
              <input 
                ref={nameInputRef}
                type="text" 
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value.toUpperCase() })}
                onFocus={e => e.target.select()}
                placeholder="Ej: COCA COLA ZERO 2.25L"
                className="w-full bg-white border border-slate-400 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-600 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Imagen del Producto</span>
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
                    className="w-full bg-white border border-slate-400 rounded-lg px-3.5 py-2 text-xs font-medium text-slate-800 placeholder:text-slate-600 focus:border-rose-400 outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
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
                <button
                  type="button"
                  onClick={() => {
                    if (formData.imageUrl) {
                      setActiveLargeImage({ url: formData.imageUrl, isSuggestion: false });
                    }
                  }}
                  disabled={!formData.imageUrl && !isSearchingImage}
                  className="relative w-20 h-20 rounded-xl bg-slate-50 border border-slate-400 hover:border-rose-500 overflow-hidden flex items-center justify-center text-slate-600 flex-shrink-0 self-center transition-all cursor-pointer disabled:cursor-default disabled:hover:border-slate-400"
                  title={formData.imageUrl ? "Hacer clic para ver en grande" : undefined}
                >
                  <img 
                    src={formData.imageUrl || './product-placeholder.png'} 
                    alt="Preview" 
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = './product-placeholder.png';
                    }}
                  />

                  {isSearchingImage && (
                    <div className="absolute inset-0 bg-slate-900/60 flex flex-col items-center justify-center text-white text-[9px] font-bold">
                      <RefreshCw className="w-4 h-4 animate-spin mb-1" />
                      Buscando...
                    </div>
                  )}
                </button>
              </div>
              <p className="text-[10px] text-slate-600 italic leading-tight">
                * Las imágenes cargadas localmente son comprimidas de forma ultra-liviana para no saturar tu web.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              <div>
                <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider mb-1.5 block">Cód. Barras</span>
                <div className="relative flex items-center">
                  <input 
                    type="text" 
                    value={formData.barcode}
                    onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                    onFocus={e => e.target.select()}
                    className="w-full bg-white border border-slate-400 rounded-lg px-2.5 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none"
                  />
                </div>
              </div>
              <div>
                <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider mb-1.5 block">SKU</span>
                <div className="relative flex items-center">
                  <input 
                    type="text" 
                    value={formData.sku}
                    onChange={e => setFormData({ ...formData, sku: e.target.value })}
                    onFocus={e => e.target.select()}
                    className="w-full bg-white border border-slate-400 rounded-lg px-2.5 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none"
                  />
                </div>
              </div>
               <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Categoría</span>
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
                    <div className="flex flex-col gap-1.5 w-full bg-slate-50 border border-slate-400 rounded-lg p-2 z-10">
                      <div className="flex gap-1 w-full">
                        <input 
                          type="text"
                          autoFocus
                          placeholder="Nombre..."
                          value={newCategoryName}
                          onChange={e => setNewCategoryName(e.target.value)}
                          className="flex-1 bg-white border border-slate-400 rounded px-2 py-1 text-xs text-slate-800 outline-none focus:border-rose-400"
                        />
                        <input 
                          type="color"
                          value={newCategoryColor}
                          onChange={e => setNewCategoryColor(e.target.value)}
                          className="w-8 h-7 p-0.5 bg-white border border-slate-400 rounded cursor-pointer"
                        />
                      </div>
                      <div className="flex gap-1 items-center">
                        <select
                          value={newCategoryParentId}
                          onChange={e => setNewCategoryParentId(e.target.value)}
                          className="flex-1 bg-white border border-slate-400 rounded px-1 py-0.5 text-[9px] text-slate-600 outline-none"
                        >
                          <option value="">Sin Padre (Principal)</option>
                          {categories.filter(c => !c.parentCategory && !c.parentCategoryId).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button 
                          type="button"
                          onClick={handleCreateCategory}
                          className="p-1 bg-rose-600 text-white rounded hover:bg-rose-700 transition-all active:scale-[0.97] flex items-center justify-center"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <select 
                        value={formData.categoryId || ''}
                        onChange={e => setFormData({ ...formData, categoryId: e.target.value })}
                        className="w-full bg-white border border-slate-400 rounded-lg pl-2.5 pr-7 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 outline-none appearance-none cursor-pointer text-ellipsis overflow-hidden whitespace-nowrap"
                      >
                        <option value="">Sin categoría</option>
                        {buildCategoryTree(categories).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2.5 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Marca</span>
                  <button 
                    type="button" 
                    onClick={() => setIsCreatingBrand(!isCreatingBrand)}
                    className="text-[10px] font-semibold text-rose-500 hover:text-rose-600 transition-colors"
                  >
                    {isCreatingBrand ? 'Cancelar' : '+ Nueva'}
                  </button>
                </div>
                <div className="relative flex items-center">
                  {isCreatingBrand ? (
                    <div className="flex gap-1 w-full bg-slate-50 border border-slate-400 rounded-lg p-1.5 z-10">
                      <input 
                        type="text"
                        autoFocus
                        placeholder="Marca..."
                        value={newBrandName}
                        onChange={e => setNewBrandName(e.target.value)}
                        className="flex-1 bg-white border border-slate-400 rounded px-2 py-1 text-xs text-slate-800 outline-none focus:border-rose-400"
                      />
                      <button 
                        type="button"
                        onClick={handleCreateBrand}
                        className="p-1 bg-rose-600 text-white rounded hover:bg-rose-700 transition-all active:scale-[0.97] flex items-center justify-center"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <select 
                        value={formData.brandId || ''}
                        onChange={e => setFormData({ ...formData, brandId: e.target.value })}
                        className="w-full bg-white border border-slate-400 rounded-lg pl-2.5 pr-7 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 outline-none appearance-none cursor-pointer text-ellipsis overflow-hidden whitespace-nowrap"
                      >
                        <option value="">Sin marca</option>
                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2.5 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                    </>
                  )}
                </div>
              </div>
              <div>
                <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider mb-1.5 block">Proveedor</span>
                <div className="relative flex items-center">
                  <select 
                    value={formData.supplierId || ''}
                    onChange={e => setFormData({ ...formData, supplierId: e.target.value })}
                    className="w-full bg-white border border-slate-400 rounded-lg pl-2.5 pr-7 py-2.5 text-xs font-medium text-slate-800 focus:border-rose-400 outline-none appearance-none cursor-pointer text-ellipsis overflow-hidden whitespace-nowrap"
                  >
                    <option value="">Sin proveedor</option>
                    {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Additional Barcodes */}
            <div className="bg-slate-50 border border-slate-400 rounded-xl p-4 space-y-3">
               <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">Códigos Adicionales</span>
                  <span className="text-[10px] font-medium text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">{formData.additionalBarcodes.length} registrados</span>
               </div>
               <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={newBarcode}
                    onChange={e => setNewBarcode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddBarcode())}
                    placeholder="Escanear otro..."
                    className="flex-1 bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder:text-slate-600 outline-none focus:border-rose-400"
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
                    <div key={b} className="flex items-center gap-1.5 bg-white border border-slate-400 px-2 py-1 rounded-md">
                       <span className="text-[10px] font-medium text-slate-600">{b}</span>
                       <button type="button" onClick={() => handleRemoveBarcode(b)} className="text-slate-600 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
               </div>
            </div>

            {/* Inventory Management */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
               <div className="bg-slate-50 border border-slate-400 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider block">Control de Stock</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <input 
                      type="checkbox" 
                      id="unlimitedStock"
                      checked={formData.unlimitedStock}
                      onChange={e => setFormData({ ...formData, unlimitedStock: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                    />
                    <label htmlFor="unlimitedStock" className="text-xs font-bold text-slate-700 cursor-pointer select-none flex items-center gap-1.5">
                      <span>Stock Ilimitado</span>
                      <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-md">∞</span>
                    </label>
                  </div>
                  {formData.unlimitedStock ? (
                    <div className="w-full bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 text-lg font-bold text-rose-600 text-center">
                      ∞ Ilimitado
                    </div>
                  ) : (
                    <>
                      <input 
                        type="number" 
                        step="any"
                        value={formData.stock}
                        onChange={e => setFormData({ ...formData, stock: parseFloat(e.target.value) || 0 })}
                        onFocus={e => e.target.select()}
                        className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2.5 text-lg font-bold text-slate-800 outline-none focus:border-rose-400"
                      />
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 5, 10, 24].map(val => (
                          <button 
                            key={val}
                            type="button"
                            onClick={() => setFormData({ ...formData, stock: parseFloat(((formData.stock || 0) + val).toFixed(2)) })}
                            className="py-1.5 bg-white border border-slate-400 rounded-md text-[10px] font-semibold text-slate-700 hover:text-rose-600 hover:border-rose-200 transition-all active:scale-[0.95]"
                          >
                            +{val}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
               </div>

               <div className={`rounded-xl p-4 space-y-2 ${formData.unlimitedStock ? 'bg-slate-50 border border-slate-400 opacity-50 pointer-events-none' : 'bg-amber-50 border border-amber-200'}`}>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider block ${formData.unlimitedStock ? 'text-slate-600' : 'text-amber-700'}`}>Alerta Bajo Stock</span>
                  <div className="relative">
                    <Package className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${formData.unlimitedStock ? 'text-slate-300' : 'text-amber-400'}`} />
                    <input 
                      type="number" 
                      step="any"
                      value={formData.minStock}
                      onChange={e => setFormData({ ...formData, minStock: parseFloat(e.target.value) || 0 })}
                      onFocus={e => e.target.select()}
                      placeholder="Mínimo..."
                      disabled={formData.unlimitedStock}
                      className={`w-full bg-white border rounded-lg pl-9 pr-3 py-2.5 text-lg font-bold text-slate-800 outline-none ${formData.unlimitedStock ? 'border-slate-400' : 'border-amber-200 focus:border-amber-400'}`}
                    />
                  </div>
                  <p className={`text-[10px] italic ${formData.unlimitedStock ? 'text-slate-600' : 'text-amber-600'}`}>{formData.unlimitedStock ? 'No aplica con stock ilimitado' : 'El sistema te avisará al llegar a este número'}</p>
               </div>
            </div>

          </div>

          {/* Right Column (Presentation & Pricing) */}
          <div className="col-span-12 lg:col-span-5 space-y-4">
            {/* Presentación & Packaging */}
            <div className="bg-slate-50 border border-slate-400 rounded-xl p-4 space-y-3">
              <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider block">
                {isHardwareStore ? 'Presentación y Medida' : 'Presentación del Producto'}
              </span>
              <div className={`grid ${isHardwareStore ? 'grid-cols-2' : (formData.presentationType === 'PACK' ? 'grid-cols-2' : 'grid-cols-1')} gap-3`}>
                <div>
                  <label className="text-[9px] font-medium text-slate-600 uppercase tracking-wider mb-1 block">Tipo de Presentación</label>
                  <select 
                    value={formData.presentationType}
                    onChange={e => setFormData({ ...formData, presentationType: e.target.value })}
                    className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-semibold text-slate-850 outline-none focus:border-rose-450 cursor-pointer"
                  >
                    <option value="UNIT">Unidad Simple (Suelta)</option>
                    <option value="PACK">Paquete (Multi-unidad / Pack)</option>
                  </select>
                </div>
                {isHardwareStore && (
                  <div>
                    <label className="text-[9px] font-medium text-slate-600 uppercase tracking-wider mb-1 block">Unidad de Medida</label>
                    <select 
                      value={formData.unit || 'UNIT'}
                      onChange={e => setFormData({ ...formData, unit: e.target.value })}
                      className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-semibold text-slate-850 outline-none focus:border-rose-450 cursor-pointer"
                    >
                      <option value="UNIT">Unidad (un)</option>
                      <option value="MT">Metro (m) - Cables/Caños</option>
                      <option value="KG">Kilogramo (kg) - Clavos/Áridos</option>
                      <option value="L">Litro (L) - Pinturas/Solventes</option>
                      <option value="PACK">Pack / Rollo (pack)</option>
                    </select>
                  </div>
                )}
                {isHardwareStore && ['MT', 'KG', 'L'].includes(formData.unit) && (
                  <div className="col-span-2">
                    <label className="text-[9px] font-medium text-slate-600 uppercase tracking-wider mb-1 block">
                      Tamaño de Pieza Madre (opcional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={`Ej: 100 (rollo/barra de 100 ${formData.unit === 'MT' ? 'm' : formData.unit === 'KG' ? 'kg' : 'L'})`}
                      value={formData.pieceSize || ''}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        setFormData({ ...formData, pieceSize: isNaN(val) ? '' as any : val });
                      }}
                      onFocus={e => e.target.select()}
                      className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-rose-450 placeholder:text-slate-400 placeholder:font-normal"
                    />
                    {Boolean(formData.pieceSize) && Number(formData.pieceSize) > 0 && (
                      <p className="text-[9.5px] font-semibold text-emerald-700 mt-1">
                        Stock actual equivale a {Math.floor((Number(formData.stock) || 0) / Number(formData.pieceSize))} pieza(s) completa(s)
                        {(() => {
                          const remainder = (Number(formData.stock) || 0) % Number(formData.pieceSize);
                          return remainder > 0.001 ? ` + ${parseFloat(remainder.toFixed(3))} ${formData.unit === 'MT' ? 'm' : formData.unit === 'KG' ? 'kg' : 'L'} sobrante` : '';
                        })()}
                      </p>
                    )}
                  </div>
                )}
                {formData.presentationType === 'PACK' && (
                  <div className={isHardwareStore ? 'col-span-2' : ''}>
                    <label className="text-[9px] font-medium text-slate-600 uppercase tracking-wider mb-1 block">Unidades por Paquete / Bulto</label>
                    <input 
                      type="number"
                      min={1}
                      value={formData.unitsPerPack || ''}
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        setFormData({ ...formData, unitsPerPack: isNaN(val) ? '' as any : val });
                      }}
                      onFocus={e => e.target.select()}
                      className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-rose-450"
                    />
                  </div>
                )}
                {isHardwareStore && (
                  <div className="col-span-2">
                    <label className="text-[9px] font-medium text-slate-600 uppercase tracking-wider mb-1 block">
                      📍 Ubicación en Depósito / Estantería
                    </label>
                    <input 
                      type="text"
                      placeholder="Ej: Pasillo 2 - Estante B - Gaveta 14"
                      value={formData.location}
                      onChange={e => setFormData({ ...formData, location: e.target.value })}
                      className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-450 placeholder:text-slate-400"
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
                  {formData.presentationType === 'PACK' ? (
                    <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-2 duration-200">
                      <div>
                         <label className="text-[10px] font-medium text-slate-700 uppercase tracking-wider mb-1 block">Costo del Paquete</label>
                         <div className="relative flex items-center">
                            <span className="absolute left-3 text-slate-650 font-bold pointer-events-none">$</span>
                            <input 
                              type="number" 
                              step="0.01"
                              value={formData.costPrice === 0 && formData.costPrice !== '' as any ? 0 : formData.costPrice || ''}
                              onChange={e => handleCostChange(parseFloat(e.target.value))}
                              onFocus={e => e.target.select()}
                              className="w-full bg-white border border-slate-400 rounded-lg pl-7 pr-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-rose-400 transition-all"
                            />
                         </div>
                      </div>
                      <div>
                         <label className="text-[10px] font-medium text-slate-700 uppercase tracking-wider mb-1 block">Costo por Unidad</label>
                         <div className="relative flex items-center">
                            <span className="absolute left-3 text-slate-650 font-bold pointer-events-none">$</span>
                            <input 
                              ref={costInputRef}
                              type="number" 
                              step="0.01"
                              value={formData.costPrice === 0 || !formData.unitsPerPack ? '' : parseFloat((formData.costPrice / formData.unitsPerPack).toFixed(2)) || ''}
                              onChange={e => handleUnitCostChange(parseFloat(e.target.value))}
                              onFocus={e => e.target.select()}
                              className="w-full bg-white border border-slate-400 rounded-lg pl-7 pr-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-rose-400 transition-all"
                              placeholder="0.00"
                            />
                         </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                       <label className="text-[10px] font-medium text-slate-700 uppercase tracking-wider mb-1 block">Costo Unitario</label>
                       <div className="relative flex items-center">
                          <span className="absolute left-3 text-slate-600 font-bold pointer-events-none">$</span>
                          <input 
                            ref={costInputRef}
                            type="number" 
                            step="0.01"
                            value={formData.costPrice === 0 && formData.costPrice !== '' as any ? 0 : formData.costPrice || ''}
                            onChange={e => handleCostChange(parseFloat(e.target.value))}
                            onFocus={e => e.target.select()}
                            className="w-full bg-white border border-slate-400 rounded-lg pl-7 pr-3 py-2.5 text-base font-bold text-slate-800 outline-none focus:border-rose-400 transition-all"
                          />
                       </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                     <div>
                        <label className="text-[10px] font-medium text-slate-700 uppercase tracking-wider mb-1 block">Margen %</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={formData.margin === 0 && formData.margin !== '' as any ? 0 : formData.margin || ''}
                          onChange={e => handleMarginChange(parseFloat(e.target.value))}
                          onFocus={e => e.target.select()}
                          className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2.5 text-base font-bold text-slate-800 outline-none focus:border-rose-400 transition-all"
                        />
                     </div>
                     <div className="flex flex-col justify-end">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-center">
                           <span className="text-[9px] font-medium text-emerald-600 uppercase tracking-wider block mb-0.5">Utilidad</span>
                           <span className="text-sm font-bold text-emerald-600">+$ {((parseFloat(formData.salePrice as any) || 0) - (parseFloat(formData.costPrice as any) || 0)).toFixed(1)}</span>
                        </div>
                     </div>
                  </div>

                  {formData.presentationType === 'PACK' ? (
                    <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-2 duration-200 pt-2">
                      <div>
                         <label className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider mb-1.5 block">Precio del Paquete</label>
                         <div className="relative flex items-center">
                            <span className="absolute left-3 text-lg font-bold text-rose-500 pointer-events-none">$</span>
                            <input 
                              type="number" 
                              step="0.01"
                              value={formData.salePrice === 0 && formData.salePrice !== '' as any ? 0 : formData.salePrice || ''}
                              onChange={e => handleSaleChange(parseFloat(e.target.value))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  unitSalePriceInputRef.current?.focus();
                                  unitSalePriceInputRef.current?.select();
                                }
                              }}
                              onFocus={e => e.target.select()}
                              className="w-full bg-white border-2 border-rose-300 rounded-xl pl-7 pr-3 py-3 text-xl font-bold text-slate-800 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition-all"
                            />
                         </div>
                      </div>
                      <div>
                         <label className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider mb-1.5 block">Precio por Unidad</label>
                         <div className="relative flex items-center">
                            <span className="absolute left-3 text-lg font-bold text-rose-500 pointer-events-none">$</span>
                            <input 
                              ref={unitSalePriceInputRef}
                              type="number" 
                              step="0.01"
                              value={formData.salePrice === 0 || !formData.unitsPerPack ? '' : parseFloat((formData.salePrice / formData.unitsPerPack).toFixed(2)) || ''}
                              onChange={e => handleUnitSalePriceChange(parseFloat(e.target.value))}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSubmit();
                                }
                              }}
                              onFocus={e => e.target.select()}
                              className="w-full bg-white border-2 border-rose-300 rounded-xl pl-7 pr-3 py-3 text-xl font-bold text-slate-800 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition-all"
                              placeholder="0.00"
                            />
                         </div>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2">
                       <label className="text-[10px] font-semibold text-rose-600 uppercase tracking-wider mb-1.5 block">Precio de Venta</label>
                       <div className="relative flex items-center">
                          <span className="absolute left-4 text-xl font-bold text-rose-500 pointer-events-none">$</span>
                          <input 
                            type="number" 
                            step="0.01"
                            value={formData.salePrice === 0 && formData.salePrice !== '' as any ? 0 : formData.salePrice || ''}
                            onChange={e => handleSaleChange(parseFloat(e.target.value))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSubmit();
                              }
                            }}
                            onFocus={e => e.target.select()}
                            className="w-full bg-white border-2 border-rose-300 rounded-xl pl-9 pr-4 py-4 text-3xl font-bold text-slate-800 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition-all"
                          />
                       </div>
                    </div>
                  )}

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

                  {isHardwareStore && (
                    <div className="pt-3 border-t border-rose-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">
                          🏷️ Descuento por Cantidad / Mayorista
                        </span>
                        <span className="text-[9px] text-rose-600 font-medium">Automático en Carrito</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-medium text-slate-600 uppercase tracking-wider block mb-1">A partir de (Cant.)</label>
                          <input
                            type="number"
                            step="any"
                            min="1"
                            placeholder="Ej: 10"
                            value={formData.wholesaleMinQty}
                            onChange={e => setFormData({ ...formData, wholesaleMinQty: e.target.value })}
                            onFocus={e => e.target.select()}
                            className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-rose-400"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-medium text-slate-600 uppercase tracking-wider block mb-1">Precio x Cantidad ($)</label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Ej: 850"
                            value={formData.wholesalePrice}
                            onChange={e => setFormData({ ...formData, wholesalePrice: e.target.value })}
                            onFocus={e => e.target.select()}
                            className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-rose-400"
                          />
                        </div>
                      </div>

                      {/* Precio Gremio / Oficio */}
                      <div className="pt-2.5 border-t border-dashed border-slate-200">
                        <label className="text-[9.5px] font-bold text-amber-800 uppercase tracking-wider block mb-1 flex items-center justify-between">
                          <span>🔧 Precio Gremio / Oficio ($)</span>
                          <span className="text-[8.5px] text-slate-400 font-normal lowercase">(instaladores y profesionales)</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Ej: 900 (opcional)"
                          value={formData.tradePrice}
                          onChange={e => setFormData({ ...formData, tradePrice: e.target.value })}
                          onFocus={e => e.target.select()}
                          className="w-full bg-white border border-amber-300 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                        />
                      </div>

                      {/* Kit / Combo Armado con Despiece de Stock */}
                      <div className="pt-2.5 border-t border-dashed border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-800 flex items-center gap-2 cursor-pointer select-none">
                            <input 
                              type="checkbox"
                              checked={formData.isKit}
                              onChange={e => setFormData({ ...formData, isKit: e.target.checked })}
                              className="w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                            />
                            <span>📦 Kit / Combo Armado (Despiece)</span>
                          </label>
                          <span className="text-[8.5px] text-rose-600 font-bold bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">Descuenta piezas al vender</span>
                        </div>

                        {formData.isKit && (
                          <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl space-y-2">
                            <p className="text-[10px] text-slate-600">Al vender este combo, se descontará automáticamente el stock de los productos que lo integran:</p>

                            <select 
                              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none cursor-pointer"
                              value=""
                              onChange={(e) => {
                                const childId = e.target.value;
                                if (!childId) return;
                                const found = usePOSStore.getState().products.find(p => p.id === childId);
                                if (found && !kitItems.some(k => k.childProductId === childId)) {
                                  setKitItems([...kitItems, { childProductId: childId, quantity: 1, name: found.name, salePrice: found.salePrice }]);
                                }
                              }}
                            >
                              <option value="">+ Seleccionar producto para agregar al kit...</option>
                              {usePOSStore.getState().products.filter(p => p.id !== product?.id).map(p => (
                                <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>
                              ))}
                            </select>

                            <div className="space-y-1.5 max-h-36 overflow-y-auto custom-scrollbar">
                              {kitItems.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between gap-2 p-2 bg-white rounded-lg border border-slate-200 text-xs">
                                  <span className="truncate flex-1 font-bold text-slate-700">{item.name}</span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[10px] text-slate-400">Cant:</span>
                                    <input 
                                      type="number"
                                      min="0.1"
                                      step="any"
                                      value={item.quantity}
                                      onChange={(e) => {
                                        const qty = parseFloat(e.target.value) || 1;
                                        setKitItems(kitItems.map((k, i) => i === idx ? { ...k, quantity: qty } : k));
                                      }}
                                      className="w-14 px-1.5 py-1 text-center font-bold border border-slate-300 rounded"
                                    />
                                    <button 
                                      type="button" 
                                      onClick={() => setKitItems(kitItems.filter((_, i) => i !== idx))}
                                      className="text-rose-500 hover:text-rose-700 p-1 cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                              {kitItems.length === 0 && (
                                <p className="text-[10px] text-amber-700 italic">No agregaste ningún componente al kit todavía.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
               </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-300 bg-slate-50 flex items-center justify-end gap-3">
          <button onClick={onClose} type="button" className="btn-secondary">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 active:scale-[0.97] transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {(product && product.id) ? 'Actualizar Producto' : 'Crear Producto'}
          </button>
        </div>
      </motion.div>

      {showMergeModal && similarProduct && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowMergeModal(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-6 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto border border-amber-500/20 shadow-md">
              <Info className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-800 tracking-tight">¿Vincular como código alternativo?</h3>
              <p className="text-xs text-slate-700 leading-relaxed mt-2.5">
                Hemos detectado un producto muy similar ya registrado en tu inventario:
              </p>
              <div className="mt-3 p-4 rounded-2xl bg-slate-50 border border-slate-400 text-left space-y-1">
                <p className="text-sm font-bold text-slate-700">{similarProduct.name}</p>
                <p className="text-[10px] font-bold text-slate-450 uppercase tracking-wider">Código principal: {similarProduct.barcode || 'N/A'}</p>
                {similarProduct.category?.name && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-md text-white bg-slate-600 inline-block uppercase mt-1">
                    {similarProduct.category.name}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed mt-4">
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
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-bold active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-400"
              >
                <Plus className="w-4 h-4" /> No, crear producto nuevo
              </button>

              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="w-full py-2.5 text-xs text-slate-600 font-bold hover:text-slate-600 transition-colors uppercase tracking-wider cursor-pointer"
              >
                Volver a editar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {activeLargeImage && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setActiveLargeImage(null)}>
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col p-6 space-y-4 font-sans text-slate-800 dark:text-slate-100"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-750 pb-2.5">
              <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Package className="w-4.5 h-4.5 text-rose-500" />
                {activeLargeImage.isSuggestion ? "Imagen Encontrada" : "Vista Previa de Imagen"}
              </h3>
              <button
                type="button"
                onClick={() => setActiveLargeImage(null)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="w-full aspect-square rounded-2xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-750 overflow-hidden flex items-center justify-center shadow-inner p-2">
              <img 
                src={activeLargeImage.url} 
                alt="Large Preview" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = './product-placeholder.png';
                }}
              />
            </div>

            {activeLargeImage.isSuggestion ? (
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormData(prev => ({ ...prev, imageUrl: activeLargeImage.url }));
                    setSuggestedImageUrl(null);
                    setActiveLargeImage(null);
                    toast.success("Imagen aplicada con éxito");
                  }}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 rounded-xl text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
                >
                  <Check className="w-4 h-4" /> Usar Imagen
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejectedBarcodeSuggestion(formData.barcode);
                    setSuggestedImageUrl(null);
                    setActiveLargeImage(null);
                  }}
                  className="px-5 py-3.5 rounded-xl border border-slate-400 dark:border-slate-750 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                >
                  Descartar
                </button>
              </div>
            ) : (
              <div className="pt-2 text-right">
                <button
                  type="button"
                  onClick={() => setActiveLargeImage(null)}
                  className="px-5 py-3 rounded-xl border border-slate-400 dark:border-slate-750 text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs uppercase tracking-wider cursor-pointer text-center"
                >
                  Cerrar
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
