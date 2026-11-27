import React from 'react';
import { c } from './marca';

// La factura del proveedor, en papel. Datos inventados.
// - Corta (5 renglones): videos de 10 y 15 s y la foto que "sube" la app (BoletaFoto → grabaciones/boleta.png).
// - Larga (20 renglones, src/boletas/boleta20.json): video de boletas; con `leidos` muestra la lectura de la IA
//   (línea que baja, renglón resaltado y tilde) y con `control` el "Suma = total" del final.
export const RENGLONES = [
  { cant: 12, desc: 'BON O BON BLANCO X 18 UN', unit: '6.825,00', imp: '81.900,00' },
  { cant: 24, desc: 'MOGUL MORAS X 150 GR', unit: '1.530,00', imp: '36.720,00' },
  { cant: 20, desc: 'MILKA AVELLANA X 100 GR', unit: '5.790,00', imp: '115.800,00' },
  { cant: 30, desc: 'TAKIS EXPLOSION X 85 GR', unit: '2.080,00', imp: '62.400,00' },
  { cant: 36, desc: 'TODDY GALLETITAS X 126 GR', unit: '580,00', imp: '20.880,00' },
];
type Renglon = { cant: number; desc: string; unit: string; imp: string };

const mono = "Consolas, 'Lucida Console', monospace";
export const pesos = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const ALTO_RENGLON = 44;
/** Dónde empieza el primer renglón, en px desde arriba del papel (para ubicar la lectura). */
export const PRIMER_RENGLON = 326;

const Tilde: React.FC<{ k: number }> = ({ k }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" style={{ position: 'absolute', right: -40, top: 7, opacity: k, scale: `${0.6 + 0.4 * k}` }}>
    <circle cx="12" cy="12" r="11" fill={c.menta} />
    <path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Boleta: React.FC<{ style?: React.CSSProperties; renglones?: Renglon[]; total?: string; alto?: number; leidos?: number; control?: number }> = ({
  style, renglones = RENGLONES, total = '317.700,00', alto = 860, leidos, control = 0,
}) => (
  <div
    style={{
      width: 720,
      height: alto,
      background: '#FBFAF6',
      color: '#23262B',
      fontFamily: mono,
      padding: '54px 50px',
      boxSizing: 'border-box',
      position: 'relative',
      boxShadow: '0 30px 60px -20px rgba(10,30,24,.35), 0 2px 6px rgba(10,30,24,.12)',
      ...style,
    }}
  >
    {/* pliegue del papel */}
    <div style={{ position: 'absolute', left: 0, right: 0, top: alto * 0.49, height: 2, background: 'linear-gradient(90deg, rgba(0,0,0,.035), rgba(0,0,0,.07), rgba(0,0,0,.03))' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 1 }}>DISTRIBUIDORA NORTE</div>
        <div style={{ fontSize: 19, marginTop: 6, color: '#555' }}>Golosinas · Almacén · Bebidas</div>
        <div style={{ fontSize: 19, color: '#555' }}>CUIT 30-71458236-9</div>
      </div>
      <div style={{ border: '3px solid #23262B', width: 74, height: 74, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 50, fontWeight: 700 }}>B</div>
    </div>
    <div style={{ marginTop: 26, display: 'flex', justifyContent: 'space-between', fontSize: 21 }}>
      <span>FACTURA 0003-00018427</span>
      <span>14/11/2026</span>
    </div>
    <div style={{ fontSize: 21, marginTop: 4 }}>Cliente: KIOSCO LOS PRIMOS</div>
    <div style={{ borderTop: '2px dashed #9AA', margin: '22px 0 12px' }} />
    <div style={{ display: 'grid', gridTemplateColumns: '54px 1fr 128px 150px', fontSize: 18, color: '#666', marginBottom: 8 }}>
      <span>CANT</span>
      <span>DESCRIPCIÓN</span>
      <span style={{ textAlign: 'right' }}>P. UNIT</span>
      <span style={{ textAlign: 'right' }}>IMPORTE</span>
    </div>
    {renglones.map((r, i) => {
      // lectura: el renglón se resalta mientras pasa la línea y queda con su tilde
      const k = leidos == null ? 0 : Math.max(0, Math.min(1, (leidos - i) * 2.2));
      const pasando = leidos != null && leidos > i && leidos < i + 1.4;
      return (
        <div key={r.desc + i} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 128px 150px', fontSize: 20, lineHeight: `${ALTO_RENGLON}px`, position: 'relative',
          background: pasando ? 'rgba(52,172,126,.16)' : 'transparent', margin: '0 -10px', padding: '0 10px', borderRadius: 6 }}>
          <span>{r.cant}</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{r.desc}</span>
          <span style={{ textAlign: 'right' }}>{r.unit}</span>
          <span style={{ textAlign: 'right' }}>{r.imp}</span>
          {leidos != null && <Tilde k={k} />}
        </div>
      );
    })}
    <div style={{ borderTop: '2px dashed #9AA', margin: '18px 0 14px' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 30, fontWeight: 700, position: 'relative' }}>
      <span>TOTAL</span>
      <span style={{ outline: control ? `4px solid rgba(52,172,126,${control})` : 'none', outlineOffset: 6, borderRadius: 4 }}>$ {total}</span>
    </div>
    <div style={{ marginTop: 34, fontSize: 18, color: '#666' }}>Cond. de venta: Cuenta corriente 15 días</div>
    <div style={{ fontSize: 18, color: '#666' }}>Recibí conforme: ......................</div>
    {/* línea de lectura */}
    {leidos != null && leidos > 0 && leidos < renglones.length && (
      <div style={{ position: 'absolute', left: 20, right: 20, top: PRIMER_RENGLON + leidos * ALTO_RENGLON, height: 4, borderRadius: 2,
        background: c.menta, boxShadow: `0 0 18px 4px ${c.menta}88` }} />
    )}
  </div>
);
