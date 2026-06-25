import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, Lock, DollarSign, Wallet, Smartphone, Banknote, CreditCard, ChevronRight, AlertCircle, CheckCircle2, Printer } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

interface CierreCajaModalProps {
  session: any;
  onClose: () => void;
  onConfirm: (data: any) => Promise<void>;
}

export default function CierreCajaModal({ session, onClose, onConfirm }: CierreCajaModalProps) {
  const denominations = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];
  const { user: currentUser } = useAuthStore();
  const [step, setStep] = useState(1); // 1: Arqueo Cash, 2: Arqueo Virtual, 3: Validación, 4: Confirmación, 5: Exito
  const [bills, setBills] = useState<Record<number, number>>(
    Object.fromEntries(denominations.map(d => [d, 0]))
  );
  const [posnetDeclarations, setPosnetDeclarations] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);

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

  const getPosnetSales = (posnetId: string) => {
    return session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === posnetId).reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  };

  const cashSales = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const debtSales = session?.sales?.reduce((s: number, v: any) => s + v.payments.filter((p: any) => p.method === 'DEBT').reduce((a: number, p: any) => a + p.amount, 0), 0) || 0;
  const posnetSalesSum = posnets.reduce((sum, p) => sum + getPosnetSales(p.id), 0);
  const expenses = session?.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  const withdrawals = session?.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0;
  
  const expectedCashProfits = cashSales - expenses - withdrawals;
  const totalExpected = expectedCashProfits + posnetSalesSum;
  const cashToWithdraw = Object.entries(bills).reduce((acc, [den, qty]) => acc + (Number(den) * qty), 0);
  const posnetDeclaredSum = posnets.reduce((sum, p) => sum + (posnetDeclarations[p.id] || 0), 0);
  const totalDeclared = cashToWithdraw + posnetDeclaredSum;
  const differenceTotal = totalDeclared - totalExpected;

  const handlePrintZReport = () => {
    window.print();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F9' && step >= 3) {
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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-5xl shadow-xl border border-slate-400 dark:border-slate-700 overflow-hidden flex flex-col max-h-[96vh]">
        <style>{`
          @media print {
            body * {
              visibility: hidden !important;
            }
            #printable-zreport, #printable-zreport * {
              visibility: visible !important;
            }
            #printable-zreport {
              display: block !important;
              position: fixed !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              height: 100% !important;
              background: white !important;
              z-index: 9999999 !important;
              font-family: 'Outfit', 'Inter', sans-serif !important;
              font-size: 13px !important;
              line-height: 1.5 !important;
              color: #1e293b !important;
              padding: 15mm !important;
            }
            @page {
              size: A4;
              margin: 0;
            }
          }
        `}</style>
        
        {/* Header */}
        <div className="px-8 py-4 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${step <= 2 ? 'bg-indigo-600 dark:bg-indigo-700 shadow-indigo-100 dark:shadow-none' : step === 3 ? 'bg-emerald-500 shadow-emerald-100 dark:shadow-none' : step === 4 ? 'bg-rose-500 shadow-rose-100 dark:shadow-none' : 'bg-green-500 shadow-green-100 dark:shadow-none'} text-white shadow-lg`}>
              {step <= 2 ? <Wallet className="w-5 h-5" /> : step === 3 ? <CheckCircle2 className="w-5 h-5" /> : step === 4 ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-none">
                {step === 1 ? 'Arqueo de Efectivo' : step === 2 ? 'Arqueo Virtual y Posnets' : step === 3 ? 'Validación de Cierre' : 'Confirmación'}
              </h2>
              <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-1.5 flex items-center gap-2">
                <span className={step >= 1 ? 'text-indigo-500 font-bold' : ''}>Efectivo</span>
                <ChevronRight className="w-2.5 h-2.5" />
                <span className={step >= 2 ? 'text-indigo-500 dark:text-indigo-400 font-bold' : ''}>Virtual</span>
                <ChevronRight className="w-2.5 h-2.5" />
                <span className={step >= 3 ? 'text-indigo-500 dark:text-indigo-400 font-bold' : ''}>Validación</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-400 hover:text-rose-500 transition-all"><X className="w-5 h-5" /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-white dark:bg-slate-900">
          {step === 1 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full p-6 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-6 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-1.5 h-8 bg-indigo-600 dark:bg-indigo-500 rounded-full" />
                  <div>
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 leading-none">Conteo de Billetes</h3>
                    <p className="text-[9px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.2em] mt-1.5">Detalla el efectivo total a retirar</p>
                  </div>
                </div>
                <div className="px-6 py-3 bg-indigo-50/50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-2xl text-right">
                  <span className="text-[9px] font-bold text-indigo-400 dark:text-indigo-300 uppercase block mb-0.5">Total Arqueado</span>
                  <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 tracking-tighter">{fmt(cashToWithdraw)}</span>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-4 -mr-4">
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 pb-4">
                  {denominations.map((den, i) => (
                    <div 
                       key={den} 
                       onClick={() => document.getElementById(`bill-input-${i}`)?.focus()}
                       className="flex items-center justify-between py-2.5 px-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-500/50 cursor-pointer transition-all group"
                    >
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors tracking-tight">${den}</span>
                      <div className="flex items-center gap-3">
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
                          className="w-16 bg-indigo-50/50 dark:bg-indigo-900/30 border-none rounded-xl px-2 py-2 text-base font-bold text-indigo-700 dark:text-indigo-300 outline-none text-center focus:bg-indigo-600 focus:text-white dark:focus:bg-indigo-500 transition-all shadow-inner"
                          placeholder="0"
                        />
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 min-w-[70px] text-right">{fmt(den * (bills[den] || 0))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="h-full grid grid-cols-[1fr,400px]">
              <div className="p-10 flex flex-col gap-8">
                <div className="flex items-center gap-4">
                  <div className="w-1.5 h-10 bg-indigo-600 dark:bg-indigo-500 rounded-full" />
                  <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-none">Comprobantes y Virtual</h3>
                    <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.2em] mt-2">Ingresa los totales de cada posnet</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 gap-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {posnets.map((p, idx) => (
                    <div key={p.id} className="flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-400 dark:border-slate-600 hover:border-indigo-200 dark:hover:border-indigo-500/50 transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-sm border border-gray-100 dark:border-slate-700">
                          <CreditCard className="w-5 h-5" />
                        </div>
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">{p.name} (Posnet)</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-slate-300 dark:text-slate-500">$</span>
                        <input 
                          type="number" 
                          autoFocus={idx === 0}
                          value={posnetDeclarations[p.id] || ''} 
                          onChange={(e) => setPosnetDeclarations({ ...posnetDeclarations, [p.id]: Number(e.target.value) })}
                          className="w-28 bg-white dark:bg-slate-900 border border-slate-400 dark:border-slate-600 rounded-lg px-3 py-2.5 text-lg font-bold text-slate-800 dark:text-slate-100 outline-none text-right focus:border-indigo-300 dark:focus:border-indigo-500 transition-all"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-8 bg-slate-50 dark:bg-slate-800/50 border-l border-slate-400 dark:border-slate-800 flex flex-col gap-4">
                <h3 className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.2em]">Notas y Observaciones</h3>
                <textarea 
                  value={notes} 
                  onChange={(e) => setNotes(e.target.value)} 
                  className="flex-1 w-full bg-white dark:bg-slate-900 border border-slate-400 dark:border-slate-700 rounded-xl p-5 text-sm font-medium text-slate-600 dark:text-slate-300 outline-none resize-none focus:border-indigo-300 dark:focus:border-indigo-500 transition-all"
                  placeholder="Ej: Diferencia por error en ticket, retiro de socio, etc..."
                />
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="p-10 h-full flex flex-col gap-8">
              <div className="grid grid-cols-2 gap-10 flex-1">
                {/* Sistema */}
                <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-400 dark:border-slate-700 flex flex-col">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.2em]">Resumen Sistema</span>
                  </div>
                  <div className="space-y-5 flex-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Ventas Efectivo</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{fmt(cashSales)}</span>
                    </div>
                    {posnets.map((p) => (
                      <div key={p.id} className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Ventas {p.name}</span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{fmt(getPosnetSales(p.id))}</span>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-5 border-t border-gray-100 dark:border-slate-700">
                      <span className="text-xs font-bold text-rose-500 uppercase tracking-tighter">(-) Gastos Turno</span>
                      <span className="text-xs font-bold text-rose-500">-{fmt(expenses)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-xs font-bold text-rose-500 uppercase tracking-tighter">(-) Retiros a Caja Fuerte</span>
                      <span className="text-xs font-bold text-rose-500">-{fmt(withdrawals)}</span>
                    </div>
                  </div>
                  <div className="mt-auto pt-8 border-t border-gray-100 dark:border-slate-700">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1.5 text-center">Total Esperado</p>
                    <p className="text-4xl font-bold text-slate-800 dark:text-slate-100 tracking-tighter text-center">{fmt(totalExpected)}</p>
                  </div>
                </div>

                {/* Declarado */}
                <div className="p-8 rounded-xl bg-white dark:bg-slate-800 border border-indigo-100 dark:border-slate-700 flex flex-col">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-[0.2em]">Resumen Declarado</span>
                  </div>
                  <div className="space-y-5 flex-1 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-700 dark:text-slate-300">Efectivo Contado</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">{fmt(cashToWithdraw)}</span>
                    </div>
                    {posnets.map((p) => (
                      <div key={p.id} className="flex justify-between items-center">
                        <span className="font-bold text-slate-700 dark:text-slate-300">{p.name}</span>
                        <span className="font-bold text-slate-700 dark:text-slate-300">{fmt(posnetDeclarations[p.id] || 0)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-auto pt-8 border-t border-gray-100 dark:border-slate-700">
                    <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-1.5 text-center">Total Declarado</p>
                    <p className="text-4xl font-bold text-slate-800 dark:text-slate-100 tracking-tighter text-center">{fmt(totalDeclared)}</p>
                  </div>
                </div>
              </div>

              <div className={`p-5 rounded-xl border flex items-center justify-between ${differenceTotal === 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/50'}`}>
                <div className="flex items-center gap-5 ml-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${differenceTotal === 0 ? 'bg-emerald-500' : 'bg-rose-500'} text-white shadow-lg`}>
                    {differenceTotal === 0 ? <CheckCircle2 className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${differenceTotal === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>Diferencia de Caja</p>
                    <p className={`text-2xl font-bold ${differenceTotal === 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'}`}>
                      {differenceTotal > 0 && '+'}{fmt(differenceTotal)}
                    </p>
                  </div>
                </div>
                {differenceTotal !== 0 && (
                  <div className="mr-6 text-right">
                    <p className="text-[10px] font-bold text-rose-500 dark:text-rose-400 uppercase leading-none mb-1">Caja fuera de balance</p>
                    <p className="text-[9px] font-bold text-rose-400 dark:text-rose-300 uppercase tracking-tighter italic">Revisa los registros antes de confirmar.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}          {step === 4 && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="h-full flex flex-col items-center justify-center text-center p-10">
              <div className="w-24 h-24 rounded-full bg-rose-50 dark:bg-rose-900/30 text-rose-500 dark:text-rose-400 flex items-center justify-center mb-8 shadow-inner">
                <AlertCircle className="w-12 h-12" />
              </div>
              <h3 className="text-3xl font-bold text-slate-800 dark:text-slate-100 mb-3 tracking-tight">¿Confirmar Cierre de Turno?</h3>
              <p className="text-slate-600 dark:text-slate-400 text-xs font-bold uppercase tracking-widest max-w-sm leading-relaxed mb-6">
                La sesión se cerrará de forma permanente.<br/>Asegúrate de haber arqueado todo correctamente.
              </p>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="h-full p-8 flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Turno Finalizado</h3>
              <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-sm">
                El arqueo se completó correctamente y el turno ha sido cerrado. Puedes imprimir el comprobante X si lo necesitas.
              </p>
              <div className="flex gap-4">
                <button onClick={handlePrintZReport} className="px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold flex items-center gap-2 transition-all">
                  <Printer className="w-5 h-5" /> Imprimir Comprobante X (Opcional)
                </button>
                <button onClick={onClose} className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-all">
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
                    height: auto !important;
                    overflow: visible !important;
                  }
                  #root { display: none !important; }
                  #printable-zreport {
                    display: block !important;
                    position: static !important;
                    width: 100% !important;
                    height: auto !important;
                    margin: 0 !important;
                    padding: 10mm !important;
                    background: white !important;
                  }
                  @page { size: A4; margin: 0; }
                }
              `}
            </style>
            <div style={{ padding: '10mm', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', minHeight: '275mm', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #e2e8f0', paddingBottom: '5mm', marginBottom: '8mm' }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 900, color: '#e11d48', letterSpacing: '-0.03em' }}>
                    {(localStorage.getItem('gd_store_name') || 'GO! Punto de Venta').toUpperCase()}
                  </h1>
                  <p style={{ margin: '1mm 0 0 0', fontSize: '10px', fontWeight: 'bold', color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema de Control e Inventario de Caja</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#1e293b' }}>REPORTE DE ARQUEO DE TURNO (X)</h2>
                  <p style={{ margin: '1mm 0 0 0', fontSize: '10px', fontWeight: 'bold', color: '#e11d48' }}>ID: #{session?.id?.substring(0, 8).toUpperCase()}</p>
                </div>
              </div>

              {/* Session Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4mm', marginBottom: '4mm', background: '#f8fafc', padding: '4mm', borderRadius: '4mm', border: '1px solid #f1f5f9' }}>
                <div>
                  <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Cajero</span>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{session?.user?.fullName || 'Administrador'}</span>
                </div>
                <div>
                  <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Terminal</span>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{session?.terminalName || 'Terminal Principal'}</span>
                </div>
                <div>
                  <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Apertura</span>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#475569' }}>{new Date(session?.openedAt || session?.createdAt || Date.now()).toLocaleString('es-AR')}</span>
                </div>
                <div>
                  <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Cierre</span>
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#475569' }}>{new Date().toLocaleString('es-AR')}</span>
                </div>
                <div style={{ background: '#ecfdf5', padding: '2mm 3mm', borderRadius: '2mm', border: '1px solid #d1fae5', alignSelf: 'center' }}>
                  <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#047857', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Total Bruto</span>
                  <span style={{ fontSize: '12px', fontWeight: '900', color: '#047857' }}>
                    {fmt(cashSales + debtSales + posnets.reduce((sum, p) => sum + getPosnetSales(p.id), 0))}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '0.85fr 1.15fr', gap: '6mm', marginBottom: '4mm' }}>
                {/* A: Arqueo Físico de Billetes */}
                <div>
                  <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '3mm' }}>Sección A: Arqueo de Efectivo</h3>
                  <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                        <th style={{ textAlign: 'left', padding: '4px' }}>Denominación</th>
                        <th style={{ textAlign: 'center', padding: '4px' }}>Cantidad</th>
                        <th style={{ textAlign: 'right', padding: '4px' }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody style={{ borderBottom: '1px solid #e2e8f0' }}>
                      {denominations.map((den) => {
                        const qty = bills[den] || 0;
                        return (
                          <tr key={den} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '4px', fontWeight: 'bold' }}>$ {den.toLocaleString()}</td>
                            <td style={{ padding: '4px', textAlign: 'center', fontWeight: 'bold', color: qty > 0 ? '#1e293b' : '#cbd5e1' }}>{qty}</td>
                            <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(den * qty)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1mm', marginTop: '3mm', fontSize: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Ventas Efectivo:</span> <span style={{ fontWeight: 'bold' }}>{fmt(cashSales)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Egresos/Gastos:</span> <span style={{ fontWeight: 'bold', color: '#ef4444' }}>-{fmt(expenses)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Retiros a Caja Fuerte:</span> <span style={{ fontWeight: 'bold', color: '#ef4444' }}>-{fmt(withdrawals)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#1e293b', fontWeight: 'bold' }}>Total Esperado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(expectedCashProfits)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '1mm' }}><span style={{ color: '#e11d48', fontWeight: 'bold' }}>Total Contado:</span> <span style={{ fontWeight: 'bold', color: '#e11d48' }}>{fmt(cashToWithdraw)}</span></div>
                  </div>
                </div>

                {/* B: Arqueo Virtual y Posnets */}
                <div>
                  <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '3mm' }}>Sección B: Tarjetas y Cuentas</h3>
                  <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                        <th style={{ textAlign: 'left', padding: '4px' }}>Medio de Pago</th>
                        <th style={{ textAlign: 'right', padding: '4px' }}>Esperado</th>
                        <th style={{ textAlign: 'right', padding: '4px' }}>Declarado</th>
                        <th style={{ textAlign: 'right', padding: '4px' }}>Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posnets.map((p) => {
                        const expected = getPosnetSales(p.id);
                        const declared = posnetDeclarations[p.id] || 0;
                        return (
                          <tr key={p.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '4px', fontWeight: 'bold' }}>{p.name} (Posnet)</td>
                            <td style={{ padding: '4px', textAlign: 'right' }}>{fmt(expected)}</td>
                            <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(declared)}</td>
                            <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold', color: (declared - expected) >= 0 ? '#10b981' : '#ef4444' }}>{fmt(declared - expected)}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                        <td style={{ padding: '4px', fontWeight: 'bold' }}>
                          Cuenta Corriente
                          <div style={{ fontSize: '8px', color: '#94a3b8', fontStyle: 'italic', fontWeight: 'normal', marginTop: '0.5mm' }}>* Se registra aparte, no afecta el arqueo</div>
                        </td>
                        <td style={{ padding: '4px', textAlign: 'right' }}>{fmt(debtSales)}</td>
                        <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>-</td>
                        <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold', color: '#64748b' }}>N/A</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* C: Egresos de Dinero y Movimientos */}
              <div style={{ marginBottom: '6mm' }}>
                <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '2mm' }}>Sección C: Egresos de Dinero y Movimientos</h3>
                {(!session?.cashMovements || session.cashMovements.length === 0) ? (
                  <div style={{ padding: '4mm', background: '#f8fafc', borderRadius: '2mm', border: '1px solid #f1f5f9', fontSize: '10px', color: '#64748b', fontStyle: 'italic', textAlign: 'center' }}>
                    No se registraron egresos ni movimientos de dinero durante este turno.
                  </div>
                ) : (
                  <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                        <th style={{ textAlign: 'left', padding: '4px' }}>Tipo</th>
                        <th style={{ textAlign: 'left', padding: '4px' }}>Descripción (Motivo)</th>
                        <th style={{ textAlign: 'right', padding: '4px' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {session.cashMovements.map((m: any) => (
                        <tr key={m.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                          <td style={{ padding: '4px', fontWeight: 'bold', color: m.type === 'INCOME' ? '#10b981' : '#ef4444' }}>
                            {m.type === 'INCOME' ? 'INGRESO' : m.type === 'EXPENSE' ? 'GASTO / PAGO' : 'RETIRO'}
                          </td>
                          <td style={{ padding: '4px', color: '#475569' }}>{m.description || 'Sin descripción'}</td>
                          <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold', color: m.type === 'INCOME' ? '#10b981' : '#ef4444' }}>
                            {m.type === 'INCOME' ? '+' : '-'}{fmt(m.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* D: Conciliación General */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '8mm', marginTop: 'auto', borderTop: '2px solid #334155', paddingTop: '6mm' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '11px', fontWeight: 'bold', color: '#1e293b', textTransform: 'uppercase' }}>Observaciones del Cierre</h4>
                  <p style={{ margin: '2mm 0 0 0', fontSize: '10px', color: '#475569', fontStyle: 'italic', background: '#f8fafc', padding: '3mm', borderRadius: '2mm', minHeight: '15mm', border: '1px solid #f1f5f9' }}>{notes || 'Sin observaciones registradas para este turno.'}</p>
                </div>
                <div style={{ background: '#f8fafc', padding: '4mm', borderRadius: '4mm', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5mm', fontSize: '11px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', color: '#64748b' }}>TOTAL ESPERADO:</span>
                      <span style={{ fontSize: '8px', color: '#94a3b8' }}>(Efectivo + Posnets)</span>
                    </div>
                    <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{fmt(totalExpected)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3.5mm', fontSize: '11px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 'bold', color: '#64748b' }}>TOTAL DECLARADO:</span>
                      <span style={{ fontSize: '8px', color: '#94a3b8' }}>(Billetes + Posnets)</span>
                    </div>
                    <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{fmt(totalDeclared)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #e11d48', paddingTop: '3mm', fontSize: '14px', fontWeight: 'bold' }}>
                    <span style={{ color: '#e11d48' }}>DESVIACIÓN NETO:</span>
                    <span style={{ color: differenceTotal === 0 ? '#10b981' : '#ef4444' }}>{differenceTotal > 0 ? '+' : ''}{fmt(differenceTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {step < 5 && (
          <div className="px-8 py-5 bg-slate-50 dark:bg-slate-900 border-t border-slate-300 dark:border-slate-800 flex items-center justify-between shrink-0">
            <button onClick={() => step > 1 ? setStep(step - 1) : onClose()} disabled={isSubmitting} className="px-5 py-2.5 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50">
              {step === 1 ? 'Cancelar' : 'Volver'}
            </button>
            
            <div className="flex gap-3">
              {step >= 3 && step < 5 && (
                <button 
                  onClick={handlePrintZReport} 
                  disabled={isSubmitting}
                  className="px-5 py-3 rounded-lg border border-slate-400 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" /> Imprimir Reporte A4 <span className="text-[9px] opacity-75 ml-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-400 dark:border-slate-600 text-slate-700 dark:text-slate-400">[F9]</span>
                </button>
              )}
              
              <button 
                disabled={isSubmitting}
                onClick={async () => {
                  if (step < 4) setStep(step + 1);
                  else {
                    try {
                      setIsSubmitting(true);
                      await onConfirm({ cashToWithdraw, posnetDeclarations, notes, bills });
                      setStep(5);
                    } catch (e) {
                      // Error is handled by parent, so we just reset submitting
                    } finally {
                      setIsSubmitting(false);
                    }
                  }
                }}
                className={`px-8 py-3 rounded-lg font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-[0.97] text-sm cursor-pointer min-w-[200px] ${step === 4 ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:opacity-50`}
              >
                {isSubmitting ? 'Procesando...' : (
                  <>
                    {step === 1 ? 'Siguiente: Virtual y Posnets' : step === 2 ? 'Siguiente: Validar Cierre' : step === 3 ? 'Finalizar Turno' : 'Sí, Cerrar Caja Definitivamente'}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
