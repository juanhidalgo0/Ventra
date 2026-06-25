import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function CierreDiaModal({ zReport, isHistory = false, onClose }: { zReport: any, isHistory?: boolean, onClose: () => void }) {
  const [printReady, setPrintReady] = useState(false);
  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);
  const summary = JSON.parse(zReport.summary || '{}');

  useEffect(() => {
    const timer = setTimeout(() => setPrintReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <style type="text/css">
        {`
          @media print {
            html, body { height: auto !important; overflow: visible !important; }
            #root { display: none !important; }
            #printable-cierre-dia, #printable-cierre-dia * { visibility: visible !important; }
            #printable-cierre-dia {
              display: block !important;
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              min-height: 275mm !important;
              background: white !important;
              z-index: 9999999 !important;
            }
            @page { size: A4; margin: 0; }
          }
        `}
      </style>

      {/* Printable Area */}
      <div id="printable-cierre-dia" className="hidden print:block" style={{ fontFamily: 'sans-serif', padding: '10mm', minHeight: '275mm', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #e2e8f0', paddingBottom: '5mm', marginBottom: '8mm' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 900, color: '#e11d48', letterSpacing: '-0.03em' }}>
              {(localStorage.getItem('gd_store_name') || 'GO! Punto de Venta').toUpperCase()}
            </h1>
            <p style={{ margin: '1mm 0 0 0', fontSize: '10px', fontWeight: 'bold', color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema de Control e Inventario de Caja</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#1e293b' }}>REPORTE DE CIERRE DE DÍA (Z)</h2>
            <p style={{ margin: '1mm 0 0 0', fontSize: '10px', fontWeight: 'bold', color: '#e11d48' }}>ID Z: #{zReport.id?.substring(0, 8).toUpperCase()}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4mm', marginBottom: '8mm', background: '#f8fafc', padding: '4mm', borderRadius: '4mm', border: '1px solid #f1f5f9' }}>
          <div>
            <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Fecha de Emisión</span>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{new Date(zReport.generatedAt).toLocaleString('es-AR')}</span>
          </div>
          <div>
            <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Cantidad de Turnos Consolidados</span>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{summary.sessionCount ?? zReport.sessions?.length ?? 0}</span>
          </div>
          <div>
            <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '1mm' }}>Generado por</span>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#1e293b' }}>{zReport.generatedBy?.fullName || 'Administrador'}</span>
          </div>
        </div>

        {/* Totales consolidados */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8mm', marginBottom: '8mm' }}>
          <div>
             <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '2mm' }}>Resumen de Operaciones Consolidadas</h3>
             <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '4px', fontWeight: 'bold' }}>Ingresos Efectivo (Caja Fuerte / Agregados)</td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#10b981' }}>+{fmt(summary.cashIncome || 0)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '4px', fontWeight: 'bold' }}>Egresos y Pagos (Salidas de caja)</td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#ef4444' }}>-{fmt(summary.cashExpense || 0)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '4px', fontWeight: 'bold' }}>Retiros a Caja Fuerte</td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#ef4444' }}>-{fmt(summary.cashWithdrawal || 0)}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '4px', fontWeight: 'bold' }}>Ventas en Efectivo</td>
                  <td style={{ padding: '4px', textAlign: 'right', color: '#10b981' }}>+{fmt(summary.paymentBreakdown?.CASH || 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '2mm' }}>Declaración Consolidada (Esperado vs Físico)</h3>
            <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Medio de Pago</th>
                  <th style={{ textAlign: 'right', padding: '4px' }}>Esperado</th>
                  <th style={{ textAlign: 'right', padding: '4px' }}>Declarado</th>
                  <th style={{ textAlign: 'right', padding: '4px' }}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '4px', fontWeight: 'bold' }}>Total Efectivo Físico</td>
                  <td style={{ padding: '4px', textAlign: 'right' }}>{fmt((summary.openingAmount || 0) + (summary.paymentBreakdown?.CASH || 0) + (summary.cashIncome || 0) - (summary.cashExpense || 0) - (summary.cashWithdrawal || 0))}</td>
                  <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(zReport.totalDeclared || 0)}</td>
                  <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold', color: ((zReport.totalDeclared || 0) - ((summary.openingAmount || 0) + (summary.paymentBreakdown?.CASH || 0) + (summary.cashIncome || 0) - (summary.cashExpense || 0) - (summary.cashWithdrawal || 0))) >= 0 ? '#10b981' : '#ef4444' }}>
                    {((zReport.totalDeclared || 0) - ((summary.openingAmount || 0) + (summary.paymentBreakdown?.CASH || 0) + (summary.cashIncome || 0) - (summary.cashExpense || 0) - (summary.cashWithdrawal || 0))) > 0 ? '+' : ''}
                    {fmt((zReport.totalDeclared || 0) - ((summary.openingAmount || 0) + (summary.paymentBreakdown?.CASH || 0) + (summary.cashIncome || 0) - (summary.cashExpense || 0) - (summary.cashWithdrawal || 0)))}
                  </td>
                </tr>
                {Object.entries(summary.posnetDeclarations || {}).map(([key, val]: any) => {
                  const expected = summary.paymentBreakdown?.[key] || 0;
                  const declared = val || 0;
                  return (
                    <tr key={key} style={{ borderBottom: '1px solid #f8fafc' }}>
                      <td style={{ padding: '4px', fontWeight: 'bold' }}>{key} (Posnet)</td>
                      <td style={{ padding: '4px', textAlign: 'right' }}>{fmt(expected)}</td>
                      <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(declared)}</td>
                      <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold', color: (declared - expected) >= 0 ? '#10b981' : '#ef4444' }}>{fmt(declared - expected)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8mm', marginBottom: '8mm' }}>
          <div>
            <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '2mm' }}>Detalle de Turnos (Reportes X)</h3>
            <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Cajero / Responsable</th>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Terminal</th>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Apertura</th>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Cierre</th>
                  <th style={{ textAlign: 'right', padding: '4px' }}>Total Bruto</th>
                  <th style={{ textAlign: 'right', padding: '4px' }}>Total Declarado</th>
                  <th style={{ textAlign: 'right', padding: '4px' }}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {(summary.sessions || zReport.sessions || []).map((session: any, idx: number) => {
                  let totalSessionGross = 0;
                  let totalSessionDeclared = session.closingAmountCounted || 0;
                  if (session.closingSummary) {
                    try {
                      const sum = JSON.parse(session.closingSummary);
                      totalSessionGross = sum.totalRevenue || 0;
                      const countedCash = sum.countedCash ?? session.closingAmountCounted ?? 0;
                      const posnetDeclared = Object.values(sum.posnetDeclarations || {}).reduce((a: any, b: any) => a + Number(b), 0);
                      totalSessionDeclared = countedCash + posnetDeclared;
                    } catch (e) {
                      totalSessionGross = session.closingAmountExpected || 0;
                    }
                  } else {
                    totalSessionGross = session.closingAmountExpected || 0;
                  }
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                      <td style={{ padding: '4px', fontWeight: 'bold' }}>{session.user?.fullName || 'Desconocido'}</td>
                      <td style={{ padding: '4px' }}>{session.terminalName}</td>
                      <td style={{ padding: '4px' }}>{new Date(session.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ padding: '4px' }}>{new Date(session.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(totalSessionGross)}</td>
                      <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(totalSessionDeclared)}</td>
                      <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold', color: session.difference >= 0 ? '#10b981' : '#ef4444' }}>{session.difference > 0 ? '+' : ''}{fmt(session.difference)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8mm', marginBottom: '8mm' }}>
          <div>
            <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '2mm', marginBottom: '2mm' }}>Detalle de Gastos y Egresos de Caja</h3>
            <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 'bold' }}>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Hora</th>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Usuario</th>
                  <th style={{ textAlign: 'left', padding: '4px' }}>Motivo</th>
                  <th style={{ textAlign: 'right', padding: '4px' }}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {(summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').length > 0 ? 
                  (summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').map((movement: any, idx: number) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '4px' }}>{new Date(movement.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={{ padding: '4px', fontWeight: 'bold' }}>{movement.user?.fullName || 'Desconocido'}</td>
                    <td style={{ padding: '4px' }}>
                      {movement.description || (movement.type === 'WITHDRAWAL' ? 'Retiro a caja fuerte' : 'Gasto')}
                      {movement.type === 'WITHDRAWAL' && <span style={{ marginLeft: '4px', padding: '2px 4px', background: '#f1f5f9', borderRadius: '2px', fontSize: '8px' }}>RETIRO</span>}
                    </td>
                    <td style={{ padding: '4px', textAlign: 'right', color: '#ef4444', fontWeight: 'bold' }}>-{fmt(movement.amount)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} style={{ padding: '8px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>No hubo egresos registrados en este cierre</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: 'auto', borderTop: '2px solid #e2e8f0', paddingTop: '6mm', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: '900', color: '#1e293b' }}>VENTA TOTAL (BRUTO): {fmt(
                (summary.paymentBreakdown?.CASH || 0) + 
                Object.values(summary.paymentBreakdown || {}).filter((_, i, arr) => Object.keys(summary.paymentBreakdown || {})[i] !== 'CASH').reduce((a: any, b: any) => a + Number(b), 0)
              )}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <div style={{ fontSize: '14px', fontWeight: '900', color: '#1e293b' }}>DIFERENCIA TOTAL CONSOLIDADA:</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: zReport.differenceTotal >= 0 ? '#10b981' : '#ef4444' }}>
                 {zReport.differenceTotal > 0 ? '+' : ''}{fmt(zReport.differenceTotal)}
              </div>
            </div>
        </div>

        <div style={{ marginTop: '20mm', textAlign: 'center', color: '#64748b', fontSize: '9px', fontStyle: 'italic' }}>
          Este documento consolida todos los turnos cerrados desde el último Reporte Z.<br />
          Tanto los Reportes X originales como las ventas detalladas permanecen guardados en el sistema digital.
        </div>
      </div>

      {/* Screen Area */}
      {/* Screen Area */}
      {isHistory ? (
        <motion.div 
          initial={{ scale: 0.98, opacity: 0 }} 
          animate={{ scale: 1, opacity: 1 }} 
          exit={{ scale: 0.98, opacity: 0 }}
          className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-500 flex items-center justify-center">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Detalles de Cierre de Día (Z)</h3>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Reporte ID: #Z-{zReport.id?.substring(0, 8).toUpperCase()}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg text-slate-450 transition-all font-bold">
              Cerrar
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-slate-50/20 text-slate-800">
            {/* Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200/60 p-4 rounded-xl shadow-sm">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Fecha de Emisión</span>
                <span className="text-xs font-bold text-slate-850">{new Date(zReport.generatedAt).toLocaleString('es-AR')}</span>
              </div>
              <div className="bg-white border border-slate-200/60 p-4 rounded-xl shadow-sm">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Turnos Consolidados</span>
                <span className="text-xs font-extrabold text-slate-850 uppercase block">{summary.sessionCount ?? zReport.sessions?.length ?? 0}</span>
              </div>
              <div className="bg-white border border-slate-200/60 p-4 rounded-xl shadow-sm">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Generado por</span>
                <span className="text-xs font-semibold text-slate-700 block">{zReport.generatedBy?.fullName || 'Administrador'}</span>
              </div>
            </div>

            {/* Split Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Operations & Payments Summary */}
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                  Resumen de Operaciones
                </h4>
                <div className="space-y-3.5 text-xs text-slate-500 font-medium">
                  <div className="flex justify-between">
                    <span>Ingresos Efectivo (Caja Fuerte / Agregados)</span>
                    <span className="font-bold text-emerald-600">+{fmt(summary.cashIncome || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Egresos y Pagos (Salidas de caja)</span>
                    <span className="font-bold text-rose-500">-{fmt(summary.cashExpense || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Retiros a Caja Fuerte</span>
                    <span className="font-bold text-rose-500">-{fmt(summary.cashWithdrawal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ventas en Efectivo</span>
                    <span className="font-bold text-emerald-600">+{fmt(summary.paymentBreakdown?.CASH || 0)}</span>
                  </div>
                </div>
              </div>

              {/* Declarations (Esperado vs Fisico) */}
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-slate-100">
                  Declaración Consolidada
                </h4>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                      <th className="pb-2">Medio</th>
                      <th className="pb-2 text-right">Esperado</th>
                      <th className="pb-2 text-right">Declarado</th>
                      <th className="pb-2 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-50 font-medium">
                      <td className="py-2 font-bold text-slate-650">Total Efectivo Físico</td>
                      <td className="py-2 text-right text-slate-700">{fmt((summary.openingAmount || 0) + (summary.paymentBreakdown?.CASH || 0) + (summary.cashIncome || 0) - (summary.cashExpense || 0) - (summary.cashWithdrawal || 0))}</td>
                      <td className="py-2 text-right font-bold text-slate-800">{fmt(zReport.totalDeclared || 0)}</td>
                      <td className="py-2 text-right font-extrabold text-indigo-750">
                        {fmt((zReport.totalDeclared || 0) - ((summary.openingAmount || 0) + (summary.paymentBreakdown?.CASH || 0) + (summary.cashIncome || 0) - (summary.cashExpense || 0) - (summary.cashWithdrawal || 0)))}
                      </td>
                    </tr>
                    {Object.entries(summary.posnetDeclarations || {}).map(([key, val]: any) => {
                      const expected = summary.paymentBreakdown?.[key] || 0;
                      const declared = val || 0;
                      return (
                        <tr key={key} className="border-b border-slate-50 last:border-0 font-medium">
                          <td className="py-2 font-bold text-slate-650">{key} (Posnet)</td>
                          <td className="py-2 text-right text-slate-700">{fmt(expected)}</td>
                          <td className="py-2 text-right font-bold text-slate-800">{fmt(declared)}</td>
                          <td className={`py-2 text-right font-extrabold ${(declared - expected) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {fmt(declared - expected)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Turn Detail Table */}
            <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-2 border-b border-slate-100">
                Detalle de Turnos (Reportes X)
              </h4>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-2">Cajero / Terminal</th>
                    <th className="pb-2">Apertura</th>
                    <th className="pb-2">Cierre</th>
                    <th className="pb-2 text-right">Total Bruto</th>
                    <th className="pb-2 text-right">Total Declarado</th>
                    <th className="pb-2 text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.sessions || zReport.sessions || []).map((session: any, idx: number) => {
                    let totalSessionGross = 0;
                    let totalSessionDeclared = session.closingAmountCounted || 0;
                    if (session.closingSummary) {
                      try {
                        const sum = JSON.parse(session.closingSummary);
                        totalSessionGross = sum.totalRevenue || 0;
                        const countedCash = sum.countedCash ?? session.closingAmountCounted ?? 0;
                        const posnetDeclared = Object.values(sum.posnetDeclarations || {}).reduce((a: any, b: any) => a + Number(b), 0);
                        totalSessionDeclared = countedCash + posnetDeclared;
                      } catch (e) {
                        totalSessionGross = session.closingAmountExpected || 0;
                      }
                    } else {
                      totalSessionGross = session.closingAmountExpected || 0;
                    }
                    return (
                      <tr key={idx} className="border-b border-slate-50 last:border-0 font-medium">
                        <td className="py-2">
                          <p className="font-bold text-slate-700">{session.user?.fullName || 'Desconocido'}</p>
                          <p className="text-[9px] text-slate-400 uppercase">{session.terminalName}</p>
                        </td>
                        <td className="py-2 text-slate-650">{new Date(session.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-2 text-slate-650">{new Date(session.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-2 text-right font-bold text-slate-800">{fmt(totalSessionGross)}</td>
                        <td className="py-2 text-right font-bold text-slate-800">{fmt(totalSessionDeclared)}</td>
                        <td className={`py-2 text-right font-extrabold ${session.difference >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {session.difference > 0 ? '+' : ''}{fmt(session.difference)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Expenses Detail */}
            <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4 shadow-sm">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-2 border-b border-slate-100">
                Detalle de Gastos y Egresos de Caja
              </h4>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400 font-semibold">
                    <th className="pb-2">Hora / Usuario</th>
                    <th className="pb-2">Motivo</th>
                    <th className="pb-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').length > 0 ? (
                    (summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').map((movement: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-50 last:border-0 font-medium">
                        <td className="py-2">
                          <p className="font-bold text-slate-700">{movement.user?.fullName || 'Desconocido'}</p>
                          <p className="text-[9px] text-slate-400">{new Date(movement.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                        </td>
                        <td className="py-2 text-slate-650">
                          {movement.description || (movement.type === 'WITHDRAWAL' ? 'Retiro a caja fuerte' : 'Gasto')}
                          {movement.type === 'WITHDRAWAL' && <span className="ml-2 px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-bold uppercase">RETIRO</span>}
                        </td>
                        <td className="py-2 text-right font-bold text-rose-500">-{fmt(movement.amount)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-slate-400 italic">
                        No hubo egresos registrados en este cierre
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom summary and Action Buttons */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4 border-t border-slate-150">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Venta Total Consolidada (Bruto)</span>
                <span className="text-xl font-extrabold text-slate-800">
                  {fmt(
                    (summary.paymentBreakdown?.CASH || 0) + 
                    Object.values(summary.paymentBreakdown || {}).filter((_, i, arr) => Object.keys(summary.paymentBreakdown || {})[i] !== 'CASH').reduce((a: any, b: any) => a + Number(b), 0)
                  )}
                </span>
              </div>
              <div className="flex flex-col gap-1 sm:text-right">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Diferencia Total Consolidada</span>
                <span className={`text-xl font-extrabold ${zReport.differenceTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {zReport.differenceTotal > 0 ? '+' : ''}{fmt(zReport.differenceTotal)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end shrink-0">
            <button onClick={handlePrint} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer">
              <Printer className="w-4 h-4" /> Imprimir Reporte Z
            </button>
            <button onClick={onClose} className="px-4 py-2 border border-slate-350 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 transition-all cursor-pointer">
              Cerrar
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-lg bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden relative border border-slate-200">
          <div className="px-8 py-8 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-2">¡Día Cerrado con Éxito!</h3>
            <p className="text-slate-500 mb-8 max-w-sm">
              Se ha generado el Reporte Z maestro consolidando <b>{summary.sessionCount ?? zReport.sessions?.length ?? 0}</b> turnos. Puedes imprimir el comprobante consolidado a continuación.
            </p>
            <div className="flex flex-col gap-4 w-full">
              <button disabled={!printReady} onClick={handlePrint} className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
                <Printer className="w-5 h-5" /> Imprimir Reporte Z
              </button>
              <button onClick={onClose} className="w-full py-3.5 rounded-xl border border-slate-300 text-slate-700 font-bold transition-all hover:bg-slate-50 cursor-pointer">
                Cerrar y Volver
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>,
    document.body
  );
}
