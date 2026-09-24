import { createPortal } from 'react-dom';

/**
 * Hoja A4 del reporte de arqueo de turno (Cierre X). La usan la pantalla Cajas de la PC
 * (para imprimir) y el celular (para descargar el PDF): así los dos salen iguales.
 * Se monta oculta en <body> y solo se ve al imprimir (#printable-zreport).
 */

const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n);
const denominations = [20000, 10000, 2000, 1000, 500, 200, 100, 50, 20, 10];

/** Notas limpias, datos del arqueo (billetes, posnet) y resumen de un turno cerrado. */
export function parseXSession(session: any) {
  if (!session) return null;

  let notesClean = session.closingNotes || '';
  let metadata = {
    bills: {} as Record<number, number>,
    virtualClover: 0,
    virtualMP1: 0,
    virtualMP2: 0,
    closedBy: ''
  };

  if (session.closingNotes && session.closingNotes.includes('[METADATA]')) {
    const parts = session.closingNotes.split('[METADATA]');
    notesClean = parts[0].trim();
    try {
      const parsed = JSON.parse(parts[1]);
      metadata = {
        bills: parsed.bills || {},
        virtualClover: parsed.posnetDeclarations?.CLOVER || parsed.virtualClover || 0,
        virtualMP1: parsed.posnetDeclarations?.MERCADOPAGO || parsed.virtualMP1 || 0,
        virtualMP2: parsed.virtualMP2 || 0,
        closedBy: parsed.closedBy || ''
      };
    } catch (err) {
      console.error("Error parsing metadata from closingNotes", err);
    }
  }

  let closingSummaryParsed: any = null;
  if (session.closingSummary) {
    try {
      closingSummaryParsed = JSON.parse(session.closingSummary);
      if (closingSummaryParsed.posnetDeclarations) {
        if (closingSummaryParsed.posnetDeclarations.CLOVER !== undefined) {
          metadata.virtualClover = closingSummaryParsed.posnetDeclarations.CLOVER;
        }
        if (closingSummaryParsed.posnetDeclarations.MERCADOPAGO !== undefined) {
          metadata.virtualMP1 = closingSummaryParsed.posnetDeclarations.MERCADOPAGO;
          metadata.virtualMP2 = 0;
        }
      }
    } catch (err) {
      console.error("Error parsing closingSummary from session", err);
    }
  }

  const cashSales = closingSummaryParsed?.paymentBreakdown?.CASH ?? (session.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'CASH').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0);
  const cloverSales = closingSummaryParsed?.paymentBreakdown?.CLOVER ?? (session.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'CLOVER').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0);
  const mpSales = closingSummaryParsed?.paymentBreakdown?.MERCADOPAGO ?? (session.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'MERCADOPAGO').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0);
  const debtSales = closingSummaryParsed?.paymentBreakdown?.DEBT ?? (session.sales?.reduce((s: number, v: any) => s + (v.payments?.filter((p: any) => p.method === 'DEBT').reduce((a: number, p: any) => a + p.amount, 0) || 0), 0) || 0);
  const expenses = closingSummaryParsed?.cashExpense ?? (session.cashMovements?.filter((m: any) => m.type === 'EXPENSE').reduce((s: number, m: any) => s + m.amount, 0) || 0);
  const withdrawals = closingSummaryParsed?.cashWithdrawal ?? (session.cashMovements?.filter((m: any) => m.type === 'WITHDRAWAL').reduce((s: number, m: any) => s + m.amount, 0) || 0);

  const countedCash = closingSummaryParsed?.countedCash ?? Object.entries(metadata.bills).reduce((acc, [den, qty]) => acc + (Number(den) * qty), 0);

  const summary = {
    paymentBreakdown: {
      CASH: cashSales,
      CLOVER: cloverSales,
      MERCADOPAGO: mpSales,
      DEBT: debtSales
    },
    cashExpense: expenses,
    cashWithdrawal: withdrawals,
    countedCash: countedCash
  };

  return {
    notesClean,
    metadata,
    summary
  };
}

export default function XReportPrint({ session }: { session: any }) {
  const data = parseXSession(session);
  if (!data) return null;
  const cashSales = data.summary.paymentBreakdown?.CASH || 0;
  const cloverSales = data.summary.paymentBreakdown?.CLOVER || 0;
  const mpSales = data.summary.paymentBreakdown?.MERCADOPAGO || 0;
  const debtSales = data.summary.paymentBreakdown?.DEBT || 0;
  const expenses = data.summary.cashExpense || 0;
  const withdrawals = data.summary.cashWithdrawal || 0;

  const totalGross = cashSales + debtSales + cloverSales + mpSales;
  const totalExpected = (session.closingAmountExpected || 0) + cloverSales + mpSales;

   const cloverDeclared = data.metadata.virtualClover || 0;
  const mpDeclared = data.metadata.virtualMP1 + data.metadata.virtualMP2;
  const countedCash = data.summary.countedCash || 0;

  const totalDeclared = countedCash + cloverDeclared + mpDeclared;
  const differenceTotal = totalDeclared - totalExpected;

  let virtual1Sales = (data.summary as any).virtual1Sales;
  let virtual1Base = (data.summary as any).virtual1Base;
  let virtual1Surcharge = (data.summary as any).virtual1Surcharge;
  let virtual2Sales = (data.summary as any).virtual2Sales;
  let virtual2Base = (data.summary as any).virtual2Base;
  let virtual2Surcharge = (data.summary as any).virtual2Surcharge;

  // Fallback for old database sessions (where summary doesn't have virtual fields)
  if (virtual1Sales === undefined || virtual1Sales === null) {
    virtual1Sales = 0;
    virtual1Base = 0;
    virtual1Surcharge = 0;
    virtual2Sales = 0;
    virtual2Base = 0;
    virtual2Surcharge = 0;

    const pct1 = Number(localStorage.getItem('virtual1_surcharge') || '0');
    const pct2 = Number(localStorage.getItem('virtual2_surcharge') || '0');

    session.sales?.forEach((sale: any) => {
      sale.items?.forEach((item: any) => {
        if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
          const total = item.total || (item.unitPrice * item.quantity) || 0;
          virtual1Sales += total;
          const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
          if (match) {
            virtual1Base += parseFloat(match[1]) * item.quantity;
            virtual1Surcharge += parseFloat(match[2]) * item.quantity;
          } else {
            const base = total / (1 + pct1 / 100);
            virtual1Base += base;
            virtual1Surcharge += (total - base);
          }
        } else if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
          const total = item.total || (item.unitPrice * item.quantity) || 0;
          virtual2Sales += total;
          const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
          if (match) {
            virtual2Base += parseFloat(match[1]) * item.quantity;
            virtual2Surcharge += parseFloat(match[2]) * item.quantity;
          } else {
            const base = total / (1 + pct2 / 100);
            virtual2Base += base;
            virtual2Surcharge += (total - base);
          }
        }
      });
    });
  }

  return createPortal(
    <div id="printable-zreport" className="hidden print:block">
      <style>
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
            <p style={{ margin: '0.5mm 0 0 0', fontSize: '8.5px', fontWeight: 'bold', color: '#000000' }}>ID: #{session.id?.substring(0, 8).toUpperCase()}</p>
          </div>
        </div>

        {/* Session Metadata Grid */}
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
          <div style={{ background: '#ffffff', padding: '1mm 2mm', borderRadius: '1.5mm', border: '2px solid #000000', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', boxSizing: 'border-box' }}>
            <span style={{ fontSize: '7.5px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', display: 'block', marginBottom: '0.5mm' }}>Venta Sistema</span>
            <span style={{ fontSize: '10.5px', fontWeight: '900', color: '#000000' }}>
              {fmt(totalGross)}
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
                  const qty = data.metadata.bills[den] || 0;
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
                  {fmt(virtual1Sales)}
                  {virtual1Sales > 0 && (
                    <span style={{ fontSize: '7.5px', color: '#000000', fontWeight: 'normal', marginLeft: '1mm' }}>
                      ({fmt(virtual1Base)} + {fmt(virtual1Surcharge)})
                    </span>
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#000000', fontWeight: 'bold' }}>Virtual 2 (Separado):</span> 
                <span style={{ fontWeight: 'bold', color: '#000000' }}>
                  {fmt(virtual2Sales)}
                  {virtual2Sales > 0 && (
                    <span style={{ fontSize: '7.5px', color: '#000000', fontWeight: 'normal', marginLeft: '1mm' }}>
                      ({fmt(virtual2Base)} + {fmt(virtual2Surcharge)})
                    </span>
                  )}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Total Esperado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(session.closingAmountExpected || 0)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Total Contado:</span> <span style={{ fontWeight: 'bold' }}>{fmt(countedCash)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000000', paddingTop: '0.8mm' }}><span style={{ fontWeight: 'bold' }}>Diferencia:</span> <span style={{ fontWeight: 'bold' }}>{(countedCash - (session.closingAmountExpected || 0)) > 0 ? '+' : ''}{fmt(countedCash - (session.closingAmountExpected || 0))}</span></div>
            </div>
          </div>

          {/* C: Egresos de Dinero y Movimientos */}
          <div>
            <h3 style={{ fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid #000000', paddingBottom: '1mm', marginBottom: '1.5mm' }}>Sección C: Egresos de Dinero y Movimientos</h3>
            {(!session.cashMovements || session.cashMovements.length === 0) ? (
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
                  {session.cashMovements.map((m: any) => {
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
              <tr style={{ borderBottom: '1px solid #000000' }}>
                <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>Clover (Posnet)</td>
                <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(cloverSales)}</td>
                <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(cloverDeclared)}</td>
                <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(cloverDeclared - cloverSales)}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #000000' }}>
                <td style={{ padding: '2px 3px', fontWeight: 'bold' }}>MercadoPago (Caja 1 y 2)</td>
                <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(mpSales)}</td>
                <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(mpDeclared)}</td>
                <td style={{ padding: '2px 3px', textAlign: 'right', fontWeight: 'bold' }}>{fmt(mpDeclared - mpSales)}</td>
              </tr>
            </tbody>
            <tfoot style={{ borderTop: '1.5px solid #000000' }}>
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL TARJETAS Y QR DECLARADO:</td>
                <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(cloverDeclared + mpDeclared)}</td>
              </tr>
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL TARJETAS Y QR ESPERADO:</td>
                <td style={{ padding: '2px 3px', textAlign: 'right' }}>{fmt(cloverSales + mpSales)}</td>
              </tr>
              <tr style={{ fontWeight: 'bold' }}>
                <td colSpan={3} style={{ padding: '2px 3px', textTransform: 'uppercase' }}>TOTAL DIFERENCIA:</td>
                <td style={{ padding: '2px 3px', textAlign: 'right' }}>
                  {((cloverDeclared + mpDeclared) - (cloverSales + mpSales)) > 0 ? '+' : ''}
                  {fmt((cloverDeclared + mpDeclared) - (cloverSales + mpSales))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* D: Conciliación General */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '4mm', marginTop: '2mm', borderTop: '2px solid #000000', paddingTop: '2mm' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '9px', fontWeight: 'bold', color: '#000000', textTransform: 'uppercase' }}>Observaciones del Cierre</h4>
            <p style={{ margin: '1mm 0 0 0', fontSize: '8.5px', color: '#000000', fontStyle: 'italic', background: '#ffffff', padding: '1.5mm', borderRadius: '1.5mm', minHeight: '8mm', border: '1.5px solid #000000' }}>{data.notesClean || 'Sin observaciones registradas para este turno.'}</p>
          </div>
          <div style={{ background: '#ffffff', padding: '2mm 3mm', borderRadius: '3mm', border: '2px solid #000000', display: 'flex', flexDirection: 'column', justifyContent: 'center', color: '#000000' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1mm', fontSize: '9px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 'bold' }}>TOTAL ESPERADO:</span>
                <span style={{ fontSize: '7px' }}>(Efectivo + Tarjetas/QR)</span>
              </div>
              <span style={{ fontWeight: 'bold' }}>{fmt(totalExpected)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5mm', fontSize: '9px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 'bold' }}>TOTAL DECLARADO:</span>
                <span style={{ fontSize: '7px' }}>(Billetes + Tarjetas/QR)</span>
              </div>
              <span style={{ fontWeight: 'bold' }}>{fmt(totalDeclared)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px double #000000', paddingTop: '1.5mm', fontSize: '11.5px', fontWeight: 'bold' }}>
              <span>DESVIACIÓN NETO:</span>
              <span>{differenceTotal > 0 ? '+' : ''}{fmt(differenceTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
