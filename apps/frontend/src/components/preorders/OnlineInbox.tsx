import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Globe, Check, X, Loader2, AlertTriangle, Link2, Truck, Store, MessageCircle } from 'lucide-react';
import api from '../../services/api';
import { useOnlineOrders } from '../../services/onlineStoreOrders';
import {
  canAcceptOrder, lockOrderForReview, finishOrderReview, wholesaleClientOf, refreshWholesaleClient,
  type StoreOrder,
} from '../../services/onlineStore';
import { readRouteDays, dayName } from '../../services/routeDays';
import { waNumber } from '../distribuidora/clientLink';

/**
 * Venta a comercios: los pedidos que hacen los clientes en la tienda llegan acá "Por revisar".
 * Hasta que se aceptan no son nada: no comprometen ni mueven stock. Aceptado, pasa a ser un
 * pedido de preventa más (comprometido, el stock sale cuando sale el reparto o al cobrarlo en el
 * mostrador). Rechazado, se cancela en la tienda y listo.
 */

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const phoneKey = (p?: string | null) => String(p || '').replace(/\D/g, '').slice(-10);
const msOf = (v: any) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : v ? new Date(v).getTime() : Date.now());
/** Cliente creado al aceptar un pedido que después falló: si se reintenta, se usa el mismo */
const createdKey = (orderId: string) => `ventra_online_client_${orderId}`;
/**
 * Aceptados acá pero sin poder marcarlos en la nube (se cortó internet justo después): se ocultan
 * en este equipo y se reintenta marcarlos, así otro equipo no lo vuelve a aceptar.
 */
const UNMARKED_KEY = 'ventra_online_unmarked';
const readUnmarked = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(UNMARKED_KEY) || '{}') || {}; } catch { return {}; } };
const writeUnmarked = (m: Record<string, string>) => { try { localStorage.setItem(UNMARKED_KEY, JSON.stringify(m)); } catch { /* sin espacio */ } };

async function markAccepted(storeId: string, orderId: string, preorderId: string) {
  for (let i = 0; i < 3; i++) {
    try {
      await finishOrderReview(storeId, orderId, { preorderId });
      const m = readUnmarked(); delete m[orderId]; writeUnmarked(m);
      return;
    } catch { await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
  }
  writeUnmarked({ ...readUnmarked(), [orderId]: preorderId });
}

/** Próximo día de reparto de la localidad, desde mañana ("mañana", "el jueves") */
function nextRun(locality: string | null | undefined) {
  const map = readRouteDays();
  const key = Object.keys(map).find((k) => norm(k) === norm(locality || ''));
  const days = key ? map[key] : null;
  if (!days?.length) return '';
  for (let k = 1; k <= 7; k++) {
    const d = new Date();
    d.setDate(d.getDate() + k);
    if (days.includes(d.getDay())) return k === 1 ? 'mañana' : `el ${dayName(d.getDay())}`;
  }
  return '';
}

/** "Calle 12 nro 345, Bavio" → localidad conocida al final de la dirección */
function splitLocality(address: string, localities: string[]) {
  const parts = (address || '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const known = localities.find((l) => norm(l) === norm(last));
  return known ? { address: parts.slice(0, -1).join(', '), locality: known } : { address: address || '', locality: '' };
}

/** En unidades, como los pedidos de preventa: el bulto se guarda como cantidad × tamaño */
function toPreOrderItems(o: StoreOrder, byId: Map<string, any>) {
  return o.items.map((it) => {
    const size = Number(it.packSize) > 1 ? Math.round(Number(it.packSize)) : 0;
    // El nombre del catálogo: la tienda le agrega " · bulto x12" y en el pedido el bulto ya se ve aparte
    const productName = byId.get(it.productId)?.name || String(it.name || '').replace(/ · bulto x\d+$/, '');
    return size
      ? { productId: it.productId, productName, quantity: it.qty * size, packSize: size, unitPrice: it.price / size }
      : { productId: it.productId, productName, quantity: it.qty, packSize: null, unitPrice: it.price };
  });
}

type ClientPick = { kind: 'link' | 'phone' | 'chosen'; client: any } | { kind: 'new' };

export default function OnlineInbox({ products, clients, onAccepted }: { products: any[]; clients: any[]; onAccepted: () => void }) {
  const { orders, storeId } = useOnlineOrders();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);
  // Los que quedaron sin marcar en la nube se vuelven a marcar apenas hay conexión
  useEffect(() => {
    if (!storeId) return;
    for (const [orderId, preorderId] of Object.entries(readUnmarked())) markAccepted(storeId, orderId, preorderId).catch(() => {});
  }, [storeId, now]);
  const unmarked = readUnmarked();
  // Recién llegados y sin tomar: ni aceptados, ni cargados en la caja, ni empezados a preparar
  const pending = orders
    .filter((o) => (!o.stage || o.stage === 'NEW') && canAcceptOrder(o, now) && !unmarked[o.id])
    .sort((a, b) => msOf(a.createdAt) - msOf(b.createdAt));

  const [committed, setCommitted] = useState<Record<string, number>>({});
  const loadCommitted = () => api.get('/preorders/committed', { silent: true } as any).then(({ data }) => setCommitted(data || {})).catch(() => {});
  useEffect(() => { if (pending.length) loadCommitted(); }, [pending.length]);

  if (!storeId || !pending.length) return null;
  return (
    <section className="rounded-2xl bg-white border-2 border-emerald-200 overflow-hidden">
      <div className="px-4 pt-3.5 pb-3 flex items-start gap-3 bg-emerald-50/60 border-b border-emerald-100">
        <Globe className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-bold text-slate-900 leading-tight">
            Por revisar: {pending.length === 1 ? '1 pedido de la tienda' : `${pending.length} pedidos de la tienda`}
          </p>
          <p className="text-[12.5px] text-slate-600 mt-0.5">Aceptado, pasa a tus pedidos y sale en el reparto. Mientras no lo aceptes no reserva mercadería.</p>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {pending.map((o) => (
          <InboxCard key={o.id} order={o} storeId={storeId} products={products} clients={clients} committed={committed}
            onDone={() => { loadCommitted(); onAccepted(); }} />
        ))}
      </div>
    </section>
  );
}

function InboxCard({ order: o, storeId, products, clients, committed, onDone }: {
  order: StoreOrder; storeId: string; products: any[]; clients: any[]; committed: Record<string, number>; onDone: () => void;
}) {
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [notify, setNotify] = useState(!!waNumber(o.customerPhone));
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState('');
  const localities = useMemo(() => Array.from(new Set([
    ...clients.map((c) => (c.locality || '').trim()).filter(Boolean),
    ...Object.keys(readRouteDays()),
  ])), [clients]);

  // ¿De quién es? Con link personal, de ese cliente. Si no, el que tenga el mismo teléfono (si hay uno solo).
  const [linked, setLinked] = useState<any | null | undefined>(o.clientToken ? undefined : null);
  useEffect(() => {
    if (!o.clientToken) return;
    wholesaleClientOf(storeId, o.clientToken)
      .then((doc) => setLinked(doc ? clients.find((c) => c.id === doc.clientId) || { id: doc.clientId, name: doc.name, locality: doc.locality, address: doc.address } : null))
      .catch(() => setLinked(null));
  }, [o.clientToken, storeId, clients.length]);
  const byPhone = useMemo(() => {
    const k = phoneKey(o.customerPhone);
    if (k.length < 8) return null;
    const found = clients.filter((c) => phoneKey(c.phone) === k);
    return found.length === 1 ? found[0] : null;
  }, [o.customerPhone, clients]);
  const [chosen, setChosen] = useState<any | 'new' | null>(null);
  const pick: ClientPick = chosen === 'new' ? { kind: 'new' }
    : chosen ? { kind: 'chosen', client: chosen }
      : linked ? { kind: 'link', client: linked }
        : byPhone ? { kind: 'phone', client: byPhone }
          : { kind: 'new' };
  const guess = splitLocality(o.address || '', localities);

  // Stock libre = stock − lo que ya está en otros pedidos sin salir
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const need = new Map<string, number>();
  for (const it of o.items) need.set(it.productId, (need.get(it.productId) || 0) + it.qty * (Number(it.packSize) > 1 ? Number(it.packSize) : 1));
  const missing = o.items.filter((it) => !byId.has(it.productId));
  const short = [...need.entries()].map(([id, units]) => {
    const p: any = byId.get(id);
    if (!p || p.stock === null || p.stock === undefined) return null;
    const free = Number(p.stock) - (committed[id] || 0);
    return units > free + 1e-9 ? { name: p.name, units, free: Math.max(0, free) } : null;
  }).filter(Boolean) as { name: string; units: number; free: number }[];

  // Son comercios ("Almacén Don Tito"): el nombre entero, no solo la primera palabra
  const who = (o.customerName || '').trim().slice(0, 40);
  const code = o.orderCode ? ` #${o.orderCode}` : '';
  const loc = pick.kind === 'new' ? guess.locality : pick.client.locality;
  const run = o.delivery === 'REPARTO' ? nextRun(loc) : '';

  const accept = async () => {
    if (missing.length && !window.confirm(`Estos productos ya no están en tu catálogo y no van a entrar: ${missing.map((m) => m.name).join(', ')}.\n\n¿Aceptar el pedido sin ellos?`)) return;
    if (missing.length === o.items.length) { toast.error('Ningún producto del pedido está en tu catálogo.'); return; }
    setBusy('accept');
    const cloud = await lockOrderForReview(storeId, o.id).catch(() => undefined);
    if (cloud === undefined) { setBusy(null); toast.error('No se pudo tomar el pedido: revisá la conexión.'); return; }
    if (!cloud) { setBusy(null); toast('Este pedido ya lo tomó otro equipo o se cargó en la caja.', { icon: 'ℹ️' }); return; }
    try {
      let clientId: string | null = pick.kind === 'new' ? null : String(pick.client.id);
      if (!clientId) {
        clientId = localStorage.getItem(createdKey(o.id));
        if (!clientId) {
          const { data } = await api.post('/clients', {
            name: (o.customerName || 'Cliente de la tienda').trim().slice(0, 120),
            phone: o.customerPhone || null, address: guess.address || null, locality: guess.locality || null,
          });
          clientId = String(data.id);
          try { localStorage.setItem(createdKey(o.id), clientId); } catch { /* sin espacio */ }
        }
      }
      const notes = [
        `Pedido por la tienda${code}`,
        o.delivery === 'PICKUP' ? 'Retira en el depósito' : '',
        o.customerNote ? `"${o.customerNote}"` : '',
        ...o.items.filter((it) => it.note).map((it) => `${it.name}: ${it.note}`),
      ].filter(Boolean).join('. ');
      const items = toPreOrderItems(o, byId).filter((it) => byId.has(it.productId));
      const { data } = await api.put(`/preorders/${o.id}`, { fromOnline: true, takenAt: new Date(msOf(o.createdAt)).toISOString(), clientId, items, notes });
      try { localStorage.removeItem(createdKey(o.id)); } catch { /* nada */ }
      // Ya está en Pedidos: que falle la marca en la nube no lo vuelve atrás (se reintenta)
      await markAccepted(storeId, o.id, String(data.id));
      refreshWholesaleClient(storeId, clientId).catch(() => {});
      const diff = Math.abs((Number(data.total) || 0) - (Number(o.total) || 0)) > 1;
      toast.success(`Pedido N° ${data.orderNumber} aceptado${diff ? `: quedó en ${money(data.total)} con tus precios de hoy (la tienda decía ${money(o.total)})` : ''}`, { duration: diff ? 9000 : 4000 });
      const wa = waNumber(o.customerPhone);
      if (notify && wa) {
        const text = `¡Hola ${who}! Recibimos tu pedido${code}${run ? ` y sale en el reparto ${run}` : ''}. ¡Gracias!`;
        window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank');
      }
      onDone();
    } catch (err: any) {
      await finishOrderReview(storeId, o.id, { failed: true }).catch(() => {});
      toast.error(err?.response?.data?.message || 'No se pudo aceptar el pedido. Revisá la conexión y probá de nuevo.', { duration: 7000 });
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!window.confirm(`¿Rechazar el pedido${code} de ${o.customerName}?${waNumber(o.customerPhone) ? ' Se abre WhatsApp para avisarle.' : ''}`)) return;
    setBusy('reject');
    try {
      const cloud = await lockOrderForReview(storeId, o.id);
      if (!cloud) { toast('Este pedido ya lo tomó otro equipo o se cargó en la caja.', { icon: 'ℹ️' }); return; }
      await finishOrderReview(storeId, o.id, { rejected: true });
      toast.success('Pedido rechazado');
      const wa = waNumber(o.customerPhone);
      if (wa) window.open(`https://wa.me/${wa}?text=${encodeURIComponent(`Hola ${who}, no vamos a poder tomar tu pedido${code}. Escribinos y lo vemos juntos.`)}`, '_blank');
    } catch {
      toast.error('No se pudo rechazar. Revisá la conexión.');
    } finally {
      setBusy(null);
    }
  };

  const options = search.trim()
    ? clients.filter((c) => norm(`${c.name} ${c.locality || ''} ${c.phone || ''}`).includes(norm(search))).slice(0, 8)
    : [];

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-slate-900 truncate">{o.customerName}</p>
          <p className="text-[12.5px] text-slate-500 truncate">
            {new Date(msOf(o.createdAt)).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
            {code ? ` ·${code}` : ''}
            {o.customerPhone ? ` · ${o.customerPhone}` : ''}
          </p>
        </div>
        <p className="text-[15.5px] font-bold text-slate-900 shrink-0">{money(o.total)}</p>
      </div>

      <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-slate-600">
        {o.delivery === 'PICKUP' ? <Store className="w-3.5 h-3.5 text-slate-400" /> : <Truck className="w-3.5 h-3.5 text-slate-400" />}
        <span className="truncate">{o.delivery === 'PICKUP' ? 'Retira en el depósito' : o.address || 'Reparto'}{run ? ` · reparto ${run}` : ''}</span>
      </p>

      <ul className="mt-2 rounded-xl bg-slate-50 divide-y divide-slate-100 text-[13px]">
        {o.items.map((it, k) => {
          const size = Number(it.packSize) > 1 ? Number(it.packSize) : 0;
          const gone = !byId.has(it.productId);
          return (
            <li key={k} className={`px-3 py-1.5 flex items-baseline gap-2 ${gone ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
              <span className="w-24 shrink-0 font-bold text-slate-800">{size ? `${qtyFmt(it.qty)} ${it.qty === 1 ? 'bulto' : 'bultos'}` : `${qtyFmt(it.qty)} u.`}</span>
              <span className="flex-1 min-w-0">{String(it.name).replace(/ · bulto x\d+$/, '')}{size ? <span className="text-slate-400"> · x{size}</span> : null}{it.note && <span className="block text-[12px] text-amber-700 italic">“{it.note}”</span>}</span>
              <span className="font-semibold shrink-0">{money(it.price * it.qty)}</span>
            </li>
          );
        })}
      </ul>
      {o.customerNote && <p className="mt-2 text-[13px] text-slate-600 italic">"{o.customerNote}"</p>}
      {short.length > 0 && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12.5px] text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
          <span>No alcanza lo libre: {short.map((s) => `${s.name} (pide ${qtyFmt(s.units)}, quedan ${qtyFmt(s.free)} sin comprometer)`).join('; ')}. Podés aceptarlo igual y ajustarlo en el pedido.</span>
        </p>
      )}
      {o.priceProblem && (
        <p className="mt-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-[12.5px] text-slate-700">Algún precio no coincidía con el publicado: al aceptarlo entra con tus precios.</p>
      )}

      {/* De quién es */}
      <div className="mt-2.5 text-[13px]">
        {!choosing ? (
          <p className="flex items-center gap-1.5 flex-wrap text-slate-700">
            {pick.kind === 'link' && <Link2 className="w-3.5 h-3.5 text-emerald-600" />}
            <span>
              {o.clientToken && linked === undefined ? 'Buscando el cliente…'
                : pick.kind === 'new' ? <>Se crea el cliente <b>{o.customerName}</b>{guess.locality ? ` (${guess.locality})` : ''}</>
                  : <>Para <b>{pick.client.name}</b>{pick.client.locality ? ` (${pick.client.locality})` : ''}{pick.kind === 'link' ? ' · con su link' : pick.kind === 'phone' ? ' · mismo teléfono' : ''}</>}
            </span>
            <button onClick={() => setChoosing(true)} className="font-bold text-rose-700 cursor-pointer">Cambiar</button>
          </p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente…"
                className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-slate-300 text-[13px] outline-none focus:border-slate-500" />
              <button onClick={() => { setChosen('new'); setChoosing(false); setSearch(''); }} className="h-9 px-3 rounded-lg border border-slate-300 text-[12.5px] font-bold text-slate-700 cursor-pointer">Cliente nuevo</button>
              <button onClick={() => { setChoosing(false); setSearch(''); }} className="h-9 w-9 rounded-lg text-slate-400 flex items-center justify-center cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4" /></button>
            </div>
            {options.map((c) => (
              <button key={c.id} onClick={() => { setChosen(c); setChoosing(false); setSearch(''); }} className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                <span className="font-semibold text-slate-800">{c.name}</span>
                <span className="text-slate-500">{[c.locality, c.phone].filter(Boolean).length ? ` · ${[c.locality, c.phone].filter(Boolean).join(' · ')}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button disabled={!!busy || (!!o.clientToken && linked === undefined)} onClick={accept}
          className="flex-1 min-w-[150px] h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-bold cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50">
          {busy === 'accept' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Aceptar
        </button>
        <button disabled={!!busy} onClick={reject} className="h-11 px-4 rounded-xl text-rose-700 text-[14px] font-bold cursor-pointer hover:bg-rose-50 disabled:opacity-50">
          {busy === 'reject' ? 'Rechazando…' : 'Rechazar'}
        </button>
        {waNumber(o.customerPhone) && (
          <label className="w-full flex items-center gap-2 text-[12.5px] text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-emerald-600" />
            <MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> Avisarle por WhatsApp que lo recibimos
          </label>
        )}
      </div>
    </div>
  );
}
