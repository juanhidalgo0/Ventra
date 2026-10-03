import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Undo2,
  XCircle,
} from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import InvoiceModal, { nombreComprobante, numeroComprobante } from '../pos/InvoiceModal';
import FiscalDocModal, { formatPrice } from '../fiscal/FiscalDocModal';

/**
 * Facturación electrónica con ARCA.
 *
 * El comercio configura acá sus datos fiscales, autoriza a Ventra en ARCA (guía paso a
 * paso) y ve el estado de cada comprobante. La emisión ocurre en el POS o sola, por la cola:
 * esta pantalla es el tablero, no el mostrador.
 */

interface FiscalConfig {
  enabled: boolean;
  cuit: string;
  razonSocial: string;
  domicilio: string;
  iibb: string;
  inicioActividades: string | null;
  ivaCondition: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO';
  defaultIvaRate: number;
  pointOfSale: number;
  environment: 'HOMOLOGACION' | 'PRODUCCION';
  certSource: 'DELEGATED' | 'OWN';
  autoInvoice: boolean;
  transport: 'gateway' | 'direct' | 'own';
  ventraCuit: string | null;
  ventraAvailable: boolean | null;
  linked: boolean;
  node: number;
  lastError: string | null;
}

interface Doc {
  id: string;
  saleId: string;
  saleNumber: number | null;
  saleTotal: number | null;
  kind: 'FACTURA' | 'NOTA_CREDITO';
  status: 'PENDING' | 'AUTHORIZED' | 'REJECTED' | 'VOID';
  type: string | null;
  pointOfSale: number;
  number: number | null;
  cae: string | null;
  caeExpiresAt: string | null;
  issueDate: string | null;
  total: number;
  environment: string;
  receptor: { docTipo: number; docNro: string; name: string | null; ivaCondition: string };
  assoc: { type: string; pointOfSale: number; number: number } | null;
  creditedBy: { id: string; status: string; number: number | null; pointOfSale: number; type: string } | null;
  error: string | null;
  errorKind: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  ownerNode: number;
  mine: boolean;
  verifying: boolean;
  createdAt: string;
}

interface UninvoicedSale {
  id: string;
  saleNumber: number;
  createdAt: string;
  total: number;
  client: { name: string; cuit: string | null; dni: string | null; ivaCondition: string } | null;
}

interface Check { key: string; label: string; ok: boolean; level: 'ok' | 'warn' | 'error'; detail: string }

const TABS: { key: string; label: string; params?: Record<string, string> }[] = [
  { key: 'ALL', label: 'Todos' },
  { key: 'PENDING', label: 'En cola', params: { status: 'PENDING' } },
  { key: 'REJECTED', label: 'Rechazados', params: { status: 'REJECTED' } },
  { key: 'AUTHORIZED', label: 'Facturas', params: { status: 'AUTHORIZED', kind: 'FACTURA' } },
  { key: 'NC', label: 'Notas de crédito', params: { kind: 'NOTA_CREDITO' } },
  { key: 'UNINVOICED', label: 'Ventas sin facturar' },
];

const fechaAr = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const hora = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '');
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const primeroDelMes = () => `${hoyIso().slice(0, 8)}01`;
const docReceptor = (r: Doc['receptor']) =>
  r.docNro && r.docNro !== '0' ? `${r.name || ''} (${r.docTipo === 80 ? 'CUIT' : 'DNI'} ${r.docNro})`.trim() : r.name || 'Consumidor final';

export default function FiscalScreen() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'ADMIN');
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  const [form, setForm] = useState<Partial<FiscalConfig>>({});
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uninvoiced, setUninvoiced] = useState<UninvoicedSale[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [tab, setTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoyIso());
  const [cargando, setCargando] = useState(true);
  const [listando, setListando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [prueba, setPrueba] = useState<{ ok: boolean; checks: Check[] } | null>(null);
  const [verDoc, setVerDoc] = useState<string | null>(null);
  const [facturar, setFacturar] = useState<{ saleId: string; saleNumber: number; total: number; cliente?: any } | null>(null);
  const [guiaAbierta, setGuiaAbierta] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const cargarConfig = useCallback(async () => {
    try {
      const { data } = await api.get('/fiscal/config');
      setConfig(data);
      setForm({ ...data, inicioActividades: data.inicioActividades ? String(data.inicioActividades).slice(0, 10) : '' });
      // Sin la delegación hecha todavía, la guía arranca abierta
      if (!data.enabled) setGuiaAbierta(true);
    } catch {
      toast.error('No se pudo leer la configuración fiscal');
    }
  }, []);

  const cargarLista = useCallback(async () => {
    setListando(true);
    try {
      const rango = { from: `${desde}T00:00:00-03:00`, to: `${hasta}T23:59:59-03:00` };
      if (tab === 'UNINVOICED') {
        const { data } = await api.get('/fiscal/uninvoiced', { params: rango });
        setUninvoiced(data || []);
      } else {
        const def = TABS.find((t) => t.key === tab);
        const { data } = await api.get('/fiscal/documents', { params: { ...def?.params, ...rango, search: search.trim() || undefined, limit: 300 } });
        setDocs(data.documents || []);
        setSummary(data.summary || {});
      }
    } catch {
      toast.error('No se pudieron leer los comprobantes');
    } finally {
      setListando(false);
    }
  }, [tab, desde, hasta, search]);

  useEffect(() => {
    (async () => {
      await Promise.all([cargarConfig(), cargarLista()]);
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cargando) return;
    const t = setTimeout(cargarLista, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, desde, hasta, search]);

  // Mientras haya algo en cola, la lista se refresca sola
  useEffect(() => {
    if (!summary.PENDING) return;
    const t = setInterval(cargarLista, 15000);
    return () => clearInterval(t);
  }, [summary.PENDING, cargarLista]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const { data } = await api.patch('/fiscal/config', {
        enabled: form.enabled,
        cuit: form.cuit,
        razonSocial: form.razonSocial,
        domicilio: form.domicilio,
        iibb: form.iibb,
        inicioActividades: form.inicioActividades || null,
        ivaCondition: form.ivaCondition,
        defaultIvaRate: form.defaultIvaRate,
        pointOfSale: form.pointOfSale,
        environment: form.environment,
        autoInvoice: form.autoInvoice,
      });
      setConfig(data);
      setForm({ ...data, inicioActividades: data.inicioActividades ? String(data.inicioActividades).slice(0, 10) : '' });
      toast.success('Configuración fiscal guardada');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar', { duration: 6000 });
    } finally {
      setGuardando(false);
    }
  };

  const probar = async () => {
    setProbando(true);
    setPrueba(null);
    try {
      const { data } = await api.post('/fiscal/test');
      setPrueba(data);
      if (data.ok) toast.success('Todo listo para facturar');
      cargarConfig();
    } catch (err: any) {
      setPrueba({ ok: false, checks: [{ key: 'x', label: 'Conexión', ok: false, level: 'error', detail: err.response?.data?.message || 'No se pudo probar la conexión' }] });
    } finally {
      setProbando(false);
    }
  };

  const procesarCola = async () => {
    setProcesando(true);
    try {
      const { data } = await api.post('/fiscal/queue/process');
      toast.success(data.pending ? `Quedan ${data.pending} en cola` : 'Cola al día');
      await cargarLista();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo procesar la cola');
    } finally {
      setProcesando(false);
    }
  };

  const accion = async (doc: Doc, tipo: 'retry' | 'credit-note' | 'take-over') => {
    if (tipo === 'credit-note' && !window.confirm(`Se va a emitir una nota de crédito que anula la ${nombreComprobante(doc.type)} ${numeroComprobante(doc.pointOfSale, doc.number)} por ${formatPrice(doc.total)}. La venta no se modifica. ¿Seguimos?`)) return;
    if (tipo === 'take-over' && !window.confirm(`Este comprobante lo estaba emitiendo la caja #${doc.ownerNode}. Pasalo a esta caja solo si aquella no va a volver (se rompió o se reinstaló): antes de pedir un número nuevo se revisa en ARCA el que haya usado. ¿Seguimos?`)) return;
    setBusy(doc.id);
    const aviso = toast.loading(tipo === 'credit-note' ? 'Emitiendo la nota de crédito...' : 'Pidiendo el CAE a ARCA...');
    try {
      const { data } = await api.post(`/fiscal/documents/${encodeURIComponent(doc.id)}/${tipo}`, {});
      if (data.status === 'AUTHORIZED') toast.success(`${nombreComprobante(data.type)} ${numeroComprobante(data.pointOfSale, data.number)} autorizada`, { id: aviso });
      else if (data.status === 'PENDING') toast(`Quedó en cola: ${data.error || 'ARCA no respondió todavía'}`, { id: aviso, icon: '⏳', duration: 6000 });
      else toast.error(data.error || 'ARCA lo rechazó', { id: aviso, duration: 7000 });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo completar', { id: aviso, duration: 7000 });
    } finally {
      setBusy(null);
      cargarLista();
    }
  };

  const exportar = async () => {
    try {
      const { data } = await api.get('/fiscal/documents/export', { params: { from: desde, to: hasta }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `comprobantes_${desde}_${hasta}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      toast.error('No se pudo exportar');
    }
  };

  const copiar = (texto: string) => {
    navigator.clipboard?.writeText(texto).then(() => toast.success('Copiado')).catch(() => {});
  };

  const trabadas = summary.CONFIG || 0;
  const errorTrabado = useMemo(() => docs.find((d) => d.status === 'PENDING' && d.errorKind === 'CONFIG')?.error || config?.lastError, [docs, config]);

  if (cargando) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Cargando facturación...
      </div>
    );
  }

  const enProduccion = form.environment === 'PRODUCCION';
  const esRI = form.ivaCondition === 'RESPONSABLE_INSCRIPTO';
  const ventraCuit = config?.ventraCuit;
  const inputCls = 'w-full h-9 bg-white dark:bg-slate-850 border border-slate-300 dark:border-slate-700 rounded-lg px-3 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500 transition-all';
  const dateCls = 'h-9 w-[150px] bg-white dark:bg-slate-850 border border-slate-300 dark:border-slate-700 rounded-lg px-2 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500';
  const labelCls = 'block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1';
  const cardCls = 'card p-5 space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl';
  const titleCls = 'text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5 w-full h-full overflow-y-auto custom-scrollbar">
      <div className="flex items-center gap-3 flex-wrap">
        <FileText className="w-7 h-7 text-emerald-600" />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">Facturación Electrónica</h2>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider mt-0.5">Comprobantes con CAE de ARCA</p>
        </div>
        <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${config?.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>
          {config?.enabled ? 'ACTIVADA' : 'DESACTIVADA'}
        </span>
        <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${config?.environment === 'PRODUCCION' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-amber-50 text-amber-700 border-amber-300'}`}>
          {config?.environment === 'PRODUCCION' ? 'PRODUCCIÓN' : 'PRUEBAS (HOMOLOGACIÓN)'}
        </span>
      </div>

      {config?.environment !== 'PRODUCCION' && (
        <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 flex items-start gap-2.5">
          <AlertCircle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-amber-900 dark:text-amber-200 leading-snug">
            Estás en el entorno de pruebas de ARCA. Los comprobantes que se emitan acá <strong>no tienen validez fiscal</strong>:
            sirven para verificar que todo funcione antes de pasar a producción.
          </p>
        </div>
      )}

      {config?.enabled && trabadas > 0 && (
        <div className="p-3.5 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-[13px] font-bold text-red-900 dark:text-red-200">
              {trabadas === 1 ? 'Hay 1 comprobante esperando' : `Hay ${trabadas} comprobantes esperando`} que se corrija algo de la configuración
            </p>
            {errorTrabado && <p className="text-[12px] text-red-800 dark:text-red-300 leading-snug">{errorTrabado}</p>}
            <p className="text-[11.5px] text-red-700 dark:text-red-400">Las ventas siguen normalmente. Cuando lo resuelvas, los comprobantes salen solos.</p>
          </div>
          {isAdmin && (
            <button onClick={probar} disabled={probando} className="shrink-0 px-3 h-9 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[12px] font-bold cursor-pointer disabled:opacity-50">
              Probar conexión
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Datos del comercio ── */}
        <div className={cardCls}>
          <h3 className={titleCls}><Settings className="w-4 h-4 text-emerald-500" /> Datos del comercio</h3>

          <label className="flex items-center justify-between cursor-pointer gap-3">
            <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
              Facturación activada
              <span className="block text-[11.5px] font-medium text-slate-500 leading-snug">Con esto apagado, el POS sigue vendiendo con ticket común.</span>
            </span>
            <input type="checkbox" disabled={!isAdmin} checked={Boolean(form.enabled)} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded-md border-slate-400 text-emerald-600 focus:ring-emerald-500 h-4.5 w-4.5 cursor-pointer shrink-0" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>CUIT</label>
              <input value={form.cuit || ''} onChange={(e) => setForm({ ...form, cuit: e.target.value })} placeholder="20-12345678-9" className={inputCls} inputMode="numeric" />
            </div>
            <div>
              <label className={labelCls}>Punto de venta</label>
              <input type="number" min={1} value={form.pointOfSale ?? 1} onChange={(e) => setForm({ ...form, pointOfSale: Number(e.target.value) })} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Razón social</label>
            <input value={form.razonSocial || ''} onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} placeholder="Tal como figura en ARCA" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Domicilio comercial</label>
            <input value={form.domicilio || ''} onChange={(e) => setForm({ ...form, domicilio: e.target.value })} placeholder="Calle 123, Localidad" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Ingresos brutos</label>
              <input value={form.iibb || ''} onChange={(e) => setForm({ ...form, iibb: e.target.value })} placeholder="N° o “Exento”" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Inicio de actividades</label>
              <input type="date" value={(form.inicioActividades as any) || ''} onChange={(e) => setForm({ ...form, inicioActividades: e.target.value })} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Condición frente al IVA</label>
              <select value={form.ivaCondition || 'MONOTRIBUTO'} onChange={(e) => setForm({ ...form, ivaCondition: e.target.value as any })} className={inputCls}>
                <option value="MONOTRIBUTO">Monotributo (Factura C)</option>
                <option value="RESPONSABLE_INSCRIPTO">Responsable Inscripto (A y B)</option>
              </select>
            </div>
            {esRI ? (
              <div>
                <label className={labelCls}>IVA de los productos</label>
                <select value={form.defaultIvaRate ?? 21} onChange={(e) => setForm({ ...form, defaultIvaRate: Number(e.target.value) })} className={inputCls}>
                  <option value={21}>21% (general)</option>
                  <option value={10.5}>10,5%</option>
                  <option value={27}>27%</option>
                </select>
              </div>
            ) : (
              <div>
                <label className={labelCls}>Entorno</label>
                <select value={form.environment || 'HOMOLOGACION'} onChange={(e) => setForm({ ...form, environment: e.target.value as any })} className={inputCls}>
                  <option value="HOMOLOGACION">Pruebas (homologación)</option>
                  <option value="PRODUCCION">Producción</option>
                </select>
              </div>
            )}
          </div>
          {esRI && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Entorno</label>
                <select value={form.environment || 'HOMOLOGACION'} onChange={(e) => setForm({ ...form, environment: e.target.value as any })} className={inputCls}>
                  <option value="HOMOLOGACION">Pruebas (homologación)</option>
                  <option value="PRODUCCION">Producción</option>
                </select>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug self-end pb-1">
                Los productos con alícuota propia (en su ficha) usan esa; el resto, la que elijas acá.
              </p>
            </div>
          )}

          <label className="flex items-center justify-between cursor-pointer gap-3">
            <span className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">
              Facturar cada venta automáticamente
              <span className="block text-[11.5px] font-medium text-slate-500 leading-snug">
                Cada venta sale con su factura (a consumidor final, o a nombre del cliente si tiene CUIT o DNI). Apagado, se factura solo cuando el cliente la pide.
              </span>
            </span>
            <input type="checkbox" checked={Boolean(form.autoInvoice)} onChange={(e) => setForm({ ...form, autoInvoice: e.target.checked })}
              className="rounded-md border-slate-400 text-emerald-600 focus:ring-emerald-500 h-4.5 w-4.5 cursor-pointer shrink-0" />
          </label>

          {enProduccion && config?.environment !== 'PRODUCCION' && (
            <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-snug">
              Al pasar a producción los comprobantes tienen validez fiscal. Antes, completá la autorización en ARCA y probá la conexión.
            </p>
          )}

          {isAdmin ? (
            <button onClick={guardar} disabled={guardando}
              className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[13px] font-bold transition-all cursor-pointer flex items-center justify-center gap-2">
              {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Guardar configuración
            </button>
          ) : (
            <p className="text-[11.5px] text-slate-500 text-center">Solo un administrador puede cambiar la configuración.</p>
          )}
        </div>

        {/* ── Conexión ── */}
        <div className={cardCls}>
          <h3 className={titleCls}><Server className="w-4 h-4 text-emerald-500" /> Conexión con ARCA</h3>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${config?.ventraAvailable ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200">
                {config?.transport === 'own' ? 'Certificado propio del comercio' : 'Ventra factura por vos (delegación)'}
              </span>
            </div>
            <p className="text-[11.5px] text-slate-600 dark:text-slate-400 leading-snug">
              {config?.transport === 'own'
                ? 'Esta caja firma con el certificado que cargó el comercio.'
                : !config?.linked
                  ? 'Esta PC no está vinculada a tu cuenta de Ventra: vinculala en Configuración → Suscripción y nube para poder facturar.'
                  : 'No hace falta generar certificados: autorizás a Ventra una sola vez en ARCA y Ventra pide los CAE en tu nombre. Las claves nunca quedan en esta PC.'}
            </p>
          </div>

          {/* Guía de la delegación */}
          {config?.transport !== 'own' && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <button onClick={() => setGuiaAbierta((v) => !v)} className="w-full px-3 py-2.5 flex items-center justify-between text-left bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer">
                <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200">Cómo autorizar a Ventra en ARCA (una sola vez)</span>
                <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${guiaAbierta ? 'rotate-180' : ''}`} />
              </button>
              {guiaAbierta && (
                <ol className="px-4 pb-3 pt-1 space-y-2 text-[12px] text-slate-700 dark:text-slate-300 leading-snug list-decimal list-inside bg-white dark:bg-slate-900">
                  <li>Entrá a <strong>arca.gob.ar</strong> con tu CUIT y clave fiscal (nivel 3).</li>
                  <li>Abrí <strong>Administrador de Relaciones de Clave Fiscal</strong> → <strong>Nueva relación</strong>.</li>
                  <li>En <em>Servicio</em> tocá Buscar → <strong>ARCA</strong> → <strong>WebServices</strong> → <strong>Facturación Electrónica</strong>.</li>
                  <li>
                    En <em>Representante</em> cargá la CUIT de Ventra{' '}
                    {ventraCuit ? (
                      <button onClick={() => copiar(ventraCuit)} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 font-mono font-bold text-emerald-800 cursor-pointer" title="Copiar">
                        {ventraCuit} <Copy className="w-3 h-3" />
                      </button>
                    ) : (
                      <span className="text-slate-500">(aparece acá al conectar con Ventra)</span>
                    )}{' '}
                    y confirmá. Del otro lado, Ventra acepta la autorización (suele quedar lista en el día).
                  </li>
                  <li>
                    Creá el punto de venta en <strong>Administración de puntos de venta y domicilios</strong> → Agregar, con el sistema{' '}
                    <strong>{esRI ? 'RECE para aplicativo y web services' : 'Factura Electrónica - Monotributo - Web Services'}</strong>. Ese número va arriba, en “Punto de venta”.
                  </li>
                  <li>Volvé acá y tocá <strong>Probar conexión</strong>.</li>
                </ol>
              )}
            </div>
          )}

          {isAdmin && (
            <button onClick={probar} disabled={probando}
              className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-850 disabled:opacity-50 text-[13px] font-bold text-slate-700 dark:text-slate-200 transition-all cursor-pointer flex items-center justify-center gap-2">
              {probando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Probar conexión (no emite nada)
            </button>
          )}

          {prueba && (
            <ul className="space-y-1.5">
              {prueba.checks.map((c) => (
                <li key={c.key} className={`p-2.5 rounded-xl border text-[12px] leading-snug flex items-start gap-2 ${
                  c.level === 'ok' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 text-emerald-900 dark:text-emerald-200'
                  : c.level === 'warn' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 text-amber-900 dark:text-amber-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 text-red-900 dark:text-red-200'}`}>
                  {c.level === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" /> : c.level === 'warn' ? <AlertTriangle className="w-4 h-4 shrink-0 mt-px" /> : <XCircle className="w-4 h-4 shrink-0 mt-px" />}
                  <span><strong>{c.label}:</strong> {c.detail}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-3 gap-2 pt-1">
            {[
              { label: 'En cola', valor: summary.PENDING || 0, color: 'text-amber-600' },
              { label: 'Autorizados', valor: summary.AUTHORIZED || 0, color: 'text-emerald-600' },
              { label: 'Rechazados', valor: summary.REJECTED || 0, color: 'text-red-600' },
            ].map((c) => (
              <div key={c.label} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-center">
                <p className={`text-xl font-black ${c.color}`}>{c.valor}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{c.label}</p>
              </div>
            ))}
          </div>

          {(summary.PENDING_MINE || 0) > 0 && (
            <button onClick={procesarCola} disabled={procesando}
              className="w-full h-10 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-[13px] font-bold transition-all cursor-pointer flex items-center justify-center gap-2">
              {procesando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
              Reintentar ahora {summary.PENDING_MINE === 1 ? 'el comprobante en cola' : `los ${summary.PENDING_MINE} en cola`}
            </button>
          )}
        </div>
      </div>

      {/* ── Comprobantes ── */}
      <div className="card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[13px] font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mr-2">
              <QrCode className="w-4 h-4 text-emerald-500" /> Comprobantes
            </h3>
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold transition-colors cursor-pointer ${tab === t.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-850 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>
                {t.label}
                {t.key === 'PENDING' && summary.PENDING ? ` (${summary.PENDING})` : ''}
                {t.key === 'REJECTED' && summary.REJECTED ? ` (${summary.REJECTED})` : ''}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {tab !== 'UNINVOICED' && (
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cliente, documento, número, CAE o venta" className={`${inputCls} pl-8`} />
              </div>
            )}
            <label className="text-[11px] font-bold text-slate-500">Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={dateCls} />
            <label className="text-[11px] font-bold text-slate-500">Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={dateCls} />
            {isAdmin && tab !== 'UNINVOICED' && (
              <button onClick={exportar} className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-[12px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-850 flex items-center gap-1.5 cursor-pointer" title="Libro de comprobantes autorizados del período, para el contador">
                <Download className="w-4 h-4" /> Exportar
              </button>
            )}
            {listando && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
        </div>

        <div className="overflow-x-auto">
          {tab === 'UNINVOICED' ? (
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500">
                <tr>{['Venta', 'Fecha', 'Cliente', 'Total', ''].map((h) => <th key={h} className="text-left font-bold uppercase tracking-wider text-[10px] px-4 py-2">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {uninvoiced.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-850/50">
                    <td className="px-4 py-2 font-bold text-slate-800 dark:text-slate-200">#{s.saleNumber}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{new Date(s.createdAt).toLocaleDateString('es-AR')} {hora(s.createdAt)}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{s.client?.name || 'Consumidor final'}</td>
                    <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200">{formatPrice(s.total)}</td>
                    <td className="px-4 py-2 text-right">
                      {config?.enabled && (
                        <button onClick={() => setFacturar({ saleId: s.id, saleNumber: s.saleNumber, total: s.total, cliente: s.client })}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11.5px] font-bold cursor-pointer">
                          Facturar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!uninvoiced.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No hay ventas sin facturar en el período</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500">
                <tr>{['Fecha', 'Comprobante', 'Venta', 'Cliente', 'Total', 'Estado', ''].map((h) => <th key={h} className="text-left font-bold uppercase tracking-wider text-[10px] px-4 py-2">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {docs.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-850/50 align-top">
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">{d.issueDate ? fechaAr(d.issueDate) : fechaAr(d.createdAt?.slice(0, 10))}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`font-semibold ${d.kind === 'NOTA_CREDITO' ? 'text-red-700 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'}`}>{nombreComprobante(d.type) || (d.kind === 'NOTA_CREDITO' ? 'Nota de crédito' : 'Factura')}</span>
                      {d.number ? <span className="block font-mono text-[11px] text-slate-500">{numeroComprobante(d.pointOfSale, d.number)}</span> : null}
                      {d.environment !== 'PRODUCCION' && <span className="block text-[9.5px] font-bold text-amber-700">PRUEBA</span>}
                    </td>
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-300">#{d.saleNumber ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-400 max-w-[200px] truncate" title={docReceptor(d.receptor)}>{docReceptor(d.receptor)}</td>
                    <td className="px-4 py-2 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{d.kind === 'NOTA_CREDITO' ? '−' : ''}{formatPrice(d.total || d.saleTotal || 0)}</td>
                    <td className="px-4 py-2 max-w-[260px]"><Estado d={d} /></td>
                    <td className="px-4 py-2 text-right whitespace-nowrap space-x-1">
                      {d.status === 'AUTHORIZED' && (
                        <button onClick={() => setVerDoc(d.id)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 cursor-pointer" title="Ver e imprimir">
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                      {isAdmin && d.status === 'AUTHORIZED' && d.kind === 'FACTURA' && (!d.creditedBy || ['REJECTED', 'VOID'].includes(d.creditedBy.status)) && (
                        <button disabled={busy === d.id} onClick={() => accion(d, 'credit-note')} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer disabled:opacity-40" title="Anular con nota de crédito">
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
                      {(d.status === 'PENDING' || d.status === 'REJECTED') && d.mine && (
                        d.status === 'REJECTED' && d.kind === 'FACTURA' ? (
                          <button onClick={() => setFacturar({ saleId: d.saleId, saleNumber: d.saleNumber || 0, total: d.saleTotal || d.total, cliente: d.receptor.docNro !== '0' ? { name: d.receptor.name, cuit: d.receptor.docTipo === 80 ? d.receptor.docNro : null, dni: d.receptor.docTipo === 96 ? d.receptor.docNro : null, ivaCondition: d.receptor.ivaCondition } : null })}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11.5px] font-bold cursor-pointer">
                            Corregir
                          </button>
                        ) : (
                          <button disabled={busy === d.id} onClick={() => accion(d, 'retry')} className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11.5px] font-bold cursor-pointer inline-flex items-center gap-1">
                            {busy === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Reintentar
                          </button>
                        )
                      )}
                      {isAdmin && (d.status === 'PENDING' || d.status === 'REJECTED') && !d.mine && (
                        <button disabled={busy === d.id} onClick={() => accion(d, 'take-over')} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 dark:text-slate-200 text-[11.5px] font-bold cursor-pointer disabled:opacity-40">
                          Emitir desde esta caja
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!docs.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No hay comprobantes con ese filtro</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {verDoc && <FiscalDocModal docId={verDoc} onClose={() => setVerDoc(null)} />}
      {facturar && (
        <InvoiceModal
          saleId={facturar.saleId}
          saleNumber={facturar.saleNumber}
          total={facturar.total}
          cliente={facturar.cliente}
          onClose={() => { setFacturar(null); cargarLista(); }}
          onEmitted={() => cargarLista()}
          onQueued={() => cargarLista()}
        />
      )}
    </div>
  );
}

/** Estado de un comprobante, con lo que está pasando dicho en criollo. */
function Estado({ d }: { d: Doc }) {
  if (d.status === 'AUTHORIZED') {
    const anulada = d.creditedBy?.status === 'AUTHORIZED';
    return (
      <div className="space-y-0.5">
        <span className={`inline-flex items-center gap-1 font-bold ${anulada ? 'text-slate-500' : 'text-emerald-700 dark:text-emerald-400'}`}>
          <CheckCircle2 className="w-3.5 h-3.5" /> {anulada ? 'Anulada' : 'Autorizada'}
        </span>
        <span className="block font-mono text-[10.5px] text-slate-500" title={`Vence ${d.caeExpiresAt ? new Date(d.caeExpiresAt).toLocaleDateString('es-AR') : '—'}`}>CAE {d.cae}</span>
        {d.creditedBy && <span className="block text-[10.5px] text-red-600">NC {d.creditedBy.number ? numeroComprobante(d.creditedBy.pointOfSale, d.creditedBy.number) : (d.creditedBy.status === 'PENDING' ? 'en cola' : d.creditedBy.status.toLowerCase())}</span>}
        {d.kind === 'NOTA_CREDITO' && d.assoc && <span className="block text-[10.5px] text-slate-500">Anula {nombreComprobante(d.assoc.type)} {numeroComprobante(d.assoc.pointOfSale, d.assoc.number)}</span>}
      </div>
    );
  }
  if (d.status === 'PENDING') {
    const texto = !d.mine ? `En cola en la caja #${d.ownerNode}`
      : d.verifying ? 'Verificando en ARCA'
      : d.errorKind === 'CONFIG' ? 'Esperando configuración'
      : d.attempts ? `En cola · reintenta ${d.nextAttemptAt ? hora(d.nextAttemptAt) : 'enseguida'}`
      : 'Emitiendo…';
    return (
      <div className="space-y-0.5">
        <span className={`inline-flex items-center gap-1 font-bold ${d.errorKind === 'CONFIG' ? 'text-red-600' : 'text-amber-700'}`}>
          <Clock className="w-3.5 h-3.5" /> {texto}
        </span>
        {d.error && <span className="block text-[10.5px] text-slate-500 line-clamp-2" title={d.error}>{d.error}</span>}
      </div>
    );
  }
  if (d.status === 'REJECTED') {
    return (
      <div className="space-y-0.5">
        <span className="inline-flex items-center gap-1 font-bold text-red-600"><XCircle className="w-3.5 h-3.5" /> Rechazada</span>
        {d.error && <span className="block text-[10.5px] text-red-700 dark:text-red-400 line-clamp-3" title={d.error}>{d.error}</span>}
      </div>
    );
  }
  return <span className="text-slate-400 font-bold">Descartada{d.error ? ` · ${d.error}` : ''}</span>;
}
