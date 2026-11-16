import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import DocumentPreview from '../common/DocumentPreview';
import { loadEmisor, MissingStoreNameError, type Emisor } from '../pos/SalesNoteSheet';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: any) => (d ? new Date(d).toLocaleDateString('es-AR') : '—');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const IVA: Record<string, string> = { RESPONSABLE_INSCRIPTO: 'Responsable inscripto', MONOTRIBUTO: 'Monotributo', EXENTO: 'Exento', CONSUMIDOR_FINAL: 'Consumidor final', NO_CATEGORIZADO: 'No categorizado' };

// Mismo lenguaje visual que el presupuesto A4: tinta oscura, grises y bandas suaves (sale bien en blanco y negro)
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const BAND = '#f3f4f6';
const ACCENT = '#1f2937';
const label = { fontSize: '7pt', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED } as const;
const cell = { padding: '6px 7px', fontSize: '9pt', verticalAlign: 'top', borderBottom: `1px solid ${LINE}` } as const;
const headCell = { padding: '7px 7px', fontSize: '7.5pt', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fff', background: ACCENT, textAlign: 'left' } as const;
const right = { textAlign: 'right', whiteSpace: 'nowrap' } as const;

/** Períodos del resumen */
function range(key: string) {
  const d = new Date();
  if (key === 'ant') return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1), to: new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, -1), label: `${MONTHS[(d.getMonth() + 11) % 12]}` };
  if (key === '3m') return { from: new Date(d.getFullYear(), d.getMonth() - 2, 1), to: d, label: 'últimos 3 meses' };
  if (key === 'todo') return { from: new Date(2000, 0, 1), to: d, label: 'todos los movimientos' };
  return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: d, label: MONTHS[d.getMonth()] };
}

/** Resumen de cuenta en una hoja A4: saldo anterior, compras, pagos, saldo de cada día y saldo final */
export function StatementSheet({ data, emisor, paper }: { data: any; emisor: Emisor; paper?: boolean }) {
  const c = data.client;
  const contact = [emisor.domicilio, emisor.phone && `Tel. ${emisor.phone}`].filter(Boolean);
  const fiscal = [emisor.cuit && `CUIT ${emisor.cuit}`, emisor.iibb && `IIBB ${emisor.iibb}`].filter(Boolean);
  const owes = data.closing > 0.009;
  return (
    <section data-sheet="resumen-cuenta" style={{
      width: '100%', color: INK, background: '#fff', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      ...(paper ? { width: '210mm', minHeight: '297mm', padding: '15mm 16mm 12mm', boxShadow: '0 4px 18px rgba(15,23,42,.18)', borderRadius: '2px', margin: '0 auto' } : {}),
    } as any}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          {emisor.logo && <img src={emisor.logo} alt="" style={{ width: 'auto', height: 'auto', maxWidth: '50mm', maxHeight: '22mm', objectFit: 'contain', flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: emisor.logo ? '14pt' : '18pt', fontWeight: 800, lineHeight: 1.15 }}>{emisor.name}</div>
            {emisor.razonSocial && emisor.razonSocial !== emisor.name && <div style={{ fontSize: '8.5pt', color: '#374151', marginTop: '2px' }}>{emisor.razonSocial}</div>}
            {contact.length > 0 && <div style={{ fontSize: '8.5pt', color: MUTED, marginTop: '3px' }}>{contact.join('  ·  ')}</div>}
            {fiscal.length > 0 && <div style={{ fontSize: '8pt', color: MUTED, marginTop: '1px' }}>{fiscal.join('  ·  ')}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '17pt', fontWeight: 800, letterSpacing: '0.06em', color: ACCENT, lineHeight: 1.05 }}>RESUMEN<br />DE CUENTA</div>
          <div style={{ fontSize: '8pt', color: MUTED, marginTop: '4px' }}>Del {day(data.from)} al {day(data.to)}</div>
        </div>
      </div>

      <div style={{ height: '3px', background: ACCENT, marginTop: '12px' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '12px', marginTop: '12px' }}>
        <div style={{ background: BAND, borderRadius: '6px', padding: '10px 12px' }}>
          <div style={label}>Cliente</div>
          <div style={{ fontSize: '12pt', fontWeight: 700, marginTop: '3px' }}>{c.name}</div>
          <div style={{ fontSize: '8.5pt', color: '#374151', marginTop: '2px' }}>
            {[c.cuit ? `CUIT ${c.cuit}` : c.dni ? `DNI ${c.dni}` : null, IVA[c.ivaCondition] || null].filter(Boolean).join('  ·  ')}
          </div>
          {(c.address || c.locality) && <div style={{ fontSize: '8.5pt', color: MUTED, marginTop: '1px' }}>{[c.address, c.locality].filter(Boolean).join(', ')}</div>}
        </div>
        <div style={{ background: BAND, borderRadius: '6px', padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div><div style={label}>Saldo anterior</div><div style={{ fontSize: '10.5pt', fontWeight: 700, marginTop: '3px' }}>{money(data.opening)}</div></div>
          <div><div style={label}>Emitido</div><div style={{ fontSize: '10.5pt', fontWeight: 600, marginTop: '3px' }}>{day(new Date())}</div></div>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
        <thead>
          <tr>
            <th style={{ ...headCell, width: '62px', borderTopLeftRadius: '4px' }}>Fecha</th>
            <th style={headCell}>Concepto</th>
            <th style={{ ...headCell, ...right, width: '86px' }}>Compras</th>
            <th style={{ ...headCell, ...right, width: '86px' }}>Pagos</th>
            <th style={{ ...headCell, ...right, width: '92px', borderTopRightRadius: '4px' }}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: '#fafafa' }}>
            <td style={{ ...cell, color: MUTED }}>{day(data.from)}</td>
            <td style={{ ...cell, color: MUTED, fontStyle: 'italic' }}>Saldo anterior</td>
            <td style={cell} /><td style={cell} />
            <td style={{ ...cell, ...right, fontWeight: 700 }}>{money(data.opening)}</td>
          </tr>
          {data.rows.map((r: any, i: number) => (
            <tr key={r.id} style={{ background: i % 2 ? '#fafafa' : '#fff' }}>
              <td style={{ ...cell, color: '#374151', whiteSpace: 'nowrap' }}>{day(r.date)}</td>
              <td style={cell}>
                <div style={{ fontWeight: 600 }}>{r.concept}{r.invoice ? <span style={{ fontWeight: 400, color: MUTED }}>  ·  {r.invoice}</span> : null}</div>
                {(r.detail || r.pickedUpBy) && <div style={{ fontSize: '8pt', color: MUTED, marginTop: '1px' }}>{[r.detail, r.pickedUpBy && `Retiró: ${r.pickedUpBy}`].filter(Boolean).join('  ·  ')}</div>}
              </td>
              <td style={{ ...cell, ...right }}>{r.charge ? money(r.charge) : ''}</td>
              <td style={{ ...cell, ...right }}>{r.credit ? money(r.credit) : ''}</td>
              <td style={{ ...cell, ...right, fontWeight: 700 }}>{money(r.balance)}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr><td colSpan={5} style={{ ...cell, textAlign: 'center', color: MUTED, padding: '16px' }}>Sin movimientos en este período.</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
        <div style={{ width: '80mm' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt' }}>
            <tbody>
              <tr><td style={{ padding: '3px 8px', color: MUTED }}>Saldo anterior</td><td style={{ padding: '3px 8px', ...right }}>{money(data.opening)}</td></tr>
              <tr><td style={{ padding: '3px 8px', color: MUTED }}>Compras del período</td><td style={{ padding: '3px 8px', ...right }}>+ {money(data.charges)}</td></tr>
              <tr><td style={{ padding: '3px 8px', color: MUTED }}>Pagos y devoluciones</td><td style={{ padding: '3px 8px', ...right }}>- {money(data.credits)}</td></tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', background: ACCENT, color: '#fff', borderRadius: '6px', padding: '9px 12px', marginTop: '6px' }}>
            <span style={{ fontSize: '8.5pt', fontWeight: 700, letterSpacing: '0.12em' }}>{owes ? 'SALDO A PAGAR' : data.closing < -0.009 ? 'SALDO A FAVOR' : 'SALDO'}</span>
            <span style={{ fontSize: '15pt', fontWeight: 800 }}>{money(Math.abs(data.closing))}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: paper ? 'auto' : '18px', paddingTop: '18px' }}>
        <div style={{ fontSize: '8pt', color: MUTED, lineHeight: 1.5 }}>
          Resumen de los movimientos de la cuenta corriente al {day(data.to)}. Documento no válido como factura.
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', borderTop: `1px solid ${LINE}`, marginTop: '10px', paddingTop: '7px', fontSize: '7.5pt', color: '#9ca3af' }}>
          <span>{[emisor.name, ...contact].join('  ·  ')}</span>
          <span style={{ flexShrink: 0 }}>Hecho con Ventra · ventra.store</span>
        </div>
      </div>
    </section>
  );
}

/** Vista previa del resumen de cuenta: elegir el período, imprimir, PDF o mandarlo por WhatsApp */
export function StatementPreview({ client, onClose }: { client: any; onClose: () => void }) {
  const [emisor, setEmisor] = useState<Emisor | null>(null);
  const [period, setPeriod] = useState('mes');
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    loadEmisor().then(setEmisor).catch((err) => {
      toast.error(err instanceof MissingStoreNameError ? 'Cargá el nombre del comercio en Configuración para imprimir' : 'No se pudo armar el resumen');
      onClose();
    });
  }, []);
  useEffect(() => {
    setData(null);
    const r = range(period);
    api.get(`/clients/${client.id}/statement`, { params: { from: r.from.toISOString(), to: r.to.toISOString() } })
      .then((res) => setData(res.data))
      .catch(() => { toast.error('No se pudo traer la cuenta'); onClose(); });
  }, [period, client.id]);
  if (!emisor) return null;
  const r = range(period);
  return (
    <DocumentPreview
      title="Resumen de cuenta"
      subtitle={`${client.name} · ${r.label}`}
      options={[{ key: 'mes', label: 'Este mes' }, { key: 'ant', label: 'Mes pasado' }, { key: '3m', label: 'Últimos 3 meses' }, { key: 'todo', label: 'Todo' }]}
      option={period}
      onOption={setPeriod}
      loading={!data}
      printable={!!data}
      fileName={`Resumen_${String(client.name).replace(/[^\w]+/g, '_')}_${r.label.replace(/\s+/g, '_')}`}
      whatsapp={data ? { phone: client.phone, text: `Hola! Te mando el resumen de tu cuenta (${r.label}). ${data.closing > 0.009 ? `Saldo a pagar: ${money(data.closing)}.` : 'Estás al día.'}` } : undefined}
      render={(paper) => data ? <StatementSheet data={data} emisor={emisor} paper={paper} /> : null}
      onClose={onClose}
    />
  );
}
