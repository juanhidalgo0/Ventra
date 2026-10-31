import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Ban, Check, Loader2, MessageCircle, PackageCheck, Plus, Search, Truck, X } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getPaymentMethods } from '../mobile/checkout';
import { waNumber } from '../workorders/workOrderUtils';
import { openExternal } from '../../utils/externalLinks';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const amountOf = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'wo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const what = (o: any) => (o.items || []).map((i: any) => (i.quantity > 1 ? `${i.quantity} × ${i.description}` : i.description)).join(' · ');

const METHODS = () => [...getPaymentMethods().filter((m) => m.id !== 'DEBT'), { id: 'TRANSFERENCIA', name: 'Transferencia' }];
const field = 'w-full h-11 px-3 rounded-xl bg-white border border-slate-300 text-[15px] text-slate-900 outline-none focus:border-rose-500';
const label = 'block text-[12.5px] font-semibold text-slate-600 mb-1';

type View = { name: 'list' } | { name: 'new' } | { name: 'pickup'; order: any } | { name: 'cancel'; order: any };

/**
 * Encargos en la caja (revistas, diarios y demás): el cajero anota qué encarga el cliente, con sus
 * datos y una seña opcional. Cuando llega se le avisa por WhatsApp, y al retirarlo paga la diferencia.
 * Es la misma tabla que los encargos de imprenta, sin sus etapas ni prioridades.
 */
export default function ClientOrdersModal({ sessionId, onClose }: { sessionId?: string; onClose: () => void }) {
  const [view, setView] = useState<View>({ name: 'list' });
  const [orders, setOrders] = useState<any[] | null>(null);
  const [tab, setTab] = useState<'PENDIENTE' | 'LISTO'>('PENDIENTE');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    api.get('/work-orders', { params: { status: 'ACTIVOS' } }).then(({ data }) => setOrders(data || [])).catch(() => setOrders([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const waiting = (orders || []).filter((o) => o.status !== 'LISTO');
  const ready = (orders || []).filter((o) => o.status === 'LISTO');
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tab === 'LISTO' ? ready : waiting;
    return q ? list.filter((o) => `${o.client?.name || ''} ${o.client?.phone || ''} ${what(o)}`.toLowerCase().includes(q)) : list;
  }, [orders, tab, search]);

  const back = () => { setView({ name: 'list' }); load(); };

  const notify = async (o: any) => {
    const phone = waNumber(o.client?.phone);
    if (!phone) { toast.error('Este cliente no tiene un teléfono cargado'); return; }
    const rest = Math.max(0, o.total - o.deposit);
    const owes = rest > 0 ? ` Te queda por pagar ${money(rest)}.` : '';
    const text = o.notifiedAt
      ? `Hola ${o.client?.name || ''}! Te recordamos que tu encargo (${what(o)}) ya está para retirar.${owes}`
      : `Hola ${o.client?.name || ''}! Ya llegó tu encargo: ${what(o)}. Podés pasar a retirarlo.${owes}`;
    openExternal(`https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`);
    await api.post(`/work-orders/${o.id}/notified`).catch(() => {});
    load();
  };

  const arrived = async (o: any) => {
    try {
      await api.post(`/work-orders/${o.id}/status`, { status: 'LISTO' });
      toast.success('Pasó a Para retirar');
      setTab('LISTO');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cambiar');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl h-[85vh] bg-slate-50 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-2">
          {view.name !== 'list' && <button onClick={back} aria-label="Volver" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"><ArrowLeft className="w-5 h-5 text-slate-700" /></button>}
          <h2 className="flex-1 text-[17px] font-bold text-slate-900">
            {view.name === 'new' ? 'Nuevo encargo' : view.name === 'pickup' ? 'Retira el encargo' : view.name === 'cancel' ? 'Cancelar encargo' : 'Encargos'}
          </h2>
          {view.name === 'list' && <button onClick={() => setView({ name: 'new' })} className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold flex items-center gap-2 cursor-pointer"><Plus className="w-4 h-4" /> Nuevo encargo</button>}
          <button onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        {view.name === 'new' && <NewOrder sessionId={sessionId} onDone={back} />}
        {view.name === 'pickup' && <Pickup order={view.order} sessionId={sessionId} onDone={back} />}
        {view.name === 'cancel' && <CancelOrder order={view.order} onDone={back} />}
        {view.name === 'list' && (
          <>
            <div className="shrink-0 px-4 pt-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-200/70">
                {([['PENDIENTE', 'Por llegar', waiting.length], ['LISTO', 'Para retirar', ready.length]] as const).map(([id, text, n]) => (
                  <button key={id} onClick={() => setTab(id)} className={`h-9 rounded-lg text-[14px] font-semibold cursor-pointer ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{text} ({n})</button>
                ))}
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className={`${field} pl-9`} placeholder="Buscar por cliente o artículo" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {orders === null ? (
                <div className="py-14 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
              ) : shown.length === 0 ? (
                <p className="py-14 text-center text-[14px] text-slate-500">{search ? 'Sin resultados.' : tab === 'LISTO' ? 'No hay encargos para retirar.' : 'No hay encargos por llegar.'}</p>
              ) : shown.map((o) => {
                const rest = Math.max(0, o.total - o.deposit);
                return (
                  <div key={o.id} className="rounded-xl bg-white border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-slate-900 truncate">{what(o)}</p>
                        <p className="text-[13px] text-slate-600 truncate">{o.client?.name || 'Sin cliente'}{o.client?.phone ? ` · ${o.client.phone}` : ''}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[15px] font-bold text-slate-900 tabular-nums">{o.total > 0 ? (rest > 0 ? `Debe ${money(rest)}` : 'Pagado') : 'Sin precio'}</p>
                        {o.deposit > 0 && <p className="text-[12.5px] text-slate-500 tabular-nums">Seña {money(o.deposit)}</p>}
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {o.status !== 'LISTO' ? (
                        <button onClick={() => arrived(o)} className="h-9 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[13.5px] font-semibold flex items-center gap-1.5 cursor-pointer"><Truck className="w-4 h-4" /> Llegó</button>
                      ) : (
                        <>
                          <button onClick={() => setView({ name: 'pickup', order: o })} className="h-9 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[13.5px] font-semibold flex items-center gap-1.5 cursor-pointer"><PackageCheck className="w-4 h-4" /> Retira</button>
                          <button onClick={() => notify(o)} className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[13.5px] font-semibold flex items-center gap-1.5 cursor-pointer">
                            <MessageCircle className="w-4 h-4" /> {o.notifiedAt ? 'Enviar recordatorio' : 'Avisar por WhatsApp'}
                          </button>
                          {o.notifiedAt && <span className="text-[12.5px] font-medium text-emerald-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Avisado</span>}
                        </>
                      )}
                      <button onClick={() => setView({ name: 'cancel', order: o })} className="ml-auto h-9 px-2.5 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600 text-[13px] font-medium flex items-center gap-1.5 cursor-pointer"><Ban className="w-3.5 h-3.5" /> Cancelar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function NewOrder({ sessionId, onDone }: { sessionId?: string; onDone: () => void }) {
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState('');
  const methods = useMemo(METHODS, []);
  const [method, setMethod] = useState('CASH');
  const [busy, setBusy] = useState(false);
  // El id queda fijo: si se reintenta después de un error, no se duplica el encargo
  const [id] = useState(newId);

  const qty = amountOf(quantity);
  const total = qty * amountOf(price);
  const sena = amountOf(deposit);

  const save = async () => {
    if (!description.trim()) { toast.error('Escribí qué encarga'); return; }
    if (!(qty > 0)) { toast.error('Poné la cantidad'); return; }
    if (!name.trim()) { toast.error('Escribí el nombre del cliente'); return; }
    if (!waNumber(phone)) { toast.error('Escribí el teléfono del cliente con característica (ej.: 221 555-0199)'); return; }
    if (sena > 0 && !sessionId) { toast.error('Abrí la caja para cobrar la seña'); return; }
    if (total > 0 && sena > total + 0.009) { toast.error('La seña no puede ser mayor que el total'); return; }
    setBusy(true);
    try {
      const { data } = await api.put(`/work-orders/${id}`, {
        items: [{ description: description.trim().toUpperCase(), quantity: qty, unitPrice: amountOf(price) }],
        clientName: name.trim(), clientPhone: phone.trim(),
      });
      if (sena > 0) await api.post(`/work-orders/${id}/collect`, { amount: sena, method, sessionId, key: 'alta' });
      toast.success(`Encargo N° ${data.number} guardado`);
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el encargo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex-1 min-h-0 flex flex-col" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <div><label className={label}>Qué encarga</label><input className={field} autoFocus placeholder="Ej.: Revista Caras" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><label className={label}>Cantidad</label><input className={field} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><label className={label}>Nombre del cliente</label><input className={field} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className={label}>Teléfono</label><input className={field} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div><label className={label}>Precio c/u (opcional)</label><input className={field} inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><label className={label}>Seña (opcional)</label><input className={field} inputMode="decimal" placeholder="0" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></div>
          {sena > 0 && (
            <div><label className={label}>Paga la seña con</label>
              <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0 text-[14px] text-slate-600 tabular-nums">{total > 0 ? <>Total <b className="text-slate-900">{money(total)}</b>{sena > 0 && <> · Al retirar paga <b className="text-slate-900">{money(Math.max(0, total - sena))}</b></>}</> : <>Sin precio: se carga cuando lo retira{sena > 0 && <> · Seña <b className="text-slate-900">{money(sena)}</b></>}</>}</div>
        <button type="submit" disabled={busy} className="h-11 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold flex items-center gap-2 cursor-pointer">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
        </button>
      </div>
    </form>
  );
}

function Pickup({ order, sessionId, onDone }: { order: any; sessionId?: string; onDone: () => void }) {
  const needsPrice = !(order.total > 0);
  const item = order.items?.[0];
  const [price, setPrice] = useState('');
  const methods = useMemo(METHODS, []);
  // Pago mixto: se escribe cuánto va por cada medio y el último se lleva lo que falta
  const [rows, setRows] = useState([{ method: 'CASH', amount: '' }]);
  const [busy, setBusy] = useState(false);
  const total = needsPrice ? (item?.quantity || 1) * amountOf(price) : order.total;
  const rest = Math.max(0, total - order.deposit);
  const typed = rows.slice(0, -1).reduce((s, r) => s + amountOf(r.amount), 0);
  const lastAmount = Math.round((rest - typed) * 100) / 100;
  const setRow = (i: number, patch: Partial<{ method: string; amount: string }>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    const used = rows.map((r) => r.method);
    const next = methods.find((m) => !used.includes(m.id))?.id || 'CASH';
    setRows((rs) => [...rs, { method: next, amount: '' }]);
  };

  const finish = async () => {
    if (!sessionId) { toast.error('Abrí la caja para entregar el encargo'); return; }
    if (needsPrice && !(amountOf(price) > 0)) { toast.error('Poné el precio'); return; }
    if (total + 0.009 < order.deposit) { toast.error(`El total no puede ser menor que la seña de ${money(order.deposit)}`); return; }
    if (rest > 0 && rows.length > 1 && (rows.slice(0, -1).some((r) => !(amountOf(r.amount) > 0)) || lastAmount <= 0)) {
      toast.error(`Los montos tienen que sumar ${money(rest)}`);
      return;
    }
    const payments = rest > 0 ? rows.map((r, i) => ({ method: r.method, amount: i === rows.length - 1 ? lastAmount : amountOf(r.amount) })) : [];
    setBusy(true);
    try {
      if (needsPrice) {
        await api.put(`/work-orders/${order.id}`, {
          clientId: order.clientId, priority: order.priority, dueAt: order.dueAt, notes: order.notes,
          items: order.items.map((i: any, n: number) => ({ productId: i.productId, description: i.description, specs: i.specs, quantity: i.quantity, unitPrice: n === 0 ? amountOf(price) : i.unitPrice })),
        });
      }
      await api.post(`/work-orders/${order.id}/deliver`, { sessionId, payments });
      toast.success(rest > 0 ? `Cobrado ${money(rest)} y entregado` : 'Entregado');
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo entregar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex-1 min-h-0 flex flex-col" onSubmit={(e) => { e.preventDefault(); finish(); }}>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <p className="text-[16px] font-bold text-slate-900">{what(order)}</p>
          <p className="text-[13.5px] text-slate-600">{order.client?.name}</p>
        </div>
        {needsPrice && <div><label className={label}>Precio c/u</label><input className={field} autoFocus inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
        <div className="rounded-xl bg-white border border-slate-200 p-4 space-y-1.5 text-[15px] tabular-nums">
          <div className="flex justify-between"><span className="text-slate-600">Total</span><span className="font-semibold text-slate-900">{money(total)}</span></div>
          <div className="flex justify-between"><span className="text-slate-600">Seña que dejó</span><span className="font-semibold text-slate-900">− {money(order.deposit)}</span></div>
          <div className="flex justify-between items-baseline pt-2 border-t border-slate-200"><span className="font-bold text-slate-900">A cobrar</span><span className="text-[24px] font-bold text-rose-700">{money(rest)}</span></div>
        </div>
        {rest > 0 && (
          <div className="space-y-2">
            <label className={`${label} !mb-0`}>Paga con</label>
            {rows.map((r, i) => {
              const isLast = i === rows.length - 1;
              return (
                <div key={i} className="flex items-center gap-2">
                  <select aria-label={`Medio de pago ${i + 1}`} className={field} value={r.method} onChange={(e) => setRow(i, { method: e.target.value })}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                  {rows.length > 1 && (
                    isLast
                      ? <p className={`w-36 h-11 shrink-0 px-3 rounded-xl bg-slate-100 text-[15px] font-semibold tabular-nums flex items-center justify-end ${lastAmount > 0 ? 'text-slate-900' : 'text-red-600'}`} title="Lo que falta">{money(lastAmount)}</p>
                      : <input aria-label={`Monto ${i + 1}`} className={`${field} !w-36 shrink-0 text-right`} inputMode="decimal" placeholder="0" autoFocus value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                  )}
                  {rows.length > 1 && <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Quitar medio de pago ${i + 1}`} className="w-9 h-9 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center shrink-0 cursor-pointer"><X className="w-4 h-4" /></button>}
                </div>
              );
            })}
            <button type="button" onClick={addRow} className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[13.5px] font-semibold flex items-center gap-1.5 cursor-pointer"><Plus className="w-4 h-4" /> {rows.length > 1 ? 'Otro medio de pago' : 'Pago mixto'}</button>
          </div>
        )}
      </div>
      <div className="shrink-0 bg-white border-t border-slate-200 px-4 py-3">
        <button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {rest > 0 ? `Cobrar ${money(rest)} y entregar` : 'Entregar'}
        </button>
      </div>
    </form>
  );
}

/** Con seña cobrada, la plata queda a favor del cliente: al cajero le pide la clave del dueño */
function CancelOrder({ order, onDone }: { order: any; onDone: () => void }) {
  const isAdmin = useAuthStore((s) => s.user?.role === 'ADMIN');
  const needsKey = order.deposit > 0 && !isAdmin;
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    if (needsKey && !adminPassword) { toast.error('Hace falta la clave del dueño'); return; }
    setBusy(true);
    try {
      await api.post(`/work-orders/${order.id}/cancel`, needsKey ? { adminPassword } : {});
      toast.success('Encargo cancelado');
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cancelar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex-1 overflow-y-auto p-4 space-y-4" onSubmit={(e) => { e.preventDefault(); cancel(); }}>
      <div>
        <p className="text-[16px] font-bold text-slate-900">{what(order)}</p>
        <p className="text-[13.5px] text-slate-600">{order.client?.name}</p>
      </div>
      {order.deposit > 0 && <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[13.5px] font-medium text-amber-800">La seña de {money(order.deposit)} queda a favor del cliente, en su cuenta.</p>}
      {needsKey && <div><label className={label}>Clave del dueño</label><input className={field} type="password" autoFocus value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} /></div>}
      <button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Cancelar el encargo
      </button>
    </form>
  );
}
