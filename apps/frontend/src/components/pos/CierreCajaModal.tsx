import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, DollarSign, Wallet, Smartphone, Banknote, CreditCard, ChevronRight, AlertCircle, CheckCircle2, Printer, Plus, Trash2, Edit2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import api from '../../services/api';
import toast from 'react-hot-toast';
import GastosModal from './GastosModal';

interface CierreCajaModalProps {
  session: any;
  isFollowedByZ?: boolean;
  onClose: () => void;
  onConfirm: (data: any) => Promise<void>;
}

export default function CierreCajaModal({ session, isFollowedByZ = false, onClose, onConfirm }: CierreCajaModalProps) {
  const denominations = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];
  const { user: currentUser } = useAuthStore();
  const [activeSession, setActiveSession] = useState(session);
  const [step, setStep] = useState(1); // 1: Validar Gastos, 2: Arqueo Cash, 3: Arqueo Virtual, 4: Validación, 5: Confirmación, 6: Exito
  const [bills, setBills] = useState<Record<number, number>>(
    Object.fromEntries(denominations.map(d => [d, 0]))
  );
  const [posnetDeclarations, setPosnetDeclarations] = useState<Record<string, number>>({});
  const [cloverInputs, setCloverInputs] = useState<number[]>([0]);
  const [mpInputs, setMpInputs] = useState<number[]>([0, 0]);

  useEffect(() => {
    const mpTotal = mpInputs.reduce((a, b) => a + (Number(b) || 0), 0);
    const cloverTotal = cloverInputs.reduce((a, b) => a + (Number(b) || 0), 0);
    setPosnetDeclarations({
      CLOVER: cloverTotal,
      MERCADOPAGO: mpTotal
    });
  }, [cloverInputs, mpInputs]);

  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showGastosModal, setShowGastosModal] = useState(false);
  const [editingGasto, setEditingGasto] = useState<any | null>(null);

  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

  useEffect(() => {
    if (step === 6 && !isFollowedByZ) {
      const timer = setTimeout(() => {
        onClose();
        useAuthStore.getState().logout();
      }, 30000);
      return () => clearTimeout(timer);
    }
  }, [step, isFollowedByZ, onClose]);

  const reloadSession = async () => {
    try {
      const { data } = await api.get(`/cash/session/${activeSession.id}`);
      if (data) {
        setActiveSession(data);
      }
    } catch (err) {
      console.error("Error reloading session in CierreCajaModal", err);
    }
  };

  const handleDeleteGasto = async (id: string) => {
    if (!window.confirm('¿Seguro que querés eliminar este gasto?')) return;
    try {
      await api.delete(`/cash/movement/${id}`);
      toast.success('Gasto eliminado correctamente');
      reloadSession();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Error al eliminar el gasto');
    }
  };

  const posnets = (() => {
    const stored = localStorage.getItem('posnet_configs');
    if (stored) {
      try {
        return JSON.parse(stored) as { id: string; name: string }[];
      } catch {}
    }
    return [
      { id: 'CLOVER', name: 'Clover' },
      { id: 'MERCADOPAGO', name: 'MercadoPago' }
    ];
  })();

  // Calculate all session-related values with useMemo to prevent O(N) loops on every single state update (keypress)
  const sessionCalculations = useMemo(() => {
    if (!activeSession) {
      return {
        virtual1SalesBreakdown: { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 },
        virtual2SalesBreakdown: { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 },
        virtual1SalesTotal: 0,
        virtual2SalesTotal: 0,
        virtual1Base: 0,
        virtual1Surcharge: 0,
        virtual2Base: 0,
        virtual2Surcharge: 0,
        posnetSalesMap: {} as Record<string, number>,
        cashSales: 0,
        debtSales: 0,
        posnetSalesSum: 0,
        expenses: 0,
        withdrawals: 0,
        expectedCashProfits: 0,
        totalExpected: 0
      };
    }

    // A. virtual1SalesBreakdown
    const v1Breakdown = activeSession.sales?.reduce((acc: Record<string, number>, v: any) => {
      let saleVirtualTotal = 0;
      if (v.items) {
        for (const item of v.items) {
          if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
            saleVirtualTotal += item.total || (item.unitPrice * item.quantity) || 0;
          }
        }
      }
      if (saleVirtualTotal > 0) {
        const saleTotal = v.total || v.totalAmount || 0;
        for (const p of v.payments || []) {
          const proportion = saleTotal > 0 ? (p.amount / saleTotal) : 0;
          const virtualPaymentAmount = saleVirtualTotal * proportion;
          acc[p.method] = (acc[p.method] || 0) + virtualPaymentAmount;
        }
      }
      return acc;
    }, { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 }) || { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };

    // B. virtual2SalesBreakdown
    const v2Breakdown = activeSession.sales?.reduce((acc: Record<string, number>, v: any) => {
      let saleVirtualTotal = 0;
      if (v.items) {
        for (const item of v.items) {
          if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
            saleVirtualTotal += item.total || (item.unitPrice * item.quantity) || 0;
          }
        }
      }
      if (saleVirtualTotal > 0) {
        const saleTotal = v.total || v.totalAmount || 0;
        for (const p of v.payments || []) {
          const proportion = saleTotal > 0 ? (p.amount / saleTotal) : 0;
          const virtualPaymentAmount = saleVirtualTotal * proportion;
          acc[p.method] = (acc[p.method] || 0) + virtualPaymentAmount;
        }
      }
      return acc;
    }, { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 }) || { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };

    const v1Total = (Object.values(v1Breakdown) as number[]).reduce((sum, val) => sum + (val || 0), 0);
    const v2Total = (Object.values(v2Breakdown) as number[]).reduce((sum, val) => sum + (val || 0), 0);

    // C. Carga virtual base and surcharge
    let v1Base = 0;
    let v1Surcharge = 0;
    let v2Base = 0;
    let v2Surcharge = 0;

    activeSession.sales?.forEach((v: any) => {
      if (v.items) {
        for (const item of v.items) {
          if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
            const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
            if (match) {
              v1Base += parseFloat(match[1]) * item.quantity;
              v1Surcharge += parseFloat(match[2]) * item.quantity;
            } else {
              const pct = Number(localStorage.getItem('virtual1_surcharge') || '0');
              const total = item.total || (item.unitPrice * item.quantity) || 0;
              const base = total / (1 + pct / 100);
              v1Base += base;
              v1Surcharge += (total - base);
            }
          } else if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
            const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
            if (match) {
              v2Base += parseFloat(match[1]) * item.quantity;
              v2Surcharge += parseFloat(match[2]) * item.quantity;
            } else {
              const pct = Number(localStorage.getItem('virtual2_surcharge') || '0');
              const total = item.total || (item.unitPrice * item.quantity) || 0;
              const base = total / (1 + pct / 100);
              v2Base += base;
              v2Surcharge += (total - base);
            }
          }
        }
      }
    });

    // D. Posnet sales map
    const posnetSalesMap: Record<string, number> = {};
    posnets.forEach((p) => {
      const base = activeSession.sales?.reduce((s: number, v: any) => s + v.payments.filter((pay: any) => pay.method === p.id).reduce((a: number, pay: any) => a + pay.amount, 0), 0) || 0;
      posnetSalesMap[p.id] = base - (v1Breakdown[p.id] || 0) - (v2Breakdown[p.id] || 0);
    });

    const cashSalesBase = activeSession.sales?.reduce((s: number, v: any) => s + v.payments.filter((pay: any) => pay.method === 'CASH').reduce((a: number, pay: any) => a + pay.amount, 0), 0) || 0;
    const cashSales = cashSalesBase - (v1Breakdown['CASH'] || 0) - (v2Breakdown['CASH'] || 0);

    const debtSalesBase = activeSession.sales?.reduce((s: number, v: any) => s + v.payments.filter((pay: any) => pay.method === 'DEBT').reduce((a: number, pay: any) => a + pay.amount, 0), 0) || 0;
    const debtSales = debtSalesBase - (v1Breakdown['DEBT'] || 0) - (v2Breakdown['DEBT'] || 0);

    const pSalesSum = Object.values(posnetSalesMap).reduce((a, b) => a + b, 0);
    const exps = activeSession.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;
    const wds = activeSession.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0;

    const expectedCashProfits = cashSales - exps - wds;
    const totalExpected = expectedCashProfits + pSalesSum;

    return {
      virtual1SalesBreakdown: v1Breakdown,
      virtual2SalesBreakdown: v2Breakdown,
      virtual1SalesTotal: v1Total,
      virtual2SalesTotal: v2Total,
      virtual1Base: v1Base,
      virtual1Surcharge: v1Surcharge,
      virtual2Base: v2Base,
      virtual2Surcharge: v2Surcharge,
      posnetSalesMap,
      cashSales,
      debtSales,
      posnetSalesSum: pSalesSum,
      expenses: exps,
      withdrawals: wds,
      expectedCashProfits,
      totalExpected
    };
  }, [activeSession]);

  const {
    virtual1SalesBreakdown,
    virtual2SalesBreakdown,
    virtual1SalesTotal,
    virtual2SalesTotal,
    virtual1Base,
    virtual1Surcharge,
    virtual2Base,
    virtual2Surcharge,
    posnetSalesMap,
    cashSales,
    debtSales,
    posnetSalesSum,
    expenses,
    withdrawals,
    expectedCashProfits,
    totalExpected
  } = sessionCalculations;

  const getPosnetSales = (posnetId: string) => posnetSalesMap[posnetId] || 0;

  const cashToWithdraw = Object.entries(bills).reduce((acc, [den, qty]) => acc + (Number(den) * qty), 0);
  const posnetDeclaredSum = posnets.reduce((sum, p) => sum + (posnetDeclarations[p.id] || 0), 0);
  const totalDeclared = cashToWithdraw + posnetDeclaredSum;
  const differenceTotal = totalDeclared - totalExpected;

  const handlePrintZReport = () => {
    window.print();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F9' && step >= 4) {
        e.preventDefault();
        handlePrintZReport();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, cashToWithdraw, posnetDeclarations, notes, onClose]);

  const perfMode = typeof window !== 'undefined' && localStorage.getItem('performance_mode') === 'true';
  const MotionDiv = (perfMode ? 'div' : motion.div) as any;

  return (
    <MotionDiv {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })} className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <MotionDiv {...(perfMode ? {} : { initial: { scale: 0.98, opacity: 0 }, animate: { scale: 1, opacity: 1 } })} onClick={(e: any) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl w-full max-w-5xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[92vh]">
        <style>{`
          @media print {
            #root {
              display: none !important;
            }
            #printable-zreport, #printable-zreport * {
              visibility: visible !important;
            }
            #printable-zreport {
              display: block !important;
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              height: auto !important;
              background: white !important;
              z-index: 9999999 !important;
              font-family: 'Outfit', 'Inter', sans-serif !important;
              font-size: 12.5px !important;
              line-height: 1.3 !important;
              color: #000000 !important;
              padding: 5mm !important;
            }
            @page {
              size: A4;
              margin: 0;
            }
          }
        `}</style>
        
        {/* Header */}
        <div className="px-4 sm:px-8 py-3 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all shrink-0 ${step <= 3 ? 'bg-rose-600 dark:bg-rose-700 shadow-rose-100 dark:shadow-none' : step === 4 ? 'bg-emerald-500 shadow-emerald-100 dark:shadow-none' : step === 5 ? 'bg-rose-500 shadow-rose-100 dark:shadow-none' : 'bg-green-500 shadow-green-100 dark:shadow-none'} text-white shadow-md`}>
              {step <= 3 ? <Wallet className="w-5 h-5" /> : step === 4 ? <CheckCircle2 className="w-5 h-5" /> : step === 5 ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100 leading-tight">
                {step === 1 ? 'Control de Gastos' : step === 2 ? 'Arqueo de Efectivo' : step === 3 ? 'Arqueo Virtual y Posnets' : step === 4 ? 'Validación de Cierre' : 'Confirmación'}
              </h2>
              {/* Desktop breadcrumb */}
              <p className="hidden sm:flex text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 items-center gap-1.5">
                <span className={step === 1 ? 'text-rose-600 dark:text-rose-400 font-extrabold' : ''}>Gastos</span>
                <ChevronRight className="w-2.5 h-2.5" />
                <span className={step >= 2 ? 'text-rose-600 dark:text-rose-400 font-extrabold' : ''}>Efectivo</span>
                <ChevronRight className="w-2.5 h-2.5" />
                <span className={step >= 3 ? 'text-rose-600 dark:text-rose-400 font-extrabold' : ''}>Virtual</span>
                <ChevronRight className="w-2.5 h-2.5" />
                <span className={step >= 4 ? 'text-rose-600 dark:text-rose-400 font-extrabold' : ''}>Validación</span>
              </p>
              {/* Mobile step pill */}
              <p className="flex sm:hidden text-[10px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider mt-0.5">
                Paso {step} de 4 · {step === 1 ? 'Gastos' : step === 2 ? 'Efectivo' : step === 3 ? 'Virtual' : 'Validación'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-slate-900">
          {step === 1 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full p-4 sm:p-8 flex flex-col overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-7 sm:h-8 bg-rose-500 rounded-full shrink-0" />
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 leading-none">Gastos y Egresos Registrados</h3>
                    <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">Revisá o agregá gastos antes del arqueo</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setEditingGasto(null); setShowGastosModal(true); }}
                  className="w-full sm:w-auto px-4 py-2.5 bg-rose-600 text-white font-bold text-xs rounded-xl hover:bg-rose-700 active:scale-[0.97] transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Registrar Nuevo Gasto
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                {(!activeSession?.cashMovements || activeSession.cashMovements.length === 0) ? (
                  <div className="text-center py-12 sm:py-16 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-750 rounded-2xl p-4">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No hay gastos o egresos registrados en este turno.</p>
                    <p className="text-xs text-slate-500 mt-1">Si pagaste sueldos, proveedores o realizaste retiros, agrégalos ahora.</p>
                  </div>
                ) : (
                  <div className="space-y-2 sm:space-y-0 sm:border sm:border-slate-200 sm:dark:border-slate-700 sm:rounded-2xl sm:overflow-hidden sm:bg-white sm:dark:bg-slate-800">
                    {/* Desktop table */}
                    <table className="hidden sm:table w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-3 px-4">Descripción / Motivo</th>
                          <th className="py-3 px-4">Método</th>
                          <th className="py-3 px-4 text-right">Monto</th>
                          <th className="py-3 px-4 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {activeSession.cashMovements.map((mov: any) => {
                          const isTransfer = mov.description?.includes('METODO: TRANSFER');
                          const cleanDesc = mov.description?.split(' | METODO: ')[0] || 'Gasto operativo';
                          return (
                            <tr key={mov.id} className="text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="py-3.5 px-4 font-bold uppercase">{cleanDesc}</td>
                              <td className="py-3.5 px-4 font-semibold uppercase">{isTransfer ? '🏦 Transferencia' : '💵 Efectivo'}</td>
                              <td className="py-3.5 px-4 text-right font-black text-rose-600 dark:text-rose-400">-{fmt(mov.amount)}</td>
                              <td className="py-3.5 px-4 text-right">
                                <div className="flex justify-end gap-1.5">
                                  <button 
                                    onClick={() => { setEditingGasto(mov); setShowGastosModal(true); }}
                                    className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-all cursor-pointer"
                                    title="Editar gasto"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteGasto(mov.id)}
                                    className="p-1.5 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-all cursor-pointer"
                                    title="Eliminar gasto"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Mobile cards */}
                    <div className="flex sm:hidden flex-col gap-2">
                      {activeSession.cashMovements.map((mov: any) => {
                        const isTransfer = mov.description?.includes('METODO: TRANSFER');
                        const cleanDesc = mov.description?.split(' | METODO: ')[0] || 'Gasto operativo';
                        return (
                          <div key={mov.id} className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase truncate">{cleanDesc}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">{isTransfer ? '🏦 Transferencia' : '💵 Efectivo'}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs font-black text-rose-600 dark:text-rose-400">-{fmt(mov.amount)}</span>
                              <button onClick={() => { setEditingGasto(mov); setShowGastosModal(true); }} className="p-1.5 text-slate-400 hover:text-rose-600"><Edit2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteGasto(mov.id)} className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full p-4 sm:p-6 flex flex-col overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-7 sm:h-8 bg-rose-600 dark:bg-rose-500 rounded-full shrink-0" />
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 leading-none">Conteo de Billetes</h3>
                    <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">Detalla el efectivo total a retirar</p>
                  </div>
                </div>
                <div className="px-4 py-2 sm:px-6 sm:py-3 bg-rose-50/80 dark:bg-rose-900/30 border border-rose-100 dark:border-rose-800/50 rounded-2xl flex sm:block items-center justify-between">
                  <span className="text-[9px] font-bold text-rose-500 dark:text-rose-300 uppercase block sm:mb-0.5">Total Arqueado</span>
                  <span className="text-lg sm:text-2xl font-black text-rose-600 dark:text-rose-400 tracking-tight">{fmt(cashToWithdraw)}</span>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 pb-2">
                  {denominations.map((den, i) => (
                    <div 
                       key={den} 
                       onClick={() => document.getElementById(`bill-input-${i}`)?.focus()}
                       className="flex items-center justify-between py-2 px-3 sm:px-4 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-rose-300 dark:hover:border-rose-500/50 cursor-pointer transition-all group"
                    >
                      <span className="text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors tracking-tight min-w-[55px] sm:min-w-[65px]">${den.toLocaleString('es-AR')}</span>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <input 
                          id={`bill-input-${i}`}
                          type="number" 
                          value={bills[den] || ''} 
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const next = document.getElementById(`bill-input-${i + 1}`);
                              if (next) (next as HTMLInputElement).focus();
                            }
                          }}
                          onChange={(e) => setBills({ ...bills, [den]: Math.max(0, Number(e.target.value)) })}
                          className="w-14 sm:w-16 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/60 rounded-lg py-1.5 text-sm sm:text-base font-bold text-rose-700 dark:text-rose-300 outline-none text-center focus:ring-2 focus:ring-rose-500 transition-all shadow-inner"
                          placeholder="0"
                        />
                        <span className="text-xs sm:text-sm font-black text-rose-600 dark:text-rose-400 min-w-[70px] sm:min-w-[85px] text-right">{fmt(den * (bills[den] || 0))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full flex flex-col lg:grid lg:grid-cols-[1fr,360px] overflow-y-auto">
              <div className="p-4 sm:p-8 flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-7 sm:h-8 bg-rose-600 dark:bg-rose-500 rounded-full shrink-0" />
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 leading-none">Comprobantes y Virtual</h3>
                    <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">Ingresa los totales de cada posnet</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* MercadoPago Section */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold text-rose-600 dark:text-rose-400 uppercase tracking-wider">MercadoPago</span>
                      <button 
                        type="button" 
                        onClick={() => setMpInputs([...mpInputs, 0])}
                        className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Agregar Terminal
                      </button>
                    </div>
                    {mpInputs.map((val, idx) => (
                      <div key={`mp-${idx}`} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 gap-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 shrink-0">
                            <Smartphone className="w-4 h-4" />
                          </div>
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Terminal MP {idx + 1}</span>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                          <span className="text-sm font-bold text-slate-400">$</span>
                          <input 
                            type="number" 
                            value={val || ''} 
                            onChange={(e) => {
                              const copy = [...mpInputs];
                              copy[idx] = Number(e.target.value);
                              setMpInputs(copy);
                            }}
                            className="flex-1 sm:w-32 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-base font-bold text-slate-800 dark:text-slate-100 outline-none text-right focus:ring-2 focus:ring-rose-500 transition-all"
                            placeholder="0"
                          />
                          {mpInputs.length > 2 && (
                            <button 
                              type="button" 
                              onClick={() => setMpInputs(mpInputs.filter((_, i) => i !== idx))}
                              className="text-rose-500 hover:text-rose-700 transition-colors p-1"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Clover Section */}
                  <div className="space-y-2.5 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold text-rose-600 dark:text-rose-400 uppercase tracking-wider">Clover</span>
                      <button 
                        type="button" 
                        onClick={() => setCloverInputs([...cloverInputs, 0])}
                        className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Agregar Terminal
                      </button>
                    </div>
                    {cloverInputs.map((val, idx) => (
                      <div key={`clover-${idx}`} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 sm:p-4 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 gap-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 shrink-0">
                            <CreditCard className="w-4 h-4" />
                          </div>
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Terminal Clover {idx + 1}</span>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                          <span className="text-sm font-bold text-slate-400">$</span>
                          <input 
                            type="number" 
                            value={val || ''} 
                            onChange={(e) => {
                              const copy = [...cloverInputs];
                              copy[idx] = Number(e.target.value);
                              setCloverInputs(copy);
                            }}
                            className="flex-1 sm:w-32 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-base font-bold text-slate-800 dark:text-slate-100 outline-none text-right focus:ring-2 focus:ring-rose-500 transition-all"
                            placeholder="0"
                          />
                          {cloverInputs.length > 1 && (
                            <button 
                              type="button" 
                              onClick={() => setCloverInputs(cloverInputs.filter((_, i) => i !== idx))}
                              className="text-rose-500 hover:text-rose-700 transition-colors p-1"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-6 bg-slate-50 dark:bg-slate-850 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 flex flex-col gap-2.5">
                <h3 className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Notas y Observaciones</h3>
                <textarea 
                  value={notes} 
                  onChange={(e) => setNotes(e.target.value)} 
                  className="h-24 lg:flex-1 w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3.5 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 outline-none resize-none focus:ring-2 focus:ring-rose-500 transition-all"
                  placeholder="Ej: Diferencia por error en ticket, retiro de socio, etc..."
                />
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="p-3.5 sm:p-6 lg:p-8 h-full min-h-0 flex-1 flex flex-col gap-3.5 sm:gap-5 overflow-y-auto custom-scrollbar pb-8">
              {/* Diferencia de Caja Banner (Top - Always Visible) */}
              <div className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 shadow-xs ${differenceTotal === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50'}`}>
                <div className="flex items-center gap-3.5 text-center sm:text-left">
                  <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 ${differenceTotal === 0 ? 'bg-emerald-500' : 'bg-rose-500'} text-white shadow-md`}>
                    {differenceTotal === 0 ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className={`text-[10px] font-black uppercase tracking-widest ${differenceTotal === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>Diferencia de Caja</p>
                    <p className={`text-xl sm:text-2xl font-black ${differenceTotal === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {differenceTotal > 0 && '+'}{fmt(differenceTotal)}
                    </p>
                  </div>
                </div>
                {differenceTotal !== 0 ? (
                  <div className="text-center sm:text-right">
                    <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase">Caja fuera de balance</p>
                    <p className="text-[9px] font-medium text-rose-500 dark:text-rose-300">Revisa los registros antes de confirmar.</p>
                  </div>
                ) : (
                  <div className="text-center sm:text-right">
                    <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Caja Balanceada</p>
                    <p className="text-[9px] font-medium text-emerald-500 dark:text-emerald-300">Los valores coinciden exactamente.</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-6">
                {/* Sistema */}
                <div className="p-4 sm:p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col">
                  <div className="flex items-center gap-2.5 mb-3 sm:mb-5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                    <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">Resumen Sistema</span>
                  </div>
                  <div className="space-y-2.5 sm:space-y-3 flex-1">
                    <div className="flex justify-between items-center text-xs sm:text-sm">
                      <span className="font-semibold text-slate-600 dark:text-slate-400">Ventas Efectivo</span>
                      <span className="font-black text-slate-800 dark:text-slate-200">{fmt(cashSales)}</span>
                    </div>
                    {posnets.map((p) => (
                      <div key={p.id} className="flex justify-between items-center text-xs sm:text-sm">
                        <span className="font-semibold text-slate-600 dark:text-slate-400">Ventas {p.name}</span>
                        <span className="font-black text-slate-800 dark:text-slate-200">{fmt(getPosnetSales(p.id))}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2.5 border-t border-slate-200 dark:border-slate-700 text-xs sm:text-sm">
                      <span className="font-bold text-rose-600 dark:text-rose-400 uppercase tracking-tight">(-) Gastos Turno</span>
                      <span className="font-black text-rose-600 dark:text-rose-400">-{fmt(expenses)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-0.5 text-xs sm:text-sm">
                      <span className="font-bold text-rose-600 dark:text-rose-400 uppercase tracking-tight">(-) Retiros a Caja Fuerte</span>
                      <span className="font-black text-rose-600 dark:text-rose-400">-{fmt(withdrawals)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2.5 border-t border-dashed border-slate-300 dark:border-slate-700 text-xs sm:text-sm">
                      <span className="font-bold text-rose-600 dark:text-rose-400 uppercase tracking-tight">Virtual 1 (No afecta caja)</span>
                      <span className="font-black text-rose-600 dark:text-rose-400">
                        {fmt(virtual1SalesTotal)}
                        {virtual1SalesTotal > 0 && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium ml-1.5">
                            ({fmt(virtual1Base)} + {fmt(virtual1Surcharge)})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-0.5 text-xs sm:text-sm">
                      <span className="font-bold text-rose-600 dark:text-rose-400 uppercase tracking-tight">Virtual 2 (No afecta caja)</span>
                      <span className="font-black text-rose-600 dark:text-rose-400">
                        {fmt(virtual2SalesTotal)}
                        {virtual2SalesTotal > 0 && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium ml-1.5">
                            ({fmt(virtual2Base)} + {fmt(virtual2Surcharge)})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3.5 pt-3.5 border-t border-slate-200 dark:border-slate-700 text-center">
                    <p className="text-[10px] font-black text-rose-500 dark:text-rose-400 uppercase tracking-widest mb-0.5">Total Esperado</p>
                    <p className="text-xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight">{fmt(totalExpected)}</p>
                  </div>
                </div>

                {/* Declarado */}
                <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-slate-800 border border-rose-100 dark:border-slate-700 flex flex-col shadow-xs">
                  <div className="flex items-center gap-2.5 mb-3 sm:mb-5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">Resumen Declarado</span>
                  </div>
                  <div className="space-y-2.5 sm:space-y-3 flex-1 text-xs sm:text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-600 dark:text-slate-400">Efectivo Contado</span>
                      <span className="font-black text-slate-800 dark:text-slate-200">{fmt(cashToWithdraw)}</span>
                    </div>
                    {posnets.map((p) => (
                      <div key={p.id} className="flex justify-between items-center">
                        <span className="font-semibold text-slate-600 dark:text-slate-400">{p.name}</span>
                        <span className="font-black text-slate-800 dark:text-slate-200">{fmt(posnetDeclarations[p.id] || 0)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3.5 pt-3.5 border-t border-slate-200 dark:border-slate-700 text-center">
                    <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-0.5">Total Declarado</p>
                    <p className="text-xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight">{fmt(totalDeclared)}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="h-full flex flex-col items-center justify-center text-center p-6 sm:p-10">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-500 dark:text-rose-400 flex items-center justify-center mb-6 sm:mb-8 shadow-inner">
                <AlertCircle className="w-10 h-10 sm:w-12 sm:h-12" />
              </div>
              <h3 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 mb-3 tracking-tight">¿Confirmar Cierre de Turno?</h3>
              <p className="text-slate-600 dark:text-slate-400 text-xs font-bold uppercase tracking-widest max-w-sm leading-relaxed mb-6">
                La sesión se cerrará de forma permanente.<br/>Asegúrate de haber arqueado todo correctamente.
              </p>
            </motion.div>
          )}

          {step === 6 && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="h-full p-6 sm:p-8 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 mb-2">Turno Finalizado</h3>
              <p className="text-slate-500 dark:text-slate-400 mb-6 sm:mb-8 max-w-sm text-xs sm:text-sm">
                El arqueo se completó correctamente y el turno ha sido cerrado. Puedes imprimir el comprobante X si lo necesitas.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <button onClick={handlePrintZReport} className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer">
                  <Printer className="w-5 h-5" /> Imprimir Comprobante X (Opcional)
                </button>
                <button 
                  onClick={() => {
                    onClose();
                    if (!isFollowedByZ) {
                      useAuthStore.getState().logout();
                    }
                  }} 
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold transition-all cursor-pointer"
                >
                  Finalizar y Salir
                </button>
              </div>
            </motion.div>
          )}
        </div>

        {/* Printable Z-Report (A4) */}
        {createPortal(
          <div id="printable-zreport" className="hidden print:block">
            <style type="text/css">
              {`
                @media print {
                  html, body {
                    height: 100% !important;
                    overflow: hidden !important;
                  }
                  #root { display: none !important; }
                  #printable-zreport {
                    display: block !important;
                    position: static !important;
                    width: 100% !important;
                    height: auto !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    background: white !important;
                  }
                  @page { size: A4 portrait; margin: 4mm; }
                }
              `}
            </style>
            <div style={{ padding: '3mm 4mm', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', maxHeight: '280mm', overflow: 'hidden', boxSizing: 'border-box', color: '#000000', backgroundColor: '#ffffff', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #000000', paddingBottom: '2mm', marginBottom: '2.5mm' }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, color: '#000000', letterSpacing: '-0.03em' }}>
                    {(localStorage.getItem('gd_store_name') || 'Ventra POS').toUpperCase()}
                  </h1>
                  <p style={{ margin: '0.5mm 0 0 0', fontSize: '8.5px', fontWeight: 'bold', color: '#000000', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema de Control e Inventario de Caja</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <h2 style={{ margin: 0, fontSize: '12px', fontWeight: 'bold', color: '#000000' }}>REPORTE DE ARQUEO DE TURNO (X)</h2>
                  <p style={{ margin: '0.5mm 0 0 0', fontSize: '8.5px', fontWeight: 'bold', color: '#000000' }}>ID: #{activeSession?.id?.substring(0, 8).toUpperCase()}</p>
                </div>
              </div>

              {/* Session Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '3mm', marginBottom: '2.5mm', background: '#ffffff', padding: '2mm 3mm', borderRadius: '3mm', border: '2px solid #000000' }}>
                <div>
                  <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Cajero</span>
                  <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{activeSession?.user?.fullName || 'Administrador'}</span>
                </div>
                <div>
                  <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Terminal</span>
                  <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{activeSession?.terminalName || 'Terminal Principal'}</span>
                </div>
                <div>
                  <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Apertura</span>
                  <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{new Date(activeSession?.openedAt || activeSession?.createdAt || Date.now()).toLocaleString('es-AR')}</span>
                </div>
                <div>
                  <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Cierre</span>
                  <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{new Date().toLocaleString('es-AR')}</span>
                </div>
                <div style={{ background: '#ffffff', padding: '1mm 2mm', borderRadius: '1.5mm', border: '2px solid #000000', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', boxSizing: 'border-box' }}>
                  <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Venta Sistema</span>
                  <span style={{ fontSize: '10.5px', fontWeight: '900', color: '#000000' }}>
                    {fmt(cashSales + debtSales + posnets.reduce((sum, p) => sum + getPosnetSales(p.id), 0))}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '0.85fr 1.15fr', gap: '4mm', marginBottom: '2.5mm' }}>
                {/* A: Arqueo Físico de Billetes */}
                <div>
                  <h3 style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', marginBottom: '1.5mm' }}>Sección A: Arqueo de Efectivo</h3>
                  <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse', color: '#000000' }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #000000', color: '#000000', fontWeight: 'bold' }}>
                        <th style={{ textAlign: 'left', padding: '1.8px 3px' }}>Denominación</th>
                        <th style={{ textAlign: 'center', padding: '1.8px 3px' }}>Cantidad</th>
                        <th style={{ textAlign: 'right', padding: '1.8px 3px' }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody style={{ borderBottom: '1.5px solid #000000' }}>
                      {denominations.map((den) => {
                        const qty = bills[den] || 0;
                        return (
                          <tr key={den} style={{ borderBottom: '1px solid #000000' }}>
                            <td style={{ padding: '1.8px 3px', fontWeight: 'bold' }}>$ {den.toLocaleString()}</td>
                            <td style={{ padding: '1.8px 3px', textAlign: 'center', fontWeight: 'bold', color: '#000000' }}>{qty}</td>
                            <td style={{ padding: '1.8px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(den * qty)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1mm', marginTop: '2mm', fontSize: '8.5px', color: '#000000' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Ventas Efectivo:</span> <span style={{ fontWeight: 'bold' }}>{fmt(cashSales)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Egresos/Gastos:</span> <span style={{ fontWeight: 'bold' }}>-{fmt(expenses)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Retiros a Caja Fuerte:</span> <span style={{ fontWeight: 'bold' }}>-{fmt(withdrawals)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm', marginTop: '0.5mm' }}>
                      <span style={{ color: '#000000', fontWeight: 'bold' }}>Virtual 1 (Separado):</span> 
                      <span style={{ fontWeight: 'bold', color: '#000000' }}>
                        {fmt(virtual1SalesTotal)}
                        {virtual1SalesTotal > 0 && (
                          <span style={{ fontSize: '7.5px', color: '#000000', fontWeight: 'normal', marginLeft: '1mm' }}>
                            ({fmt(virtual1Base)} + {fmt(virtual1Surcharge)})
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#000000', fontWeight: 'bold' }}>Virtual 2 (Separado):</span> 
                      <span style={{ fontWeight: 'bold', color: '#000000' }}>
                        {fmt(virtual2SalesTotal)}
                        {virtual2SalesTotal > 0 && (
                          <span style={{ fontSize: '7.5px', color: '#000000', fontWeight: 'normal', marginLeft: '1mm' }}>
                            ({fmt(virtual2Base)} + {fmt(virtual2Surcharge)})
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Total Esperado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(expectedCashProfits)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Total Contado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(cashToWithdraw)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Diferencia:</span> <span style={{ fontWeight: 'bold' }}>{(cashToWithdraw - expectedCashProfits) > 0 ? '+' : ''}{fmt(cashToWithdraw - expectedCashProfits)}</span></div>
                  </div>
                </div>

                {/* C: Egresos de Dinero y Movimientos */}
                <div>
                  <h3 style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', marginBottom: '1.5mm' }}>Sección C: Egresos de Dinero y Movimientos</h3>
                  {(!activeSession?.cashMovements || activeSession.cashMovements.length === 0) ? (
                    <div style={{ padding: '2mm', background: '#ffffff', borderRadius: '1.5mm', border: '1.5px solid #000000', fontSize: '8.5px', color: '#000000', fontStyle: 'italic', textAlign: 'center' }}>
                      No se registraron egresos ni movimientos de dinero durante este turno.
                    </div>
                  ) : (
                    <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse', color: '#000000' }}>
                      <thead>
                        <tr style={{ borderBottom: '1.5px solid #000000', color: '#000000', fontWeight: 'bold' }}>
                          <th style={{ textAlign: 'left', padding: '2px 3px' }}>Tipo</th>
                          <th style={{ textAlign: 'left', padding: '2px 3px' }}>Descripción (Motivo)</th>
                          <th style={{ textAlign: 'right', padding: '2px 3px' }}>Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeSession.cashMovements.map((m: any) => {
                          let moveDesc = m.description || '';
                          let cleanMoveDesc = moveDesc.replace(/^\[.*?\]/, '').trim();
                          
                          const printWageMatch = cleanMoveDesc.match(/(?:liquidación|liquidacion) de sueldo para (.*?) por .*? trabajadas/i);
                          if (printWageMatch) {
                            const printCashier = printWageMatch[1].trim();
                            cleanMoveDesc = `SUELDO: ${printCashier.toUpperCase()} - ${fmt(m.amount)}`;
                          }

                          return (
                            <tr key={m.id} style={{ borderBottom: '1px solid #000000' }}>
                              <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>
                                {m.type === 'INCOME' ? 'INGRESO' : m.type === 'EXPENSE' ? 'GASTO / PAGO' : 'RETIRO'}
                              </td>
                              <td style={{ padding: '2px 3px', color: '#000000', fontWeight: 'bold' }}>{cleanMoveDesc}</td>
                              <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>
                                {m.type === 'INCOME' ? '+' : '-'}{fmt(m.amount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot style={{ borderTop: '1.5px solid #000000' }}>
                        <tr style={{ fontWeight: 'bold' }}>
                          <td colSpan={2} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL GASTOS:</td>
                          <td style={{ padding: '2px 3px', textAlign: 'right' }}>-{fmt(expenses)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>

              {/* B: Arqueo Virtual y Posnets */}
              <div style={{ marginBottom: '2.5mm' }}>
                <h3 style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', marginBottom: '1.5mm' }}>Sección B: Tarjetas y QR</h3>
                <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse', color: '#000000' }}>
                  <thead>
                    <tr style={{ borderBottom: '1.5px solid #000000', color: '#000000', fontWeight: 'bold' }}>
                      <th style={{ textAlign: 'left', padding: '2px 3px' }}>Medio de Pago</th>
                      <th style={{ textAlign: 'right', padding: '2px 3px' }}>Esperado</th>
                      <th style={{ textAlign: 'right', padding: '2px 3px' }}>Declarado</th>
                      <th style={{ textAlign: 'right', padding: '2px 3px' }}>Diferencia</th>
                    </tr>
                  </thead>
                  <tbody style={{ borderBottom: '1px solid #000000' }}>
                    {posnets.map((p) => {
                      const expected = getPosnetSales(p.id);
                      const declared = posnetDeclarations[p.id] || 0;
                      return (
                        <tr key={p.id} style={{ borderBottom: '1px solid #000000' }}>
                          <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>{p.name} (Posnet)</td>
                          <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(expected)}</td>
                          <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(declared)}</td>
                          <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold', color: '#000000' }}>{fmt(declared - expected)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot style={{ borderTop: '1.5px solid #000000' }}>
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL TARJETAS Y QR DECLARADO:</td>
                      <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(posnetDeclaredSum)}</td>
                    </tr>
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL TARJETAS Y QR ESPERADO:</td>
                      <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(posnetSalesSum)}</td>
                    </tr>
                    <tr style={{ fontWeight: 'bold' }}>
                      <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL DIFERENCIA:</td>
                      <td style={{ padding: '2px 3px', textAlign: 'right' }}>
                        {(posnetDeclaredSum - posnetSalesSum) > 0 ? '+' : ''}
                        {fmt(posnetDeclaredSum - posnetSalesSum)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* D: Conciliación General */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '4mm', marginTop: '2mm', borderTop: '2px solid #000000', paddingTop: '2mm' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase' }}>Observaciones del Cierre</h4>
                  <p style={{ margin: '1mm 0 0 0', fontSize: '8.5px', color: '#000000', fontStyle: 'italic', background: '#ffffff', padding: '1.5mm', borderRadius: '1.5mm', minHeight: '8mm', border: '1.5px solid #000000' }}>{notes || 'Sin observaciones registradas para este turno.'}</p>
                </div>
                <div style={{ background: '#ffffff', padding: '2mm 3mm', borderRadius: '3mm', border: '2px solid #000000', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1mm', fontSize: '9px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', color: '#000000' }}>TOTAL ESPERADO:</span>
                      <span style={{ fontSize: '7px', color: '#000000' }}>(Efectivo + Tarjetas/QR)</span>
                    </div>
                    <span style={{ fontWeight: 'bold', color: '#000000' }}>{fmt(totalExpected)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5mm', fontSize: '9px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', color: '#000000' }}>TOTAL DECLARADO:</span>
                      <span style={{ fontSize: '7px', color: '#000000' }}>(Billetes + Tarjetas/QR)</span>
                    </div>
                    <span style={{ fontWeight: 'bold', color: '#000000' }}>{fmt(totalDeclared)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #000000', paddingTop: '1.5mm', fontSize: '11.5px', fontWeight: 'bold' }}>
                    <span style={{ color: '#000000' }}>DESVIACIÓN NETO:</span>
                    <span style={{ color: '#000000' }}>{differenceTotal > 0 ? '+' : ''}{fmt(differenceTotal)}</span>
                </div>
              </div>
            </div>
          </div>
          </div>,
          document.body
        )}

        {step < 6 && (
          <div className="px-4 sm:px-8 py-3.5 sm:py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
            <button onClick={() => step > 1 ? setStep(step - 1) : onClose()} disabled={isSubmitting} className="py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-slate-800 transition-all cursor-pointer text-center disabled:opacity-50 border border-slate-200 dark:border-slate-800 sm:border-transparent">
              {step === 1 ? 'Cancelar' : 'Volver'}
            </button>
            
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {step >= 4 && step < 6 && (
                <button 
                  onClick={handlePrintZReport} 
                  disabled={isSubmitting}
                  className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm hover:bg-white dark:hover:bg-slate-800 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  <Printer className="w-4 h-4" /> Imprimir Reporte A4 <span className="hidden sm:inline text-[9px] opacity-75 ml-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400">[F9]</span>
                </button>
              )}
              <button 
                disabled={isSubmitting}
                onClick={async () => {
                  if (step < 5) setStep(step + 1);
                  else {
                    try {
                      setIsSubmitting(true);
                      await onConfirm({ cashToWithdraw, posnetDeclarations, notes, bills });
                      setStep(6);
                    } catch (e) {
                      // Error is handled by parent, so we just reset submitting
                    } finally {
                      setIsSubmitting(false);
                    }
                  }
                }}
                className={`py-3 px-6 rounded-xl font-black text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98] text-xs sm:text-sm uppercase tracking-wider cursor-pointer shadow-md min-w-0 sm:min-w-[200px] ${step === 5 ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200 dark:shadow-rose-950/50' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-200 dark:shadow-rose-950/50'} disabled:opacity-50`}
              >
                {isSubmitting ? 'Procesando...' : (
                  <>
                    {step === 1 ? 'Siguiente: Arqueo de Efectivo' : step === 2 ? 'Siguiente: Virtual y Posnets' : step === 3 ? 'Siguiente: Validar Cierre' : step === 4 ? 'Finalizar Turno' : 'Sí, Cerrar Caja Definitivamente'}
                    <ChevronRight className="w-4 h-4 stroke-[3]" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </MotionDiv>

      {/* GastosModal overlay */}
      <AnimatePresence>
        {showGastosModal && (
          <GastosModal 
            sessionId={activeSession.id} 
            editingGasto={editingGasto}
            onClose={() => {
              setShowGastosModal(false);
              setEditingGasto(null);
              reloadSession();
            }} 
          />
        )}
      </AnimatePresence>
    </MotionDiv>
  );
}

