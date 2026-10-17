import { SalesNoteSheet, type Emisor } from '../pos/SalesNoteSheet';

/**
 * Hojas A4 de un reparto: la de carga (todo lo que sube al camión, sumado) y la de ruta (las
 * paradas en orden, con lo que hay que cobrar y lugar para la firma). Los remitos de cada
 * pedido salen con la misma hoja que la nota de venta (SalesNoteSheet).
 */

const money = (n: number) => `$ ${(Math.round(n * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const fecha = (d: any) => (d ? new Date(d).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

const page = { width: '100%', color: '#000', background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif', boxSizing: 'border-box' } as const;
const paperStyle = { width: '210mm', minHeight: '297mm', padding: '10mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px' } as const;
const th = { textAlign: 'left', padding: '5px 6px', borderBottom: '1.5px solid #000', fontSize: '8.5pt', textTransform: 'uppercase', letterSpacing: '0.03em' } as const;
const td = { padding: '5px 6px', borderBottom: '1px solid #d4d4d4', fontSize: '9.5pt', verticalAlign: 'top' } as const;
const right = { textAlign: 'right' } as const;
const center = { textAlign: 'center' } as const;

export const liveOrders = (run: any) => (run?.orders || []).filter((o: any) => o.status !== 'CANCELLED');
export const bultosOf = (o: any) => (o.items || []).reduce((s: number, i: any) => s + (Number(i.packSize) > 1 ? i.quantity / i.packSize : 0), 0);
export const looseOf = (o: any) => (o.items || []).reduce((s: number, i: any) => s + (Number(i.packSize) > 1 ? 0 : Number(i.quantity)), 0);

function RunHeader({ emisor, title, run, extra }: { emisor: Emisor; title: string; run: any; extra?: string }) {
  const zones = Array.from(new Set(liveOrders(run).map((o: any) => (o.client?.locality || '').trim()).filter(Boolean))).sort();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', border: '1.5px solid #000', borderRadius: '4px', padding: '10px 12px' }}>
      <div>
        <div style={{ fontSize: '14pt', fontWeight: 800, textTransform: 'uppercase', lineHeight: 1.1 }}>{emisor.name}</div>
        {emisor.domicilio && <div style={{ fontSize: '9pt' }}>{emisor.domicilio}</div>}
        {emisor.phone && <div style={{ fontSize: '9pt' }}>Tel.: {emisor.phone}</div>}
      </div>
      <div style={{ textAlign: 'right', fontSize: '9.5pt' }}>
        <div style={{ fontSize: '15pt', fontWeight: 800 }}>{title}</div>
        <div style={{ fontWeight: 700 }}>Reparto N° {run.runNumber}</div>
        <div style={{ textTransform: 'capitalize' }}>{fecha(run.date)}</div>
        {(run.driverName || run.vehicle) && <div>{[run.driverName && `Chofer: ${run.driverName}`, run.vehicle].filter(Boolean).join(' · ')}</div>}
        {zones.length > 0 && <div>Zonas: {zones.join(', ')}</div>}
        {extra && <div>{extra}</div>}
      </div>
    </div>
  );
}

const Footer = () => <div style={{ marginTop: '14px', textAlign: 'center', fontSize: '7pt', color: '#555' }}>Sistema de gestión Ventra · ventra.store</div>;

/** Todo lo que sube al camión: cada producto sumado, en bultos y unidades sueltas */
export function consolidate(run: any, codeOf: (id: string) => string) {
  const map = new Map<string, { name: string; code: string; packs: Map<number, number>; loose: number; units: number }>();
  for (const o of liveOrders(run)) {
    for (const it of o.items || []) {
      const row = map.get(it.productId) || { name: it.productName, code: codeOf(it.productId), packs: new Map<number, number>(), loose: 0, units: 0 };
      const size = Number(it.packSize) > 1 ? Number(it.packSize) : 0;
      if (size) row.packs.set(size, (row.packs.get(size) || 0) + it.quantity / size);
      else row.loose += Number(it.quantity);
      row.units += Number(it.quantity);
      map.set(it.productId, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function LoadSheet({ run, emisor, codeOf, paper }: { run: any; emisor: Emisor; codeOf: (id: string) => string; paper?: boolean }) {
  const rows = consolidate(run, codeOf);
  const orders = liveOrders(run);
  const totalBultos = orders.reduce((s: number, o: any) => s + bultosOf(o), 0);
  const totalLoose = orders.reduce((s: number, o: any) => s + looseOf(o), 0);
  return (
    <section data-sheet="carga" style={{ ...page, ...(paper ? paperStyle : {}) }}>
      <RunHeader emisor={emisor} title="HOJA DE CARGA" run={run} extra={`${orders.length} pedido(s)`} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
        <thead>
          <tr>
            <th style={th}>Producto</th>
            <th style={{ ...th, width: '100px' }}>Código</th>
            <th style={{ ...th, ...right, width: '110px' }}>Bultos</th>
            <th style={{ ...th, ...right, width: '70px' }}>Sueltas</th>
            <th style={{ ...th, ...right, width: '70px' }}>Total u.</th>
            <th style={{ ...th, ...center, width: '60px' }}>Cargado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name + r.code} style={{ breakInside: 'avoid' }}>
              <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
              <td style={{ ...td, fontSize: '8.5pt' }}>{r.code}</td>
              <td style={{ ...td, ...right, fontWeight: 700 }}>
                {r.packs.size ? Array.from(r.packs.entries()).map(([size, n]) => `${qty(n)} (de ${size})`).join(' + ') : '—'}
              </td>
              <td style={{ ...td, ...right }}>{r.loose ? qty(r.loose) : '—'}</td>
              <td style={{ ...td, ...right }}>{qty(r.units)}</td>
              <td style={{ ...td, ...center }}><span style={{ display: 'inline-block', width: '14px', height: '14px', border: '1.5px solid #000', borderRadius: '2px' }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '10pt', fontWeight: 700, breakInside: 'avoid' }}>
        <span>{rows.length} producto(s) distintos</span>
        <span>Total: {qty(totalBultos)} bultos{totalLoose ? ` + ${qty(totalLoose)} unidades sueltas` : ''}</span>
      </div>
      <div style={{ marginTop: '30px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px', fontSize: '9pt', breakInside: 'avoid' }}>
        <div style={{ borderTop: '1px solid #000', paddingTop: '4px' }}>Armó (firma y aclaración)</div>
        <div style={{ borderTop: '1px solid #000', paddingTop: '4px' }}>Controló el chofer (firma y aclaración)</div>
      </div>
      <Footer />
    </section>
  );
}

/** Las paradas en orden, agrupadas por localidad, con lo que hay que cobrar */
export function RouteSheet({ run, emisor, paper }: { run: any; emisor: Emisor; paper?: boolean }) {
  const orders = liveOrders(run);
    const total = orders.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  // Una vez por cliente: si tiene dos pedidos en el reparto, su deuda vieja es la misma
  const prevDebts: number = Array.from(new Map<string, number>(orders.filter((o: any) => o.clientId).map((o: any) => [o.clientId, Number(o.prevDebt) || 0])).values()).reduce((s, v) => s + v, 0);
  let lastZone = '\u0000';
  return (
    <section data-sheet="ruta" style={{ ...page, ...(paper ? paperStyle : {}) }}>
      <RunHeader emisor={emisor} title="HOJA DE RUTA" run={run} extra={`${orders.length} parada(s)`} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '26px' }}>#</th>
            <th style={th}>Cliente</th>
            <th style={{ ...th, ...right, width: '74px' }}>Bultos</th>
            <th style={{ ...th, ...right, width: '92px' }}>A cobrar</th>
            <th style={{ ...th, width: '120px' }}>Cobró / firma</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o: any, i: number) => {
            const zone = (o.client?.locality || 'Sin localidad').trim();
            const header = zone !== lastZone;
            lastZone = zone;
            const b = bultosOf(o);
            const l = looseOf(o);
            return [
              header && (
                <tr key={`z-${zone}-${i}`}>
                  <td colSpan={5} style={{ padding: '8px 6px 4px', fontSize: '10pt', fontWeight: 800, textTransform: 'uppercase', borderBottom: '1.5px solid #000' }}>{zone}</td>
                </tr>
              ),
              <tr key={o.id} style={{ breakInside: 'avoid' }}>
                <td style={{ ...td, fontWeight: 800, fontSize: '11pt' }}>{i + 1}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{o.client?.name || 'Sin cliente'} <span style={{ fontWeight: 400, fontSize: '8.5pt' }}>· Pedido N° {o.orderNumber}</span></div>
                  <div style={{ fontSize: '9pt' }}>{o.client?.address || 'Sin dirección'}{o.client?.phone ? ` · Tel. ${o.client.phone}` : ''}</div>
                                    {o.notes && <div style={{ fontSize: '8.5pt', fontStyle: 'italic' }}>{o.notes}</div>}
                  {o.prevDebt > 0.009 && <div style={{ fontSize: '9pt', fontWeight: 700 }}>Debe de antes: {money(o.prevDebt)}</div>}
                </td>
                <td style={{ ...td, ...right }}>{b ? qty(b) : ''}{b && l ? ' + ' : ''}{l ? `${qty(l)} u.` : ''}</td>
                <td style={{ ...td, ...right, fontWeight: 700 }}>{money(Number(o.total) || 0)}</td>
                <td style={{ ...td, height: '34px' }} />
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', breakInside: 'avoid' }}>
        <div style={{ minWidth: '240px', border: '1.5px solid #000', borderRadius: '4px', padding: '8px 12px', fontSize: '10pt', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Bultos</span><span>{qty(orders.reduce((s: number, o: any) => s + bultosOf(o), 0))}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5pt', fontWeight: 800 }}><span>A COBRAR</span><span>{money(total)}</span></div>
          {prevDebts > 0.009 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Deudas de antes</span><span>{money(prevDebts)}</span></div>}
        </div>
      </div>
      <Footer />
    </section>
  );
}

/** Los pedidos del reparto como si fueran ventas, para sacar su remito (y su nota) */
export const orderAsSale = (o: any, run: any) => ({
  saleNumber: o.orderNumber,
  createdAt: run?.date || o.createdAt,
  items: o.items || [],
  total: o.total,
  notes: o.notes,
  client: o.client,
});

export function RunRemitos({ run, emisor, codeOf, withNote, paper }: { run: any; emisor: Emisor; codeOf: (id: string) => string; withNote: boolean; paper?: boolean }) {
  const orders = liveOrders(run);
  return (
    <div style={paper ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' } : undefined}>
      {orders.map((o: any, i: number) => (
        <div key={o.id} style={!paper && i > 0 ? { breakBefore: 'page', pageBreakBefore: 'always' } : undefined}>
          <SalesNoteSheet sale={orderAsSale(o, run)} client={o.client} emisor={emisor} codeOf={codeOf} show={withNote ? 'both' : 'remito'} paper={paper} />
        </div>
      ))}
    </div>
  );
}
