import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ShoppingBag, Clock, ChefHat, PackageCheck, CheckCircle2, XCircle, MessageCircle, Phone, MapPin,
  Truck, Store as StoreIcon, CreditCard, ShoppingCart, X, Globe,
} from 'lucide-react';
import { useOnlineOrders, isNewOrder } from '../../services/onlineStoreOrders';
import { updateOrderStage, type OrderStage, type StoreOrder } from '../../services/onlineStore';
import { usePOSStore } from '../../stores/posStore';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { usePlanStore } from '../../stores/planStore';
import { ScreenHeader, Chips } from '../mobile/ui';

type Tab = 'ACTIVE' | 'NEW' | 'PREPARING' | 'READY' | 'DONE';

const STAGES: Record<OrderStage, { label: string; cls: string; icon: any }> = {
  NEW: { label: 'Nuevo', cls: 'bg-rose-600 text-white', icon: Clock },
  PREPARING: { label: 'Preparando', cls: 'bg-amber-100 text-amber-800', icon: ChefHat },
  READY: { label: 'Listo', cls: 'bg-sky-100 text-sky-800', icon: PackageCheck },
  DELIVERED: { label: 'Entregado', cls: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500', icon: XCircle },
};

const stageOf = (o: StoreOrder): OrderStage => o.stage || 'NEW';
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const when = (o: StoreOrder) => {
  const d: Date | null = o.createdAt?.toDate ? o.createdAt.toDate() : null;
  if (!d) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};
const deliveryText = (o: StoreOrder) =>
  o.delivery === 'DELIVERY' ? 'Envío a domicilio' : o.delivery === 'GODELIVERY' ? 'Envío con GoDelivery' : 'Retira en el local';

const waLink = (phone: string, text: string) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = `549${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

/** Mensaje para avisarle al cliente según el estado */
function customerMessage(o: StoreOrder, stage: OrderStage) {
  const store = localStorage.getItem('gd_store_name') || 'nuestro local';
  const name = (o.customerName || '').split(' ')[0];
  const code = o.orderCode ? ` #${o.orderCode}` : '';
  if (stage === 'PREPARING') return `¡Hola ${name}! Recibimos tu pedido${code} en ${store} y ya lo estamos preparando.`;
  if (stage === 'READY') {
    if (o.delivery === 'PICKUP' || !o.delivery) return `¡Hola ${name}! Tu pedido${code} ya está listo para retirar en ${store}.`;
    if (o.delivery === 'GODELIVERY') return `¡Hola ${name}! Tu pedido${code} ya está listo. Sale con GoDelivery hacia ${o.address || 'tu dirección'}.`;
    return `¡Hola ${name}! Tu pedido${code} ya salió hacia ${o.address || 'tu dirección'}.`;
  }
  if (stage === 'DELIVERED') return `¡Gracias por tu compra, ${name}! Cualquier cosa, escribinos.`;
  if (stage === 'CANCELLED') return `Hola ${name}, lamentablemente no podemos preparar tu pedido${code}. Escribinos si querés que lo veamos juntos.`;
  return `¡Hola ${name}! Te escribimos de ${store} por tu pedido${code}.`;
}

/**
 * modal: se abre desde el botón "Pedidos" de la caja (cajeros y admin) sin salir del POS.
 * Sin modal es la página de administración (barra lateral / celular), solo para el admin.
 */
export default function OnlineOrdersScreen({ modal = false, onClose }: { modal?: boolean; onClose?: () => void } = {}) {
  const { orders, storeId, ready } = useOnlineOrders();
  const mobile = useOwnerMobile().active && !modal;
  const [tab, setTab] = useState<Tab>('ACTIVE');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = orders.find((o) => o.id === selectedId) || null;

  const counts = useMemo(() => {
    const c: Record<string, number> = { NEW: 0, PREPARING: 0, READY: 0, DONE: 0 };
    for (const o of orders) {
      const s = stageOf(o);
      if (s === 'DELIVERED' || s === 'CANCELLED') c.DONE++;
      else c[s]++;
    }
    return c;
  }, [orders]);

  const list = orders.filter((o) => {
    const s = stageOf(o);
    if (tab === 'ACTIVE') return s !== 'DELIVERED' && s !== 'CANCELLED';
    if (tab === 'DONE') return s === 'DELIVERED' || s === 'CANCELLED';
    return s === tab;
  });

  const tabs = [
    { id: 'ACTIVE' as Tab, label: 'En curso', count: counts.NEW + counts.PREPARING + counts.READY },
    { id: 'NEW' as Tab, label: 'Nuevos', count: counts.NEW },
    { id: 'PREPARING' as Tab, label: 'Preparando', count: counts.PREPARING },
    { id: 'READY' as Tab, label: 'Listos', count: counts.READY },
    { id: 'DONE' as Tab, label: 'Terminados', count: counts.DONE },
  ];

  const body = !storeId && ready === false ? (
    <Empty
      icon={Globe}
      title="Todavía no hay tienda online"
      text="Cuando el comercio publique su tienda, los pedidos de los clientes van a aparecer acá."
    />
  ) : list.length === 0 ? (
    <Empty icon={ShoppingBag} title={tab === 'DONE' ? 'No hay pedidos terminados' : 'No hay pedidos en curso'} text="Los pedidos que hagan tus clientes desde la tienda online aparecen acá al instante." />
  ) : (
    <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
      {list.map((o) => <OrderCard key={o.id} order={o} onClick={() => setSelectedId(o.id)} />)}
    </div>
  );

  const content = (
    <div className="h-full flex-1 min-h-0 flex flex-col bg-slate-50">
      {mobile ? (
        <ScreenHeader back title="Pedidos online" subtitle={counts.NEW ? `${counts.NEW} ${counts.NEW === 1 ? 'nuevo' : 'nuevos'}` : 'Tienda online'}>
          <Chips<Tab> options={tabs} value={tab} onChange={setTab} />
        </ScreenHeader>
      ) : (
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-rose-600 text-white flex items-center justify-center"><ShoppingBag className="w-5 h-5" /></div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">Pedidos online</h1>
              <p className="text-[13px] text-slate-500">Lo que piden tus clientes desde la tienda. Actualizá el estado y avisales por WhatsApp.</p>
            </div>
            {modal && (
              <button onClick={onClose} className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0 cursor-pointer" aria-label="Cerrar">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            )}
          </div>
          <div className="flex gap-2 mt-4 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold border transition-colors cursor-pointer ${tab === t.id ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {t.label}{t.count ? <span className={`ml-1.5 ${tab === t.id ? 'text-rose-100' : 'text-slate-400'}`}>{t.count}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-y-auto ${mobile ? 'px-4 py-4' : 'px-5 pb-6'}`}>{body}</div>
      {selected && storeId && <OrderDetail order={selected} storeId={storeId} onClose={() => setSelectedId(null)} onCharged={onClose} />}
    </div>
  );

  if (!modal) return content;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 keep-style">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative w-full max-w-5xl h-[85vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col">{content}</div>
    </div>
  );
}

function Empty({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-16">
      <span className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center"><Icon className="w-6 h-6 text-rose-600" /></span>
      <p className="mt-4 text-[15px] font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-[13px] text-slate-500 max-w-sm">{text}</p>
    </div>
  );
}

function StageBadge({ stage }: { stage: OrderStage }) {
  const s = STAGES[stage];
  const Icon = s.icon;
  return <span className={`inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-full ${s.cls}`}><Icon className="w-3.5 h-3.5" />{s.label}</span>;
}

function OrderCard({ order: o, onClick }: { order: StoreOrder; onClick: () => void }) {
  const stage = stageOf(o);
  const DeliveryIcon = o.delivery === 'PICKUP' || !o.delivery ? StoreIcon : Truck;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-2xl border p-4 transition-all active:scale-[0.99] cursor-pointer hover:shadow-md ${isNewOrder(o) ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-200/80'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-slate-900 truncate">{o.customerName}</p>
          <p className="text-[12px] text-slate-500">{when(o)}{o.orderCode ? ` · #${o.orderCode}` : ''}</p>
        </div>
        <StageBadge stage={stage} />
      </div>
      <p className="mt-2 text-[13px] text-slate-600 line-clamp-2">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12.5px] text-slate-500"><DeliveryIcon className="w-4 h-4" />{deliveryText(o)}</span>
        <span className="text-[16px] font-bold text-slate-900 tabular-nums">{money(o.total)}</span>
      </div>
    </button>
  );
}

function OrderDetail({ order: o, storeId, onClose, onCharged }: { order: StoreOrder; storeId: string; onClose: () => void; onCharged?: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<OrderStage | null>(null);
  const stage = stageOf(o);
  const subtotal = o.items.reduce((s, i) => s + i.price * i.qty, 0);

  const setStage = async (next: OrderStage, notify = false) => {
    setBusy(next);
    try {
      await updateOrderStage(storeId, o.id, next);
      toast.success(`Pedido ${STAGES[next].label.toLowerCase()}`);
      if (notify && o.customerPhone) window.open(waLink(o.customerPhone, customerMessage(o, next)), '_blank');
    } catch {
      toast.error('No se pudo actualizar el pedido. Revisá la conexión.');
    } finally {
      setBusy(null);
    }
  };

  /** Carga el pedido en la caja para cobrarlo como una venta normal (ahí se descuenta el stock). */
  const chargeInPos = async () => {
    const { products, addToCart, clearCart, cart } = usePOSStore.getState();
    if (cart.length && !window.confirm('La caja tiene productos cargados. ¿Reemplazarlos por este pedido?')) return;
    clearCart();
    const missing: string[] = [];
    for (const it of o.items) {
      const p = products.find((x: any) => x.id === it.productId);
      if (!p) { missing.push(it.name); continue; }
      // Se respeta el precio que vio el cliente en la tienda
      addToCart(p, Number(p.salePrice) === it.price ? undefined : it.price, it.qty);
    }
    if (missing.length) toast.error(`No encontramos en el catálogo: ${missing.join(', ')}. Cargalos a mano.`, { duration: 7000 });
    if (stage === 'NEW') await updateOrderStage(storeId, o.id, 'PREPARING').catch(() => {});
    toast.success('Pedido cargado en la caja: cobralo como una venta.');
    onClose();
    if (onCharged) onCharged(); // desde el modal de la caja: se cierra y queda el carrito listo
    else navigate('/pos');
  };

  // Con el plan Tienda no hay caja: el pedido se gestiona solo por etapas
  const hasCaja = usePlanStore((s) => s.features.caja);

  const next: { stage: OrderStage; label: string } | null =
    stage === 'NEW' ? { stage: 'PREPARING', label: 'Empezar a preparar' }
      : stage === 'PREPARING' ? { stage: 'READY', label: o.delivery && o.delivery !== 'PICKUP' ? 'Marcar como enviado' : 'Marcar listo para retirar' }
        : stage === 'READY' ? { stage: 'DELIVERED', label: 'Marcar entregado' }
          : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center keep-animated mobile-app">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full md:max-w-lg max-h-[92dvh] bg-white rounded-t-[26px] md:rounded-3xl shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-[18px] font-bold text-slate-900 truncate">{o.customerName}</p>
            <p className="text-[12.5px] text-slate-500">{when(o)}{o.orderCode ? ` · Pedido #${o.orderCode}` : ''}</p>
            <div className="mt-2"><StageBadge stage={stage} /></div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-2 text-[13.5px]">
            {o.customerPhone && <p className="flex items-center gap-2 text-slate-700"><Phone className="w-4 h-4 text-slate-400" />{o.customerPhone}</p>}
            <p className="flex items-center gap-2 text-slate-700">{o.delivery === 'PICKUP' || !o.delivery ? <StoreIcon className="w-4 h-4 text-slate-400" /> : <Truck className="w-4 h-4 text-slate-400" />}{deliveryText(o)}</p>
            {o.address && <p className="flex items-start gap-2 text-slate-700"><MapPin className="w-4 h-4 text-slate-400 mt-0.5" />{o.address}</p>}
            {o.paymentMethod && <p className="flex items-center gap-2 text-slate-700"><CreditCard className="w-4 h-4 text-slate-400" />Paga con {o.paymentMethod}</p>}
            {o.customerNote && <p className="text-slate-600 italic">"{o.customerNote}"</p>}
            {o.delivery === 'GODELIVERY' && <p className="text-[12.5px] text-amber-700">El envío lo cobra GoDelivery aparte: no está incluido en el total.</p>}
          </div>

          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {o.items.map((i, k) => (
              <div key={k} className="flex justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                <span className="text-slate-800">{i.qty} × {i.name}</span>
                <span className="font-medium text-slate-800 tabular-nums shrink-0">{money(i.price * i.qty)}</span>
              </div>
            ))}
            {!!o.deliveryCost && (
              <div className="flex justify-between px-4 py-2.5 text-[13.5px] text-slate-600"><span>Envío</span><span className="tabular-nums">{money(o.deliveryCost)}</span></div>
            )}
            <div className="flex justify-between px-4 py-3 text-[15px] font-bold text-slate-900"><span>Total</span><span className="tabular-nums">{money(o.total || subtotal)}</span></div>
          </div>

          {o.customerPhone && (
            <a href={waLink(o.customerPhone, customerMessage(o, stage))} target="_blank" rel="noopener noreferrer" className="w-full h-11 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold text-[14px] flex items-center justify-center gap-2">
              <MessageCircle className="w-4 h-4" /> Escribirle por WhatsApp
            </a>
          )}
        </div>

        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] border-t border-slate-100 space-y-2">
          {hasCaja && stage !== 'DELIVERED' && stage !== 'CANCELLED' && (
            <button onClick={chargeInPos} className="w-full h-12 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[15px] flex items-center justify-center gap-2 cursor-pointer">
              <ShoppingCart className="w-4 h-4" /> Cobrar en la caja
            </button>
          )}
          {next && (
            <div className="flex gap-2">
              <button disabled={!!busy} onClick={() => setStage(next.stage, true)} className="flex-1 h-11 rounded-xl bg-slate-900 text-white font-semibold text-[13.5px] disabled:opacity-50 cursor-pointer">
                {next.label} y avisar
              </button>
              <button disabled={!!busy} onClick={() => setStage(next.stage)} className="h-11 px-4 rounded-xl border border-slate-200 text-slate-700 font-semibold text-[13.5px] disabled:opacity-50 cursor-pointer" title="Sin avisar al cliente">
                Solo marcar
              </button>
            </div>
          )}
          {stage !== 'CANCELLED' && stage !== 'DELIVERED' && (
            <button disabled={!!busy} onClick={() => { if (window.confirm('¿Cancelar este pedido?')) setStage('CANCELLED', true); }} className="w-full h-10 text-[13px] font-semibold text-red-600 cursor-pointer">
              Cancelar pedido
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
