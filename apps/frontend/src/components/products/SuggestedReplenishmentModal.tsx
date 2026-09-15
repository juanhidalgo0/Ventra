import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import { 
  X, 
  Package, 
  Search, 
  Send, 
  Download, 
  Printer, 
  Building2, 
  AlertTriangle, 
  CheckCircle2, 
  Phone, 
  Mail,
  DollarSign
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface SuggestedReplenishmentModalProps {
  onClose: () => void;
}

export default function SuggestedReplenishmentModal({ onClose }: SuggestedReplenishmentModalProps) {
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [adjustedQtys, setAdjustedQtys] = useState<{ [productId: string]: number }>({});

  useEffect(() => {
    loadSuggested();
  }, []);

  const loadSuggested = async () => {
    setIsLoading(true);
    try {
      const { data } = await api.get('/purchases/suggested-replenishment');
      setItems(data);
      const initialQtys: { [id: string]: number } = {};
      data.forEach((i: any) => {
        initialQtys[i.productId] = i.suggestedQty;
      });
      setAdjustedQtys(initialQtys);
    } catch (err) {
      console.error('Error cargando pedido sugerido:', err);
      toast.error('Error al cargar pedido sugerido');
    } finally {
      setIsLoading(false);
    }
  };

  // Group items by supplier
  const supplierGroups: Record<string, { supplier: any; items: any[] }> = items.reduce((acc: Record<string, { supplier: any; items: any[] }>, item: any) => {
    const sId = item.supplier?.id || 'UNASSIGNED';
    if (!acc[sId]) {
      acc[sId] = {
        supplier: item.supplier,
        items: []
      };
    }
    acc[sId].items.push(item);
    return acc;
  }, {});

  const suppliersList: { supplier: any; items: any[] }[] = Object.values(supplierGroups);

  const filteredGroups = suppliersList.filter((g: { supplier: any; items: any[] }) => {
    if (selectedSupplierId !== 'ALL' && g.supplier?.id !== selectedSupplierId) return false;
    return true;
  }).map((g: { supplier: any; items: any[] }) => {
    if (!search) return g;
    const term = search.toLowerCase();
    const filteredItems = g.items.filter(i => 
      i.name.toLowerCase().includes(term) || 
      (i.barcode && i.barcode.includes(term)) ||
      (i.sku && i.sku.toLowerCase().includes(term))
    );
    return { ...g, items: filteredItems };
  }).filter(g => g.items.length > 0);

  const handleSendWhatsApp = (group: any) => {
    const phone = group.supplier?.phone?.replace(/[^0-9]/g, '');
    let text = `Hola ${group.supplier?.name || 'Proveedor'}, te paso el pedido de reposición de mercadería:\n\n`;
    group.items.forEach((item: any) => {
      const qty = adjustedQtys[item.productId] !== undefined ? adjustedQtys[item.productId] : item.suggestedQty;
      if (qty > 0) {
        text += `• ${qty} un. - ${item.name} ${item.sku ? `(Cód: ${item.sku})` : ''}\n`;
      }
    });
    text += `\nPor favor confirmar disponibilidad y plazo de entrega. Muchas gracias!`;

    const encoded = encodeURIComponent(text);
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
    } else {
      navigator.clipboard.writeText(text);
      toast.success('Mensaje copiado al portapapeles (el proveedor no tiene teléfono cargado)');
    }
  };

  const totalEstimatedCost = filteredGroups.reduce((acc, g) => {
    return acc + g.items.reduce((s: number, i: any) => {
      const q = adjustedQtys[i.productId] !== undefined ? adjustedQtys[i.productId] : i.suggestedQty;
      return s + (q * (i.costPrice || 0));
    }, 0);
  }, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[86vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-slate-800 dark:text-white">Reposición Automática de Stock</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  Pedido Sugerido a Proveedor
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Detecta productos con stock por debajo del mínimo y calcula unidades sugeridas de compra</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar por artículo o código..."
                className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <select
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 outline-none cursor-pointer"
            >
              <option value="ALL">Todos los Proveedores ({suppliersList.length})</option>
              {suppliersList.map(g => (
                <option key={g.supplier?.id || 'UNASSIGNED'} value={g.supplier?.id || 'UNASSIGNED'}>
                  {g.supplier?.name} ({g.items.length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] text-slate-400 uppercase font-bold">Inversión Estimada</p>
              <p className="text-sm font-mono font-black text-slate-900 dark:text-white">
                $${totalEstimatedCost.toLocaleString()}
              </p>
            </div>
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400">
              <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mb-2" />
              <span className="text-xs">Analizando niveles de stock y mínimos de seguridad...</span>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 stroke-1 mb-2" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">¡Stock en niveles óptimos!</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1">No hay productos activos con stock por debajo del mínimo de seguridad configurado.</p>
            </div>
          ) : (
            filteredGroups.map(group => {
              const groupBudget = group.items.reduce((s: number, i: any) => {
                const q = adjustedQtys[i.productId] !== undefined ? adjustedQtys[i.productId] : i.suggestedQty;
                return s + (q * (i.costPrice || 0));
              }, 0);

              return (
                <div key={group.supplier?.id || 'UNASSIGNED'} className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
                  {/* Supplier Card Header */}
                  <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-850/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Building2 className="w-4 h-4 text-amber-500" />
                      <div>
                        <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                          {group.supplier?.name}
                        </h3>
                        {group.supplier?.phone && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <Phone className="w-2.5 h-2.5" /> {group.supplier.phone}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300 mr-2">
                        Subtotal: $${groupBudget.toLocaleString()}
                      </span>
                      <button
                        onClick={() => handleSendWhatsApp(group)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                        title="Enviar pedido por WhatsApp"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Pedir por WhatsApp
                      </button>
                    </div>
                  </div>

                  {/* Table of items */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/40 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-[10px] uppercase font-bold text-slate-400">
                        <tr>
                          <th className="px-4 py-2">Artículo</th>
                          <th className="px-3 py-2 text-center">Stock Actual</th>
                          <th className="px-3 py-2 text-center">Mínimo</th>
                          <th className="px-3 py-2 text-center">Sugerido</th>
                          <th className="px-3 py-2 text-center">Cant. a Pedir</th>
                          <th className="px-3 py-2 text-right">Costo Unit.</th>
                          <th className="px-4 py-2 text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {group.items.map((item: any) => {
                          const currentQty = adjustedQtys[item.productId] !== undefined ? adjustedQtys[item.productId] : item.suggestedQty;
                          const lineTotal = currentQty * (item.costPrice || 0);

                          return (
                            <tr key={item.productId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                              <td className="px-4 py-2.5">
                                <p className="font-bold text-slate-800 dark:text-slate-200">{item.name}</p>
                                {item.sku && <span className="text-[10px] font-mono text-slate-400">SKU: {item.sku}</span>}
                              </td>
                              <td className="px-3 py-2.5 text-center font-mono font-bold text-rose-600 dark:text-rose-400">
                                {item.stock} {item.unit || 'un'}
                              </td>
                              <td className="px-3 py-2.5 text-center font-mono text-slate-500">
                                {item.minStock}
                              </td>
                              <td className="px-3 py-2.5 text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                                +{item.suggestedQty}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <input 
                                  type="number"
                                  min="0"
                                  value={currentQty}
                                  onChange={(e) => {
                                    const val = Math.max(0, parseInt(e.target.value) || 0);
                                    setAdjustedQtys(prev => ({ ...prev, [item.productId]: val }));
                                  }}
                                  className="w-16 px-2 py-1 text-center font-mono font-bold text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-amber-500"
                                />
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-slate-500">
                                $${(item.costPrice || 0).toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                                $${lineTotal.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}
