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
  Bookmark,
  Wand2,
  Search,
  FolderTree,
  Coins,
  Boxes,
  Ruler,
  Truck,
  Layers,
  Wrench,
  Image as ImageIcon
} from 'lucide-react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';
import { usePOSStore } from '../../stores/posStore';
import ImageSearchPicker from './ImageSearchPicker';

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

/** Sección del formulario: título chico en mayúsculas con ícono y una línea. */
function FormSection({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2.5">
        <Icon className="w-4 h-4 text-rose-600" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
        <div className="flex-1 h-px bg-slate-100" />
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Opciones avanzadas plegadas. Se abren solas si el producto ya tiene datos ahí. */
function Collapsible({ icon: Icon, title, hint, defaultOpen, badge, children }: {
  icon: any; title: string; hint?: string; defaultOpen?: boolean; badge?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`rounded-xl border transition-colors ${open ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-3 py-2 text-left">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${open ? 'bg-rose-50 text-rose-600' : 'bg-white border border-slate-200 text-slate-500'}`}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-slate-800">{title}</span>
          {hint && <span className="block text-[11.5px] text-slate-500 truncate">{hint}</span>}
        </span>
        {badge && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">{badge}</span>}
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 pt-2.5 border-t border-slate-100 space-y-3">{children}</div>}
    </div>
  );
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
    // Compra al proveedor: precio de lista sin IVA, descuentos en cascada e IVA
    listPrice: product?.listPrice == null
      ? ''
      : product?.presentationType === 'PACK'
        ? parseFloat((product.listPrice * (product?.unitsPerPack || 1)).toFixed(2))
        : product.listPrice,
    discount1: product?.discount1 || 0,
    discount2: product?.discount2 || 0,
    discount3: product?.discount3 || 0,
    taxRate: product?.taxRate || 0,
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
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [rejectedBarcodeSuggestion, setRejectedBarcodeSuggestion] = useState<string | null>(null);
  const [activeLargeImage, setActiveLargeImage] = useState<{ url: string; isSuggestion: boolean } | null>(null);
  // Al cerrar la ventana de la imagen sugerida, el cursor vuelve al nombre para seguir cargando
  const focusName = () => setTimeout(() => { nameInputRef.current?.focus(); nameInputRef.current?.select(); }, 60);

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
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    const target = e.target as HTMLElement;
    // Botones (plegables, "+ Nueva", etc.) y textareas mantienen su Enter normal
    if (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (!modalRef.current) return;

    // Solo campos donde se escribe: sin selectores, checkboxes ni la URL de imagen
    const writable = Array.from(
      modalRef.current.querySelectorAll<HTMLInputElement>(
        'input:not([type]):not([disabled]):not([data-enter-skip]), input[type="text"]:not([disabled]):not([data-enter-skip]), input[type="number"]:not([disabled]):not([data-enter-skip])',
      ),
    );

    // Stock mínimo es el último: Enter ahí guarda el producto
    if (target.hasAttribute('data-enter-submit')) {
      handleSubmit();
      return;
    }

    let index = writable.indexOf(target as HTMLInputElement);
    if (index === -1) {
      // Enter sobre un selector/checkbox: seguir desde el próximo campo escribible
      index = writable.findIndex(el => target.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) - 1;
      if (index < -1) index = writable.length - 1;
    }

    const next = e.shiftKey ? writable[index - 1] : writable[index + 1];
    if (next) {
      next.focus();
      next.select?.();
    } else if (!e.shiftKey) {
      // No hay más campos: confirmar
      handleSubmit();
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
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
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

  /**
   * Costo = precio de lista - descuentos en cascada + IVA.
   * Se recalcula al tocar cualquiera de esos campos; el costo se puede seguir
   * escribiendo a mano si no se carga un precio de lista.
   */
  const recalcCostFromList = (changes: Partial<typeof formData>) => {
    const next = { ...formData, ...changes };
    const list = parseFloat(next.listPrice as any);
    setFormData(prev => ({ ...prev, ...changes }));
    if (isNaN(list) || list <= 0) return;
    const d = (v: any) => 1 - (parseFloat(v as any) || 0) / 100;
    const iva = 1 + (parseFloat(next.taxRate as any) || 0) / 100;
    const cost = list * d(next.discount1) * d(next.discount2) * d(next.discount3) * iva;
    handleCostChange(parseFloat(cost.toFixed(2)));
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
        listPrice: formData.listPrice !== '' && formData.listPrice !== null && !isNaN(parseFloat(formData.listPrice as any))
          ? parseFloat(formData.listPrice as any) / (isPack ? uPerPack : 1)
          : null,
        discount1: parseFloat(formData.discount1 as any) || 0,
        discount2: parseFloat(formData.discount2 as any) || 0,
        discount3: parseFloat(formData.discount3 as any) || 0,
        taxRate: parseFloat(formData.taxRate as any) || 0,
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

  const labelCls = 'block text-[12.5px] font-semibold text-slate-800 mb-1';
  const hintCls = 'text-[11.5px] text-slate-500 mt-1 leading-snug';
  const inputCls = 'w-full h-9 bg-white border border-slate-300 rounded-lg px-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 transition-all';
  const selectCls = inputCls + ' pr-8 appearance-none cursor-pointer text-ellipsis overflow-hidden whitespace-nowrap';
  const moneyPrefix = 'absolute inset-y-0 left-3 flex items-center text-slate-400 font-semibold pointer-events-none';
  const isEditing = !!(product && product.id);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-3 md:p-4"
      onClick={onClose}
    >
      <motion.div
        ref={modalRef}
        id="product-modal-container"
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="keep-style relative w-full max-w-[1280px] max-h-[calc(100dvh-24px)] md:max-h-[calc(100dvh-32px)] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 shadow-[0_24px_70px_-20px_rgba(15,23,42,0.45)] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <p className="eyebrow">{isEditing ? 'Inventario · Edición' : 'Inventario'}</p>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight mt-0.5">{isEditing ? 'Editar producto' : 'Agregar producto'}</h2>
          </div>
          <button onClick={onClose} type="button" className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-7 gap-y-5 content-start">

          {/* Columna 1: datos básicos + organización */}
          <div className="space-y-5 min-w-0">
          {/* ── Datos básicos ── */}
          <FormSection icon={Package} title="Datos básicos">
            <div>
              <label className={labelCls}>Nombre del producto <span className="text-rose-600">*</span></label>
              <input
                ref={nameInputRef}
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value.toUpperCase() })}
                onFocus={e => e.target.select()}
                placeholder="Ej: COCA COLA ZERO 2.25L"
                className={inputCls + ' h-10 text-[15px]'}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Código de barras</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={e => setFormData({ ...formData, barcode: e.target.value.toUpperCase() })}
                    onFocus={e => e.target.select()}
                    placeholder="Escaneá o escribí"
                    className={inputCls + (!formData.barcode ? ' pr-9' : '')}
                  />
                  {!formData.barcode && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const { data } = await api.get('/products/internal-barcode/next');
                          setFormData(prev => ({ ...prev, barcode: data.barcode }));
                          toast.success('Código interno generado. Se guarda al guardar el producto.');
                        } catch {
                          toast.error('No se pudo generar el código interno');
                        }
                      }}
                      className="absolute inset-y-0 right-1.5 my-auto h-7 w-7 flex items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 cursor-pointer"
                      title="Generar código interno (para productos sin código)"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className={labelCls}>SKU <span className="text-slate-400 font-normal text-[12px]">(opcional)</span></label>
                <input
                  type="text"
                  value={formData.sku}
                  onChange={e => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                  onFocus={e => e.target.select()}
                  className={inputCls}
                />
              </div>
            </div>

            {/* Imagen */}
            <div>
              <label className={labelCls}>Imagen</label>
              <div className="flex gap-3 items-start">
                <button
                  type="button"
                  onClick={() => { if (formData.imageUrl) setActiveLargeImage({ url: formData.imageUrl, isSuggestion: false }); }}
                  disabled={!formData.imageUrl && !isSearchingImage}
                  className="relative w-[80px] h-[80px] rounded-xl bg-slate-50 border border-dashed border-slate-300 hover:border-rose-400 overflow-hidden flex items-center justify-center shrink-0 transition-all cursor-pointer disabled:cursor-default disabled:hover:border-slate-300"
                  title={formData.imageUrl ? 'Ver en grande' : undefined}
                >
                  {formData.imageUrl ? (
                    <img
                      src={formData.imageUrl}
                      alt="Vista previa"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).src = './product-placeholder.png'; }}
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-300" />
                  )}
                  {isSearchingImage && (
                    <div className="absolute inset-0 bg-slate-900/60 flex flex-col items-center justify-center text-white text-[9px] font-bold">
                      <RefreshCw className="w-4 h-4 animate-spin mb-1" />
                      Buscando...
                    </div>
                  )}
                </button>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex gap-2">
                    <input type="file" id="local-image-upload" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    <label
                      htmlFor="local-image-upload"
                      className="flex-1 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[12.5px] font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer select-none transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5 text-rose-600" /> Subir imagen
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowImagePicker(true)}
                      className="flex-1 h-9 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-[12.5px] font-semibold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer select-none transition-colors"
                    >
                      <Search className="w-3.5 h-3.5 text-rose-600" /> Buscar foto
                    </button>
                  </div>
                  {formData.imageUrl.startsWith('data:') ? (
                    <div className="flex items-center justify-between gap-2 h-9 px-3 rounded-lg bg-rose-50 border border-rose-200 text-[12px] text-rose-800">
                      <span className="truncate">Imagen local cargada (comprimida)</span>
                      <button type="button" onClick={() => setFormData({ ...formData, imageUrl: '' })} className="font-semibold hover:underline shrink-0">Quitar</button>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={formData.imageUrl}
                      onChange={e => setFormData({ ...formData, imageUrl: e.target.value })}
                      placeholder="O pegá la URL de una imagen"
                      data-enter-skip
                      className={inputCls + ' h-9 text-[12.5px]'}
                    />
                  )}
                </div>
              </div>
            </div>
          </FormSection>

          {/* ── Organización ── */}
          <FormSection icon={FolderTree} title="Organización">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[12.5px] font-semibold text-slate-800">Categoría</label>
                  <button type="button" onClick={() => setIsCreatingCategory(!isCreatingCategory)} className="text-[12px] font-semibold text-rose-600 hover:text-rose-700">
                    {isCreatingCategory ? 'Cancelar' : '+ Nueva'}
                  </button>
                </div>
                {isCreatingCategory ? (
                  <div className="flex flex-col gap-1.5 w-full bg-slate-50 border border-slate-300 rounded-lg p-2">
                    <div className="flex gap-1 w-full">
                      <input
                        type="text"
                        autoFocus
                        placeholder="Nombre..."
                        value={newCategoryName}
                        onChange={e => setNewCategoryName(e.target.value)}
                        className="flex-1 bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 outline-none focus:border-rose-400"
                      />
                      <input type="color" value={newCategoryColor} onChange={e => setNewCategoryColor(e.target.value)} className="w-8 h-7 p-0.5 bg-white border border-slate-300 rounded cursor-pointer" />
                    </div>
                    <div className="flex gap-1 items-center">
                      <select
                        value={newCategoryParentId}
                        onChange={e => setNewCategoryParentId(e.target.value)}
                        className="flex-1 bg-white border border-slate-300 rounded px-1 py-0.5 text-[11px] text-slate-600 outline-none"
                      >
                        <option value="">Sin padre (principal)</option>
                        {categories.filter(c => !c.parentCategory && !c.parentCategoryId).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={handleCreateCategory} className="p-1 bg-rose-600 text-white rounded hover:bg-rose-700 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <select value={formData.categoryId || ''} onChange={e => setFormData({ ...formData, categoryId: e.target.value })} className={selectCls}>
                      <option value="">Sin categoría</option>
                      {buildCategoryTree(categories).map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 inset-y-0 my-auto w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[12.5px] font-semibold text-slate-800">Marca</label>
                  <button type="button" onClick={() => setIsCreatingBrand(!isCreatingBrand)} className="text-[12px] font-semibold text-rose-600 hover:text-rose-700">
                    {isCreatingBrand ? 'Cancelar' : '+ Nueva'}
                  </button>
                </div>
                {isCreatingBrand ? (
                  <div className="flex gap-1 w-full bg-slate-50 border border-slate-300 rounded-lg p-1.5">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Marca..."
                      value={newBrandName}
                      onChange={e => setNewBrandName(e.target.value)}
                      className="flex-1 bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 outline-none focus:border-rose-400"
                    />
                    <button type="button" onClick={handleCreateBrand} className="p-1 bg-rose-600 text-white rounded hover:bg-rose-700 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <select value={formData.brandId || ''} onChange={e => setFormData({ ...formData, brandId: e.target.value })} className={selectCls}>
                      <option value="">Sin marca</option>
                      {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 inset-y-0 my-auto w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className={labelCls}>Proveedor <span className="text-slate-400 font-normal text-[12px]">({suppliers.length} disponibles)</span></label>
              <div className="relative">
                <select value={formData.supplierId || ''} onChange={e => setFormData({ ...formData, supplierId: e.target.value })} className={selectCls}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 inset-y-0 my-auto w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {isHardwareStore && (
              <div>
                <label className={labelCls}>Ubicación en depósito <span className="text-slate-400 font-normal text-[12px]">(opcional)</span></label>
                <input
                  type="text"
                  placeholder="Ej: Pasillo 2 - Estante B - Gaveta 14"
                  value={formData.location}
                  onChange={e => setFormData({ ...formData, location: e.target.value })}
                  className={inputCls}
                />
              </div>
            )}
          </FormSection>

          </div>

          {/* Columna 2: precios */}
          <div className="space-y-5 min-w-0">
          {/* ── Precios y rentabilidad ── */}
          <FormSection icon={Coins} title="Precios y rentabilidad">
            <Collapsible
              icon={Truck}
              title="Compra al proveedor"
              hint="Calculá el costo desde el precio de lista, descuentos e IVA"
              defaultOpen={parseFloat(formData.listPrice as any) > 0}
            >
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="col-span-2">
                  <label className="text-[12px] font-semibold text-slate-700 mb-1 block">Precio de lista (sin IVA)</label>
                  <div className="relative">
                    <span className={moneyPrefix}>$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.listPrice === 0 ? 0 : formData.listPrice || ''}
                      onChange={e => recalcCostFromList({ listPrice: e.target.value === '' ? '' : parseFloat(e.target.value) } as any)}
                      onFocus={e => e.target.select()}
                      placeholder="0.00"
                      className={inputCls + ' pl-7'}
                    />
                  </div>
                </div>
                {([1, 2, 3] as const).map(n => (
                  <div key={n}>
                    <label className="text-[12px] font-semibold text-slate-700 mb-1 block">Desc. {n} %</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={(formData as any)[`discount${n}`] || ''}
                      onChange={e => recalcCostFromList({ [`discount${n}`]: e.target.value === '' ? 0 : parseFloat(e.target.value) } as any)}
                      onFocus={e => e.target.select()}
                      placeholder="0"
                      className={inputCls + ' px-2'}
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-rose-600"
                    checked={(parseFloat(formData.taxRate as any) || 0) > 0}
                    onChange={e => recalcCostFromList({ taxRate: e.target.checked ? 21 : 0 })}
                  />
                  Aplicar IVA
                </label>
                {(parseFloat(formData.taxRate as any) || 0) > 0 && (
                  <select
                    value={formData.taxRate}
                    onChange={e => recalcCostFromList({ taxRate: parseFloat(e.target.value) })}
                    className="h-8 bg-white border border-slate-300 rounded-lg px-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-500"
                  >
                    <option value={21}>21%</option>
                    <option value={10.5}>10,5%</option>
                    <option value={27}>27%</option>
                  </select>
                )}
                {parseFloat(formData.listPrice as any) > 0 && (
                  <span className="text-[12px] text-slate-600 ml-auto">
                    Costo: <b className="text-slate-900">$ {(parseFloat(formData.costPrice as any) || 0).toFixed(2)}</b>
                    {(parseFloat(formData.taxRate as any) || 0) > 0 ? ' con IVA' : ' sin IVA'}
                  </span>
                )}
              </div>
            </Collapsible>

            {formData.presentationType === 'PACK' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Costo del paquete</label>
                  <div className="relative">
                    <span className={moneyPrefix}>$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.costPrice === 0 && formData.costPrice !== '' as any ? 0 : formData.costPrice || ''}
                      onChange={e => handleCostChange(parseFloat(e.target.value))}
                      onFocus={e => e.target.select()}
                      className={inputCls + ' pl-7'}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Costo por unidad</label>
                  <div className="relative">
                    <span className={moneyPrefix}>$</span>
                    <input
                      ref={costInputRef}
                      type="number"
                      step="0.01"
                      value={formData.costPrice === 0 || !formData.unitsPerPack ? '' : parseFloat((formData.costPrice / formData.unitsPerPack).toFixed(2)) || ''}
                      onChange={e => handleUnitCostChange(parseFloat(e.target.value))}
                      onFocus={e => e.target.select()}
                      placeholder="0.00"
                      className={inputCls + ' pl-7'}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              {formData.presentationType !== 'PACK' && (
                <div>
                  <label className={labelCls}>Precio de costo</label>
                  <div className="relative">
                    <span className={moneyPrefix}>$</span>
                    <input
                      ref={costInputRef}
                      type="number"
                      step="0.01"
                      value={formData.costPrice === 0 && formData.costPrice !== '' as any ? 0 : formData.costPrice || ''}
                      onChange={e => handleCostChange(parseFloat(e.target.value))}
                      onFocus={e => e.target.select()}
                      placeholder="0.00"
                      className={inputCls + ' pl-7'}
                    />
                  </div>
                </div>
              )}
              <div>
                <label className={labelCls}>Margen</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={formData.margin === 0 && formData.margin !== '' as any ? 0 : formData.margin || ''}
                    onChange={e => handleMarginChange(parseFloat(e.target.value))}
                    onFocus={e => e.target.select()}
                    placeholder="Ej: 50"
                    className={inputCls + ' pr-8'}
                  />
                  <span className="absolute inset-y-0 right-3 flex items-center text-slate-400 font-semibold pointer-events-none">%</span>
                </div>
              </div>
              {formData.presentationType === 'PACK' && (
                <div className="flex flex-col justify-end">
                  <div className="h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 flex items-center justify-between">
                    <span className="text-[12px] text-slate-500">Ganancia</span>
                    <span className="text-sm font-bold text-rose-700">+$ {((parseFloat(formData.salePrice as any) || 0) - (parseFloat(formData.costPrice as any) || 0)).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Precio final destacado */}
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4">
              {formData.presentationType === 'PACK' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[13px] font-bold text-rose-900 mb-1.5">Precio del paquete <span className="text-rose-600">*</span></label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3 flex items-center text-rose-600 font-bold text-lg pointer-events-none">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.salePrice === 0 && formData.salePrice !== '' as any ? 0 : formData.salePrice || ''}
                        onChange={e => handleSaleChange(parseFloat(e.target.value))}
                        onFocus={e => e.target.select()}
                        className="w-full h-12 bg-white border-2 border-rose-300 rounded-xl pl-8 pr-3 text-xl font-bold text-slate-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] font-bold text-rose-900 mb-1.5">Precio por unidad</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3 flex items-center text-rose-600 font-bold text-lg pointer-events-none">$</span>
                      <input
                        ref={unitSalePriceInputRef}
                        type="number"
                        step="0.01"
                        value={formData.salePrice === 0 || !formData.unitsPerPack ? '' : parseFloat((formData.salePrice / formData.unitsPerPack).toFixed(2)) || ''}
                        onChange={e => handleUnitSalePriceChange(parseFloat(e.target.value))}
                        onFocus={e => e.target.select()}
                        placeholder="0.00"
                        className="w-full h-12 bg-white border-2 border-rose-300 rounded-xl pl-8 pr-3 text-xl font-bold text-slate-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 transition-all"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <label className="block text-[13px] font-bold text-rose-900 mb-1.5">Precio de venta final <span className="text-rose-600">*</span></label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-4 flex items-center text-rose-600 font-bold text-2xl pointer-events-none">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.salePrice === 0 && formData.salePrice !== '' as any ? 0 : formData.salePrice || ''}
                        onChange={e => handleSaleChange(parseFloat(e.target.value))}
                        onFocus={e => e.target.select()}
                        placeholder="0.00"
                        className="w-full h-12 bg-white border-2 border-rose-300 rounded-xl pl-10 pr-4 text-2xl font-bold text-slate-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 transition-all"
                      />
                    </div>
                  </div>
                  <div className="pb-1 text-right shrink-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-rose-700/70">Ganancia</span>
                    <span className="block text-lg font-bold text-rose-700">+$ {((parseFloat(formData.salePrice as any) || 0) - (parseFloat(formData.costPrice as any) || 0)).toFixed(2)}</span>
                  </div>
                </div>
              )}
              <label className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-rose-900 cursor-pointer select-none">
                <input
                  type="checkbox"
                  id="allowCustomPrice"
                  checked={formData.allowCustomPrice}
                  onChange={e => setFormData({ ...formData, allowCustomPrice: e.target.checked })}
                  className="w-4 h-4 accent-rose-600 cursor-pointer"
                />
                Permitir cambiar el precio al vender en el POS
              </label>
            </div>

            {isHardwareStore && (
              <>
                <Collapsible
                  icon={Layers}
                  title="Precio mayorista"
                  hint="Precio automático a partir de cierta cantidad"
                  defaultOpen={!!formData.wholesaleMinQty || !!formData.wholesalePrice}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[12px] font-semibold text-slate-700 mb-1 block">A partir de (cantidad)</label>
                      <input
                        type="number"
                        step="any"
                        min="1"
                        placeholder="Ej: 10"
                        value={formData.wholesaleMinQty}
                        onChange={e => setFormData({ ...formData, wholesaleMinQty: e.target.value })}
                        onFocus={e => e.target.select()}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="text-[12px] font-semibold text-slate-700 mb-1 block">Precio por unidad</label>
                      <div className="relative">
                        <span className={moneyPrefix}>$</span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Ej: 850"
                          value={formData.wholesalePrice}
                          onChange={e => setFormData({ ...formData, wholesalePrice: e.target.value })}
                          onFocus={e => e.target.select()}
                          className={inputCls + ' pl-7'}
                        />
                      </div>
                    </div>
                  </div>
                </Collapsible>

                <Collapsible
                  icon={Wrench}
                  title="Precio gremio / oficio"
                  hint="Para instaladores y profesionales"
                  defaultOpen={!!formData.tradePrice}
                >
                  <div className="relative">
                    <span className={moneyPrefix}>$</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Ej: 900 (opcional)"
                      value={formData.tradePrice}
                      onChange={e => setFormData({ ...formData, tradePrice: e.target.value })}
                      onFocus={e => e.target.select()}
                      className={inputCls + ' pl-7'}
                    />
                  </div>
                </Collapsible>
              </>
            )}
          </FormSection>

          </div>

          {/* Columna 3: inventario + más opciones */}
          <div className="space-y-5 min-w-0 md:col-span-2 xl:col-span-1">
          {/* ── Inventario ── */}
          <FormSection icon={Boxes} title="Inventario">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5 cursor-pointer select-none">
              <span>
                <span className="block text-[13px] font-semibold text-slate-800">Stock ilimitado</span>
                <span className="block text-[11.5px] text-slate-500">Para servicios o productos que no se cuentan</span>
              </span>
              <input
                type="checkbox"
                id="unlimitedStock"
                checked={formData.unlimitedStock}
                onChange={e => setFormData({ ...formData, unlimitedStock: e.target.checked })}
                className="w-4 h-4 accent-rose-600 cursor-pointer"
              />
            </label>

            {!formData.unlimitedStock && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Cantidad en stock</label>
                  <input
                    type="number"
                    step="any"
                    value={formData.stock}
                    onChange={e => setFormData({ ...formData, stock: parseFloat(e.target.value) || 0 })}
                    onFocus={e => e.target.select()}
                    className={inputCls + ' text-base font-bold'}
                  />
                  <div className="grid grid-cols-4 gap-1 mt-1.5">
                    {[1, 5, 10, 24].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setFormData({ ...formData, stock: parseFloat(((formData.stock || 0) + val).toFixed(2)) })}
                        className="h-7 bg-white border border-slate-200 rounded-md text-[11px] font-semibold text-slate-600 hover:text-rose-700 hover:border-rose-300 transition-colors"
                      >
                        +{val}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Stock mínimo</label>
                  <input
                    type="number"
                    step="any"
                    data-enter-submit
                    value={formData.minStock}
                    onChange={e => setFormData({ ...formData, minStock: parseFloat(e.target.value) || 0 })}
                    onFocus={e => e.target.select()}
                    placeholder="0"
                    className={inputCls + ' text-base font-bold'}
                  />
                  <p className={hintCls}>Te avisamos cuando el stock llegue a este número.</p>
                </div>
              </div>
            )}
          </FormSection>

          {/* ── Más opciones ── */}
          <FormSection icon={Plus} title="Más opciones">
            <Collapsible
              icon={Ruler}
              title={isHardwareStore ? 'Presentación y medida' : 'Presentación'}
              hint={isHardwareStore ? 'Paquetes, metros, kilos, litros' : 'Unidad suelta o paquete de varias unidades'}
              defaultOpen={formData.presentationType === 'PACK' || (!!formData.unit && formData.unit !== 'UNIT')}
            >
              <div className={`grid ${isHardwareStore || formData.presentationType === 'PACK' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                <div>
                  <label className="text-[12px] font-semibold text-slate-700 mb-1 block">Tipo de presentación</label>
                  <select value={formData.presentationType} onChange={e => setFormData({ ...formData, presentationType: e.target.value })} className={selectCls}>
                    <option value="UNIT">Unidad suelta</option>
                    <option value="PACK">Paquete (varias unidades)</option>
                  </select>
                </div>
                {isHardwareStore && (
                  <div>
                    <label className="text-[12px] font-semibold text-slate-700 mb-1 block">Unidad de medida</label>
                    <select value={formData.unit || 'UNIT'} onChange={e => setFormData({ ...formData, unit: e.target.value })} className={selectCls}>
                      <option value="UNIT">Unidad (un)</option>
                      <option value="MT">Metro (m) - Cables/Caños</option>
                      <option value="KG">Kilogramo (kg) - Clavos/Áridos</option>
                      <option value="L">Litro (L) - Pinturas/Solventes</option>
                      <option value="PACK">Pack / Rollo (pack)</option>
                    </select>
                  </div>
                )}
                {formData.presentationType === 'PACK' && (
                  <div className={isHardwareStore ? 'col-span-2' : ''}>
                    <label className="text-[12px] font-semibold text-slate-700 mb-1 block">Unidades por paquete</label>
                    <input
                      type="number"
                      min={1}
                      value={formData.unitsPerPack || ''}
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        setFormData({ ...formData, unitsPerPack: isNaN(val) ? '' as any : val });
                      }}
                      onFocus={e => e.target.select()}
                      className={inputCls}
                    />
                  </div>
                )}
                {isHardwareStore && ['MT', 'KG', 'L'].includes(formData.unit) && (
                  <div className="col-span-2">
                    <label className="text-[12px] font-semibold text-slate-700 mb-1 block">Tamaño de pieza madre (opcional)</label>
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
                      className={inputCls}
                    />
                    {Boolean(formData.pieceSize) && Number(formData.pieceSize) > 0 && (
                      <p className="text-[11.5px] font-semibold text-rose-700 mt-1">
                        Stock actual: {Math.floor((Number(formData.stock) || 0) / Number(formData.pieceSize))} pieza(s) completa(s)
                        {(() => {
                          const remainder = (Number(formData.stock) || 0) % Number(formData.pieceSize);
                          return remainder > 0.001 ? ` + ${parseFloat(remainder.toFixed(3))} ${formData.unit === 'MT' ? 'm' : formData.unit === 'KG' ? 'kg' : 'L'} sobrante` : '';
                        })()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Collapsible>

            <Collapsible
              icon={Barcode}
              title="Códigos alternativos"
              hint="Otros códigos de barras que identifican este producto"
              defaultOpen={formData.additionalBarcodes.length > 0}
              badge={formData.additionalBarcodes.length > 0 ? String(formData.additionalBarcodes.length) : undefined}
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBarcode}
                  onChange={e => setNewBarcode(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); handleAddBarcode(); } }}
                  placeholder="Escaneá otro código..."
                  className={inputCls}
                />
                <button type="button" onClick={handleAddBarcode} className="h-10 px-4 bg-rose-600 text-white rounded-lg text-[13px] font-semibold hover:bg-rose-700 transition-colors shrink-0">
                  Agregar
                </button>
              </div>
              {formData.additionalBarcodes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-[88px] overflow-y-auto custom-scrollbar">
                  {formData.additionalBarcodes.map(b => (
                    <span key={b} className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-md text-[11.5px] font-medium text-slate-700">
                      {b}
                      <button type="button" onClick={() => handleRemoveBarcode(b)} className="text-slate-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </Collapsible>

            {isHardwareStore && (
              <Collapsible
                icon={Package}
                title="Kit / combo armado"
                hint="Al venderlo descuenta el stock de sus piezas"
                defaultOpen={!!formData.isKit}
              >
                <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-800 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={formData.isKit}
                    onChange={e => setFormData({ ...formData, isKit: e.target.checked })}
                    className="w-4 h-4 accent-rose-600 cursor-pointer"
                  />
                  Este producto es un kit
                </label>
                {formData.isKit && (
                  <div className="space-y-2">
                    <div className="relative">
                      <select
                        className={selectCls}
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
                        <option value="">+ Agregar pieza al kit...</option>
                        {usePOSStore.getState().products.filter(p => p.id !== product?.id).map(p => (
                          <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 inset-y-0 my-auto w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                      {kitItems.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                          <span className="truncate flex-1 font-semibold text-slate-700">{item.name}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[11px] text-slate-400">Cant.</span>
                            <input
                              type="number"
                              min="0.1"
                              step="any"
                              value={item.quantity}
                              onChange={(e) => {
                                const qty = parseFloat(e.target.value) || 1;
                                setKitItems(kitItems.map((k, i) => i === idx ? { ...k, quantity: qty } : k));
                              }}
                              className="w-14 h-7 px-1.5 text-center font-bold border border-slate-300 rounded bg-white"
                            />
                            <button type="button" onClick={() => setKitItems(kitItems.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-500 p-1 cursor-pointer">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {kitItems.length === 0 && <p className="text-[12px] text-amber-700">Todavía no agregaste piezas al kit.</p>}
                    </div>
                  </div>
                )}
              </Collapsible>
            )}
          </FormSection>
          </div>
        </div>

        {/* Footer fijo */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/60 shrink-0 flex items-center justify-end gap-3">
          <button onClick={onClose} type="button" className="h-11 px-5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="h-11 px-8 min-w-[240px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm shadow-md shadow-rose-600/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEditing ? 'Guardar cambios' : 'Crear producto'}
            <kbd className="hidden sm:inline text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/15 border border-white/25 ml-1">Ctrl+Enter</kbd>
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
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { const wasSuggestion = activeLargeImage.isSuggestion; setActiveLargeImage(null); if (wasSuggestion) focusName(); }}>
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
                    focusName();
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
                    focusName();
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

      {showImagePicker && (
        <ImageSearchPicker
          initialQuery={formData.name || ''}
          onClose={() => setShowImagePicker(false)}
          onSelect={option => {
            // La URL se descarga y comprime al guardar el producto
            setFormData(prev => ({ ...prev, imageUrl: option.url }));
            setShowImagePicker(false);
          }}
        />
      )}
    </motion.div>
  );
}
