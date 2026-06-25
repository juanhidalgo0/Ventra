import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { X, Search, DollarSign, Receipt, AlertCircle, Plus, ArrowLeft, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ProveedoresModal({ sessionId, onClose }: { sessionId?: string; onClose: () => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Registration Form States
  const [isRegistering, setIsRegistering] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newContact, setNewContact] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Payment Form States
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  const loadSuppliers = () => {
    api.get('/suppliers')
      .then(({ data }) => setSuppliers(data || []))
      .catch(() => {});
  };

  useEffect(() => { 
    loadSuppliers();
    
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleRegisterSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error('La razón social o nombre es obligatoria');
      return;
    }
    setIsSaving(true);
    try {
      const { data } = await api.post('/suppliers', {
        name: newName.trim(),
        phone: newPhone.trim(),
        email: newEmail.trim(),
        contact: newContact.trim()
      });
      toast.success('✅ Proveedor registrado con éxito');
      
      // Clear registration form and load updated list
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      setNewContact('');
      setIsRegistering(false);
      
      // Auto-select the newly created supplier
      setSelectedSupplier(data);
      loadSuppliers();
    } catch {
      toast.error('Error al registrar el proveedor');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier) return;
    if (!paymentAmount || Number(paymentAmount) <= 0) {
      toast.error('Por favor, ingresá un monto válido');
      return;
    }
    if (!sessionId) {
      toast.error('No hay caja abierta');
      return;
    }
    setIsSubmittingPayment(true);
    try {
      await api.post(`/suppliers/${selectedSupplier.id}/payments`, {
        amount: Number(paymentAmount),
        method: paymentMethod,
        reference: paymentReference,
        notes: paymentNotes,
        userId: JSON.parse(localStorage.getItem('user') || '{}').id
      });
      // Also register a withdrawal/movement inside the active cash session to reflect cash decrease!
      if (paymentMethod === 'Efectivo' || paymentMethod === 'Efectivo Caja') {
        await api.post(`/cash/${sessionId}/movement`, {
          type: 'EXPENSE',
          amount: Number(paymentAmount),
          description: `PAGO PROVEEDOR: ${selectedSupplier.name.toUpperCase()}`
        });
      }
      toast.success('✅ Pago registrado correctamente y reflejado en caja');
      onClose();
    } catch {
      toast.error('Error al registrar el pago');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 shadow-2xl" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-400 dark:border-slate-700">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center text-teal-600 dark:text-teal-400 shadow-sm border border-teal-100 dark:border-teal-800/50">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] text-teal-600 dark:text-teal-400 font-extrabold uppercase tracking-[0.15em] leading-none mb-1.5">GO! POS</p>
              <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 leading-none tracking-tight">
                {isRegistering ? 'Nuevo Proveedor' : selectedSupplier ? `Pago a ${selectedSupplier.name}` : 'Pago a Proveedor'}
              </h2>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"><X className="w-6 h-6" /></button>
        </div>

        {/* Content Container */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            
            {/* Case 1: Registering a New Supplier */}
            {isRegistering ? (
              <motion.form 
                key="register-form" 
                initial={{ opacity: 0, x: -10 }} 
                animate={{ opacity: 1, x: 0 }} 
                exit={{ opacity: 0, x: 10 }}
                onSubmit={handleRegisterSupplier}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Nombre / Razón Social *</label>
                  <input 
                    type="text" 
                    required 
                    value={newName} 
                    onChange={e => setNewName(e.target.value)} 
                    placeholder="Ej: Distribuidora Coca-Cola S.A." 
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Teléfono</label>
                    <input 
                      type="text" 
                      value={newPhone} 
                      onChange={e => setNewPhone(e.target.value)} 
                      placeholder="+54 11 ..." 
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Email</label>
                    <input 
                      type="email" 
                      value={newEmail} 
                      onChange={e => setNewEmail(e.target.value)} 
                      placeholder="ventas@proveedor.com" 
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Persona de Contacto</label>
                  <input 
                    type="text" 
                    value={newContact} 
                    onChange={e => setNewContact(e.target.value)} 
                    placeholder="Ej: Marcelo (Vendedor)" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button" 
                    onClick={() => setIsRegistering(false)} 
                    className="flex-1 py-3 border border-slate-400 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-700 uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" /> Volver
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSaving}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? 'Guardando...' : 'Crear e Inscribir'}
                  </button>
                </div>
              </motion.form>
            ) : selectedSupplier ? (
              
              /* Case 2: Supplier Selected, Loading Payment Form */
              <motion.form 
                key="payment-form" 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleRegisterPayment}
                className="space-y-4"
              >
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-2xl p-4 flex justify-between items-center">
                  <div>
                    <h3 className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase">{selectedSupplier.name}</h3>
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold mt-0.5">Contacto: {selectedSupplier.contact || 'No asignado'}</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setSelectedSupplier(null)}
                    className="px-3 py-1.5 border border-rose-100 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg text-[9px] font-extrabold uppercase text-rose-500 dark:text-rose-400 transition-all cursor-pointer active:scale-95"
                  >
                    Cambiar
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Monto a pagar *</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 dark:text-slate-400 text-lg font-black">$</span>
                    <input 
                      type="number" 
                      required 
                      value={paymentAmount} 
                      onChange={e => setPaymentAmount(e.target.value ? Number(e.target.value) : '')} 
                      placeholder="0,00" 
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl pl-9 pr-4 py-3 text-lg font-black text-slate-800 dark:text-slate-100 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Método de Pago</label>
                    <select 
                      value={paymentMethod} 
                      onChange={e => setPaymentMethod(e.target.value)} 
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl px-3 py-3 text-xs font-bold text-slate-750 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 transition-all cursor-pointer"
                    >
                      <option>Efectivo</option>
                      <option>Transferencia</option>
                      <option>Mercado Pago</option>
                      <option>Efectivo Caja</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Referencia / Operación</label>
                    <input 
                      type="text" 
                      value={paymentReference} 
                      onChange={e => setPaymentReference(e.target.value)} 
                      placeholder="N° ticket..." 
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest ml-1">Notas Internas</label>
                  <textarea 
                    value={paymentNotes} 
                    onChange={e => setPaymentNotes(e.target.value)} 
                    placeholder="Escribí notas u observaciones..." 
                    className="w-full h-16 bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:bg-white dark:focus:bg-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all resize-none shadow-inner"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setSelectedSupplier(null)} 
                    className="flex-1 py-3 border border-slate-400 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Atrás
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmittingPayment}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle className="w-4 h-4" /> {isSubmittingPayment ? 'Registrando...' : 'Confirmar Pago'}
                  </button>
                </div>
              </motion.form>
            ) : (
              
              /* Case 3: Searching & Selecting Existing Supplier */
              <motion.div 
                key="search-list" 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="space-y-5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Search className="w-5 h-5 text-teal-500" />
                    </div>
                    <input 
                      type="text" 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar proveedor por nombre..." 
                      className="w-full bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-2xl pl-12 pr-4 py-3.5 text-sm font-bold text-slate-700 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-700 focus:border-teal-500 outline-none transition-all placeholder:text-slate-400 shadow-sm" 
                      autoFocus 
                    />
                  </div>
                  <button 
                    type="button"
                    onClick={() => setIsRegistering(true)}
                    className="px-5 py-3.5 bg-slate-800 hover:bg-slate-900 text-white rounded-2xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <Plus className="w-5 h-5" /> Nuevo
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <span>{filteredSuppliers.length} Proveedores</span>
                    <span>Directorio</span>
                  </div>

                  <div className="max-h-[240px] overflow-y-auto custom-scrollbar border-2 border-slate-100 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                    {filteredSuppliers.length === 0 ? (
                      <div className="text-center py-12 text-slate-500">
                        <AlertCircle className="w-12 h-12 text-slate-200 dark:text-slate-700 mx-auto mb-3" />
                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No se encontraron proveedores</p>
                        <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-1">Registrá uno nuevo para poder realizar pagos.</p>
                      </div>
                    ) : (
                      filteredSuppliers.map(s => (
                        <button 
                          key={s.id}
                          onClick={() => setSelectedSupplier(s)}
                          className="w-full p-4 hover:bg-teal-50 dark:hover:bg-teal-900/20 flex items-center justify-between transition-colors text-left group"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-800 dark:text-slate-200 uppercase tracking-tight truncate group-hover:text-teal-700 dark:group-hover:text-teal-400 transition-colors">{s.name}</p>
                            <p className="text-[10px] font-bold text-slate-500 mt-0.5">Contacto: <span className="text-slate-600 dark:text-slate-400">{s.contact || 'N/A'}</span></p>
                          </div>
                          <span className="text-[10px] font-black bg-white dark:bg-slate-800 text-teal-600 dark:text-teal-400 px-3 py-1.5 rounded-lg uppercase tracking-wider border border-teal-200 dark:border-teal-800 group-hover:bg-teal-600 group-hover:text-white dark:group-hover:bg-teal-600 dark:group-hover:text-white transition-all shadow-sm shrink-0">Seleccionar</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="p-4 rounded-2xl bg-teal-50/50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-800/50 space-y-3">
                  <p className="text-[10px] font-black text-teal-800 dark:text-teal-400 uppercase tracking-widest leading-none">Acciones disponibles</p>
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center shrink-0 mt-0.5"><DollarSign className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" /></div>
                      <p className="text-xs text-teal-900 dark:text-teal-200 leading-snug font-medium pt-0.5"><strong>Pagar deuda</strong> — cancelá facturas o aboná cuentas corrientes.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-lg bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center shrink-0 mt-0.5"><Receipt className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" /></div>
                      <p className="text-xs text-teal-900 dark:text-teal-200 leading-snug font-medium pt-0.5"><strong>Registrar comprobante</strong> — gastos sin productos en el inventario.</p>
                    </div>
                  </div>
                </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
