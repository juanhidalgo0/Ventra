import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { Calendar, Monitor, User, Clock, Banknote, Smartphone, CreditCard, X, ChevronRight, CheckCircle2, FileOutput, ArrowRightLeft, Landmark, ShieldCheck } from 'lucide-react';

interface CajaInfoModalProps {
  sessionId?: string;
  onClose: () => void;
  onTriggerClose: () => void;
  onTriggerCloseAndZ: () => void;
  terminalName: string;
}

export default function CajaInfoModal({ sessionId, onClose, onTriggerClose, onTriggerCloseAndZ, terminalName }: CajaInfoModalProps) {
  const [session, setSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeElapsed, setTimeElapsed] = useState<string>('');
  const [selectedMovement, setSelectedMovement] = useState<any>(null);

  const loadSession = async () => {
    try {
      const { data } = await api.get('/cash/current', { params: { terminalName } });
      setSession(data);
    } catch (err) {
      console.error('Error fetching current session', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSession();

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  // Update time elapsed dynamically every second
  useEffect(() => {
    if (!session?.openedAt) return;

    const updateTimer = () => {
      const start = new Date(session.openedAt).getTime();
      const now = Date.now();
      const diffMs = now - start;

      const diffSecs = Math.floor(diffMs / 1000);
      const hours = Math.floor(diffSecs / 3600);
      const minutes = Math.floor((diffSecs % 3600) / 60);
      const seconds = diffSecs % 60;

      let timeString = '';
      if (hours > 0) {
        timeString += `${hours}h `;
      }
      timeString += `${minutes}m ${seconds}s`;
      setTimeElapsed(timeString);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session]);

  const fmt = (p: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p);
  const fmtDateTime = (d: string) => {
    const date = new Date(d);
    return {
      date: date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  };

  // Calculations
  const salesTotal = session?.sales?.reduce((s: number, v: any) => s + v.total, 0) || 0;
  const salesCount = session?.sales?.length || 0;
  const cashPayments = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const cloverPayments = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CLOVER').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const mpPayments = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'MERCADOPAGO').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const expenses = session?.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const withdrawals = session?.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  
  const expectedCash = cashPayments - expenses - withdrawals;
  const totalInDrawer = expectedCash + cloverPayments + mpPayments;

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }} 
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.95, opacity: 0 }} 
        onClick={(e) => e.stopPropagation()} 
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-6xl overflow-hidden shadow-xl flex flex-col max-h-[90vh] border border-slate-300 dark:border-slate-700"
      >
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 tracking-tight">Estado Actual de la Caja</h2>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest mt-0.5">Auditoría rápida del turno activo</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl text-gray-400 dark:text-gray-500 transition-all"><X className="w-5 h-5" /></button>
        </div>

        {isLoading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-600 gap-3">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-bold uppercase tracking-widest">Cargando datos de caja...</p>
          </div>
        ) : !session ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Caja Cerrada</h3>
            <p className="text-sm text-slate-600 max-w-[280px] mx-auto mb-6">No hay ninguna sesión de caja abierta actualmente en esta terminal.</p>
            <button onClick={onClose} className="btn-primary px-6 py-2.5 rounded-xl">Entendido</button>
          </div>
        ) : (
          <>
            {/* Side-by-Side Area */}
            <div className="flex-1 flex flex-col md:flex-row gap-6 p-8 overflow-hidden">
              {/* Left Side: General Stats & breakdown */}
              <div className="flex-1 space-y-6 overflow-y-auto custom-scrollbar pr-2">
                {/* General Info Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-indigo-50/40 dark:bg-indigo-900/20 border border-indigo-100/30 dark:border-indigo-800/30">
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-2">
                      <Calendar className="w-3.5 h-3.5" />
                      Apertura
                    </div>
                    <p className="text-sm font-bold text-indigo-900 dark:text-indigo-100">{fmtDateTime(session.openedAt).date}</p>
                    <p className="text-[10px] font-bold text-indigo-400/80 dark:text-indigo-300/80 mt-0.5">{fmtDateTime(session.openedAt).time}</p>
                  </div>

                  <div className="p-4 rounded-xl bg-emerald-50/40 dark:bg-emerald-900/20 border border-emerald-100/30 dark:border-emerald-800/30">
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-500 dark:text-emerald-400 uppercase tracking-wider mb-2">
                      <Clock className="w-3.5 h-3.5" />
                      Transcurrido
                    </div>
                    <p className="text-base font-bold text-emerald-800 dark:text-emerald-100 tracking-tight leading-tight">{timeElapsed || 'Calculando...'}</p>
                    <p className="text-[9px] font-bold text-emerald-500/80 dark:text-emerald-400/80 mt-1 uppercase tracking-widest">EN CURSO</p>
                  </div>

                  <div className="p-4 rounded-xl bg-amber-50/40 dark:bg-amber-900/20 border border-amber-100/30 dark:border-amber-800/30">
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-wider mb-2">
                      <User className="w-3.5 h-3.5" />
                      Cajero Activo
                    </div>
                    <p className="text-sm font-bold text-amber-900 dark:text-amber-100 truncate leading-none mt-1">{session.user?.fullName || session.user?.username || 'Sin cajero'}</p>
                    <p className="text-[9px] font-bold text-amber-400 dark:text-amber-500 uppercase tracking-widest mt-1">{session.user?.role || 'Empleado'}</p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                    <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2">
                      <Monitor className="w-3.5 h-3.5" />
                      Terminal
                    </div>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate leading-none mt-1">{session.terminalName || 'Terminal 1'}</p>
                    <p className="text-[9px] font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mt-1">ID: #{session.id.substring(0, 6).toUpperCase()}</p>
                  </div>
                </div>

                {/* Financial Overview (Grand Totals) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest block mb-1">Ventas en Efectivo</span>
                      <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 tracking-tighter">{fmt(cashPayments)}</p>
                    </div>
                    <div className="pt-4 border-t border-slate-400/50 dark:border-slate-600/50 mt-4 flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 font-bold">
                      <span>Gastos Registrados</span>
                      <span className="text-rose-500 font-bold">-{fmt(expenses + withdrawals)}</span>
                    </div>
                  </div>

                  <div className="p-6 rounded-2xl bg-indigo-600 dark:bg-indigo-700 text-white shadow-md flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-xl -mr-6 -mt-6" />
                    <div>
                      <span className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest block mb-1">Total Estimado en Caja</span>
                      <p className="text-3xl font-bold tracking-tighter">{fmt(totalInDrawer)}</p>
                    </div>
                    <div className="pt-4 border-t border-indigo-500/50 mt-4 flex items-center justify-between text-xs text-indigo-100 font-bold">
                      <span>Total Ventas Turno ({salesCount})</span>
                      <span className="font-bold">{fmt(salesTotal)}</span>
                    </div>
                  </div>
                </div>

                {/* Payment Methods breakdown */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.2em] ml-1">Monto según medio de pago</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Cash */}
                    <div className="p-4 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Banknote className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">Efectivo</span>
                        <span className="text-base font-bold text-slate-800 dark:text-slate-100">{fmt(cashPayments)}</span>
                        <span className="text-[8px] font-bold text-slate-600 dark:text-slate-500 block mt-0.5">En Caja: {fmt(expectedCash)}</span>
                      </div>
                    </div>

                    {/* Clover */}
                    <div className="p-4 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">Clover POS</span>
                        <span className="text-base font-bold text-slate-800 dark:text-slate-100">{fmt(cloverPayments)}</span>
                        <span className="text-[8px] font-bold text-slate-600 dark:text-slate-500 block mt-0.5">Tarjetas comprobante</span>
                      </div>
                    </div>

                    {/* MP */}
                    <div className="p-4 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">MercadoPago</span>
                        <span className="text-base font-bold text-slate-800 dark:text-slate-100">{fmt(mpPayments)}</span>
                        <span className="text-[8px] font-bold text-slate-600 dark:text-slate-500 block mt-0.5">Pagos QR en vivo</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Audit warning / footer info */}
                <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-100/50 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs font-semibold text-slate-650">
                    <span className="font-bold text-slate-850">Control de Caja:</span> Este informe es de carácter informativo. Para auditar diferencias concilia registros.
                  </div>
                </div>
              </div>

              {/* Desktop divider */}
              <div className="hidden md:block w-px bg-slate-100 shrink-0 self-stretch" />

              {/* Right Side: Detailed Expenses list */}
              <div className="w-full md:w-[450px] shrink-0 flex flex-col h-full overflow-hidden">
                <h4 className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.2em] ml-1 mb-3">Detalle de Gastos y Salidas</h4>
                <div className="flex-1 bg-slate-50 border border-slate-300 rounded-2xl p-4 overflow-y-auto custom-scrollbar space-y-2">
                  {(!session.cashMovements || session.cashMovements.length === 0) ? (
                    <p className="text-xs text-slate-600 font-medium text-center py-8">No hay gastos o egresos registrados en este turno.</p>
                  ) : (
                    session.cashMovements.map((movement: any) => {
                      return (
                        <div key={movement.id} onClick={() => setSelectedMovement(movement)} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-400 shadow-sm transition-all hover:border-indigo-300 cursor-pointer hover:shadow-md">
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-sm font-bold text-slate-700 truncate leading-snug">
                              {movement.description || 'Gasto general'}
                            </p>
                            <p className="text-[9px] font-bold text-slate-500 mt-1 uppercase">
                              {fmtDateTime(movement.createdAt).time} - {movement.type === 'EXPENSE' ? 'GASTO / PAGO' : 'RETIRO'}
                            </p>
                          </div>
                          <span className="text-base font-extrabold text-rose-600 shrink-0">
                            -{fmt(movement.amount)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons Footer */}
            <div className="px-8 py-5 border-t border-slate-300 flex justify-between items-center shrink-0 bg-white">
              <span className="text-[10px] text-slate-600 font-bold uppercase tracking-wider">¿Deseas finalizar el turno?</span>
              <div className="flex items-center gap-3">
                <button 
                  onClick={onTriggerCloseAndZ}
                  className="px-6 py-3 rounded-xl border-2 border-indigo-600 text-indigo-700 hover:bg-indigo-50 text-xs font-bold uppercase tracking-wider transition-all active:scale-95 flex items-center gap-2"
                >
                  <FileOutput className="w-4 h-4" /> cerrar y hacer z
                </button>
                <button 
                  onClick={onTriggerClose}
                  className="px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-750 text-xs font-bold text-white uppercase tracking-wider shadow-md transition-all active:scale-95 flex items-center gap-2"
                >
                  <Monitor className="w-4 h-4" /> cerrar caja
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedMovement && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
            onClick={() => setSelectedMovement(null)}
            className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
            >
              <div className="bg-slate-50 p-6 border-b border-slate-200 text-center">
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Banknote className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">Detalle de Movimiento</h3>
                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mt-1">{fmtDateTime(selectedMovement.createdAt).date} - {fmtDateTime(selectedMovement.createdAt).time}</p>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Monto del Movimiento</label>
                  <p className="text-3xl font-black text-rose-600 tracking-tighter">-{fmt(selectedMovement.amount)}</p>
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Descripción Registrada</label>
                  <p className="text-sm font-bold text-slate-700 bg-slate-100 p-3 rounded-xl border border-slate-200 leading-snug break-words">
                    {selectedMovement.description || 'Sin descripción detallada'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Tipo</label>
                    <span className="inline-block px-2 py-1 bg-rose-50 text-rose-600 text-[10px] font-bold uppercase rounded border border-rose-100">
                      {selectedMovement.type === 'EXPENSE' ? 'Gasto Operativo' : 'Retiro Manual'}
                    </span>
                  </div>
                  <div className="flex-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Cajero</label>
                    <span className="text-xs font-bold text-slate-700 uppercase">{selectedMovement.user?.fullName || session.user?.fullName || 'Desconocido'}</span>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-200">
                <button onClick={() => setSelectedMovement(null)} className="w-full py-3 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider hover:bg-slate-100 transition-all">
                  Cerrar Detalle
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
