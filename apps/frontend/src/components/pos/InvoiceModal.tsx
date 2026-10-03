import { useEffect, useRef, useState } from 'react';
import { X, FileText, Loader2, CheckCircle2, AlertCircle, User, Clock } from 'lucide-react';
import QRCode from 'qrcode';
import api from '../../services/api';

interface InvoiceModalProps {
  saleId: string;
  saleNumber?: number;
  total: number;
  /** Datos que ya se conocen del cliente de la venta */
  cliente?: { name?: string; cuit?: string | null; dni?: string | null; ivaCondition?: string | null } | null;
  onClose: () => void;
  /** Avisa el comprobante emitido y su QR ya dibujado, para imprimirlo */
  onEmitted?: (comprobante: any, qrDataUrl: string | null) => void;
  /** El comprobante quedó en cola (sin conexión o ARCA lento): se emite solo después */
  onQueued?: (comprobante: any) => void;
}

type TipoDoc = 'CF' | 'DNI' | 'CUIT';

export const nombreComprobante = (t?: string | null) =>
  (t || '').replace('FACTURA_', 'Factura ').replace('NC_', 'Nota de crédito ');
export const numeroComprobante = (pv?: number | null, n?: number | null) =>
  `${String(pv ?? 0).padStart(5, '0')}-${String(n ?? 0).padStart(8, '0')}`;

/** El QR del comprobante como imagen, listo para el ticket. */
export const qrImagen = (url?: string | null) =>
  url ? QRCode.toDataURL(url, { width: 240, margin: 1 }).catch(() => null) : Promise.resolve(null);

/**
 * Pide el comprobante de una venta ya cobrada.
 *
 * Por defecto va a consumidor final, que es la venta de mostrador: sólo se piden
 * datos si el cliente los da. La venta ya está cerrada, así que nada de acá puede
 * hacerla fallar: si ARCA no responde, el comprobante queda en cola y sale solo.
 */
export default function InvoiceModal({ saleId, saleNumber, total, cliente, onClose, onEmitted, onQueued }: InvoiceModalProps) {
  const [tipoDoc, setTipoDoc] = useState<TipoDoc>(cliente?.cuit ? 'CUIT' : cliente?.dni ? 'DNI' : 'CF');
  const [documento, setDocumento] = useState(cliente?.cuit || cliente?.dni || '');
  const [nombre, setNombre] = useState(cliente?.name || '');
  const [ivaCondition, setIvaCondition] = useState(cliente?.ivaCondition || (cliente?.cuit ? 'RESPONSABLE_INSCRIPTO' : 'CONSUMIDOR_FINAL'));
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (resultado?.qrUrl && qrRef.current) {
      QRCode.toCanvas(qrRef.current, resultado.qrUrl, { width: 132, margin: 1 }, () => {});
    }
  }, [resultado]);

  const docLimpio = documento.replace(/\D/g, '');
  const docValido = tipoDoc === 'CF' || (tipoDoc === 'DNI' ? docLimpio.length >= 7 && docLimpio.length <= 8 : docLimpio.length === 11);

  const emitir = async () => {
    setEmitiendo(true);
    setError(null);
    try {
      const body: any = {};
      if (tipoDoc === 'CUIT') body.cuit = docLimpio;
      if (tipoDoc === 'DNI') body.dni = docLimpio;
      if (nombre.trim()) body.name = nombre.trim();
      body.ivaCondition = tipoDoc === 'CF' ? 'CONSUMIDOR_FINAL' : ivaCondition;

      const { data } = await api.post(`/fiscal/sales/${saleId}/invoice`, body);
      if (data.status === 'AUTHORIZED') {
        setResultado(data);
        onEmitted?.(data, await qrImagen(data.qrUrl));
      } else if (data.status === 'PENDING') {
        setResultado(data);
        onQueued?.(data);
      } else {
        // Rechazada: ARCA dice qué dato está mal; se corrige acá y se vuelve a pedir
        setError(data.error || 'ARCA rechazó el comprobante');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudo emitir el comprobante');
    } finally {
      setEmitiendo(false);
    }
  };

  const inputCls = 'w-full h-10 bg-white dark:bg-slate-850 border border-slate-300 dark:border-slate-700 rounded-xl px-3 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500 transition-all';
  const labelCls = 'block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1';
  const autorizada = resultado?.status === 'AUTHORIZED';
  const enCola = resultado?.status === 'PENDING';

  return (
    <div className="fixed inset-0 z-[130] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-black text-slate-900 dark:text-slate-50 leading-tight">
                {autorizada ? 'Comprobante emitido' : enCola ? 'Comprobante en cola' : 'Facturar'}
              </h2>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                {saleNumber ? `Venta #${saleNumber} · ` : ''}$ {total.toLocaleString('es-AR')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar space-y-4">
          {autorizada ? (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <span className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border-4 border-emerald-100 dark:border-emerald-900 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 className="w-7 h-7" />
                </span>
              </div>
              <div>
                <p className="text-lg font-black text-slate-900 dark:text-slate-50">
                  {nombreComprobante(resultado.type)} {numeroComprobante(resultado.pointOfSale, resultado.number)}
                </p>
                <p className="text-[12.5px] font-mono text-slate-600 dark:text-slate-400 mt-1">CAE {resultado.cae}</p>
                <p className="text-[11.5px] text-slate-500">
                  Vence el {resultado.caeExpiresAt ? new Date(resultado.caeExpiresAt).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—'}
                </p>
                {resultado.environment === 'HOMOLOGACION' && (
                  <p className="mt-2 inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Comprobante de prueba</p>
                )}
              </div>
              {resultado.qrUrl && (
                <div className="flex flex-col items-center gap-1.5">
                  <canvas ref={qrRef} className="rounded-lg border border-slate-200" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">QR del comprobante</span>
                </div>
              )}
              <button
                onClick={onClose}
                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-all cursor-pointer"
              >
                Listo
              </button>
            </div>
          ) : enCola ? (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <span className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-950/40 border-4 border-amber-100 dark:border-amber-900 flex items-center justify-center text-amber-600">
                  <Clock className="w-7 h-7" />
                </span>
              </div>
              <div className="space-y-1.5">
                <p className="text-[14px] font-bold text-slate-900 dark:text-slate-50">La factura sale sola en cuanto ARCA responda</p>
                <p className="text-[12.5px] text-slate-600 dark:text-slate-400 leading-snug">
                  La venta está cerrada y el comprobante quedó en cola en esta caja. Cuando se emita lo vas a ver en
                  <strong> Facturación</strong>, desde donde se reimprime.
                </p>
                {resultado.error && <p className="text-[11.5px] text-slate-500 leading-snug">Detalle: {resultado.error}</p>}
              </div>
              <button
                onClick={onClose}
                className="w-full h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold transition-all cursor-pointer"
              >
                Entendido
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className={labelCls}>¿A nombre de quién?</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { k: 'CF', t: 'Consumidor final' },
                    { k: 'DNI', t: 'Con DNI' },
                    { k: 'CUIT', t: 'Con CUIT' },
                  ] as { k: TipoDoc; t: string }[]).map((o) => (
                    <button
                      key={o.k}
                      onClick={() => {
                        setTipoDoc(o.k);
                        if (o.k === 'DNI' && ivaCondition === 'RESPONSABLE_INSCRIPTO') setIvaCondition('CONSUMIDOR_FINAL');
                      }}
                      className={`px-2 py-2.5 rounded-xl border-2 text-[11.5px] font-bold transition-all cursor-pointer ${
                        tipoDoc === o.k
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                          : 'border-slate-250 dark:border-slate-750 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {o.t}
                    </button>
                  ))}
                </div>
              </div>

              {tipoDoc !== 'CF' && (
                <>
                  <div>
                    <label className={labelCls}>{tipoDoc === 'CUIT' ? 'CUIT' : 'DNI'}</label>
                    <input
                      autoFocus
                      inputMode="numeric"
                      value={documento}
                      onChange={(e) => setDocumento(e.target.value)}
                      placeholder={tipoDoc === 'CUIT' ? '30-71234567-1' : '35123456'}
                      className={inputCls}
                    />
                    {documento && !docValido && (
                      <p className="text-[11px] text-red-600 mt-1">{tipoDoc === 'CUIT' ? 'La CUIT tiene 11 números' : 'El DNI tiene 7 u 8 números'}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Nombre o razón social</label>
                    <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Condición frente al IVA</label>
                    <select value={ivaCondition} onChange={(e) => setIvaCondition(e.target.value)} className={inputCls}>
                      <option value="CONSUMIDOR_FINAL">Consumidor final</option>
                      {tipoDoc === 'CUIT' && <option value="RESPONSABLE_INSCRIPTO">Responsable inscripto</option>}
                      <option value="MONOTRIBUTO">Monotributo</option>
                      <option value="EXENTO">Exento</option>
                      <option value="NO_CATEGORIZADO">No categorizado</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                      Define si corresponde factura A o B. Va impresa en el comprobante.
                    </p>
                  </div>
                </>
              )}

              {tipoDoc === 'CF' && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-start gap-2.5">
                  <User className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-[12px] text-slate-600 dark:text-slate-400 leading-snug">
                    Se emite a consumidor final, sin datos del cliente. Es lo habitual en el mostrador.
                  </p>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-[12px] text-red-800 dark:text-red-300 leading-snug">{error}</p>
                </div>
              )}

              <button
                onClick={emitir}
                disabled={emitiendo || !docValido}
                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                {emitiendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {emitiendo ? 'Pidiendo el CAE a ARCA...' : error ? 'Volver a intentar' : 'Emitir comprobante'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
