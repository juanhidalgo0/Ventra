import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAutoTour } from '../common/tour/GuidedTour';
import { X, Check, PackageX, Truck, Minus, Plus, Loader2, Banknote, Landmark, BookUser, AlertTriangle, Fuel } from 'lucide-react';
import api from '../../services/api';
import { COMING_SOON } from '../../utils/comingSoon';

/**
 * Etapa 4 del reparto: lo que pasó en cada parada (qué se entregó y cómo pagó) y la rendición
 * del chofer al volver (la plata que trae contra lo que cobró, y lo que vuelve al depósito).
 */

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: string) => { const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/** Unidades entregadas por renglón (igual que el servidor) */
export function deliveredLines(order: any) {
  if (!order.deliveryStatus || order.deliveryStatus === 'NOT_DELIVERED') return [];
  let changes: Record<string, number> = {};
  try { changes = order.deliveredItems ? JSON.parse(order.deliveredItems) : {}; } catch { changes = {}; }
  return (order.items || [])
    .map((it: any) => ({ ...it, quantity: order.deliveryStatus === 'PARTIAL' && changes[it.id] !== undefined ? Math.max(0, Math.min(Number(changes[it.id]) || 0, it.quantity)) : it.quantity }))
    .filter((it: any) => it.quantity > 0);
}
export const deliveredTotal = (order: any) => round2(deliveredLines(order).reduce((s: number, it: any) => s + it.quantity * it.unitPrice, 0));

export const DELIVERY_LABEL: Record<string, { label: string; cls: string }> = {
  DELIVERED: { label: 'Entregado', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  PARTIAL: { label: 'Con cambios', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  NOT_DELIVERED: { label: 'No se entregó', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** Cómo pagó, en una línea: "Efectivo $ 1.200 · A cuenta $ 300" */
export function paymentSummary(order: any) {
  if (!order.deliveryStatus || order.deliveryStatus === 'NOT_DELIVERED') return '';
  const total = deliveredTotal(order);
  const cash = order.paidCash || 0;
  const transfer = order.paidTransfer || 0;
  const debt = round2(total - cash - transfer);
    const prev = (order.prevCash || 0) + (order.prevTransfer || 0);
  return [cash > 0 && `Efectivo ${money(cash)}`, transfer > 0 && `Transferencia ${money(transfer)}`, debt > 0.009 && `A cuenta ${money(debt)}`, prev > 0.009 && `Deuda anterior ${money(prev)}`].filter(Boolean).join(' · ');
}

/** Lo que no alcanza en el depósito para cargar el camión (lo calcula el servidor mientras se arma) */
export function ShortagesBanner({ shortages }: { shortages?: any[] }) {
  if (!shortages?.length) return null;
  const missing = (s: any) => {
    const n = Math.max(0, s.needed - s.stock);
    return s.packSize ? `${qty(Math.ceil(n / s.packSize))} bulto(s)` : `${qty(n)} u.`;
  };
  return (
    <div className="flex gap-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="text-[13px] leading-snug min-w-0">
        <p className="font-bold">No alcanza el stock para cargar todo</p>
        <ul className="mt-1 space-y-0.5">
          {shortages.map((s) => <li key={s.productId}>{s.name}: faltan <strong>{missing(s)}</strong></li>)}
        </ul>
        <p className="text-[12px] mt-1 text-amber-800">Cargá la compra si ya llegó, o sacá esos productos de algún pedido antes de salir.</p>
      </div>
    </div>
  );
}

function Sheet({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: any; footer: any }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full sm:max-w-xl bg-slate-50 rounded-t-3xl sm:rounded-3xl max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-start gap-3 border-b border-slate-200">
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold text-slate-900 leading-tight">{title}</p>
            {subtitle && <p className="text-[12.5px] text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-200/60 flex items-center justify-center cursor-pointer shrink-0" aria-label="Cerrar"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">{children}</div>
        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+14px)] border-t border-slate-200 bg-white rounded-b-3xl">{footer}</div>
      </div>
    </div>
  );
}

const REASONS = ['Estaba cerrado', 'No tenía plata', 'No lo quiso', 'Faltó mercadería', 'Producto roto'];

// ─── Una parada ───────────────────────────────────────────────────

export function DeliverySheet({ run, order, onClose, onSaved }: { run: any; order: any; onClose: () => void; onSaved: (run: any) => void }) {
  useAutoTour('distribEntrega');
  const initialChanges = useMemo(() => {
    let c: Record<string, number> = {};
    try { c = order.deliveredItems ? JSON.parse(order.deliveredItems) : {}; } catch { c = {}; }
    return Object.fromEntries((order.items || []).map((it: any) => [it.id, c[it.id] ?? it.quantity]));
  }, [order]);
  const [status, setStatus] = useState<string>(order.deliveryStatus || 'DELIVERED');
  const [items, setItems] = useState<Record<string, number>>(initialChanges);
  const [reason, setReason] = useState<string>(order.deliveryReason || '');
  const [mode, setMode] = useState<'cash' | 'transfer' | 'debt' | 'mixed'>(() => {
    if (!order.deliveryStatus) return 'cash';
    const t = deliveredTotal(order);
    if ((order.paidCash || 0) >= t - 0.009) return 'cash';
    if ((order.paidTransfer || 0) >= t - 0.009) return 'transfer';
    if (!order.paidCash && !order.paidTransfer) return 'debt';
    return 'mixed';
  });
  const [cash, setCash] = useState(order.paidCash ? String(order.paidCash) : '');
    const [transfer, setTransfer] = useState(order.paidTransfer ? String(order.paidTransfer) : '');
  // Lo que ya debía de antes: si paga algo, se cobra acá mismo
  const owed = round2(Number(order.prevDebt) || 0);
  const [prevMode, setPrevMode] = useState<'none' | 'cash' | 'transfer' | 'mixed'>(() => {
    const c = order.prevCash || 0, t = order.prevTransfer || 0;
    if (!c && !t) return 'none';
    if (c >= owed - 0.009 && !t) return 'cash';
    if (t >= owed - 0.009 && !c) return 'transfer';
    return 'mixed';
  });
  const [prevCash, setPrevCash] = useState(order.prevCash ? String(order.prevCash) : '');
  const [prevTransfer, setPrevTransfer] = useState(order.prevTransfer ? String(order.prevTransfer) : '');
  const [saving, setSaving] = useState(false);

  const preview = { ...order, deliveryStatus: status, deliveredItems: status === 'PARTIAL' ? JSON.stringify(items) : null };
  const total = deliveredTotal(preview);
  const paidCash = mode === 'cash' ? total : mode === 'mixed' ? num(cash) : 0;
  const paidTransfer = mode === 'transfer' ? total : mode === 'mixed' ? num(transfer) : 0;
  const debt = round2(total - paidCash - paidTransfer);
    const over = debt < -0.009;
  const noClient = !order.clientId && debt > 0.009;
  const pCash = prevMode === 'cash' ? owed : prevMode === 'mixed' ? num(prevCash) : 0;
  const pTransfer = prevMode === 'transfer' ? owed : prevMode === 'mixed' ? num(prevTransfer) : 0;
  const prevOver = pCash + pTransfer > owed + 0.009;

  const step = (it: any, dir: 1 | -1) => {
    const size = Number(it.packSize) > 1 ? Number(it.packSize) : 1;
    setItems((prev) => ({ ...prev, [it.id]: Math.max(0, Math.min(it.quantity, (prev[it.id] ?? it.quantity) + dir * size)) }));
  };

  const save = async () => {
    if (status === 'NOT_DELIVERED' && !reason.trim()) { toast.error('Elegí por qué no se entregó'); return; }
    if (status === 'PARTIAL' && total <= 0) { toast.error('Si no dejó nada, elegí "No se entregó"'); return; }
    if (over) { toast.error('Lo cobrado supera lo entregado'); return; }
        if (noClient) { toast.error('Este pedido no tiene cliente: hay que cobrarlo completo'); return; }
    if (prevOver) { toast.error(`De antes debía ${money(owed)}: no se puede cobrar más`); return; }
    setSaving(true);
    try {
      const { data } = await api.put(`/delivery-runs/${run.id}/stops/${order.id}/delivery`, {
        status, reason: reason.trim() || undefined, items: status === 'PARTIAL' ? items : undefined,
                cash: status === 'NOT_DELIVERED' ? 0 : paidCash, transfer: status === 'NOT_DELIVERED' ? 0 : paidTransfer,
        ...(owed > 0 || order.prevCash || order.prevTransfer ? { prevCash: pCash, prevTransfer: pTransfer } : {}),
      });
      toast.success(status === 'NOT_DELIVERED' ? 'Anotado: no se entregó' : `Entrega de ${order.client?.name || 'la parada'} registrada`);
      onSaved(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar la entrega');
    } finally {
      setSaving(false);
    }
  };

  const opt = (on: boolean) => `flex-1 min-w-0 px-3 py-3 rounded-2xl border-2 text-left cursor-pointer transition-colors ${on ? 'border-rose-600 bg-rose-50/70' : 'border-slate-200 bg-white hover:border-slate-300'}`;
  const payOpt = (on: boolean) => `px-3 py-2.5 rounded-xl border-2 text-[13px] font-bold cursor-pointer flex items-center gap-2 ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`;
  const input = 'w-full h-11 px-3 rounded-xl bg-white border border-slate-300 text-[15px] font-semibold outline-none focus:border-rose-500';

  return (
    <Sheet
      title={order.client?.name || 'Parada'}
      subtitle={`${[order.client?.address, order.client?.locality].filter(Boolean).join(', ')} · Pedido N° ${order.orderNumber}`}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-slate-500">{status === 'NOT_DELIVERED' ? 'Vuelve todo al depósito' : 'Entregado'}{pCash + pTransfer > 0 ? ` · cobra ${money(pCash + pTransfer)} de antes` : ''}</p>
            <p className="text-[20px] font-bold text-slate-900 leading-tight">{status === 'NOT_DELIVERED' ? '—' : money(total)}</p>
          </div>
                    <button data-tour="entrega-save" onClick={save} disabled={saving} className="h-12 px-6 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold cursor-pointer flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
          </button>
        </div>
      }
    >
            <section data-tour="entrega-status" className="space-y-2">
        <p className="text-[13px] font-bold text-slate-700">¿Qué pasó?</p>
        <div className="flex gap-2">
          <button onClick={() => setStatus('DELIVERED')} className={opt(status === 'DELIVERED')}>
            <Check className="w-5 h-5 text-emerald-600 mb-1" />
            <span className="block text-[14px] font-bold text-slate-900 leading-tight">Entregado todo</span>
          </button>
          <button onClick={() => setStatus('PARTIAL')} className={opt(status === 'PARTIAL')}>
            <Truck className="w-5 h-5 text-amber-600 mb-1" />
            <span className="block text-[14px] font-bold text-slate-900 leading-tight">Con cambios</span>
          </button>
          <button onClick={() => setStatus('NOT_DELIVERED')} className={opt(status === 'NOT_DELIVERED')}>
            <PackageX className="w-5 h-5 text-rose-600 mb-1" />
            <span className="block text-[14px] font-bold text-slate-900 leading-tight">No se entregó</span>
          </button>
        </div>
      </section>

      {status === 'PARTIAL' && (
        <section className="space-y-2">
          <p className="text-[13px] font-bold text-slate-700">¿Cuánto dejó de cada cosa?</p>
          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {(order.items || []).map((it: any) => {
              const size = Number(it.packSize) > 1 ? Number(it.packSize) : 0;
              const left = items[it.id] ?? it.quantity;
              const back = it.quantity - left;
              return (
                <div key={it.id} className="px-3 py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-slate-900 leading-tight">{it.productName}</p>
                    <p className="text-[12px] text-slate-500 mt-0.5">
                      Pidió {size ? `${qty(it.quantity / size)} bultos` : `${qty(it.quantity)} u.`}
                      {back > 0 && <span className="text-rose-700 font-semibold"> · vuelve {size ? `${qty(back / size)} bulto(s)` : `${qty(back)} u.`}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 shrink-0">
                    <button onClick={() => step(it, -1)} className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer" aria-label="Uno menos"><Minus className="w-4 h-4" /></button>
                    <span className="min-w-10 text-center leading-none">
                      <span className="block text-[15px] font-bold">{qty(size ? left / size : left)}</span>
                      <span className="block text-[9.5px] font-semibold text-slate-500 uppercase mt-0.5">{size ? 'bultos' : 'u.'}</span>
                    </span>
                    <button onClick={() => step(it, 1)} className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer" aria-label="Uno más"><Plus className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {status !== 'DELIVERED' && (
        <section className="space-y-2">
          <p className="text-[13px] font-bold text-slate-700">{status === 'NOT_DELIVERED' ? '¿Por qué no se entregó?' : '¿Por qué el cambio?'} {status === 'PARTIAL' && <span className="font-normal text-slate-400">(opcional)</span>}</p>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((r) => (
              <button key={r} onClick={() => setReason(r)} className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border cursor-pointer ${reason === r ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{r}</button>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="U otro motivo" className="w-full h-11 px-3.5 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:border-rose-500" />
        </section>
      )}

      {status !== 'NOT_DELIVERED' && (
                <section data-tour="entrega-pay" className="space-y-2">
          <p className="text-[13px] font-bold text-slate-700">¿Cómo pagó los {money(total)}?</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('cash')} className={payOpt(mode === 'cash')}><Banknote className="w-4 h-4" /> Todo en efectivo</button>
            <button onClick={() => setMode('transfer')} className={payOpt(mode === 'transfer')}><Landmark className="w-4 h-4" /> Todo transferencia</button>
            <button onClick={() => setMode('debt')} disabled={!order.clientId} className={`${payOpt(mode === 'debt')} disabled:opacity-40`}><BookUser className="w-4 h-4" /> No pagó (a cuenta)</button>
            <button onClick={() => setMode('mixed')} className={payOpt(mode === 'mixed')}>Pagó una parte</button>
          </div>
          {mode === 'mixed' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="block">
                <span className="block text-[12px] font-bold text-slate-600 mb-1">Efectivo</span>
                <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" className={input} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-bold text-slate-600 mb-1">Transferencia</span>
                <input inputMode="decimal" value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="0" className={input} />
              </label>
            </div>
          )}
                    {(mode === 'debt' || mode === 'mixed') && (
            <p className={`text-[13px] px-3.5 py-2.5 rounded-xl ${over ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
              {over ? `Lo cobrado supera lo entregado en ${money(-debt)}.` : debt > 0.009 ? <>Queda <strong>{money(debt)}</strong> en la cuenta corriente del cliente.</> : 'Pagó todo.'}
            </p>
          )}
        </section>
      )}

      {owed > 0.009 && (
        <section data-tour="entrega-prev" className="space-y-2">
          <p className="text-[13px] font-bold text-slate-700">De antes debía <span className="text-rose-700">{money(owed)}</span>. ¿Pagó algo de eso?</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setPrevMode('none')} className={payOpt(prevMode === 'none')}>No pagó nada de eso</button>
            <button onClick={() => setPrevMode('cash')} className={payOpt(prevMode === 'cash')}><Banknote className="w-4 h-4" /> Todo en efectivo</button>
            <button onClick={() => setPrevMode('transfer')} className={payOpt(prevMode === 'transfer')}><Landmark className="w-4 h-4" /> Todo transferencia</button>
            <button onClick={() => setPrevMode('mixed')} className={payOpt(prevMode === 'mixed')}>Una parte</button>
          </div>
          {prevMode === 'mixed' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="block">
                <span className="block text-[12px] font-bold text-slate-600 mb-1">Efectivo</span>
                <input inputMode="decimal" value={prevCash} onChange={(e) => setPrevCash(e.target.value)} placeholder="0" className={input} />
              </label>
              <label className="block">
                <span className="block text-[12px] font-bold text-slate-600 mb-1">Transferencia</span>
                <input inputMode="decimal" value={prevTransfer} onChange={(e) => setPrevTransfer(e.target.value)} placeholder="0" className={input} />
              </label>
            </div>
          )}
          {prevMode !== 'none' && (
            <p className={`text-[13px] px-3.5 py-2.5 rounded-xl ${prevOver ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
              {prevOver ? `Es más de lo que debía (${money(owed)}).` : owed - pCash - pTransfer > 0.009 ? <>De lo de antes le queda debiendo <strong>{money(owed - pCash - pTransfer)}</strong>.</> : 'Saldó todo lo que debía de antes.'}
            </p>
          )}
        </section>
      )}
    </Sheet>
  );
}

// ─── Salida ───────────────────────────────────────────────────────

/** "Salió a reparto": confirma qué pasa al salir y, si la facturación está activa, si se factura */
export function DispatchSheet({ run, onClose, onDone }: { run: any; onClose: () => void; onDone: (run: any) => void }) {
  const orders = (run.orders || []).filter((o: any) => o.status === 'PENDING' || (o.status === 'BILLED' && o.saleId));
  const total = orders.reduce((s: number, o: any) => s + (o.total || 0), 0);
  const [canInvoice, setCanInvoice] = useState(false);
  const [invoice, setInvoice] = useState(true);
  const [saving, setSaving] = useState(false);
  const short = (run.shortages || []).length > 0;
  const [salirIgual, setSalirIgual] = useState(false);
  useEffect(() => {
    if (COMING_SOON.arcaInvoicing) return;
    api.get('/fiscal/config', { silent: true } as any).then(({ data }) => setCanInvoice(Boolean(data?.enabled))).catch(() => {});
  }, []);

  const go = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/delivery-runs/${run.id}/dispatch`, { invoice: canInvoice && invoice ? 'all' : 'none', allowShortages: salirIgual });
      (data.warnings || []).forEach((w: string) => toast(w, { icon: '🧾', duration: 9000 }));
      if (data.errors?.length) {
        data.errors.forEach((e: string) => toast.error(e, { duration: 9000 }));
        toast('El reparto sigue armándose: corregí lo de arriba y volvé a tocar "Salió a reparto". Lo que ya salió no se repite.', { icon: '⚠️', duration: 9000 });
      } else {
        toast.success(data.invoiced ? 'Reparto en camino: ventas registradas y facturas en camino a ARCA' : 'Reparto en camino: ventas registradas');
      }
      onDone(data.run);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo registrar la salida');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title="Salió a reparto"
      subtitle={`Reparto N° ${run.runNumber}${run.driverName ? ` · ${run.driverName}` : ''}`}
      onClose={onClose}
      footer={
        <button onClick={go} disabled={saving || (short && !salirIgual)} className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold cursor-pointer flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Confirmar la salida
        </button>
      }
    >
      <section className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 text-[14px]">
        <div className="px-4 py-3 flex justify-between"><span className="text-slate-600">Pedidos</span><strong className="text-slate-900">{orders.length}</strong></div>
        <div className="px-4 py-3 flex justify-between"><span className="text-slate-600">Total</span><strong className="text-slate-900">{money(total)}</strong></div>
      </section>
      <ShortagesBanner shortages={run.shortages} />
      {short && (
        <button onClick={() => setSalirIgual((v) => !v)} className={`w-full text-left px-4 py-3 rounded-2xl border-2 cursor-pointer flex items-start gap-3 ${salirIgual ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <span className={`w-5 h-5 mt-0.5 rounded-md border-2 flex items-center justify-center shrink-0 ${salirIgual ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>{salirIgual && <Check className="w-3.5 h-3.5 text-white" />}</span>
          <span>
            <span className="block text-[14px] font-bold text-slate-900">Salir igual</span>
            <span className="block text-[12.5px] text-slate-500">Si la mercadería está pero no se cargó la compra. El stock queda en negativo hasta que la cargues.</span>
          </span>
        </button>
      )}
      <section className="space-y-2 text-[13.5px] text-slate-700 leading-snug">
        <p className="font-bold text-slate-900">Al confirmar:</p>
        <p className="flex gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> Cada pedido queda como venta con su mismo número, a la cuenta corriente del cliente hasta que pague.</p>
        <p className="flex gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> La mercadería sale del stock: ya está en el camión.</p>
        <p className="flex gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> Lo que vuelva sin entregar entra de nuevo al stock en la rendición.</p>
      </section>
      {canInvoice && (
        <button onClick={() => setInvoice((v) => !v)} className={`w-full text-left px-4 py-3 rounded-2xl border-2 cursor-pointer flex items-start gap-3 ${invoice ? 'border-rose-600 bg-rose-50/70' : 'border-slate-200 bg-white'}`}>
          <span className={`w-5 h-5 mt-0.5 rounded-md border-2 flex items-center justify-center shrink-0 ${invoice ? 'bg-rose-600 border-rose-600' : 'border-slate-300'}`}>{invoice && <Check className="w-3.5 h-3.5 text-white" />}</span>
          <span>
            <span className="block text-[14px] font-bold text-slate-900">Facturar con ARCA</span>
            <span className="block text-[12.5px] text-slate-500">La factura de cada venta sale sola y viaja con la mercadería. Los rechazos llevan su nota de crédito.</span>
          </span>
        </button>
      )}
    </Sheet>
  );
}

// ─── Rendición ────────────────────────────────────────────────────

export function SettleSheet({ run, onClose, onDone }: { run: any; onClose: () => void; onDone: (run: any) => void }) {
  useAutoTour('distribRendir');
  const orders = (run.orders || []).filter((o: any) => o.status === 'BILLED' && o.saleId);
  const delivered = orders.filter((o: any) => o.deliveryStatus === 'DELIVERED' || o.deliveryStatus === 'PARTIAL');
  const notDelivered = orders.filter((o: any) => o.deliveryStatus === 'NOT_DELIVERED');
  const unregistered = orders.filter((o: any) => !o.deliveryStatus);
  const cash = round2(delivered.reduce((s: number, o: any) => s + (o.paidCash || 0), 0));
  const transfer = round2(delivered.reduce((s: number, o: any) => s + (o.paidTransfer || 0), 0));
    const debt = round2(delivered.reduce((s: number, o: any) => s + deliveredTotal(o), 0) - cash - transfer);
  // Lo que pagaron de deudas viejas (también en paradas sin entrega)
  const prevCash = round2(orders.reduce((s: number, o: any) => s + (o.prevCash || 0), 0));
  const prevTransfer = round2(orders.reduce((s: number, o: any) => s + (o.prevTransfer || 0), 0));
  const cashTotal = round2(cash + prevCash);

  // Lo que vuelve al depósito: rechazos y paradas no entregadas
  const returns = useMemo(() => {
    const map = new Map<string, { name: string; units: number; pack: number }>();
    for (const o of orders) {
      const left = new Map(deliveredLines(o).map((it: any) => [it.id, it.quantity]));
      for (const it of o.items || []) {
        const back = it.quantity - Number(left.get(it.id) || 0);
        if (back <= 0) continue;
        const r = map.get(it.productId) || { name: it.productName, units: 0, pack: Number(it.packSize) > 1 ? Number(it.packSize) : 0 };
        r.units += back;
        map.set(it.productId, r);
      }
    }
    return Array.from(map.values());
  }, [run]);

      // Gastos que pagó con lo cobrado (nafta, peaje...): se descuentan de lo que tiene que traer
  const [expenses, setExpenses] = useState<{ concept: string; amount: string }[]>([]);
  const expTotal = round2(expenses.reduce((s, e) => s + num(e.amount), 0));
  const netCash = round2(cashTotal - expTotal);
  const [received, setReceived] = useState(String(cashTotal));
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setReceived(String(netCash)); }, [netCash, touched]);
  const addExpense = (concept: string) => setExpenses((list) => [...list, { concept: concept === 'Otro' ? '' : concept, amount: '' }]);
  const [undelivered, setUndelivered] = useState<'REPROGRAM' | 'CANCEL'>('REPROGRAM');
  const [saving, setSaving] = useState(false);
      const diff = round2(num(received) - netCash);

  const settle = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/delivery-runs/${run.id}/settle`, {
        cashReceived: num(received), undelivered,
        expenses: expenses.filter((e) => num(e.amount) > 0).map((e) => ({ concept: e.concept.trim() || 'Gasto', amount: num(e.amount) })),
      });
      (data.warnings || []).forEach((w: string) => toast(w, { icon: '🧾', duration: 9000 }));
      if (data.errors?.length) {
        data.errors.forEach((e: string) => toast.error(e, { duration: 9000 }));
        toast('El reparto quedó abierto: corregí lo de arriba y volvé a rendir. Lo que ya se registró no se repite.', { icon: '⚠️', duration: 9000 });
      } else {
        toast.success('Reparto rendido: los cobros quedaron registrados y lo que volvió, en el stock');
      }
      onDone(data.run);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo rendir el reparto');
    } finally {
      setSaving(false);
    }
  };

  const row = (icon: any, label: string, value: string, strong?: boolean) => (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">{icon}</span>
      <span className="flex-1 text-[14px] text-slate-700">{label}</span>
      <span className={`text-[15px] ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{value}</span>
    </div>
  );

  return (
    <Sheet
      title="Rendir reparto"
      subtitle={`Reparto N° ${run.runNumber}${run.driverName ? ` · ${run.driverName}` : ''}`}
      onClose={onClose}
      footer={
                <button data-tour="rendir-close" onClick={settle} disabled={saving} className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[15px] font-bold cursor-pointer flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Cerrar el reparto y registrar las ventas
        </button>
      }
    >
      {unregistered.length > 0 && (
        <div className="flex gap-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p><strong>{unregistered.length === 1 ? 'Falta registrar 1 parada' : `Faltan registrar ${unregistered.length} paradas`}</strong> ({unregistered.map((o: any) => o.client?.name || `N° ${o.orderNumber}`).join(', ')}). Si cerrás así, se toman como no entregadas.</p>
        </div>
      )}

            <section data-tour="rendir-summary" className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
        {row(<Check className="w-4 h-4 text-emerald-600" />, 'Entregas', `${delivered.length} de ${orders.length}`)}
                        {row(<Banknote className="w-4 h-4 text-slate-600" />, 'Efectivo que tiene que traer', money(netCash), true)}
        {expTotal > 0 && row(<Fuel className="w-4 h-4 text-amber-600" />, 'Ya descontados los gastos', `− ${money(expTotal)}`)}
        {row(<Landmark className="w-4 h-4 text-slate-600" />, 'Transferencias', money(round2(transfer + prevTransfer)))}
        {prevCash + prevTransfer > 0.009 && row(<BookUser className="w-4 h-4 text-emerald-600" />, 'Incluye cobros de deudas anteriores', money(round2(prevCash + prevTransfer)))}
        {row(<BookUser className="w-4 h-4 text-slate-600" />, 'Quedó en cuenta corriente', money(debt > 0 ? debt : 0))}
      </section>

                  <section data-tour="rendir-expenses" className="space-y-2">
        <p className="text-[13px] font-bold text-slate-700">¿Gastó algo de lo cobrado? <span className="font-normal text-slate-400">(opcional)</span></p>
        <div className="flex flex-wrap gap-2">
          {['Nafta', 'Peaje', 'Comida', 'Otro'].map((c) => (
            <button key={c} onClick={() => addExpense(c)} className="h-9 px-3.5 rounded-full text-[13px] font-semibold border border-slate-200 bg-white text-slate-700 cursor-pointer hover:border-slate-300 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> {c}
            </button>
          ))}
        </div>
        {expenses.map((e, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={e.concept} onChange={(ev) => setExpenses((list) => list.map((x, k) => (k === i ? { ...x, concept: ev.target.value } : x)))} placeholder="En qué" maxLength={60}
              className="flex-1 min-w-0 h-11 px-3 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:border-rose-500" />
            <input inputMode="decimal" value={e.amount} onChange={(ev) => setExpenses((list) => list.map((x, k) => (k === i ? { ...x, amount: ev.target.value } : x)))} placeholder="$" aria-label={`Monto de ${e.concept || 'gasto'}`}
              className="w-28 h-11 px-3 rounded-xl bg-white border border-slate-300 text-[15px] font-semibold outline-none focus:border-rose-500" />
            <button onClick={() => setExpenses((list) => list.filter((_, k) => k !== i))} className="w-9 h-9 rounded-lg hover:bg-slate-200/60 flex items-center justify-center cursor-pointer shrink-0" aria-label="Quitar gasto"><X className="w-4 h-4 text-slate-500" /></button>
          </div>
        ))}
        {expTotal > 0 && <p className="text-[12px] text-slate-500">Se descuentan {money(expTotal)} de lo que tiene que traer y quedan como gasto del reparto.</p>}
      </section>

      <section data-tour="rendir-cash" className="space-y-2">
        <label className="block text-[13px] font-bold text-slate-700">¿Cuánto efectivo entregó el chofer?</label>
                <input inputMode="decimal" value={received} onChange={(e) => { setTouched(true); setReceived(e.target.value); }} className="w-full h-12 px-4 rounded-xl bg-white border border-slate-300 text-[18px] font-bold outline-none focus:border-rose-500" />
        <p className={`text-[13px] font-semibold px-3.5 py-2.5 rounded-xl ${Math.abs(diff) < 0.01 ? 'bg-emerald-50 text-emerald-800' : diff < 0 ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
          {Math.abs(diff) < 0.01 ? 'La plata cierra justa.' : diff < 0 ? `Faltan ${money(-diff)}.` : `Sobran ${money(diff)}.`}
        </p>
      </section>

      {returns.length > 0 && (
        <section className="space-y-2">
          <p className="text-[13px] font-bold text-slate-700">Vuelve al depósito</p>
          <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {returns.map((r) => (
              <div key={r.name} className="px-4 py-2.5 flex items-center justify-between text-[14px]">
                <span className="text-slate-800">{r.name}</span>
                <span className="font-bold text-slate-900">{r.pack && r.units % r.pack === 0 ? `${qty(r.units / r.pack)} bulto(s)` : `${qty(r.units)} u.`}</span>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-slate-500">No hace falta cargarlo a mano: vuelve solo al stock con su devolución (y su nota de crédito si la venta tenía factura).</p>
        </section>
      )}

      {(notDelivered.length + unregistered.length) > 0 && (
                <section data-tour="rendir-undelivered" className="space-y-2">
          <p className="text-[13px] font-bold text-slate-700">Los pedidos que no se entregaron…</p>
          <div className="grid grid-cols-1 gap-2">
            {([['REPROGRAM', 'Vuelven a pendientes', 'Para mandarlos en otro reparto.'], ['CANCEL', 'Se cancelan', 'El cliente ya no los quiere.']] as const).map(([k, l, h]) => (
              <button key={k} onClick={() => setUndelivered(k)} className={`text-left px-4 py-3 rounded-2xl border-2 cursor-pointer ${undelivered === k ? 'border-rose-600 bg-rose-50/70' : 'border-slate-200 bg-white'}`}>
                <span className="block text-[14px] font-bold text-slate-900">{l}</span>
                <span className="block text-[12.5px] text-slate-500">{h}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="text-[12px] text-slate-500 leading-snug">
        Lo cobrado queda registrado en el reparto (no hace falta abrir ninguna caja) y le baja la deuda a cada cliente. Lo que no pagó queda en su cuenta corriente.
      </p>
    </Sheet>
  );
}
