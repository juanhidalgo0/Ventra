import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Smartphone, CreditCard, ChevronRight, AlertCircle, CheckCircle2, Printer, Plus, Trash2, Edit2, Check, Receipt, ArrowUpRight } from 'lucide-react';
import Kbd from '../ui/Kbd';
import { useAuthStore } from '../../stores/authStore';
import api from '../../services/api';
import toast from 'react-hot-toast';
import GastosModal from './GastosModal';
import { holdLogout } from '../../utils/logoutHold';
import { useOpeningFloat } from '../../utils/openingFloat';
import MpReconcilePanel, { mpReconcileNote, useMpConnected, useMpReconcile } from '../cash-register/MpReconcilePanel';
import { printReport } from '../../utils/ticketPrinter';
import { useConfirm } from '../common/ConfirmDialog';
import { lockShortcuts } from '../../utils/shortcutLock';
import { readArqueoDraft, saveArqueoDraft, clearArqueoDraft } from '../../utils/arqueoDraft';

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
  const openingFloat = useOpeningFloat();
  // Lo que se había cargado antes de cerrar la pantalla o recargar (se retoma desde ahí)
  const [draft] = useState(() => readArqueoDraft(session?.id));
  const [step, setStep] = useState(() => Math.min(Math.max(Number(draft?.step) || 1, 1), 4)); // 1: Validar Gastos, 2: Arqueo Cash, 3: Arqueo Virtual, 4: Validación, 5: Confirmación, 6: Exito
  const [bills, setBills] = useState<Record<number, number>>(() => ({
    ...Object.fromEntries(denominations.map(d => [d, 0])),
    ...(draft?.bills || {}),
  }));
  const [posnetDeclarations, setPosnetDeclarations] = useState<Record<string, number>>({});
  const [cloverInputs, setCloverInputs] = useState<number[]>(() => (draft?.cloverInputs?.length ? draft.cloverInputs : [0]));
  const [mpInputs, setMpInputs] = useState<number[]>(() => (draft?.mpInputs?.length ? draft.mpInputs : [0, 0]));

  useEffect(() => {
    const mpTotal = mpInputs.reduce((a, b) => a + (Number(b) || 0), 0);
    const cloverTotal = cloverInputs.reduce((a, b) => a + (Number(b) || 0), 0);
    setPosnetDeclarations({
      CLOVER: cloverTotal,
      MERCADOPAGO: mpTotal
    });
  }, [cloverInputs, mpInputs]);

  const [notes, setNotes] = useState(() => draft?.notes || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showGastosModal, setShowGastosModal] = useState(false);
  const [editingGasto, setEditingGasto] = useState<any | null>(null);

  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

  // Mientras dura el cierre no se cierra la sesión de esta terminal: se cierra recién
  // cuando el cajero sale del cartel (así puede imprimir el comprobante)
  useEffect(() => holdLogout(), []);
  // Con el arqueo abierto, los atajos de la caja (F8, F9, Esc…) no hacen nada atrás
  useEffect(() => lockShortcuts(), []);

  // Consumo de empleados del turno (sin cargo): solo informativo, no cambia ningún monto
  const [consumption, setConsumption] = useState<{ name: string; items: { name: string; quantity: number }[] }[]>([]);
  useEffect(() => {
    api.get('/sales', { params: { sessionId: activeSession.id, limit: 2500 } })
      .then(({ data }) => {
        const byUser = new Map<string, { name: string; items: Map<string, number> }>();
        for (const sale of (Array.isArray(data) ? data : []).filter((x: any) => x.status === 'INTERNAL')) {
          const name = sale.user?.fullName || sale.user?.username || 'Usuario';
          const e = byUser.get(sale.userId) || { name, items: new Map<string, number>() };
          for (const i of sale.items || []) e.items.set(i.productName, (e.items.get(i.productName) || 0) + i.quantity);
          byUser.set(sale.userId, e);
        }
        setConsumption([...byUser.values()].map((e) => ({ name: e.name, items: [...e.items].map(([name, quantity]) => ({ name, quantity })) })));
      })
      .catch(() => setConsumption([]));
  }, [activeSession.id]);
  const qtyText = (n: number) => (Math.round(Number(n) * 100) / 100).toLocaleString('es-AR');

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

  // Confirmaciones con el modal de la app (salir del arqueo, borrar un gasto)
  const [askConfirm, confirmDialog] = useConfirm();

  const handleDeleteGasto = async (id: string) => {
    const ok = await askConfirm({
      title: '¿Eliminar este gasto?',
      message: 'Sale del turno y se vuelve a calcular lo que tiene que haber en la caja.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/cash/movement/${id}`);
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

  // Con la cuenta de Mercado Pago conectada, lo cobrado por MP no se tipea: lo trae Ventra
  // de Mercado Pago, y en la validación se ve qué pago no tiene venta y al revés.
  const mpConnected = useMpConnected();
  const mpData = useMpReconcile(activeSession?.id, posnets, !!mpConnected);
  const [mpManual, setMpManual] = useState(() => !!draft?.mpManual);
  // Si Mercado Pago no responde (sin internet), se vuelve a cargar a mano como antes
  const mpAuto = !!mpConnected && !mpManual && !mpData.error;
  useEffect(() => {
    if (mpAuto && mpData.result) setMpInputs([mpData.result.realForSession]);
  }, [mpAuto, mpData.result]);

  // Se guarda lo cargado mientras se cuenta, y si este arqueo termina en un Cierre Z
  useEffect(() => {
    if (step >= 6) return;
    saveArqueoDraft(activeSession?.id, { withZ: isFollowedByZ, step: Math.min(step, 4), bills, cloverInputs, mpInputs, mpManual, notes });
  }, [activeSession?.id, isFollowedByZ, step, bills, cloverInputs, mpInputs, mpManual, notes]);

  // Solo se cierra con la cruz (o Cancelar), y preguntando: un clic afuera o Esc no borran el conteo
  const requestClose = async () => {
    if (step >= 6) { onClose(); return; }
    const ok = await askConfirm({
      title: isFollowedByZ ? '¿Salir del cierre del día?' : '¿Salir del arqueo?',
      message: isFollowedByZ
        ? 'Lo que contaste queda guardado en esta PC. El Cierre Z todavía no se hizo: retomalo desde el aviso de arqueo pendiente.'
        : 'Lo que contaste queda guardado en esta PC. Retomalo desde el aviso de arqueo pendiente.',
      confirmLabel: 'Salir',
      cancelLabel: 'Seguir contando',
    });
    if (ok) onClose();
  };

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
    printReport();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F9' && step >= 4) {
        e.preventDefault();
        handlePrintZReport();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, cashToWithdraw, posnetDeclarations, notes]);

  // ── Presentación ─────────────────────────────────────────────────
  const STEPS = ['Gastos', 'Efectivo', 'Tarjetas y QR', 'Revisión'];
  const movements: any[] = activeSession?.cashMovements || [];
  const splitMovement = (desc?: string) => ({
    text: (desc || '').split(' | METODO: ')[0] || 'Gasto operativo',
    transfer: !!desc?.includes('METODO: TRANSFER'),
  });
  const hhmm = (d: string) => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const shiftSalesCount = (activeSession?.sales || []).length;
  const shiftSalesTotal = (activeSession?.sales || []).reduce((sum: number, v: any) => sum + (Number(v.total ?? v.totalAmount) || 0), 0);
  const billCount = Object.values(bills).reduce((a, b) => a + (Number(b) || 0), 0);
  // Las cargas virtuales se reparten en proporción y pueden dejar centavos sueltos
  const isZero = (n: number) => Math.abs(n) < 0.5;
  const signed = (n: number) => (isZero(n) ? fmt(0) : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`);
  const diffClass = (n: number) => (isZero(n) ? 'text-emerald-600 dark:text-emerald-400' : n < 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400');

  // Sistema contra declarado por medio, con lo que se cargó de cada terminal
  const terminalsOf = (id: string): number[] => (id === 'CLOVER' ? cloverInputs : id === 'MERCADOPAGO' && !mpAuto ? mpInputs : []).map((v) => Number(v) || 0);
  const reviewRows = [
    { key: 'CASH', label: 'Efectivo', expected: expectedCashProfits, declared: cashToWithdraw, terminals: [] as number[] },
    ...posnets.map((p) => ({
      key: p.id,
      label: p.name === 'MercadoPago' ? 'Mercado Pago' : p.name,
      expected: getPosnetSales(p.id),
      declared: posnetDeclarations[p.id] || 0,
      terminals: terminalsOf(p.id),
    })),
  ];

  const balance = isZero(differenceTotal)
    ? {
        label: 'La caja cierra justo',
        hint: 'Lo declarado coincide con lo que registró el sistema.',
        box: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-900/60',
        icon: 'bg-emerald-600 text-white',
        title: 'text-emerald-700 dark:text-emerald-300',
      }
    : differenceTotal < 0
      ? {
          label: 'Falta plata',
          hint: 'Lo declarado es menos de lo que registró el sistema. Revisá el conteo y los gastos.',
          box: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-900/60',
          icon: 'bg-red-600 text-white',
          title: 'text-red-700 dark:text-red-300',
        }
      : {
          label: 'Sobra plata',
          hint: 'Lo declarado es más de lo registrado. Puede haber una venta sin cargar.',
          box: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-900/60',
          icon: 'bg-amber-500 text-white',
          title: 'text-amber-700 dark:text-amber-300',
        };

  /** Diferencia de cada medio (y lo de cada terminal), para la confirmación y el final */
  const diffSummary = (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 text-left text-[13.5px] overflow-hidden tabular-nums">
      {reviewRows.map((r) => (
        <div key={r.key} className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex justify-between gap-3">
            <span className="font-medium text-slate-800 dark:text-slate-200">{r.label}</span>
            <span className={`font-semibold ${diffClass(r.declared - r.expected)}`}>{signed(r.declared - r.expected)}</span>
          </div>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
            Sistema {fmt(r.expected)} · Declarado {fmt(r.declared)}
            {r.terminals.length > 1 && ` (${r.terminals.map((t, i) => `T${i + 1} ${fmt(t)}`).join(' · ')})`}
          </p>
        </div>
      ))}
      <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 flex justify-between font-semibold">
        <span className="text-slate-900 dark:text-slate-100">Diferencia total</span>
        <span className={diffClass(differenceTotal)}>{signed(differenceTotal)}</span>
      </div>
    </div>
  );

  const perfMode = typeof window !== 'undefined' && localStorage.getItem('performance_mode') === 'true';
  const MotionDiv = (perfMode ? 'div' : motion.div) as any;

  return (
    <MotionDiv {...(perfMode ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } })} className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-0 sm:p-3">
      <MotionDiv {...(perfMode ? {} : { initial: { scale: 0.98, opacity: 0 }, animate: { scale: 1, opacity: 1 } })} onClick={(e: any) => e.stopPropagation()} className="bg-white dark:bg-slate-900 sm:rounded-2xl w-full max-w-5xl shadow-2xl sm:border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col h-[100dvh] sm:h-[min(660px,calc(100dvh-24px))]">
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
              font-family: 'Outfit Variable', 'Inter Variable', sans-serif !important;
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
        
        {/* Encabezado con los pasos */}
        <div className="px-4 sm:px-7 pt-4 pb-3.5 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-tight">
                {step <= 4 ? 'Arqueo de caja' : step === 5 ? 'Cerrar el turno' : 'Turno cerrado'}
              </h2>
              <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {[isFollowedByZ ? 'Cierre del día (Z)' : 'Cambio de turno (X)', activeSession?.user?.fullName || activeSession?.user?.username, activeSession?.terminalName].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button onClick={requestClose} title="Cerrar" className="p-2 -mr-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          {step <= 5 && (
            <ol className="mt-3.5 grid grid-cols-4 gap-2">
              {STEPS.map((label, i) => {
                const n = i + 1;
                const done = step > n;
                const current = step === n || (step === 5 && n === 4);
                return (
                  <li key={label} className="min-w-0">
                    <div className={`h-1 rounded-full ${done || current ? 'bg-rose-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
                    <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
                      <span className={`w-[18px] h-[18px] rounded-full text-[10.5px] font-bold flex items-center justify-center shrink-0 ${done ? 'bg-rose-600 text-white' : current ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-600 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>
                        {done ? <Check className="w-3 h-3" strokeWidth={3} /> : n}
                      </span>
                      <span className={`text-[12.5px] truncate ${current ? '' : 'hidden sm:inline '}${current ? 'font-semibold text-slate-900 dark:text-slate-100' : done ? 'font-medium text-slate-700 dark:text-slate-300' : 'text-slate-500 dark:text-slate-400'}`}>{label}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Contenido */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar bg-white dark:bg-slate-900 tabular-nums">
          {step === 1 && (
            <div className="px-4 sm:px-7 py-4 sm:py-5">
              <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 sm:px-4 py-2.5 sm:py-3 min-w-0">
                  <p className="text-[12px] sm:text-[12.5px] text-slate-500 dark:text-slate-400 truncate">Ventas del turno</p>
                  <p className="text-[17px] sm:text-[22px] font-extrabold text-slate-900 dark:text-slate-100 tracking-tight truncate">{fmt(shiftSalesTotal)}</p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">{shiftSalesCount} {shiftSalesCount === 1 ? 'venta' : 'ventas'}</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 sm:px-4 py-2.5 sm:py-3 min-w-0">
                  <p className="text-[12px] sm:text-[12.5px] text-slate-500 dark:text-slate-400 truncate">Gastos</p>
                  <p className="text-[17px] sm:text-[22px] font-extrabold text-red-600 dark:text-red-400 tracking-tight truncate">{expenses ? `−${fmt(expenses)}` : fmt(0)}</p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">{movements.filter((m: any) => m.type !== 'WITHDRAWAL').length} cargados</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 sm:px-4 py-2.5 sm:py-3 min-w-0">
                  <p className="text-[12px] sm:text-[12.5px] text-slate-500 dark:text-slate-400 truncate">Retiros</p>
                  <p className="text-[17px] sm:text-[22px] font-extrabold text-red-600 dark:text-red-400 tracking-tight truncate">{withdrawals ? `−${fmt(withdrawals)}` : fmt(0)}</p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">{movements.filter((m: any) => m.type === 'WITHDRAWAL').length} cargados</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Gastos y retiros del turno</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Revisá que esté todo lo que salió de la caja antes de contar.</p>
                </div>
                <button
                  onClick={() => { setEditingGasto(null); setShowGastosModal(true); }}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-[13px] font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Agregar gasto
                </button>
              </div>

              {movements.length === 0 ? (
                <div className="text-center py-12 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                  <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center mx-auto mb-3">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No hubo gastos ni retiros</p>
                  <p className="text-[13px] text-slate-500 mt-1 max-w-xs mx-auto">Si pagaste a un proveedor, un sueldo o sacaste plata del cajón, agregalo ahora.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  {movements.map((mov: any) => {
                    const { text, transfer } = splitMovement(mov.description);
                    const isExpense = mov.type !== 'WITHDRAWAL';
                    return (
                      <div key={mov.id} className="flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 border-b last:border-b-0 border-slate-100 dark:border-slate-800 group">
                        <div className={`hidden sm:flex w-8 h-8 rounded-lg items-center justify-center shrink-0 ${isExpense ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'}`}>
                          {isExpense ? <Receipt className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100 truncate">{text}</p>
                          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {mov.createdAt ? `${hhmm(mov.createdAt)} h · ` : ''}{isExpense ? 'Gasto' : 'Retiro'} · {transfer ? 'Transferencia' : 'Efectivo'}
                          </p>
                        </div>
                        <span className="text-[14px] font-bold text-red-600 dark:text-red-400 shrink-0">−{fmt(mov.amount)}</span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => { setEditingGasto(mov); setShowGastosModal(true); }} title="Editar" className="p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteGasto(mov.id)} title="Eliminar" className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex justify-between items-center px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 text-[13px]">
                    <span className="text-slate-600 dark:text-slate-300">{movements.length} {movements.length === 1 ? 'movimiento' : 'movimientos'}</span>
                    <span className="font-bold text-red-600 dark:text-red-400">−{fmt(expenses + withdrawals)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col md:grid md:grid-cols-[1fr,260px] min-h-full">
              {/* Total contado: arriba y fijo en el celular, al costado en la PC */}
              <aside className="sticky top-0 z-10 md:static order-first md:order-last border-b md:border-b-0 md:border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 md:bg-slate-50/70 md:dark:bg-slate-900/50 px-4 sm:px-6 py-3 md:py-5 flex md:flex-col items-center md:items-stretch justify-between gap-3 md:gap-4">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">Efectivo contado</p>
                  <p className="text-[28px] md:text-[38px] font-extrabold text-slate-900 dark:text-slate-100 tracking-tight leading-none mt-1">{fmt(cashToWithdraw)}</p>
                  <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1.5">{billCount} {billCount === 1 ? 'billete' : 'billetes'}</p>
                </div>
                {openingFloat != null && openingFloat > 0 && (
                  <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 md:py-2.5 shrink-0 max-w-[180px] md:max-w-none">
                    <p className="text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300">Fondo: {fmt(openingFloat)}</p>
                    <p className="text-[12px] text-emerald-700/90 dark:text-emerald-300/80 mt-0.5 leading-snug">No lo cuentes: queda en el cajón.</p>
                  </div>
                )}
                <p className="hidden md:block text-[12px] text-slate-500 dark:text-slate-400 leading-snug mt-auto">Lo que el sistema espera se muestra recién en la revisión, así el conteo no se acomoda al número.</p>
              </aside>

              <div className="px-4 sm:px-6 py-4 sm:py-5">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Contá el efectivo que se retira</h3>
                  <p className="hidden sm:block text-[12.5px] text-slate-500 dark:text-slate-400 shrink-0"><Kbd>Enter</Kbd> pasa al siguiente</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-1">
                  {denominations.map((den, i) => (
                    <div 
                       key={den} 
                       onClick={() => document.getElementById(`bill-input-${i}`)?.focus()}
                       className="flex items-center justify-between py-1.5 px-4 bg-white dark:bg-slate-800/70 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-rose-300 focus-within:border-rose-500 focus-within:bg-rose-50/40 dark:hover:border-rose-500/50 cursor-pointer transition-all group tabular-nums"
                    >
                      <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 tracking-tight min-w-0 shrink-0">${den.toLocaleString('es-AR')}</span>
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <input 
                          id={`bill-input-${i}`}
                          type="number" 
                          inputMode="numeric"
                          value={bills[den] || ''} 
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const next = document.getElementById(`bill-input-${i + 1}`);
                              if (next) (next as HTMLInputElement).focus();
                            }
                          }}
                          onChange={(e) => setBills({ ...bills, [den]: Math.max(0, Number(e.target.value)) })}
                          className="w-[72px] sm:w-20 h-11 bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 rounded-xl text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 outline-none text-center focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20 transition-all"
                          placeholder="0"
                        />
                        <span className={`text-lg sm:text-xl font-black min-w-[92px] text-right ${(bills[den] || 0) > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-400 dark:text-slate-500'}`}>{fmt(den * (bills[den] || 0))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid md:grid-cols-[1fr,300px] min-h-full">
              <div className="px-4 sm:px-7 py-4 sm:py-5 space-y-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Tarjetas y QR</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">El total del cierre de lote de cada terminal.</p>
                </div>

                {/* Mercado Pago */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">
                      <Smartphone className="w-4 h-4 text-slate-500" /> Mercado Pago
                    </span>
                    {mpAuto ? (
                      <button type="button" onClick={() => setMpManual(true)} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">
                        Cargar a mano
                      </button>
                    ) : (
                      <button type="button" onClick={() => setMpInputs([...mpInputs, 0])} className="flex items-center gap-1 text-[12.5px] font-semibold text-rose-700 dark:text-rose-300 hover:underline cursor-pointer">
                        <Plus className="w-3.5 h-3.5" /> Agregar terminal
                      </button>
                    )}
                  </div>
                  {mpAuto ? (
                    <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-900/20 px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Traído de Mercado Pago</p>
                        <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                          {mpData.result ? `${mpData.result.real.count} pago(s) en el turno. No hace falta tipearlo.` : mpData.error || 'Consultando los pagos del turno…'}
                        </p>
                      </div>
                      <span className="text-[22px] font-extrabold text-slate-900 dark:text-slate-100 shrink-0">{mpData.result ? fmt(mpData.result.realForSession) : '—'}</span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                      {mpInputs.map((val, idx) => (
                        <div key={`mp-${idx}`} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="flex-1 text-[13.5px] text-slate-700 dark:text-slate-300">Terminal {idx + 1}</span>
                          <MoneyInput value={val} onChange={(v) => { const copy = [...mpInputs]; copy[idx] = v; setMpInputs(copy); }} />
                          {mpInputs.length > 2 ? (
                            <button type="button" onClick={() => setMpInputs(mpInputs.filter((_, i) => i !== idx))} title="Quitar" className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : <span className="w-7" />}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Clover */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">
                      <CreditCard className="w-4 h-4 text-slate-500" /> Clover
                    </span>
                    <button type="button" onClick={() => setCloverInputs([...cloverInputs, 0])} className="flex items-center gap-1 text-[12.5px] font-semibold text-rose-700 dark:text-rose-300 hover:underline cursor-pointer">
                      <Plus className="w-3.5 h-3.5" /> Agregar terminal
                    </button>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                    {cloverInputs.map((val, idx) => (
                      <div key={`clover-${idx}`} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="flex-1 text-[13.5px] text-slate-700 dark:text-slate-300">Terminal {idx + 1}</span>
                        <MoneyInput value={val} onChange={(v) => { const copy = [...cloverInputs]; copy[idx] = v; setCloverInputs(copy); }} />
                        {cloverInputs.length > 1 ? (
                          <button type="button" onClick={() => setCloverInputs(cloverInputs.filter((_, i) => i !== idx))} title="Quitar" className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : <span className="w-7" />}
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <aside className="border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-5 py-5 flex flex-col gap-2">
                <label htmlFor="arqueo-notas" className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-200">Notas</label>
                <p className="text-[12.5px] text-slate-500 dark:text-slate-400 -mt-1">Opcional. Salen en el comprobante y las ve el dueño.</p>
                <textarea
                  id="arqueo-notas"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[120px] flex-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-[14px] text-slate-800 dark:text-slate-200 outline-none resize-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/25"
                  placeholder="Ej: un ticket se cobró dos veces, faltó cambio…"
                />
              </aside>
            </div>
          )}

          {step === 4 && (
            <div className="px-4 sm:px-7 py-4 sm:py-5 space-y-4">
              {/* Resultado */}
              <div className={`rounded-xl border px-4 py-3.5 flex items-center gap-3.5 ${balance.box}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${balance.icon}`}>
                  {differenceTotal === 0 ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-[15px] font-semibold ${balance.title}`}>{balance.label}</p>
                  <p className="hidden sm:block text-[13px] text-slate-600 dark:text-slate-300 mt-0.5">{balance.hint}</p>
                </div>
                <p className={`text-[22px] sm:text-[26px] font-extrabold tracking-tight shrink-0 ${balance.title}`}>{signed(differenceTotal)}</p>
              </div>

              {mpConnected && (
                <MpReconcilePanel data={mpData} posnets={posnets} onFixed={reloadSession} />
              )}

              {/* Sistema contra declarado, por medio de pago */}
              <div className="sm:hidden">{diffSummary}</div>
              <div className="hidden sm:block rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 text-left text-[12px] font-medium text-slate-500 dark:text-slate-400">
                      <th className="py-2 px-4 font-medium">Medio</th>
                      <th className="py-2 px-4 font-medium text-right">Según el sistema</th>
                      <th className="py-2 px-4 font-medium text-right">Declarado</th>
                      <th className="py-2 px-4 font-medium text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {reviewRows.map((r) => (
                      <tr key={r.key} className="align-top">
                        <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200 font-medium">
                          {r.label}
                          {r.terminals.length > 1 && (
                            <div className="mt-1 space-y-0.5">
                              {r.terminals.map((t, i) => (
                                <p key={i} className="text-[12px] font-normal text-slate-500 dark:text-slate-400">Terminal {i + 1}</p>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-700 dark:text-slate-300">{fmt(r.expected)}</td>
                        <td className="py-2.5 px-4 text-right text-slate-900 dark:text-slate-100 font-semibold">
                          {fmt(r.declared)}
                          {r.terminals.length > 1 && (
                            <div className="mt-1 space-y-0.5">
                              {r.terminals.map((t, i) => (
                                <p key={i} className="text-[12px] font-normal text-slate-500 dark:text-slate-400">{fmt(t)}</p>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-semibold ${diffClass(r.declared - r.expected)}`}>{signed(r.declared - r.expected)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-700">
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">Total</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">{fmt(totalExpected)}</td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-slate-100">{fmt(totalDeclared)}</td>
                      <td className={`py-3 px-4 text-right font-bold ${diffClass(differenceTotal)}`}>{signed(differenceTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* De dónde sale el efectivo esperado */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-[13.5px] space-y-1.5">
                  <p className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 mb-1">Efectivo esperado</p>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Ventas en efectivo</span><span className="text-slate-800 dark:text-slate-100">{fmt(cashSales)}</span></div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Gastos</span><span className="text-red-600 dark:text-red-400">{expenses ? `−${fmt(expenses)}` : fmt(0)}</span></div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Retiros</span><span className="text-red-600 dark:text-red-400">{withdrawals ? `−${fmt(withdrawals)}` : fmt(0)}</span></div>
                  <div className="flex justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800 font-semibold text-slate-900 dark:text-slate-100"><span>Esperado</span><span>{fmt(expectedCashProfits)}</span></div>
                  {openingFloat != null && openingFloat > 0 && (
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 pt-1">Aparte queda el fondo inicial de {fmt(openingFloat)} en el cajón.</p>
                  )}
                </div>

                {/* Lo que no cambia la caja */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-[13.5px] space-y-1.5">
                  <p className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200 mb-1">No cambia la caja</p>
                  {debtSales > 0 && (
                    <div className="flex justify-between text-slate-600 dark:text-slate-300"><span>Ventas a cuenta corriente</span><span className="text-slate-800 dark:text-slate-100">{fmt(debtSales)}</span></div>
                  )}
                  {virtual1SalesTotal > 0 && (
                    <div className="flex justify-between gap-3 text-slate-600 dark:text-slate-300"><span>Carga virtual 1</span><span className="text-slate-800 dark:text-slate-100 text-right">{fmt(virtual1SalesTotal)} <span className="text-[12px] text-slate-500">({fmt(virtual1Base)} + {fmt(virtual1Surcharge)})</span></span></div>
                  )}
                  {virtual2SalesTotal > 0 && (
                    <div className="flex justify-between gap-3 text-slate-600 dark:text-slate-300"><span>Carga virtual 2</span><span className="text-slate-800 dark:text-slate-100 text-right">{fmt(virtual2SalesTotal)} <span className="text-[12px] text-slate-500">({fmt(virtual2Base)} + {fmt(virtual2Surcharge)})</span></span></div>
                  )}
                  {consumption.map((e) => (
                    <p key={e.name} className="text-slate-600 dark:text-slate-300 leading-snug">
                      <span className="font-medium text-slate-800 dark:text-slate-100">Consumo de {e.name}:</span> {e.items.map((i) => `${qtyText(i.quantity)} ${i.name}`).join(', ')}
                    </p>
                  ))}
                  {debtSales <= 0 && virtual1SalesTotal <= 0 && virtual2SalesTotal <= 0 && consumption.length === 0 && (
                    <p className="text-slate-500 dark:text-slate-400">Nada en este turno.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
              <div className="w-14 h-14 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 flex items-center justify-center mb-5">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">¿Cerrar el turno?</h3>
              <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1.5 max-w-sm">Se guarda el arqueo y el turno queda cerrado. Después no se puede modificar.</p>
              <div className="mt-6 w-full max-w-md">
                {diffSummary}
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
              <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-5">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="text-[22px] font-bold text-slate-900 dark:text-slate-100 tracking-tight">Turno cerrado</h3>
              <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1.5 max-w-sm">El arqueo quedó guardado. Si lo necesitás, imprimí el comprobante del cierre X.</p>
              <div className="mt-6 w-full max-w-md">
                {diffSummary}
              </div>
              <div className="mt-6 flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
                <button onClick={handlePrintZReport} className="px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-[14px] font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer">
                  <Printer className="w-4 h-4" /> Imprimir comprobante X
                </button>
                <button
                  onClick={() => {
                    onClose();
                    if (!isFollowedByZ) {
                      useAuthStore.getState().logout();
                    }
                  }}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-semibold transition-colors cursor-pointer"
                >
                  Finalizar y salir
                </button>
              </div>
            </div>
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
                            <td style={{ padding: '1.8px 3px', fontWeight: 'bold' }}>$ {den.toLocaleString('es-AR')}</td>
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

              {/* C: Consumo de empleados (sin cargo, solo informativo) */}
              {consumption.length > 0 && (
                <div style={{ marginBottom: '2.5mm' }}>
                  <h3 style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', marginBottom: '1.5mm' }}>Consumo de empleados (sin cargo, informativo)</h3>
                  <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse', color: '#000000' }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #000000', fontWeight: 'bold' }}>
                        <th style={{ textAlign: 'left', padding: '2px 3px' }}>Empleado</th>
                        <th style={{ textAlign: 'left', padding: '2px 3px' }}>Producto</th>
                        <th style={{ textAlign: 'right', padding: '2px 3px' }}>Cant.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consumption.flatMap((e) => e.items.map((it, idx) => (
                        <tr key={e.name + it.name} style={{ borderBottom: '1px solid #000000' }}>
                          <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>{idx === 0 ? e.name.toUpperCase() : ''}</td>
                          <td style={{ padding: '2px 3px' }}>{it.name}</td>
                          <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{qtyText(it.quantity)}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}

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
          <div className="px-4 sm:px-7 py-3 sm:py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0 bg-white dark:bg-slate-900">
            <button
              onClick={() => step > 1 ? setStep(step - 1) : requestClose()}
              disabled={isSubmitting}
              className="px-4 py-2.5 rounded-xl text-[14px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              {step === 1 ? 'Cancelar' : 'Volver'}
            </button>

            <div className="flex gap-2.5">
              {step >= 4 && (
                <button
                  onClick={handlePrintZReport}
                  disabled={isSubmitting}
                  title="Imprimir arqueo (F9)"
                  className="shrink-0 px-3.5 sm:px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 text-[14px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Imprimir arqueo</span> <Kbd className="hidden sm:inline-flex">F9</Kbd>
                </button>
              )}
              <button
                disabled={isSubmitting}
                onClick={async () => {
                  if (step < 5) setStep(step + 1);
                  else {
                    try {
                      setIsSubmitting(true);
                      await onConfirm({
                        cashToWithdraw,
                        posnetDeclarations,
                        notes: mpConnected && mpData.result ? [notes.trim(), mpReconcileNote(mpData.result)].filter(Boolean).join('\n') : notes,
                        bills,
                      });
                      clearArqueoDraft(activeSession?.id);
                      setStep(6);
                    } catch (e) {
                      // Error is handled by parent, so we just reset submitting
                    } finally {
                      setIsSubmitting(false);
                    }
                  }
                }}
                className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-colors active:scale-[0.98] cursor-pointer disabled:opacity-50 sm:min-w-[200px] shadow-sm"
              >
                {isSubmitting ? 'Cerrando el turno…' : (
                  <>
                    {step === 1 ? 'Contar el efectivo' : step === 2 ? 'Seguir con tarjetas y QR' : step === 3 ? 'Revisar el arqueo' : step === 4 ? 'Cerrar el turno' : 'Sí, cerrar el turno'}
                    <ChevronRight className="w-4 h-4" />
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
      {confirmDialog}
    </MotionDiv>
  );
}


/** Monto en pesos de una terminal (cierre de lote) */
function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/25 transition-shadow">
      <span className="pl-3 text-[14px] text-slate-400">$</span>
      <input
        type="number"
        min={0}
        value={value || ''}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 h-10 bg-transparent px-2 text-right text-[16px] font-bold text-slate-900 dark:text-slate-100 outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        placeholder="0"
      />
    </div>
  );
}
