/**
 * Distribuidora: nota de venta y remito en hoja A4 (función `delivery` del rubro).
 *
 * Dos páginas de la misma venta: la NOTA DE VENTA, con precios, que se queda el cliente, y el
 * REMITO, sin precios y con lugar para la firma, que vuelve firmado a la distribuidora. Ninguna
 * de las dos es factura: si el cliente la pide, la factura sale aparte por ARCA.
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
const numero = (n: number) => String(n ?? 0).padStart(8, '0');

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

const th = { textAlign: 'left', padding: '5px 6px', borderBottom: '1.5px solid #000', fontSize: '8.5pt', textTransform: 'uppercase', letterSpacing: '0.03em' } as const;
const td = { padding: '4px 6px', borderBottom: '1px solid #d4d4d4', fontSize: '9.5pt', verticalAlign: 'top' } as const;
const right = { textAlign: 'right' } as const;

function Header({ emisor, title, sale, copy }: { emisor: Emisor; title: string; sale: any; copy: string }) {
  const fecha = sale.createdAt ? new Date(sale.createdAt).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', border: '1.5px solid #000', borderRadius: '4px' }}>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9pt' }}>
        <div style={{ fontSize: '15pt', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.1 }}>{emisor.name}</div>
        {emisor.razonSocial && emisor.razonSocial.toUpperCase() !== emisor.name.toUpperCase() && <div style={{ fontWeight: 600 }}>{emisor.razonSocial}</div>}
        {emisor.domicilio && <div>{emisor.domicilio}</div>}
        {emisor.phone && <div>Tel.: {emisor.phone}</div>}
        {emisor.ivaCondition && <div style={{ fontWeight: 600 }}>{IVA_LABEL[emisor.ivaCondition] || emisor.ivaCondition}</div>}
      </div>
      <div style={{ borderLeft: '1.5px solid #000', borderRight: '1.5px solid #000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '6px' }}>
        <div style={{ fontSize: '26pt', fontWeight: 900, lineHeight: 1 }}>X</div>
        <div style={{ fontSize: '6pt', textAlign: 'center', lineHeight: 1.15, marginTop: '4px', padding: '0 3px' }}>DOCUMENTO NO VÁLIDO COMO FACTURA</div>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '9pt' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '14pt', fontWeight: 800 }}>{title}</span>
          <span style={{ fontSize: '7.5pt', fontWeight: 700 }}>{copy}</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: '10.5pt' }}>N° {numero(sale.saleNumber)}</div>
        <div>Fecha: {fecha}</div>
        {emisor.cuit && <div>C.U.I.T.: {cuitAr(emisor.cuit)}</div>}
        {emisor.iibb && <div>Ing. Brutos: {emisor.iibb}</div>}
        {emisor.inicioActividades && <div>Inicio de actividades: {String(emisor.inicioActividades).slice(0, 10).split('-').reverse().join('/')}</div>}
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
    <div style={{ border: '1px solid #000', borderRadius: '4px', padding: '8px 12px', marginTop: '8px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '3px 18px', fontSize: '9.5pt' }}>
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

/** Qué hojas: las dos (lo de siempre), solo la nota de venta o solo el remito */
export type SalesNoteShow = 'both' | 'note' | 'remito';

export function SalesNoteSheet({ sale, client, emisor, paymentLabel, codeOf, show = 'both', paper }: {
  sale: any;
  client: any;
  emisor: Emisor;
  paymentLabel?: string;
  codeOf: (productId: string) => string;
  show?: SalesNoteShow;
  /** Vista previa en pantalla: cada hoja como un papel A4 */
  paper?: boolean;
}) {
  const items: any[] = (sale.items || []).filter((i: any) => Number(i.quantity) !== 0);
  const lines = items.map(lineOf);
  const discounts = lines.reduce((s, l) => s + l.discount, 0);
  const page = { width: '100%', color: '#000', background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', boxSizing: 'border-box' } as const;
  const paperStyle = paper ? { width: '210mm', minHeight: '297mm', padding: '10mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px' } : {};

  return (
    <div style={paper ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' } : undefined}>
      {/* Nota de venta: con precios, se la queda el cliente */}
      {show !== 'remito' && <section data-sheet="note" style={{ ...page, ...paperStyle }}>
        <Header emisor={emisor} title="NOTA DE VENTA" sale={sale} copy="ORIGINAL" />
        <ClientBox client={client} />
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
          <thead>
            <tr>
              <th style={{ ...th, ...right, width: '52px' }}>Cant.</th>
              <th style={{ ...th, width: '74px' }}>Unidad</th>
              <th style={{ ...th, width: '96px' }}>Código</th>
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
                  <td style={{ ...td, fontSize: '8.5pt' }}>{codeOf(it.productId)}</td>
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
          <div style={{ minWidth: '230px', border: '1.5px solid #000', borderRadius: '4px', padding: '8px 12px', fontSize: '10pt', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {discounts > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Subtotal</span><span>{money(Number(sale.total) + discounts)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Descuentos</span><span>- {money(discounts)}</span></div>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13pt', fontWeight: 800 }}><span>TOTAL</span><span>{money(Number(sale.total))}</span></div>
          </div>
        </div>
        <VentraFooter />
      </section>}

      {/* Remito: sin precios, lo firma quien recibe y vuelve a la distribuidora */}
      {show !== 'note' && <section data-sheet="remito" style={{ ...page, ...(show === 'both' ? { breakBefore: 'page', pageBreakBefore: 'always' } : {}), paddingTop: '2px', ...paperStyle }}>
        <Header emisor={emisor} title="REMITO" sale={sale} copy="DUPLICADO" />
        <ClientBox client={client} forDelivery />
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
          <thead>
            <tr>
              <th style={{ ...th, ...right, width: '60px' }}>Cant.</th>
              <th style={{ ...th, width: '84px' }}>Unidad</th>
              <th style={{ ...th, width: '110px' }}>Código</th>
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
                  <td style={{ ...td, fontSize: '8.5pt' }}>{codeOf(it.productId)}</td>
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
        <div style={{ marginTop: '34px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px', fontSize: '9pt', breakInside: 'avoid' }}>
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
        <VentraFooter />
      </section>}
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
    iibb: f.iibb || '',
    inicioActividades: f.inicioActividades || null,
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
  await printA4(<SalesNoteSheet sale={sale} client={client} emisor={emisor} paymentLabel={opts.paymentLabel} codeOf={codeOf} show={opts.show} />);
}
