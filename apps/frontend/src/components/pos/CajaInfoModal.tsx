import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import api from '../../services/api';
import { Calendar, Monitor, User, Clock, Banknote, Smartphone, CreditCard, X, ChevronRight, FileOutput, ArrowRightLeft, Landmark, ShieldCheck, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import CierreDiaModal from '../cash-register/CierreDiaModal';
import { useOpeningFloat } from '../../utils/openingFloat';

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
  const openingFloat = useOpeningFloat();

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

  const cajero = session?.user?.fullName || session?.user?.username || 'Sin cajero';
  const rol = session?.user?.role === 'ADMIN' ? 'Administrador' : session?.user?.role === 'CASHIER' ? 'Cajero' : (session?.user?.role || 'Empleado');
  const openedAt = session?.openedAt ? new Date(session.openedAt) : null;
  const opened = openedAt
    ? `${openedAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} · ${openedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} h`
    : '';
  const hhmm = (d: string) => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  // "PAGO PROVEEDOR | METODO: CASH" → descripción limpia + medio legible
  const METHOD_LABEL: Record<string, string> = { CASH: 'Efectivo', CLOVER: 'Clover', MERCADOPAGO: 'Mercado Pago', TRANSFER: 'Transferencia' };
  const splitDesc = (desc?: string) => {
    const m = /\s*\|\s*METODO:\s*([A-Z_]+)\s*$/i.exec(desc || '');
    return { text: (m ? (desc || '').slice(0, m.index) : desc) || 'Gasto general', method: m ? (METHOD_LABEL[m[1].toUpperCase()] || m[1]) : null };
  };
  const methodsTotal = cashPayments + cloverPayments + mpPayments;
  const share = (v: number) => (methodsTotal > 0 ? Math.round((v / methodsTotal) * 100) : 0);
  const methods = [
    { key: 'cash', label: 'Efectivo', hint: 'Cobrado en el mostrador', amount: cashPayments, Icon: Banknote },
    { key: 'clover', label: 'Clover', hint: 'Tarjetas, según comprobantes', amount: cloverPayments, Icon: CreditCard },
    { key: 'mp', label: 'Mercado Pago', hint: 'QR y transferencias', amount: mpPayments, Icon: Smartphone },
  ];
  const movements: any[] = session?.cashMovements || [];

  return (
    <MotionDiv
      {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })}
      className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-0 sm:p-3"
      onClick={onClose}
    >
      <MotionDiv
        {...(perfMode ? {} : { initial: { scale: 0.98, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.98, opacity: 0 } })}
        onClick={(e: any) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 sm:rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-24px)] sm:border border-slate-200 dark:border-slate-800 tabular-nums"
      >
        {/* Encabezado: quién, dónde y desde cuándo, en una sola línea */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-none">Estado de la caja</h2>
                {session && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Abierta
                  </span>
                )}
              </div>
              {session && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5"><Monitor className="w-3.5 h-3.5" />{session.terminalName || 'Terminal 1'}</span>
                  <span className="inline-flex items-center gap-1.5"><User className="w-3.5 h-3.5" /><span className="font-semibold text-slate-700 dark:text-slate-200">{cajero}</span> · {rol}</span>
                  <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Abrió {opened}</span>
                  <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{timeElapsed || '…'}</span>
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} title="Cerrar (Esc)" className="p-2 -mr-2 -mt-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-500 gap-3">
            <div className="w-7 h-7 border-[3px] border-rose-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium">Cargando la caja…</p>
          </div>
        ) : !session ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">La caja está cerrada</h3>
            <p className="text-sm text-slate-500 max-w-[300px] mx-auto mb-6">No hay ningún turno abierto en esta terminal.</p>
            <button onClick={onClose} className="btn-primary px-6 py-2.5 rounded-xl mx-auto">Entendido</button>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
              {/* Izquierda: totales y medios de pago */}
              <div className="md:flex-1 min-w-0 px-4 sm:px-6 pt-4 pb-3 space-y-4 md:overflow-y-auto custom-scrollbar">
                {/* Totales */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl bg-rose-700 text-white px-4 py-3">
                    <p className="text-[12.5px] font-medium text-white/80">Total esperado</p>
                    <p className="text-[26px] font-extrabold tracking-tight leading-tight mt-0.5">{fmt(totalInDrawer)}</p>
                    <p className="text-[12px] text-white/75 mt-1">Efectivo, Clover y Mercado Pago, ya descontados gastos y retiros</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3">
                    <p className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">Ventas del turno</p>
                    <p className="text-[26px] font-extrabold tracking-tight leading-tight mt-0.5 text-slate-900 dark:text-slate-100">{fmt(salesTotal)}</p>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-1">{salesCount} {salesCount === 1 ? 'venta' : 'ventas'}{salesCount > 0 ? ` · ticket promedio ${fmt(Math.round(salesTotal / salesCount))}` : ''}</p>
                  </div>
                </div>

                {/* Por medio de pago */}
                <section>
                  <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 mb-2">Por medio de pago</h3>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                    {methods.map(({ key, label, hint, amount, Icon }) => (
                      <div key={key} className="flex items-center gap-3 px-4 py-2">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
                            <span className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{fmt(amount)}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[11.5px] text-slate-500 dark:text-slate-400 shrink-0 w-[170px] truncate">{hint}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div className="h-full rounded-full bg-rose-500" style={{ width: `${share(amount)}%` }} />
                            </div>
                            <span className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400 w-9 text-right">{share(amount)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Efectivo: de dónde sale lo que tiene que haber */}
                <section>
                  <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 mb-2">Efectivo en el cajón</h3>
                  <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm space-y-1">
                    <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Ventas en efectivo</span><span className="font-medium text-slate-800 dark:text-slate-100">{fmt(cashPayments)}</span></div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Gastos y pagos</span><span className="font-medium text-red-600 dark:text-red-400">{expenses ? `−${fmt(expenses)}` : fmt(0)}</span></div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Retiros</span><span className="font-medium text-red-600 dark:text-red-400">{withdrawals ? `−${fmt(withdrawals)}` : fmt(0)}</span></div>
                    <div className="flex justify-between pt-2 mt-1 border-t border-slate-200 dark:border-slate-700">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">Efectivo esperado</span>
                      <span className="text-base font-extrabold text-slate-900 dark:text-slate-100">{fmt(expectedCash)}</span>
                    </div>
                  </div>
                  <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500 dark:text-slate-400 mt-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    {openingFloat != null
                      ? `Aparte queda el fondo inicial de ${fmt(openingFloat)}, que siempre se deja en el cajón. Las diferencias se controlan en el arqueo.`
                      : 'Sin contar el fondo inicial, que siempre queda en el cajón. Las diferencias se controlan en el arqueo.'}
                  </p>
                </section>
              </div>

              {/* Derecha: gastos y retiros */}
              <div className="w-full md:w-[360px] shrink-0 flex flex-col min-h-0 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="px-5 pt-4 pb-2 flex items-baseline justify-between">
                  <h3 className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">Gastos y retiros</h3>
                  <span className="text-[12px] text-slate-500 dark:text-slate-400">{movements.length} {movements.length === 1 ? 'movimiento' : 'movimientos'}</span>
                </div>
                <div className="md:flex-1 md:min-h-0 md:overflow-y-auto custom-scrollbar px-3 pb-3">
                  {movements.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10 px-4">No hubo gastos ni retiros en este turno.</p>
                  ) : (
                    movements.map((movement: any) => {
                      const { text, method } = splitDesc(movement.description);
                      const isExpense = movement.type === 'EXPENSE';
                      return (
                        <button
                          type="button"
                          key={movement.id}
                          onClick={() => setSelectedMovement(movement)}
                          className="w-full text-left flex items-center gap-3 px-2.5 py-2.5 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer group"
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isExpense ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'}`}>
                            {isExpense ? <FileOutput className="w-4 h-4" /> : <ArrowRightLeft className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 truncate leading-snug">{text}</p>
                            <p className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {hhmm(movement.createdAt)} h · {isExpense ? 'Gasto' : 'Retiro'}{method ? ` · ${method}` : ''}
                            </p>
                          </div>
                          <span className="text-[13.5px] font-bold text-red-600 dark:text-red-400 shrink-0">−{fmt(movement.amount)}</span>
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0 -ml-1" />
                        </button>
                      );
                    })
                  )}
                </div>
                {movements.length > 0 && (
                  <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">Total</span>
                    <span className="font-bold text-red-600 dark:text-red-400">−{fmt(expenses + withdrawals)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Acciones */}
            <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row justify-between items-center gap-3 shrink-0 bg-white dark:bg-slate-900">
              <button
                type="button"
                onClick={handlePrintLatestZ}
                disabled={loadingLatestZ}
                className="w-full md:w-auto px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[13px] font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                title="Imprimir una copia del último reporte Z"
              >
                <Printer className="w-4 h-4" />
                <span>{loadingLatestZ ? 'Buscando…' : 'Reimprimir último Z'}</span>
              </button>

              <div className="grid grid-cols-2 sm:flex items-stretch sm:items-center gap-2.5 w-full md:w-auto">
                <button
                  onClick={() => {
                    setIsZAction(false);
                    setShowConfirmClose(true);
                  }}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-left transition-colors active:scale-[0.98] cursor-pointer"
                >
                  <span className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900 dark:text-slate-100">
                    <ArrowRightLeft className="w-4 h-4 text-slate-500" />
                    Cambio de turno <span className="hidden sm:inline font-medium text-slate-500">· Cierre X</span>
                  </span>
                  <span className="hidden sm:block text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">Entra otro cajero el mismo día</span>
                </button>

                <button
                  onClick={() => {
                    setIsZAction(true);
                    setShowConfirmClose(true);
                  }}
                  className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-left transition-colors active:scale-[0.98] cursor-pointer shadow-sm"
                >
                  <span className="flex items-center gap-2 text-[13.5px] font-bold">
                    <FileOutput className="w-4 h-4" />
                    Cierre del día <span className="hidden sm:inline font-medium text-white/80">· Cierre Z</span>
                  </span>
                  <span className="hidden sm:block text-[11.5px] text-white/85 mt-0.5">El local cierra por hoy</span>
                </button>
              </div>
            </div>
          </>
        )}
      </MotionDiv>

      {/* Detalle de un gasto o retiro */}
      {selectedMovement && (() => {
        const { text, method } = splitDesc(selectedMovement.description);
        const isExpense = selectedMovement.type === 'EXPENSE';
        return (
          <div onClick={(e) => { e.stopPropagation(); setSelectedMovement(null); }} className="fixed inset-0 z-[60] bg-slate-950/50 flex items-center justify-center p-4">
            <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden tabular-nums">
              <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">{isExpense ? 'Gasto' : 'Retiro'} · {hhmm(selectedMovement.createdAt)} h</p>
                  <p className="text-[28px] font-extrabold text-red-600 dark:text-red-400 tracking-tight leading-tight mt-0.5">−{fmt(selectedMovement.amount)}</p>
                </div>
                <button onClick={() => setSelectedMovement(null)} className="p-2 -mr-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><X className="w-5 h-5" /></button>
              </div>
              <dl className="px-5 pb-5 space-y-3 text-[14px]">
                <div>
                  <dt className="text-[12.5px] text-slate-500 dark:text-slate-400">Descripción</dt>
                  <dd className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5 break-words">{text}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-[12.5px] text-slate-500 dark:text-slate-400">Pagado con</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{method || 'Efectivo'}</dd>
                  </div>
                  <div>
                    <dt className="text-[12.5px] text-slate-500 dark:text-slate-400">Registró</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200 mt-0.5 truncate">{selectedMovement.user?.fullName || session?.user?.fullName || 'Sin dato'}</dd>
                  </div>
                </div>
              </dl>
            </div>
          </div>
        );
      })()}

      {/* Confirmación del cierre X o Z */}
      {showConfirmClose && (
        <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 z-[70] bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-6 pt-6 pb-5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${isZAction ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                {isZAction ? <FileOutput className="w-5 h-5" /> : <ArrowRightLeft className="w-5 h-5" />}
              </div>
              <h3 className="text-[19px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                {isZAction ? 'Cierre del día (Cierre Z)' : 'Cambio de turno (Cierre X)'}
              </h3>
              <p className="text-[14px] text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                {isZAction
                  ? 'Se hace el arqueo de tu turno y después se cierra la jornada completa con el reporte Z del día.'
                  : 'Se hace el arqueo de tu turno y se cierra. La jornada sigue abierta para el cajero que entra.'}
              </p>
            </div>
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5">
              <button onClick={() => setShowConfirmClose(false)} className="px-4 py-2.5 rounded-xl text-[14px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                Cancelar
              </button>
              <button
                autoFocus
                onClick={() => {
                  setShowConfirmClose(false);
                  if (isZAction) onTriggerCloseAndZ();
                  else onTriggerClose();
                }}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-semibold transition-colors cursor-pointer"
              >
                {isZAction ? 'Empezar el cierre del día' : 'Empezar el arqueo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* El Z va en portal, pero sus clics igual suben por el árbol de React: sin este corte
          llegan al fondo de este modal, que lo cierra y desmonta el Z antes de imprimir */}
      {latestZReport && (
        <div onClick={(e) => e.stopPropagation()}>
          <CierreDiaModal
            zReport={latestZReport}
            isHistory={true}
            onClose={() => setLatestZReport(null)}
          />
        </div>
      )}
    </MotionDiv>
  );
}
