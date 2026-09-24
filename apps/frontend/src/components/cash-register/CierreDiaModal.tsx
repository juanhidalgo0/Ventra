import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import { cashClosingResult } from '../../utils/cashDifference';

/**
 * headless: solo arma la hoja para imprimir (oculta), sin la ventana de pantalla. La usa el
 * celular para generar el PDF del Z con la misma hoja que imprime la PC.
 */
export default function CierreDiaModal({ zReport, isHistory = false, headless = false, onClose }: { zReport: any, isHistory?: boolean, headless?: boolean, onClose: () => void }) {
  const [printReady, setPrintReady] = useState(false);
  const [printMode, setPrintMode] = useState<'z-only' | 'z-and-x'>('z-only');
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);
  const summary = JSON.parse(zReport.summary || '{}');
  const pct1 = Number(localStorage.getItem('virtual1_surcharge') || '0');
  const pct2 = Number(localStorage.getItem('virtual2_surcharge') || '0');

  const isSessionWithActivity = (s: any) => {
    const counted = s.closingAmountCounted || 0;
    const expected = s.closingAmountExpected || 0;
    const diff = s.difference || 0;
    const opening = s.openingAmount || 0;
    let revenue = 0;
    let movementsCount = 0;
    if (s.closingSummary) {
      try {
        const sum = JSON.parse(s.closingSummary);
        revenue = sum.totalRevenue || 0;
        movementsCount = (sum.expenses?.length || 0) + (sum.withdrawals?.length || 0);
      } catch {}
    }
    const salesCount = s.sales?.length || 0;
    const cashMovCount = s.cashMovements?.length || movementsCount;
    return counted !== 0 || expected !== 0 || diff !== 0 || opening !== 0 || revenue !== 0 || salesCount > 0 || cashMovCount > 0;
  };

  const rawSessions = (() => {
    const dbSessions = zReport.sessions || [];
    const jsonSessions = summary.sessions || [];
    const map = new Map<string, any>();
    for (const s of jsonSessions) {
      if (s && s.id) map.set(s.id, { ...s });
    }
    for (const s of dbSessions) {
      if (s && s.id) {
        const prev = map.get(s.id) || {};
        map.set(s.id, { ...prev, ...s });
      }
    }
    if (map.size === 0) return dbSessions.length > 0 ? dbSessions : jsonSessions;
    return Array.from(map.values());
  })();
  const sessionsToRender = rawSessions.filter(isSessionWithActivity);
  let totalVirtual1Sales = 0;
  let totalVirtual2Sales = 0;
  let totalVirtual1Base = 0;
  let totalVirtual1Surcharge = 0;
  let totalVirtual2Base = 0;
  let totalVirtual2Surcharge = 0;
  let ventaTotalBruto = 0;

  let computedCashCounted = 0;
  let computedCashExpected = 0;

  sessionsToRender.forEach((s: any) => {
    let sessionGross = 0;
    let sCounted = s.closingAmountCounted ?? 0;
    let sExpected = s.closingAmountExpected ?? 0;

    if (s.closingSummary) {
      try {
        const parsedSum = JSON.parse(s.closingSummary);
        sessionGross = parsedSum.totalRevenue || 0;
        sCounted = parsedSum.countedCash ?? sCounted;
        sExpected = parsedSum.expectedCash ?? sExpected;
        
        let v1S = parsedSum.virtual1Sales || 0;
        let v1B = parsedSum.virtual1Base || 0;
        let v1Sur = parsedSum.virtual1Surcharge || 0;
        if (v1S > 0 && v1Sur === 0 && pct1 > 0) {
          v1B = v1S / (1 + pct1 / 100);
          v1Sur = v1S - v1B;
        }
        totalVirtual1Sales += v1S;
        totalVirtual1Base += v1B;
        totalVirtual1Surcharge += v1Sur;

        let v2S = parsedSum.virtual2Sales || 0;
        let v2B = parsedSum.virtual2Base || 0;
        let v2Sur = parsedSum.virtual2Surcharge || 0;
        if (v2S > 0 && v2Sur === 0 && pct2 > 0) {
          v2B = v2S / (1 + pct2 / 100);
          v2Sur = v2S - v2B;
        }
        totalVirtual2Sales += v2S;
        totalVirtual2Base += v2B;
        totalVirtual2Surcharge += v2Sur;
      } catch {
        sessionGross = s.closingAmountExpected || 0;
      }
    } else {
      sessionGross = s.closingAmountExpected || 0;
    }
    ventaTotalBruto += sessionGross;
    computedCashCounted += sCounted;
    computedCashExpected += sExpected;
  });

  const cashExpectedTotal = summary.totalCashExpected ?? computedCashExpected;
  const cashCountedTotal = summary.totalCashCounted ?? computedCashCounted;
  const cashDifferenceTotal = cashCountedTotal - cashExpectedTotal;

  const allPosnetKeys = Array.from(new Set([
    ...Object.keys(summary.paymentBreakdown || {}).filter(k => k !== 'CASH' && k !== 'DEBT'),
    ...Object.keys(summary.posnetDeclarations || {})
  ]));

  let totalPosnetsExpected = 0;
  let totalPosnetsDeclared = 0;
  const posnetRows = allPosnetKeys.map(key => {
    const expected = Number(summary.paymentBreakdown?.[key]) || 0;
    const declared = Number(summary.posnetDeclarations?.[key]) || 0;
    const diff = declared - expected;
    totalPosnetsExpected += expected;
    totalPosnetsDeclared += declared;
    return { key, expected, declared, diff };
  });

  const totalEsperadoConsolidado = cashExpectedTotal + totalPosnetsExpected;
  const totalDeclaradoConsolidado = cashCountedTotal + totalPosnetsDeclared;
  const diferenciaTotalConsolidada = totalDeclaradoConsolidado - totalEsperadoConsolidado;

  const totalVirtualSales = totalVirtual1Sales + totalVirtual2Sales;
  const denominations = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];

  useEffect(() => {
    const timer = setTimeout(() => setPrintReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isHistory) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isHistory]);

  const handleCloseWithConfirmation = () => {
    setShowConfirmClose(true);
  };

  const handlePrint = (mode: 'z-only' | 'z-and-x') => {
    setPrintMode(mode);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const formatMovementDescription = (desc: string) => {
    if (!desc) return '';
    let clean = desc.replace(/\s*\|\s*METODO:\s*\w+/gi, '').trim();
    clean = clean.replace(/^\[.*?\]\s*/i, '').trim();
    const sueldoMatch = clean.match(/LIQUIDACIÓN DE SUELDO PARA\s+([^\s]+)\s+POR\s+(\d+)\s+HORAS/i);
    if (sueldoMatch) {
      return `${sueldoMatch[1].toUpperCase()} ${sueldoMatch[2]} horas`;
    }
    return clean;
  };

  const parseSessionData = (session: any) => {
    let notesClean = session.closingNotes || '';
    let metadata: any = { bills: {}, posnetDeclarations: {}, closedBy: '' };
    if (session.closingNotes && session.closingNotes.includes('[METADATA]')) {
      const parts = session.closingNotes.split('[METADATA]');
      notesClean = parts[0].trim();
      try {
        metadata = JSON.parse(parts[1]);
      } catch {}
    }

    let sum: any = {};
    if (session.closingSummary) {
      try {
        sum = JSON.parse(session.closingSummary);
      } catch {}
    }

    const totalGross = sum.totalRevenue || 0;
    const cashSales = sum.paymentBreakdown?.CASH || 0;
    const cloverSales = sum.paymentBreakdown?.CLOVER || 0;
    const mpSales = sum.paymentBreakdown?.MERCADOPAGO || 0;
    const debtSales = sum.paymentBreakdown?.DEBT || 0;

    const expenses = sum.cashExpense || 0;
    const withdrawals = sum.cashWithdrawal || 0;

    const expectedCash = sum.expectedCash ?? session.closingAmountExpected ?? 0;
    const totalExpected = expectedCash + cloverSales + mpSales;
    const cloverDeclared = metadata.posnetDeclarations?.CLOVER || metadata.virtualClover || 0;
    const mpDeclared = (metadata.posnetDeclarations?.MERCADOPAGO || 0) || (metadata.virtualMP1 || 0) + (metadata.virtualMP2 || 0);
    const countedCash = sum.countedCash ?? session.closingAmountCounted ?? 0;

    const totalDeclared = countedCash + cloverDeclared + mpDeclared;
    const differenceTotal = totalDeclared - totalExpected;
    const pct1 = Number(localStorage.getItem('virtual1_surcharge') || '0');
    const pct2 = Number(localStorage.getItem('virtual2_surcharge') || '0');

    let virtual1Sales = sum.virtual1Sales || 0;
    let virtual1Base = sum.virtual1Base || 0;
    let virtual1Surcharge = sum.virtual1Surcharge || 0;
    if (virtual1Sales > 0 && virtual1Surcharge === 0 && pct1 > 0) {
      virtual1Base = virtual1Sales / (1 + pct1 / 100);
      virtual1Surcharge = virtual1Sales - virtual1Base;
    }

    let virtual2Sales = sum.virtual2Sales || 0;
    let virtual2Base = sum.virtual2Base || 0;
    let virtual2Surcharge = sum.virtual2Surcharge || 0;
    if (virtual2Sales > 0 && virtual2Surcharge === 0 && pct2 > 0) {
      virtual2Base = virtual2Sales / (1 + pct2 / 100);
      virtual2Surcharge = virtual2Sales - virtual2Base;
    }

    return {
      notesClean,
      metadata,
      totalGross,
      cashSales,
      cloverSales,
      mpSales,
      debtSales,
      expenses,
      withdrawals,
      expectedCash,
      totalExpected,
      cloverDeclared,
      mpDeclared,
      countedCash,
      totalDeclared,
      differenceTotal,
      virtual1Sales,
      virtual1Base,
      virtual1Surcharge,
      virtual2Sales,
      virtual2Base,
      virtual2Surcharge
    };
  };

  return (
    <>
      {/* 1. Printable Master Z & X Portal directly attached to body */}
      {createPortal(
        <div id="printable-z-master-portal" className="hidden print:block">
          <style type="text/css">
            {`
              @media print {
                html, body { 
                  height: auto !important; 
                  overflow: visible !important; 
                  background: #ffffff !important;
                  color: #000000 !important;
                }
                #root, .no-print-screen { 
                  display: none !important; 
                }
                #printable-z-master-portal {
                  display: block !important;
                  position: static !important;
                  width: 100% !important;
                  height: auto !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  background: #ffffff !important;
                  color: #000000 !important;
                }
                .print-z-only #printable-cierre-dia { 
                  display: block !important; 
                  page-break-after: auto !important; 
                  break-after: auto !important; 
                }
                .print-z-only #printable-cierres-x { 
                  display: none !important; 
                }
                .print-z-and-x #printable-cierre-dia { 
                  display: block !important; 
                  page-break-after: always !important; 
                  break-after: page !important; 
                }
                .print-z-and-x #printable-cierres-x { 
                  display: block !important; 
                }
                #printable-cierre-dia {
                  display: block !important;
                  position: static !important;
                  width: 100% !important;
                  background: #ffffff !important;
                  color: #000000 !important;
                  box-sizing: border-box !important;
                  margin: 0 !important;
                }
                #printable-cierres-x {
                  width: 100% !important;
                  background: #ffffff !important;
                  color: #000000 !important;
                }
                .report-x-page {
                  width: 100% !important;
                  box-sizing: border-box !important;
                  page-break-inside: avoid !important;
                  break-inside: avoid !important;
                  background: #ffffff !important;
                  color: #000000 !important;
                }
                @page { size: A4 portrait; margin: 4mm; }
              }
            `}
          </style>

          <div className={printMode === 'z-only' ? 'print-z-only' : 'print-z-and-x'}>
            {/* Printable Area Z-Report */}
            <div id="printable-cierre-dia" style={{ fontFamily: 'sans-serif', padding: '3.5mm 4mm', boxSizing: 'border-box', color: '#000000', backgroundColor: '#ffffff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #000000', paddingBottom: '2.5mm', marginBottom: '3mm' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2.5mm' }}>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: '18px', height: '18px', flexShrink: 0 }}>
                <path d="M12 3C8 3 4.5 6.5 4.5 12c0 5 3 8.5 7.5 8.5s7.5-3.5 7.5-8.5c0-3-1.2-5-3-6.3" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 3c1.5 1.2 2.3 2.6 2.3 4.2" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <div>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#000000', letterSpacing: '-0.03em' }}>
                  {(localStorage.getItem('gd_store_name') || 'Ventra POS').toUpperCase()}
                </h1>
                <p style={{ margin: '1mm 0 0 0', fontSize: '9px', fontWeight: 'bold', color: '#000000', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema de Control e Inventario de Caja</p>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: '13px', fontWeight: 'bold', color: '#000000' }}>REPORTE DE CIERRE DE DÍA (Z)</h2>
              <p style={{ margin: '1mm 0 0 0', fontSize: '9px', fontWeight: 'bold', color: '#000000' }}>ID Z: #{zReport.id?.substring(0, 8).toUpperCase()}</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4mm', marginBottom: '3mm', background: '#ffffff', padding: '2.5mm 3mm', borderRadius: '3mm', border: '2px solid #000000' }}>
            <div>
              <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Fecha de Emisión</span>
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#000000' }}>{new Date(zReport.generatedAt).toLocaleString('es-AR')}</span>
            </div>
            <div>
              <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Cantidad de Turnos Consolidados</span>
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#000000' }}>{summary.sessionCount ?? zReport.sessions?.length ?? 0}</span>
            </div>
            <div>
              <span style={{ fontSize: '8px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Generado por</span>
              <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#000000' }}>{zReport.generatedBy?.fullName || 'Administrador'}</span>
            </div>
          </div>

          {/* Si son 3 turnos o menos: Formato de Tarjetas por Turno */}
          {sessionsToRender.length <= 3 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginBottom: '3mm' }}>
              <h3 style={{ fontSize: '11px', fontWeight: '900', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #000000', paddingBottom: '1mm', marginBottom: '2.5mm' }}>Desglose de Declaraciones por Turno</h3>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${sessionsToRender.length}, 1fr)`, gap: '4mm', minHeight: 0 }}>
                {sessionsToRender.map((session: any, sIdx: number) => {
                  const sData = parseSessionData(session);
                  const billsMap = sData.metadata?.bills || {};
                  const activeBills = denominations.filter(den => (billsMap[den] || 0) > 0);

                  const cardExpectedCash = sData.expectedCash;
                  const cardCountedCash = sData.countedCash;
                  const cardDiffCash = cardCountedCash - cardExpectedCash;

                  const cardExpectedCards = sData.cloverSales + sData.mpSales;
                  const cardDeclaredCards = sData.cloverDeclared + sData.mpDeclared;
                  const cardDiffCards = cardDeclaredCards - cardExpectedCards;

                  const cardTotalExpected = cardExpectedCash + cardExpectedCards;
                  const cardTotalDeclared = cardCountedCash + cardDeclaredCards;
                  const cardDiffTotal = cardTotalDeclared - cardTotalExpected;

                  return (
                    <div key={session.id} style={{ border: '2px solid #000000', borderRadius: '3mm', padding: '3mm', background: '#ffffff', fontSize: '9px', color: '#000000', display: 'flex', flexDirection: 'column', gap: '2mm' }}>
                      <h4 style={{ margin: '0', fontSize: '11px', fontWeight: '900', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', textTransform: 'uppercase' }}>
                        T{sIdx + 1}: {session.user?.fullName || 'Desconocido'} ({session.terminalName})
                      </h4>

                      {/* A: Cierre de Sistema */}
                      <div>
                        <div style={{ fontWeight: '900', textTransform: 'uppercase', fontSize: '8.5px', borderBottom: '1px solid #000000', paddingBottom: '0.5mm', marginBottom: '1mm' }}>Cierre de Sistema:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Venta Sistema:</span> <span style={{ fontWeight: 'bold' }}>{fmt(sData.totalGross)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Virtual 1:</span> <span style={{ fontWeight: 'bold' }}>{fmt(sData.virtual1Sales)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Virtual 2:</span> <span style={{ fontWeight: 'bold' }}>{fmt(sData.virtual2Sales)}</span></div>
                        </div>
                      </div>

                      {/* B: Conciliación Efectivo */}
                      <div>
                        <div style={{ fontWeight: '900', textTransform: 'uppercase', fontSize: '8.5px', borderBottom: '1px solid #000000', paddingBottom: '0.5mm', marginBottom: '1mm' }}>Conciliación Efectivo:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '1mm' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total Efectivo Esperado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(cardExpectedCash)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total Efectivo Declarado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(cardCountedCash)}</span></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dotted #000000', paddingTop: '1.5px', marginTop: '1px' }}>
                            <span style={{ fontWeight: '900' }}>Diferencia Efectivo:</span>
                            <span style={{ fontWeight: '900' }}>
                              {cardDiffCash > 0 ? '+' : ''}{fmt(cardDiffCash)}
                            </span>
                          </div>
                        </div>

                        {/* Collapsible Bills Detail */}
                        {activeBills.length > 0 && (
                          <div style={{ marginTop: '1mm', border: '1px solid #000000', borderRadius: '1.5mm', padding: '1.2mm' }}>
                            <div style={{ fontSize: '8px', color: '#000000', fontWeight: '900', textTransform: 'uppercase', marginBottom: '0.5mm' }}>Desglose Billetes:</div>
                            <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse' }}>
                              <tbody>
                                {activeBills.map((den) => {
                                  const qty = billsMap[den];
                                  return (
                                    <tr key={den} style={{ borderBottom: '0.5px dotted #000000' }}>
                                      <td style={{ padding: '1px', fontWeight: 'bold' }}>$ {den.toLocaleString()}</td>
                                      <td style={{ padding: '1px', textAlign: 'center', color: '#000000' }}>{qty}</td>
                                      <td style={{ padding: '1px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(den * qty)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* C: Conciliación Tarjetas / QR */}
                      <div>
                        <div style={{ fontWeight: '900', textTransform: 'uppercase', fontSize: '8.5px', borderBottom: '1px solid #000000', paddingBottom: '0.5mm', marginBottom: '1mm' }}>Conciliación Tarjetas/QR:</div>
                        <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse', marginBottom: '1.5mm' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #000000', fontWeight: '900', color: '#000000' }}>
                              <th style={{ textAlign: 'left', padding: '1.5px 1px' }}>Medio</th>
                              <th style={{ textAlign: 'right', padding: '1.5px 1px' }}>Esp.</th>
                              <th style={{ textAlign: 'right', padding: '1.5px 1px' }}>Decl.</th>
                              <th style={{ textAlign: 'right', padding: '1.5px 1px' }}>Dif.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Clover */}
                            <tr style={{ borderBottom: '0.5px dotted #000000' }}>
                              <td style={{ padding: '1.5px 1px', fontWeight: 'bold' }}>CLOVER</td>
                              <td style={{ padding: '1.5px 1px', textAlign: 'right' }}>{fmt(sData.cloverSales)}</td>
                              <td style={{ padding: '1.5px 1px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(sData.cloverDeclared)}</td>
                              <td style={{ padding: '1.5px 1px', textAlign: 'right', fontWeight: 'bold' }}>
                                {(sData.cloverDeclared - sData.cloverSales) > 0 ? '+' : ''}{fmt(sData.cloverDeclared - sData.cloverSales)}
                              </td>
                            </tr>
                            {/* MP */}
                            <tr style={{ borderBottom: '0.5px dotted #000000' }}>
                              <td style={{ padding: '1.5px 1px', fontWeight: 'bold' }}>MERCADOPAGO</td>
                              <td style={{ padding: '1.5px 1px', textAlign: 'right' }}>{fmt(sData.mpSales)}</td>
                              <td style={{ padding: '1.5px 1px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(sData.mpDeclared)}</td>
                              <td style={{ padding: '1.5px 1px', textAlign: 'right', fontWeight: 'bold' }}>
                                {(sData.mpDeclared - sData.mpSales) > 0 ? '+' : ''}{fmt(sData.mpDeclared - sData.mpSales)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        {/* Totales Tarjetas/QR */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '1.5mm', borderRadius: '1.5mm', border: '1px solid #000000' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Total Tarjetas/QR Esperado:</span>
                            <span style={{ fontWeight: 'bold' }}>{fmt(cardExpectedCards)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Total Tarjetas/QR Declarado:</span>
                            <span style={{ fontWeight: 'bold' }}>{fmt(cardDeclaredCards)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dotted #000000', paddingTop: '1.5px', marginTop: '1px' }}>
                            <span style={{ fontWeight: '900' }}>Diferencia Tarjetas/QR:</span>
                            <span style={{ fontWeight: '900' }}>
                              {cardDiffCards > 0 ? '+' : ''}{fmt(cardDiffCards)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* D: Egresos del Turno */}
                      {session.cashMovements && session.cashMovements.filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').length > 0 && (
                        <div>
                          <div style={{ fontWeight: '900', textTransform: 'uppercase', fontSize: '8.5px', borderBottom: '1px solid #000000', paddingBottom: '0.5mm', marginBottom: '1mm' }}>Egresos del Turno:</div>
                          <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse' }}>
                            <tbody>
                              {session.cashMovements.filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').map((m: any) => {
                                const cleanDesc = formatMovementDescription(m.description || (m.type === 'WITHDRAWAL' ? 'Retiro a caja fuerte' : 'Gasto'));
                                return (
                                  <tr key={m.id} style={{ borderBottom: '0.5px dotted #000000' }}>
                                    <td style={{ padding: '1.5px 1px', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {cleanDesc}
                                    </td>
                                    <td style={{ padding: '1.5px 1px', textAlign: 'right', fontWeight: 'bold' }}>
                                      -{fmt(m.amount)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* E: Resumen del Turno */}
                      <div style={{ borderTop: '1.5px solid #000000', paddingTop: '1.5mm', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                          <span>Total Efectivo:</span>
                          <span><strong>{fmt(cardCountedCash)}</strong> <span style={{ fontWeight: 'bold' }}>({cardDiffCash > 0 ? '+' : ''}{fmt(cardDiffCash)})</span></span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                          <span>Total Tarjetas/QR:</span>
                          <span><strong>{fmt(cardDeclaredCards)}</strong> <span style={{ fontWeight: 'bold' }}>({cardDiffCards > 0 ? '+' : ''}{fmt(cardDiffCards)})</span></span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', fontWeight: 'bold', borderTop: '0.5px dotted #000000', paddingTop: '1.5px', marginTop: '1px' }}>
                          <span>Total Esperado:</span>
                          <span>{fmt(cardTotalExpected)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', fontWeight: 'bold' }}>
                          <span>Total Declarado:</span>
                          <span>{fmt(cardTotalDeclared)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '900', marginTop: '2px', borderTop: '1.5px solid #000000', paddingTop: '1.5px' }}>
                          <span>Diferencia Real:</span>
                          <span>
                            {cardDiffTotal > 0 ? '+' : ''}{fmt(cardDiffTotal)}
                          </span>
                        </div>
                      </div>

                      {/* F: Nota / Observaciones del Cajero */}
                      {sData.notesClean && sData.notesClean.trim().length > 0 && (
                        <div style={{ marginTop: '1.5mm', border: '1px solid #000000', borderRadius: '1.5mm', padding: '1.5mm', background: '#f8fafc' }}>
                          <span style={{ fontSize: '8px', fontWeight: '900', textTransform: 'uppercase', display: 'block', color: '#000000' }}>Nota de Arqueo:</span>
                          <p style={{ margin: '0.5mm 0 0 0', fontSize: '8.5px', fontStyle: 'italic', color: '#000000', wordBreak: 'break-word', lineHeight: 1.2 }}>{sData.notesClean}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Si son más de 3 turnos: Formato de Tablas Resumen */}
          {sessionsToRender.length > 3 && (
            <>
              {/* Detalle de Turnos (Reportes X) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '3mm', marginBottom: '3mm' }}>
                <div>
                  <h3 style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #000000', paddingBottom: '1mm', marginBottom: '1mm' }}>Detalle de Turnos (Reportes X)</h3>
                  <table style={{ width: '100%', fontSize: '9px', borderCollapse: 'collapse', color: '#000000' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #000000', color: '#000000', fontWeight: 'bold' }}>
                        <th style={{ textAlign: 'left', padding: '2.5px 3px' }}>Cajero / Responsable</th>
                        <th style={{ textAlign: 'left', padding: '2.5px 3px' }}>Terminal</th>
                        <th style={{ textAlign: 'left', padding: '2.5px 3px' }}>Apertura</th>
                        <th style={{ textAlign: 'left', padding: '2.5px 3px' }}>Cierre</th>
                        <th style={{ textAlign: 'right', padding: '2.5px 3px' }}>Venta Sistema</th>
                        <th style={{ textAlign: 'right', padding: '2.5px 3px' }}>Total Declarado</th>
                        <th style={{ textAlign: 'right', padding: '2.5px 3px' }}>Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionsToRender.map((session: any, idx: number) => {
                        let totalSessionGross = 0;
                        let countedCash = session.closingAmountCounted || 0;
                        let posnetDeclared = 0;

                        if (session.closingSummary) {
                          try {
                            const sum = typeof session.closingSummary === 'string' ? JSON.parse(session.closingSummary) : session.closingSummary;
                            totalSessionGross = sum.totalRevenue || 0;
                            countedCash = sum.countedCash ?? session.closingAmountCounted ?? 0;
                            if (sum.posnetDeclarations) {
                              posnetDeclared = (Object.values(sum.posnetDeclarations) as any[]).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
                            }
                          } catch (e) {}
                        }

                        if (posnetDeclared === 0 && session.closingNotes && session.closingNotes.includes('[METADATA]')) {
                          try {
                            const parts = session.closingNotes.split('[METADATA]');
                            const meta = JSON.parse(parts[1]);
                            const clover = meta.posnetDeclarations?.CLOVER || meta.virtualClover || 0;
                            const mp = (meta.posnetDeclarations?.MERCADOPAGO || 0) || (meta.virtualMP1 || 0) + (meta.virtualMP2 || 0);
                            posnetDeclared = clover + mp;
                          } catch (e) {}
                        }

                        if (!totalSessionGross) {
                          if (session.totalRevenue) {
                            totalSessionGross = session.totalRevenue;
                          } else if (session.sales && session.sales.length > 0) {
                            totalSessionGross = session.sales.reduce((acc: number, v: any) => acc + (v.total || 0), 0);
                          } else if (session.closingAmountExpected) {
                            totalSessionGross = session.closingAmountExpected;
                          }
                        }

                        const totalSessionDeclared = countedCash + posnetDeclared;
                        // Diferencia total del turno (efectivo + posnet), la misma que ve el cajero al cerrar
                        const sessionDiff = cashClosingResult(session).totalDiff;

                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #000000' }}>
                            <td style={{ padding: '2.5px 3px', fontWeight: 'bold' }}>{session.user?.fullName || 'Desconocido'}</td>
                            <td style={{ padding: '2.5px 3px' }}>{session.terminalName}</td>
                            <td style={{ padding: '2.5px 3px' }}>{new Date(session.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                            <td style={{ padding: '2.5px 3px' }}>{new Date(session.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                            <td style={{ padding: '2.5px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(totalSessionGross)}</td>
                            <td style={{ padding: '2.5px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(totalSessionDeclared)}</td>
                            <td style={{ padding: '2.5px 3px', textAlign: 'right', fontWeight: 'bold' }}>{sessionDiff > 0 ? '+' : ''}{fmt(sessionDiff)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Detalle de Gastos y Egresos de Caja */}
              {(summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').length > 0 && (
                <div style={{ marginBottom: '3mm' }}>
                  <h3 style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', marginBottom: '1mm' }}>Detalle de Gastos y Egresos de Caja</h3>
                  <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse', color: '#000000' }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #000000', color: '#000000', fontWeight: 'bold' }}>
                        <th style={{ textAlign: 'left', padding: '2px 3px' }}>Hora</th>
                        <th style={{ textAlign: 'left', padding: '2px 3px' }}>Usuario</th>
                        <th style={{ textAlign: 'left', padding: '2px 3px' }}>Motivo</th>
                        <th style={{ textAlign: 'right', padding: '2px 3px' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').map((movement: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #000000' }}>
                          <td style={{ padding: '2px 3px' }}>{new Date(movement.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</td>
                          <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>{movement.user?.fullName || 'Desconocido'}</td>
                          <td style={{ padding: '2px 3px' }}>
                            {formatMovementDescription(movement.description || (movement.type === 'WITHDRAWAL' ? 'Retiro a caja fuerte' : 'Gasto'))}
                            {movement.type === 'WITHDRAWAL' && <span style={{ marginLeft: '4px', padding: '1px 3px', border: '1px solid #000000', borderRadius: '2px', fontSize: '7.5px', fontWeight: 'bold' }}>RETIRO</span>}
                          </td>
                          <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>-{fmt(movement.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Observaciones de Cajeros (Más de 3 turnos) */}
              {sessionsToRender.some((s: any) => { const d = parseSessionData(s); return d.notesClean && d.notesClean.trim(); }) && (
                <div style={{ marginTop: '2.5mm', border: '1.5px solid #000000', borderRadius: '2mm', padding: '2mm', background: '#f8fafc' }}>
                  <div style={{ fontSize: '8.5px', fontWeight: '900', textTransform: 'uppercase', marginBottom: '1mm', color: '#000000' }}>Observaciones de Arqueo por Turno:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5mm' }}>
                    {sessionsToRender.map((session: any, sIdx: number) => {
                      const sData = parseSessionData(session);
                      if (!sData.notesClean || !sData.notesClean.trim()) return null;
                      return (
                        <div key={session.id} style={{ fontSize: '8px', color: '#000000' }}>
                          <strong>T{sIdx + 1} ({session.user?.fullName || 'Cajero'}):</strong> <span style={{ fontStyle: 'italic' }}>{sData.notesClean}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 'auto', borderTop: '2.5px solid #000000', paddingTop: '3mm', display: 'grid', gridTemplateColumns: '1.1fr 1.1fr 1.2fr 1.1fr', gap: '3.5mm', alignItems: 'center' }}>
              {/* 1. Total Efectivo y Diferencia Efectivo */}
              <div style={{ borderRight: '1.5px solid #000000', paddingRight: '2mm' }}>
                <div style={{ fontSize: '9.5px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '1px' }}>Total Efectivo</div>
                <div style={{ fontSize: '9px' }}>Esp: <strong>{fmt(cashExpectedTotal)}</strong> | Decl: <strong>{fmt(cashCountedTotal)}</strong></div>
                <div style={{ fontSize: '9.5px', fontWeight: 900, marginTop: '1.5px' }}>
                  Dif. Efectivo: {cashDifferenceTotal > 0 ? '+' : ''}{fmt(cashDifferenceTotal)}
                </div>
              </div>

              {/* 2. Total Tarjetas/QR y Diferencia Tarjetas/QR */}
              <div style={{ borderRight: '1.5px solid #000000', paddingRight: '2mm' }}>
                <div style={{ fontSize: '9.5px', fontWeight: 900, textTransform: 'uppercase', marginBottom: '1px' }}>Total Tarjetas y QR</div>
                <div style={{ fontSize: '9px' }}>Esp: <strong>{fmt(totalPosnetsExpected)}</strong> | Decl: <strong>{fmt(totalPosnetsDeclared)}</strong></div>
                <div style={{ fontSize: '9.5px', fontWeight: 900, marginTop: '1.5px' }}>
                  Dif. Tarjetas/QR: {(totalPosnetsDeclared - totalPosnetsExpected) > 0 ? '+' : ''}{fmt(totalPosnetsDeclared - totalPosnetsExpected)}
                </div>
              </div>

              {/* 3. Venta Sistema */}
              <div style={{ borderRight: '1.5px solid #000000', paddingRight: '2mm' }}>
                <div style={{ fontSize: '11px', fontWeight: 900, textTransform: 'uppercase' }}>Venta Total Sistema</div>
                <div style={{ fontSize: '13px', fontWeight: 900, marginTop: '0.5mm' }}>{fmt(ventaTotalBruto)}</div>
                <div style={{ fontSize: '8.5px', marginTop: '1px' }}>
                  Decl: <strong>{fmt(totalDeclaradoConsolidado)}</strong> | Esp: <strong>{fmt(totalEsperadoConsolidado)}</strong>
                </div>
              </div>

              {/* 4. Diferencia Consolidada */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase' }}>Diferencia Total:</div>
                <div style={{ fontSize: '20px', fontWeight: 900, lineHeight: 1.1, marginTop: '0.5mm' }}>
                   {diferenciaTotalConsolidada > 0 ? '+' : ''}{fmt(diferenciaTotalConsolidada)}
                </div>
              </div>
          </div>
        </div>

        {/* Printable Area - Individual Cierres X */}
        <div id="printable-cierres-x" style={{ width: '100%' }}>
          {(zReport.sessions || []).map((session: any, idx: number) => {
            const data = parseSessionData(session);
            const isLast = idx === (zReport.sessions || []).length - 1;
            return (
              <div 
                key={session.id} 
                className="report-x-page"
                style={{ 
                  fontFamily: 'sans-serif', 
                  padding: '3mm 4mm', 
                  boxSizing: 'border-box', 
                  backgroundColor: '#ffffff', 
                  color: '#000000',
                  maxHeight: '280mm',
                  overflow: 'hidden',
                  pageBreakInside: 'avoid',
                  breakInside: 'avoid',
                  pageBreakAfter: isLast ? 'auto' : 'always',
                  breakAfter: isLast ? 'auto' : 'page'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px solid #000000', paddingBottom: '2mm', marginBottom: '2.5mm' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2.5mm' }}>
                    <svg viewBox="0 0 24 24" fill="none" style={{ width: '16px', height: '16px', flexShrink: 0 }}>
                      <path d="M12 3C8 3 4.5 6.5 4.5 12c0 5 3 8.5 7.5 8.5s7.5-3.5 7.5-8.5c0-3-1.2-5-3-6.3" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
                      <path d="M12 3c1.5 1.2 2.3 2.6 2.3 4.2" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <div>
                      <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 900, color: '#000000', letterSpacing: '-0.03em' }}>
                        {(localStorage.getItem('gd_store_name') || 'Ventra POS').toUpperCase()}
                      </h1>
                      <p style={{ margin: '0.5mm 0 0 0', fontSize: '8.5px', fontWeight: 'bold', color: '#000000', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sistema de Control e Inventario de Caja</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <h2 style={{ margin: 0, fontSize: '12px', fontWeight: 'bold', color: '#000000' }}>REPORTE DE ARQUEO DE TURNO (X)</h2>
                    <p style={{ margin: '0.5mm 0 0 0', fontSize: '8.5px', fontWeight: 'bold', color: '#000000' }}>ID: #{session.id?.substring(0, 8).toUpperCase()}</p>
                  </div>
                </div>

                {/* Session Metadata */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '3mm', marginBottom: '2.5mm', background: '#ffffff', padding: '2mm 3mm', borderRadius: '3mm', border: '2px solid #000000' }}>
                  <div>
                    <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Cajero</span>
                    <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{session.user?.fullName || 'Administrador'}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Terminal</span>
                    <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{session.terminalName || 'Terminal Principal'}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Apertura</span>
                    <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{new Date(session.openedAt).toLocaleString('es-AR')}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Cierre</span>
                    <span style={{ fontSize: '9.5px', fontWeight: 'bold', color: '#000000' }}>{new Date(session.closedAt).toLocaleString('es-AR')}</span>
                  </div>
                  <div style={{ background: '#ffffff', padding: '1mm 2mm', borderRadius: '1.5mm', border: '2px solid #000000', alignSelf: 'center', textAlign: 'center' }}>
                    <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Venta Sistema</span>
                    <span style={{ fontSize: '10.5px', fontWeight: '900', color: '#000000' }}>{fmt(data.totalGross)}</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '0.85fr 1.15fr', gap: '4mm', marginBottom: '2.5mm' }}>
                  {/* A: Arqueo de Efectivo */}
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
                          const qty = data.metadata.bills?.[den] || 0;
                          return (
                            <tr key={den} style={{ borderBottom: '1px solid #000000' }}>
                              <td style={{ padding: '1.8px 3px', fontWeight: 'bold' }}>$ {den.toLocaleString()}</td>
                              <td style={{ padding: '1.8px 3px', textAlign: 'center', fontWeight: 'bold' }}>{qty}</td>
                              <td style={{ padding: '1.8px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(den * qty)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1mm', marginTop: '2mm', fontSize: '8.5px', color: '#000000' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Ventas Efectivo:</span> <span style={{ fontWeight: 'bold' }}>{fmt(data.cashSales)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Egresos/Gastos:</span> <span style={{ fontWeight: 'bold' }}>-{fmt(data.expenses)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Retiros a Caja Fuerte:</span> <span style={{ fontWeight: 'bold' }}>-{fmt(data.withdrawals)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm', marginTop: '0.5mm' }}>
                        <span style={{ fontWeight: 'bold' }}>Virtual 1 (Separado):</span> 
                        <span style={{ fontWeight: 'bold' }}>
                          {fmt(data.virtual1Sales || 0)}
                          {(data.virtual1Sales || 0) > 0 && <span style={{ fontSize: '7.5px', fontWeight: 'normal', marginLeft: '1mm' }}>({fmt(data.virtual1Base || 0)} + {fmt(data.virtual1Surcharge || 0)})</span>}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 'bold' }}>Virtual 2 (Separado):</span> 
                        <span style={{ fontWeight: 'bold' }}>
                          {fmt(data.virtual2Sales || 0)}
                          {(data.virtual2Sales || 0) > 0 && <span style={{ fontSize: '7.5px', fontWeight: 'normal', marginLeft: '1mm' }}>({fmt(data.virtual2Base || 0)} + {fmt(data.virtual2Surcharge || 0)})</span>}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Total Esperado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(data.expectedCash)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Total Contado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(data.countedCash)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Diferencia:</span> <span style={{ fontWeight: 'bold' }}>{(data.countedCash - data.expectedCash) > 0 ? '+' : ''}{fmt(data.countedCash - data.expectedCash)}</span></div>
                    </div>
                  </div>

                  {/* C: Egresos de Dinero */}
                  <div>
                    <h3 style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', marginBottom: '1.5mm' }}>Sección C: Egresos de Dinero y Movimientos</h3>
                    {(!session.cashMovements || session.cashMovements.length === 0) ? (
                      <div style={{ padding: '2mm', background: '#ffffff', borderRadius: '1.5mm', border: '1.5px solid #000000', fontSize: '8.5px', color: '#000000', fontStyle: 'italic', textAlign: 'center' }}>
                        No se registraron egresos en este turno.
                      </div>
                    ) : (
                      <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse', color: '#000000' }}>
                        <thead>
                          <tr style={{ borderBottom: '1.5px solid #000000', color: '#000000', fontWeight: 'bold' }}>
                            <th style={{ textAlign: 'left', padding: '2px 3px' }}>Tipo</th>
                            <th style={{ textAlign: 'left', padding: '2px 3px' }}>Descripción</th>
                            <th style={{ textAlign: 'right', padding: '2px 3px' }}>Monto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {session.cashMovements.map((m: any) => (
                            <tr key={m.id} style={{ borderBottom: '1px solid #000000' }}>
                              <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>{m.type === 'INCOME' ? 'INGRESO' : m.type === 'EXPENSE' ? 'GASTO' : 'RETIRO'}</td>
                              <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>{formatMovementDescription(m.description || '')}</td>
                              <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{m.type === 'INCOME' ? '+' : '-'}{fmt(m.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot style={{ borderTop: '1.5px solid #000000' }}>
                          <tr style={{ fontWeight: 'bold' }}>
                            <td colSpan={2} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL GASTOS:</td>
                            <td style={{ padding: '2px 3px', textAlign: 'right' }}>-{fmt(data.expenses)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>
                </div>

                {/* B: Tarjetas y QR */}
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
                    <tbody style={{ borderBottom: '1.5px solid #000000' }}>
                      <tr style={{ borderBottom: '1px solid #000000' }}>
                        <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>Clover (Posnet)</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(data.cloverSales)}</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(data.cloverDeclared)}</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(data.cloverDeclared - data.cloverSales)}</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #000000' }}>
                        <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>MercadoPago (Caja 1 y 2)</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(data.mpSales)}</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(data.mpDeclared)}</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(data.mpDeclared - data.mpSales)}</td>
                      </tr>
                    </tbody>
                    <tfoot style={{ borderTop: '1.5px solid #000000' }}>
                      <tr style={{ fontWeight: 'bold' }}>
                        <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL TARJETAS Y QR DECLARADO:</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(data.cloverDeclared + data.mpDeclared)}</td>
                      </tr>
                      <tr style={{ fontWeight: 'bold' }}>
                        <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL TARJETAS Y QR ESPERADO:</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(data.cloverSales + data.mpSales)}</td>
                      </tr>
                      <tr style={{ fontWeight: 'bold' }}>
                        <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL DIFERENCIA:</td>
                        <td style={{ padding: '2px 3px', textAlign: 'right' }}>
                          {((data.cloverDeclared + data.mpDeclared) - (data.cloverSales + data.mpSales)) > 0 ? '+' : ''}
                          {fmt((data.cloverDeclared + data.mpDeclared) - (data.cloverSales + data.mpSales))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* D: Conciliación General */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '4mm', marginTop: '2mm', borderTop: '2px solid #000000', paddingTop: '2mm' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase' }}>Observaciones del Cierre</h4>
                    <p style={{ margin: '1mm 0 0 0', fontSize: '8.5px', color: '#000000', fontStyle: 'italic', background: '#ffffff', padding: '1.5mm', borderRadius: '1.5mm', minHeight: '8mm', border: '1.5px solid #000000' }}>{data.notesClean || 'Sin observaciones.'}</p>
                  </div>
                  <div style={{ background: '#ffffff', padding: '2mm 3mm', borderRadius: '3mm', border: '2px solid #000000', display: 'flex', flexDirection: 'column', justifyContent: 'center', color: '#000000' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1mm', fontSize: '9px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 'bold' }}>TOTAL ESPERADO:</span>
                        <span style={{ fontSize: '7px' }}>(Efectivo + Tarjetas/QR)</span>
                      </div>
                      <span style={{ fontWeight: 'bold' }}>{fmt(data.totalExpected)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5mm', fontSize: '9px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 'bold' }}>TOTAL DECLARADO:</span>
                        <span style={{ fontSize: '7px' }}>(Billetes + Tarjetas/QR)</span>
                      </div>
                      <span style={{ fontWeight: 'bold' }}>{fmt(data.totalDeclared)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px double #000000', paddingTop: '1.5mm', fontSize: '11.5px', fontWeight: 'bold' }}>
                      <span>DESVIACIÓN NETO:</span>
                      <span>{data.differenceTotal > 0 ? '+' : ''}{fmt(data.differenceTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
          </div>
        </div>,
        document.body
      )}

      {/* 2. Screen Area Modal Portal (no se muestra en modo headless) */}
      {!headless && createPortal(
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 no-print-screen">
          {/* Screen Area */}
          {isHistory ? (
        <motion.div
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.98, opacity: 0 }}
          className="bg-white rounded-2xl w-full max-w-6xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[calc(100dvh-16px)] no-print-screen tabular-nums"
        >
          {/* Header: título + datos del reporte */}
          <div className="px-6 py-3 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                <Printer className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900 leading-tight">Cierre del Día (Reporte Z)</h3>
                <p className="text-xs font-semibold text-slate-600 mt-0.5 truncate">
                  #Z-{zReport.id?.substring(0, 8).toUpperCase()} · {new Date(zReport.generatedAt).toLocaleString('es-AR')} · {summary.sessionCount ?? zReport.sessions?.length ?? 0} turno(s) · por {zReport.generatedBy?.fullName || 'Administrador'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 hover:text-slate-800 transition-colors shrink-0" aria-label="Cerrar">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body: sin scroll general; solo las listas largas se desplazan por dentro */}
          <div className="flex-1 min-h-0 flex flex-col gap-3 px-6 py-4 bg-slate-50/60 text-slate-800 overflow-hidden">
            {/* 1. Números principales */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Venta sistema consolidada</span>
                <span className="text-3xl font-black text-slate-900 leading-tight">
                  {fmt(
                    (summary.paymentBreakdown?.CASH || 0) +
                    Object.values(summary.paymentBreakdown || {}).filter((_, i) => Object.keys(summary.paymentBreakdown || {})[i] !== 'CASH').reduce((a: any, b: any) => a + Number(b), 0)
                  )}
                </span>
              </div>
              <div className={`rounded-xl px-4 py-3 border ${diferenciaTotalConsolidada >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <span className={`text-xs font-bold uppercase tracking-wider block ${diferenciaTotalConsolidada >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>Diferencia total</span>
                <span className={`text-3xl font-black leading-tight ${diferenciaTotalConsolidada >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {diferenciaTotalConsolidada > 0 ? '+' : ''}{fmt(diferenciaTotalConsolidada)}
                </span>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Virtual 1 (aparte)</span>
                <span className="text-2xl font-black text-slate-900 leading-tight">{fmt(zReport.virtual1Sales || 0)}</span>
                {(zReport.virtual1Sales || 0) > 0 && (
                  <span className="block text-xs text-slate-600 font-medium">{fmt(zReport.virtual1Base || 0)} + {fmt(zReport.virtual1Surcharge || 0)}</span>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider block">Virtual 2 (aparte)</span>
                <span className="text-2xl font-black text-slate-900 leading-tight">{fmt(zReport.virtual2Sales || 0)}</span>
                {(zReport.virtual2Sales || 0) > 0 && (
                  <span className="block text-xs text-slate-600 font-medium">{fmt(zReport.virtual2Base || 0)} + {fmt(zReport.virtual2Surcharge || 0)}</span>
                )}
              </div>
            </div>

            {/* 2. Operaciones | Declaración */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 shrink-0">
              <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 px-4 py-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-2 mb-2 border-b border-slate-100">Resumen de operaciones</h4>
                <div className="space-y-1.5 text-sm text-slate-700 font-medium">
                  <div className="flex justify-between gap-3">
                    <span>Ventas en efectivo</span>
                    <span className="font-bold text-emerald-700">+{fmt(summary.paymentBreakdown?.CASH || 0)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Ingresos a caja</span>
                    <span className="font-bold text-emerald-700">+{fmt(summary.cashIncome || 0)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Egresos y pagos</span>
                    <span className="font-bold text-red-600">-{fmt(summary.cashExpense || 0)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Retiros a caja fuerte</span>
                    <span className="font-bold text-red-600">-{fmt(summary.cashWithdrawal || 0)}</span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 px-4 py-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-2 mb-1 border-b border-slate-100">Declaración consolidada</h4>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-600 text-xs font-bold uppercase tracking-wide">
                      <th className="py-1">Medio</th>
                      <th className="py-1 text-right px-3 whitespace-nowrap">Esperado</th>
                      <th className="py-1 text-right px-3 whitespace-nowrap">Declarado</th>
                      <th className="py-1 text-right pl-3 whitespace-nowrap">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100">
                      <td className="py-1.5 font-bold text-slate-800">Efectivo físico</td>
                      <td className="py-1.5 text-right text-slate-700 px-3 whitespace-nowrap font-semibold">{fmt(cashExpectedTotal)}</td>
                      <td className="py-1.5 text-right font-bold text-slate-900 px-3 whitespace-nowrap">{fmt(cashCountedTotal)}</td>
                      <td className={`py-1.5 text-right font-extrabold pl-3 whitespace-nowrap ${cashDifferenceTotal >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {cashDifferenceTotal > 0 ? '+' : ''}{fmt(cashDifferenceTotal)}
                      </td>
                    </tr>
                    {posnetRows.map(({ key, expected, declared, diff }) => (
                      <tr key={key} className="border-t border-slate-100">
                        <td className="py-1.5 font-bold text-slate-800">{key}</td>
                        <td className="py-1.5 text-right text-slate-700 px-3 whitespace-nowrap font-semibold">{fmt(expected)}</td>
                        <td className="py-1.5 text-right font-bold text-slate-900 px-3 whitespace-nowrap">{fmt(declared)}</td>
                        <td className={`py-1.5 text-right font-extrabold pl-3 whitespace-nowrap ${diff >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {diff > 0 ? '+' : ''}{fmt(diff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. Turnos | Gastos (las listas se desplazan por dentro si son largas) */}
            <div className="flex-1 min-h-[120px] grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col min-h-0">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-2 border-b border-slate-100 shrink-0">Detalle de turnos (cierres X)</h4>
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-slate-600 text-xs font-bold uppercase tracking-wide">
                        <th className="py-1.5">Cajero</th>
                        <th className="py-1.5">Horario</th>
                        <th className="py-1.5 text-right">Venta</th>
                        <th className="py-1.5 text-right">Declarado</th>
                        <th className="py-1.5 text-right">Dif.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionsToRender.map((session: any, idx: number) => {
                        let totalSessionGross = 0;
                        let countedCash = session.closingAmountCounted || 0;
                        let posnetDeclared = 0;

                        if (session.closingSummary) {
                          try {
                            const sum = typeof session.closingSummary === 'string' ? JSON.parse(session.closingSummary) : session.closingSummary;
                            totalSessionGross = sum.totalRevenue || 0;
                            countedCash = sum.countedCash ?? session.closingAmountCounted ?? 0;
                            if (sum.posnetDeclarations) {
                              posnetDeclared = (Object.values(sum.posnetDeclarations) as any[]).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
                            }
                          } catch (e) {}
                        }

                        if (posnetDeclared === 0 && session.closingNotes && session.closingNotes.includes('[METADATA]')) {
                          try {
                            const parts = session.closingNotes.split('[METADATA]');
                            const meta = JSON.parse(parts[1]);
                            const clover = meta.posnetDeclarations?.CLOVER || meta.virtualClover || 0;
                            const mp = (meta.posnetDeclarations?.MERCADOPAGO || 0) || (meta.virtualMP1 || 0) + (meta.virtualMP2 || 0);
                            posnetDeclared = clover + mp;
                          } catch (e) {}
                        }

                        if (!totalSessionGross) {
                          if (session.totalRevenue) {
                            totalSessionGross = session.totalRevenue;
                          } else if (session.sales && session.sales.length > 0) {
                            totalSessionGross = session.sales.reduce((acc: number, v: any) => acc + (v.total || 0), 0);
                          } else if (session.closingAmountExpected) {
                            totalSessionGross = session.closingAmountExpected;
                          }
                        }

                        const totalSessionDeclared = countedCash + posnetDeclared;
                        // Diferencia total del turno (efectivo + posnet), la misma que ve el cajero al cerrar
                        const sessionDiff = cashClosingResult(session).totalDiff;
                        const hhmm = (d: any) => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

                        return (
                          <tr key={idx} className="border-t border-slate-100">
                            <td className="py-1.5">
                              <p className="font-bold text-slate-900 leading-tight">{session.user?.fullName || 'Desconocido'}</p>
                              <p className="text-xs text-slate-600 uppercase">{session.terminalName}</p>
                            </td>
                            <td className="py-1.5 text-slate-700 whitespace-nowrap">{hhmm(session.openedAt)} – {hhmm(session.closedAt)}</td>
                            <td className="py-1.5 text-right font-bold text-slate-900 whitespace-nowrap">{fmt(totalSessionGross)}</td>
                            <td className="py-1.5 text-right font-bold text-slate-900 whitespace-nowrap">{fmt(totalSessionDeclared)}</td>
                            <td className={`py-1.5 text-right font-extrabold whitespace-nowrap ${sessionDiff >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                              {sessionDiff > 0 ? '+' : ''}{fmt(sessionDiff)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-col min-h-0">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pb-2 border-b border-slate-100 shrink-0">Gastos y egresos de caja</h4>
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  {(summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').length > 0 ? (
                    <ul className="divide-y divide-slate-100">
                      {(summary.cashMovements || []).filter((m: any) => m.type === 'EXPENSE' || m.type === 'WITHDRAWAL').map((movement: any, idx: number) => (
                        <li key={idx} className="py-1.5 flex items-center justify-between gap-3 text-sm">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate">
                              {formatMovementDescription(movement.description || (movement.type === 'WITHDRAWAL' ? 'Retiro a caja fuerte' : 'Gasto'))}
                              {movement.type === 'WITHDRAWAL' && <span className="ml-2 px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-bold uppercase">Retiro</span>}
                            </p>
                            <p className="text-xs text-slate-600">{movement.user?.fullName || 'Desconocido'} · {new Date(movement.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                          <span className="font-bold text-red-600 whitespace-nowrap">-{fmt(movement.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-6 text-center text-sm text-slate-600">No hubo egresos registrados en este cierre.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex gap-3 justify-end shrink-0">
            <button onClick={() => handlePrint('z-only')} className="px-4 py-2.5 border-2 border-rose-600 text-rose-700 hover:bg-rose-50 rounded-xl text-sm font-bold transition-all flex items-center gap-2 cursor-pointer">
              <Printer className="w-4 h-4" /> Imprimir Reporte Z
            </button>
            <button onClick={() => handlePrint('z-and-x')} className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer">
              <Printer className="w-4 h-4" /> Imprimir Z + Cierres X
            </button>
            <button onClick={onClose} className="btn-secondary">
              Cerrar
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-lg bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden relative border border-slate-200 dark:border-slate-800 no-print-screen">
          <div className="px-8 py-8 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-2">¡Día Cerrado con Éxito!</h3>
            <p className="text-slate-600 mb-8 max-w-sm">
              Se ha generado el Reporte Z maestro consolidando <b>{summary.sessionCount ?? zReport.sessions?.length ?? 0}</b> turnos. Puedes imprimir el comprobante consolidado y los cierres a continuación.
            </p>
            <div className="flex flex-col gap-4 w-full">
              <button disabled={!printReady} onClick={() => handlePrint('z-only')} className="w-full py-3.5 rounded-xl border border-rose-600 text-rose-600 font-bold transition-all hover:bg-rose-50 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
                <Printer className="w-5 h-5" /> Imprimir Solo Reporte Z
              </button>
              <button disabled={!printReady} onClick={() => handlePrint('z-and-x')} className="w-full py-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer">
                <Printer className="w-5 h-5" /> Imprimir Z + Cierres X
              </button>
              <button onClick={handleCloseWithConfirmation} className="w-full btn-secondary">
                Cerrar y Volver
              </button>
            </div>
          </div>
        </motion.div>
      )}
      {showConfirmClose && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 no-print-screen">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full border border-slate-200 dark:border-slate-800 shadow-2xl text-center"
          >
            <div className="w-14 h-14 bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto mb-4 rounded-2xl border border-amber-500/20">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h4 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">¿Confirmar Salida?</h4>
            <p className="text-slate-600 dark:text-slate-400 text-xs font-semibold mb-6 leading-relaxed">
              Asegúrate de haber impreso o guardado los reportes necesarios (Reporte Z y Cierres X) antes de salir. No podrás volver a esta pantalla.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmClose(false)}
                className="flex-1 btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setShowConfirmClose(false);
                  onClose();
                  if (!isHistory) {
                    useAuthStore.getState().logout();
                  }
                }}
                className="flex-1 btn-danger"
              >
                Sí, salir
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>,
    document.body
  )}
  </>
  );
}
