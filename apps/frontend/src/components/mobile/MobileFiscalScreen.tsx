import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileText, RefreshCw, Settings2, CheckCircle2, Clock, XCircle, MinusCircle, ShieldCheck, AlertTriangle, Copy } from 'lucide-react';
import api from '../../services/api';
import { ScreenHeader, Chips, Sheet, PrimaryButton, EmptyState, ListSkeleton, money } from './ui';

type Tab = 'ALL' | 'PENDING' | 'AUTHORIZED' | 'REJECTED' | 'UNINVOICED';

const STATUS: Record<string, { label: string; cls: string; icon: any }> = {
  AUTHORIZED: { label: 'Autorizada', cls: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
  PENDING: { label: 'En cola', cls: 'bg-amber-50 text-amber-700', icon: Clock },
  REJECTED: { label: 'Rechazada', cls: 'bg-red-50 text-red-600', icon: XCircle },
  VOID: { label: 'Descartada', cls: 'bg-slate-100 text-slate-500', icon: MinusCircle },
  ANULADA: { label: 'Anulada', cls: 'bg-slate-100 text-slate-600', icon: MinusCircle },
  NONE: { label: 'Sin facturar', cls: 'bg-slate-100 text-slate-500', icon: MinusCircle },
};
const typeName = (t?: string | null, kind?: string) => (t ? t.replace('FACTURA_', 'Factura ').replace('NC_', 'Nota de crédito ') : kind === 'NOTA_CREDITO' ? 'Nota de crédito' : 'Factura');
/** Una factura con su nota de crédito autorizada ya no vale: se muestra anulada */
const statusOf = (d: any) => (d.uninvoiced ? STATUS.NONE : d.status === 'AUTHORIZED' && d.creditedBy?.status === 'AUTHORIZED' ? STATUS.ANULADA : STATUS[d.status] || STATUS.NONE);
const number = (pv?: number | null, n?: number | null) => (n ? `${String(pv ?? 0).padStart(5, '0')}-${String(n).padStart(8, '0')}` : '');
const receptor = (d: any) => (d.receptor?.docNro && d.receptor.docNro !== '0' ? `${d.receptor.name || ''} · ${d.receptor.docNro}` : d.receptor?.name || 'Consumidor final');

/** Facturación electrónica (ARCA) en el celular: estado, configuración, comprobantes y reintentos. */
export default function MobileFiscalScreen() {
  const [config, setConfig] = useState<any | null>(null);
  const [items, setItems] = useState<any[] | null>(null);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Tab>('ALL');
  const [selected, setSelected] = useState<any | null>(null);
  const [processing, setProcessing] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const load = useCallback((t: Tab) => {
    setItems(null);
    const req = t === 'UNINVOICED'
      ? api.get('/fiscal/uninvoiced').then((r) => setItems((r.data || []).map((s: any) => ({ ...s, uninvoiced: true }))))
      : api.get('/fiscal/documents', { params: { status: t === 'ALL' ? undefined : t, limit: 80 } }).then((r) => {
        setItems(r.data.documents || []);
        setSummary(r.data.summary || {});
      });
    req.catch(() => { setItems([]); toast.error('No pudimos traer los comprobantes'); });
  }, []);

  useEffect(() => { api.get('/fiscal/config').then((r) => setConfig(r.data)).catch(() => setConfig({})); }, []);
  useEffect(() => { load(tab); }, [tab, load]);

  const processQueue = async () => {
    setProcessing(true);
    try {
      const { data } = await api.post('/fiscal/queue/process');
      toast.success(data.pending ? `Quedan ${data.pending} en cola` : 'Cola al día');
      load(tab);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo procesar la cola');
    } finally {
      setProcessing(false);
    }
  };

  const enabled = !!config?.enabled;
  const pending = summary.PENDING_MINE || 0;
  const stuck = summary.CONFIG || 0;

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
              <p className="text-[12px] text-rose-100">Tocá acá para activarla y cargar tus datos.</p>
            </>
          )}
        </button>
        <Chips<Tab>
          options={[
            { id: 'ALL', label: 'Todos' },
            { id: 'PENDING', label: 'En cola', count: summary.PENDING || 0 },
            { id: 'REJECTED', label: 'Rechazados', count: summary.REJECTED || 0 },
            { id: 'AUTHORIZED', label: 'Autorizados' },
            { id: 'UNINVOICED', label: 'Sin facturar' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
        {enabled && stuck > 0 && (
          <button onClick={() => setConfigOpen(true)} className="w-full bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3 text-left">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <span className="flex-1">
              <span className="block text-[14px] font-semibold text-red-900">{stuck} {stuck === 1 ? 'comprobante espera' : 'comprobantes esperan'} que corrijas la configuración</span>
              <span className="block text-[12px] text-red-800">{config?.lastError || 'Tocá para probar la conexión y ver qué falta.'}</span>
            </span>
          </button>
        )}
        {enabled && pending > 0 && (
          <button onClick={processQueue} disabled={processing} className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 text-left active:scale-[0.99] disabled:opacity-60">
            <RefreshCw className={`w-5 h-5 text-amber-700 shrink-0 ${processing ? 'animate-spin' : ''}`} />
            <span className="flex-1">
              <span className="block text-[14px] font-semibold text-amber-900">{pending} en cola</span>
              <span className="block text-[12px] text-amber-800">Salen solos cuando ARCA responde. Tocá para reintentar ya.</span>
            </span>
          </button>
        )}
        {items === null ? <ListSkeleton /> : items.length === 0 ? (
          <EmptyState icon={FileText} title={tab === 'UNINVOICED' ? 'No hay ventas sin facturar' : 'No hay comprobantes'} />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
            {items.map((d) => {
              const st = statusOf(d);
              const Icon = st.icon;
              return (
                <button key={d.id} onClick={() => setSelected(d)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${st.cls}`}><Icon className="w-[18px] h-[18px]" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium text-slate-800 truncate">
                      {d.uninvoiced ? `Venta N.º ${d.saleNumber}` : d.number ? `${typeName(d.type, d.kind)} ${number(d.pointOfSale, d.number)}` : `${typeName(d.type, d.kind)} · venta ${d.saleNumber}`}
                    </span>
                    <span className="block text-[12px] text-slate-500 truncate">
                      {new Date(d.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} · {d.uninvoiced ? d.client?.name || 'Consumidor final' : receptor(d)}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[14px] font-semibold text-slate-900 tabular-nums">{d.kind === 'NOTA_CREDITO' ? '−' : ''}{money(d.total || d.saleTotal || 0)}</span>
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
        onSaved={(c) => { setConfig(c); setConfigOpen(false); load(tab); }}
      />
      <DocSheet item={selected} enabled={enabled} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(tab); }} />
    </div>
  );
}

function DocSheet({ item: d, enabled, onClose, onDone }: { item: any | null; enabled: boolean; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const run = async (req: () => Promise<any>) => {
    setBusy(true);
    try {
      const { data } = await req();
      if (data.status === 'AUTHORIZED') toast.success(`${typeName(data.type)} autorizada · CAE ${data.cae}`, { duration: 6000 });
      else if (data.status === 'PENDING') toast(`Quedó en cola: ${data.error || 'sale sola cuando ARCA responda'}`, { icon: '⏳', duration: 6000 });
      else toast.error(data.error || 'ARCA lo rechazó', { duration: 7000 });
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo completar', { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  let footer: React.ReactNode;
  if (d && enabled) {
    if (d.uninvoiced) footer = <PrimaryButton onClick={() => run(() => api.post(`/fiscal/sales/${d.id}/invoice`, {}))} loading={busy}>Facturar a consumidor final</PrimaryButton>;
    else if ((d.status === 'PENDING' || d.status === 'REJECTED') && d.mine) footer = <PrimaryButton onClick={() => run(() => api.post(`/fiscal/documents/${encodeURIComponent(d.id)}/retry`, {}))} loading={busy}>Reintentar</PrimaryButton>;
    else if (d.status === 'AUTHORIZED' && d.kind === 'FACTURA' && (!d.creditedBy || ['REJECTED', 'VOID'].includes(d.creditedBy.status))) {
      footer = (
        <button
          onClick={() => window.confirm('Se emite una nota de crédito que anula esta factura. ¿Seguimos?') && run(() => api.post(`/fiscal/documents/${encodeURIComponent(d.id)}/credit-note`, {}))}
          disabled={busy}
          className="w-full h-12 rounded-2xl border border-red-200 text-red-700 text-[15px] font-semibold disabled:opacity-50"
        >
          Anular con nota de crédito
        </button>
      );
    }
  }

  const st = d ? statusOf(d) : null;
  return (
    <Sheet open={!!d} onClose={onClose} title={d ? (d.uninvoiced ? `Venta N.º ${d.saleNumber}` : typeName(d.type, d.kind)) : ''} footer={footer}>
      {d && st && (
        <div className="space-y-4 pt-1">
          <div className="text-center">
            <p className="text-[30px] font-bold text-slate-900 tabular-nums tracking-tight">{money(d.total || d.saleTotal || 0)}</p>
            <span className={`inline-block mt-1 text-[12px] font-semibold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1.5 text-[13.5px]">
            <Row k="Fecha" v={new Date(d.createdAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} />
            {!d.uninvoiced && <Row k="Venta" v={`N.º ${d.saleNumber ?? '—'}`} />}
            <Row k="Cliente" v={d.uninvoiced ? d.client?.name || 'Consumidor final' : receptor(d)} />
            {d.number && <Row k="Comprobante" v={number(d.pointOfSale, d.number)} />}
            {d.cae && <Row k="CAE" v={d.cae} />}
            {d.caeExpiresAt && <Row k="Vence CAE" v={new Date(d.caeExpiresAt).toLocaleDateString('es-AR')} />}
            {d.assoc && <Row k="Anula" v={`${typeName(d.assoc.type)} ${number(d.assoc.pointOfSale, d.assoc.number)}`} />}
            {d.creditedBy && <Row k="Nota de crédito" v={d.creditedBy.number ? number(d.creditedBy.pointOfSale, d.creditedBy.number) : 'en cola'} />}
            {d.status === 'PENDING' && !d.mine && <Row k="La emite" v={`Caja #${d.ownerNode}`} />}
          </div>
          {d.error && <p className={`rounded-2xl px-4 py-3 text-[13px] ${d.status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{d.error}</p>}
          {d.environment === 'HOMOLOGACION' && <p className="text-[12px] text-amber-700 text-center">Comprobante de prueba: sin validez fiscal.</p>}
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
  useEffect(() => {
    if (open && config) {
      setForm({ ...config, inicioActividades: config.inicioActividades ? String(config.inicioActividades).slice(0, 10) : '' });
      setTest(null);
    }
  }, [open, config]);
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch('/fiscal/config', {
        enabled: form.enabled,
        cuit: form.cuit,
        razonSocial: form.razonSocial,
        domicilio: form.domicilio,
        iibb: form.iibb,
        inicioActividades: form.inicioActividades || null,
        ivaCondition: form.ivaCondition,
        pointOfSale: form.pointOfSale,
        environment: form.environment,
        autoInvoice: form.autoInvoice,
      });
      toast.success('Configuración guardada');
      onSaved(data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar', { duration: 6000 });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true); setTest(null);
    try {
      const { data } = await api.post('/fiscal/test');
      setTest(data);
    } catch (err: any) {
      setTest({ ok: false, checks: [{ key: 'x', level: 'error', label: 'Conexión', detail: err.response?.data?.message || 'No se pudo conectar' }] });
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
        <Field label="Domicilio comercial"><input className={input} value={form.domicilio || ''} onChange={(e) => set({ domicilio: e.target.value })} placeholder="Calle 123, Localidad" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ingresos brutos"><input className={input} value={form.iibb || ''} onChange={(e) => set({ iibb: e.target.value })} placeholder="N° o Exento" /></Field>
          <Field label="Inicio de actividades"><input className={input} type="date" value={form.inicioActividades || ''} onChange={(e) => set({ inicioActividades: e.target.value })} /></Field>
        </div>

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
            <ShieldCheck className={`w-4 h-4 ${config?.ventraAvailable ? 'text-emerald-600' : 'text-slate-400'}`} /> Autorizar a Ventra en ARCA
          </p>
          <p className="text-[12.5px] text-slate-600 leading-snug">
            En ARCA → Administrador de Relaciones de Clave Fiscal → Nueva relación → servicio “Facturación Electrónica” → representante:
            {config?.ventraCuit ? (
              <button onClick={() => navigator.clipboard?.writeText(config.ventraCuit).then(() => toast.success('Copiado'))} className="ml-1 inline-flex items-center gap-1 font-mono font-semibold text-emerald-800">
                {config.ventraCuit} <Copy className="w-3 h-3" />
              </button>
            ) : ' la CUIT de Ventra'}.
            Después creá un punto de venta para web services y probá la conexión.
          </p>
          <button onClick={runTest} disabled={testing} className="w-full h-11 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700 flex items-center justify-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} /> Probar conexión (no emite nada)
          </button>
          {test?.checks?.map((c: any) => (
            <div key={c.key} className={`rounded-xl px-3 py-2.5 text-[12.5px] leading-snug ${c.level === 'ok' ? 'bg-emerald-50 text-emerald-800' : c.level === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
              <b>{c.label}:</b> {c.detail}
            </div>
          ))}
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
