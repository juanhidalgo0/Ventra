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
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-200">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 shadow-inner">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider leading-none mb-1">GO! POS</p>
              <h2 className="text-base font-black text-slate-800 leading-none">
                {isRegistering ? 'Nuevo Proveedor' : selectedSupplier ? `Pago a ${selectedSupplier.name}` : 'Pago a Proveedor'}
              </h2>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-all cursor-pointer"><X className="w-5 h-5" /></button>
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
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Nombre / Razón Social *</label>
                  <input 
                    type="text" 
                    required 
                    value={newName} 
                    onChange={e => setNewName(e.target.value)} 
                    placeholder="Ej: Distribuidora Coca-Cola S.A." 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Teléfono</label>
                    <input 
                      type="text" 
                      value={newPhone} 
                      onChange={e => setNewPhone(e.target.value)} 
                      placeholder="+54 11 ..." 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Email</label>
                    <input 
                      type="email" 
                      value={newEmail} 
                      onChange={e => setNewEmail(e.target.value)} 
                      placeholder="ventas@proveedor.com" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Persona de Contacto</label>
                  <input 
                    type="text" 
                    value={newContact} 
                    onChange={e => setNewContact(e.target.value)} 
                    placeholder="Ej: Marcelo (Vendedor)" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button" 
                    onClick={() => setIsRegistering(false)} 
                    className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-500 uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer"
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
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex justify-between items-center">
                  <div>
                    <h3 className="text-xs font-extrabold text-slate-800 uppercase">{selectedSupplier.name}</h3>
                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">Contacto: {selectedSupplier.contact || 'No asignado'}</p>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setSelectedSupplier(null)}
                    className="px-3 py-1.5 border border-rose-100 hover:bg-rose-50 rounded-lg text-[9px] font-extrabold uppercase text-rose-500 transition-all cursor-pointer active:scale-95"
                  >
                    Cambiar
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Monto a pagar *</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg font-black">$</span>
                    <input 
                      type="number" 
                      required 
                      value={paymentAmount} 
                      onChange={e => setPaymentAmount(e.target.value ? Number(e.target.value) : '')} 
                      placeholder="0,00" 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-3 text-lg font-black text-slate-800 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Método de Pago</label>
                    <select 
                      value={paymentMethod} 
                      onChange={e => setPaymentMethod(e.target.value)} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-xs font-bold text-slate-750 outline-none focus:bg-white transition-all cursor-pointer"
                    >
                      <option>Efectivo</option>
                      <option>Transferencia</option>
                      <option>Mercado Pago</option>
                      <option>Efectivo Caja</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Referencia / Operación</label>
                    <input 
                      type="text" 
                      value={paymentReference} 
                      onChange={e => setPaymentReference(e.target.value)} 
                      placeholder="N° ticket..." 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all shadow-inner"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Notas Internas</label>
                  <textarea 
                    value={paymentNotes} 
                    onChange={e => setPaymentNotes(e.target.value)} 
                    placeholder="Escribí notas u observaciones..." 
                    className="w-full h-16 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all resize-none shadow-inner"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setSelectedSupplier(null)} 
                    className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-500 uppercase tracking-wider transition-all cursor-pointer"
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
                className="space-y-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                    <input 
                      type="text" 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar proveedor por nombre..." 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-xs font-bold text-slate-700 focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all placeholder:text-slate-400 shadow-inner" 
                      autoFocus 
                    />
                  </div>
                  <button 
                    type="button"
                    onClick={() => setIsRegistering(true)}
                    className="px-4 py-2.5 bg-emerald-650 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <Plus className="w-4.5 h-4.5" /> Registrar
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between px-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    <span>{filteredSuppliers.length} Proveedores</span>
                    <span>Lista General</span>
                  </div>

                  <div className="max-h-[220px] overflow-y-auto custom-scrollbar border border-slate-100 rounded-2xl divide-y divide-slate-50 bg-white">
                    {filteredSuppliers.length === 0 ? (
                      <div className="text-center py-10 text-slate-400">
                        <AlertCircle className="w-10 h-10 text-slate-200 mx-auto mb-2 animate-bounce" />
                        <p className="text-[10px] font-bold uppercase tracking-wider leading-relaxed">No hay proveedores registrados aún o no coinciden con la búsqueda</p>
                      </div>
                    ) : (
                      filteredSuppliers.map(s => (
                        <button 
                          key={s.id}
                          onClick={() => setSelectedSupplier(s)}
                          className="w-full px-5 py-3 hover:bg-slate-50/50 flex items-center justify-between transition-colors text-left"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-extrabold text-slate-800 uppercase truncate">{s.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 mt-0.5">Contacto: {s.contact || 'No asignado'}</p>
                          </div>
                          <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2 py-1 rounded-md uppercase tracking-wider border border-slate-200 group-hover:bg-slate-200 shrink-0">Seleccionar</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <p className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wider leading-none">Qué vas a poder hacer al elegir un proveedor</p>
                  <div className="space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-lg bg-teal-50 flex items-center justify-center shrink-0 mt-0.5"><DollarSign className="w-3 h-3 text-teal-650" /></div>
                      <p className="text-[11px] text-slate-550 leading-normal font-semibold">Pagar deuda existente — cancelá facturas o aboná cuentas corrientes.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-lg bg-purple-50 flex items-center justify-center shrink-0 mt-0.5"><Receipt className="w-3 h-3 text-purple-650" /></div>
                      <p className="text-[11px] text-slate-550 leading-normal font-semibold">Registrar nueva factura — para compras o insumos sin productos en catálogo.</p>
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
