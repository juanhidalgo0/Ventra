import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import DocumentPreview from '../common/DocumentPreview';
import { loadEmisor, MissingStoreNameError, type Emisor } from './SalesNoteSheet';
import { waNumber } from '../workorders/workOrderUtils';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const day = (d: any) => (d ? new Date(d).toLocaleDateString('es-AR') : '—');

export const storeNameOfQuote = () => (localStorage.getItem('gd_store_name') || '').trim();

/** Mensaje de WhatsApp con el presupuesto, al teléfono del cliente si lo tiene */
export function quoteWhatsappUrl(quote: any) {
  const store = storeNameOfQuote();
  const lines = [
    `*PRESUPUESTO${store ? ` - ${store.toUpperCase()}` : ''}*`,
    `N° ${quote.quoteNumber}`,
    `Cliente: ${quote.clientName}`,
    `Fecha: ${day(quote.createdAt)}`,
    `Válido hasta: ${day(quote.validUntil)}`,
    '--------------------------------',
    ...(quote.items || []).flatMap((i: any) => [
      `• ${i.quantity}x ${i.productName || i.product?.name || 'Item'} - $${Number(i.subtotal).toLocaleString('es-AR')}`,
      ...(i.specs ? [`   ${i.specs}`] : []),
    ]),
    '--------------------------------',
    ...(quote.discount > 0 ? [`Descuento: -$${Number(quote.discount).toLocaleString('es-AR')}`] : []),
    `*TOTAL: $${Number(quote.total).toLocaleString('es-AR')}*`,
  ];
  if (quote.notes) lines.push(`Notas: ${quote.notes}`);
  lines.push('\nPrecios sujetos a modificaciones sin previo aviso.');
  const phone = waNumber(quote.clientPhone);
  return `https://api.whatsapp.com/send?${phone ? `phone=${phone}&` : ''}text=${encodeURIComponent(lines.join('\n'))}`;
}

// Colores de la hoja: tinta oscura, un gris para lo secundario y un fondo muy suave para las
// bandas (se ven bien en pantalla, en el PDF y en una impresora en blanco y negro)
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const BAND = '#f3f4f6';
const ACCENT = '#1f2937';
const label = { fontSize: '7pt', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED } as const;
const cell = { padding: '7px 8px', fontSize: '9.5pt', verticalAlign: 'top', borderBottom: `1px solid ${LINE}` } as const;
const headCell = { padding: '7px 8px', fontSize: '7.5pt', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fff', background: ACCENT, textAlign: 'left' } as const;
const right = { textAlign: 'right' } as const;
const isService = (it: any) => it.productId === 'SERVICIO' || it.product?.id === 'SERVICIO';

/** Renglones de una sección de la tabla (productos o servicios), numerados desde `from` */
function QuoteRows({ items, from }: { items: any[]; from: number }) {
  return (
    <>
      {items.map((it: any, i: number) => (
        <tr key={it.id || i} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
          <td style={{ ...cell, color: MUTED, width: '26px' }}>{from + i}</td>
          <td style={cell}>
            <div style={{ fontWeight: 600, color: INK }}>{it.productName || it.product?.name || 'Item'}</div>
            {it.specs && <div style={{ fontSize: '8.5pt', color: MUTED, whiteSpace: 'pre-wrap', marginTop: '2px' }}>{it.specs}</div>}
          </td>
          <td style={{ ...cell, ...right }}>{qty(it.quantity)}</td>
          <td style={{ ...cell, ...right, color: '#374151' }}>{money(it.unitPrice)}</td>
          <td style={{ ...cell, ...right, fontWeight: 700, color: INK }}>{money(it.subtotal)}</td>
        </tr>
      ))}
    </>
  );
}

/** Presupuesto en una hoja A4: con el logo y los datos del comercio, listo para mandar al cliente */
export function QuoteSheet({ quote, emisor, paper }: { quote: any; emisor: Emisor; paper?: boolean }) {
  const items: any[] = quote.items || [];
  const products = items.filter((it) => !isService(it));
  const services = items.filter(isService);
  const productsTotal = products.reduce((t, it) => t + (Number(it.subtotal) || 0), 0);
  const servicesTotalAmount = services.reduce((t, it) => t + (Number(it.subtotal) || 0), 0);
  const gross = (quote.total || 0) + (quote.discount || 0);
  const sections = products.length > 0 && services.length > 0;
  const contact = [emisor.domicilio, emisor.phone && `Tel. ${emisor.phone}`].filter(Boolean);
  const fiscal = [emisor.cuit && `CUIT ${emisor.cuit}`, emisor.iibb && `IIBB ${emisor.iibb}`].filter(Boolean);
  const sectionRow = (title: string) => (
    <tr>
      <td colSpan={5} style={{ padding: '9px 8px 5px', fontSize: '7.5pt', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT, borderBottom: `1.5px solid ${ACCENT}` }}>{title}</td>
    </tr>
  );

  return (
    <section data-sheet="presupuesto" style={{
      width: '100%', color: INK, background: '#fff', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      ...(paper ? { width: '210mm', minHeight: '297mm', padding: '15mm 16mm 12mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px', margin: '0 auto' } : {}),
    } as any}>
      {/* Encabezado: el comercio (con su logo) y el número del presupuesto */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          {emisor.logo && <img src={emisor.logo} alt="" style={{ width: 'auto', height: 'auto', maxWidth: '50mm', maxHeight: '22mm', objectFit: 'contain', flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: emisor.logo ? '14pt' : '18pt', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{emisor.name}</div>
            {emisor.razonSocial && emisor.razonSocial !== emisor.name && <div style={{ fontSize: '8.5pt', color: '#374151', marginTop: '2px' }}>{emisor.razonSocial}</div>}
            {contact.length > 0 && <div style={{ fontSize: '8.5pt', color: MUTED, marginTop: '3px' }}>{contact.join('  ·  ')}</div>}
            {fiscal.length > 0 && <div style={{ fontSize: '8pt', color: MUTED, marginTop: '1px' }}>{fiscal.join('  ·  ')}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '20pt', fontWeight: 800, letterSpacing: '0.08em', color: ACCENT, lineHeight: 1 }}>PRESUPUESTO</div>
          <div style={{ fontSize: '11pt', fontWeight: 700, marginTop: '5px' }}>N° {quote.quoteNumber}</div>
          <div style={{ fontSize: '7.5pt', color: MUTED, marginTop: '2px' }}>Documento no válido como factura</div>
        </div>
      </div>

      <div style={{ height: '3px', background: ACCENT, marginTop: '12px' }} />

      {/* Cliente y fechas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', marginTop: '12px' }}>
        <div style={{ background: BAND, borderRadius: '6px', padding: '10px 12px' }}>
          <div style={label}>Preparado para</div>
          <div style={{ fontSize: '12pt', fontWeight: 700, marginTop: '3px' }}>{quote.clientName || '—'}</div>
          {quote.clientPhone && <div style={{ fontSize: '9pt', color: '#374151', marginTop: '2px' }}>Tel. {quote.clientPhone}</div>}
        </div>
        <div style={{ background: BAND, borderRadius: '6px', padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <div style={label}>Fecha</div>
            <div style={{ fontSize: '10pt', fontWeight: 600, marginTop: '3px' }}>{day(quote.createdAt)}</div>
          </div>
          <div>
            <div style={label}>Válido hasta</div>
            <div style={{ fontSize: '10pt', fontWeight: 600, marginTop: '3px' }}>{day(quote.validUntil)}</div>
          </div>
        </div>
      </div>

      {/* Detalle */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
        <thead>
          <tr>
            <th style={{ ...headCell, width: '26px', borderTopLeftRadius: '4px' }}>#</th>
            <th style={headCell}>Descripción</th>
            <th style={{ ...headCell, ...right, width: '52px' }}>Cant.</th>
            <th style={{ ...headCell, ...right, width: '92px' }}>P. unitario</th>
            <th style={{ ...headCell, ...right, width: '98px', borderTopRightRadius: '4px' }}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {sections && sectionRow('Productos')}
          <QuoteRows items={products} from={1} />
          {sections && sectionRow('Servicios')}
          <QuoteRows items={services} from={products.length + 1} />
        </tbody>
      </table>

      {/* Totales */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginTop: '14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {quote.notes && (
            <div style={{ border: `1px solid ${LINE}`, borderRadius: '6px', padding: '9px 12px' }}>
              <div style={label}>Observaciones</div>
              <div style={{ fontSize: '9pt', color: '#374151', marginTop: '4px', whiteSpace: 'pre-wrap' }}>{quote.notes}</div>
            </div>
          )}
        </div>
        <div style={{ width: '74mm', flexShrink: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt' }}>
            <tbody>
              {sections && (
                <>
                  <tr><td style={{ padding: '3px 8px', color: MUTED }}>Productos</td><td style={{ padding: '3px 8px', ...right }}>{money(productsTotal)}</td></tr>
                  <tr><td style={{ padding: '3px 8px', color: MUTED }}>Servicios</td><td style={{ padding: '3px 8px', ...right }}>{money(servicesTotalAmount)}</td></tr>
                </>
              )}
              {quote.discount > 0 && (
                <>
                  {!sections && <tr><td style={{ padding: '3px 8px', color: MUTED }}>Subtotal</td><td style={{ padding: '3px 8px', ...right }}>{money(gross)}</td></tr>}
                  <tr><td style={{ padding: '3px 8px', color: MUTED }}>Descuento</td><td style={{ padding: '3px 8px', ...right }}>- {money(quote.discount)}</td></tr>
                </>
              )}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', background: ACCENT, color: '#fff', borderRadius: '6px', padding: '9px 12px', marginTop: '6px' }}>
            <span style={{ fontSize: '8.5pt', fontWeight: 700, letterSpacing: '0.12em' }}>TOTAL</span>
            <span style={{ fontSize: '15pt', fontWeight: 800 }}>{money(quote.total)}</span>
          </div>
        </div>
      </div>

      {/* Condiciones y pie: en la hoja del PDF queda abajo de todo */}
      <div style={{ marginTop: paper ? 'auto' : '18px', paddingTop: '18px' }}>
        <div style={{ fontSize: '8pt', color: MUTED, lineHeight: 1.5 }}>
          Presupuesto válido hasta el {day(quote.validUntil)}. Pasada esa fecha, los precios pueden cambiar sin previo aviso.
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: `1px solid ${LINE}`, marginTop: '10px', paddingTop: '7px', fontSize: '7.5pt', color: '#9ca3af' }}>
          <span>{[emisor.name, ...contact].join('  ·  ')}</span>
          <span style={{ flexShrink: 0 }}>Hecho con Ventra · ventra.store</span>
        </div>
      </div>
    </section>
  );
}

/** Vista previa de la hoja A4, con imprimir, PDF y WhatsApp */
export function QuotePreview({ quote, onClose }: { quote: any; onClose: () => void }) {
  const [emisor, setEmisor] = useState<Emisor | null>(null);
  useEffect(() => {
    loadEmisor().then(setEmisor).catch((err) => {
      toast.error(err instanceof MissingStoreNameError ? 'Cargá el nombre del comercio en Configuración para imprimir' : 'No se pudo armar el presupuesto');
      onClose();
    });
  }, []);
  if (!emisor) return null;
  return (
    <DocumentPreview
      title="Presupuesto"
      subtitle={`${quote.quoteNumber} · ${quote.clientName || ''}`}
      fileName={`Presupuesto_${quote.quoteNumber}`}
      whatsapp={{ phone: quote.clientPhone, text: `Presupuesto ${quote.quoteNumber}, válido hasta el ${day(quote.validUntil)}.` }}
      render={(paper) => <QuoteSheet quote={quote} emisor={emisor} paper={paper} />}
      onClose={onClose}
    />
  );
}

/**
 * Lo que se le pasa al editor de encargos. Si el presupuesto tenía descuento, se reparte entre los
 * renglones para que el encargo dé el mismo total (salvo con los precios de hoy, que no lo llevan).
 */
export function quoteToWorkOrderDraft(quote: any, todayPrices = false) {
  const gross = (quote.total || 0) + (quote.discount || 0);
  const factor = !todayPrices && quote.discount > 0 && gross > 0 ? quote.total / gross : 1;
  return {
    clientName: quote.clientName === 'Cliente Ocasional' ? '' : quote.clientName,
    clientPhone: quote.clientPhone || '',
    quoteId: quote.id,
    notes: [`Presupuesto ${quote.quoteNumber}`, quote.notes].filter(Boolean).join('. '),
    items: (quote.items || []).map((i: any) => {
      const today = todayPrices && i.product ? Number(i.product.salePrice) : null;
      return {
        productId: i.product && i.product.id !== 'VENTA_RAPIDA' ? i.product.id : null,
        description: i.productName || i.product?.name || '',
        specs: i.specs || '',
        quantity: String(i.quantity),
        unitPrice: String(today ?? Math.round(i.unitPrice * factor * 100) / 100),
      };
    }),
  };
}
