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

const th = { textAlign: 'left', padding: '5px 6px', borderBottom: '1.5px solid #000', fontSize: '8.5pt', textTransform: 'uppercase', letterSpacing: '0.03em' } as const;
const td = { padding: '6px', borderBottom: '1px solid #d4d4d4', fontSize: '10pt', verticalAlign: 'top' } as const;
const right = { textAlign: 'right' } as const;

/** Presupuesto en una hoja A4 */
export function QuoteSheet({ quote, emisor, paper }: { quote: any; emisor: Emisor; paper?: boolean }) {
  const gross = (quote.total || 0) + (quote.discount || 0);
  return (
    <section data-sheet="presupuesto" style={{
      width: '100%', color: '#000', background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', boxSizing: 'border-box',
      ...(paper ? { width: '210mm', minHeight: '297mm', padding: '14mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px', margin: '0 auto' } : {}),
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderBottom: '1.5px solid #000', paddingBottom: '8px' }}>
        <div>
          <div style={{ fontSize: '16pt', fontWeight: 800 }}>{emisor.name}</div>
          {emisor.razonSocial && emisor.razonSocial !== emisor.name && <div style={{ fontSize: '9pt' }}>{emisor.razonSocial}</div>}
          <div style={{ fontSize: '9pt' }}>{[emisor.domicilio, emisor.phone && `Tel. ${emisor.phone}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '14pt', fontWeight: 800 }}>PRESUPUESTO</div>
          <div style={{ fontSize: '11pt', fontWeight: 700 }}>{quote.quoteNumber}</div>
          <div style={{ fontSize: '8pt', marginTop: '2px' }}>No válido como factura</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '10pt', marginTop: '10px' }}>
        <div><b>Cliente:</b> {quote.clientName || '—'}</div>
        <div><b>Teléfono:</b> {quote.clientPhone || '—'}</div>
        <div><b>Fecha:</b> {day(quote.createdAt)}</div>
        <div><b>Válido hasta:</b> {day(quote.validUntil)}</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '14px' }}>
        <thead>
          <tr>
            <th style={th}>Trabajo / artículo</th>
            <th style={{ ...th, ...right, width: '60px' }}>Cant.</th>
            <th style={{ ...th, ...right, width: '95px' }}>Precio</th>
            <th style={{ ...th, ...right, width: '100px' }}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {(quote.items || []).map((it: any) => (
            <tr key={it.id}>
              <td style={td}>
                <div style={{ fontWeight: 700 }}>{it.productName || it.product?.name || 'Item'}</div>
                {it.specs && <div style={{ fontSize: '9pt', whiteSpace: 'pre-wrap' }}>{it.specs}</div>}
              </td>
              <td style={{ ...td, ...right }}>{qty(it.quantity)}</td>
              <td style={{ ...td, ...right }}>{money(it.unitPrice)}</td>
              <td style={{ ...td, ...right, fontWeight: 700 }}>{money(it.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '10.5pt', minWidth: '66mm' }}>
          <tbody>
            {quote.discount > 0 && (
              <>
                <tr><td style={{ padding: '2px 6px' }}>Subtotal</td><td style={{ padding: '2px 6px', ...right }}>{money(gross)}</td></tr>
                <tr><td style={{ padding: '2px 6px' }}>Descuento</td><td style={{ padding: '2px 6px', ...right }}>- {money(quote.discount)}</td></tr>
              </>
            )}
            <tr><td style={{ padding: '5px 6px', borderTop: '1.5px solid #000', fontWeight: 800 }}>TOTAL</td><td style={{ padding: '5px 6px', borderTop: '1.5px solid #000', ...right, fontWeight: 800 }}>{money(quote.total)}</td></tr>
          </tbody>
        </table>
      </div>

      {quote.notes && <div style={{ fontSize: '9.5pt', marginTop: '12px', whiteSpace: 'pre-wrap' }}><b>Notas:</b> {quote.notes}</div>}
      <div style={{ marginTop: '14px', fontSize: '8pt', color: '#444' }}>Los precios están sujetos a variación sin previo aviso pasada la fecha de validez.</div>
      <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '7pt', color: '#888' }}>Sistema Ventra · ventra.store</div>
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
