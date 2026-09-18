import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import { Calendar, Monitor, User, Clock, Banknote, Smartphone, CreditCard, X, ChevronRight, CheckCircle2, FileOutput, ArrowRightLeft, Landmark, ShieldCheck, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import CierreDiaModal from '../cash-register/CierreDiaModal';
import { MangoIcon } from '../common/MangoLogo';

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
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [isZAction, setIsZAction] = useState(false);
  const [latestZReport, setLatestZReport] = useState<any>(null);
  const [loadingLatestZ, setLoadingLatestZ] = useState(false);

  const handlePrintLatestZ = async () => {
    setLoadingLatestZ(true);
    try {
      const { data } = await api.get('/cash/z-reports', { params: { limit: 1 } });
      if (!data || data.length === 0) {
        toast.error('No se encontró ningún reporte Z registrado en el sistema.');
        return;
      }
      setLatestZReport(data[0]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al obtener el último reporte Z');
    } finally {
      setLoadingLatestZ(false);
    }
  };

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

  // Calculations - uses pre-aggregated backend metrics for 0ms instantaneous render
  const salesTotal = session?.salesTotal ?? session?.sales?.reduce((s: number, v: any) => s + v.total, 0) ?? 0;
  const salesCount = session?.salesCount ?? session?.sales?.length ?? 0;
  const cashPayments = session?.cashSales ?? session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0), 0) ?? 0;
  const cloverPayments = session?.cloverSales ?? session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CLOVER').reduce((a: number, p: any) => a + p.amount, 0), 0) ?? 0;
  const mpPayments = session?.mpSales ?? session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'MERCADOPAGO').reduce((a: number, p: any) => a + p.amount, 0), 0) ?? 0;
  const expenses = session?.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const withdrawals = session?.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  
  const expectedCash = cashPayments - expenses - withdrawals;
  const totalInDrawer = expectedCash + cloverPayments + mpPayments;

  const perfMode = typeof window !== 'undefined' && localStorage.getItem('performance_mode') === 'true';
  const MotionDiv = (perfMode ? 'div' : motion.div) as any;

  return (
    <MotionDiv 
      {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3"
      onClick={onClose}
    >
      <MotionDiv
        {...(perfMode ? {} : { initial: { scale: 0.95, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.95, opacity: 0 } })}
        onClick={(e: any) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-6xl overflow-hidden shadow-xl flex flex-col max-h-[calc(100dvh-24px)] border border-slate-200 dark:border-slate-800 tabular-nums"
      >
        {/* Header */}
        <div className="px-6 py-3 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <MangoIcon className="w-6 h-6" />
            <div>
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 tracking-tight leading-none">Estado Actual de la Caja</h2>
              <p className="text-[12.5px] text-slate-500 dark:text-gray-400 font-semibold uppercase tracking-widest mt-1">Auditoría rápida del turno activo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-600 gap-3">
            <div className="w-8 h-8 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
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
            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-5 px-6 py-4 overflow-hidden">
              {/* Left Side: General Stats & breakdown */}
              <div className="flex-1 space-y-3 overflow-y-auto custom-scrollbar pr-2">
                {/* General Info Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-rose-50/40 dark:bg-rose-900/20 border border-rose-100/30 dark:border-rose-800/30">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider mb-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      Apertura
                    </div>
                    <p className="text-lg font-extrabold text-rose-900 dark:text-rose-100 leading-tight">{fmtDateTime(session.openedAt).date}</p>
                    <p className="text-sm font-bold text-rose-700 dark:text-rose-300 mt-0.5">{fmtDateTime(session.openedAt).time}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-50/40 dark:bg-emerald-900/20 border border-emerald-100/30 dark:border-emerald-800/30">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider mb-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      Transcurrido
                    </div>
                    <p className="text-lg font-extrabold text-emerald-900 dark:text-emerald-100 tracking-tight leading-tight">{timeElapsed || 'Calculando...'}</p>
                    <p className="text-[11.5px] font-bold text-emerald-700 dark:text-emerald-300 mt-1 uppercase tracking-widest">EN CURSO</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-amber-50/40 dark:bg-amber-900/20 border border-amber-100/30 dark:border-amber-800/30">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider mb-1.5">
                      <User className="w-3.5 h-3.5" />
                      Cajero Activo
                    </div>
                    <p className="text-lg font-extrabold text-amber-900 dark:text-amber-100 truncate leading-tight mt-1">{session.user?.fullName || session.user?.username || 'Sin cajero'}</p>
                    <p className="text-[11.5px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-widest mt-1">{session.user?.role || 'Empleado'}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                      <Monitor className="w-3.5 h-3.5" />
                      Terminal
                    </div>
                    <p className="text-lg font-extrabold text-slate-900 dark:text-slate-100 truncate leading-tight mt-1">{session.terminalName || 'Terminal 1'}</p>
                    <p className="text-[11.5px] font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mt-1">ID: #{session.id.substring(0, 6).toUpperCase()}</p>
                  </div>
                </div>

                {/* Financial Overview (Grand Totals) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-widest block mb-1">Ventas en Efectivo</span>
                      <p className="text-4xl font-black text-slate-900 dark:text-slate-100 tracking-tight">{fmt(cashPayments)}</p>
                    </div>
                    <div className="pt-3 border-t border-slate-300 dark:border-slate-600/50 mt-3 flex items-center justify-between text-sm text-slate-800 dark:text-slate-200 font-bold">
                      <span>Gastos Registrados</span>
                      <span className="text-red-600 dark:text-red-400 font-extrabold text-base">-{fmt(expenses + withdrawals)}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-md flex flex-col justify-between relative overflow-hidden">
                    <div>
                      <span className="text-xs font-bold text-white/85 uppercase tracking-widest block mb-1">Total Estimado en Caja</span>
                      <p className="text-4xl font-black tracking-tight">{fmt(totalInDrawer)}</p>
                    </div>
                    <div className="pt-3 border-t border-white/25 mt-3 flex items-center justify-between text-sm text-white font-bold">
                      <span>Total Ventas Turno ({salesCount})</span>
                      <span className="font-extrabold text-base">{fmt(salesTotal)}</span>
                    </div>
                  </div>
                </div>

                {/* Payment Methods breakdown */}
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.2em] ml-1">Monto según medio de pago</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Cash */}
                    <div className="p-3.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Banknote className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11.5px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">Efectivo</span>
                        <span className="block text-2xl font-black text-slate-900 dark:text-slate-100 leading-tight">{fmt(cashPayments)}</span>
                        <span className="text-[11.5px] font-bold text-slate-600 dark:text-slate-500 block mt-0.5">En Caja: {fmt(expectedCash)}</span>
                      </div>
                    </div>

                    {/* Clover */}
                    <div className="p-3.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11.5px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">Clover POS</span>
                        <span className="block text-2xl font-black text-slate-900 dark:text-slate-100 leading-tight">{fmt(cloverPayments)}</span>
                        <span className="text-[11.5px] font-bold text-slate-600 dark:text-slate-500 block mt-0.5">Tarjetas comprobante</span>
                      </div>
                    </div>

                    {/* MP */}
                    <div className="p-3.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11.5px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">MercadoPago</span>
                        <span className="block text-2xl font-black text-slate-900 dark:text-slate-100 leading-tight">{fmt(mpPayments)}</span>
                        <span className="text-[11.5px] font-bold text-slate-600 dark:text-slate-500 block mt-0.5">Pagos QR en vivo</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Audit warning / footer info */}
                <div className="p-3.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100/50 dark:border-amber-900/30 flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span className="font-bold text-slate-900 dark:text-slate-100">Control de Caja:</span> Este informe es de carácter informativo. Para auditar diferencias concilia registros.
                  </div>
                </div>
              </div>

              {/* Desktop divider */}
              <div className="hidden md:block w-px bg-slate-100 dark:bg-slate-800 shrink-0 self-stretch" />

              {/* Right Side: Detailed Expenses list */}
              <div className="w-full md:w-[420px] shrink-0 flex flex-col h-full overflow-hidden">
                <h4 className="text-xs font-bold text-slate-600 uppercase tracking-[0.2em] ml-1 mb-2.5">Detalle de Gastos y Salidas</h4>
                <div className="flex-1 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-slate-800 rounded-2xl p-3.5 overflow-y-auto custom-scrollbar space-y-2">
                  {(!session.cashMovements || session.cashMovements.length === 0) ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400 font-medium text-center py-8">No hay gastos o egresos registrados en este turno.</p>
                  ) : (
                    session.cashMovements.map((movement: any) => {
                      return (
                        <div key={movement.id} onClick={() => setSelectedMovement(movement)} className="flex items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm transition-all hover:border-rose-300 dark:hover:border-rose-555 cursor-pointer hover:shadow-md">
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate leading-snug">
                              {movement.description || 'Gasto general'}
                            </p>
                            <p className="text-[11.5px] font-bold text-slate-600 dark:text-slate-400 mt-1 uppercase">
                              {fmtDateTime(movement.createdAt).time} - {movement.type === 'EXPENSE' ? 'GASTO / PAGO' : 'RETIRO'}
                            </p>
                          </div>
                          <span className="text-lg font-extrabold text-red-600 dark:text-red-400 shrink-0">
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
            <div className="px-6 py-3 border-t border-slate-300 dark:border-slate-800 flex flex-col md:flex-row justify-between items-center gap-3 shrink-0 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-2 w-full md:w-auto">
                <button 
                  type="button"
                  onClick={handlePrintLatestZ}
                  disabled={loadingLatestZ}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold uppercase tracking-wider transition-all active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title="Imprimir copia del último reporte Z emitido"
                >
                  <Printer className="w-4 h-4 text-slate-600" />
                  <span>{loadingLatestZ ? 'Cargando...' : 'Reimprimir Último Z'}</span>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
                {/* Botón 1: Cambio de Turno (Cierre X) */}
                <button 
                  onClick={() => {
                    setIsZAction(false);
                    setShowConfirmClose(true);
                  }}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border-2 border-slate-300 hover:border-sky-400 dark:border-slate-700 dark:hover:border-sky-600 bg-white hover:bg-sky-50/50 dark:bg-slate-800 dark:hover:bg-sky-950/30 text-left transition-all active:scale-95 cursor-pointer shadow-xs group"
                >
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-sky-600 dark:text-sky-400 group-hover:scale-110 transition-transform" />
                    <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">Cambio de Turno (Cierre X)</span>
                  </div>
                  <span className="block text-xs text-slate-600 dark:text-slate-400 font-semibold mt-0.5">
                    Para cuando entra otro cajero en el mismo día
                  </span>
                </button>

                {/* Botón 2: Cierre Final del Día (Cierre Z) */}
                <button 
                  onClick={() => {
                    setIsZAction(true);
                    setShowConfirmClose(true);
                  }}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border-2 border-rose-600 bg-rose-600 hover:bg-rose-700 text-white text-left transition-all active:scale-95 cursor-pointer shadow-md shadow-rose-500/20 group"
                >
                  <div className="flex items-center gap-2">
                    <FileOutput className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
                    <span className="text-sm font-black tracking-tight text-white">Cierre Final del Día (Cierre Z)</span>
                  </div>
                  <span className="block text-xs text-white/90 font-semibold mt-0.5">
                    Para cuando el local cierra sus puertas
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </MotionDiv>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedMovement && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} 
            onClick={() => setSelectedMovement(null)}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800"
            >
              <div className="bg-slate-50 p-6 border-b border-slate-200 text-center">
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Banknote className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">Detalle de Movimiento</h3>
                <p className="text-xs uppercase font-bold tracking-widest text-slate-600 mt-1">{fmtDateTime(selectedMovement.createdAt).date} - {fmtDateTime(selectedMovement.createdAt).time}</p>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-widest block mb-1">Monto del Movimiento</label>
                  <p className="text-3xl font-black text-rose-600 tracking-tighter">-{fmt(selectedMovement.amount)}</p>
                </div>
                <div>
                  <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-widest block mb-1">Descripción Registrada</label>
                  <p className="text-sm font-bold text-slate-700 bg-slate-100 p-3 rounded-xl border border-slate-200 leading-snug break-words">
                    {selectedMovement.description || 'Sin descripción detallada'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-widest block mb-1">Tipo</label>
                    <span className="inline-block px-2 py-1 bg-rose-50 text-rose-600 text-xs font-bold uppercase rounded border border-rose-100">
                      {selectedMovement.type === 'EXPENSE' ? 'Gasto Operativo' : 'Retiro Manual'}
                    </span>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11.5px] font-bold text-slate-600 uppercase tracking-widest block mb-1">Cajero</label>
                    <span className="text-xs font-bold text-slate-700 uppercase">{selectedMovement.user?.fullName || session.user?.fullName || 'Desconocido'}</span>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-200">
                <button onClick={() => setSelectedMovement(null)} className="btn-secondary w-full py-3 text-xs uppercase tracking-wider">
                  Cerrar Detalle
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modern Confirm Close Modal */}
      <AnimatePresence>
        {showConfirmClose && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800"
            >
              <div className={`p-6 border-b text-center ${
                isZAction 
                  ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/30' 
                  : 'bg-sky-50 dark:bg-sky-950/30 border-sky-100 dark:border-sky-900/30'
              }`}>
                <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner ${
                  isZAction 
                    ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400' 
                    : 'bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400'
                }`}>
                  {isZAction ? <FileOutput className="w-7 h-7" /> : <ArrowRightLeft className="w-7 h-7" />}
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  {isZAction ? 'Cierre Final del Día (Cierre Z)' : 'Cambio de Turno (Cierre X)'}
                </h3>
                <p className={`text-xs uppercase font-bold tracking-widest mt-1 ${
                  isZAction ? 'text-rose-600 dark:text-rose-400' : 'text-sky-600 dark:text-sky-400'
                }`}>
                  {isZAction ? 'Fin de Jornada Comercial' : 'Relevo de Cajero'}
                </p>
              </div>
              <div className="p-6 text-center space-y-3">
                <p className="text-base font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
                  {isZAction 
                    ? '¿El local cierra sus puertas? Se liquidará la jornada completa y se emitirá el Reporte Z diario.' 
                    : '¿Entra otro cajero a relevarte en este mismo día? Tu turno individual quedará arqueado y cerrado, y la jornada comercial continuará abierta para el nuevo cajero.'
                  }
                </p>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl border border-amber-300 dark:border-amber-800/50">
                  💡 Recordá verificar si ya te cobraste tu sueldo de hoy antes de confirmar.
                </p>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 flex gap-3">
                <button 
                  onClick={() => {
                    setShowConfirmClose(false);
                    if (isZAction) {
                      onTriggerCloseAndZ();
                    } else {
                      onTriggerClose();
                    }
                  }} 
                  className={`flex-1 py-3.5 rounded-xl text-white font-extrabold text-sm uppercase tracking-wide transition-all active:scale-[0.98] shadow-md cursor-pointer ${
                    isZAction 
                      ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-500/20' 
                      : 'bg-sky-600 hover:bg-sky-700 shadow-sky-500/20'
                  }`}
                >
                  {isZAction ? 'Sí, Cierre Final del Día' : 'Sí, Confirmar Relevo'}
                </button>
                <button
                  onClick={() => setShowConfirmClose(false)}
                  className="btn-secondary px-5 py-3.5 text-sm uppercase tracking-wide"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {latestZReport && (
        <CierreDiaModal
          zReport={latestZReport}
          isHistory={true}
          onClose={() => setLatestZReport(null)}
        />
      )}
    </MotionDiv>
  );
}
