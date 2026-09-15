import { useState, useEffect, useRef } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Scan, 
  Plus, 
  History, 
  Trash2, 
  Save, 
  ChevronDown,
  CheckCircle2,
  Clock,
  Printer,
  FileText,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  DollarSign,
  Link as LinkIcon,
  X,
  FileSpreadsheet
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

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

interface PurchaseItem {
  productId: string;
  barcode: string;
  sku?: string;
  name: string;
  variant: string;
  unit: string;
  quantity: number;
  cost: number;
  total: number;
  buyFormat: string;
  unitsPerPack: number;
  presentationType: string;
  isNew?: boolean;
  margin?: number;
  salePrice?: number;
  categoryName?: string;
  brandName?: string;
  newProductData?: {
    name: string;
    barcode?: string;
    sku?: string;
    salePrice?: number;
    categoryId?: string | null;
    brandId?: string | null;
    unitsPerPack?: number;
    presentationType?: string;
  };
}

const calculateSuggestedPrice = (cost: number, margin: number, useIva: boolean = true) => {
  const baseCost = useIva ? cost * 1.21 : cost;
  const price = baseCost * (1 + margin / 100);
  return Math.round(price / 10) * 10;
};

const isExcelOrCsv = (file: File) => {
  const n = (file.name || '').toLowerCase();
  return n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv');
};

const FilePreview = ({ file }: { file: File }) => {
  const [src, setSrc] = useState<string>('');
  const isExcel = isExcelOrCsv(file);

  useEffect(() => {
    if (isExcel) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file, isExcel]);

  if (isExcel) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 p-1.5 text-center select-none">
        <FileSpreadsheet className="w-6 h-6 mb-1 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-[8px] font-bold truncate max-w-full text-slate-800 dark:text-slate-200" title={file.name}>
          {file.name}
        </span>
        <span className="text-[7px] font-black text-emerald-600 dark:text-emerald-400 uppercase">
          Excel / CSV
        </span>
      </div>
    );
  }

  if (!src) return null;

  return (
    <img 
      src={src} 
      alt="Preview" 
      className="w-full h-full object-cover" 
    />
  );
};

export default function NewPurchaseScreen({ onBack, initialPurchase }: { onBack: () => void, initialPurchase?: any }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);

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

  const [defaultMargin, setDefaultMargin] = useState<number>(() => {
    const saved = localStorage.getItem('purchase_default_margin');
    return saved ? parseInt(saved, 10) : 40;
  });



  // Load purchase draft from localStorage
  const draft = (() => {
    const saved = localStorage.getItem('purchase_draft');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return null;
  })();

  const [selectedSupplier, setSelectedSupplier] = useState<any>(draft?.selectedSupplier || null);
  const [supplierSearch, setSupplierSearch] = useState(draft?.supplierSearch || '');
  const [showSupplierResults, setShowSupplierResults] = useState(false);
  
  const [invoiceNumber, setInvoiceNumber] = useState(draft?.invoiceNumber || '');
  const [date, setDate] = useState(draft?.date || new Date().toISOString().split('T')[0]);
  
  const [items, setItems] = useState<PurchaseItem[]>(draft?.items || []);
  const [showScanModal, setShowScanModal] = useState(false);
  const [useIvaGlobal, setUseIvaGlobal] = useState<boolean>(() => localStorage.getItem('purchase_use_iva') !== 'false');

  useEffect(() => {
    if (initialPurchase) {
      setInvoiceNumber(initialPurchase.invoiceNumber || '');
      setDate(initialPurchase.date ? initialPurchase.date.split('T')[0] : new Date().toISOString().split('T')[0]);
      if (initialPurchase.supplier) {
        setSelectedSupplier(initialPurchase.supplier);
        setSupplierSearch(initialPurchase.supplier.name);
      }
      setPaymentStatus(initialPurchase.paymentStatus || 'PAID');
      setPaymentMethod(initialPurchase.paymentMethod || 'Efectivo');
      setNotes(initialPurchase.notes || '');
      
      const loadedItems = (initialPurchase.items || []).map((item: any) => {
        const cost = item.cost / 1.21;
        const total = item.total / 1.21;
        return {
          productId: item.productId,
          barcode: item.product?.barcode || '',
          sku: item.product?.sku || '',
          name: item.productName || item.product?.name || '',
          categoryName: item.product?.category?.name || '-',
          brandName: item.product?.brand?.name || '-',
          variant: '-',
          unit: item.product?.unit || 'UNIT',
          quantity: item.quantity,
          cost,
          total,
          buyFormat: item.buyFormat || 'UNIT',
          unitsPerPack: item.product?.unitsPerPack || 1,
          presentationType: item.product?.presentationType || 'UNIT',
          margin: item.product ? Math.round(((item.product.salePrice - (cost * 1.21)) / (cost * 1.21)) * 100) : 0,
          salePrice: item.product?.salePrice || 0
        };
      });
      setItems(loadedItems);
    }
  }, [initialPurchase]);

  useEffect(() => {
    localStorage.setItem('purchase_use_iva', useIvaGlobal.toString());
    setItems(prev => prev.map(item => {
      const c = parseFloat(item.cost as any) || 0;
      const m = item.margin !== undefined ? item.margin : defaultMargin;
      const suggested = calculateSuggestedPrice(c, m, useIvaGlobal);
      return {
        ...item,
        salePrice: suggested,
        newProductData: item.isNew ? {
          ...item.newProductData!,
          salePrice: suggested
        } : item.newProductData
      };
    }));
  }, [useIvaGlobal]);

  useEffect(() => {
    localStorage.setItem('purchase_default_margin', defaultMargin.toString());
    setItems(prev => prev.map(item => {
      if (item.isNew) {
        const costVal = parseFloat(item.cost as any) || 0;
        const suggested = calculateSuggestedPrice(costVal, defaultMargin, useIvaGlobal);
        return {
          ...item,
          margin: defaultMargin,
          salePrice: suggested,
          newProductData: {
            ...item.newProductData!,
            salePrice: suggested
          }
        };
      }
      return item;
    }));
  }, [defaultMargin, useIvaGlobal]);

  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'OWED'>(draft?.paymentStatus || 'PAID');
  const [paymentMethod, setPaymentMethod] = useState(draft?.paymentMethod || 'Efectivo');
  const [notes, setNotes] = useState(draft?.notes || '');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFixedAmount, setIsFixedAmount] = useState(false);
  const [fixedAmountTotal, setFixedAmountTotal] = useState<string>('');
  const productInputRef = useRef<HTMLInputElement>(null);
  const unmatchedSearchInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  const focusUnmatchedSearch = () => {
    setTimeout(() => {
      unmatchedSearchInputRef.current?.focus();
    }, 100);
  };

  const handleEditPendingNewProduct = (index: number, field: string, value: any) => {
    setPendingNewProducts(prev => {
      const updated = [...prev];
      const item = updated[index];

      if (field === 'presentationType') {
        const oldType = item.presentationType || 'UNIT';
        const newType = value;
        const upb = item.unitsPerPack || 1;
        if (oldType === 'UNIT' && newType === 'PACK') {
          // Convert to PACK: divide quantity by upb, multiply cost by upb
          const q = parseFloat(item.quantity) || 0;
          const c = parseFloat(item.cost) || 0;
          item.quantity = Math.max(1, Math.round(q / upb));
          item.cost = parseFloat((c * upb).toFixed(2));
        } else if (oldType === 'PACK' && newType === 'UNIT') {
          // Convert to UNIT: multiply quantity by upb, divide cost by upb
          const q = parseFloat(item.quantity) || 0;
          const c = parseFloat(item.cost) || 0;
          item.quantity = q * upb;
          item.cost = parseFloat((c / upb).toFixed(2));
        }
      }

      item[field] = value;

      if (field === 'quantity' || field === 'cost' || field === 'presentationType' || field === 'unitsPerPack') {
        const q = parseFloat(item.quantity) || 0;
        const c = parseFloat(item.cost) || 0;
        item.total = parseFloat((q * c).toFixed(2));
      }
      return updated;
    });
  };

  const handleDeletePendingNewProduct = (index: number) => {
    setPendingNewProducts(prev => prev.filter((_, idx) => idx !== index));
  };

  // AI Scanning States
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [showTotalPrompt, setShowTotalPrompt] = useState(false);
  const [manualTotalInput, setManualTotalInput] = useState('');
  const [selectedFilesForScan, setSelectedFilesForScan] = useState<File[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<any[]>(draft?.unmatchedItems || []);
  const [activeUnmatchedIndex, setActiveUnmatchedIndex] = useState<number | null>(draft?.activeUnmatchedIndex !== undefined ? draft.activeUnmatchedIndex : null);
  const [quickProductSearch, setQuickProductSearch] = useState('');
  const [quickProductResults, setQuickProductResults] = useState<any[]>([]);
  const [showNewProductsModal, setShowNewProductsModal] = useState(draft?.showNewProductsModal || false);
  const [pendingNewProducts, setPendingNewProducts] = useState<any[]>(draft?.pendingNewProducts || []);

  // Quick Create Modal States
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickCreateForm, setQuickCreateForm] = useState({
    name: '',
    barcode: '',
    costPrice: 0,
    salePrice: 0
  });
  const [useIvaForQuickCreate, setUseIvaForQuickCreate] = useState(true);

  useEffect(() => {
    loadSuppliers();
    loadCategories();
    loadBrands();
  }, []);

  useEffect(() => {
    if (showNewProductsModal && pendingNewProducts.length > 0) {
      setTimeout(() => {
        const firstInput = document.getElementById('modal-name-0') as HTMLInputElement | null;
        if (firstInput) {
          firstInput.focus();
          firstInput.select();
        }
      }, 200);
    }
  }, [showNewProductsModal, pendingNewProducts.length]);

  const clearDraft = () => {
    setSelectedSupplier(null);
    setSupplierSearch('');
    setInvoiceNumber('');
    setDate(new Date().toISOString().split('T')[0]);
    setItems([]);
    setPaymentStatus('PAID');
    setPaymentMethod('Efectivo');
    setNotes('');
    setUnmatchedItems([]);
    setActiveUnmatchedIndex(null);
    setShowNewProductsModal(false);
    setPendingNewProducts([]);
    localStorage.removeItem('purchase_draft');
  };

  useEffect(() => {
    const draftData = {
      selectedSupplier,
      supplierSearch,
      invoiceNumber,
      date,
      items,
      paymentStatus,
      paymentMethod,
      notes,
      unmatchedItems,
      activeUnmatchedIndex,
      showNewProductsModal,
      pendingNewProducts
    };
    localStorage.setItem('purchase_draft', JSON.stringify(draftData));
  }, [
    selectedSupplier,
    supplierSearch,
    invoiceNumber,
    date,
    items,
    paymentStatus,
    paymentMethod,
    notes,
    unmatchedItems,
    activeUnmatchedIndex,
    showNewProductsModal,
    pendingNewProducts
  ]);



  const searchProducts = async (query: string) => {
    setProductSearch(query);
    if (query.length < 2) {
      setProductResults([]);
      return;
    }
    try {
      const { data } = await api.get('/products', { params: { search: query } });
      setProductResults(data);
      // If query is an exact barcode match and only one result, add it
      if (data.length === 1 && data[0].barcode === query) {
        addItem(data[0]);
      }
    } catch {}
  };

  const searchUnmatchedProducts = async (query: string) => {
    setQuickProductSearch(query);
    if (query.length < 2) {
      setQuickProductResults([]);
      return;
    }
    try {
      const { data } = await api.get('/products', { params: { search: query } });
      setQuickProductResults(data);
    } catch {}
  };

  const handleQuickSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = quickProductSearch.trim();
      if (!code) return;

      try {
        const { data: existing } = await api.get(`/products/barcode/${code}`).catch(() => ({ data: null }));
        if (existing) {
          handleAssociateUnmatched(existing.id, activeUnmatchedIndex!);
          setQuickProductSearch('');
        } else {
          const unmatched = unmatchedItems[activeUnmatchedIndex!];
          setQuickCreateForm({
            name: unmatched.name.toUpperCase(),
            barcode: code,
            costPrice: unmatched.cost || 0,
            salePrice: calculateSuggestedPrice(unmatched.cost || 0, defaultMargin)
          });
          setShowQuickCreate(true);
          setQuickProductSearch('');
          setTimeout(() => {
            const barcodeInput = document.getElementById('quick-create-barcode') as HTMLInputElement | null;
            if (barcodeInput) {
              barcodeInput.focus();
              barcodeInput.select();
            }
          }, 150);
        }
      } catch (err) {
        const unmatched = unmatchedItems[activeUnmatchedIndex!];
        setQuickCreateForm({
          name: unmatched.name.toUpperCase(),
          barcode: code,
          costPrice: unmatched.cost || 0,
          salePrice: calculateSuggestedPrice(unmatched.cost || 0, defaultMargin)
        });
        setShowQuickCreate(true);
        setQuickProductSearch('');
        setTimeout(() => {
          const barcodeInput = document.getElementById('quick-create-barcode') as HTMLInputElement | null;
          if (barcodeInput) {
            barcodeInput.focus();
            barcodeInput.select();
          }
        }, 150);
      }
    }
  };

  const addItem = (product: any) => {
    const existing = items.find(i => i.productId === product.id);
    if (existing) {
      updateItem(product.id, 'quantity', existing.quantity + 1);
    } else {
      const initCostWithIva = product.costPrice || 0;
      const initCost = useIvaGlobal ? initCostWithIva / 1.21 : initCostWithIva;
      const initSale = product.salePrice || 0;
      const baseCost = useIvaGlobal ? initCost * 1.21 : initCost;
      const initMargin = baseCost > 0 ? Math.round(((initSale - baseCost) / baseCost) * 100) : 0;
      setItems([...items, {
        productId: product.id,
        barcode: product.barcode,
        sku: product.sku || '',
        name: product.name,
        categoryName: product.category?.name || '-',
        brandName: product.brand?.name || '-',
        variant: '-',
        unit: product.unit || 'UNIT',
        quantity: 1,
        cost: parseFloat(initCost.toFixed(2)),
        total: parseFloat(initCost.toFixed(2)),
        buyFormat: 'UNIT',
        unitsPerPack: product.unitsPerPack || 1,
        presentationType: product.presentationType || 'UNIT',
        margin: initMargin,
        salePrice: initSale,
      }]);
    }
    setProductSearch('');
    setProductResults([]);
    productInputRef.current?.focus();
  };

  const updateItem = (id: string, field: keyof PurchaseItem, value: any) => {
    setItems(items.map(item => {
      if (item.productId === id) {
        const updated = { ...item, [field]: value };
        if (updated.isNew && field === 'barcode') {
          updated.newProductData = {
            ...updated.newProductData!,
            barcode: value || null
          };
        }
        
        const q = parseFloat(updated.quantity as any) || 0;
        const c = parseFloat(updated.cost as any) || 0;
        updated.total = q * c;

        if (field === 'cost') {
          if (updated.isNew) {
            const currentMargin = updated.margin !== undefined ? updated.margin : defaultMargin;
            updated.salePrice = calculateSuggestedPrice(c, currentMargin, useIvaGlobal);
            updated.newProductData = {
              ...updated.newProductData!,
              salePrice: updated.salePrice
            };
          } else {
            const baseCost = useIvaGlobal ? c * 1.21 : c;
            updated.margin = baseCost > 0 ? Math.round(((updated.salePrice! - baseCost) / baseCost) * 100) : 0;
          }
        } else if (field === 'margin') {
          const m = parseFloat(value) || 0;
          updated.salePrice = calculateSuggestedPrice(c, m, useIvaGlobal);
          if (updated.isNew) {
            updated.newProductData = {
              ...updated.newProductData!,
              salePrice: updated.salePrice
            };
          }
        } else if (field === 'salePrice') {
          const s = parseFloat(value) || 0;
          const baseCost = useIvaGlobal ? c * 1.21 : c;
          updated.margin = baseCost > 0 ? Math.round(((s - baseCost) / baseCost) * 100) : 0;
          if (updated.isNew) {
            updated.newProductData = {
              ...updated.newProductData!,
              salePrice: s
            };
          }
        }

        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setItems(items.filter(i => i.productId !== id));
  };

  const calculateTotal = () => items.reduce((sum, item) => sum + item.total, 0);

  const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setSelectedFilesForScan(Array.from(files));
    setManualTotalInput('');
    setShowTotalPrompt(true);
    e.target.value = ''; // Reset input so it can be clicked again
  };

  const executeScanWithTotal = async (useManualTotal: boolean) => {
    if (!selectedFilesForScan || selectedFilesForScan.length === 0) return;
    setShowTotalPrompt(false);
    const hasExcel = selectedFilesForScan.some(isExcelOrCsv);
    setIsScanning(true);
    setScanProgress(hasExcel ? 25 : 5);
    setScanStep(hasExcel ? 'Cargando planilla Excel del proveedor...' : 'Subiendo imágenes a la IA...');

    // Start simulated progress bar interval (expected duration around 15-20s, slowing down as it goes)
    const progressInterval = setInterval(() => {
      setScanProgress(prev => {
        if (prev >= 95) {
          clearInterval(progressInterval);
          return 95;
        }
        // Slower increment as it approaches 95%
        const diff = Math.max(1, Math.round((100 - prev) / (hasExcel ? 6 : 15)));
        return prev + diff;
      });
    }, 400);

    const formData = new FormData();
    for (let i = 0; i < selectedFilesForScan.length; i++) {
      formData.append('files', selectedFilesForScan[i]);
    }

    if (useManualTotal && manualTotalInput.trim()) {
      formData.append('manualTotal', manualTotalInput.trim());
    }

    try {
      setScanStep(hasExcel ? 'Analizando planilla Excel y cruzando con inventario...' : 'La IA está analizando detalladamente los productos y totales...');
      const { data } = await api.post('/purchases/scan-invoice', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      clearInterval(progressInterval);
      setScanProgress(100);
      
      // Small pause to allow user to see 100%
      await new Promise(resolve => setTimeout(resolve, 600));

      setScanStep('Buscando coincidencias con tu inventario...');
      if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
      if (data.date) setDate(data.date);
      if (data.matchedSupplier) {
        setSelectedSupplier(data.matchedSupplier);
        setSupplierSearch(data.matchedSupplier.name);
      } else if (data.supplierName) {
        setSupplierSearch(data.supplierName);
      }

      const newItems: PurchaseItem[] = [];
      const unmatched: any[] = [];

      for (const item of data.items) {
        if (item.product) {
          newItems.push({
            productId: item.product.id,
            barcode: item.product.barcode || item.barcode || '',
            sku: item.product.sku || item.sku || '',
            name: item.name || item.product.name,
            categoryName: item.product.category?.name || '-',
            brandName: item.product.brand?.name || '-',
            variant: '-',
            unit: item.product.unit || 'UNIT',
            quantity: item.quantity,
            cost: item.cost,
            total: item.total,
            buyFormat: 'UNIT',
            unitsPerPack: item.product.unitsPerPack || 1,
            presentationType: item.product.presentationType || 'UNIT',
            margin: item.cost > 0 ? Math.round(((item.product.salePrice - (item.cost * 1.21)) / (item.cost * 1.21)) * 100) : 0,
            salePrice: item.product.salePrice
          });
        } else {
          unmatched.push(item);
        }
      }

      if (newItems.length > 0) {
        setItems(prev => {
          const filtered = prev.filter(p => !newItems.some(n => n.productId === p.productId));
          return [...filtered, ...newItems];
        });
      }

      if (unmatched.length > 0) {
        setPendingNewProducts(unmatched);
        setShowNewProductsModal(true);
        toast.success(`Escaneo completado. Borrador #${data.purchaseId.substring(0, 8).toUpperCase()} guardado. ${newItems.length} productos vinculados, ${unmatched.length} nuevos detectados.`);
      } else {
        toast.success(`¡Boleta procesada con éxito! Borrador #${data.purchaseId.substring(0, 8).toUpperCase()} guardado en el sistema.`);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      toast.error(err.response?.data?.message || err.message || 'Error al escanear la boleta');
    } finally {
      setIsScanning(false);
      setScanStep('');
      setScanProgress(0);
      setSelectedFilesForScan([]);
    }
  };

  const handleAssociateUnmatched = async (productId: string, idx: number) => {
    const unmatched = unmatchedItems[idx];
    try {
      const codeToSave = unmatched.barcode || unmatched.sku;
      if (codeToSave) {
        // Associate barcode to existing product
        await api.patch(`/products/${productId}`, { barcode: codeToSave });
        toast.success('Código de barras guardado en el producto');
      }

      const { data: product } = await api.get(`/products/${productId}`);

      const newPurchaseItem: PurchaseItem = {
        productId: product.id,
        barcode: product.barcode || unmatched.barcode || unmatched.sku || '',
        sku: product.sku || unmatched.sku || '',
        name: product.name,
        categoryName: product.category?.name || '-',
        brandName: product.brand?.name || '-',
        variant: '-',
        unit: product.unit || 'UNIT',
        quantity: unmatched.quantity,
        cost: unmatched.cost,
        total: unmatched.total,
        buyFormat: product.unitsPerPack > 1 ? 'PACK' : 'UNIT',
        unitsPerPack: product.unitsPerPack || 1,
        presentationType: product.presentationType || 'UNIT',
        margin: unmatched.cost > 0 ? Math.round(((product.salePrice - (unmatched.cost * 1.21)) / (unmatched.cost * 1.21)) * 100) : 0,
        salePrice: product.salePrice
      };

      setItems(prev => {
        const filtered = prev.filter(p => p.productId !== product.id);
        return [...filtered, newPurchaseItem];
      });

      const nextUnmatched = unmatchedItems.filter((_, i) => i !== idx);
      setUnmatchedItems(nextUnmatched);
      setQuickProductSearch('');
      setQuickProductResults([]);
      
      if (nextUnmatched.length > 0) {
        setActiveUnmatchedIndex(0);
        focusUnmatchedSearch();
      } else {
        setActiveUnmatchedIndex(null);
      }
      toast.success('Producto asociado correctamente');
    } catch (err: any) {
      toast.error('Error al asociar el producto');
    }
  };

  const openQuickCreate = (idx: number | null) => {
    if (idx !== null && idx >= 0) {
      const unmatched = unmatchedItems[idx];
      setQuickCreateForm({
        name: unmatched.name.toUpperCase(),
        barcode: unmatched.barcode || '',
        costPrice: unmatched.cost || 0,
        salePrice: calculateSuggestedPrice(unmatched.cost || 0, defaultMargin)
      });
      setActiveUnmatchedIndex(idx);
    } else {
      setQuickCreateForm({
        name: productSearch.toUpperCase(),
        barcode: '',
        costPrice: 0,
        salePrice: 0
      });
      setActiveUnmatchedIndex(null);
    }
    setShowQuickCreate(true);
    setTimeout(() => {
      const barcodeInput = document.getElementById('quick-create-barcode') as HTMLInputElement | null;
      if (barcodeInput) {
        barcodeInput.focus();
        barcodeInput.select();
      }
    }, 150);
  };

  const handleSaveQuickCreate = async (e: React.FormEvent, idx: number | null) => {
    e.preventDefault();
    const unmatched = idx !== null && idx >= 0 ? unmatchedItems[idx] : null;
    try {
      const baseCost = quickCreateForm.costPrice;
      const finalCost = useIvaForQuickCreate ? baseCost * 1.21 : baseCost;

      const { data: product } = await api.post('/products', {
        ...quickCreateForm,
        costPrice: finalCost,
        sku: unmatched ? unmatched.sku || null : null,
        stock: 0,
        minStock: 0,
        unit: 'UNIT',
        presentationType: unmatched && unmatched.unitsPerPack > 1 ? 'PACK' : 'UNIT',
        unitsPerPack: unmatched ? unmatched.unitsPerPack || 1 : 1,
        isActive: true
      });

      const newPurchaseItem: PurchaseItem = {
        productId: product.id,
        barcode: product.barcode || (unmatched ? unmatched.barcode || unmatched.sku || '' : ''),
        sku: product.sku || (unmatched ? unmatched.sku || '' : ''),
        name: product.name,
        categoryName: product.category?.name || '-',
        brandName: product.brand?.name || '-',
        variant: '-',
        unit: product.unit || 'UNIT',
        quantity: unmatched ? unmatched.quantity : 1,
        cost: unmatched ? unmatched.cost : baseCost,
        total: unmatched ? unmatched.total : baseCost,
        buyFormat: product.unitsPerPack > 1 ? 'PACK' : 'UNIT',
        unitsPerPack: product.unitsPerPack || 1,
        presentationType: product.presentationType || 'UNIT',
        margin: (unmatched ? unmatched.cost : baseCost) > 0 ? Math.round(((product.salePrice - finalCost) / finalCost) * 100) : 0,
        salePrice: product.salePrice
      };

      setItems(prev => {
        const filtered = prev.filter(p => p.productId !== product.id);
        return [...filtered, newPurchaseItem];
      });

      if (unmatched && idx !== null) {
        const nextUnmatched = unmatchedItems.filter((_, i) => i !== idx);
        setUnmatchedItems(nextUnmatched);
        if (nextUnmatched.length > 0) {
          setActiveUnmatchedIndex(0);
          focusUnmatchedSearch();
        } else {
          setActiveUnmatchedIndex(null);
        }
      }

      setShowQuickCreate(false);
      setProductSearch('');
      setProductResults([]);
      toast.success('Producto creado y agregado a la lista');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al crear producto');
    }
  };

  const handleSubmit = async () => {
    if (!selectedSupplier) return toast.error('Selecciona un proveedor');
    
    if (isFixedAmount) {
      const parsedTotal = parseFloat(fixedAmountTotal);
      if (isNaN(parsedTotal) || parsedTotal <= 0) {
        return toast.error('Ingresa un monto fijo válido mayor a 0');
      }
      setIsSubmitting(true);
      try {
        const url = initialPurchase ? `/purchases/${initialPurchase.id}/confirm` : '/purchases';
        const method = initialPurchase ? 'put' : 'post';
        await api[method](url, {
          supplierId: selectedSupplier.id,
          invoiceNumber,
          manualTotal: parsedTotal,
          items: [],
          paymentStatus,
          paymentMethod: paymentStatus === 'PAID' ? paymentMethod : null,
          notes
        });
        toast.success('Compra registrada con éxito');
        clearDraft();
        onBack();
      } catch (err) {
        toast.error('Error al registrar compra');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (items.length === 0) return toast.error('Agrega al menos un producto');

    setIsSubmitting(true);
    try {
      const url = initialPurchase ? `/purchases/${initialPurchase.id}/confirm` : '/purchases';
      const method = initialPurchase ? 'put' : 'post';
      await api[method](url, {
        supplierId: selectedSupplier.id,
        invoiceNumber,
        items: items.map(i => {
          const costVal = parseFloat(i.cost as any) || 0;
          // Scale cost down if useIvaGlobal is false since the backend will automatically multiply it by 1.21
          const backendCost = useIvaGlobal ? costVal : costVal / 1.21;
          return { 
            productId: i.isNew ? undefined : i.productId, 
            quantity: parseFloat(i.quantity as any) || 0, 
            cost: backendCost, 
            buyFormat: i.buyFormat,
            newProductData: i.isNew ? {
              name: i.name,
              barcode: i.barcode || null,
              sku: i.sku || null,
              salePrice: i.newProductData?.salePrice || calculateSuggestedPrice(i.cost, defaultMargin, useIvaGlobal),
              categoryId: i.newProductData?.categoryId || null,
              brandId: i.newProductData?.brandId || null,
              unitsPerPack: i.unitsPerPack || 1,
              presentationType: i.presentationType || 'UNIT'
            } : undefined
          };
        }),
        paymentStatus,
        paymentMethod: paymentStatus === 'PAID' ? paymentMethod : null,
        notes
      });
      toast.success('Compra registrada con éxito');
      clearDraft();
      onBack();
    } catch (err) {
      toast.error('Error al registrar compra');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="h-full flex flex-col gap-4 bg-slate-50/30 p-2 overflow-hidden"
    >
      {/* Modal para selección de fotos / cámara */}
      <AnimatePresence>
        {showScanModal && (
          <div className="fixed inset-0 z-[150] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[85vh]"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-rose-500" /> Cargar Boleta (Fotos con IA o Planilla Excel)
                </h3>
                <button 
                  onClick={() => {
                    setShowScanModal(false);
                    setSelectedFilesForScan([]);
                  }} 
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Thumbnails of selected photos */}
              <div className="flex-1 overflow-y-auto min-h-[120px] max-h-[40vh] border-2 border-dashed border-slate-300 dark:border-slate-750 rounded-2xl p-4 mb-4 flex flex-wrap gap-3 items-center justify-center bg-slate-50/55 dark:bg-slate-950/30">
                {selectedFilesForScan.length === 0 ? (
                  <div className="text-center text-slate-400 p-6">
                    <p className="text-xs font-bold uppercase tracking-wider mb-1">No hay archivos seleccionados</p>
                    <p className="text-[10px]">Agrega fotos usando la cámara o sube directamente un archivo Excel / CSV del proveedor.</p>
                  </div>
                ) : (
                  selectedFilesForScan.map((file, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-350 bg-white shadow-sm shrink-0">
                      <FilePreview file={file} />
                      <button 
                        onClick={() => setSelectedFilesForScan(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 p-1 bg-rose-600 text-white rounded-full hover:bg-rose-750 shadow-sm"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Options to add photos / files */}
              <div className="grid grid-cols-3 gap-2.5 mb-6">
                {/* Camera Button */}
                <button 
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 border border-slate-300 dark:border-slate-700 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all active:scale-[0.98]"
                >
                  <Scan className="w-5 h-5 text-rose-500" />
                  <span className="text-[9px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider text-center leading-tight">Cámara</span>
                </button>
                <input 
                  ref={cameraInputRef}
                  type="file" 
                  accept="image/*" 
                  capture="environment" 
                  className="hidden" 
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      setSelectedFilesForScan(prev => [...prev, files[0]]);
                    }
                    e.target.value = '';
                  }}
                />

                {/* Gallery Button */}
                <button 
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 border border-slate-350 dark:border-slate-700 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-all active:scale-[0.98]"
                >
                  <Plus className="w-5 h-5 text-rose-500" />
                  <span className="text-[9px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider text-center leading-tight">Fotos / Galería</span>
                </button>
                <input 
                  ref={galleryInputRef}
                  type="file" 
                  accept="image/*, .xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/csv" 
                  multiple 
                  className="hidden" 
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      setSelectedFilesForScan(prev => [...prev, ...Array.from(files)]);
                    }
                    e.target.value = '';
                  }}
                />

                {/* Excel Button */}
                <button 
                  type="button"
                  onClick={() => excelInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 rounded-2xl cursor-pointer transition-all active:scale-[0.98] relative"
                >
                  <span className="absolute -top-2 right-1 px-1.5 py-0.5 bg-emerald-600 text-white rounded-full text-[7px] font-black uppercase tracking-wider shadow-xs">
                    Gratis
                  </span>
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[9px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider text-center leading-tight">Planilla Excel</span>
                </button>
                <input 
                  ref={excelInputRef}
                  type="file" 
                  accept=".xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/csv" 
                  className="hidden" 
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      setSelectedFilesForScan(prev => [...prev, files[0]]);
                    }
                    e.target.value = '';
                  }}
                />
              </div>

              {/* Footer actions */}
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    setShowScanModal(false);
                    setSelectedFilesForScan([]);
                  }}
                  className="flex-1 py-3 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button 
                  disabled={selectedFilesForScan.length === 0}
                  onClick={() => {
                    setShowScanModal(false);
                    setManualTotalInput('');
                    setShowTotalPrompt(true);
                  }}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-750 text-white font-bold text-xs rounded-xl disabled:opacity-50 transition-all shadow-md cursor-pointer"
                >
                  Continuar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Loading overlay for scanning */}
      <AnimatePresence>
        {isScanning && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[200] flex flex-col items-center justify-center p-6 text-white text-center"
          >
            <div className="bg-slate-800 p-8 rounded-3xl border border-slate-700/80 shadow-2xl flex flex-col items-center w-full max-w-md">
              <RefreshCw className="w-12 h-12 text-rose-400 animate-spin mb-4 keep-animated" />
              <h3 className="text-base font-bold text-slate-100 mb-2">
                {selectedFilesForScan.some(isExcelOrCsv) ? 'Procesando Planilla Excel' : 'Escaneando Boleta con IA'}
              </h3>
              <p className="text-xs font-semibold text-slate-350 mb-4">{scanStep}</p>
              
              {/* Progress Bar */}
              <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden mb-2">
                <div 
                  className="bg-rose-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${scanProgress}%` }}
                />
              </div>
              <span className="text-[10px] font-bold text-slate-600 tracking-wider uppercase">{scanProgress}% Completado</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
         <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
               <button onClick={onBack} className="p-2 hover:bg-white rounded-xl transition-colors"><ArrowLeft className="w-5 h-5" /></button>
               <h2 className="text-lg font-bold text-slate-800 tracking-tight">Registrar Compra</h2>
            </div>
            
            {/* Monto Fijo Toggle Switch */}
            <div className="flex items-center gap-2.5 bg-slate-100/80 px-4 py-2 rounded-xl border border-slate-400/50">
               <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider select-none">Monto Fijo (Sin productos)</span>
               <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={isFixedAmount} 
                    onChange={e => {
                      setIsFixedAmount(e.target.checked);
                      if (e.target.checked) {
                        setFixedAmountTotal('');
                      }
                    }} 
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600"></div>
               </label>
            </div>
         </div>
         
         {!isFixedAmount && (
           <button 
             onClick={() => setShowScanModal(true)}
             className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-600 to-rose-700 hover:scale-[1.02] active:scale-[0.98] text-white rounded-xl text-[10px] font-extrabold uppercase tracking-widest cursor-pointer shadow-md shadow-rose-150 transition-all select-none border border-rose-500"
           >
              <Sparkles className="w-4 h-4" /> Escanear con IA
           </button>
         )}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-4">
         {/* Top Info Bar */}
         <div className="card p-6 grid grid-cols-12 gap-6 items-end">
            <div className="col-span-4 relative">
               <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2 block ml-1">Proveedor</span>
                <div className="relative flex items-center">
                   <Search className="absolute left-4 w-4 h-4 text-slate-300 pointer-events-none" />
                  <input 
                    type="text" 
                    value={selectedSupplier ? selectedSupplier.name : supplierSearch}
                    onChange={(e) => {
                      setSupplierSearch(e.target.value);
                      setShowSupplierResults(true);
                      if (selectedSupplier) setSelectedSupplier(null);
                    }}
                    onFocus={() => setShowSupplierResults(true)}
                    placeholder="Buscar proveedor..."
                    className="w-full bg-slate-50 border-2 border-slate-300 rounded-2xl pl-11 pr-4 py-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-rose-500/50 outline-none transition-all"
                  />
                  {showSupplierResults && !selectedSupplier && (
                    <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-2xl shadow-xl border border-slate-300 z-50 overflow-hidden max-h-48 overflow-y-auto">
                       {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).length > 0 ? (
                         suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).map(s => (
                           <button key={s.id} onClick={() => { setSelectedSupplier(s); setShowSupplierResults(false); setSupplierSearch(s.name); }} className="w-full text-left px-5 py-3 hover:bg-slate-50 text-sm font-bold border-b border-slate-50 last:border-0">{s.name}</button>
                         ))
                       ) : (
                         <div className="px-5 py-3 text-xs text-slate-600 font-bold italic">No se encontraron proveedores...</div>
                       )}
                    </div>
                  )}
               </div>
            </div>
             {!isFixedAmount && (
               <>
                 <div className="col-span-2 flex flex-col justify-end pb-1 h-full">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3.5 block ml-1 select-none">Calcular IVA (21%)</span>
                    <label className="relative inline-flex items-center cursor-pointer select-none ml-1">
                      <input 
                        type="checkbox" 
                        checked={useIvaGlobal} 
                        onChange={e => setUseIvaGlobal(e.target.checked)} 
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                      <span className="ml-2.5 text-xs font-extrabold text-slate-700 uppercase tracking-wider">{useIvaGlobal ? 'Sí' : 'No'}</span>
                    </label>
                 </div>
                 <div className="col-span-2">
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2 block ml-1">Margen Ganancia (%)</span>
                    <input 
                      type="number" 
                      value={defaultMargin} 
                      onChange={e => setDefaultMargin(parseInt(e.target.value) || 0)} 
                      className="w-full bg-slate-50 border-2 border-slate-300 rounded-2xl px-5 py-3 text-sm font-bold outline-none focus:bg-white focus:border-rose-500/50 transition-all text-center" 
                    />
                 </div>
               </>
             )}
             <div className={isFixedAmount ? "col-span-4" : "col-span-2"}>
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2 block ml-1">Fecha</span>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-300 rounded-2xl px-5 py-3 text-sm font-bold outline-none" />
             </div>
             <div className={isFixedAmount ? "col-span-4" : "col-span-2"}>
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2 block ml-1">N° Comprobante (opc.)</span>
                <div className="relative">
                   <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                   <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="FA 0001-00001234" className="w-full bg-slate-50 border-2 border-slate-300 rounded-2xl pl-11 pr-4 py-3 text-sm font-bold outline-none" />
                </div>
             </div>
          </div>

          {!isFixedAmount ? (
            <>
              {/* Scanner Active Bar */}
              <div className="bg-[#f0fdf4] border border-emerald-100 px-6 py-3 rounded-2xl flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <Scan className="w-4 h-4 text-emerald-500" />
            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Escáner activo — Escaneá productos para agregarlos</p>
         </div>

         {/* Unmatched Items Card */}
         {unmatchedItems.length > 0 && activeUnmatchedIndex !== null && unmatchedItems[activeUnmatchedIndex] && (
           <div className="bg-amber-50/50 border border-amber-250 rounded-2xl p-6 shadow-sm space-y-4">
             <div className="flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <AlertTriangle className="w-5 h-5 text-amber-500" />
                 <div>
                   <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider">Productos no reconocidos por el sistema ({unmatchedItems.length} restantes)</h3>
                   <p className="text-[10px] font-bold text-amber-600/85 uppercase tracking-wide mt-0.5">Asocia el producto a uno existente en tu inventario o regístralo como nuevo</p>
                 </div>
               </div>
               <button 
                 onClick={() => {
                   setUnmatchedItems([]);
                   setActiveUnmatchedIndex(null);
                 }}
                 className="text-[10px] font-extrabold text-amber-700 hover:text-amber-900 uppercase tracking-widest cursor-pointer"
               >
                 Ignorar todos
               </button>
             </div>

             <div className="bg-white rounded-xl border border-amber-100 p-4 flex flex-col md:flex-row gap-6 items-stretch md:items-center justify-between">
               <div className="space-y-1.5">
                 <div className="flex items-center gap-2">
                   <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[9px] font-bold uppercase">Escaneado</span>
                   {(unmatchedItems[activeUnmatchedIndex].barcode || unmatchedItems[activeUnmatchedIndex].sku) && (
                     <span className="text-[10px] font-bold text-slate-450">SKU: {unmatchedItems[activeUnmatchedIndex].barcode || unmatchedItems[activeUnmatchedIndex].sku}</span>
                   )}
                 </div>
                 <h4 className="text-sm font-extrabold text-slate-800 uppercase">{unmatchedItems[activeUnmatchedIndex].name}</h4>
                 <div className="flex items-center gap-4 text-xs font-bold text-slate-700">
                   <span>Cantidad: {unmatchedItems[activeUnmatchedIndex].quantity} u.</span>
                   <span>Costo unitario: $ {unmatchedItems[activeUnmatchedIndex].cost}</span>
                   <span className="text-amber-600 font-extrabold">Total: $ {unmatchedItems[activeUnmatchedIndex].total}</span>
                 </div>
               </div>

               <div className="flex flex-col sm:flex-row gap-3 items-stretch md:items-center shrink-0">
                 {/* Option 1: Quick Search & Associate */}
                 <div className="relative w-full sm:w-64">
                   <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                   <input 
                     type="text"
                     ref={unmatchedSearchInputRef}
                     value={quickProductSearch}
                     onChange={e => searchUnmatchedProducts(e.target.value)}
                     onKeyDown={handleQuickSearchKeyDown}
                     placeholder="Buscar en el sistema para asociar..."
                     className="w-full bg-slate-50 border border-slate-400 rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold outline-none focus:bg-white focus:border-amber-500 transition-all"
                   />
                   {quickProductResults.length > 0 && (
                     <div className="absolute top-full left-0 w-full mt-1.5 bg-white rounded-xl shadow-xl border border-slate-300 z-[100] overflow-hidden max-h-48 overflow-y-auto">
                       {quickProductResults.map(p => (
                         <button 
                           key={p.id}
                           type="button"
                           onClick={() => handleAssociateUnmatched(p.id, activeUnmatchedIndex)}
                           className="w-full text-left px-4 py-3 hover:bg-slate-50 text-[11px] font-bold flex items-center justify-between"
                         >
                           <div>
                             <p className="text-slate-800 uppercase leading-none font-extrabold">{p.name}</p>
                             <p className="text-[9px] text-slate-600 font-bold mt-0.5">{p.barcode || 'Sin código'}</p>
                           </div>
                           <LinkIcon className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                         </button>
                       ))}
                     </div>
                   )}
                 </div>

                 {/* Option 2: Quick Create */}
                 <button 
                   type="button"
                   onClick={() => openQuickCreate(activeUnmatchedIndex)}
                   className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-extrabold uppercase tracking-widest flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer border-0"
                 >
                   <Plus className="w-4 h-4" /> Crear Nuevo
                 </button>

                 {/* Option 3: Ignore */}
                 <button 
                   type="button"
                   onClick={() => {
                     const next = unmatchedItems.filter((_, idx) => idx !== activeUnmatchedIndex);
                     setUnmatchedItems(next);
                     if (next.length > 0) {
                       setActiveUnmatchedIndex(0);
                       focusUnmatchedSearch();
                     } else {
                       setActiveUnmatchedIndex(null);
                     }
                   }}
                   className="px-4 py-2.5 rounded-xl text-[10px] font-extrabold text-slate-600 hover:text-slate-650 uppercase tracking-widest hover:bg-slate-100 transition-all cursor-pointer border-0"
                 >
                   Ignorar
                 </button>
               </div>
             </div>
           </div>
         )}

         {/* Quick Create Modal */}
         <AnimatePresence>
           {showQuickCreate && (
             <div className="fixed inset-0 z-[210] flex items-center justify-center p-6">
               <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowQuickCreate(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
               <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-400 overflow-hidden">
                 <div className="px-6 py-4 border-b border-slate-50 bg-amber-50/20 flex items-center justify-between">
                   <div className="flex items-center gap-2.5">
                     <Sparkles className="w-4.5 h-4.5 text-amber-500" />
                     <h3 className="text-sm font-bold text-slate-800">
                        {activeUnmatchedIndex !== null ? 'Registrar Producto de Boleta' : 'Crear Nuevo Producto'}
                     </h3>
                   </div>
                   <button type="button" onClick={() => setShowQuickCreate(false)} className="text-slate-600 hover:text-slate-700 text-xl font-bold">×</button>
                 </div>
                 <form onSubmit={e => handleSaveQuickCreate(e, activeUnmatchedIndex)} className="p-6 space-y-4">
                   <div>
                     <label className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Nombre del Producto</label>
                     <input 
                       type="text" 
                       required 
                       value={quickCreateForm.name} 
                       onChange={e => setQuickCreateForm({...quickCreateForm, name: e.target.value})} 
                       className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:bg-white focus:border-amber-500 uppercase transition-all" 
                     />
                   </div>
                   <div className="grid grid-cols-2 gap-3">
                     <div>
                       <label className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Código de Barras</label>
                       <input 
                         type="text" 
                         id="quick-create-barcode"
                         onFocus={e => e.target.select()}
                         value={quickCreateForm.barcode} 
                         onChange={e => setQuickCreateForm({...quickCreateForm, barcode: e.target.value})} 
                         onKeyDown={e => {
                           if (e.key === 'Enter') {
                             e.preventDefault();
                             const costInput = document.getElementById('quick-create-cost') as HTMLInputElement | null;
                             if (costInput) {
                               costInput.focus();
                               costInput.select();
                             }
                           }
                         }}
                         className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:bg-white focus:border-amber-500 transition-all" 
                       />
                     </div>
                     <div>
                       <label className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5 font-bold">Costo Unitario ($)</label>
                       <input 
                         type="number" 
                         required 
                         step="any"
                         id="quick-create-cost"
                         onFocus={e => e.target.select()}
                         value={quickCreateForm.costPrice} 
                         onChange={e => setQuickCreateForm({...quickCreateForm, costPrice: parseFloat(e.target.value) || 0})} 
                         onKeyDown={e => {
                           if (e.key === 'Enter') {
                             e.preventDefault();
                             const saleInput = document.getElementById('quick-create-sale-price') as HTMLInputElement | null;
                             if (saleInput) {
                               saleInput.focus();
                               saleInput.select();
                             }
                           }
                         }}
                         className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:bg-white focus:border-amber-500 transition-all" 
                       />
                     </div>
                   </div>
                   {/* IVA Toggle */}
                   <div className="flex items-center gap-2 px-1">
                     <input 
                       type="checkbox" 
                       id="quick-create-iva-toggle"
                       checked={useIvaForQuickCreate}
                       onChange={e => setUseIvaForQuickCreate(e.target.checked)}
                       className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4 cursor-pointer"
                     />
                     <label htmlFor="quick-create-iva-toggle" className="text-[10px] font-extrabold text-slate-700 cursor-pointer select-none">
                       Sumar IVA (21%) al costo del producto
                     </label>
                   </div>
                   <div>
                     <label className="text-[9px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5 text-emerald-600 font-extrabold">Precio de Venta Sugerido ($)</label>
                     <input 
                       type="number" 
                       required 
                       step="any"
                       id="quick-create-sale-price"
                       onFocus={e => e.target.select()}
                       value={quickCreateForm.salePrice} 
                       onChange={e => setQuickCreateForm({...quickCreateForm, salePrice: parseFloat(e.target.value) || 0})} 
                       className="w-full bg-emerald-50/30 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm font-extrabold outline-none focus:bg-white focus:border-emerald-500 transition-all text-emerald-700" 
                     />
                   </div>
                   <div className="flex justify-end gap-3 pt-3">
                     <button type="button" onClick={() => setShowQuickCreate(false)} className="px-5 py-2.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider">Cancelar</button>
                     <button id="quick-create-submit-btn" type="submit" className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[10px] font-extrabold uppercase tracking-wider shadow-md transition-all border-0 focus:ring-2 focus:ring-emerald-300 outline-none">Crear e Insertar</button>
                   </div>
                 </form>
               </motion.div>
             </div>
           )}
         </AnimatePresence>

          {/* Unrecognized Products Warning Modal */}
          <AnimatePresence>
            {showNewProductsModal && pendingNewProducts.length > 0 && (
              <div className="fixed inset-0 z-[210] flex items-center justify-center p-6">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowNewProductsModal(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-white w-full max-w-[95vw] rounded-2xl shadow-xl border border-slate-205 overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="px-6 py-4 border-b border-slate-50 bg-amber-50/20 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-amber-500" />
                      <h3 className="text-sm font-bold text-slate-800">Productos Nuevos Detectados</h3>
                    </div>
                    <button type="button" onClick={() => setShowNewProductsModal(false)} className="text-slate-600 hover:text-slate-700 text-xl font-bold">×</button>
                  </div>
                  <div className="p-6 overflow-y-auto space-y-4 flex-1">
                    <p className="text-xs text-slate-700 font-medium leading-relaxed">
                      Se detectaron <strong className="text-slate-800">{pendingNewProducts.length} productos nuevos</strong> en el escaneo que no coinciden con tu catálogo actual. Puedes editarlos o eliminarlos de la lista antes de agregarlos.
                    </p>
                    
                    <div className="border border-slate-300 rounded-xl overflow-hidden bg-slate-50/30 overflow-x-auto custom-scrollbar">
                      <table className="w-full text-left border-collapse min-w-[1100px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-300">
                            <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest min-w-[280px]">Descripción / Nombre</th>
                            <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest min-w-[140px]">SKU</th>
                            <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest w-44">Código de Barras (EAN)</th>
                            <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest w-32">Presentación</th>
                            <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center w-24">Cantidad</th>
                            <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center w-28">Costo ($)</th>
                            <th className="px-4 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-right w-24">Total</th>
                            <th className="px-4 py-3 text-center w-12"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {pendingNewProducts.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/30 transition-colors">
                              <td className="px-4 py-2">
                                <input 
                                  type="text" 
                                  id={`modal-name-${idx}`}
                                  value={item.name} 
                                  autoFocus={idx === 0}
                                  onFocus={e => e.target.select()}
                                  onChange={e => handleEditPendingNewProduct(idx, 'name', e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const next = document.getElementById(`modal-sku-${idx}`) as HTMLInputElement | null;
                                      if (next) {
                                        next.focus();
                                        next.select();
                                      }
                                    }
                                  }}
                                  className="w-full bg-slate-50 border border-slate-400 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:bg-white focus:border-amber-500 uppercase transition-all"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input 
                                  type="text" 
                                  id={`modal-sku-${idx}`}
                                  value={item.sku || ''} 
                                  placeholder="Sin SKU"
                                  onFocus={e => e.target.select()}
                                  onChange={e => handleEditPendingNewProduct(idx, 'sku', e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const next = document.getElementById(`modal-barcode-${idx}`) as HTMLInputElement | null;
                                      if (next) {
                                        next.focus();
                                        next.select();
                                      }
                                    }
                                  }}
                                  className="w-full bg-slate-50 border border-slate-400 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:bg-white focus:border-amber-500 uppercase transition-all"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input 
                                  type="text" 
                                  id={`modal-barcode-${idx}`}
                                  value={item.barcode || ''} 
                                  placeholder="Escanear o escribir..."
                                  onFocus={e => e.target.select()}
                                  onChange={e => handleEditPendingNewProduct(idx, 'barcode', e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const next = document.getElementById(`modal-pres-${idx}`) as HTMLSelectElement | null;
                                      if (next) {
                                        next.focus();
                                      }
                                    }
                                  }}
                                  className="w-full bg-slate-50 border border-slate-400 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:bg-white focus:border-amber-500 transition-all"
                                />
                              </td>
                              <td className="px-4 py-2">
                                  <select
                                    value={item.presentationType || 'UNIT'}
                                    onChange={e => handleEditPendingNewProduct(idx, 'presentationType', e.target.value)}
                                    id={`modal-pres-${idx}`}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        const qtyInput = document.getElementById(`modal-qty-${idx}`) as HTMLInputElement | null;
                                        if (qtyInput) {
                                          qtyInput.focus();
                                          qtyInput.select();
                                        }
                                      }
                                    }}
                                    className="bg-slate-50 border border-slate-400 rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase text-slate-605 outline-none cursor-pointer focus:bg-white focus:border-amber-500"
                                  >
                                    <option value="UNIT">Unidad</option>
                                    <option value="PACK">Paquete</option>
                                  </select>
                              </td>
                              <td className="px-4 py-2">
                                <input 
                                  type="number" 
                                  step="any"
                                  id={`modal-qty-${idx}`}
                                  value={item.quantity} 
                                  onFocus={e => e.target.select()}
                                  onChange={e => handleEditPendingNewProduct(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const next = document.getElementById(`modal-cost-${idx}`) as HTMLInputElement | null;
                                      if (next) {
                                        next.focus();
                                        next.select();
                                      }
                                    }
                                  }}
                                  className="w-full bg-slate-50 border border-slate-400 rounded-lg px-2.5 py-1.5 text-xs font-bold text-center outline-none focus:bg-white focus:border-amber-500 transition-all"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input 
                                  type="number" 
                                  step="any"
                                  id={`modal-cost-${idx}`}
                                  value={item.cost} 
                                  onFocus={e => e.target.select()}
                                  onChange={e => handleEditPendingNewProduct(idx, 'cost', parseFloat(e.target.value) || 0)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const nextInput = document.getElementById(`modal-name-${idx + 1}`) as HTMLInputElement | null;
                                      if (nextInput) {
                                        nextInput.focus();
                                        nextInput.select();
                                      } else {
                                        document.getElementById('bulk-submit-btn')?.focus();
                                      }
                                    }
                                  }}
                                  className="w-full bg-slate-50 border border-slate-400 rounded-lg px-2.5 py-1.5 text-xs font-bold text-center outline-none focus:bg-white focus:border-amber-500 transition-all"
                                />
                              </td>
                              <td className="px-4 py-2 text-right text-xs font-extrabold text-slate-700">
                                ${((item.quantity || 0) * (item.cost || 0)).toFixed(2)}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <button 
                                  type="button" 
                                  onClick={() => handleDeletePendingNewProduct(idx)}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer border-0"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-[10px] font-bold text-slate-600 uppercase leading-normal">
                      ¿Deseas agregarlos todos a la boleta para que se registren automáticamente en tu catálogo cuando confirmes la compra?
                    </p>
                    <div className="px-6 py-4 border-t border-slate-50 bg-slate-50/50 flex items-center justify-between shrink-0">
                     <div className="flex flex-col gap-1 text-slate-700 font-extrabold text-xs">
                       <div className="flex items-center gap-2">
                         <span>Subtotal Neto:</span>
                         <span className="text-slate-800 whitespace-nowrap">$ {pendingNewProducts.reduce((sum, item) => sum + ((parseFloat(item.quantity) || 0) * (parseFloat(item.cost) || 0)), 0).toFixed(2)}</span>
                       </div>
                       <div className="flex items-center gap-2">
                         <span>I.V.A. (21%):</span>
                         <span className="text-slate-800 whitespace-nowrap">$ {(pendingNewProducts.reduce((sum, item) => sum + ((parseFloat(item.quantity) || 0) * (parseFloat(item.cost) || 0)), 0) * 0.21).toFixed(2)}</span>
                       </div>
                       <div className="flex items-center gap-3 mt-1 pt-1 border-t border-slate-250">
                         <span className="text-[10px] uppercase tracking-wider text-slate-700">Total con IVA:</span>
                         <span className="text-rose-600 text-sm whitespace-nowrap">$ {(pendingNewProducts.reduce((sum, item) => sum + ((parseFloat(item.quantity) || 0) * (parseFloat(item.cost) || 0)), 0) * 1.21).toFixed(2)}</span>
                       </div>
                     </div>
                     <div className="flex gap-3">
                       <button 
                          type="button" 
                          onClick={() => {
                            setUnmatchedItems(pendingNewProducts);
                            setActiveUnmatchedIndex(0);
                            setShowNewProductsModal(false);
                            focusUnmatchedSearch();
                          }} 
                          className="px-5 py-2.5 text-[10px] font-extrabold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl uppercase tracking-wider cursor-pointer border-0 transition-colors"
                        >
                          Asociar/Crear uno por uno
                        </button>
                        <button 
                          type="button" 
                          onClick={() => {
                            const bulkNewItems: PurchaseItem[] = pendingNewProducts.map((item, idx) => ({
                              productId: `NEW_PRODUCT_${idx}_${Date.now()}`,
                              barcode: item.barcode || '',
                              sku: item.sku || '',
                              name: item.name.toUpperCase(),
                              categoryName: '-',
                              brandName: '-',
                              variant: '-',
                              unit: 'UNIT',
                              quantity: item.quantity,
                              cost: item.cost,
                              total: item.quantity * item.cost,
                              buyFormat: 'UNIT',
                              unitsPerPack: item.unitsPerPack || 1,
                              presentationType: 'UNIT',
                              isNew: true,
                              newProductData: {
                                name: item.name.toUpperCase(),
                                barcode: item.barcode || null,
                                sku: item.sku || null,
                                salePrice: calculateSuggestedPrice(item.cost, item.margin !== undefined ? item.margin : defaultMargin),
                                categoryId: null,
                                brandId: null,
                                unitsPerPack: item.unitsPerPack || 1,
                                presentationType: 'UNIT',
                              }
                            }));
                           setItems(prev => [...prev, ...bulkNewItems]);
                           setShowNewProductsModal(false);
                           setPendingNewProducts([]);
                           toast.success(`Se agregaron ${bulkNewItems.length} productos nuevos a la boleta. Escanea sus códigos de barra faltantes en la tabla.`);
                         }} 
                         id="bulk-submit-btn"
                         className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[10px] font-extrabold uppercase tracking-wider shadow-md transition-all border-0 cursor-pointer"
                       >
                         Sí, agregar todos como nuevos
                       </button>
                     </div>
                   </div>
                  </div>
                </motion.div>
              </div>
            )}
           </AnimatePresence>

          {/* Modal para solicitar total de la boleta de forma manual */}
          <AnimatePresence>
            {showTotalPrompt && (
              <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowTotalPrompt(false)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-400 overflow-hidden flex flex-col p-6 space-y-4">
                  <div className="flex items-center gap-2.5 pb-2 border-b border-slate-300">
                    <Sparkles className="w-5 h-5 text-rose-500" />
                    <h3 className="text-sm font-bold text-slate-800">Escanear Boleta con IA</h3>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-slate-700 font-semibold leading-relaxed">
                      Para que la IA extraiga los valores de forma 100% exacta, ingresá el **Total a Pagar** de la boleta (opcional pero muy recomendado):
                    </p>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-600">$</span>
                      <input 
                        type="number" 
                        step="any"
                        placeholder="Ej: 304947.88" 
                        value={manualTotalInput} 
                        onChange={(e) => setManualTotalInput(e.target.value)} 
                        className="w-full bg-slate-50 border border-slate-400 rounded-xl pl-8 pr-4 py-3 text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all shadow-inner" 
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            executeScanWithTotal(true);
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <button 
                      type="button" 
                      onClick={() => executeScanWithTotal(false)} 
                      className="px-4 py-2.5 border border-slate-400 hover:bg-slate-50 text-slate-700 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                    >
                      Saltar y Escanear
                    </button>
                    <button 
                      type="button" 
                      onClick={() => executeScanWithTotal(true)} 
                      className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[10px] font-extrabold uppercase tracking-wider shadow-md transition-all cursor-pointer"
                    >
                      Comenzar Escaneo
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Products Table */}
          <div className="bg-white rounded-2xl border border-slate-300 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
             <table className="w-full text-left border-collapse">
                <thead>
                   <tr className="bg-slate-50/50 border-b border-slate-300">
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">SKU</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Código (Barras)</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest w-1/4">Nombre</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Categoría</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Marca</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest">Variante</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center">Formato Compra</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center">Cantidad</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center">Costo Neto</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center">Costo + IVA</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center">Margen (%)</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-center">Precio Venta</th>
                      <th className="px-4 py-2 text-[9px] font-bold text-slate-600 uppercase tracking-widest text-right">Total</th>
                      <th className="px-2 pr-4"></th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                    {items.map((item, idx) => (
                      <tr key={item.productId} className="hover:bg-slate-50/30 transition-colors">
                         <td className="px-4 py-1.5 text-[11px] font-bold text-slate-600">
                           {item.sku || '-'}
                         </td>
                         <td className="px-4 py-1.5 text-[11px] font-bold text-slate-600">
                           {item.isNew ? (
                             <input 
                               type="text"
                               id={`main-barcode-${idx}`}
                               placeholder="Scan/Escribir Barras..."
                               value={item.barcode}
                               onFocus={e => e.target.select()}
                               onChange={e => updateItem(item.productId, 'barcode', e.target.value)}
                               onKeyDown={e => {
                                 if (e.key === 'Enter') {
                                   e.preventDefault();
                                   const next = document.getElementById(`main-qty-${idx}`);
                                   if (next) (next as HTMLInputElement).focus();
                                 }
                               }}
                               className="w-32 bg-slate-50 border border-slate-400 rounded-lg px-2 py-0.5 text-[10px] font-bold outline-none focus:bg-white focus:border-emerald-500"
                             />
                           ) : (
                             item.barcode || '-'
                           )}
                         </td>
                         <td className="px-4 py-1.5 text-[11px] font-bold text-slate-800">
                            {item.name}
                            {item.isNew && (
                              <span className="ml-2 px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[9px] font-extrabold uppercase">Nuevo</span>
                            )}
                         </td>
                         <td className="px-4 py-1.5">
                             {item.isNew ? (
                               <div className="flex items-center gap-1">
                                 <select
                                   value={item.newProductData?.categoryId || ''}
                                   onChange={e => {
                                     const val = e.target.value || null;
                                     setItems(prev => prev.map(p => {
                                       if (p.productId === item.productId) {
                                         return {
                                           ...p,
                                           newProductData: {
                                             ...p.newProductData!,
                                             categoryId: val
                                           }
                                         };
                                       }
                                       return p;
                                     }));
                                   }}
                                   className="bg-slate-50 border border-slate-400 rounded-lg px-2 py-0.5 text-[10px] font-extrabold text-slate-600 outline-none cursor-pointer max-w-[120px]"
                                 >
                                   <option value="">Sin categoría</option>
                                   {buildCategoryTree(categories).map(cat => (
                                     <option key={cat.id} value={cat.id}>{cat.name}</option>
                                   ))}
                                 </select>
                                 <button
                                   type="button"
                                   onClick={async () => {
                                     const name = prompt('Nombre de la nueva categoría:');
                                     if (name && name.trim()) {
                                       try {
                                         const { data: newCat } = await api.post('/categories', { name: name.trim(), color: '#F97F1E' });
                                         setCategories(prev => [...prev, newCat]);
                                         setItems(prev => prev.map(p => {
                                           if (p.productId === item.productId) {
                                             return {
                                               ...p,
                                               newProductData: {
                                                 ...p.newProductData!,
                                                 categoryId: newCat.id
                                               }
                                             };
                                           }
                                           return p;
                                         }));
                                         toast.success('Categoría creada');
                                       } catch {
                                         toast.error('Error al crear categoría');
                                       }
                                     }
                                   }}
                                   className="text-[11px] font-bold text-rose-500 hover:text-rose-600 px-1"
                                 >
                                   +
                                 </button>
                               </div>
                             ) : (
                               <span className="text-[10px] font-extrabold text-slate-600 uppercase">
                                 {item.categoryName || '-'}
                               </span>
                             )}
                          </td>
                          <td className="px-4 py-1.5">
                             {item.isNew ? (
                               <div className="flex items-center gap-1">
                                 <select
                                   value={item.newProductData?.brandId || ''}
                                   onChange={e => {
                                     const val = e.target.value || null;
                                     setItems(prev => prev.map(p => {
                                       if (p.productId === item.productId) {
                                         return {
                                           ...p,
                                           newProductData: {
                                             ...p.newProductData!,
                                             brandId: val
                                           }
                                         };
                                       }
                                       return p;
                                     }));
                                   }}
                                   className="bg-slate-50 border border-slate-400 rounded-lg px-2 py-0.5 text-[10px] font-extrabold text-slate-600 outline-none cursor-pointer max-w-[120px]"
                                 >
                                   <option value="">Sin marca</option>
                                   {brands.map(b => (
                                     <option key={b.id} value={b.id}>{b.name}</option>
                                   ))}
                                 </select>
                                 <button
                                   type="button"
                                   onClick={async () => {
                                     const name = prompt('Nombre de la nueva marca:');
                                     if (name && name.trim()) {
                                       try {
                                         const { data: newBrand } = await api.post('/brands', { name: name.trim() });
                                         setBrands(prev => [...prev, newBrand]);
                                         setItems(prev => prev.map(p => {
                                           if (p.productId === item.productId) {
                                             return {
                                               ...p,
                                               newProductData: {
                                                 ...p.newProductData!,
                                                 brandId: newBrand.id
                                               }
                                             };
                                           }
                                           return p;
                                         }));
                                         toast.success('Marca creada');
                                       } catch {
                                         toast.error('Error al crear marca');
                                       }
                                     }
                                   }}
                                   className="text-[11px] font-bold text-rose-500 hover:text-rose-600 px-1"
                                 >
                                   +
                                 </button>
                               </div>
                             ) : (
                               <span className="text-[10px] font-extrabold text-slate-600 uppercase">
                                 {item.brandName || '-'}
                               </span>
                             )}
                          </td>
                         <td className="px-4 py-1.5 text-[10px] font-bold text-slate-350">{item.variant}</td>
                         <td className="px-4 py-1.5 text-center">
                            {item.presentationType === 'PACK' ? (
                              <select
                                value={item.buyFormat}
                                onChange={e => updateItem(item.productId, 'buyFormat', e.target.value)}
                                className="bg-slate-50 border border-slate-400 rounded-xl px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-600 outline-none cursor-pointer"
                              >
                                <option value="UNIT">Unidades</option>
                                <option value="PACK">Paquete ({item.unitsPerPack} u.)</option>
                              </select>
                            ) : (
                              <span className="text-[10px] font-extrabold text-slate-600 uppercase">Unidades</span>
                            )}
                          </td>
                          <td className="px-4 py-1.5 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="flex items-center gap-1 justify-center">
                                <button 
                                  type="button"
                                  onClick={() => updateItem(item.productId, 'quantity', Math.max(1, item.quantity - 1))}
                                  className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs active:scale-[0.9] transition-all"
                                >
                                  -
                                </button>
                                <input 
                                  type="number" 
                                  id={`main-qty-${idx}`}
                                  value={item.quantity === 0 && item.quantity !== '' as any ? 0 : item.quantity || ''} 
                                  onFocus={e => e.target.select()}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    updateItem(item.productId, 'quantity', isNaN(val) ? '' as any : val);
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const next = document.getElementById(`main-cost-${idx}`);
                                      if (next) (next as HTMLInputElement).focus();
                                    }
                                  }}
                                  className="w-12 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 text-center text-[11px] font-bold outline-none focus:border-rose-500/50"
                                />
                                <button 
                                  type="button"
                                  onClick={() => updateItem(item.productId, 'quantity', (parseFloat(item.quantity as any) || 0) + 1)}
                                  className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs active:scale-[0.9] transition-all"
                                >
                                  +
                                </button>
                              </div>
                              {item.buyFormat === 'PACK' && (
                                <span className="text-[8px] font-bold text-rose-500 uppercase tracking-tight">({(parseFloat(item.quantity as any) || 0) * item.unitsPerPack} unidades)</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-1.5 text-center">
                             <div className="flex flex-col items-center gap-0.5">
                               <input 
                                 type="number" 
                                 id={`main-cost-${idx}`}
                                 value={item.cost === 0 && item.cost !== '' as any ? 0 : item.cost || ''} 
                                 onFocus={e => e.target.select()}
                                 onChange={e => {
                                   const val = parseFloat(e.target.value);
                                   updateItem(item.productId, 'cost', isNaN(val) ? '' as any : val);
                                 }}
                                 onKeyDown={e => {
                                   if (e.key === 'Enter') {
                                     e.preventDefault();
                                     const next = document.getElementById(`main-margin-${idx}`);
                                     if (next) (next as HTMLInputElement).focus();
                                   }
                                 }}
                                 className="w-20 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 text-center text-[11px] font-bold outline-none focus:border-rose-500/50"
                               />
                               {item.buyFormat === 'PACK' && (
                                 <span className="text-[8px] font-extrabold text-slate-600 uppercase">(${( (parseFloat(item.cost as any) || 0) / item.unitsPerPack).toFixed(1)} / u.)</span>
                               )}
                             </div>
                          </td>
                          <td className="px-4 py-1.5 text-center text-[11px] font-extrabold text-slate-700 bg-slate-50/20">
                             <div className="flex flex-col items-center justify-center gap-0.5">
                               <span>$ {((parseFloat(item.cost as any) || 0) * (useIvaGlobal ? 1.21 : 1)).toFixed(2)}</span>
                               {item.buyFormat === 'PACK' && (
                                 <span className="text-[8px] font-bold text-rose-500 uppercase">
                                   ($ {(((parseFloat(item.cost as any) || 0) * (useIvaGlobal ? 1.21 : 1)) / item.unitsPerPack).toFixed(2)} / u.)
                                 </span>
                               )}
                             </div>
                          </td>
                          <td className="px-4 py-1.5 text-center">
                             <input 
                               type="number" 
                               id={`main-margin-${idx}`}
                               value={item.margin === 0 && item.margin !== '' as any ? 0 : item.margin || ''} 
                               onFocus={e => e.target.select()}
                               onChange={e => {
                                 const val = parseFloat(e.target.value);
                                 updateItem(item.productId, 'margin', isNaN(val) ? '' as any : val);
                               }}
                               onKeyDown={e => {
                                 if (e.key === 'Enter') {
                                   e.preventDefault();
                                   const next = document.getElementById(`main-salePrice-${idx}`);
                                   if (next) (next as HTMLInputElement).focus();
                                 }
                               }}
                               className="w-14 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 text-center text-[11px] font-bold outline-none focus:border-rose-500/50"
                             />
                          </td>
                          <td className="px-4 py-1.5 text-center">
                             <input 
                               type="number" 
                               id={`main-salePrice-${idx}`}
                               value={item.salePrice === 0 && item.salePrice !== '' as any ? 0 : item.salePrice || ''} 
                               onFocus={e => e.target.select()}
                               onChange={e => {
                                 const val = parseFloat(e.target.value);
                                 updateItem(item.productId, 'salePrice', isNaN(val) ? '' as any : val);
                               }}
                               onKeyDown={e => {
                                 if (e.key === 'Enter') {
                                   e.preventDefault();
                                   const nextRowBarcode = document.getElementById(`main-barcode-${idx + 1}`);
                                   if (nextRowBarcode) {
                                     (nextRowBarcode as HTMLInputElement).focus();
                                   } else {
                                     const nextRowQty = document.getElementById(`main-qty-${idx + 1}`);
                                     if (nextRowQty) {
                                       (nextRowQty as HTMLInputElement).focus();
                                     } else {
                                       productInputRef.current?.focus();
                                     }
                                   }
                                 }
                               }}
                               className="w-20 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 text-center text-[11px] font-bold outline-none focus:border-rose-500/50 text-emerald-700 font-extrabold"
                             />
                          </td>
                         <td className="px-4 py-1.5 text-right text-[12px] font-bold text-emerald-600">$ {item.total.toFixed(2)}</td>
                         <td className="px-2 pr-4 text-right">
                            <button onClick={() => removeItem(item.productId)} className="p-1.5 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all border-0 bg-transparent cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                         </td>
                      </tr>
                    ))}
                   {/* Add Product Search Row */}
                   <tr>
                      <td colSpan={3} className="px-4 py-2">
                         <div className="relative flex items-center">
                            <Search className="absolute left-3 w-4 h-4 text-slate-300 pointer-events-none" />
                            <input 
                              ref={productInputRef}
                              type="text" 
                              value={productSearch}
                              onChange={e => searchProducts(e.target.value)}
                              placeholder="Buscar producto (min 2 letras)..."
                              className="w-full bg-slate-50/50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-[11px] font-bold outline-none focus:bg-white focus:border-rose-300 transition-all"
                            />
                            {(productResults.length > 0 || productSearch.trim().length >= 2) && (
                              <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-2xl shadow-2xl border border-slate-300 z-[100] overflow-hidden max-h-64 overflow-y-auto">
                                 {productResults.map(p => (
                                   <button key={p.id} type="button" onClick={() => addItem(p)} className="w-full text-left px-5 py-4 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0 group transition-colors border-0 cursor-pointer">
                                      <div className="flex flex-col">
                                         <div className="text-[12px] font-bold text-slate-700 group-hover:text-rose-600 transition-colors">{p.name}</div>
                                         <div className="text-[9px] font-bold text-slate-600">{p.barcode || 'Sin código'}</div>
                                      </div>
                                      <div className="px-3 py-1 rounded-lg bg-rose-50 text-rose-600 text-[9px] font-bold uppercase">Stock: {p.stock}</div>
                                   </button>
                                 ))}
                                 <button
                                   type="button"
                                   onClick={() => openQuickCreate(null)}
                                   className="w-full text-left px-5 py-4 bg-rose-50/50 hover:bg-rose-50 border-0 text-rose-600 font-extrabold text-[11px] flex items-center gap-2 cursor-pointer transition-colors"
                                 >
                                   <Plus className="w-4 h-4" />
                                   <span>Crear y agregar producto nuevo: "{productSearch.toUpperCase()}"</span>
                                 </button>
                              </div>
                            )}
                         </div>
                      </td>
                       <td colSpan={9}>
                         <button 
                           type="button"
                           onClick={() => productInputRef.current?.focus()}
                           className="ml-4 text-[10px] font-bold text-rose-500 uppercase tracking-widest hover:underline transition-all border-0 bg-transparent cursor-pointer"
                         >
                           + Agregar producto
                         </button>
                       </td>
                   </tr>
                </tbody>
             </table>
             <div className="mt-auto p-6 border-t border-slate-300 flex flex-col items-end gap-2 bg-slate-50/20">
                {isFixedAmount ? (
                  <div className="flex items-center gap-6 w-72 justify-end">
                     <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest">Total Fijo</span>
                     <div className="text-3xl font-extrabold text-slate-800 whitespace-nowrap">$ {(parseFloat(fixedAmountTotal) || 0).toFixed(2)}</div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-4 text-xs font-bold text-slate-700">
                       <span>{useIvaGlobal ? 'Subtotal (Neto):' : 'Subtotal:'}</span>
                       <span className="text-slate-700">$ {calculateTotal().toFixed(2)}</span>
                    </div>
                    {useIvaGlobal && (
                      <div className="flex items-center gap-4 text-xs font-bold text-slate-700">
                         <span>I.V.A. (21%):</span>
                         <span className="text-slate-700">$ {(calculateTotal() * 0.21).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-6 mt-1 border-t border-slate-400/60 pt-2 w-72 justify-end">
                       <span className="text-[10px] font-extrabold text-slate-700 uppercase tracking-widest">{useIvaGlobal ? 'Total con IVA' : 'Total'}</span>
                       <div className="text-3xl font-extrabold text-slate-800 whitespace-nowrap">$ {(useIvaGlobal ? calculateTotal() * 1.21 : calculateTotal()).toFixed(2)}</div>
                    </div>
                  </>
                )}
             </div>
          </div>
          </>
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-300 shadow-sm flex flex-col items-center justify-center max-w-xl mx-auto my-6 space-y-6">
              <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center text-rose-600">
                <DollarSign className="w-8 h-8" />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-800">Monto Fijo de la Compra</h3>
                <p className="text-xs text-slate-700 font-semibold">Ingresá el costo total de la compra sin especificar productos individualmente.</p>
              </div>
              <div className="w-full relative max-w-sm">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-450">$</span>
                <input 
                  type="number" 
                  step="any"
                  value={fixedAmountTotal}
                  onChange={e => setFixedAmountTotal(e.target.value)}
                  placeholder="0.00" 
                  className="w-full bg-slate-50/50 border-2 border-slate-150 rounded-2xl pl-10 pr-6 py-4 text-2xl font-extrabold text-slate-800 focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none transition-all text-center shadow-inner"
                  autoFocus
                />
              </div>
            </div>
          )}

         {/* Bottom Controls */}
         <div className="grid grid-cols-2 gap-6 pb-10">
            <div className="space-y-3">
               <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest ml-1">Notas</span>
               <textarea 
                 value={notes}
                 onChange={e => setNotes(e.target.value)}
                 placeholder="Descripción opcional..." 
                 className="w-full h-32 bg-white border border-slate-300 rounded-2xl p-6 text-sm font-bold outline-none focus:border-rose-500/50 transition-all resize-none shadow-sm"
               ></textarea>
            </div>
            <div className="space-y-6">
               <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest ml-1">¿Cómo pagaste?</span>
                  <div className="flex gap-2 p-1 bg-slate-100/50 rounded-2xl border border-slate-300">
                     <button 
                       onClick={() => setPaymentStatus('PAID')}
                       className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${paymentStatus === 'PAID' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-600'}`}
                     >
                       <CheckCircle2 className="w-3.5 h-3.5" /> Pagada
                     </button>
                     <button 
                       onClick={() => setPaymentStatus('OWED')}
                       className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${paymentStatus === 'OWED' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-600'}`}
                     >
                       <Clock className="w-3.5 h-3.5" /> A deber
                     </button>
                  </div>
               </div>
               <AnimatePresence>
                 {paymentStatus === 'PAID' && (
                   <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                      <select 
                        value={paymentMethod}
                        onChange={e => setPaymentMethod(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none shadow-sm appearance-none cursor-pointer"
                      >
                         <option>Efectivo</option>
                         <option>Transferencia</option>
                         <option>Mercado Pago</option>
                         <option>Débito/Crédito</option>
                      </select>
                   </motion.div>
                 )}
               </AnimatePresence>
               
               <div className="flex items-center justify-end gap-4 pt-4">
                  <button onClick={onBack} className="px-8 py-3 rounded-xl text-[11px] font-bold text-slate-600 uppercase tracking-widest">Cancelar</button>
                   <button 
                     type="button"
                     onClick={() => {
                       if (window.confirm('¿Estás seguro de que deseas descartar esta boleta y borrar todos los datos ingresados?')) {
                         clearDraft();
                         onBack();
                       }
                     }}
                     className="px-8 py-3 rounded-xl border border-red-200 bg-white text-red-650 text-[11px] font-bold uppercase tracking-widest hover:bg-red-50 transition-all"
                   >
                     Descartar boleta
                   </button>
                  <button 
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="px-12 py-3 rounded-xl bg-emerald-500 text-white text-[11px] font-bold uppercase tracking-widest shadow-xl shadow-emerald-200 hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                  >
                     {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                     Confirmar
                  </button>
               </div>
            </div>
         </div>
      </div>
    </motion.div>
  );
}
