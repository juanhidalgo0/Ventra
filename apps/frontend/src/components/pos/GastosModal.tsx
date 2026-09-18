import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { X, Receipt, ArrowDownRight, Wallet, Info, Trash2, Edit2 } from 'lucide-react';

export default function GastosModal({ sessionId, terminalName, onClose, editingGasto }: { sessionId?: string; terminalName?: string; onClose: () => void; editingGasto?: any }) {
  const [type, setType] = useState<'EXPENSE' | 'WITHDRAWAL'>('EXPENSE');
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState('Otro');
  const [method, setMethod] = useState('CASH');
  const [description, setDescription] = useState('');
  const [session, setSession] = useState<any>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [localEditingGasto, setLocalEditingGasto] = useState<any | null>(editingGasto || null);

  // Salary payment states
  const [usersList, setUsersList] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [hoursWorked, setHoursWorked] = useState(0);
  const rate = Number(localStorage.getItem('hourly_rate') || 1500);
  const [selectedMovement, setSelectedMovement] = useState<any | null>(null);

  useEffect(() => {
    setLocalEditingGasto(editingGasto || null);
  }, [editingGasto]);

  useEffect(() => {
    if (localEditingGasto) {
      setAmount(localEditingGasto.amount);
      if (localEditingGasto.type) setType(localEditingGasto.type);
      
      // Parse description like: "[Otro] MOTIVO | METODO: CASH"
      const descStr = localEditingGasto.description || '';
      const catMatch = descStr.match(/^\[(.*?)\]/);
      const methodMatch = descStr.match(/\| METODO: (CASH|TRANSFER)$/i);
      
      let parsedCategory = 'Otro';
      if (catMatch) {
        parsedCategory = catMatch[1];
        setCategory(parsedCategory);
      }
      
      if (methodMatch) {
        setMethod(methodMatch[1].toUpperCase());
      }
      
      // Extract main description text
      let mainDesc = descStr;
      if (catMatch) {
        mainDesc = mainDesc.replace(catMatch[0], '').trim();
      }
      if (methodMatch) {
        mainDesc = mainDesc.replace(methodMatch[0], '').trim();
      }
      setDescription(mainDesc);
    }
  }, [localEditingGasto]);

  useEffect(() => {
    if (category === 'Cobrar Sueldo' && !localEditingGasto) {
      api.get('/users')
        .then(({ data }) => {
          setUsersList(data || []);
          if (data && data.length > 0) {
            setSelectedUser(data[0].username);
          }
        })
        .catch((e) => console.error('Error fetching users in GastosModal', e));
    }
  }, [category, localEditingGasto]);

  useEffect(() => {
    if (category === 'Cobrar Sueldo' && !localEditingGasto) {
      const computedAmount = hoursWorked * rate;
      setAmount(computedAmount);
      setDescription(`Liquidación de sueldo para ${selectedUser} por ${hoursWorked} horas trabajadas (Valor hora: $${rate})`);
    }
  }, [category, hoursWorked, selectedUser, rate, localEditingGasto]);

  useEffect(() => {
    if (category === 'Retiro a caja fuerte' && !localEditingGasto) {
      setType('WITHDRAWAL');
      setDescription('RETIRO A CAJA FUERTE');
    } else if (category !== 'Cobrar Sueldo' && !localEditingGasto) {
      setType('EXPENSE');
      setDescription('');
    } else if (!localEditingGasto) {
      setType('EXPENSE');
    }
  }, [category, localEditingGasto]);

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    const handleGastosKeys = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const activeElement = document.activeElement;
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
  }, [sessionId, amount, description, category, method, selectedUser, hoursWorked, onClose, localEditingGasto]);

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
    if (!sessionId && !localEditingGasto) { toast.error('No hay caja abierta'); return; }
    if (amount <= 0) { toast.error('Ingresá un monto válido'); return; }
    if (category !== 'Cobrar Sueldo' && category !== 'Retiro a caja fuerte' && !description.trim()) {
      toast.error('⚠️ El campo Motivo es obligatorio');
      return;
    }
    try {
      const mappedCategory = category === 'Cobrar Sueldo' ? 'Sueldos / Adelantos' : category === 'Retiro a caja fuerte' ? 'Otro' : category;
      const finalDescription = `[${mappedCategory}] ${description.trim().toUpperCase()} | METODO: ${method}`;
      
      if (localEditingGasto) {
        await api.put(`/cash/movement/${localEditingGasto.id}`, {
          type,
          amount,
          description: finalDescription
        });
        toast.success('✅ Gasto actualizado correctamente');
      } else {
        await api.post(`/cash/${sessionId}/movement`, { 
          type, 
          amount, 
          description: finalDescription
        });
        toast.success('✅ Gasto registrado correctamente');
      }
      onClose();
    } catch (err: any) { toast.error(err.response?.data?.message || 'Error'); }
  };

  const fmt = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);

  // Expected Cash calculation in Drawer
  const cashPayments = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const expenses = session?.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const withdrawals = session?.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const expectedCash = cashPayments - expenses - withdrawals;

  const perfMode = typeof window !== 'undefined' && localStorage.getItem('performance_mode') === 'true';
  const MotionDiv = (perfMode ? 'div' : motion.div) as any;

  return (
    <MotionDiv {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })} className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <MotionDiv
          {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
          onClick={(e: any) => e.stopPropagation()}
          className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-3xl overflow-hidden shadow-xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]"
        >
          <div className="px-6 py-5 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {localEditingGasto ? 'Editar Gasto del Turno' : 'Registrar Gasto del Día'}
              </h2>
              <p className="text-xs text-slate-755 dark:text-slate-400 mt-0.5">
                {localEditingGasto ? 'Modificando un egreso de caja existente' : 'Gestión de egresos de caja'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {localEditingGasto && (
                <button 
                  onClick={() => {
                    setLocalEditingGasto(null);
                    setAmount(0);
                    setCategory('Otro');
                    setDescription('');
                    setMethod('CASH');
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-bold uppercase transition-all cursor-pointer border border-slate-300"
                >
                  Cancelar Edición
                </button>
              )}
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

        {/* Side-by-Side Content Area */}
        <div className="flex-1 flex flex-col md:flex-row gap-6 p-6 overflow-hidden">
          {/* Left Side: Registration Form */}
          <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-1.5">Monto</label>
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 flex items-center pointer-events-none">
                  <span className="text-slate-600 dark:text-slate-400 font-bold">$</span>
                </div>
                <input 
                  type="number" 
                  value={amount || ''} 
                  onChange={(e) => setAmount(Number(e.target.value))} 
                  disabled={category === 'Cobrar Sueldo'}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg pl-7 pr-4 py-3 text-lg font-bold text-slate-800 dark:text-slate-100 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:focus:ring-rose-900 outline-none transition-all disabled:bg-slate-50 dark:disabled:bg-slate-800/50 disabled:text-slate-700 dark:disabled:text-slate-500" 
                  placeholder="0,00" 
                  autoFocus 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-1.5">Categoría</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-white dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:focus:ring-rose-900 outline-none transition-all appearance-none">
                  <option>Otro</option>
                  <option>Retiro a caja fuerte</option>
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
                    <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-1.5">Personal</label>
                    <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="w-full bg-white dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all appearance-none">
                      {usersList.map((u: any) => (
                        <option key={u.id} value={u.username}>{u.username}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-1.5">Horas Trabajadas</label>
                    <input 
                      type="number" 
                      min="0"
                      step="0.5"
                      value={hoursWorked || ''} 
                      onChange={(e) => setHoursWorked(Number(e.target.value))} 
                      className="w-full bg-white dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-750 dark:text-slate-200 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all" 
                      placeholder="Ej: 1.5 o 8"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-2"><Wallet className="w-3 h-3" /> Método de Pago</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full bg-white dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all appearance-none">
                  <option value="CASH">💵 Efectivo</option>
                  <option value="TRANSFER">🏦 Transferencia</option>
                </select>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <Receipt className="w-4 h-4" /> Efectivo en caja
              </div>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {isLoadingSession ? 'Cargando...' : fmt(expectedCash)}
              </span>
            </div>

            {category !== 'Cobrar Sueldo' && category !== 'Retiro a caja fuerte' && (
              <div>
                <label className="block text-[10px] font-semibold text-slate-700 dark:text-slate-400 uppercase tracking-wider mb-1.5">Motivo (obligatorio)</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value.toUpperCase())} 
                  className="w-full bg-white dark:bg-slate-800 border border-slate-400 dark:border-slate-600 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none transition-all min-h-[70px] resize-none" 
                  placeholder="ESCRIBE EL MOTIVO DEL EGRESO..."
                />
              </div>
            )}

            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800 flex gap-3">
              <Info className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-[9px] text-rose-600 dark:text-rose-300 leading-relaxed font-medium">
                ¿Vas a pagarle a un proveedor? Usá el botón <b>"Proveedores"</b> arriba — así queda en su cuenta corriente y no se mezcla con tus gastos operativos.
              </p>
            </div>
          </div>

          {/* Desktop divider */}
          <div className="hidden md:block w-px bg-slate-100 dark:bg-slate-700 shrink-0 self-stretch" />

          {/* Right Side: Registered Expenses List */}
          <div className="w-full md:w-[280px] shrink-0 flex flex-col h-full overflow-hidden">
            <h4 className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.15em] ml-1 mb-3">Egresos del Turno Actual</h4>
            <div className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-400 dark:border-slate-700 rounded-xl p-3 overflow-y-auto custom-scrollbar space-y-2">
              {isLoadingSession ? (
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium text-center py-4">Cargando egresos...</p>
              ) : (!session?.cashMovements || session.cashMovements.length === 0) ? (
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium text-center py-8">No hay egresos registrados en esta sesión.</p>
              ) : (
                session.cashMovements.map((movement: any) => {
                  return (
                    <div 
                      key={movement.id} 
                      onClick={() => setSelectedMovement(movement)}
                      className="flex items-center justify-between bg-white dark:bg-slate-700 p-2.5 rounded-lg border border-slate-400 dark:border-slate-600 shadow-sm transition-all hover:border-slate-300 dark:hover:border-slate-500 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-600 active:scale-[0.98]"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate leading-snug">
                          {movement.description?.split(' | METODO: ')[0] || 'Gasto general'}
                        </p>
                      </div>
                      <span className="text-xs font-extrabold text-rose-600 dark:text-rose-400 shrink-0">
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
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex gap-3 shrink-0 bg-white dark:bg-slate-900">
          <button onClick={onClose} className="flex-1 btn-secondary text-sm">Cancelar</button>
          <button onClick={handleSubmit} className="flex-1 btn-primary text-sm">
            {localEditingGasto ? 'Guardar Cambios' : 'Guardar Gasto'}
          </button>
        </div>

        {/* Expense Detail Overlay Modal */}
        {selectedMovement && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 border border-slate-200 dark:border-slate-800 shadow-2xl relative animate-in zoom-in-95 duration-200">
              <button
                onClick={() => setSelectedMovement(null)}
                className="absolute top-4 right-4 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="flex items-center gap-3 border-b border-slate-150 dark:border-slate-700 pb-4 mb-4">
                <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800 flex items-center justify-center text-rose-500 shadow-inner">
                  <ArrowDownRight className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm">Detalle de Egreso</h3>
                  <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider mt-0.5">Operación registrada en caja</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-rose-50/50 dark:bg-rose-900/20 border border-rose-100/50 dark:border-rose-800/50 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-widest block mb-1">Monto Retirado</span>
                  <span className="text-3xl font-black text-rose-600 dark:text-rose-500 tracking-tight">-{fmt(selectedMovement.amount)}</span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-300 dark:border-slate-700">
                    <span className="text-slate-450 dark:text-slate-500 font-bold uppercase text-[9px] tracking-wider">Fecha / Hora:</span>
                    <span className="text-slate-750 dark:text-slate-300 font-semibold">{new Date(selectedMovement.createdAt).toLocaleString('es-AR')}</span>
                  </div>
                  
                  <div className="flex justify-between py-1.5 border-b border-slate-300 dark:border-slate-700">
                    <span className="text-slate-450 dark:text-slate-500 font-bold uppercase text-[9px] tracking-wider">Método de Pago:</span>
                    <span className="text-slate-750 dark:text-slate-300 font-extrabold uppercase">
                      {(selectedMovement.description?.split(' | METODO: ')[1] || 'CASH') === 'TRANSFER' ? '🏦 Transferencia' : '💵 Efectivo'}
                    </span>
                  </div>

                  <div className="flex flex-col py-1">
                    <span className="text-slate-450 dark:text-slate-500 font-bold uppercase text-[9px] tracking-wider mb-1">Motivo / Descripción:</span>
                    <p className="text-slate-850 dark:text-slate-200 font-extrabold bg-slate-50 dark:bg-slate-900/50 border border-slate-400/60 dark:border-slate-600 rounded-xl p-3.5 leading-relaxed text-xs break-words uppercase">
                      {selectedMovement.description?.split(' | METODO: ')[0] || 'SIN DETALLES REGISTRADOS'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button 
                  onClick={async () => {
                    if (window.confirm('¿Seguro que quieres eliminar este gasto?')) {
                       try {
                        await api.delete(`/cash/movement/${selectedMovement.id}`);
                        setSelectedMovement(null);
                        loadSession();
                      } catch (err: any) {
                        toast.error(err.response?.data?.message || 'Error al eliminar');
                      }
                    }
                  }}
                  className="flex-1 btn-danger text-xs uppercase tracking-wider"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Eliminar
                </button>
                <button
                  onClick={() => {
                    setAmount(selectedMovement.amount);
                    if (selectedMovement.type) setType(selectedMovement.type);

                    const descStr = selectedMovement.description || '';
                    const catMatch = descStr.match(/^\[(.*?)\]/);
                    const methodMatch = descStr.match(/\| METODO: (CASH|TRANSFER)$/i);

                    if (catMatch) setCategory(catMatch[1]);
                    if (methodMatch) setMethod(methodMatch[1].toUpperCase());

                    let mainDesc = descStr;
                    if (catMatch) mainDesc = mainDesc.replace(catMatch[0], '').trim();
                    if (methodMatch) mainDesc = mainDesc.replace(methodMatch[0], '').trim();
                    setDescription(mainDesc);

                    setLocalEditingGasto(selectedMovement);
                    setSelectedMovement(null);
                  }}
                  className="flex-1 btn-secondary text-xs uppercase tracking-wider"
                >
                  <Edit2 className="w-3.5 h-3.5" /> Editar
                </button>
                <button
                  onClick={() => setSelectedMovement(null)}
                  className="btn-secondary px-5 text-xs uppercase tracking-wider"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
        </MotionDiv>
    </MotionDiv>
  );
}
