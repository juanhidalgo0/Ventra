import type { Emisor } from '../pos/SalesNoteSheet';

/**
 * Comprobante del encargo para el cliente (orden de trabajo): qué encargó, para cuándo, cuánto
 * dejó de seña y cuánto falta. Una hoja A4 con dos copias: la del cliente y la del local.
 */
const page = { width: '100%', color: '#000', background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', boxSizing: 'border-box' } as const;
const paperStyle = { width: '210mm', minHeight: '297mm', padding: '10mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px' } as const;
const th = { textAlign: 'left', padding: '4px 6px', borderBottom: '1.5px solid #000', fontSize: '8.5pt', textTransform: 'uppercase', letterSpacing: '0.03em' } as const;
const td = { padding: '5px 6px', borderBottom: '1px solid #d4d4d4', fontSize: '9.5pt', verticalAlign: 'top' } as const;
const right = { textAlign: 'right' } as const;

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const date = (d: any) => (d ? new Date(d).toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : 'A convenir');
export const PRIORITY_LABEL: Record<string, string> = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' };

function Copy({ order, emisor, label }: { order: any; emisor: Emisor; label: string }) {
  const rest = Math.max(0, (order.total || 0) - (order.deposit || 0));
  return (
    <div style={{ border: '1px solid #000', padding: '7mm', breakInside: 'avoid' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderBottom: '1.5px solid #000', paddingBottom: '6px' }}>
        <div>
          <div style={{ fontSize: '14pt', fontWeight: 800 }}>{emisor.name}</div>
          {emisor.razonSocial && emisor.razonSocial !== emisor.name && <div style={{ fontSize: '8.5pt' }}>{emisor.razonSocial}</div>}
          <div style={{ fontSize: '8.5pt' }}>{[emisor.domicilio, emisor.phone && `Tel. ${emisor.phone}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12pt', fontWeight: 800 }}>ORDEN DE TRABAJO</div>
          <div style={{ fontSize: '11pt', fontWeight: 700 }}>N° {String(order.number).padStart(6, '0')}</div>
          <div style={{ fontSize: '7.5pt', marginTop: '2px' }}>{label} · No válido como factura</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '9.5pt', marginTop: '6px' }}>
        <div><b>Cliente:</b> {order.client?.name || 'Sin nombre'}</div>
        <div><b>Teléfono:</b> {order.client?.phone || '—'}</div>
        <div><b>Recibido:</b> {date(order.receivedAt)}</div>
        <div><b>Entrega:</b> {date(order.dueAt)}</div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
        <thead>
          <tr>
            <th style={th}>Trabajo</th>
            <th style={{ ...th, ...right, width: '60px' }}>Cant.</th>
            <th style={{ ...th, ...right, width: '90px' }}>Precio</th>
            <th style={{ ...th, ...right, width: '95px' }}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {(order.items || []).map((it: any) => (
            <tr key={it.id}>
              <td style={td}>
                <div style={{ fontWeight: 700 }}>{it.description}</div>
                {it.specs && <div style={{ fontSize: '8.5pt', whiteSpace: 'pre-wrap' }}>{it.specs}</div>}
              </td>
              <td style={{ ...td, ...right }}>{qty(it.quantity)}</td>
              <td style={{ ...td, ...right }}>{money(it.unitPrice)}</td>
              <td style={{ ...td, ...right, fontWeight: 700 }}>{money(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {order.notes && <div style={{ fontSize: '9pt', marginTop: '6px', whiteSpace: 'pre-wrap' }}><b>Notas:</b> {order.notes}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '10pt', minWidth: '62mm' }}>
          <tbody>
            <tr><td style={{ padding: '2px 6px' }}>Total</td><td style={{ padding: '2px 6px', ...right, fontWeight: 700 }}>{money(order.total)}</td></tr>
            <tr><td style={{ padding: '2px 6px' }}>Seña</td><td style={{ padding: '2px 6px', ...right }}>{money(order.deposit)}</td></tr>
            <tr><td style={{ padding: '4px 6px', borderTop: '1.5px solid #000', fontWeight: 800 }}>SALDO A PAGAR</td><td style={{ padding: '4px 6px', borderTop: '1.5px solid #000', ...right, fontWeight: 800 }}>{money(rest)}</td></tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '14mm', fontSize: '8.5pt' }}>
        <div style={{ borderTop: '1px solid #000', paddingTop: '3px' }}>Firma del cliente</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: '3px' }}>Recibió (firma y aclaración)</div>
      </div>
      <div style={{ marginTop: '6px', fontSize: '7.5pt', color: '#444' }}>Presentá este comprobante para retirar tu pedido.</div>
    </div>
  );
}

export function WorkOrderReceipt({ order, emisor, paper }: { order: any; emisor: Emisor; paper?: boolean }) {
  return (
    <section data-sheet="encargo" style={{ ...page, ...(paper ? paperStyle : {}), display: 'flex', flexDirection: 'column', gap: '8mm' }}>
      <Copy order={order} emisor={emisor} label="Copia del cliente" />
      <div style={{ borderTop: '1px dashed #888' }} />
      <Copy order={order} emisor={emisor} label="Copia del local" />
      <div style={{ textAlign: 'center', fontSize: '7pt', color: '#888' }}>Sistema Ventra · ventra.store</div>
    </section>
  );
}
