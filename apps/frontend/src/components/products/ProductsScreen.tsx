import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Megaphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ProductModal from './ProductModal';
import { toast } from 'react-hot-toast';
import { wsService } from '../../services/websocket';

export default function ProductsScreen() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [importStatus, setImportStatus] = useState<{
    show: boolean;
    progress: number;
    total: number;
    current: number;
    status: string;
    isComplete: boolean;
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
    error: null,
    recentItems: []
  });
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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
  const isLoadingRef = useRef(false);

  useEffect(() => {
    loadProducts();
    
    wsService.connect();
    wsService.on('import:progress', (data: any) => {
      setImportStatus(prev => ({
        ...prev,
        progress: data.progress,
        total: data.total,
        current: data.current,
        status: data.status,
        details: data.details,
        recentItems: [data.details?.lastItem, ...prev.recentItems].filter(Boolean).slice(0, 5)
      }));
    });

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
      } else {
        setIsAssigningImages(true);
      }
    });

    return () => {
      wsService.off('import:progress');
      wsService.off('sync:images:progress');
    };
  }, []);

  const loadProducts = async (isInitial = true) => {
    if (!isInitial && isLoadingRef.current) return;
    isLoadingRef.current = true;

    if (isInitial) {
      setIsLoading(true);
      setProducts([]);
      setSkip(0);
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }
    
    try {
      const currentSkip = isInitial ? 0 : skip + take;
      const { data } = await api.get('/products', {
        params: { 
          search: searchQuery,
          categoryId: selectedCategory || undefined,
          skip: currentSkip,
          take
        }
      });
      
      if (isInitial) {
        setProducts(data);
      } else {
        setProducts(prev => [...prev, ...data]);
      }
      
      setSkip(currentSkip);
      setHasMore(data.length === take);
    } catch (err) {
      toast.error('Error al cargar productos');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      isLoadingRef.current = false;
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
    loadProducts(true);
  }, [searchQuery, selectedCategory]);

  useEffect(() => {
    loadCategories();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;
    try {
      await api.delete(`/products/${id}`);
      toast.success('Producto eliminado');
      loadProducts();
    } catch (err) {
      toast.error('Error al eliminar producto');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setImportStatus({
      show: true,
      progress: 0,
      total: 0,
      current: 0,
      status: 'Iniciando importación...',
      isComplete: false,
      error: null,
      recentItems: []
    });

    try {
      await api.post('/products/import', formData);
      setImportStatus(prev => ({ ...prev, isComplete: true, status: '¡Importación finalizada con éxito!' }));
      loadProducts();
      setTimeout(() => {
        setImportStatus(prev => ({ ...prev, show: false }));
      }, 3000);
    } catch (err: any) {
      setImportStatus(prev => ({ 
        ...prev, 
        error: err.response?.data?.message || 'Error al importar archivo',
        status: 'Error en la importación'
      }));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
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

    const loadingToast = toast.loading('Asignando fotos con IA...');

    try {
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
      await api.post('/products/auto-assign-images/cancel');
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
      <div className="bg-white p-5 rounded-xl border border-slate-400 space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
            <input 
              type="text" 
              placeholder="Nombre o código... (Enter para editar)" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && searchQuery) {
                  try {
                    const { data } = await api.get(`/products/barcode/${searchQuery}`);
                    if (data) {
                      setSelectedProduct(data);
                      setShowModal(true);
                      setSearchQuery('');
                    }
                  } catch (err) {
                    // Not a barcode or not found - automatically open modal to create with this barcode
                    setSelectedProduct({ barcode: searchQuery });
                    setShowModal(true);
                    setSearchQuery('');
                  }
                }
              }}
              className="w-full bg-slate-50 border border-slate-400 rounded-lg pl-10 pr-4 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-600 focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all outline-none"
            />
          </div>
          <div className="flex items-center justify-between md:justify-start gap-2">
            <div className="flex-1 md:flex-none flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-400">
               <Filter className="w-4 h-4 text-slate-600 ml-2" />
               <select 
                 value={selectedCategory || ''}
                 onChange={(e) => setSelectedCategory(e.target.value || null)}
                 className="bg-transparent text-xs font-medium text-slate-600 py-1.5 pr-4 outline-none cursor-pointer w-full"
               >
                 <option value="">Todas las categorías</option>
                 {categories.filter(c => c._count?.products > 0).map(cat => (
                   <option key={cat.id} value={cat.id}>{cat.name}</option>
                 ))}
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
              <button 
                onClick={() => { navigate('/marketing'); }}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-[11px] font-bold hover:from-purple-700 hover:to-indigo-700 active:scale-[0.97] transition-all cursor-pointer shadow-sm"
              >
                  <Megaphone className="w-3.5 h-3.5" /> <span>Marketing & Etiquetas</span>
              </button>



              <div className="col-span-2 flex items-center justify-between gap-1 w-full sm:w-auto mt-1 sm:mt-0 pt-2 sm:pt-0 border-t border-slate-300 sm:border-t-0">
                <div className="flex items-center gap-1">
                  <button 
                    onClick={handleImportClick}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-400 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition-all cursor-pointer"
                    title="Importar"
                  >
                      <Upload className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={handleExportClick}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-400 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition-all cursor-pointer"
                    title="Exportar"
                  >
                      <Download className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => loadProducts(true)} className="p-2 rounded-lg border border-slate-400 bg-slate-50 text-slate-450 hover:text-rose-500 hover:bg-slate-100 transition-all cursor-pointer">
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button 
                    onClick={handleAssignImages}
                    disabled={isAssigningImages}
                    className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-[11px] font-semibold hover:bg-indigo-100 transition-all disabled:opacity-50 cursor-pointer active:scale-95"
                  >
                      {isAssigningImages ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                      ) : (
                        <Package className="w-3.5 h-3.5 text-indigo-500" />
                      )}
                      <span>Asignar Fotos</span>
                  </button>
                  <button 
                    onClick={() => { setBulkAction(null); setConfirmInput(''); setShowBulkModal(true); }}
                    className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-red-200 bg-red-50 text-red-655 text-[11px] font-semibold hover:bg-red-100 transition-all cursor-pointer active:scale-95"
                  >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      <span>Acciones</span>
                  </button>
                </div>
              </div>
           </div>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-1 bg-white rounded-xl border border-slate-400 flex flex-col overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] z-10 flex items-center justify-center">
             <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-6 h-6 text-rose-500 animate-spin" />
                <p className="text-xs font-medium text-slate-600">Cargando inventario...</p>
             </div>
          </div>
        )}

        <div className="flex-1 overflow-auto custom-scrollbar">
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
                  <th className="px-4 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider w-[27%]">Producto</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider w-[15%]">Categoría</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider w-[12%]">Marca</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[10%]">Stock</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[10%]">Costo</th>
                  <th className="px-3 py-3 text-[10px] font-semibold text-slate-700 uppercase tracking-wider text-center w-[10%]">Venta</th>
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
                      onClick={() => toggleSelectProduct(p.id)}
                      className={`hover:bg-slate-50 transition-colors group cursor-pointer ${isSelected ? 'bg-rose-50/30' : ''}`}
                    >
                      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={() => toggleSelectProduct(p.id)}
                          className="w-4 h-4 rounded text-rose-600 border-slate-300 focus:ring-rose-500 cursor-pointer"
                        />
                      </td>
                       <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                           <div className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 overflow-hidden border border-slate-400">
                              <img 
                                src={p.imageUrl || './product-placeholder.png'} 
                                alt="" 
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
                      <td className="px-3 py-3">
                         <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 whitespace-nowrap overflow-hidden text-ellipsis">
                           <Bookmark className="w-3 h-3 text-slate-600 shrink-0" /> {p.brand?.name || 'Varios'}
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
                         $ {p.costPrice.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-center">
                         <span className="text-sm font-bold text-slate-800 whitespace-nowrap">$ {p.salePrice.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                         <div className="flex items-center justify-center gap-2">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${parseFloat(margin) > 40 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                                {margin}%
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button 
                                  onClick={(e) => { e.stopPropagation(); setSelectedProduct(p); setShowModal(true); }}
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
                  <tr ref={(el) => {
                    if (!el || isLoadingMore) return;
                    const observer = new IntersectionObserver((entries) => {
                      if (entries[0].isIntersecting && hasMore) {
                        setIsLoadingMore(true);
                        loadProducts(false);
                      }
                    }, { threshold: 0.1 });
                    observer.observe(el);
                  }}>
                    <td colSpan={6} className="py-8 text-center">
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

      {/* Modals */}
      <AnimatePresence>
        {showModal && (
          <ProductModal 
            onClose={() => setShowModal(false)} 
            onSuccess={loadProducts}
            product={selectedProduct}
          />
        )}
      </AnimatePresence>

      {/* Import Progress Modal */}
      <AnimatePresence>
        {importStatus.show && (
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

                <button 
                  onClick={() => setImportStatus(prev => ({ ...prev, show: false }))}
                  disabled={!importStatus.isComplete && !importStatus.error}
                  className={`w-full py-3 rounded-lg text-sm font-semibold transition-all
                    ${(importStatus.isComplete || importStatus.error) 
                      ? 'bg-rose-600 hover:bg-rose-700 text-white' 
                      : 'bg-slate-100 text-slate-600 cursor-not-allowed'}`}
                >
                  {importStatus.isComplete ? 'Finalizar' : importStatus.error ? 'Cerrar y Reintentar' : 'Procesando...'}
                </button>
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
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-indigo-300 animate-spin [animation-duration:8s]"></div>
                <div className="absolute inset-2 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                  <Package className="w-8 h-8 animate-pulse text-indigo-600" />
                </div>
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-800">Buscador de Fotos por IA</h3>
                <p className="text-xs text-slate-700">Asignando imágenes de alta precisión <span className="text-indigo-500 font-bold">en base blanca</span></p>
              </div>

              <div className="space-y-2">
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${imageSyncStatus.progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-700 font-semibold">
                  <span>{imageSyncStatus.current} de {imageSyncStatus.total} productos</span>
                  <span className="text-indigo-650 font-bold">{imageSyncStatus.progress}%</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 bg-indigo-50 border border-indigo-100 p-2.5 rounded-xl">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse shrink-0" />
                  <p className="text-xs font-semibold text-indigo-700 truncate max-w-full">
                    {imageSyncStatus.status}
                  </p>
                </div>

                {/* Live assignment metrics */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-50 border border-emerald-250 p-4 rounded-xl text-center">
                    <p className="text-xl font-extrabold text-emerald-700">{imageSyncStatus.successCount || 0}</p>
                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5 uppercase tracking-wider">Exitosas</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-400 p-4 rounded-xl text-center">
                    <p className="text-xl font-extrabold text-slate-700">{imageSyncStatus.noMatchCount || 0}</p>
                    <p className="text-[10px] font-bold text-slate-700 mt-0.5 uppercase tracking-wider">Sin Coincidencia</p>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-600 font-medium">
                🔒 Buscando en base de Open Food Facts Argentina y portales retail asociados (Carrefour, Coto, Día).
              </p>

              {/* Action buttons inside Modal: Minimize & Cancel */}
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => setShowImageSyncModal(false)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer"
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
          className="fixed bottom-6 right-6 z-[90] bg-white border border-indigo-200 rounded-xl p-4 shadow-2xl flex items-center gap-4 cursor-pointer hover:bg-indigo-50 transition-all select-none animate-bounce"
        >
          <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-150 flex items-center justify-center text-indigo-600">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-600 shrink-0" />
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
                    className="w-full p-4 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-left transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <p className="text-xs font-extrabold text-indigo-850">Remover imágenes de todos los productos</p>
                    <p className="text-[10px] text-indigo-600 font-semibold mt-1">Restablece todas las fotos cargadas en los productos del catálogo.</p>
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
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-md active:scale-95 transition-all cursor-pointer"
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-650 hover:bg-indigo-700 active:scale-95 text-[11px] font-bold text-white transition-all cursor-pointer"
              >
                <Package className="w-3.5 h-3.5 text-indigo-300" />
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
    </div>
  );
}
