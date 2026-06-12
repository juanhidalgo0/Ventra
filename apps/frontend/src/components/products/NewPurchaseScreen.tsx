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
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { toast } from 'react-hot-toast';

interface PurchaseItem {
  productId: string;
  barcode: string;
  name: string;
  variant: string;
  unit: string;
  quantity: number;
  cost: number;
  total: number;
  buyFormat: string;
  unitsPerPack: number;
  presentationType: string;
}

export default function NewPurchaseScreen({ onBack }: { onBack: () => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierResults, setShowSupplierResults] = useState(false);
  
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'OWED'>('PAID');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [notes, setNotes] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const productInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data } = await api.get('/suppliers');
      setSuppliers(data);
    } catch {}
  };

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

  const addItem = (product: any) => {
    const existing = items.find(i => i.productId === product.id);
    if (existing) {
      updateItem(product.id, 'quantity', existing.quantity + 1);
    } else {
      setItems([...items, {
        productId: product.id,
        barcode: product.barcode,
        name: product.name,
        variant: '-',
        unit: product.unit || 'UNIT',
        quantity: 1,
        cost: product.costPrice || 0,
        total: product.costPrice || 0,
        buyFormat: 'UNIT',
        unitsPerPack: product.unitsPerPack || 1,
        presentationType: product.presentationType || 'UNIT'
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
        const q = parseFloat(updated.quantity as any) || 0;
        const c = parseFloat(updated.cost as any) || 0;
        updated.total = q * c;
        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setItems(items.filter(i => i.productId !== id));
  };

  const calculateTotal = () => items.reduce((sum, item) => sum + item.total, 0);

  const handleSubmit = async () => {
    if (!selectedSupplier) return toast.error('Selecciona un proveedor');
    if (items.length === 0) return toast.error('Agrega al menos un producto');

    setIsSubmitting(true);
    try {
      await api.post('/purchases', {
        supplierId: selectedSupplier.id,
        invoiceNumber,
        items: items.map(i => ({ 
          productId: i.productId, 
          quantity: parseFloat(i.quantity as any) || 0, 
          cost: parseFloat(i.cost as any) || 0, 
          buyFormat: i.buyFormat 
        })),
        paymentStatus,
        paymentMethod: paymentStatus === 'PAID' ? paymentMethod : null,
        notes
      });
      toast.success('Compra registrada con éxito');
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
         <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-white rounded-xl transition-colors"><ArrowLeft className="w-5 h-5" /></button>
            <h2 className="text-lg font-bold text-slate-800 tracking-tight">Registrar Compra</h2>
         </div>
         <button className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-bold uppercase tracking-widest border border-indigo-100">
            <Printer className="w-4 h-4" /> Leer factura <span className="opacity-40">BETA</span>
         </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-4">
         {/* Top Info Bar */}
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm grid grid-cols-12 gap-6 items-end">
            <div className="col-span-6 relative">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Proveedor</span>
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
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-3 text-sm font-bold text-slate-800 focus:bg-white focus:border-indigo-500/50 outline-none transition-all"
                  />
                  {showSupplierResults && !selectedSupplier && (
                    <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden max-h-48 overflow-y-auto">
                       {suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).length > 0 ? (
                         suppliers.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase())).map(s => (
                           <button key={s.id} onClick={() => { setSelectedSupplier(s); setShowSupplierResults(false); setSupplierSearch(s.name); }} className="w-full text-left px-5 py-3 hover:bg-slate-50 text-sm font-bold border-b border-slate-50 last:border-0">{s.name}</button>
                         ))
                       ) : (
                         <div className="px-5 py-3 text-xs text-slate-400 font-bold italic">No se encontraron proveedores...</div>
                       )}
                    </div>
                  )}
               </div>
            </div>
            <div className="col-span-3">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">Fecha</span>
               <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3 text-sm font-bold outline-none" />
            </div>
            <div className="col-span-3">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block ml-1">N° Comprobante (opc.)</span>
               <div className="relative">
                  <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                  <input type="text" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="FA 0001-00001234" className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl pl-11 pr-4 py-3 text-sm font-bold outline-none" />
               </div>
            </div>
         </div>

         {/* Scanner Active Bar */}
         <div className="bg-[#f0fdf4] border border-emerald-100 px-6 py-3 rounded-2xl flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <Scan className="w-4 h-4 text-emerald-500" />
            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Escáner activo — Escaneá productos para agregarlos</p>
         </div>

         {/* Products Table */}
         <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[400px]">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                     <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Código</th>
                     <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest w-1/3">Nombre</th>
                     <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest">Variante</th>
                     <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">Formato Compra</th>
                     <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">Cantidad</th>
                     <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">Costo</th>
                     <th className="px-6 py-4 text-[9px] font-bold text-slate-400 uppercase tracking-widest text-right">Total</th>
                     <th className="px-2 pr-6"></th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-50">
                  {items.map((item) => (
                    <tr key={item.productId} className="hover:bg-slate-50/30 transition-colors">
                       <td className="px-6 py-4 text-[11px] font-bold text-slate-400">{item.barcode}</td>
                       <td className="px-6 py-4 text-[11px] font-bold text-slate-800">{item.name}</td>
                       <td className="px-6 py-4 text-[10px] font-bold text-slate-300">{item.variant}</td>
                       <td className="px-6 py-4 text-center">
                          {item.presentationType === 'PACK' ? (
                            <select
                              value={item.buyFormat}
                              onChange={e => updateItem(item.productId, 'buyFormat', e.target.value)}
                              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold uppercase text-slate-600 outline-none cursor-pointer"
                            >
                              <option value="UNIT">Unidades</option>
                              <option value="PACK">Paquete ({item.unitsPerPack} u.)</option>
                            </select>
                          ) : (
                            <span className="text-[10px] font-extrabold text-slate-400 uppercase">Unidades</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1 justify-center">
                              <button 
                                type="button"
                                onClick={() => updateItem(item.productId, 'quantity', Math.max(1, item.quantity - 1))}
                                className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs active:scale-[0.9] transition-all"
                              >
                                -
                              </button>
                              <input 
                                type="number" 
                                value={item.quantity === 0 && item.quantity !== '' as any ? 0 : item.quantity || ''} 
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  updateItem(item.productId, 'quantity', isNaN(val) ? '' as any : val);
                                }}
                                className="w-16 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 text-center text-[11px] font-bold outline-none focus:border-indigo-500/50"
                              />
                              <button 
                                type="button"
                                onClick={() => updateItem(item.productId, 'quantity', (parseFloat(item.quantity as any) || 0) + 1)}
                                className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs active:scale-[0.9] transition-all"
                              >
                                +
                              </button>
                            </div>
                            {item.buyFormat === 'PACK' && (
                              <span className="text-[8px] font-bold text-indigo-500 uppercase tracking-tight">({(parseFloat(item.quantity as any) || 0) * item.unitsPerPack} unidades)</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                           <div className="flex flex-col items-center gap-0.5">
                             <input 
                               type="number" 
                               value={item.cost === 0 && item.cost !== '' as any ? 0 : item.cost || ''} 
                               onChange={e => {
                                 const val = parseFloat(e.target.value);
                                 updateItem(item.productId, 'cost', isNaN(val) ? '' as any : val);
                               }}
                               className="w-24 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 text-center text-[11px] font-bold outline-none focus:border-indigo-500/50"
                             />
                             {item.buyFormat === 'PACK' && (
                               <span className="text-[8px] font-extrabold text-slate-400 uppercase">(${( (parseFloat(item.cost as any) || 0) / item.unitsPerPack).toFixed(1)} / u.)</span>
                             )}
                           </div>
                        </td>
                       <td className="px-6 py-4 text-right text-[12px] font-bold text-emerald-600">$ {item.total.toFixed(2)}</td>
                       <td className="px-2 pr-6 text-right">
                          <button onClick={() => removeItem(item.productId)} className="p-2 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                       </td>
                    </tr>
                  ))}
                  {/* Add Product Search Row */}
                  <tr>
                     <td colSpan={2} className="px-6 py-4">
                        <div className="relative flex items-center">
                           <Search className="absolute left-3 w-4 h-4 text-slate-300 pointer-events-none" />
                           <input 
                             ref={productInputRef}
                             type="text" 
                             value={productSearch}
                             onChange={e => searchProducts(e.target.value)}
                             placeholder="Buscar producto (min 2 letras)..."
                             className="w-full bg-slate-50/50 border border-slate-100 rounded-xl pl-10 pr-4 py-2 text-[11px] font-bold outline-none focus:bg-white focus:border-indigo-300 transition-all"
                           />
                           {productResults.length > 0 && (
                             <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-2xl shadow-2xl border border-slate-100 z-[100] overflow-hidden max-h-64 overflow-y-auto">
                                {productResults.map(p => (
                                  <button key={p.id} onClick={() => addItem(p)} className="w-full text-left px-5 py-4 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0 group transition-colors">
                                     <div className="flex flex-col">
                                        <div className="text-[12px] font-bold text-slate-700 group-hover:text-indigo-600 transition-colors">{p.name}</div>
                                        <div className="text-[9px] font-bold text-slate-400">{p.barcode || 'Sin código'}</div>
                                     </div>
                                     <div className="px-3 py-1 rounded-lg bg-indigo-50 text-indigo-600 text-[9px] font-bold uppercase">Stock: {p.stock}</div>
                                  </button>
                                ))}
                             </div>
                           )}
                        </div>
                     </td>
                      <td colSpan={6}>
                        <button 
                          type="button"
                          onClick={() => productInputRef.current?.focus()}
                          className="ml-4 text-[10px] font-bold text-indigo-500 uppercase tracking-widest hover:underline transition-all"
                        >
                          + Agregar producto
                        </button>
                      </td>
                  </tr>
               </tbody>
            </table>
            <div className="mt-auto p-8 border-t border-slate-100 flex justify-end bg-slate-50/20">
               <div className="flex items-center gap-6">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Compra</span>
                  <div className="text-4xl font-bold text-slate-800">$ {calculateTotal().toFixed(2)}</div>
               </div>
            </div>
         </div>

         {/* Bottom Controls */}
         <div className="grid grid-cols-2 gap-6 pb-10">
            <div className="space-y-3">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Notas</span>
               <textarea 
                 value={notes}
                 onChange={e => setNotes(e.target.value)}
                 placeholder="Descripción opcional..." 
                 className="w-full h-32 bg-white border border-slate-100 rounded-2xl p-6 text-sm font-bold outline-none focus:border-indigo-500/50 transition-all resize-none shadow-sm"
               ></textarea>
            </div>
            <div className="space-y-6">
               <div className="space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">¿Cómo pagaste?</span>
                  <div className="flex gap-2 p-1 bg-slate-100/50 rounded-2xl border border-slate-100">
                     <button 
                       onClick={() => setPaymentStatus('PAID')}
                       className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${paymentStatus === 'PAID' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                     >
                       <CheckCircle2 className="w-3.5 h-3.5" /> Pagada
                     </button>
                     <button 
                       onClick={() => setPaymentStatus('OWED')}
                       className={`flex-1 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${paymentStatus === 'OWED' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-400'}`}
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
                        className="w-full bg-white border border-slate-100 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none shadow-sm appearance-none cursor-pointer"
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
                  <button onClick={onBack} className="px-8 py-3 rounded-xl text-[11px] font-bold text-slate-400 uppercase tracking-widest">Cancelar</button>
                  <button className="px-8 py-3 rounded-xl border border-indigo-200 bg-white text-indigo-600 text-[11px] font-bold uppercase tracking-widest hover:bg-indigo-50 transition-all">Guardar borrador</button>
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
