interface TicketReceiptProps {
  createdSale: any;
  storeName: string;
  /** Comprobante fiscal, si la venta se facturó */
  invoice?: any | null;
  /** QR del comprobante ya dibujado como imagen */
  invoiceQr?: string | null;
  pickedUpBy?: string;
  formatPrice: (n: number) => string;
}

/**
 * El ticket de 80mm.
 *
 * Se usa dos veces con el mismo contenido: una escondida, que es la que se manda a la
 * impresora, y otra a la vista como previsualización. Un solo componente para las dos
 * evita que lo que se ve en pantalla y lo que sale en papel se separen con el tiempo.
 */
export default function TicketReceipt({ createdSale, storeName, invoice, invoiceQr, pickedUpBy, formatPrice }: TicketReceiptProps) {
  return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', fontFamily: 'monospace', fontSize: '8pt', color: '#000', gap: '8px' }}>
        
        {/* Título y datos del emisor: salen de la configuración fiscal, nunca inventados */}
        <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <h4 style={{ margin: 0, fontSize: '10.5pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
            {invoice?.emisor?.razonSocial || storeName}
          </h4>
          {invoice?.emisor?.cuit && (
            <>
              <p style={{ margin: 0, fontWeight: 'bold' }}>C.U.I.T. N° {invoice.emisor.cuit}</p>
              <p style={{ margin: 0 }}>Punto de Venta N° {String(invoice.pointOfSale ?? invoice.emisor.pointOfSale).padStart(5, '0')}</p>
              <p style={{ margin: 0, fontWeight: 'bold', textTransform: 'uppercase' }}>
                {invoice.emisor.ivaCondition === 'RESPONSABLE_INSCRIPTO' ? 'RESPONSABLE INSCRIPTO' : 'RESPONSABLE MONOTRIBUTO'}
              </p>
            </>
          )}
        </div>

        {/* Datos del comprobante. Sin CAE no es una factura y el ticket tiene que decirlo. */}
        <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 'bold' }}>
          {invoice ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>COMPROBANTE:</span>
                <span>{(invoice.type || '').replace('FACTURA_', 'Factura ')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>N° COMP.:</span>
                <span>{String(invoice.pointOfSale ?? 0).padStart(4, '0')}-{String(invoice.number ?? 0).padStart(8, '0')}</span>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', border: '1px solid #000', padding: '3px 0', fontSize: '7.5pt' }}>
              DOCUMENTO NO VÁLIDO COMO FACTURA
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>TICKET INTERNO:</span>
            <span>#{createdSale.saleNumber.toString().padStart(6, '0')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>FECHA:</span>
            <span>{new Date(createdSale.createdAt).toLocaleDateString('es-AR')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>HORA:</span>
            <span>{new Date(createdSale.createdAt).toLocaleTimeString('es-AR')}</span>
          </div>
          {invoice?.receptor && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'normal', marginTop: '3px' }}>
              <span>CLIENTE:</span>
              <span style={{ textAlign: 'right' }}>
                {invoice.receptor.name || 'Consumidor Final'}
                {invoice.receptor.docNro && invoice.receptor.docNro !== '0'
                  ? ` (${invoice.receptor.docTipo === 80 ? 'CUIT' : 'DNI'} ${invoice.receptor.docNro})`
                  : ''}
              </span>
            </div>
          )}
        </div>

        {/* Items Section */}
        <div style={{ borderBottom: '1px dashed #000', paddingBottom: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
            <span style={{ width: '55%' }}>DETALLE</span>
            <span style={{ width: '20%', textAlign: 'center' }}>CANT.</span>
            <span style={{ width: '25%', textAlign: 'right' }}>TOTAL</span>
          </div>
          {createdSale.items.map((item: any, idx: number) => (
            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ width: '55%', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.productName}
              </span>
              <span style={{ width: '20%', textAlign: 'center' }}>{item.quantity.toFixed(1)}</span>
              <span style={{ width: '25%', textAlign: 'right' }}>{formatPrice(item.total)}</span>
            </div>
          ))}
        </div>

        {/* Totales. El IVA se discrimina sólo en la factura A, que es donde corresponde. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontWeight: 'bold', fontSize: '9pt' }}>
          {invoice?.type === 'FACTURA_A' && invoice?.neto != null && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>NETO GRAVADO:</span>
                <span>{formatPrice(invoice.neto)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7.5pt', color: '#555' }}>
                <span>IVA:</span>
                <span>{formatPrice(invoice.iva || 0)}</span>
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5pt', fontWeight: '900', borderTop: '1px dashed #000', paddingTop: '4px', color: '#0E6E52' }}>
            <span>TOTAL:</span>
            <span>{formatPrice(createdSale.total)}</span>
          </div>
        </div>

        {/* CAE y QR: sin esto el comprobante no cumple */}
        {invoice?.cae && (
          <div style={{ borderTop: '1px dashed #000', paddingTop: '6px', display: 'flex', gap: '6px', alignItems: 'center' }}>
            {invoiceQr && <img src={invoiceQr} alt="QR" style={{ width: '22mm', height: '22mm' }} />}
            <div style={{ flex: 1, fontSize: '7.5pt', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ fontWeight: 'bold' }}>CAE N°: {invoice.cae}</div>
              <div>Vto. CAE: {invoice.caeExpiresAt ? new Date(invoice.caeExpiresAt).toLocaleDateString('es-AR') : '—'}</div>
              {invoice.emisor?.environment === 'HOMOLOGACION' && (
                <div style={{ fontWeight: 'bold', border: '1px solid #000', padding: '2px', textAlign: 'center', marginTop: '2px' }}>
                  COMPROBANTE DE PRUEBA · SIN VALIDEZ FISCAL
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Text */}
        <p style={{ margin: 0, fontSize: '7pt', textAlign: 'center', borderTop: '1px dashed #000', paddingTop: '8px', fontWeight: 'bold' }}>
          ¡Muchas gracias por su compra! - {storeName}
        </p>

        {pickedUpBy && (
          <div style={{ borderTop: '1px dashed #000', paddingTop: '6px', fontSize: '7.5pt' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
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
