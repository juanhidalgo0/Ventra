/**
 * Distribuidora: nota de venta y remito en hoja A4 (función `delivery` del rubro).
 *
 * Por defecto una hoja: la NOTA DE VENTA, con precios y lugar para la firma (el cliente se queda
 * con los precios; con duplicado, la copia firmada vuelve a la distribuidora). Si hace falta, el
 * REMITO sin precios. Ninguna es factura: si el cliente la pide, la factura sale aparte por ARCA.
 *
 * Los renglones vendidos por bulto (sale_items.pack_size) se muestran en bultos con el precio del
 * bulto; la cantidad guardada sigue en unidades.
 */
import api from '../../services/api';
import { usePOSStore } from '../../stores/posStore';
import { printA4 } from '../../utils/printA4';

export interface Emisor {
  name: string;
  phone?: string;
  razonSocial?: string;
  cuit?: string;
  domicilio?: string;
  ivaCondition?: string;
  iibb?: string;
  inicioActividades?: string | null;
  /** Logo del comercio (opcional) */
  logo?: string;
}

const IVA_LABEL: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTO: 'Responsable Monotributo',
  EXENTO: 'IVA Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_CATEGORIZADO: 'Sujeto no categorizado',
};

const cuitAr = (c?: string | null) => {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
};
const money = (n: number) => `$ ${(Math.round(n * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 });

/**
 * Numeración de las hojas impresas. Por dentro, ventas y pedidos comparten un número y cada caja
 * tiene su rango (ver backend sync/numbering): eso no se toca. Para seguir los talonarios del
 * comercio, se elige el próximo número de la hoja: desde el pedido o venta `base + 1` de esa caja
 * la hoja sale con `start` y sigue. Opcional, el punto de venta adelante (0001-00004521).
 */
export interface DocNumbering { prefix?: string; byNode?: Record<string, { base: number; start: number }> }
const RANGE = 1_000_000;
export const readDocNumbering = (): DocNumbering => {
  try { const v = JSON.parse(localStorage.getItem('ventra_doc_numbering') || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
/** El número que sale impreso para la venta o el pedido N° n (raw: sin ceros ni punto de venta) */
export function printedNumber(n: number, opts: { raw?: boolean } = {}): string {
  const cfg = readDocNumbering();
  const r = cfg.byNode?.[String(Math.floor((Number(n) || 0) / RANGE))];
  const v = r && n > r.base ? r.start + (n - r.base - 1) : Number(n) || 0;
  if (opts.raw) return String(v);
  return `${cfg.prefix ? `${cfg.prefix}-` : ''}${String(v).padStart(8, '0')}`;
}
const numero = (n: number) => printedNumber(n);

/** Nombre del comercio (Configuración → Tu comercio). Es obligatorio: sin él no se imprime. */
export const storeNameOf = () => (localStorage.getItem('gd_store_name') || '').trim();
export class MissingStoreNameError extends Error {
  constructor() { super('Falta el nombre del comercio. Lo carga el administrador en Configuración → General y POS.'); }
}

/** Pie chiquito de cada hoja */
function VentraFooter() {
  return <div style={{ marginTop: '14px', textAlign: 'center', fontSize: '7pt', color: '#555' }}>Sistema de gestión Ventra · ventra.store</div>;
}

/** Un renglón listo para imprimir: en bultos si se vendió por bulto */
function lineOf(item: any) {
  const pack = Number(item.packSize) > 1 ? Number(item.packSize) : 0;
  const units = Number(item.quantity) || 0;
  const total = Number(item.total ?? item.subtotal ?? units * item.unitPrice) || 0;
  return {
    qty: pack ? units / pack : units,
    unit: pack ? `Bulto x${pack}` : 'Unid.',
    price: pack ? Number(item.unitPrice) * pack : Number(item.unitPrice),
    discount: Number(item.discount) || 0,
    total,
    units,
    pack,
  };
}

const th = { textAlign: 'left', padding: '6px 8px', background: '#f4f4f5', borderTop: '1.5px solid #000', borderBottom: '1.5px solid #000', fontSize: '8pt', textTransform: 'uppercase', letterSpacing: '0.04em' } as const;
const td = { padding: '5px 8px', borderBottom: '1px solid #e4e4e7', fontSize: '9.5pt', verticalAlign: 'top' } as const;
const right = { textAlign: 'right' } as const;

function Header({ emisor, title, sale, copy }: { emisor: Emisor; title: string; sale: any; copy: string }) {
  const fecha = sale.createdAt ? new Date(sale.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const interno = printedNumber(sale.saleNumber, { raw: true }) !== String(sale.saleNumber);
  // Datos del comprobante en dos columnas: el nombre del dato y su valor, alineados
  const facts: [string, string][] = [
    ['Fecha', fecha],
    ['C.U.I.T.', emisor.cuit ? cuitAr(emisor.cuit) : ''],
    ['Ing. Brutos', emisor.iibb || ''],
    ['Inicio de act.', emisor.inicioActividades ? String(emisor.inicioActividades).slice(0, 10).split('-').reverse().join('/') : ''],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 1fr', border: '1.5px solid #000', borderRadius: '6px', overflow: 'hidden' }}>
      {/* Comercio: el logo arriba (si hay) y los datos debajo, con todo el ancho */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3px', fontSize: '8.5pt', lineHeight: 1.3 }}>
        {emisor.logo && <img src={emisor.logo} alt="" style={{ width: 'auto', height: 'auto', maxWidth: '62mm', maxHeight: '15mm', alignSelf: 'flex-start', marginBottom: '5px' }} />}
        <div style={{ fontSize: emisor.logo ? '12pt' : '15pt', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.15 }}>{emisor.name}</div>
        {emisor.razonSocial && emisor.razonSocial.toUpperCase() !== emisor.name.toUpperCase() && <div style={{ fontWeight: 600 }}>{emisor.razonSocial}</div>}
        {emisor.domicilio && <div>{emisor.domicilio}</div>}
        {emisor.phone && <div>Tel.: {emisor.phone}</div>}
        {emisor.ivaCondition && <div style={{ fontWeight: 700 }}>{IVA_LABEL[emisor.ivaCondition] || emisor.ivaCondition}</div>}
      </div>
      <div style={{ borderLeft: '1.5px solid #000', borderRight: '1.5px solid #000', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '8px', background: '#f4f4f5' }}>
        <div style={{ width: '40px', height: '40px', border: '1.5px solid #000', borderRadius: '4px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Vectorial: queda centrada igual en pantalla, en el PDF y al imprimir */}
          <svg width="22" height="24" viewBox="0 0 22 24" aria-label="X"><path d="M3 3 L19 21 M19 3 L3 21" stroke="#000" strokeWidth="4.2" strokeLinecap="square" fill="none" /></svg>
        </div>
        <div style={{ fontSize: '5.5pt', fontWeight: 700, textAlign: 'center', lineHeight: 1.2, marginTop: '5px', padding: '0 3px' }}>DOCUMENTO NO VÁLIDO COMO FACTURA</div>
      </div>
      {/* Comprobante: tipo, número y datos fiscales */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '8.5pt', lineHeight: 1.3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14pt', fontWeight: 800, letterSpacing: '0.01em' }}>{title}</span>
          {copy && <span style={{ fontSize: '7pt', fontWeight: 700, border: '1px solid #000', borderRadius: '3px', padding: '1px 5px' }}>{copy}</span>}
        </div>
        <div style={{ fontWeight: 800, fontSize: '11pt', marginTop: '1px' }}>N° {numero(sale.saleNumber)}</div>
        {/* Con numeración propia, el número de Ventra para encontrarlo en el sistema */}
        {interno && <div style={{ fontSize: '7pt', color: '#444' }}>Ref. interna {sale.saleNumber}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '8px', rowGap: '1px', marginTop: '4px' }}>
          {facts.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><span style={{ fontWeight: 700 }}>{k}:</span><span>{v}</span></div>)}
        </div>
      </div>
    </div>
  );
}

/**
 * Datos del cliente. En el remito va solo lo que sirve para entregar (dónde y a quién llamar);
 * en la nota, además el CUIT y la condición de IVA si los tiene. Lo que no está cargado no se muestra.
 */
function ClientBox({ client, forDelivery }: { client: any; forDelivery?: boolean }) {
  const row = { display: 'flex', gap: '6px' } as const;
  const k = { fontWeight: 700, minWidth: '78px' } as const;
  const doc = client?.cuit ? cuitAr(client.cuit) : client?.dni || '';
  const all: [string, string][] = [
    ['Domicilio:', client?.address || ''],
    ['Localidad:', client?.locality || ''],
    ['Teléfono:', client?.phone || ''],
  ];
  if (!forDelivery) {
    all.push(['C.U.I.T./DNI:', doc]);
    all.push(['Cond. IVA:', client?.cuit ? IVA_LABEL[client?.ivaCondition] || '' : '']);
  }
  const rows = all.filter(([, v]) => v);
  return (
    <div style={{ border: '1.5px solid #000', borderRadius: '6px', padding: '10px 14px', marginTop: '10px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '4px 18px', fontSize: '9pt', lineHeight: 1.3 }}>
      <div style={{ ...row, gridColumn: '1 / -1' }}><span style={k}>Cliente:</span><span style={{ fontWeight: 700 }}>{client?.name || 'Consumidor final'}</span></div>
      {rows.map(([label, value]) => <div key={label} style={row}><span style={k}>{label}</span><span>{value}</span></div>)}
    </div>
  );
}

function Totals({ lines }: { lines: ReturnType<typeof lineOf>[] }) {
  const packs = lines.filter((l) => l.pack).reduce((s, l) => s + l.qty, 0);
  const loose = lines.filter((l) => !l.pack).reduce((s, l) => s + l.qty, 0);
  return (
    <span>
      {packs > 0 && <>{qtyFmt(packs)} {packs === 1 ? 'bulto' : 'bultos'}</>}
      {packs > 0 && loose > 0 && ' + '}
      {loose > 0 && <>{qtyFmt(loose)} {loose === 1 ? 'unidad suelta' : 'unidades sueltas'}</>}
    </span>
  );
}

/**
 * Qué hoja: con precios (la nota de venta, con lugar para la firma: lo que usan casi todas las
 * distribuidoras, el cliente se queda con los precios), sin precios (el remito, para que firme un
 * empleado que no tiene que ver los importes) o las dos por separado.
 */
export type SalesNoteShow = 'note' | 'remito' | 'both';

/** Copias al imprimir: con duplicado sale la misma hoja dos veces (el original para el cliente y el duplicado vuelve firmado) */
export type SalesNoteCopies = 1 | 2;
const COPIES_KEY = 'ventra_note_copies';
export const readNoteCopies = (): SalesNoteCopies => { try { return localStorage.getItem(COPIES_KEY) === '2' ? 2 : 1; } catch { return 1; } };
export const saveNoteCopies = (c: SalesNoteCopies) => { try { localStorage.setItem(COPIES_KEY, String(c)); } catch { /* sin espacio */ } };

/** Lugar para las firmas: quien recibe y el chofer */
function Signatures() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px', fontSize: '9pt', breakInside: 'avoid' }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '28px' }}>Recibí conforme la mercadería detallada.</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
          <span>Firma</span><span>Aclaración</span><span>DNI</span>
        </div>
        <div style={{ marginTop: '22px', borderTop: '1px solid #000', paddingTop: '4px' }}>Fecha y hora de entrega</div>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: '28px' }}>Entregó</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
          <span>Firma del chofer</span><span>Aclaración</span>
        </div>
        <div style={{ marginTop: '22px', borderTop: '1px solid #000', paddingTop: '4px' }}>Observaciones / faltantes</div>
      </div>
    </div>
  );
}

export function SalesNoteSheet({ sale, client, emisor, paymentLabel, codeOf, show = 'note', copies = 1, paper }: {
  sale: any;
  client: any;
  emisor: Emisor;
  paymentLabel?: string;
  codeOf: (productId: string) => string;
  show?: SalesNoteShow;
  /** Solo al imprimir: en pantalla, en el PDF y por WhatsApp va una sola copia */
  copies?: SalesNoteCopies;
  /** Vista previa en pantalla: cada hoja como un papel A4 */
  paper?: boolean;
}) {
  const items: any[] = (sale.items || []).filter((i: any) => Number(i.quantity) !== 0);
  const lines = items.map(lineOf);
  const discounts = lines.reduce((s, l) => s + l.discount, 0);
  // Cada hoja ocupa la página entera (A4 menos los 10 mm de margen): las firmas y el pie quedan
  // siempre abajo. Si el pedido es largo y sigue en otra página, van al final del último.
  const page = { width: '100%', color: '#000', background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', ...(paper ? {} : { minHeight: '276mm' }) } as const;
  // Sin códigos cargados, la columna no ocupa lugar
  const hasCodes = items.some((it) => codeOf(it.productId));
  const paperStyle = paper ? { width: '210mm', minHeight: '297mm', padding: '10mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px' } : {};

  // Las hojas a dibujar, con el rótulo de cada copia
  const kinds: ('note' | 'remito')[] = show === 'both' ? ['note', 'remito'] : [show];
  const sheets: { kind: 'note' | 'remito'; copy: string }[] = [];
  for (const kind of kinds) {
    if (copies === 2 && !paper) sheets.push({ kind, copy: 'ORIGINAL' }, { kind, copy: 'DUPLICADO' });
    else sheets.push({ kind, copy: copies === 2 ? 'ORIGINAL' : show === 'both' ? (kind === 'note' ? 'ORIGINAL' : 'DUPLICADO') : '' });
  }
  const breakStyle = (on: boolean) => (on ? { breakBefore: 'page', pageBreakBefore: 'always' } as const : {});

  const noteSheet = (copy: string, breakBefore: boolean, key: string) => (
    <section key={key} data-sheet="note" style={{ ...page, ...breakStyle(breakBefore), ...paperStyle }}>
      <Header emisor={emisor} title="NOTA DE VENTA" sale={sale} copy={copy} />
      <ClientBox client={client} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
        <thead>
          <tr>
            <th style={{ ...th, ...right, width: '52px' }}>Cant.</th>
            <th style={{ ...th, width: '74px' }}>Unidad</th>
            {hasCodes && <th style={{ ...th, width: '96px' }}>Código</th>}
            <th style={th}>Descripción</th>
            <th style={{ ...th, ...right, width: '92px' }}>Precio</th>
            <th style={{ ...th, ...right, width: '100px' }}>Importe</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const l = lines[i];
            return (
              <tr key={it.id || i} style={{ breakInside: 'avoid' }}>
                <td style={{ ...td, ...right, fontWeight: 700 }}>{qtyFmt(l.qty)}</td>
                <td style={td}>{l.unit}</td>
                {hasCodes && <td style={{ ...td, fontSize: '8.5pt' }}>{codeOf(it.productId)}</td>}
                <td style={td}>{it.productName}{l.discount > 0 && <span style={{ fontSize: '8pt' }}> (desc. {money(l.discount)})</span>}</td>
                <td style={{ ...td, ...right }}>{money(l.price)}</td>
                <td style={{ ...td, ...right, fontWeight: 600 }}>{money(l.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '10px', gap: '16px', breakInside: 'avoid' }}>
        <div style={{ fontSize: '9pt', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div><strong>Total de mercadería:</strong> <Totals lines={lines} /></div>
          {paymentLabel && <div><strong>Forma de pago:</strong> {paymentLabel}</div>}
          {sale.notes && <div><strong>Observaciones:</strong> {sale.notes}</div>}
        </div>
        <div style={{ minWidth: '230px', border: '1.5px solid #000', borderRadius: '6px', padding: '8px 14px', background: '#f4f4f5', fontSize: '10pt', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {discounts > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(Number(sale.total) + discounts)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Descuentos</span><span>- {money(discounts)}</span></div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13pt', fontWeight: 800 }}><span>TOTAL</span><span>{money(Number(sale.total))}</span></div>
        </div>
      </div>
      {/* Sola, la nota hace de comprobante de entrega; con las dos hojas, se firma el remito */}
      <div style={{ marginTop: 'auto', paddingTop: '28px', breakInside: 'avoid' }}>
        {show !== 'both' && <Signatures />}
        <VentraFooter />
      </div>
    </section>
  );

  const remitoSheet = (copy: string, breakBefore: boolean, key: string) => (
    <section key={key} data-sheet="remito" style={{ ...page, ...breakStyle(breakBefore), paddingTop: '2px', ...paperStyle }}>
      <Header emisor={emisor} title="REMITO" sale={sale} copy={copy} />
      <ClientBox client={client} forDelivery />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
        <thead>
          <tr>
            <th style={{ ...th, ...right, width: '60px' }}>Cant.</th>
            <th style={{ ...th, width: '84px' }}>Unidad</th>
            {hasCodes && <th style={{ ...th, width: '110px' }}>Código</th>}
            <th style={th}>Descripción</th>
            <th style={{ ...th, ...right, width: '70px' }}>Unidades</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const l = lines[i];
            return (
              <tr key={it.id || i} style={{ breakInside: 'avoid' }}>
                <td style={{ ...td, ...right, fontWeight: 700 }}>{qtyFmt(l.qty)}</td>
                <td style={td}>{l.unit}</td>
                {hasCodes && <td style={{ ...td, fontSize: '8.5pt' }}>{codeOf(it.productId)}</td>}
                <td style={td}>{it.productName}</td>
                <td style={{ ...td, ...right }}>{qtyFmt(l.units)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: '10px', fontSize: '9.5pt', breakInside: 'avoid' }}>
        <strong>Total de mercadería:</strong> <Totals lines={lines} />
      </div>
      <div style={{ marginTop: 'auto', paddingTop: '28px', breakInside: 'avoid' }}>
        <Signatures />
        <VentraFooter />
      </div>
    </section>
  );

  return (
    <div style={paper ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' } : undefined}>
      {sheets.map((sh, i) => (sh.kind === 'note' ? noteSheet(sh.copy, i > 0, `${sh.kind}${i}`) : remitoSheet(sh.copy, i > 0, `${sh.kind}${i}`)))}
    </div>
  );
}

let fiscalCache: any | null = null;

/**
 * Datos del comercio: los de Configuración → Tu comercio y, lo que ahí no esté, de la
 * configuración de facturación.
 */
export async function loadEmisor(): Promise<Emisor> {
  const name = storeNameOf();
  if (!name) throw new MissingStoreNameError();
  if (!fiscalCache) {
    try { fiscalCache = (await api.get('/fiscal/config')).data || {}; } catch { fiscalCache = null; }
  }
  const f = fiscalCache || {};
  const own = (k: string) => (localStorage.getItem(k) || '').trim();
  const cuit = own('gd_store_cuit') || f.cuit || '';
  return {
    name,
    phone: own('gd_store_phone'),
    razonSocial: f.razonSocial || '',
    cuit,
    domicilio: own('gd_store_address') || f.domicilio || '',
    ivaCondition: own('gd_store_iva') || (f.cuit ? f.ivaCondition : ''),
    iibb: own('gd_store_iibb') || f.iibb || '',
    logo: own('gd_store_logo'),
    inicioActividades: own('gd_store_start') || f.inicioActividades || null,
  };
}


export interface SalesNoteContext { emisor: Emisor; client: any; codeOf: (productId: string) => string }

/** Todo lo que la hoja necesita además de la venta. Sin nombre del comercio tira MissingStoreNameError. */
export async function loadSalesNoteContext(sale: any, client?: any): Promise<SalesNoteContext> {
  const emisor = await loadEmisor();
  const products = usePOSStore.getState().products;
  const codeOf = (id: string) => {
    const p = products.find((x: any) => x.id === id);
    return p?.barcode || p?.sku || '';
  };
  return { emisor, client: client || sale.client || null, codeOf };
}

/**
 * Imprime la nota de venta y/o el remito de una venta. Va por la impresora de reportes (la A4)
 * si la PC tiene una elegida; si no, abre el cuadro de impresión.
 */
export async function printSalesNote(sale: any, opts: { client?: any; paymentLabel?: string; show?: SalesNoteShow; ctx?: SalesNoteContext } = {}) {
  const { emisor, client, codeOf } = opts.ctx || await loadSalesNoteContext(sale, opts.client);
  await printA4(<SalesNoteSheet sale={sale} client={client} emisor={emisor} paymentLabel={opts.paymentLabel} codeOf={codeOf} show={opts.show} copies={readNoteCopies()} />);
}

/** "Imprimir con duplicado": se recuerda en este equipo */
export function CopiesToggle({ copies, onChange }: { copies: SalesNoteCopies; onChange: (c: SalesNoteCopies) => void }) {
  return (
    <label className="flex items-center gap-2.5 px-5 py-2 text-[12.5px] text-slate-700 cursor-pointer select-none">
      <input type="checkbox" checked={copies === 2} onChange={(e) => { const c: SalesNoteCopies = e.target.checked ? 2 : 1; saveNoteCopies(c); onChange(c); }} className="w-4 h-4 accent-rose-600" />
      <span><b>Imprimir con duplicado</b> · sale dos veces: el original queda en el comercio y el duplicado vuelve firmado (el PDF y el WhatsApp van con una sola copia)</span>
    </label>
  );
}
