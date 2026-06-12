import { useState, useEffect } from 'react';
import api from '../../services/api';
import { X, Search, AlertTriangle, Truck, Plus, Check, Printer, RefreshCw, Pencil, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

interface LowStockAlertsModalProps {
  onClose: () => void;
}

export default function LowStockAlertsModal({ onClose }: LowStockAlertsModalProps) {
  const [products, setProducts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStock, setEditingStock] = useState<number>(0);
  const [isSavingStock, setIsSavingStock] = useState(false);

  useEffect(() => {
    loadLowStockProducts();
  }, []);

  const loadLowStockProducts = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/products', { params: { lowStock: 'true' } });
      setProducts(data || []);
    } catch {
      toast.error('Error al cargar productos con stock bajo');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartEdit = (product: any) => {
    setEditingId(product.id);
    setEditingStock(product.stock);
  };

  const handleSaveStock = async (product: any) => {
    if (editingStock === product.stock) {
      setEditingId(null);
      return;
    }
    setIsSavingStock(true);
    try {
      const diff = editingStock - product.stock;
      const type = diff > 0 ? 'ENTRY' : 'EXIT';
      
      await api.post(`/products/${product.id}/movement`, {
        type,
        quantity: Math.abs(diff),
        reason: 'Ajuste rápido desde alerta de stock'
      });
      
      toast.success(`Stock de "${product.name}" actualizado a ${editingStock}`);
      setEditingId(null);
      // Reload products list
      loadLowStockProducts();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al actualizar el stock');
    } finally {
      setIsSavingStock(false);
    }
  };

  const handlePrintDraft = () => {
    window.print();
  };

  const formatPrice = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (p.barcode && p.barcode.includes(searchQuery)) ||
    (p.supplier?.name && p.supplier.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div 
        initial={{ scale: 0.98, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.98, opacity: 0 }}
        className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
      >
        <style>{`
          @media print {
            body * {
              visibility: hidden !important;
            }
            #printable-stock-report, #printable-stock-report * {
              visibility: visible !important;
            }
            #printable-stock-report {
              display: block !important;
              position: fixed !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              height: 100% !important;
              background: white !important;
              z-index: 9999999 !important;
              font-family: 'Helvetica Neue', Arial, sans-serif !important;
              color: #1e293b !important;
              padding: 15mm !important;
            }
            @page {
              size: A4;
              margin: 0;
            }
          }
        `}</style>

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2">
                Productos con Alerta de Stock
                <span className="bg-rose-100 text-rose-700 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  {products.length} Críticos
                </span>
              </h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Control de reabastecimiento en tiempo real</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={loadLowStockProducts} 
              className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-all text-slate-500 hover:text-slate-700 active:scale-95"
              title="Refrescar lista"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={onClose} 
              className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-rose-500 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search and Quick Filters */}
        <div className="px-6 py-4.5 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-455" />
            <input 
              type="text" 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              placeholder="Buscar por producto, código o proveedor..." 
              className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-4 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-amber-400 transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')} 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-650"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={handlePrintDraft}
              disabled={filteredProducts.length === 0}
              className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 font-bold text-xs flex items-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Printer className="w-4 h-4 text-slate-500" /> Imprimir Hoja de Compras
            </button>
          </div>
        </div>

        {/* Content Panel */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/30">
          {isLoading ? (
            <div className="py-24 flex flex-col items-center justify-center text-slate-400 gap-3">
              <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-bold uppercase tracking-widest">Cargando alertas de inventario...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-20 text-center max-w-sm mx-auto">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-100 shadow-inner">
                <Check className="w-8 h-8" />
              </div>
              <h4 className="text-base font-bold text-slate-800 mb-1">Todo en Balance</h4>
              <p className="text-xs text-slate-400 font-medium leading-relaxed">No se encontraron productos con stock crítico bajo los filtros ingresados.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200/85 overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                    <th className="py-3.5 px-4 w-[40%]">Producto / Categoría</th>
                    <th className="py-3.5 px-4 text-center">Stock Actual</th>
                    <th className="py-3.5 px-4 text-center">Mín. Requerido</th>
                    <th className="py-3.5 px-4">Proveedor / Contacto</th>
                    <th className="py-3.5 px-4 text-right">Precios</th>
                    <th className="py-3.5 px-4 text-center w-[120px]">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => {
                    const isEditing = editingId === p.id;
                    const stockRatio = Math.max(0, p.stock / (p.minStock || 1));
                    const isNegative = p.stock < 0;
                    const isZero = p.stock === 0;

                    return (
                      <tr key={p.id} className="border-b border-slate-100/70 hover:bg-slate-50/40 transition-colors font-medium">
                        {/* Info */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            {p.imageUrl ? (
                              <img src={p.imageUrl} className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" alt="" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold shrink-0 border border-amber-100">
                                {p.name[0]?.toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-bold text-slate-800 truncate" title={p.name}>{p.name}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span 
                                  className="text-[9px] font-bold px-2 py-0.5 rounded-md inline-block uppercase tracking-wider" 
                                  style={{ backgroundColor: `${p.category?.color || '#e11d48'}12`, color: p.category?.color || '#e11d48' }}
                                >
                                  {p.category?.name || 'Sin Cat.'}
                                </span>
                                {p.barcode && (
                                  <span className="text-[9px] text-slate-400 font-mono tracking-tight bg-slate-100 px-1.5 py-0.2 rounded border border-slate-150">
                                    {p.barcode}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Stock status & progress bar */}
                        <td className="py-3.5 px-4 text-center">
                          {isEditing ? (
                            <input 
                              type="number" 
                              value={editingStock} 
                              onChange={(e) => setEditingStock(Number(e.target.value))} 
                              className="w-16 bg-amber-50 border border-amber-300 rounded px-2 py-1 text-center font-bold text-slate-800 outline-none"
                              autoFocus
                            />
                          ) : (
                            <div className="inline-flex flex-col items-center gap-1.5">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                                isNegative 
                                  ? 'bg-rose-50 border-rose-200 text-rose-700' 
                                  : isZero 
                                    ? 'bg-rose-50 border-rose-200 text-rose-600 animate-pulse'
                                    : 'bg-amber-50 border-amber-200 text-amber-700'
                              }`}>
                                {p.stock} {p.unit || 'U'}
                              </span>
                              
                              {/* Stock ratio visual indicator */}
                              <div className="w-16 h-1 bg-slate-100 rounded-full overflow-hidden shrink-0 hidden sm:block">
                                <div 
                                  className={`h-full ${isNegative || isZero ? 'bg-rose-500' : 'bg-amber-500'}`} 
                                  style={{ width: `${Math.min(100, stockRatio * 100)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Minimum Required */}
                        <td className="py-3.5 px-4 text-center text-slate-500 font-bold">
                          {p.minStock} {p.unit || 'U'}
                        </td>

                        {/* Supplier Info */}
                        <td className="py-3.5 px-4">
                          {p.supplier ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-slate-700 flex items-center gap-1">
                                <Truck className="w-3.5 h-3.5 text-indigo-500" /> {p.supplier.name}
                              </span>
                              {p.supplier.phone && (
                                <span className="text-[10px] text-slate-400 font-semibold tracking-tight">
                                  📞 {p.supplier.phone}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-350 italic text-[11px]">Sin proveedor asignado</span>
                          )}
                        </td>

                        {/* Prices */}
                        <td className="py-3.5 px-4 text-right">
                          <p className="text-slate-400 font-semibold text-[10px]">Costo: {formatPrice(p.costPrice)}</p>
                          <p className="font-extrabold text-rose-600 text-xs mt-0.5">Venta: {formatPrice(p.salePrice)}</p>
                        </td>

                        {/* Quick stock adjustment actions */}
                        <td className="py-3.5 px-4 text-center">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button 
                                onClick={() => handleSaveStock(p)}
                                disabled={isSavingStock}
                                className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg shadow transition-all active:scale-90 disabled:opacity-50"
                                title="Guardar Ajuste"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setEditingId(null)}
                                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg border border-slate-250 transition-all active:scale-90"
                                title="Cancelar"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={() => handleStartEdit(p)}
                              className="px-3 py-1.5 bg-slate-50 hover:bg-amber-50 hover:text-amber-700 text-slate-500 rounded-xl border border-slate-200 hover:border-amber-300 transition-all font-bold text-[10px] uppercase flex items-center justify-center gap-1 mx-auto active:scale-95 cursor-pointer"
                              title="Ajustar Stock Rápido"
                            >
                              <Pencil className="w-3 h-3" /> Ajustar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Mostrando {filteredProducts.length} de {products.length} alertas registradas
          </p>
          <button 
            onClick={onClose} 
            className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            Cerrar Panel
          </button>
        </div>

        {/* Printable PDF/Paper Layout (Hidden on Screen) */}
        <div id="printable-stock-report" className="hidden">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #e2e8f0', paddingBottom: '4mm', marginBottom: '6mm' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#b45309' }}>HOJA DE PEDIDO DE REABASTECIMIENTO</h1>
              <p style={{ margin: '1mm 0 0 0', fontSize: '10px', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>GO! Punto de Venta — Alertas de Stock Bajo</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: '10px', color: '#64748b', fontWeight: 'bold' }}>Emitido: {new Date().toLocaleString('es-AR')}</p>
              <p style={{ margin: '1mm 0 0 0', fontSize: '11px', fontWeight: 'bold', color: '#ef4444' }}>{products.length} productos bajo el mínimo</p>
            </div>
          </div>

          <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #94a3b8', color: '#334155', fontWeight: 'bold', background: '#f8fafc' }}>
                <th style={{ textAlign: 'left', padding: '6px' }}>Producto</th>
                <th style={{ textAlign: 'left', padding: '6px' }}>Código</th>
                <th style={{ textAlign: 'center', padding: '6px' }}>Stock Actual</th>
                <th style={{ textAlign: 'center', padding: '6px' }}>Stock Mín.</th>
                <th style={{ textAlign: 'left', padding: '6px' }}>Proveedor / Contacto</th>
                <th style={{ textAlign: 'right', padding: '6px' }}>Precio Costo</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '6px', fontWeight: 'bold' }}>{p.name}</td>
                  <td style={{ padding: '6px', fontFamily: 'monospace' }}>{p.barcode || '---'}</td>
                  <td style={{ padding: '6px', textAlign: 'center', fontWeight: 'bold', color: p.stock <= 0 ? '#ef4444' : '#b45309' }}>{p.stock}</td>
                  <td style={{ padding: '6px', textAlign: 'center', color: '#64748b' }}>{p.minStock}</td>
                  <td style={{ padding: '6px' }}>{p.supplier ? `${p.supplier.name} ${p.supplier.phone ? `(${p.supplier.phone})` : ''}` : '---'}</td>
                  <td style={{ padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>{formatPrice(p.costPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: '15mm', borderTop: '1px solid #94a3b8', paddingTop: '4mm', display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontWeight: 'bold' }}>
            <div>Firma de Responsable Compras: __________________________</div>
            <div>Página 1 de 1</div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
