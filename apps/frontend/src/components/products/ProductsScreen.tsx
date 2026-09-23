import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api from '../../services/api';
import { 
  Package, 
  Search, 
  Plus, 
  Upload, 
  Download,
  Filter, 
  AlertTriangle, 
  RefreshCw,
  Edit2,
  Trash2,
  ChevronRight,
  MoreVertical,
  LayoutGrid,
  List as ListIcon,
  Tag,
  Loader2,
  CheckCircle2,
  XCircle,
  Bookmark,
  Megaphone,
  Image,
  Percent,
  Barcode,
  ArrowUpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ProductModal from './ProductModal';
import BulkPriceModal from './BulkPriceModal';
import GaveteroLabelModal from './GaveteroLabelModal';
import BarcodeLabelModal from './BarcodeLabelModal';
import VentraImportModal from './VentraImportModal';
import ToolbarMenu from '../common/ToolbarMenu';
import { usePOSStore } from '../../stores/posStore';
import ImageReviewModal from './ImageReviewModal';
import { downloadFromApi } from '../../utils/download';
import { toast } from 'react-hot-toast';
import { wsService } from '../../services/websocket';
import { useFeature } from '../../stores/businessStore';

export default function ProductsScreen() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showBulkPriceModal, setShowBulkPriceModal] = useState(false);
  const [showVentraImport, setShowVentraImport] = useState(false);
  const [showRoundPrices, setShowRoundPrices] = useState(false);
  const [isRoundingPrices, setIsRoundingPrices] = useState(false);

  const handleRoundPrices = async () => {
    setIsRoundingPrices(true);
    const loadingToast = toast.loading('Redondeando precios...');
    try {
      const { data } = await api.post('/products/bulk-round-prices', { multiple: 10 }, { timeout: 0 });
      toast.success(`${data.updated} precios redondeados de ${data.total}`, { id: loadingToast });
      usePOSStore.getState().setProducts([]);
      setShowRoundPrices(false);
      loadProducts(true);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al redondear precios', { id: loadingToast });
    } finally {
      setIsRoundingPrices(false);
    }
  };
  const isHardwareStore = useFeature('hardwareImages');
  const [showImageReview, setShowImageReview] = useState(false);
  const [pendingImageReviews, setPendingImageReviews] = useState(0);
  const refreshImageReviewCount = () => {
    if (!isHardwareStore) return;
    api.get('/products/images/hardware/summary')
      .then(({ data }) => {
        setPendingImageReviews(data.pending || 0);
        if (data.isRunning) setIsAssigningImages(true);
      })
      .catch(() => {});
  };
  useEffect(() => { refreshImageReviewCount(); }, []);
  const [showGaveteroLabels, setShowGaveteroLabels] = useState(false);
  const [showBarcodeLabels, setShowBarcodeLabels] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  /**
   * Código escaneado o escrito + Enter: abre "Editar producto" si ya existe
   * (por código de barras, SKU o código alternativo) o "Agregar producto" con
   * el código cargado si no existe. Devuelve false si no se pudo consultar.
   */
  const openProductByCode = async (rawCode: string): Promise<boolean> => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return false;
    try {
      const { data } = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
      setSelectedProduct(data);
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        toast.error('No se pudo buscar el código. Revisá la conexión.');
        return false;
      }
      setSelectedProduct({ barcode: code });
    }
    setShowModal(true);
    return true;
  };
  // /inventory?nuevo=<código>: viene del POS al escanear un código desconocido
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const nuevo = searchParams.get('nuevo');
    if (!nuevo) return;
    setSelectedProduct({ barcode: nuevo.toUpperCase() });
    setShowModal(true);
    searchParams.delete('nuevo');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [importStatus, setImportStatus] = useState<{
    show: boolean;
    progress: number;
    total: number;
    current: number;
    status: string;
    isComplete: boolean;
    isMinimized?: boolean;
    error: string | null;
    details?: {
      imported: number;
      updated: number;
      lastItem: string;
    };
    recentItems: string[];
  }>({
    show: false,
    progress: 0,
    total: 0,
    current: 0,
    status: '',
    isComplete: false,
    isMinimized: false,
    error: null,
    recentItems: []
  });
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [imageFilter, setImageFilter] = useState<'all' | 'with' | 'without'>('all');
  const [totalCount, setTotalCount] = useState<number>(0);
  const take = 50;

  // New States for AI Image search and Bulk actions
  const [isAssigningImages, setIsAssigningImages] = useState(false);
  const [showImageSyncModal, setShowImageSyncModal] = useState(false);
  const [imageSyncStatus, setImageSyncStatus] = useState<any>({
    progress: 0,
    total: 0,
    current: 0,
    successCount: 0,
    noMatchCount: 0,
    status: 'Iniciando buscador de imágenes...',
    isComplete: false
  });
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkAction, setBulkAction] = useState<'reset' | 'delete' | 'remove_images' | 'delete_zero_negative' | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [showBulkCategoryModal, setShowBulkCategoryModal] = useState(false);
  const [selectedBulkCategory, setSelectedBulkCategory] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isLoadingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const savedScrollTopRef = useRef<number>(0);
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  const scrollRowToTop = (row: HTMLElement) => {
    row.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => {
      if (scrollContainerRef.current) {
        savedScrollTopRef.current = scrollContainerRef.current.scrollTop;
      }
    }, 450);
  };

  useEffect(() => {
    const isAnyModalOpen = showModal || importStatus.show || showImageSyncModal || showBulkModal || showBulkCategoryModal;
    if (isAnyModalOpen) return;

    // Focus immediately on mount or modal close
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }

    const handleFocusLoss = (e: MouseEvent) => {
      const currentModalOpen = showModal || importStatus.show || showImageSyncModal || showBulkModal || showBulkCategoryModal;
      if (currentModalOpen) return;

      const target = e.target as HTMLElement;
      const interactiveTags = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'LABEL'];
      if (interactiveTags.includes(target.tagName) || target.closest('button') || target.closest('a') || target.closest('input')) {
        return;
      }

      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 10);
    };

    document.addEventListener('click', handleFocusLoss);
    return () => {
      document.removeEventListener('click', handleFocusLoss);
    };
  }, [showModal, importStatus.show, showImageSyncModal, showBulkModal, showBulkCategoryModal]);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      // If any modal is open, ignore document clicks to prevent unmarking the item
      if (showModal || showImageSyncModal || showBulkModal || showBulkCategoryModal) {
        return;
      }
      const target = e.target as HTMLElement;
      // If the clicked element was unmounted (like modal buttons) or is part of a modal layout, do not unmark
      if (!document.body.contains(target) || target.closest('[role="dialog"]') || target.closest('.fixed')) {
        return;
      }
      if (!target.closest('tbody tr')) {
        setActiveProductId(null);
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, [showModal, showImageSyncModal, showBulkModal, showBulkCategoryModal]);

  useEffect(() => {
    if (!showModal && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const targetScroll = savedScrollTopRef.current;
      // Wait for React state updates and layout rendering to fully settle
      const timer = setTimeout(() => {
        if (container) {
          container.scrollTop = targetScroll;
        }
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [showModal]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  useEffect(() => {
    wsService.connect();

    const handleUpdate = () => {
      if ((window as any).globalImportStatus) {
        setImportStatus((window as any).globalImportStatus);
      }
    };
    window.addEventListener('import-progress-update', handleUpdate);

    wsService.on('sync:images:progress', (data: any) => {
      setImageSyncStatus({
        progress: data.progress || 0,
        total: data.total || 0,
        current: data.current || 0,
        successCount: data.successCount || 0,
        noMatchCount: data.noMatchCount || 0,
        status: data.status || 'Buscando e indexando...',
        isComplete: !!data.isComplete
      });
      if (data.isComplete) {
        setIsAssigningImages(false);
        setShowImageSyncModal(false);
        loadProducts(true);
        refreshImageReviewCount();
      } else {
        setIsAssigningImages(true);
      }
    });

    return () => {
      window.removeEventListener('import-progress-update', handleUpdate);
      wsService.off('sync:images:progress');
    };
  }, []);

  useEffect(() => {
    let buffer = '';
    let lastKeyTime = Date.now();

    const handleGlobalKeyDown = async (e: KeyboardEvent) => {
      if (showModal || importStatus.show || showImageSyncModal || showBulkModal || showBulkCategoryModal) {
        buffer = '';
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        buffer = '';
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastKeyTime;
      lastKeyTime = now;
      const isScannerFast = timeDiff <= 50;

      let char = '';
      if (e.code.startsWith('Digit')) {
        char = e.code.slice(5);
      } else if (e.code.startsWith('Key')) {
        char = e.code.slice(3).toLowerCase();
      }

      if (char && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isScannerFast) {
          e.preventDefault();
          e.stopPropagation();
          buffer += char;
          return;
        } else {
          buffer = char;
        }
      }

      if (e.key === 'Enter') {
        if (buffer.length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          const scannedCode = buffer;
          buffer = '';
          await openProductByCode(scannedCode);
        } else {
          buffer = '';
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showModal, importStatus.show, showImageSyncModal, showBulkModal, showBulkCategoryModal]);

  const loadProducts = async (isInitial = true, search = debouncedSearchQuery) => {
    if (!isInitial && isLoadingRef.current) return;
    isLoadingRef.current = true;

    if (isInitial) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      setIsLoading(true);
      setProducts([]);
      setSkip(0);
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }

    const currentSignal = abortControllerRef.current?.signal;
    
    try {
      const currentSkip = isInitial ? 0 : skip + take;
      const { data } = await api.get('/products', {
        signal: currentSignal,
        params: { 
          search: search || undefined,
          categoryId: selectedCategory || undefined,
          hasImage: imageFilter === 'with' ? 'true' : imageFilter === 'without' ? 'false' : undefined,
          skip: currentSkip,
          take
        }
      });
      
      // Fetch total count matching current filters
      const countRes = await api.get('/products/count', {
        signal: currentSignal,
        params: {
          search: search || undefined,
          categoryId: selectedCategory || undefined,
          hasImage: imageFilter === 'with' ? 'true' : imageFilter === 'without' ? 'false' : undefined,
        }
      });
      setTotalCount(countRes.data);
      
      if (isInitial) {
        setProducts(data);
      } else {
        setProducts(prev => [...prev, ...data]);
      }
      
      setSkip(currentSkip);
      setHasMore(data.length === take);
    } catch (err: any) {
      if (axios.isCancel(err) || err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') {
        return;
      }
      toast.error('Error al cargar productos');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      isLoadingRef.current = false;
    }
  };

  const handleProductSuccess = (savedProduct?: any) => {
    if (savedProduct) {
      setProducts(prev => {
        const idx = prev.findIndex(p => String(p.id) === String(savedProduct.id));
        if (idx !== -1) {
          const updatedList = [...prev];
          updatedList[idx] = { ...updatedList[idx], ...savedProduct };
          return updatedList;
        } else {
          loadProducts(true);
          return prev;
        }
      });
      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const targetScroll = savedScrollTopRef.current;
        setTimeout(() => {
          if (container) {
            container.scrollTop = targetScroll;
          }
        }, 150);
      }
    } else {
      loadProducts(true);
    }
  };

  const loadCategories = async () => {
    try {
      const { data } = await api.get('/categories');
      setCategories(data);
    } catch (err) {
      console.error('Error al cargar categorías');
    }
  };

  useEffect(() => {
    loadProducts(true, debouncedSearchQuery);
  }, [debouncedSearchQuery, selectedCategory, imageFilter]);

  useEffect(() => {
    loadCategories();
  }, []);

  // Infinite scroll: observes the sentinel row and requests the next page.
  // Re-created whenever hasMore/isLoadingMore change so it always calls the
  // current loadProducts (which closes over the latest `skip`) instead of a
  // stale closure from whichever render first attached the observer.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadProducts(false);
      }
    }, { threshold: 0.1 });
    observer.observe(el);

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, products]);

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;
    try {
      await api.delete(`/products/${id}`);
      loadProducts();
    } catch (err) {
      toast.error('Error al eliminar producto');
    }
  };

  const handleImportClick = () => {
    setShowVentraImport(true);
  };

  const handleLegacyImport = () => {
    setShowVentraImport(false);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    await runImport('/products/import', formData);
  };

  const handleVentraImport = async (file: File, updateStock: boolean) => {
    setShowVentraImport(false);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('updateStock', String(updateStock));
    await runImport('/products/import/ventra', formData);
  };

  const runImport = async (endpoint: string, formData: FormData) => {
    const initialStatus = {
      show: true,
      progress: 0,
      total: 0,
      current: 0,
      status: 'Iniciando importación...',
      isComplete: false,
      isMinimized: false,
      error: null,
      recentItems: []
    };
    (window as any).globalImportStatus = initialStatus;
    setImportStatus(initialStatus);
    window.dispatchEvent(new CustomEvent('import-progress-update'));

    try {
      const { data: result } = await api.post(endpoint, formData, { timeout: 0 });
      const previous = (window as any).globalImportStatus || {};
      const failed: any[] = result?.failed || [];
      const completedStatus = failed.length > 0
        ? {
            ...previous,
            error: `${failed.length} productos no se pudieron guardar: ` +
              failed.slice(0, 5).map(f => `fila ${f.row} ${f.codigo || ''} (${f.error})`).join('; '),
            status: 'Importación con errores',
          }
        : {
            ...previous,
            isComplete: true,
            progress: 100,
            status: '¡Importación finalizada con éxito!',
            ...(result?.created !== undefined && {
              details: { ...(previous.details || {}), imported: result.created, updated: result.updated },
            }),
          };
      (window as any).globalImportStatus = completedStatus;
      setImportStatus(completedStatus);
      window.dispatchEvent(new CustomEvent('import-progress-update'));
      loadProducts();
    } catch (err: any) {
      const errorStatus = {
        ...((window as any).globalImportStatus || {}),
        error: err.response?.data?.message || 'Error al importar archivo',
        status: 'Error en la importación'
      };
      (window as any).globalImportStatus = errorStatus;
      setImportStatus(errorStatus);
      window.dispatchEvent(new CustomEvent('import-progress-update'));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleVentraExport = async () => {
    const loadingToast = toast.loading('Generando archivo de productos...');
    try {
      await downloadFromApi('/products/export/ventra', `ventra_productos_${new Date().toISOString().split('T')[0]}.xlsx`);
      toast.success('Productos exportados (.xlsx)', { id: loadingToast });
    } catch (err: any) {
      toast.error('Error al exportar productos', { id: loadingToast });
      console.error(err);
    }
  };

  const handleExportClick = async () => {
    const loadingToast = toast.loading('Generando base de datos para GoDelivery...');
    try {
      const { data } = await api.get('/products/export/godelivery');
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kiosco_productos_godelivery_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Base de datos exportada con éxito (.json)', { id: loadingToast });
    } catch (err: any) {
      toast.error('Error al exportar base de datos', { id: loadingToast });
      console.error(err);
    }
  };



  const handleAssignImages = async () => {
    setIsAssigningImages(true);
    setShowImageSyncModal(true);
    setImageSyncStatus({
      progress: 0,
      total: 0,
      current: 0,
      successCount: 0,
      noMatchCount: 0,
      status: 'Conectando con base de datos de imágenes...',
      isComplete: false
    });

    const loadingToast = toast.loading('Iniciando búsqueda de fotos...');

    try {
      if (isHardwareStore) {
        const { data } = await api.post('/products/images/hardware/start');
        if (data?.started === false) toast(data.message, { icon: 'ℹ️' });
        toast.success('Búsqueda de fotos iniciada', { id: loadingToast });
        return;
      }
      await api.post('/products/auto-assign-images');
      toast.success('Buscador de imágenes de alta precisión iniciado', { id: loadingToast });
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Error al iniciar buscador.';
      toast.error(errMsg, { id: loadingToast });
      setIsAssigningImages(false);
      setShowImageSyncModal(false);
    }
  };

  const handleCancelAssignImages = async () => {
    const loadingToast = toast.loading('Cancelando proceso de asignación...');
    try {
      await api.post(isHardwareStore ? '/products/images/hardware/cancel' : '/products/auto-assign-images/cancel');
      toast.success('Proceso de asignación cancelado con éxito', { id: loadingToast });
      setIsAssigningImages(false);
      setShowImageSyncModal(false);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Error al cancelar proceso.';
      toast.error(errMsg, { id: loadingToast });
    }
  };

  const executeBulkAction = async () => {
    let requiredText = 'BORRAR';
    if (bulkAction === 'reset') requiredText = 'RESETEAR';
    if (bulkAction === 'remove_images') requiredText = 'REMOVER';
    if (bulkAction === 'delete_zero_negative') requiredText = 'DEPURAR';

    if (confirmInput.toUpperCase() !== requiredText) {
      toast.error(`Por favor, escribe "${requiredText}" para confirmar la acción.`);
      return;
    }

    let endpoint = '/products/bulk-delete';
    let actionName = 'Eliminación masiva';
    if (bulkAction === 'reset') {
      endpoint = '/products/bulk-reset-stock';
      actionName = 'Reseteo de stock';
    } else if (bulkAction === 'remove_images') {
      endpoint = '/products/bulk-remove-images';
      actionName = 'Remover todas las imágenes';
    } else if (bulkAction === 'delete_zero_negative') {
      endpoint = '/products/bulk-delete-zero-negative';
      actionName = 'Depuración de stock cero o negativo';
    }

    const loadingToast = toast.loading(`Ejecutando ${actionName.toLowerCase()}...`);

    try {
      await api.post(endpoint);
      toast.success(`¡${actionName} completado con éxito!`, { id: loadingToast });
      setShowBulkModal(false);
      setBulkAction(null);
      setConfirmInput('');
      loadProducts(true);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || `Error al ejecutar ${actionName.toLowerCase()}.`;
      toast.error(errMsg, { id: loadingToast });
    }
  };

  const handleRemoveImagesForSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`¿Estás seguro de eliminar las imágenes de los ${selectedIds.length} productos seleccionados?`)) return;

    const loadingToast = toast.loading('Eliminando imágenes de seleccionados...');
    try {
      await api.post('/products/bulk-remove-images-subset', { ids: selectedIds });
      toast.success('Imágenes eliminadas correctamente', { id: loadingToast });
      setSelectedIds([]);
      loadProducts(true);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Error al eliminar imágenes.';
      toast.error(errMsg, { id: loadingToast });
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`¿Estás seguro de eliminar los ${selectedIds.length} productos seleccionados?`)) return;

    const loadingToast = toast.loading('Eliminando productos seleccionados...');
    try {
      await api.post('/products/bulk-delete-subset', { ids: selectedIds });
      toast.success('Productos eliminados correctamente', { id: loadingToast });
      setSelectedIds([]);
      loadProducts(true);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Error al eliminar productos.';
      toast.error(errMsg, { id: loadingToast });
    }
  };

  const handleBulkUpdateCategory = async () => {
    if (selectedIds.length === 0) return;
    if (!selectedBulkCategory) {
      toast.error('Por favor, selecciona una categoría');
      return;
    }

    const loadingToast = toast.loading('Actualizando categoría de productos seleccionados...');
    try {
      await api.post('/products/bulk-update-category-subset', { 
        ids: selectedIds, 
        categoryId: selectedBulkCategory 
      });
      toast.success('Categoría actualizada correctamente', { id: loadingToast });
      setSelectedIds([]);
      setShowBulkCategoryModal(false);
      setSelectedBulkCategory('');
      loadProducts(true);
    } catch (err: any) {
      const errMsg = err.response?.data?.message || 'Error al actualizar categoría.';
      toast.error(errMsg, { id: loadingToast });
    }
  };

  const toggleSelectProduct = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllVisible = () => {
    const visibleIds = visibleProducts.map(p => p.id);
    const allSelected = visibleIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedIds(prev => {
        const newSelection = [...prev];
        visibleIds.forEach(id => {
          if (!newSelection.includes(id)) {
            newSelection.push(id);
          }
        });
        return newSelection;
      });
    }
  };

  const filteredProducts = products; // Already filtered by server

  // Deduplicate products to prevent warning of duplicate keys
  const visibleProducts = useMemo(() => {
    return Array.from(new Map(products.map(p => [p.id, p])).values());
  }, [products]);

  return (
    <div className="h-full flex flex-col gap-4 p-2 overflow-hidden">
      {/* Search and Global Filters */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="flex-1 relative">
            {isLoading || searchQuery !== debouncedSearchQuery ? (
              <Loader2 className="absolute left-3.5 top-[13px] w-4 h-4 text-rose-500 animate-spin" />
            ) : (
              <Search className="absolute left-3.5 top-[13px] w-4 h-4 text-slate-600" />
            )}
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Buscá por nombre o código · Enter con un código abre el producto" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
              onKeyDown={async (e) => {
                if (e.code && e.code.startsWith('Digit') && e.shiftKey) {
                  e.preventDefault();
                  const digit = e.code.slice(5);
                  setSearchQuery(prev => prev + digit);
                  return;
                }
                if (e.code && e.code.startsWith('Numpad') && e.code.length === 7 && e.shiftKey) {
                  e.preventDefault();
                  const digit = e.code.slice(6);
                  setSearchQuery(prev => prev + digit);
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const trimmed = searchQuery.trim();
                  if (!trimmed) return;
                  // Un código (una sola "palabra" con al menos un número, ej. 7790895000997 o M01)
                  // abre el producto para editarlo, o "Agregar producto" si no existe.
                  // Texto sin números o con espacios ("coca cola") se busca por nombre.
                  if (!/\s/.test(trimmed) && /\d/.test(trimmed)) {
                    if (await openProductByCode(trimmed)) setSearchQuery('');
                    return;
                  }
                  setDebouncedSearchQuery(trimmed);
                }
              }}
              className="w-full bg-slate-50 border border-slate-400 rounded-lg pl-10 pr-4 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-600 focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all outline-none"
            />
          </div>
          <div className="flex items-center justify-between md:justify-start gap-2">
            <div className="flex-1 md:flex-none flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-400 dark:border-slate-700 shadow-sm hover:bg-slate-100/50 transition-all">
               <Filter className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
               <select 
                 value={selectedCategory || ''}
                 onChange={(e) => setSelectedCategory(e.target.value || null)}
                 className="bg-transparent text-xs font-semibold text-slate-700 dark:text-slate-200 border-0 p-0 pr-6 focus:ring-0 focus:outline-none outline-none cursor-pointer w-full"
               >
                 <option value="">Todas las categorías</option>
                 {categories.filter(c => c._count?.products > 0).map(cat => (
                   <option key={cat.id} value={cat.id}>{cat.name}</option>
                 ))}
               </select>
            </div>
            <div className="flex-1 md:flex-none flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-lg border border-slate-400 dark:border-slate-700 shadow-sm hover:bg-slate-100/50 transition-all">
               <Image className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
               <select 
                 value={imageFilter}
                 onChange={(e) => setImageFilter(e.target.value as any)}
                 className="bg-transparent text-xs font-semibold text-slate-700 dark:text-slate-200 border-0 p-0 pr-6 focus:ring-0 focus:outline-none outline-none cursor-pointer w-full"
               >
                 <option value="all">Todas las fotos</option>
                 <option value="with">Con imagen</option>
                 <option value="without">Sin imagen</option>
               </select>
            </div>
            <button className="px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100 transition-all flex items-center gap-2">
               <AlertTriangle className="w-3.5 h-3.5" /> Bajo Stock
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-slate-300 pt-4 gap-3">
           <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg shrink-0 w-fit">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-rose-600' : 'text-slate-600 hover:text-slate-600'}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-rose-600' : 'text-slate-600 hover:text-slate-600'}`}
              >
                <ListIcon className="w-4 h-4" />
              </button>
           </div>
            <div className="text-xs font-bold text-slate-800 bg-slate-100 px-3 py-2 rounded-lg border border-slate-300">
               Total: {totalCount} productos
            </div>
             <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept=".xlsx,.xls,.csv,.dbf"
              />
              <button 
                onClick={() => { setSelectedProduct(null); setShowModal(true); }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 active:scale-[0.97] transition-all cursor-pointer shadow-sm"
              >
                  <Plus className="w-3.5 h-3.5" /> <span>Nuevo Producto</span>
              </button>
              {/* Herramientas agrupadas por tema para que la barra no se llene de botones */}
              <ToolbarMenu
                label="Precios"
                icon={<Percent className="w-3.5 h-3.5 text-rose-600" />}
                items={[
                  {
                    label: 'Ajuste masivo por %',
                    description: 'Aumentar o descontar precios por proveedor, rubro o marca',
                    icon: <Percent className="w-3.5 h-3.5 text-rose-500" />,
                    onClick: () => setShowBulkPriceModal(true),
                  },
                  {
                    label: 'Redondear precios',
                    description: 'Hacia arriba, a múltiplos de 10, sin decimales',
                    icon: <ArrowUpCircle className="w-3.5 h-3.5 text-rose-500" />,
                    onClick: () => setShowRoundPrices(true),
                  },
                ]}
              />
              <ToolbarMenu
                label="Etiquetas"
                icon={<Tag className="w-3.5 h-3.5 text-slate-700" />}
                items={[
                  {
                    label: 'Etiquetas con código',
                    description: 'Generar códigos internos e imprimir códigos de barra',
                    icon: <Barcode className="w-3.5 h-3.5 text-slate-600" />,
                    onClick: () => setShowBarcodeLabels(true),
                  },
                  {
                    label: 'Etiquetas de gavetero',
                    description: 'Para cajoneras y estanterías',
                    icon: <Tag className="w-3.5 h-3.5 text-amber-600" />,
                    onClick: () => setShowGaveteroLabels(true),
                    disabled: !isHardwareStore,
                  },
                  {
                    label: 'Marketing y promociones',
                    description: 'Carteles, combos y difusión',
                    icon: <Megaphone className="w-3.5 h-3.5 text-purple-600" />,
                    onClick: () => navigate('/marketing'),
                  },
                ]}
              />
              <ToolbarMenu
                label="Fotos"
                icon={isAssigningImages ? <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" /> : <Image className="w-3.5 h-3.5 text-rose-600" />}
                alert={pendingImageReviews > 0}
                items={[
                  {
                    label: isAssigningImages ? 'Buscando fotos...' : 'Buscar y asignar fotos',
                    description: isHardwareStore ? 'Solo asigna las seguras; las dudosas quedan para revisar' : 'Busca fotos por código de barras y nombre',
                    icon: <Package className="w-3.5 h-3.5 text-rose-500" />,
                    onClick: () => { if (!isAssigningImages) handleAssignImages(); else setShowImageSyncModal(true); },
                  },
                  {
                    label: 'Revisar fotos sugeridas',
                    description: 'Aceptar o descartar las dudosas',
                    icon: <Image className="w-3.5 h-3.5 text-amber-600" />,
                    badge: pendingImageReviews,
                    onClick: () => setShowImageReview(true),
                    disabled: !isHardwareStore || pendingImageReviews === 0,
                  },
                ]}
              />
              <ToolbarMenu
                label="Datos"
                icon={<Upload className="w-3.5 h-3.5 text-slate-700" />}
                items={[
                  {
                    label: 'Importar productos',
                    description: 'Formato Ventra (.xlsx) o base de modpresup (.mdb)',
                    icon: <Upload className="w-3.5 h-3.5 text-slate-600" />,
                    onClick: handleImportClick,
                  },
                  {
                    label: 'Exportar productos',
                    description: 'Formato Ventra (.xlsx), para editar y volver a importar',
                    icon: <Download className="w-3.5 h-3.5 text-slate-600" />,
                    onClick: handleVentraExport,
                  },
                  {
                    label: 'Exportar para GoDelivery',
                    description: 'Archivo .json de la tienda online',
                    icon: <Download className="w-3.5 h-3.5 text-slate-600" />,
                    onClick: handleExportClick,
                  },
                  {
                    label: 'Actualizar lista',
                    description: 'Volver a cargar los productos',
                    icon: <RefreshCw className="w-3.5 h-3.5 text-slate-600" />,
                    onClick: () => loadProducts(true),
                  },
                ]}
              />
              <button
                onClick={() => { setBulkAction(null); setConfirmInput(''); setShowBulkModal(true); }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-[11px] font-bold hover:bg-red-100 transition-all cursor-pointer active:scale-[0.97] shadow-sm"
                title="Borrados y limpiezas masivas"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
                <span>Acciones</span>
              </button>
           </div>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-1 card flex flex-col overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] z-10 flex items-center justify-center">
             <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-6 h-6 text-rose-500 animate-spin" />
                <p className="text-xs font-medium text-slate-600">Cargando inventario...</p>
             </div>
          </div>
        )}

        <div ref={scrollContainerRef} className="flex-1 overflow-auto custom-scrollbar">
          {filteredProducts.length > 0 ? (
            <table className="w-full min-w-[850px] text-left table-fixed">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-400 z-20">
                <tr>
                  <th className="px-3 py-3 text-center w-[5%] z-20">
                    <input 
                      type="checkbox" 
                      checked={visibleProducts.length > 0 && visibleProducts.every(p => selectedIds.includes(p.id))} 
                      onChange={handleSelectAllVisible}
                      className="w-4 h-4 rounded text-rose-600 border-slate-300 focus:ring-rose-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider w-[30%]">Producto</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider w-[17%]">Categoría</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[10%]">Stock</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[9%]">Costo U.</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[9%]">Costo Pack</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[9%]">Venta</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[11%]">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleProducts.map((p) => {
                  const margin = p.costPrice > 0 ? (((p.salePrice / p.costPrice) - 1) * 100).toFixed(1) : '---';
                  const isSelected = selectedIds.includes(p.id);
                  return (
                    <tr 
                      key={p.id} 
                      onClick={(e) => {
                        scrollRowToTop(e.currentTarget as HTMLElement);
                        setActiveProductId(p.id);
                        setSelectedProduct(p);
                        setShowModal(true);
                      }}
                      style={{ scrollMarginTop: '48px' }}
                      className={`hover:bg-slate-50 transition-all group cursor-pointer ${activeProductId === p.id ? 'bg-rose-50/70 shadow-sm' : isSelected ? 'bg-rose-50/30' : ''}`}
                    >
                      <td className={`px-3 py-3 text-center transition-all ${activeProductId === p.id ? 'border-l-4 border-l-rose-600' : 'border-l-4 border-l-transparent'}`} onClick={(e) => {
                        e.stopPropagation();
                        const row = e.currentTarget.closest('tr');
                        if (row) {
                          scrollRowToTop(row);
                        }
                        setActiveProductId(p.id);
                        toggleSelectProduct(p.id);
                      }}>
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={() => {}} // Handled by td onClick to prevent double triggering
                          className="w-4 h-4 rounded text-rose-600 border-slate-300 focus:ring-rose-500 cursor-pointer"
                        />
                      </td>
                       <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                           <div className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 overflow-hidden border border-slate-400">
                              <img 
                                src={p.imageUrl || './product-placeholder.png'} 
                                alt="" 
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover" 
                                onError={(e) => { 
                                  (e.target as HTMLImageElement).src = './product-placeholder.png'; 
                                }} 
                              />
                           </div>
                           <div className="min-w-0">
                             <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                             <p className="text-[10px] text-slate-600 font-medium truncate">{p.barcode || 'Sin código'}</p>
                           </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                         <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap overflow-hidden text-ellipsis">
                           <Tag className="w-3 h-3 text-rose-400 shrink-0" /> {p.category ? (p.category.parentCategory ? `${p.category.parentCategory.name} > ${p.category.name}` : p.category.name) : 'Varios'}
                         </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                         <div className="inline-flex flex-col items-center">
                            <span className={`text-sm font-bold ${p.stock <= p.minStock ? 'text-red-600' : 'text-slate-800'}`}>
                               {p.stock}
                            </span>
                            <span className="text-[9px] font-medium text-slate-600">Min: {p.minStock}</span>
                         </div>
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-medium text-slate-700 whitespace-nowrap">
                         $ {p.costPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-3 text-center text-sm font-medium text-slate-700 whitespace-nowrap">
                         {p.presentationType === 'PACK' ? `$ ${(p.costPrice * (p.unitsPerPack || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'}
                      </td>
                      <td className="px-3 py-3 text-center">
                         <span className="text-sm font-bold text-slate-800 whitespace-nowrap">$ {p.salePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                         <div className="flex items-center justify-center gap-2">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${parseFloat(margin) > 40 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                                {margin}%
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    const row = e.currentTarget.closest('tr');
                                    if (row) {
                                      scrollRowToTop(row);
                                    }
                                    setActiveProductId(p.id);
                                    setSelectedProduct(p); 
                                    setShowModal(true); 
                                  }}
                                  className="p-1.5 rounded-md text-slate-600 hover:text-rose-600 hover:bg-rose-50 transition-all"
                               >
                                  <Edit2 className="w-3.5 h-3.5" />
                               </button>
                               <button 
                                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                                  className="p-1.5 rounded-md text-slate-600 hover:text-red-600 hover:bg-red-50 transition-all"
                               >
                                  <Trash2 className="w-3.5 h-3.5" />
                               </button>
                            </div>
                         </div>
                      </td>
                    </tr>
                  );
                })}
                {hasMore && (
                  <tr ref={sentinelRef}>
                    <td colSpan={9} className="py-8 text-center">
                       <div className="flex items-center justify-center gap-2 text-slate-600 text-xs">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-500" /> {isLoadingMore ? 'Cargando más productos...' : 'Desliza para cargar más'}
                       </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-32">
              <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-400 flex items-center justify-center mb-6">
                <Package className="w-8 h-8 text-slate-600" />
              </div>
              <h3 className="text-base font-bold text-slate-600 mb-2">No hay productos encontrados</h3>
              <p className="text-sm text-slate-600 max-w-[300px]">
                Utilizá el botón "Nuevo Producto" para cargar tu primer artículo al inventario.
              </p>
              <button 
                onClick={() => { setSelectedProduct(null); setShowModal(true); }}
                className="mt-8 flex items-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 active:scale-[0.97] transition-all"
              >
                <Plus className="w-4 h-4" /> Cargar Producto
              </button>
            </div>
          )}
        </div>
      </div>

        {showModal && (
          <ProductModal 
            onClose={() => setShowModal(false)} 
            onSuccess={handleProductSuccess}
            product={selectedProduct}
          />
        )}

      {/* Import Progress Modal */}
      <AnimatePresence>
        {importStatus.show && !importStatus.isMinimized && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="w-full max-w-xl bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-400"
            >
              <div className="relative h-1.5 bg-slate-100 overflow-hidden">
                <motion.div 
                  className={`h-full ${importStatus.error ? 'bg-red-500' : 'bg-rose-500'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${importStatus.progress}%` }}
                />
              </div>

              <div className="p-8 space-y-8">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-slate-800">
                      {importStatus.isComplete ? '¡Misión Cumplida!' : importStatus.error ? 'Ocurrió un problema' : 'Sincronizando Inventario'}
                    </h3>
                    <p className="text-xs text-slate-700">
                      {importStatus.current} de {importStatus.total} productos procesados
                    </p>
                  </div>
                  
                  <div className="relative w-16 h-16">
                    <svg className="w-full h-full -rotate-90">
                      <circle cx="32" cy="32" r="28" stroke="#e2e8f0" strokeWidth="6" fill="transparent" />
                      <motion.circle
                        cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6" strokeDasharray="175.9"
                        initial={{ strokeDashoffset: 175.9 }}
                        animate={{ strokeDashoffset: 175.9 - (175.9 * importStatus.progress) / 100 }}
                        fill="transparent"
                        className={`${importStatus.error ? 'text-red-500' : 'text-rose-500'}`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-bold text-slate-700">{importStatus.progress}%</span>
                    </div>
                  </div>
                </div>

                {!importStatus.isComplete && !importStatus.error && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                      <p className="text-xs font-semibold text-rose-600 truncate">
                        {importStatus.status}
                      </p>
                    </div>
                    
                    <div className="bg-slate-50 border border-slate-400 rounded-xl p-4 space-y-2">
                      <p className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-300 pb-2">Últimos artículos:</p>
                      <div className="space-y-1.5">
                        {importStatus.recentItems.map((item, idx) => (
                          <motion.div 
                            key={`${item}-${idx}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1 - (idx * 0.2), x: 0 }}
                            className="flex items-center gap-2"
                          >
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            <span className="text-xs text-slate-600 truncate">{item}</span>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {importStatus.isComplete && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50 border border-emerald-200 p-5 rounded-xl text-center">
                      <p className="text-2xl font-bold text-emerald-600">{importStatus.details?.imported}</p>
                      <p className="text-xs font-medium text-emerald-500 mt-1">Nuevos</p>
                    </div>
                    <div className="bg-rose-50 border border-rose-200 p-5 rounded-xl text-center">
                      <p className="text-2xl font-bold text-rose-600">{importStatus.details?.updated}</p>
                      <p className="text-xs font-medium text-rose-500 mt-1">Actualizados</p>
                    </div>
                  </div>
                )}

                {importStatus.error && (
                  <div className="bg-red-50 p-5 rounded-xl border border-red-200 space-y-3">
                    <div className="flex items-center gap-3">
                      <XCircle className="w-6 h-6 text-red-500" />
                      <p className="text-sm font-bold text-red-600">Error en la importación</p>
                    </div>
                    <p className="text-xs text-red-500">
                      {importStatus.error}
                    </p>
                  </div>
                )}

                {(!importStatus.isComplete && !importStatus.error) ? (
                  <div className="flex gap-3 w-full">
                    <button 
                      onClick={() => {
                        const updated = { ...((window as any).globalImportStatus || {}), isMinimized: true };
                        (window as any).globalImportStatus = updated;
                        setImportStatus(updated);
                        window.dispatchEvent(new CustomEvent('import-progress-update'));
                      }}
                      className="flex-1 py-3 bg-slate-150 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-all cursor-pointer border border-slate-300 active:scale-[0.98]"
                    >
                      Minimizar a Segundo Plano
                    </button>
                    <button 
                      disabled={true}
                      className="flex-1 py-3 rounded-lg text-xs font-semibold bg-rose-100 text-rose-500 cursor-not-allowed"
                    >
                      Procesando...
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => {
                      const updated = { ...((window as any).globalImportStatus || {}), show: false };
                      (window as any).globalImportStatus = updated;
                      setImportStatus(updated);
                      window.dispatchEvent(new CustomEvent('import-progress-update'));
                    }}
                    className="w-full py-3 rounded-lg text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white cursor-pointer active:scale-[0.98] transition-all"
                  >
                    {importStatus.isComplete ? 'Finalizar' : 'Cerrar y Reintentar'}
                  </button>
                )}
              </div>
            </motion.div>
        
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Images Sync Progress Modal */}
      <AnimatePresence>
        {isAssigningImages && showImageSyncModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-400 p-8 text-center space-y-6"
            >
              <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-rose-300 animate-spin [animation-duration:8s]"></div>
                <div className="absolute inset-2 rounded-full bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                  <Package className="w-8 h-8 animate-pulse text-rose-600" />
                </div>
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-800">{isHardwareStore ? 'Buscador de Fotos' : 'Buscador de Fotos por IA'}</h3>
                {isHardwareStore ? (
                  <p className="text-xs text-slate-700">Solo se asignan las fotos seguras; las dudosas quedan <span className="text-amber-600 font-bold">para revisar</span></p>
                ) : (
                  <p className="text-xs text-slate-700">Asignando imágenes de alta precisión <span className="text-rose-500 font-bold">en base blanca</span></p>
                )}
              </div>

              <div className="space-y-2">
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-rose-500 to-rose-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${imageSyncStatus.progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-700 font-semibold">
                  <span>{imageSyncStatus.current} de {imageSyncStatus.total} {isHardwareStore ? 'artículos (las medidas comparten foto)' : 'productos'}</span>
                  <span className="text-rose-650 font-bold">{imageSyncStatus.progress}%</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 bg-rose-50 border border-rose-100 p-2.5 rounded-xl">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  <p className="text-xs font-semibold text-rose-700 truncate max-w-full">
                    {imageSyncStatus.status}
                  </p>
                </div>

                {/* Live assignment metrics */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-50 border border-emerald-250 p-4 rounded-xl text-center">
                    <p className="text-xl font-extrabold text-emerald-700">{imageSyncStatus.successCount || 0}</p>
                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5 uppercase tracking-wider">{isHardwareStore ? 'Productos con foto' : 'Exitosas'}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-400 p-4 rounded-xl text-center">
                    <p className="text-xl font-extrabold text-slate-700">{imageSyncStatus.noMatchCount || 0}</p>
                    <p className="text-[10px] font-bold text-slate-700 mt-0.5 uppercase tracking-wider">{isHardwareStore ? 'Artículos sin resultado' : 'Sin Coincidencia'}</p>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-600 font-medium">
                {isHardwareStore
                  ? '🔒 Buscando en catálogos de Easy, Frávega, Carrefour, Más Online, OnCity y Jumbo. Las medidas de un mismo artículo comparten foto.'
                  : '🔒 Buscando en base de Open Food Facts Argentina y portales retail asociados (Carrefour, Coto, Día).'}
              </p>

              {/* Action buttons inside Modal: Minimize & Cancel */}
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => setShowImageSyncModal(false)}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer"
                >
                  Minimizar (Seguir en segundo plano)
                </button>
                <button
                  onClick={handleCancelAssignImages}
                  className="w-full border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 font-semibold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer"
                >
                  Cancelar Operación
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating background sync indicator */}
      {isAssigningImages && !showImageSyncModal && (
        <div 
          onClick={() => setShowImageSyncModal(true)}
          className="fixed bottom-6 right-6 z-[90] bg-white border border-rose-200 rounded-xl p-4 shadow-2xl flex items-center gap-4 cursor-pointer hover:bg-rose-50 transition-all select-none animate-bounce"
        >
          <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-150 flex items-center justify-center text-rose-600">
            <Loader2 className="w-5 h-5 animate-spin text-rose-600 shrink-0" />
          </div>
          <div className="text-left pr-2">
            <p className="text-xs font-bold text-slate-800">Cargando fotos con IA...</p>
            <p className="text-[10px] text-slate-700 font-semibold mt-0.5">{imageSyncStatus.current} / {imageSyncStatus.total} ({imageSyncStatus.progress}%)</p>
            <p className="text-[9px] font-bold text-slate-600 mt-0.5">🟢 {imageSyncStatus.successCount || 0} exitosas | ⚪ {imageSyncStatus.noMatchCount || 0} sin coincidencia</p>
          </div>
        </div>
      )}

      {/* Modal de Acciones Críticas de Inventario */}
      <AnimatePresence>
        {showBulkModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setShowBulkModal(false); setBulkAction(null); }}
            className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-400 p-6 space-y-5 overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-slate-300 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" /> Acciones de Limpieza Crítica
                </h3>
                <button onClick={() => { setShowBulkModal(false); setBulkAction(null); }} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600"><XCircle className="w-5 h-5" /></button>
              </div>

              {!bulkAction ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-700 font-medium leading-relaxed">
                    Seleccioná la operación de lote que deseas realizar. Estas acciones **no se pueden deshacer**.
                  </p>
                  <button 
                    onClick={() => { setBulkAction('reset'); setConfirmInput(''); }}
                    className="w-full p-4 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-left transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-amber-800">Resetear Stock de todos los productos a 0</p>
                    <p className="text-[10px] text-amber-600 font-semibold mt-1">Mantiene el catálogo pero pone el stock de todos en cero.</p>
                  </button>

                  <button 
                    onClick={() => { setBulkAction('remove_images'); setConfirmInput(''); }}
                    className="w-full p-4 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-left transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-rose-850">Remover imágenes de todos los productos</p>
                    <p className="text-[10px] text-rose-600 font-semibold mt-1">Restablece todas las fotos cargadas en los productos del catálogo.</p>
                  </button>

                  <button 
                    onClick={() => { setBulkAction('delete'); setConfirmInput(''); }}
                    className="w-full p-4 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-left transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-red-800">Eliminar todos los productos del catálogo</p>
                    <p className="text-[10px] text-red-650 font-semibold mt-1">Borra todo tu inventario por completo de la base de datos.</p>
                  </button>

                  <button 
                    onClick={() => { setBulkAction('delete_zero_negative'); setConfirmInput(''); }}
                    className="w-full p-4 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-left transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-red-800">Eliminar productos con stock cero o negativo</p>
                    <p className="text-[10px] text-red-650 font-semibold mt-1">Limpia tu base de datos eliminando productos sin stock real.</p>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-red-50 border border-red-150 text-red-700 text-xs font-semibold rounded-xl leading-relaxed">
                    ⚠️ Estás por: <span className="font-extrabold">{
                      bulkAction === 'reset' ? 'RESETEAR TODO EL STOCK A 0' : bulkAction === 'remove_images' ? 'REMOVER TODAS LAS IMÁGENES' : bulkAction === 'delete_zero_negative' ? 'ELIMINAR PRODUCTOS CON STOCK CERO O NEGATIVO' : 'BORRAR TODO TU CATÁLOGO DE PRODUCTOS'
                    }</span>. Esta acción es inmediata y definitiva.
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-450 uppercase tracking-wider mb-2">
                      Escribe <span className="text-red-600 font-extrabold">"{bulkAction === 'reset' ? 'RESETEAR' : bulkAction === 'remove_images' ? 'REMOVER' : bulkAction === 'delete_zero_negative' ? 'DEPURAR' : 'BORRAR'}"</span> para confirmar:
                    </label>
                    <input 
                      type="text" 
                      value={confirmInput} 
                      onChange={(e) => setConfirmInput(e.target.value)} 
                      className="w-full bg-slate-50 border border-slate-400 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100 transition-all shadow-inner uppercase" 
                      placeholder={`Escribe aquí en mayúsculas...`} 
                      autoFocus 
                    />
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={executeBulkAction}
                      disabled={confirmInput.toUpperCase() !== (bulkAction === 'reset' ? 'RESETEAR' : bulkAction === 'remove_images' ? 'REMOVER' : bulkAction === 'delete_zero_negative' ? 'DEPURAR' : 'BORRAR')}
                      className="flex-1 bg-red-500 hover:bg-red-600 text-white font-extrabold py-3 rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      Confirmar Operación
                    </button>
                    <button 
                      onClick={() => setBulkAction(null)}
                      className="px-5 py-3 rounded-xl border border-slate-400 text-slate-700 hover:bg-slate-50 font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
                    >
                      Volver
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Modal for Bulk Category Change */}
      <AnimatePresence>
        {showBulkCategoryModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.95, opacity: 0 }} 
              className="bg-white rounded-2xl w-full max-w-md p-6 border border-slate-300 shadow-2xl space-y-4 relative animate-in zoom-in-95 duration-200"
            >
              <div>
                <h3 className="text-sm font-bold text-slate-850 uppercase tracking-wider">Cambiar Categoría en Lote</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">
                  Se modificará la categoría de {selectedIds.length} productos seleccionados.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-[9px] font-bold text-slate-600 uppercase tracking-wider">Selecciona la Nueva Categoría</label>
                <select 
                  value={selectedBulkCategory} 
                  onChange={(e) => setSelectedBulkCategory(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-xs font-bold text-slate-800 outline-none focus:border-rose-500 transition-all cursor-pointer"
                >
                  <option value="">Selecciona una categoría...</option>
                  {categories.map((cat: any) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-slate-200 flex gap-3">
                <button 
                  onClick={handleBulkUpdateCategory}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md active:scale-95 transition-all cursor-pointer"
                >
                  Aplicar Cambios
                </button>
                <button 
                  onClick={() => {
                    setShowBulkCategoryModal(false);
                    setSelectedBulkCategory('');
                  }}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs uppercase tracking-wider rounded-xl active:scale-95 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating bulk actions for selected items */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div 
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-800 rounded-xl py-3 px-5 shadow-2xl flex items-center gap-4 z-[120] select-none"
          >
            <div className="text-xs font-bold text-white whitespace-nowrap">
              <span className="text-rose-500 font-extrabold text-sm mr-1">{selectedIds.length}</span> seleccionados
            </div>
            <div className="w-[1px] h-6 bg-slate-800" />
            <div className="flex items-center gap-2">
              <button 
                onClick={handleRemoveImagesForSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-650 hover:bg-rose-700 active:scale-95 text-[11px] font-bold text-white transition-all cursor-pointer"
              >
                <Package className="w-3.5 h-3.5 text-rose-300" />
                <span>Quitar Imágenes</span>
              </button>
              <button 
                onClick={() => setShowBulkCategoryModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-650 hover:bg-emerald-700 active:scale-95 text-[11px] font-bold text-white transition-all cursor-pointer"
              >
                <Package className="w-3.5 h-3.5 text-emerald-300" />
                <span>Cambiar Categoría</span>
              </button>
              <button 
                onClick={handleDeleteSelected}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-655 hover:bg-red-700 active:scale-95 text-[11px] font-bold text-white transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-300" />
                <span>Eliminar Productos</span>
              </button>
              <button 
                onClick={() => setSelectedIds([])}
                className="px-3 py-1.5 rounded-lg border border-slate-700 text-slate-350 hover:bg-slate-800 active:scale-95 text-[11px] font-bold transition-all cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showRoundPrices && (
        <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2.5">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-xl"><ArrowUpCircle className="w-5 h-5" /></div>
              <div>
                <h2 className="text-base font-bold text-slate-800">Redondear precios</h2>
                <p className="text-xs text-slate-500">Hacia arriba, a múltiplos de 10</p>
              </div>
            </div>
            <div className="p-6 space-y-3 text-sm text-slate-700">
              <p>Se redondean los precios de venta de <b>todos los productos activos</b>, siempre hacia arriba, para que no queden con decimales.</p>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                <p className="flex justify-between"><span className="text-slate-500">$ 1.912,28</span> <b>$ 1.920</b></p>
                <p className="flex justify-between"><span className="text-slate-500">$ 20.270,46</span> <b>$ 20.280</b></p>
                <p className="flex justify-between"><span className="text-slate-500">$ 3.560</span> <b>$ 3.560 (sin cambios)</b></p>
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                El costo y el margen no se tocan: al subir el precio, el margen queda un poco más alto.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button onClick={() => setShowRoundPrices(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={handleRoundPrices}
                disabled={isRoundingPrices}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-50"
              >
                {isRoundingPrices ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}
                Redondear precios
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showImageReview && (
        <ImageReviewModal
          onClose={() => { setShowImageReview(false); refreshImageReviewCount(); loadProducts(true); }}
          onChanged={() => setPendingImageReviews(n => Math.max(0, n - 1))}
        />
      )}

      {showVentraImport && (
        <VentraImportModal
          onClose={() => setShowVentraImport(false)}
          onConfirm={handleVentraImport}
          onLegacyImport={handleLegacyImport}
        />
      )}

      {showBulkPriceModal && (
        <BulkPriceModal
          onClose={() => setShowBulkPriceModal(false)}
          onSuccess={() => loadProducts(true)}
        />
      )}

      {showBarcodeLabels && (
        <BarcodeLabelModal
          onClose={() => setShowBarcodeLabels(false)}
          onBarcodesAssigned={() => loadProducts(true)}
        />
      )}

      {showGaveteroLabels && (
        <GaveteroLabelModal
          products={products}
          onClose={() => setShowGaveteroLabels(false)}
        />
      )}
    </div>
  );
}
