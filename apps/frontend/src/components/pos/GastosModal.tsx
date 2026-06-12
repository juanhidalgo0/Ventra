import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { X, Receipt, ArrowDownRight, Wallet, Info } from 'lucide-react';

export default function GastosModal({ sessionId, terminalName, onClose }: { sessionId?: string; terminalName?: string; onClose: () => void }) {
  const [type, setType] = useState<'EXPENSE' | 'WITHDRAWAL'>('EXPENSE');
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState('Otro');
  const [method, setMethod] = useState('CASH');
  const [description, setDescription] = useState('');
  const [session, setSession] = useState<any>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  // Salary payment states
  const [usersList, setUsersList] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [hoursWorked, setHoursWorked] = useState(0);
  const rate = Number(localStorage.getItem('hourly_rate') || 1500);
  const [selectedMovement, setSelectedMovement] = useState<any | null>(null);

  useEffect(() => {
    if (category === 'Cobrar Sueldo') {
      api.get('/users')
        .then(({ data }) => {
          setUsersList(data || []);
          if (data && data.length > 0) {
            setSelectedUser(data[0].username);
          }
        })
        .catch((e) => console.error('Error fetching users in GastosModal', e));
    }
  }, [category]);

  useEffect(() => {
    if (category === 'Cobrar Sueldo') {
      const computedAmount = hoursWorked * rate;
      setAmount(computedAmount);
      setDescription(`Liquidación de sueldo para ${selectedUser} por ${hoursWorked} horas trabajadas (Valor hora: $${rate})`);
    }
  }, [category, hoursWorked, selectedUser, rate]);

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    const handleGastosKeys = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        // Do not intercept if user is actively writing inside textarea/inputs unless they specifically trigger it.
        // For selects and other background areas, submit on Enter!
        if (activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleSubmit();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleGastosKeys);
    return () => window.removeEventListener('keydown', handleGastosKeys);
  }, [sessionId, amount, description, category, method, selectedUser, hoursWorked, onClose]);

  const loadSession = async () => {
    try {
      const { data } = await api.get('/cash/current', { params: { terminalName } });
      setSession(data);
    } catch (err) {
      console.error('Error fetching current session in GastosModal', err);
    } finally {
      setIsLoadingSession(false);
    }
  };

  const handleSubmit = async () => {
    if (!sessionId) { toast.error('No hay caja abierta'); return; }
    if (amount <= 0) { toast.error('Ingresá un monto válido'); return; }
    if (category !== 'Cobrar Sueldo' && !description.trim()) {
      toast.error('⚠️ El campo Motivo es obligatorio');
      return;
    }
    try {
      const finalDescription = `${description.trim().toUpperCase()} | METODO: ${method}`;
      await api.post(`/cash/${sessionId}/movement`, { 
        type, 
        amount, 
        description: finalDescription
      });
      toast.success('✅ Gasto registrado correctamente');
      onClose();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Error'); }
  };

  const fmt = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);

  // Expected Cash calculation in Drawer
  const cashPayments = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const expenses = session?.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const withdrawals = session?.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const expectedCash = cashPayments - expenses - withdrawals;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.95, opacity: 0 }} 
        onClick={(e) => e.stopPropagation()} 
        className="bg-white rounded-2xl w-full max-w-3xl overflow-hidden shadow-xl border border-slate-200 flex flex-col max-h-[90vh]"
      >
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Registrar Gasto del Día</h2>
            <p className="text-xs text-slate-500 mt-0.5">Gestión de egresos de caja</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-all"><X className="w-5 h-5" /></button>
        </div>

        {/* Side-by-Side Content Area */}
        <div className="flex-1 flex flex-col md:flex-row gap-6 p-6 overflow-hidden">
          {/* Left Side: Registration Form */}
          <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Monto</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input 
                  type="number" 
                  value={amount || ''} 
                  onChange={(e) => setAmount(Number(e.target.value))} 
                  disabled={category === 'Cobrar Sueldo'}
                  className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-4 py-3 text-lg font-bold text-slate-800 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all disabled:bg-slate-50 disabled:text-slate-500" 
                  placeholder="0,00" 
                  autoFocus 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Categoría</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all appearance-none">
                  <option>Otro</option>
                  <option>Cobrar Sueldo</option>
                  <option>Mercadería / Insumos</option>
                  <option>Servicios (Luz, Agua, etc)</option>
                  <option>Mantenimiento</option>
                  <option>Impuestos</option>
                </select>
              </div>

              {category === 'Cobrar Sueldo' && (
                <div className="grid grid-cols-2 gap-4 pt-1 col-span-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Personal</label>
                    <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all appearance-none">
                      {usersList.map((u: any) => (
                        <option key={u.id} value={u.username}>{u.username}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Horas Trabajadas</label>
                    <input 
                      type="number" 
                      min="0"
                      step="0.5"
                      value={hoursWorked || ''} 
                      onChange={(e) => setHoursWorked(Number(e.target.value))} 
                      className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-750 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all" 
                      placeholder="Ej: 1.5 o 8"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-2"><Wallet className="w-3 h-3" /> Método de Pago</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all appearance-none">
                  <option value="CASH">💵 Efectivo</option>
                  <option value="TRANSFER">🏦 Transferencia</option>
                </select>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Receipt className="w-4 h-4" /> Efectivo en caja
              </div>
              <span className="text-sm font-bold text-slate-800">
                {isLoadingSession ? 'Cargando...' : fmt(expectedCash)}
              </span>
            </div>

            {category !== 'Cobrar Sueldo' && (
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Motivo (obligatorio)</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value.toUpperCase())} 
                  className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all min-h-[70px] resize-none" 
                  placeholder="ESCRIBE EL MOTIVO DEL EGRESO..."
                />
              </div>
            )}

            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 flex gap-3">
              <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <p className="text-[9px] text-indigo-600 leading-relaxed font-medium">
                ¿Vas a pagarle a un proveedor? Usá el botón <b>"Proveedores"</b> arriba — así queda en su cuenta corriente y no se mezcla con tus gastos operativos.
              </p>
            </div>
          </div>

          {/* Desktop divider */}
          <div className="hidden md:block w-px bg-slate-100 shrink-0 self-stretch" />

          {/* Right Side: Registered Expenses List */}
          <div className="w-full md:w-[280px] shrink-0 flex flex-col h-full overflow-hidden">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-1 mb-3">Egresos del Turno Actual</h4>
            <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-y-auto custom-scrollbar space-y-2">
              {isLoadingSession ? (
                <p className="text-xs text-slate-400 font-medium text-center py-4">Cargando egresos...</p>
              ) : (!session?.cashMovements || session.cashMovements.length === 0) ? (
                <p className="text-xs text-slate-400 font-medium text-center py-8">No hay egresos registrados en esta sesión.</p>
              ) : (
                session.cashMovements.map((movement: any) => {
                  return (
                    <div 
                      key={movement.id} 
                      onClick={() => setSelectedMovement(movement)}
                      className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm transition-all hover:border-slate-300 cursor-pointer hover:bg-slate-50/80 active:scale-[0.98]"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-xs font-bold text-slate-700 truncate leading-snug">
                          {movement.description?.split(' | METODO: ')[0] || 'Gasto general'}
                        </p>
                      </div>
                      <span className="text-xs font-extrabold text-rose-600 shrink-0">
                        -{fmt(movement.amount)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 shrink-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl font-medium text-slate-550 hover:bg-slate-50 transition-all text-sm border border-slate-200">Cancelar</button>
          <button onClick={handleSubmit} className="flex-1 py-2.5 rounded-xl font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-all text-sm active:scale-[0.97]">Guardar Gasto</button>
        </div>

        {/* Expense Detail Overlay Modal */}
        {selectedMovement && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-md p-6 border border-slate-100 shadow-2xl relative animate-in zoom-in-95 duration-200">
              <button 
                onClick={() => setSelectedMovement(null)} 
                className="absolute top-4 right-4 p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-650 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-3 border-b border-slate-150 pb-4 mb-4">
                <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 shadow-inner">
                  <ArrowDownRight className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-sm">Detalle de Egreso</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Operación registrada en caja</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-rose-50/50 border border-rose-100/50 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-rose-600 uppercase tracking-widest block mb-1">Monto Retirado</span>
                  <span className="text-3xl font-black text-rose-600 tracking-tight">-{fmt(selectedMovement.amount)}</span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-100">
                    <span className="text-slate-450 font-bold uppercase text-[9px] tracking-wider">Fecha / Hora:</span>
                    <span className="text-slate-750 font-semibold">{new Date(selectedMovement.createdAt).toLocaleString('es-AR')}</span>
                  </div>
                  
                  <div className="flex justify-between py-1.5 border-b border-slate-100">
                    <span className="text-slate-450 font-bold uppercase text-[9px] tracking-wider">Método de Pago:</span>
                    <span className="text-slate-750 font-extrabold uppercase">
                      {(selectedMovement.description?.split(' | METODO: ')[1] || 'CASH') === 'TRANSFER' ? '🏦 Transferencia' : '💵 Efectivo'}
                    </span>
                  </div>

                  <div className="flex flex-col py-1">
                    <span className="text-slate-450 font-bold uppercase text-[9px] tracking-wider mb-1">Motivo / Descripción:</span>
                    <p className="text-slate-850 font-extrabold bg-slate-50 border border-slate-200/60 rounded-xl p-3.5 leading-relaxed text-xs break-words uppercase">
                      {selectedMovement.description?.split(' | METODO: ')[0] || 'SIN DETALLES REGISTRADOS'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <button 
                  onClick={() => setSelectedMovement(null)} 
                  className="w-full py-3 rounded-xl font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs transition-all active:scale-[0.98] uppercase tracking-wider"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
