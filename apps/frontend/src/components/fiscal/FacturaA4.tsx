/**
 * Factura (o nota de crédito) autorizada por ARCA en hoja A4, para la distribuidora: sale con el
 * camión junto al remito. Lleva lo mismo que el ticket de 80 mm (TicketReceipt): datos del
 * emisor, letra y código, receptor, IVA discriminado en la A, "IVA contenido" en la B
 * (Ley 27.743), CAE con su vencimiento y el QR. Además, la condición de venta y el domicilio del
 * cliente, que en la hoja grande se esperan.
 *
 * Los renglones vendidos por bulto se muestran en bultos con el precio del bulto.
 */
import { readStoreLogo } from '../common/StoreLogoField';

const IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTO: 'Responsable Monotributo',
  EXENTO: 'IVA Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_CATEGORIZADO: 'Sujeto no categorizado',
};
const DOC_LABEL: Record<number, string> = { 80: 'C.U.I.T.', 86: 'C.U.I.L.', 96: 'DNI' };

/** AAAA-MM-DD → DD/MM/AAAA sin pasar por Date (evita correrse de día por el huso) */
const fechaAr = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const cuitAr = (c?: string | null) => {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
};
const money = (n: number) => `$ ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 });

const page = { width: '100%', color: '#000', background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', boxSizing: 'border-box' } as const;
const paperStyle = { width: '210mm', minHeight: '297mm', padding: '10mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px' } as const;
const th = { textAlign: 'left', padding: '5px 6px', borderBottom: '1.5px solid #000', fontSize: '8.5pt', textTransform: 'uppercase', letterSpacing: '0.03em' } as const;
const td = { padding: '4px 6px', borderBottom: '1px solid #d4d4d4', fontSize: '9.5pt', verticalAlign: 'top' } as const;
const right = { textAlign: 'right' } as const;
const row = { display: 'flex', justifyContent: 'space-between', gap: '12px' } as const;

export function FacturaA4({ doc, client, storeName, storePhone, qr, copy, condicionVenta, paper }: {
  /** El comprobante tal como lo devuelve /fiscal (documentView), autorizado */
  doc: any;
  /** Cliente del pedido: el domicilio no viaja en el comprobante */
  client?: { address?: string | null; locality?: string | null; phone?: string | null } | null;
  storeName: string;
  storePhone?: string;
  qr?: string | null;
  copy: 'ORIGINAL' | 'DUPLICADO';
  condicionVenta?: string;
  paper?: boolean;
}) {
  const emisor = doc.emisor || {};
  // Logo del comercio para las impresiones (Configuración → Tu comercio), si cargó uno
  const logo = readStoreLogo();
  const letra: string = doc.letter || String(doc.type || '').slice(-1);
  const esNota = doc.kind === 'NOTA_CREDITO' || String(doc.type || '').startsWith('NC_');
  const esA = letra === 'A';
  const esB = letra === 'B';
  const neto = (l: any) => (l.rate ? l.total / (1 + l.rate / 100) : l.total);
  const razonAparte = !!(emisor.razonSocial && emisor.razonSocial.trim().toUpperCase() !== storeName.trim().toUpperCase());
  const domicilio = [client?.address, client?.locality].filter(Boolean).join(', ');
  const receptorDoc = doc.receptor?.docNro && doc.receptor.docNro !== '0'
    ? `${DOC_LABEL[doc.receptor.docTipo] || 'Doc.'} ${doc.receptor.docTipo === 80 ? cuitAr(doc.receptor.docNro) : doc.receptor.docNro}`
    : '';
  const lines = (doc.lines || []).map((l: any) => {
    const pack = Number(l.packSize) > 1 ? Number(l.packSize) : 0;
    const importe = esA ? neto(l) : Number(l.total) || 0;
    const units = Number(l.quantity) || 0;
    return { name: l.name, rate: l.rate, qty: pack ? units / pack : units, unit: pack ? `Bulto x${pack}` : 'Unid.', price: units ? importe / (pack ? units / pack : units) : 0, importe };
  });

  return (
    <section data-sheet="factura" style={{ ...page, ...(paper ? paperStyle : {}) }}>
      {/* Encabezado: emisor | letra | comprobante */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', border: '1.5px solid #000', borderRadius: '4px' }}>
        <div style={{ padding: '10px 12px', display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '9pt' }}>
          {logo && <img src={logo} alt="" style={{ width: 'auto', height: 'auto', maxWidth: '34mm', maxHeight: '20mm', flexShrink: 0 }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <div style={{ fontSize: logo ? '13pt' : '15pt', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.1 }}>{storeName}</div>
            {razonAparte && <div style={{ fontWeight: 600 }}>{emisor.razonSocial}</div>}
            {emisor.domicilio && <div>{emisor.domicilio}</div>}
            {storePhone && <div>Tel.: {storePhone}</div>}
            <div style={{ fontWeight: 600 }}>{IVA_LABEL[emisor.ivaCondition] || emisor.ivaCondition}</div>
          </div>
        </div>
        <div style={{ borderLeft: '1.5px solid #000', borderRight: '1.5px solid #000', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '6px' }}>
          <div style={{ fontSize: '28pt', fontWeight: 900, lineHeight: 1 }}>{letra}</div>
          <div style={{ fontSize: '7pt', fontWeight: 700, marginTop: '4px' }}>COD. {String(doc.cbteTipo ?? '').padStart(3, '0')}</div>
        </div>
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9pt' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '14pt', fontWeight: 800 }}>{esNota ? 'NOTA DE CRÉDITO' : 'FACTURA'}</span>
            <span style={{ fontSize: '7.5pt', fontWeight: 700 }}>{copy}</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: '10.5pt' }}>
            Punto de venta: {String(doc.pointOfSale ?? 0).padStart(5, '0')} · Comp. N°: {String(doc.number ?? 0).padStart(8, '0')}
          </div>
          <div>Fecha de emisión: {fechaAr(doc.issueDate || doc.date)}</div>
          <div>C.U.I.T.: {cuitAr(emisor.cuit)}</div>
          {emisor.iibb && <div>Ing. Brutos: {emisor.iibb}</div>}
          {emisor.inicioActividades && <div>Inicio de actividades: {fechaAr(emisor.inicioActividades)}</div>}
        </div>
      </div>

      {esNota && doc.assoc && (
        <div style={{ marginTop: '6px', fontSize: '9pt' }}>
          Comprobante asociado: {String(doc.assoc.type || '').replace('FACTURA_', 'Factura ')} {String(doc.assoc.pointOfSale ?? 0).padStart(5, '0')}-{String(doc.assoc.number ?? 0).padStart(8, '0')} del {fechaAr(doc.assoc.issueDate)}
        </div>
      )}

      {/* Receptor */}
      <div style={{ border: '1px solid #000', borderRadius: '4px', padding: '8px 12px', marginTop: '8px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '3px 18px', fontSize: '9.5pt' }}>
        <div style={{ gridColumn: '1 / -1' }}><b>Cliente:</b> <span style={{ fontWeight: 700 }}>{doc.receptor?.name || 'Consumidor Final'}</span></div>
        {receptorDoc && <div>{receptorDoc}</div>}
        <div><b>Cond. IVA:</b> {IVA_LABEL[doc.receptor?.ivaCondition] || 'Consumidor Final'}</div>
        {domicilio && <div><b>Domicilio:</b> {domicilio}</div>}
        {condicionVenta && <div><b>Condición de venta:</b> {condicionVenta}</div>}
        <div><b>Remito N°:</b> {String(doc.saleNumber ?? '').padStart(8, '0')}</div>
      </div>

      {/* Detalle. En la A los importes van sin IVA, que se discrimina abajo */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
        <thead>
          <tr>
            <th style={{ ...th, ...right, width: '60px' }}>Cant.</th>
            <th style={{ ...th, width: '78px' }}>Unidad</th>
            <th style={th}>Descripción</th>
            <th style={{ ...th, ...right, width: '96px' }}>{esA ? 'P. unit. neto' : 'P. unitario'}</th>
            {esA && <th style={{ ...th, ...right, width: '52px' }}>IVA</th>}
            <th style={{ ...th, ...right, width: '104px' }}>{esA ? 'Subtotal neto' : 'Importe'}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l: any, i: number) => (
            <tr key={i} style={{ breakInside: 'avoid' }}>
              <td style={{ ...td, ...right, fontWeight: 700 }}>{qtyFmt(l.qty)}</td>
              <td style={{ ...td, fontSize: '8.5pt' }}>{l.unit}</td>
              <td style={{ ...td, textTransform: 'uppercase' }}>{l.name}</td>
              <td style={{ ...td, ...right }}>{money(l.price)}</td>
              {esA && <td style={{ ...td, ...right, fontSize: '8.5pt' }}>{l.rate ? `${String(l.rate).replace('.', ',')}%` : '—'}</td>}
              <td style={{ ...td, ...right, fontWeight: 600 }}>{money(l.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totales */}
      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', breakInside: 'avoid' }}>
        <div style={{ minWidth: '260px', border: '1.5px solid #000', borderRadius: '4px', padding: '8px 12px', fontSize: '10pt', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {esA && (
            <>
              <div style={row}><span>Neto gravado</span><span>{money(doc.neto)}</span></div>
              {(doc.ivaDetail || []).map((l: any) => (
                <div key={l.rate} style={row}><span>IVA {String(l.rate).replace('.', ',')}%</span><span>{money(l.amount)}</span></div>
              ))}
            </>
          )}
          <div style={{ ...row, fontSize: '13pt', fontWeight: 800 }}><span>TOTAL</span><span>{money(doc.total)}</span></div>
        </div>
      </div>

      {/* Factura A a un monotributista (RG 5003): el IVA solo le sirve para su régimen */}
      {esA && doc.receptor?.ivaCondition === 'MONOTRIBUTO' && (
        <div style={{ border: '1px solid #000', padding: '4px 8px', marginTop: '8px', fontSize: '8pt' }}>
          El crédito fiscal discriminado en el presente comprobante sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618.
        </div>
      )}

      {/* Ley 27.743: el IVA que el consumidor paga dentro del precio */}
      {esB && (
        <div style={{ border: '1px solid #000', padding: '4px 8px', marginTop: '8px', fontSize: '8.5pt', display: 'flex', flexDirection: 'column', gap: '1px', maxWidth: '320px', marginLeft: 'auto' }}>
          <span style={{ fontWeight: 700 }}>Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</span>
          <div style={row}><span>IVA contenido</span><span>{money(doc.iva || 0)}</span></div>
          <div style={row}><span>Otros impuestos nacionales indirectos</span><span>{money(0)}</span></div>
        </div>
      )}

      {(doc.excludedLines || []).length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '8.5pt' }}>
          Otros conceptos no incluidos en el comprobante: {doc.excludedLines.map((l: any) => `${l.name} ${money(l.total)}`).join(' · ')}
        </div>
      )}

      {/* CAE y QR: sin esto el comprobante no cumple */}
      <div style={{ marginTop: '14px', borderTop: '1.5px solid #000', paddingTop: '8px', display: 'flex', gap: '12px', alignItems: 'center', breakInside: 'avoid' }}>
        {qr && <img src={qr} alt="QR" style={{ width: '30mm', height: '30mm' }} />}
        <div style={{ flex: 1, fontSize: '9pt', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontWeight: 700 }}>Comprobante autorizado por ARCA</div>
          {(doc.environment || emisor.environment) === 'HOMOLOGACION' && (
            <div style={{ fontWeight: 700, border: '1px solid #000', padding: '2px 6px', alignSelf: 'flex-start' }}>COMPROBANTE DE PRUEBA · SIN VALIDEZ FISCAL</div>
          )}
        </div>
        <div style={{ fontSize: '9.5pt', textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontWeight: 700 }}>CAE N°: {doc.cae}</div>
          <div>Vto. CAE: {doc.caeExpiresAt ? new Date(doc.caeExpiresAt).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—'}</div>
        </div>
      </div>
      <div style={{ marginTop: '14px', textAlign: 'center', fontSize: '7pt', color: '#555' }}>Sistema de gestión Ventra · ventra.store</div>
    </section>
  );
}
