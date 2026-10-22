import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';
import DocumentPreview from '../common/DocumentPreview';
import { FacturaA4 } from '../fiscal/FacturaA4';
import { qrImagen } from '../pos/InvoiceModal';
import type { Emisor } from '../pos/SalesNoteSheet';

/**
 * Las facturas de todo un reparto en hojas A4, en el orden de las paradas, para que el chofer
 * salga con ellas. Las facturas se piden a ARCA al tocar "Salió a reparto" y vuelven en
 * segundos: mientras alguna espera, la pantalla se actualiza sola y avisa cuáles faltan.
 */

interface RunInvoice {
  orderId: string;
  orderNumber: number;
  saleId: string;
  client: { name?: string; address?: string; locality?: string; phone?: string } | null;
  invoice: any | null;
}

const isReady = (inv: any) => inv && inv.status === 'AUTHORIZED' && inv.cae;
const POLL_MS = 5000;

export default function RunInvoicesPreview({ run, emisor, subtitle, canInvoice, onClose }: { run: any; emisor: Emisor; subtitle: string; canInvoice: boolean; onClose: () => void }) {
  const [list, setList] = useState<RunInvoice[] | null>(null);
  const [qrs, setQrs] = useState<Record<string, string | null>>({});
  const [copies, setCopies] = useState<'original' | 'both'>('original');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = async () => {
    try {
      const { data } = await api.get(`/delivery-runs/${run.id}/invoices`, { silent: true } as any);
      if (!alive.current) return;
      const items: RunInvoice[] = data?.invoices || [];
      const next: Record<string, string | null> = {};
      for (const it of items) if (isReady(it.invoice)) next[it.invoice.id] = qrs[it.invoice.id] ?? await qrImagen(it.invoice.qrUrl);
      if (!alive.current) return;
      setQrs(next);
      setList(items);
    } catch {
      if (alive.current && !list) { toast.error('No se pudieron leer las facturas del reparto'); onClose(); }
    }
  };

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  // Mientras ARCA no contestó alguna, se vuelve a mirar sola
  const waiting = (list || []).filter((it) => it.invoice && it.invoice.status === 'PENDING');
  useEffect(() => {
    if (!waiting.length) return;
    const t = setTimeout(load, POLL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const ready = (list || []).filter((it) => isReady(it.invoice));
  const rejected = (list || []).filter((it) => it.invoice && it.invoice.status === 'REJECTED');
  const missing = (list || []).filter((it) => !it.invoice);
  const who = (it: RunInvoice) => `${it.client?.name || 'Sin cliente'} (pedido N° ${it.orderNumber})`;

  /** Pide ya a ARCA lo que está en cola (sin esperar el próximo intento) */
  const retryNow = async () => {
    setBusy(true);
    try { await api.post('/fiscal/queue/process'); } catch { /* se reintenta sola igual */ }
    await load();
    setBusy(false);
  };

  const invoiceMissing = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/delivery-runs/${run.id}/invoices`);
      (data?.warnings || []).forEach((w: string) => toast(w, { icon: '🧾', duration: 9000 }));
      if (data?.queued) toast.success(`${data.queued === 1 ? 'Se pidió 1 factura' : `Se pidieron ${data.queued} facturas`} a ARCA`);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo facturar');
    } finally {
      setBusy(false);
    }
  };

  const sheets = (paper: boolean) => ready.flatMap((it) => (copies === 'both' ? ['ORIGINAL', 'DUPLICADO'] as const : ['ORIGINAL'] as const).map((copy) => ({ it, copy })))
    .map(({ it, copy }, i) => (
      <div key={`${it.invoice.id}-${copy}`} style={paper ? { display: 'flex', justifyContent: 'center' } : i > 0 ? { breakBefore: 'page', pageBreakBefore: 'always' } : undefined}>
        <FacturaA4 doc={it.invoice} client={it.client} storeName={emisor.name} storePhone={emisor.phone} qr={qrs[it.invoice.id]} copy={copy} condicionVenta="Cuenta corriente" paper={paper} />
      </div>
    ));

  const allReady = !!list && ready.length === list.length;
  const notice = list && (
    <div className="px-5 py-3 bg-white text-[13px] text-slate-700 space-y-2">
      {list.length === 0 ? (
        <p className="font-semibold text-slate-900">Este reparto todavía no tiene ventas: las facturas se piden al tocar "Salió a reparto".</p>
      ) : (
        <p className={`flex items-center gap-2 font-semibold ${allReady ? 'text-emerald-700' : 'text-slate-900'}`}>
          {allReady ? <CheckCircle2 className="w-4 h-4" /> : <Loader2 className={`w-4 h-4 ${waiting.length ? 'animate-spin' : 'hidden'}`} />}
          {allReady ? `Las ${ready.length === 1 ? 'factura está lista' : `${ready.length} facturas están listas`} para imprimir.` : `${ready.length} de ${list.length} facturas listas para imprimir.`}
        </p>
      )}
      {waiting.length > 0 && (
        <div className="flex items-start justify-between gap-3">
          <p>Esperando a ARCA (se actualiza solo): {waiting.map(who).join(', ')}.{waiting.some((it) => it.invoice.error) && <span className="block text-amber-700">{waiting.find((it) => it.invoice.error)?.invoice.error}</span>}</p>
          <button onClick={retryNow} disabled={busy} className="shrink-0 h-8 px-3 rounded-lg border border-slate-300 text-[12.5px] font-bold hover:bg-slate-50 cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Reintentar
          </button>
        </div>
      )}
      {rejected.length > 0 && (
        <p className="flex items-start gap-2 text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>ARCA rechazó: {rejected.map((it) => `${who(it)}: ${it.invoice.error || 'sin detalle'}`).join(' · ')}. Corregilo en Facturación.</span>
        </p>
      )}
      {missing.length > 0 && (
        <div className="flex items-start justify-between gap-3">
          <p>Sin factura: {missing.map(who).join(', ')}.{!canInvoice && ' Las factura el encargado.'}</p>
          {canInvoice && <button onClick={invoiceMissing} disabled={busy} className="shrink-0 h-8 px-3 rounded-lg bg-slate-900 text-white text-[12.5px] font-bold hover:bg-slate-800 cursor-pointer disabled:opacity-50">
            Facturar
          </button>}
        </div>
      )}
    </div>
  );

  return (
    <DocumentPreview
      title="Facturas del reparto"
      subtitle={subtitle}
      options={[
        { key: 'original', label: 'Original', help: 'Una factura por pedido, en el orden de las paradas: la deja el chofer al cliente.' },
        { key: 'both', label: 'Original y duplicado', help: 'Por cada pedido, el original para el cliente y el duplicado que vuelve con el chofer.' },
      ]}
      option={copies}
      onOption={(k) => setCopies(k as 'original' | 'both')}
      fileName={`Facturas_reparto_${run.runNumber}`}
      loading={!list}
      printable={ready.length > 0}
      notice={notice}
      onClose={onClose}
      render={(paper) => (paper
        ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>{sheets(true)}</div>
        : <div>{sheets(false)}</div>)}
    />
  );
}
