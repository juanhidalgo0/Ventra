import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, RefreshCw, Settings2, CheckCircle2, Clock, XCircle, MinusCircle, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, Chips, Sheet, PrimaryButton, EmptyState, ListSkeleton, money } from './ui';

type Status = 'ALL' | 'PENDING' | 'AUTHORIZED' | 'REJECTED' | 'NONE';

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  AUTHORIZED: { label: 'Autorizada', cls: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  PENDING: { label: 'En cola', cls: 'bg-amber-50 text-amber-700', icon: Clock },
  REJECTED: { label: 'Rechazada', cls: 'bg-red-50 text-red-600', icon: XCircle },
  NONE: { label: 'Sin facturar', cls: 'bg-slate-100 text-slate-500', icon: MinusCircle },
};
const typeName = (t?: string | null) => (t ? t.replace('FACTURA_', 'Factura ').replace('NC_', 'Nota de crédito ') : '');
const number = (s: any) => (s.invoiceNumber ? `${String(s.invoicePointOfSale ?? 0).padStart(4, '0')}-${String(s.invoiceNumber).padStart(8, '0')}` : '');

/** Facturación electrónica (ARCA) en el celular: estado, configuración, comprobantes y reintentos. */
export default function MobileFiscalScreen() {
  const [config, setConfig] = useState<any | null>(null);
  const [sales, setSales] = useState<any[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<Status>('ALL');
  const [selected, setSelected] = useState<any | null>(null);
  const [processing, setProcessing] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const loadSales = useCallback((s: Status) => {
    setSales(null);
    api.get('/fiscal/sales', { params: { status: s, limit: 60 } })
      .then((r) => { setSales(r.data.sales || []); setCounts(r.data.resumen || {}); })
      .catch(() => { setSales([]); toast.error('No pudimos traer los comprobantes'); });
  }, []);

  useEffect(() => { api.get('/fiscal/config').then((r) => setConfig(r.data)).catch(() => setConfig({})); }, []);
  useEffect(() => { loadSales(status); }, [status, loadSales]);

  const processQueue = async () => {
    setProcessing(true);
    try {
      const { data } = await api.post('/fiscal/pending/process');
      if (data.skipped) toast('La facturación no está activada');
      else if (data.processed === 0) toast.success('No hay comprobantes en cola');
      else toast.success(`${data.authorized} autorizados, ${data.failed} siguen en cola`);
      loadSales(status);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo procesar la cola');
    } finally {
      setProcessing(false);
    }
  };

  const enabled = !!config?.enabled;
  const pending = counts.PENDING || 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader
        back
        title="Facturación"
        subtitle="ARCA · factura electrónica"
        action={
          <button onClick={() => setConfigOpen(true)} className="w-10 h-10 rounded-full bg-white/15 ring-1 ring-inset ring-white/20 flex items-center justify-center shrink-0" aria-label="Configurar">
            <Settings2 className="w-[18px] h-[18px]" />
          </button>
        }
      >
        <button onClick={() => setConfigOpen(true)} className="w-full text-left rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-4 py-3 mb-3 active:bg-white/15">
          {config === null ? <p className="text-[13px] text-rose-100">Cargando…</p> : enabled ? (
            <>
              <p className="text-[12px] text-rose-100 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-200" /> Activa{config.environment === 'HOMOLOGACION' ? ' · modo prueba' : ''}</p>
              <p className="text-[17px] font-bold truncate">{config.razonSocial || 'Sin razón social'}</p>
              <p className="text-[12px] text-rose-100">CUIT {config.cuit || '—'} · Punto de venta {config.pointOfSale ?? '—'}{config.autoInvoice ? ' · factura sola' : ''}</p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-bold">La facturación está apagada</p>
              <p className="text-[12px] text-rose-100">Tocá acá para activarla y cargar tu CUIT.</p>
            </>
          )}
        </button>
        <Chips<Status>
          options={[
            { id: 'ALL', label: 'Todas' },
            { id: 'AUTHORIZED', label: 'Autorizadas', count: counts.AUTHORIZED || 0 },
            { id: 'PENDING', label: 'En cola', count: pending },
            { id: 'REJECTED', label: 'Rechazadas', count: counts.REJECTED || 0 },
            { id: 'NONE', label: 'Sin facturar', count: counts.NONE || 0 },
          ]}
          value={status}
          onChange={setStatus}
        />
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
        {enabled && pending > 0 && (
          <button onClick={processQueue} disabled={processing} className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-left active:scale-[0.99] disabled:opacity-60">
            <RefreshCw className={`w-5 h-5 text-amber-700 shrink-0 ${processing ? 'animate-spin' : ''}`} />
            <span className="flex-1">
              <span className="block text-[14px] font-semibold text-amber-900">{pending} en cola</span>
              <span className="block text-[12px] text-amber-800">Quedaron sin CAE (sin internet o ARCA caído). Tocá para reintentar.</span>
            </span>
          </button>
        )}
        {sales === null ? <ListSkeleton /> : sales.length === 0 ? (
          <EmptyState icon={FileText} title="No hay comprobantes" />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
            {sales.map((s) => {
              const st = STATUS[s.invoiceStatus] || STATUS.NONE;
              const Icon = st.icon;
              return (
                <button key={s.id} onClick={() => setSelected(s)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${st.cls}`}><Icon className="w-[18px] h-[18px]" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium text-slate-800 truncate">{s.invoiceNumber ? `${typeName(s.invoiceType)} ${number(s)}` : `Venta N.º ${s.saleNumber}`}</span>
                    <span className="block text-[12px] text-slate-500 truncate">
                      {new Date(s.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · {s.receptorName || s.client?.name || 'Consumidor final'}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[14px] font-semibold text-slate-900 tabular-nums">{money(s.total)}</span>
                    <span className="block text-[11px] font-semibold text-slate-500">{st.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <FiscalConfigSheet
        open={configOpen}
        config={config}
        onClose={() => setConfigOpen(false)}
        onSaved={(c) => { setConfig(c); setConfigOpen(false); }}
      />
      <InvoiceSheet sale={selected} enabled={enabled} onClose={() => setSelected(null)} onDone={() => { setSelected(null); loadSales(status); }} />
    </div>
  );
}

function InvoiceSheet({ sale: s, enabled, onClose, onDone }: { sale: any | null; enabled: boolean; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const canInvoice = s && enabled && s.status === 'COMPLETED' && (s.invoiceStatus === 'NONE' || s.invoiceStatus === 'REJECTED' || s.invoiceStatus === 'PENDING');

  const invoice = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/fiscal/sales/${s.id}/invoice`, {});
      toast.success(`${typeName(data.type)} autorizada · CAE ${data.cae}`, { duration: 6000 });
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo facturar', { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const st = s ? STATUS[s.invoiceStatus] || STATUS.NONE : null;
  return (
    <Sheet
      open={!!s}
      onClose={onClose}
      title={s ? `Venta N.º ${s.saleNumber}` : ''}
      footer={canInvoice ? <PrimaryButton onClick={invoice} loading={busy}>{s.invoiceStatus === 'NONE' ? 'Facturar' : 'Reintentar'}</PrimaryButton> : undefined}
    >
      {s && st && (
        <div className="space-y-4 pt-1">
          <div className="text-center">
            <p className="text-[30px] font-bold text-slate-900 tabular-nums tracking-tight">{money(s.total)}</p>
            <span className={`inline-block mt-1 text-[12px] font-semibold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5 text-[13.5px]">
            <Row k="Fecha" v={new Date(s.createdAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
            <Row k="Cliente" v={s.receptorName || s.client?.name || 'Consumidor final'} />
            {s.receptorDocNro && <Row k="Documento" v={s.receptorDocNro} />}
            {s.invoiceNumber && <Row k="Comprobante" v={`${typeName(s.invoiceType)} ${number(s)}`} />}
            {s.cae && <Row k="CAE" v={s.cae} />}
            {s.caeExpiresAt && <Row k="Vence CAE" v={new Date(s.caeExpiresAt).toLocaleDateString('es-AR')} />}
          </div>
          {s.invoiceError && <p className="rounded-2xl bg-red-50 px-4 py-3 text-[13px] text-red-700">{s.invoiceError}</p>}
          {s.status !== 'COMPLETED' && <p className="text-[12.5px] text-slate-500 text-center">Esta venta está anulada.</p>}
        </div>
      )}
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4"><span className="text-slate-500">{k}</span><span className="text-slate-800 text-right break-all">{v}</span></div>;
}

/** Configuración fiscal: mismos campos que la pantalla de la PC. */
function FiscalConfigSheet({ open, config, onClose, onSaved }: { open: boolean; config: any | null; onClose: () => void; onSaved: (c: any) => void }) {
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<any | null>(null);
  useEffect(() => { if (open && config) { setForm(config); setTest(null); } }, [open, config]);
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
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
      toast.success('Configuración guardada');
      onSaved(data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true); setTest(null);
    try {
      const { data } = await api.post('/fiscal/test');
      setTest({ ok: true, ...data });
    } catch (err: any) {
      setTest({ ok: false, message: err.response?.data?.message || 'No se pudo conectar' });
    } finally {
      setTesting(false);
    }
  };

  const input = 'w-full h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white';
  const seg = (on: boolean) => `h-12 rounded-xl border text-[13.5px] font-medium leading-tight ${on ? 'border-rose-600 bg-rose-50 text-rose-800 ring-1 ring-rose-600' : 'border-slate-200 text-slate-700 bg-white'}`;

  return (
    <Sheet open={open} onClose={onClose} title="Configurar facturación" footer={<PrimaryButton onClick={save} loading={saving}>Guardar</PrimaryButton>}>
      <div className="space-y-5 pt-1">
        <Toggle title="Facturación activada" text="Apagada, el POS sigue vendiendo con ticket común." on={!!form.enabled} onChange={(v) => set({ enabled: v })} />

        <div className="grid grid-cols-[1.6fr,1fr] gap-2">
          <Field label="CUIT"><input className={input} inputMode="numeric" value={form.cuit || ''} onChange={(e) => set({ cuit: e.target.value.replace(/\D/g, '') })} placeholder="20123456789" /></Field>
          <Field label="Punto de venta"><input className={input} inputMode="numeric" value={form.pointOfSale ?? ''} onChange={(e) => set({ pointOfSale: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></Field>
        </div>
        <Field label="Razón social"><input className={input} value={form.razonSocial || ''} onChange={(e) => set({ razonSocial: e.target.value })} placeholder="Como figura en ARCA" /></Field>

        <Field label="Condición frente al IVA">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => set({ ivaCondition: 'MONOTRIBUTO' })} className={seg(form.ivaCondition !== 'RESPONSABLE_INSCRIPTO')}>Monotributo<span className="block text-[11px] text-slate-500 font-normal">Factura C</span></button>
            <button onClick={() => set({ ivaCondition: 'RESPONSABLE_INSCRIPTO' })} className={seg(form.ivaCondition === 'RESPONSABLE_INSCRIPTO')}>Resp. Inscripto<span className="block text-[11px] text-slate-500 font-normal">Facturas A y B</span></button>
          </div>
        </Field>

        <Field label="Entorno">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => set({ environment: 'HOMOLOGACION' })} className={seg(form.environment !== 'PRODUCCION')}>Pruebas</button>
            <button onClick={() => set({ environment: 'PRODUCCION' })} className={seg(form.environment === 'PRODUCCION')}>Producción</button>
          </div>
          {form.environment !== 'PRODUCCION' && <p className="text-[12px] text-amber-700 mt-1.5">En pruebas los comprobantes no tienen validez fiscal.</p>}
        </Field>

        <Toggle title="Facturar cada venta sola" text="Apagado, se factura solo cuando el cliente la pide." on={!!form.autoInvoice} onChange={(v) => set({ autoInvoice: v })} />

        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
          <p className="text-[13.5px] font-semibold text-slate-800 flex items-center gap-2">
            <ShieldCheck className={`w-4 h-4 ${config?.delegatedAvailable || config?.hasOwnCertificate ? 'text-emerald-600' : 'text-slate-400'}`} /> Conexión con ARCA
          </p>
          <p className="text-[12.5px] text-slate-600 leading-snug">
            {config?.certSource === 'OWN'
              ? config?.hasOwnCertificate ? 'Usás tu propio certificado.' : 'Falta cargar tu certificado.'
              : config?.delegatedAvailable
                ? `Ventra firma por vos (CUIT ${config.delegatedCuit}). Solo tenés que autorizar esa CUIT en ARCA.`
                : 'Los comprobantes se emiten desde el servidor de Ventra y llegan acá por la sincronización.'}
          </p>
          <button onClick={runTest} disabled={testing} className="w-full h-11 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700 flex items-center justify-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} /> Probar conexión (no emite nada)
          </button>
          {test && (
            <div className={`rounded-xl px-3 py-2.5 text-[12.5px] ${test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {test.ok
                ? <>ARCA responde. Último comprobante en el punto de venta {test.puntoVenta}: <b>{test.ultimoComprobante}</b></>
                : test.message}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-[12.5px] font-medium text-slate-500 mb-1.5">{label}</p>{children}</div>;
}

function Toggle({ title, text, on, onChange }: { title: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="w-full flex items-center justify-between gap-4 text-left">
      <span>
        <span className="block text-[14.5px] font-semibold text-slate-800">{title}</span>
        <span className="block text-[12.5px] text-slate-500">{text}</span>
      </span>
      <span className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${on ? 'bg-rose-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}
