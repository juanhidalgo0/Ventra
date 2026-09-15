import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { 
  X, 
  Package, 
  Search, 
  Truck, 
  CheckCircle2, 
  Clock, 
  Printer, 
  ChevronRight, 
  Send, 
  FileText, 
  User, 
  MapPin, 
  Calendar,
  AlertCircle
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface AcopioModalProps {
  onClose: () => void;
}

export default function AcopioModal({ onClose }: AcopioModalProps) {
  const [acopios, setAcopios] = useState<any[]>([]);
  const [selectedAcopio, setSelectedAcopio] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'PARTIAL' | 'COMPLETED'>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  // Delivery receipt form state
  const [isCreatingRemito, setIsCreatingRemito] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<{ [itemId: string]: number }>({});
  const [receiverName, setReceiverName] = useState('');
  const [driverName, setDriverName] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmittingRemito, setIsSubmittingRemito] = useState(false);

  // Printing state
  const [remitoToPrint, setRemitoToPrint] = useState<any | null>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAcopios();
  }, [statusFilter]);

  const loadAcopios = async () => {
    setIsLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (search) params.search = search;
      const { data } = await api.get('/acopio', { params });
      setAcopios(data);
      if (selectedAcopio) {
        const updated = data.find((a: any) => a.id === selectedAcopio.id);
        if (updated) setSelectedAcopio(updated);
      }
    } catch (err) {
      console.error('Error al cargar acopios:', err);
      toast.error('Error al cargar acopios');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenRemitoForm = (acopio: any) => {
    setSelectedAcopio(acopio);
    setIsCreatingRemito(true);
    // Initialize delivery items with remaining quantity
    const initialQtys: { [itemId: string]: number } = {};
    acopio.items?.forEach((item: any) => {
      const remaining = Math.max(0, item.quantity - (item.deliveredQuantity || 0));
      initialQtys[item.id] = remaining;
    });
    setDeliveryItems(initialQtys);
    setReceiverName(acopio.pickedUpBy || acopio.client?.name || '');
    setDriverName('');
    setDeliveryAddress(acopio.client?.address || '');
    setNotes('');
  };

  const handleSubmitRemito = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAcopio) return;

    // Filter items with quantity > 0
    const itemsToDeliver = Object.entries(deliveryItems)
      .map(([saleItemId, quantity]) => ({
        saleItemId,
        quantity: Number(quantity)
      }))
      .filter(i => i.quantity > 0);

    if (itemsToDeliver.length === 0) {
      toast.error('Seleccioná al menos un artículo para entregar');
      return;
    }

    setIsSubmittingRemito(true);
    try {
      const { data } = await api.post(`/acopio/${selectedAcopio.id}/remitos`, {
        receiverName: receiverName.trim() || undefined,
        driverName: driverName.trim() || undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        notes: notes.trim() || undefined,
        items: itemsToDeliver
      });

      toast.success('Remito de entrega emitido con éxito');
      setIsCreatingRemito(false);
      setRemitoToPrint({ ...data, sale: selectedAcopio });
      await loadAcopios();
    } catch (err: any) {
      console.error('Error al emitir remito:', err);
      toast.error(err.response?.data?.message || 'Error al emitir remito de entrega');
    } finally {
      setIsSubmittingRemito(false);
    }
  };

  const handlePrintRemito = (remito: any, sale: any) => {
    setRemitoToPrint({ ...remito, sale });
    setTimeout(() => {
      window.print();
    }, 150);
  };

  const filteredAcopios = acopios.filter((a) => {
    if (!search) return true;
    const term = search.toLowerCase();
    const numMatch = a.saleNumber.toString().includes(term);
    const clientMatch = a.client?.name?.toLowerCase().includes(term);
    const itemMatch = a.items?.some((i: any) => i.productName.toLowerCase().includes(term));
    return numMatch || clientMatch || itemMatch;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">Pendiente Total</span>;
      case 'PARTIAL':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">Entrega Parcial</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">Entregado Completo</span>;
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white dark:bg-slate-900 w-full max-w-6xl h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-slate-800 dark:text-white">Gestión de Acopios y Remitos de Obra</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                  Ferretería & Corralón
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Materiales vendidos retenidos para entrega programada o fraccionada</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Acopios List */}
          <div className="w-1/2 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-900/50">
            {/* Filters */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por cliente, N° venta o artículo..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              {/* Status Tabs */}
              <div className="flex gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {(['ALL', 'PENDING', 'PARTIAL', 'COMPLETED'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      statusFilter === tab 
                        ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs' 
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {tab === 'ALL' ? 'Todos' : tab === 'PENDING' ? 'Pendientes' : tab === 'PARTIAL' ? 'Parciales' : 'Completados'}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                  <div className="w-8 h-8 border-2 border-rose-600 border-t-transparent rounded-full animate-spin mb-2" />
                  <span className="text-xs">Cargando acopios...</span>
                </div>
              ) : filteredAcopios.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                  <Package className="w-10 h-10 stroke-1 mb-2 text-slate-300 dark:text-slate-600" />
                  <p className="text-xs font-medium">No se encontraron acopios con estos filtros</p>
                </div>
              ) : (
                filteredAcopios.map((acopio) => {
                  const isSelected = selectedAcopio?.id === acopio.id;
                  const totalItems = acopio.items?.reduce((acc: number, i: any) => acc + i.quantity, 0) || 0;
                  const deliveredItems = acopio.items?.reduce((acc: number, i: any) => acc + (i.deliveredQuantity || 0), 0) || 0;
                  const pct = totalItems > 0 ? Math.round((deliveredItems / totalItems) * 100) : 0;

                  return (
                    <div
                      key={acopio.id}
                      onClick={() => {
                        setSelectedAcopio(acopio);
                        setIsCreatingRemito(false);
                      }}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected 
                          ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/40 ring-2 ring-rose-500/20' 
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-900 dark:text-white">
                              Venta #{acopio.saleNumber}
                            </span>
                            {getStatusBadge(acopio.acopioStatus)}
                          </div>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                            {acopio.client?.name || 'Cliente sin nombre'}
                          </p>
                        </div>
                        <span className="text-[11px] font-mono font-black text-slate-900 dark:text-slate-100">
                          $${acopio.total.toLocaleString()}
                        </span>
                      </div>

                      <div className="mt-2.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                          <span>Progreso de entrega: <strong>{pct}%</strong></span>
                          <span>{deliveredItems} de {totalItems} un.</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all ${
                              pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-amber-400'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[10px] text-slate-400">
                        <span>{new Date(acopio.createdAt).toLocaleDateString()}</span>
                        <span>{acopio.deliveryReceipts?.length || 0} remitos emitidos</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Acopio Detail or Remito Form */}
          <div className="w-1/2 flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
            {!selectedAcopio ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <Package className="w-12 h-12 stroke-1 mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Seleccioná un acopio</p>
                <p className="text-xs text-slate-400 max-w-xs mt-1">Hacé clic en cualquier venta de la izquierda para ver los materiales acopiados o emitir remitos de entrega</p>
              </div>
            ) : isCreatingRemito ? (
              /* Remito Creation Form */
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 bg-rose-50/80 dark:bg-rose-950/40 border-b border-rose-100 dark:border-rose-900/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                    <h3 className="text-xs font-black text-rose-950 dark:text-rose-200 uppercase tracking-wider">
                      Emitir Remito de Entrega - Venta #{selectedAcopio.saleNumber}
                    </h3>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setIsCreatingRemito(false)}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>

                <form onSubmit={handleSubmitRemito} className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                    {/* Delivery Logistics Fields */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Receptor / Quien Recibe en Obra
                        </label>
                        <input 
                          type="text"
                          value={receiverName}
                          onChange={(e) => setReceiverName(e.target.value)}
                          placeholder="Ej: Juan Pérez (Capataz)"
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Chofer / Fletero / Transporte
                        </label>
                        <input 
                          type="text"
                          value={driverName}
                          onChange={(e) => setDriverName(e.target.value)}
                          placeholder="Ej: Carlos - Camión Ford 350"
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Dirección de Entrega / Destino de Obra
                      </label>
                      <input 
                        type="text"
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="Ej: Lote 45 - Barrio Los Álamos / Av. San Martín 1234"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                    </div>

                    {/* Materials Selection */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Materiales a Entregar en este Remito
                        </label>
                        <span className="text-[10px] text-slate-400">Ajustá la cantidad a cargar</span>
                      </div>

                      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedAcopio.items?.map((item: any) => {
                          const remaining = Math.max(0, item.quantity - (item.deliveredQuantity || 0));
                          const currentVal = deliveryItems[item.id] !== undefined ? deliveryItems[item.id] : remaining;

                          return (
                            <div key={item.id} className="p-3 flex items-center justify-between gap-3 bg-white dark:bg-slate-900">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                  {item.productName}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                  <span>Total: {item.quantity}</span>
                                  <span>•</span>
                                  <span>Ya entregado: {item.deliveredQuantity || 0}</span>
                                  <span>•</span>
                                  <span className="font-bold text-rose-600 dark:text-rose-400">
                                    Pendiente: {remaining}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[10px] font-bold text-slate-500">A entregar:</span>
                                <input 
                                  type="number"
                                  min="0"
                                  max={remaining}
                                  step="any"
                                  value={currentVal}
                                  onChange={(e) => {
                                    const val = Math.max(0, Math.min(remaining, parseFloat(e.target.value) || 0));
                                    setDeliveryItems(prev => ({ ...prev, [item.id]: val }));
                                  }}
                                  className="w-20 px-2.5 py-1.5 text-center font-mono font-bold text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Observaciones / Notas del Remito
                      </label>
                      <textarea 
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Ej: Se descarga con pluma al fondo del terreno. Dejar bajo nylon negro."
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                      />
                    </div>
                  </div>

                  {/* Form Footer */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setIsCreatingRemito(false)}
                      className="btn-secondary"
                    >
                      Volver
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingRemito}
                      className="btn-primary"
                    >
                      <Truck className="w-4 h-4" />
                      {isSubmittingRemito ? 'Emitiendo remito...' : 'Emitir e Imprimir Remito'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* Acopio Details & Previous Remitos */
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header Summary */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-slate-900 dark:text-white">
                        Venta #{selectedAcopio.saleNumber}
                      </h3>
                      {getStatusBadge(selectedAcopio.acopioStatus)}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Cliente: <strong className="text-slate-800 dark:text-slate-200">{selectedAcopio.client?.name}</strong> • Fecha: {new Date(selectedAcopio.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {selectedAcopio.acopioStatus !== 'COMPLETED' && (
                    <button
                      onClick={() => handleOpenRemitoForm(selectedAcopio)}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-rose-600/20 transition-all cursor-pointer"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      Emitir Remito de Entrega
                    </button>
                  )}
                </div>

                {/* Items Status List */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Estado de Materiales en Acopio
                    </h4>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedAcopio.items?.map((item: any) => {
                        const remaining = Math.max(0, item.quantity - (item.deliveredQuantity || 0));
                        const isFullyDelivered = remaining === 0;

                        return (
                          <div key={item.id} className="p-3 bg-white dark:bg-slate-900 flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {item.productName}
                              </p>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                <span>Vendidos: <strong>{item.quantity}</strong></span>
                                <span>•</span>
                                <span>Entregados: <strong>{item.deliveredQuantity || 0}</strong></span>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              {isFullyDelivered ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Entregado
                                </span>
                              ) : (
                                <div className="text-right">
                                  <span className="text-xs font-mono font-black text-rose-600 dark:text-rose-400">
                                    {remaining} un.
                                  </span>
                                  <p className="text-[9px] text-slate-400 uppercase font-bold">Por entregar</p>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Previous Delivery Receipts History */}
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Remitos de Entrega Emitidos ({selectedAcopio.deliveryReceipts?.length || 0})
                    </h4>

                    {(!selectedAcopio.deliveryReceipts || selectedAcopio.deliveryReceipts.length === 0) ? (
                      <div className="p-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-center text-slate-400 text-xs">
                        Aún no se emitieron remitos de entrega para este acopio.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectedAcopio.deliveryReceipts.map((rec: any) => (
                          <div key={rec.id} className="p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900 dark:text-white">
                                  Remito #{rec.remitoNumber.toString().padStart(6, '0')}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {new Date(rec.createdAt).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate mt-0.5">
                                Recibió: <strong>{rec.receiverName || 'No especificado'}</strong> {rec.driverName ? `• Chofer: ${rec.driverName}` : ''}
                              </p>
                              {rec.deliveryAddress && (
                                <p className="text-[10px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                                  <MapPin className="w-2.5 h-2.5" /> {rec.deliveryAddress}
                                </p>
                              )}
                            </div>

                            <button
                              onClick={() => handlePrintRemito(rec, selectedAcopio)}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              Reimprimir
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Printable Thermal Remito (Invisible on screen, visible during print) */}
      {remitoToPrint && (
        <div className="hidden print:block fixed inset-0 bg-white p-4 text-black text-xs font-mono" style={{ width: '80mm' }}>
          <div className="text-center pb-2 border-b border-black">
            <h1 className="text-sm font-black uppercase tracking-wider">REMITO DE ENTREGA</h1>
            <p className="text-[11px] font-bold">N° {remitoToPrint.remitoNumber?.toString().padStart(8, '0')}</p>
            <p className="text-[9px] mt-1">{new Date(remitoToPrint.createdAt).toLocaleString()}</p>
          </div>

          <div className="py-2 border-b border-dashed border-black text-[10px] space-y-0.5">
            <p><strong>Venta Origen:</strong> #{remitoToPrint.sale?.saleNumber}</p>
            <p><strong>Cliente:</strong> {remitoToPrint.sale?.client?.name || 'Cliente Particular'}</p>
            {remitoToPrint.sale?.client?.dni && <p><strong>CUIT/DNI:</strong> {remitoToPrint.sale?.client?.dni}</p>}
            {remitoToPrint.deliveryAddress && <p><strong>Destino/Obra:</strong> {remitoToPrint.deliveryAddress}</p>}
            {remitoToPrint.receiverName && <p><strong>Receptor:</strong> {remitoToPrint.receiverName}</p>}
            {remitoToPrint.driverName && <p><strong>Transporte:</strong> {remitoToPrint.driverName}</p>}
          </div>

          <div className="py-2 border-b border-black">
            <p className="text-[10px] font-black uppercase mb-1">Detalle de Materiales Entregados:</p>
            <table className="w-full text-left text-[10px]">
              <thead>
                <tr className="border-b border-dashed border-black">
                  <th className="py-0.5 w-12">Cant.</th>
                  <th className="py-0.5">Descripción</th>
                </tr>
              </thead>
              <tbody>
                {remitoToPrint.items?.map((item: any, idx: number) => (
                  <tr key={idx} className="border-b border-dotted border-gray-300">
                    <td className="py-1 font-bold">{item.quantity}</td>
                    <td className="py-1">{item.productName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {remitoToPrint.notes && (
            <div className="py-1.5 border-b border-dashed border-black text-[9px]">
              <p><strong>Observaciones:</strong> {remitoToPrint.notes}</p>
            </div>
          )}

          {/* Conformity Signature Area */}
          <div className="pt-6 pb-2 text-[10px] space-y-4">
            <p className="text-[9px] text-center italic">
              Recibí conforme los materiales detallados precedentemente:
            </p>
            <div className="pt-8 border-t border-black text-center space-y-1">
              <p className="font-bold">FIRMA Y ACLARACIÓN</p>
              <p className="text-[9px]">DNI: _______________________</p>
            </div>
          </div>

          <div className="text-center pt-2 border-t border-dotted border-black text-[8px] text-gray-500">
            Documento no válido como factura • Control de entrega de materiales
          </div>
        </div>
      )}
    </div>
  );
}
