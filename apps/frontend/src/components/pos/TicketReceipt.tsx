import { isOrderNote } from './gastro';
interface TicketReceiptProps {
  createdSale: any;
  storeName: string;
  /** Comprobante fiscal (factura o nota de crédito), si la venta se facturó */
  invoice?: any | null;
  /** QR del comprobante ya dibujado como imagen */
  invoiceQr?: string | null;
  pickedUpBy?: string;
  /** Reimpresión: lo dice en el papel en vez de "ORIGINAL" */
  reprint?: boolean;
  formatPrice: (n: number) => string;
}

const IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTO: 'Responsable Monotributo',
  EXENTO: 'IVA Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_CATEGORIZADO: 'Sujeto no categorizado',
};
const DOC_LABEL: Record<number, string> = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI' };

/** AAAA-MM-DD → DD/MM/AAAA sin pasar por Date (evita correrse de día por el huso) */
const fechaAr = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const cuitAr = (c?: string | null) => {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
};
const nro = (pv: number, n: number) => `${String(pv ?? 0).padStart(5, '0')}-${String(n ?? 0).padStart(8, '0')}`;

/**
 * El ticket de 80 mm.
 *
 * Se usa dos veces con el mismo contenido: una escondida, que es la que se manda a la
 * impresora, y otra a la vista como previsualización. Un solo componente para las dos
 * evita que lo que se ve en pantalla y lo que sale en papel se separen con el tiempo.
 *
 * Con comprobante fiscal lleva lo que pide ARCA (RG 1415 y RG 4892): datos del emisor,
 * letra y código del comprobante, receptor, IVA discriminado en la A, "IVA contenido" en
 * la B (Ley 27.743), CAE con su vencimiento y el QR. Sin CAE, dice que no es factura.
 */
export default function TicketReceipt({ createdSale, storeName, invoice, invoiceQr, pickedUpBy, reprint, formatPrice }: TicketReceiptProps) {
  const fiscal = invoice && invoice.status === 'AUTHORIZED' && invoice.cae ? invoice : null;
  const emisor = fiscal?.emisor;
  const letra: string = fiscal?.letter || (fiscal?.type || '').slice(-1);
  const esNota = fiscal?.kind === 'NOTA_CREDITO' || String(fiscal?.type || '').startsWith('NC_');
  const esA = letra === 'A';
  const esB = letra === 'B';
  const lines: any[] = fiscal?.lines?.length ? fiscal.lines : createdSale.items;
  const excluded: any[] = fiscal?.excludedLines || [];
  const total = fiscal ? fiscal.total : createdSale.total;
  const neto = (l: any) => (l.rate ? l.total / (1 + l.rate / 100) : l.total);

  const row = { display: 'flex', justifyContent: 'space-between', gap: '6px' } as const;
  const dashed = { borderBottom: '1px dashed #000', paddingBottom: '6px' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', fontFamily: 'monospace', fontSize: '8pt', color: '#000', gap: '7px' }}>

      {/* Emisor: sale de la configuración fiscal, nunca inventado */}
      <div style={{ ...dashed, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <h4 style={{ margin: 0, fontSize: '10.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
          {emisor?.razonSocial || storeName}
        </h4>
        {emisor && (
          <>
            {emisor.domicilio && <p style={{ margin: 0 }}>{emisor.domicilio}</p>}
            <p style={{ margin: 0, fontWeight: 'bold' }}>C.U.I.T.: {cuitAr(emisor.cuit)}</p>
            {emisor.iibb && <p style={{ margin: 0 }}>Ing. Brutos: {emisor.iibb}</p>}
            {emisor.inicioActividades && <p style={{ margin: 0 }}>Inicio de actividades: {fechaAr(emisor.inicioActividades)}</p>}
            <p style={{ margin: 0, fontWeight: 'bold', textTransform: 'uppercase' }}>{IVA_LABEL[emisor.ivaCondition] || emisor.ivaCondition}</p>
          </>
        )}
      </div>

      {/* Comprobante */}
      <div style={{ ...dashed, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {fiscal ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ border: '2px solid #000', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16pt', fontWeight: 900, flexShrink: 0 }}>
                {letra}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 'bold', fontSize: '9.5pt' }}>{esNota ? 'NOTA DE CRÉDITO' : 'FACTURA'}</span>
                <span style={{ fontSize: '7pt' }}>COD. {String(fiscal.cbteTipo ?? '').padStart(3, '0')}</span>
              </div>
              <span style={{ fontSize: '7pt', fontWeight: 'bold' }}>{reprint ? 'REIMPRESIÓN' : 'ORIGINAL'}</span>
            </div>
            <div style={{ ...row, fontWeight: 'bold' }}>
              <span>Pto. Vta.-N°:</span>
              <span>{nro(fiscal.pointOfSale, fiscal.number)}</span>
            </div>
            <div style={row}>
              <span>Fecha de emisión:</span>
              <span>{fechaAr(fiscal.issueDate || fiscal.date)}</span>
            </div>
            {esNota && fiscal.assoc && (
              <div style={{ ...row, fontSize: '7.5pt' }}>
                <span>Anula:</span>
                <span style={{ textAlign: 'right' }}>
                  {(fiscal.assoc.type || '').replace('FACTURA_', 'Factura ')} {nro(fiscal.assoc.pointOfSale, fiscal.assoc.number)} del {fechaAr(fiscal.assoc.issueDate)}
                </span>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', border: '1px solid #000', padding: '3px 0', fontSize: '7.5pt', fontWeight: 'bold' }}>
            {reprint ? 'REIMPRESIÓN · ' : ''}DOCUMENTO NO VÁLIDO COMO FACTURA
          </div>
        )}
        <div style={{ ...row, fontSize: '7.5pt' }}>
          <span>Ticket interno #{String(createdSale.saleNumber ?? '').padStart(6, '0')}</span>
          <span>{createdSale.createdAt ? new Date(createdSale.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
        </div>
      </div>

      {/* Gastronomía: tipo de pedido bien grande (Mesa 4 / Para llevar / Delivery) */}
      {isOrderNote(createdSale.notes) && (
        <div style={{ border: '2px solid #000', padding: '4px 6px', margin: '4px 0' }}>
          <div style={{ textAlign: 'center', fontSize: '12pt', fontWeight: 'bold' }}>{String(createdSale.notes).split('\n')[0]}</div>
          {/* Aclaraciones de la comanda ("1x Pizza muzzarella: sin aceitunas") */}
          {String(createdSale.notes).split('\n').slice(1).map((line: string, i: number) => (
            <div key={i} style={{ fontSize: '7.5pt', fontWeight: 'bold', marginTop: '2px' }}>» {line}</div>
          ))}
        </div>
      )}

      {/* Receptor */}
      {fiscal?.receptor && (
        <div style={{ ...dashed, display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <div style={row}>
            <span>Cliente:</span>
            <span style={{ textAlign: 'right', fontWeight: 'bold' }}>{fiscal.receptor.name || 'Consumidor Final'}</span>
          </div>
          {fiscal.receptor.docNro && fiscal.receptor.docNro !== '0' && (
            <div style={row}>
              <span>{DOC_LABEL[fiscal.receptor.docTipo] || 'Doc.'}:</span>
              <span>{fiscal.receptor.docTipo === 80 ? cuitAr(fiscal.receptor.docNro) : fiscal.receptor.docNro}</span>
            </div>
          )}
          <div style={row}>
            <span>Cond. IVA:</span>
            <span>{IVA_LABEL[fiscal.receptor.ivaCondition] || 'Consumidor Final'}</span>
          </div>
        </div>
      )}

      {/* Detalle. En la A los importes van sin IVA, que se discrimina abajo */}
      <div style={{ ...dashed, display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ ...row, fontWeight: 'bold' }}>
          <span style={{ width: '55%' }}>DETALLE</span>
          <span style={{ width: '17%', textAlign: 'center' }}>CANT.</span>
          <span style={{ width: '28%', textAlign: 'right' }}>{esA ? 'NETO' : 'IMPORTE'}</span>
        </div>
        {lines.map((item: any, idx: number) => (
          <div key={idx}>
            <div style={row}>
              <span style={{ width: '55%', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.productName || item.name}
              </span>
              <span style={{ width: '17%', textAlign: 'center' }}>{Number(item.quantity).toLocaleString('es-AR', { maximumFractionDigits: 3 })}</span>
              <span style={{ width: '28%', textAlign: 'right' }}>{formatPrice(esA ? neto(item) : item.total)}</span>
            </div>
            {esA && item.rate ? <div style={{ fontSize: '6.5pt', color: '#444' }}>IVA {String(item.rate).replace('.', ',')}%</div> : null}
          </div>
        ))}
      </div>

      {/* Totales */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 'bold', fontSize: '9pt' }}>
        {esA && (
          <>
            <div style={row}>
              <span>Neto gravado:</span>
              <span>{formatPrice(fiscal.neto)}</span>
            </div>
            {(fiscal.ivaDetail || []).map((l: any) => (
              <div key={l.rate} style={{ ...row, fontSize: '8pt' }}>
                <span>IVA {String(l.rate).replace('.', ',')}%:</span>
                <span>{formatPrice(l.amount)}</span>
              </div>
            ))}
          </>
        )}
        <div style={{ ...row, fontSize: '10pt', fontWeight: 900, borderTop: '1px dashed #000', paddingTop: '4px' }}>
          <span>TOTAL:</span>
          <span>{formatPrice(total)}</span>
        </div>

        {/* Ley 27.743: el IVA que el consumidor paga dentro del precio */}
        {esB && (
          <div style={{ border: '1px solid #000', padding: '3px 4px', marginTop: '3px', fontSize: '7pt', fontWeight: 'normal', display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontWeight: 'bold' }}>Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</span>
            <div style={row}><span>IVA contenido:</span><span>{formatPrice(fiscal.iva || 0)}</span></div>
            <div style={row}><span>Otros impuestos nacionales indirectos:</span><span>{formatPrice(0)}</span></div>
          </div>
        )}

        {/* Lo que se cobró pero no es venta propia (pagos de cuenta, cargas virtuales) */}
        {fiscal && excluded.length > 0 && (
          <div style={{ borderTop: '1px dashed #000', paddingTop: '4px', marginTop: '3px', fontSize: '7.5pt', fontWeight: 'normal', display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <span style={{ fontWeight: 'bold' }}>Otros conceptos (no incluidos en el comprobante):</span>
            {excluded.map((l: any, i: number) => (
              <div key={i} style={row}><span style={{ textTransform: 'uppercase' }}>{l.name}</span><span>{formatPrice(l.total)}</span></div>
            ))}
            <div style={{ ...row, fontWeight: 'bold', fontSize: '8.5pt' }}>
              <span>TOTAL COBRADO:</span>
              <span>{formatPrice(createdSale.total)}</span>
            </div>
          </div>
        )}
      </div>

      {/* CAE y QR: sin esto el comprobante no cumple */}
      {fiscal && (
        <div style={{ borderTop: '1px dashed #000', paddingTop: '6px', display: 'flex', gap: '6px', alignItems: 'center' }}>
          {invoiceQr && <img src={invoiceQr} alt="QR" style={{ width: '24mm', height: '24mm' }} />}
          <div style={{ flex: 1, fontSize: '7.5pt', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ fontWeight: 'bold' }}>CAE N°: {fiscal.cae}</div>
            <div>Vto. CAE: {fiscal.caeExpiresAt ? new Date(fiscal.caeExpiresAt).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—'}</div>
            <div style={{ fontSize: '6.5pt' }}>Comprobante autorizado por ARCA</div>
            {(fiscal.environment || emisor?.environment) === 'HOMOLOGACION' && (
              <div style={{ fontWeight: 'bold', border: '1px solid #000', padding: '2px', textAlign: 'center', marginTop: '2px' }}>
                COMPROBANTE DE PRUEBA · SIN VALIDEZ FISCAL
              </div>
            )}
          </div>
        </div>
      )}

      <p style={{ margin: 0, fontSize: '7pt', textAlign: 'center', borderTop: '1px dashed #000', paddingTop: '8px', fontWeight: 'bold' }}>
        ¡Muchas gracias por su compra! - {storeName}
      </p>

      {pickedUpBy && (
        <div style={{ borderTop: '1px dashed #000', paddingTop: '6px', fontSize: '7.5pt' }}>
          <div style={{ ...row, marginBottom: '8px' }}>
            <span style={{ fontWeight: 'bold' }}>RETIRADO POR:</span>
            <span style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>{pickedUpBy}</span>
          </div>
          <div style={{ borderBottom: '1px solid #000', width: '70%', margin: '18px auto 4px auto' }} />
          <div style={{ textAlign: 'center', fontSize: '6.5pt', color: '#555' }}>Firma y Aclaración de Quien Retira</div>
        </div>
      )}
    </div>
  );
}
