import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  QrCode,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Facturación electrónica con ARCA.
 *
 * El comercio configura acá sus datos fiscales y ve el estado de cada comprobante.
 * La emisión en sí ocurre desde el POS (botón Facturar) o desde la cola: esta pantalla
 * es el tablero, no el mostrador.
 */

interface FiscalConfig {
  enabled: boolean;
  cuit: string;
  razonSocial: string;
  ivaCondition: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO';
  pointOfSale: number;
  environment: 'HOMOLOGACION' | 'PRODUCCION';
  certSource: 'DELEGATED' | 'OWN';
  autoInvoice: boolean;
  hasOwnCertificate: boolean;
  delegatedAvailable: boolean;
  delegatedCuit: string | null;
  lastError: string | null;
}

interface SaleRow {
  id: string;
  saleNumber: number;
  createdAt: string;
  total: number;
  invoiceStatus: 'NONE' | 'PENDING' | 'AUTHORIZED' | 'REJECTED';
  invoiceType: string | null;
  invoicePointOfSale: number | null;
  invoiceNumber: number | null;
  cae: string | null;
  caeExpiresAt: string | null;
  invoiceError: string | null;
  invoiceAttempts: number;
  receptorName: string | null;
  receptorDocNro: string | null;
  client?: { name: string } | null;
}

const ESTADOS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'Todas' },
  { key: 'PENDING', label: 'En cola' },
  { key: 'AUTHORIZED', label: 'Autorizadas' },
  { key: 'REJECTED', label: 'Rechazadas' },
  { key: 'NONE', label: 'Sin facturar' },
];

const plata = (n: number) => `$ ${(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const fecha = (v?: string | null) => (v ? new Date(v).toLocaleDateString('es-AR') : '—');
const nombreTipo = (t?: string | null) => (t ? t.replace('FACTURA_', 'Factura ').replace('NC_', 'N. Crédito ') : '—');
const numeroComprobante = (s: SaleRow) =>
  s.invoiceNumber ? `${String(s.invoicePointOfSale ?? 0).padStart(4, '0')}-${String(s.invoiceNumber).padStart(8, '0')}` : '—';

export default function FiscalScreen() {
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  const [form, setForm] = useState<Partial<FiscalConfig>>({});
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [resumen, setResumen] = useState<Record<string, number>>({});
  const [filtro, setFiltro] = useState('ALL');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [prueba, setPrueba] = useState<any | null>(null);

  const cargarConfig = useCallback(async () => {
    try {
      const { data } = await api.get('/fiscal/config');
      setConfig(data);
      setForm(data);
    } catch {
      toast.error('No se pudo leer la configuración fiscal');
    }
  }, []);

  const cargarVentas = useCallback(async (estado: string) => {
    try {
      const { data } = await api.get('/fiscal/sales', { params: { status: estado, limit: 60 } });
      setSales(data.sales || []);
      setResumen(data.resumen || {});
    } catch {
      toast.error('No se pudieron leer los comprobantes');
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([cargarConfig(), cargarVentas(filtro)]);
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cargando) cargarVentas(filtro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const { data } = await api.patch('/fiscal/config', {
        enabled: form.enabled,
        cuit: form.cuit,
        razonSocial: form.razonSocial,
        ivaCondition: form.ivaCondition,
        pointOfSale: form.pointOfSale,
        environment: form.environment,
        autoInvoice: form.autoInvoice,
      });
      setConfig(data);
      setForm(data);
      toast.success('Configuración fiscal guardada');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  const probar = async () => {
    setProbando(true);
    setPrueba(null);
    try {
      const { data } = await api.post('/fiscal/test');
      setPrueba({ ok: true, ...data });
      toast.success('Conexión con ARCA establecida');
    } catch (err: any) {
      setPrueba({ ok: false, message: err.response?.data?.message || 'No se pudo conectar' });
    } finally {
      setProbando(false);
    }
  };

  const procesarCola = async () => {
    setProcesando(true);
    try {
      const { data } = await api.post('/fiscal/pending/process');
      if (data.skipped) toast(`La facturación no está activada`, { icon: '🔒' });
      else if (data.processed === 0) toast.success('No hay comprobantes en cola');
      else toast.success(`${data.authorized} autorizados, ${data.failed} siguen en cola`);
      await cargarVentas(filtro);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo procesar la cola');
    } finally {
      setProcesando(false);
    }
  };

  const facturar = async (sale: SaleRow) => {
    const id = toast.loading(`Facturando la venta #${sale.saleNumber}...`);
    try {
      const { data } = await api.post(`/fiscal/sales/${sale.id}/invoice`, {});
      toast.success(`${nombreTipo(data.type)} ${String(data.pointOfSale).padStart(4, '0')}-${String(data.number).padStart(8, '0')} · CAE ${data.cae}`, { id, duration: 6000 });
      await cargarVentas(filtro);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo facturar', { id, duration: 7000 });
      await cargarVentas(filtro);
    }
  };

  if (cargando) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Cargando facturación...
      </div>
    );
  }

  const enProduccion = form.environment === 'PRODUCCION';
  const pendientes = resumen.PENDING || 0;
  const rechazadas = resumen.REJECTED || 0;

  const inputCls = 'w-full h-9 bg-white dark:bg-slate-850 border border-slate-300 dark:border-slate-700 rounded-lg px-3 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500 transition-all';
  const labelCls = 'block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 w-full h-full overflow-y-auto custom-scrollbar">
      <div className="flex items-center gap-3">
        <FileText className="w-7 h-7 text-emerald-600" />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">Facturación Electrónica</h2>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider mt-0.5">Comprobantes con CAE de ARCA</p>
        </div>
        <span
          className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${
            enProduccion
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
              : 'bg-amber-50 text-amber-700 border-amber-300'
          }`}
        >
          {enProduccion ? 'PRODUCCIÓN' : 'PRUEBAS (HOMOLOGACIÓN)'}
        </span>
      </div>

      {!enProduccion && (
        <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 flex items-start gap-2.5">
          <AlertCircle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-amber-900 dark:text-amber-200 leading-snug">
            Estás en el entorno de pruebas de ARCA. Los comprobantes que se emitan acá <strong>no tienen validez fiscal</strong>:
            sirven para verificar que todo funcione antes de pasar a producción.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Datos del comercio ── */}
        <div className="card p-5 space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <Settings className="w-4 h-4 text-emerald-500" /> Datos del comercio
          </h3>

          <label className="flex items-center justify-between cursor-pointer gap-3">
            <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
              Facturación activada
              <span className="block text-[11.5px] font-medium text-slate-500 leading-snug">
                Con esto apagado, el POS sigue vendiendo con ticket común.
              </span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(form.enabled)}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded-md border-slate-400 text-emerald-600 focus:ring-emerald-500 h-4.5 w-4.5 cursor-pointer shrink-0"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>CUIT</label>
              <input
                value={form.cuit || ''}
                onChange={(e) => setForm({ ...form, cuit: e.target.value })}
                placeholder="20123456789"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Punto de venta</label>
              <input
                type="number"
                value={form.pointOfSale ?? 1}
                onChange={(e) => setForm({ ...form, pointOfSale: Number(e.target.value) })}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Razón social</label>
            <input
              value={form.razonSocial || ''}
              onChange={(e) => setForm({ ...form, razonSocial: e.target.value })}
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Condición frente al IVA</label>
              <select
                value={form.ivaCondition || 'MONOTRIBUTO'}
                onChange={(e) => setForm({ ...form, ivaCondition: e.target.value as any })}
                className={inputCls}
              >
                <option value="MONOTRIBUTO">Monotributo (Factura C)</option>
                <option value="RESPONSABLE_INSCRIPTO">Responsable Inscripto (A y B)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Entorno</label>
              <select
                value={form.environment || 'HOMOLOGACION'}
                onChange={(e) => setForm({ ...form, environment: e.target.value as any })}
                className={inputCls}
              >
                <option value="HOMOLOGACION">Pruebas (homologación)</option>
                <option value="PRODUCCION">Producción</option>
              </select>
            </div>
          </div>

          <label className="flex items-center justify-between cursor-pointer gap-3">
            <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
              Facturar cada venta automáticamente
              <span className="block text-[11.5px] font-medium text-slate-500 leading-snug">
                Apagado, se factura sólo cuando el cliente la pide, desde el botón del POS.
              </span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(form.autoInvoice)}
              onChange={(e) => setForm({ ...form, autoInvoice: e.target.checked })}
              className="rounded-md border-slate-400 text-emerald-600 focus:ring-emerald-500 h-4.5 w-4.5 cursor-pointer shrink-0"
            />
          </label>

          <button
            onClick={guardar}
            disabled={guardando}
            className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[13px] font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Guardar configuración
          </button>
        </div>

        {/* ── Conexión ── */}
        <div className="card p-5 space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <Server className="w-4 h-4 text-emerald-500" /> Conexión con ARCA
          </h3>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${config?.delegatedAvailable || config?.hasOwnCertificate ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200">
                {config?.certSource === 'OWN' ? 'Certificado propio del comercio' : 'Certificado de Ventra (delegación)'}
              </span>
            </div>
            <p className="text-[11.5px] text-slate-600 dark:text-slate-400 leading-snug">
              {config?.certSource === 'OWN'
                ? config?.hasOwnCertificate
                  ? 'El comercio tiene su certificado cargado.'
                  : 'Falta cargar el certificado del comercio.'
                : config?.delegatedAvailable
                  ? `Este servidor firma con el certificado de Ventra (CUIT ${config.delegatedCuit}). El comercio sólo tiene que autorizar esa CUIT en ARCA.`
                  : 'Esta terminal no tiene el certificado: los comprobantes se emiten desde el servidor de Ventra y llegan acá por la sincronización.'}
            </p>
          </div>

          <button
            onClick={probar}
            disabled={probando}
            className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-850 disabled:opacity-50 text-[13px] font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {probando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Probar conexión (no emite nada)
          </button>

          {prueba && (
            <div
              className={`p-3 rounded-xl border text-[12px] leading-relaxed ${
                prueba.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 text-emerald-900 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 text-rose-900 dark:text-rose-200'
              }`}
            >
              {prueba.ok ? (
                <>
                  <p className="font-bold flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> ARCA responde</p>
                  <p>Servidores: app {prueba.servicios?.appServer}, base {prueba.servicios?.dbServer}, auth {prueba.servicios?.authServer}</p>
                  <p>Ticket de acceso vence: {new Date(prueba.ticketVence).toLocaleString('es-AR')}</p>
                  <p>Último comprobante en el punto de venta {prueba.puntoVenta}: <strong>{prueba.ultimoComprobante}</strong></p>
                </>
              ) : (
                <>
                  <p className="font-bold flex items-center gap-1.5"><XCircle className="w-4 h-4" /> No se pudo conectar</p>
                  <p>{prueba.message}</p>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { label: 'En cola', valor: pendientes, color: 'text-amber-600' },
              { label: 'Autorizadas', valor: resumen.AUTHORIZED || 0, color: 'text-emerald-600' },
              { label: 'Rechazadas', valor: rechazadas, color: 'text-rose-600' },
            ].map((c) => (
              <div key={c.label} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-center">
                <p className={`text-xl font-black ${c.color}`}>{c.valor}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{c.label}</p>
              </div>
            ))}
          </div>

          {pendientes > 0 && (
            <button
              onClick={procesarCola}
              disabled={procesando}
              className="w-full h-10 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-[13px] font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
              Reintentar los {pendientes} de la cola
            </button>
          )}
        </div>
      </div>

      {/* ── Comprobantes ── */}
      <div className="card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 flex-wrap">
          <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mr-2">
            <QrCode className="w-4 h-4 text-emerald-500" /> Comprobantes
          </h3>
          {ESTADOS.map((e) => (
            <button
              key={e.key}
              onClick={() => setFiltro(e.key)}
              className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold transition-colors cursor-pointer ${
                filtro === e.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-850 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500">
              <tr>
                {['Venta', 'Fecha', 'Cliente', 'Total', 'Comprobante', 'CAE', ''].map((h) => (
                  <th key={h} className="text-left font-bold uppercase tracking-wider text-[10px] px-4 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sales.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-850/50">
                  <td className="px-4 py-2 font-bold text-slate-800 dark:text-slate-200">#{s.saleNumber}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{fecha(s.createdAt)}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400 truncate max-w-[160px]">
                    {s.receptorName || s.client?.name || 'Consumidor final'}
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200">{plata(s.total)}</td>
                  <td className="px-4 py-2">
                    {s.invoiceStatus === 'AUTHORIZED' ? (
                      <span className="text-slate-800 dark:text-slate-200 font-semibold">
                        {nombreTipo(s.invoiceType)} {numeroComprobante(s)}
                      </span>
                    ) : s.invoiceStatus === 'PENDING' ? (
                      <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                        <Clock className="w-3.5 h-3.5" /> En cola ({s.invoiceAttempts})
                      </span>
                    ) : s.invoiceStatus === 'REJECTED' ? (
                      <span className="inline-flex items-center gap-1 text-rose-600 font-bold" title={s.invoiceError || ''}>
                        <XCircle className="w-3.5 h-3.5" /> Rechazada
                      </span>
                    ) : (
                      <span className="text-slate-400">Sin facturar</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11.5px] text-slate-600 dark:text-slate-400">
                    {s.cae ? (
                      <span title={`Vence ${fecha(s.caeExpiresAt)}`}>{s.cae}</span>
                    ) : s.invoiceError ? (
                      <span className="text-rose-500 font-sans truncate block max-w-[220px]" title={s.invoiceError}>{s.invoiceError}</span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {s.invoiceStatus !== 'AUTHORIZED' && (
                      <button
                        onClick={() => facturar(s)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11.5px] font-bold transition-colors cursor-pointer"
                      >
                        {s.invoiceStatus === 'NONE' ? 'Facturar' : 'Reintentar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">No hay ventas con ese estado</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
