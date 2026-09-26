import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Store, ClipboardList, Package, Tag, Settings, ExternalLink, Share2, ChevronRight, AlertTriangle, Clock, CheckCircle2, Globe, CalendarDays } from 'lucide-react';
import api from '../../services/api';
import { useOnlineOrders, isNewOrder, startOnlineOrdersSync } from '../../services/onlineStoreOrders';
import { loadStoreConfig, type StoreConfig, type StoreOrder, type OrderStage } from '../../services/onlineStore';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';

const PUBLIC_BASE = 'https://tienda.ventra.store';

const STAGE: Record<OrderStage, { label: string; cls: string }> = {
  NEW: { label: 'Nuevo', cls: 'bg-rose-50 text-rose-700' },
  PREPARING: { label: 'Preparando', cls: 'bg-amber-50 text-amber-700' },
  READY: { label: 'Listo', cls: 'bg-sky-50 text-sky-700' },
  DELIVERED: { label: 'Entregado', cls: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500' },
};

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const isToday = (d: Date | null) => !!d && d.toDateString() === new Date().toDateString();
const hour = (d: Date | null) => (d ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Inicio del plan Ventra Tienda (sin sistema de ventas): cómo viene la tienda online hoy.
 * Pedidos en vivo (Firestore), lo vendido online, stock bajo y accesos a administrarla.
 */
export default function StoreHomeScreen() {
  const navigate = useNavigate();
  const mobile = useOwnerMobile().active;
  const { storeId, orders } = useOnlineOrders();
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [lowStock, setLowStock] = useState<number | null>(null);

  useEffect(() => { startOnlineOrdersSync(); }, []);
  useEffect(() => {
    if (!storeId) return;
    loadStoreConfig(storeId).then(setConfig).catch(() => {});
  }, [storeId]);
  useEffect(() => {
    api.get('/products/low-stock-ids').then(({ data }) => setLowStock((data || []).length)).catch(() => setLowStock(null));
  }, []);

  const stats = useMemo(() => {
    const today = orders.filter((o) => isToday(toDate(o.createdAt)) && o.stage !== 'CANCELLED');
    return {
      nuevos: orders.filter(isNewOrder).length,
      enCurso: orders.filter((o) => o.stage === 'PREPARING' || o.stage === 'READY').length,
      hoy: today.length,
      vendidoHoy: today.reduce((s, o) => s + (Number(o.total) || 0), 0),
    };
  }, [orders]);

  const publicUrl = config?.subdomain ? `${PUBLIC_BASE}/${config.subdomain}` : null;
  const share = async () => {
    if (!publicUrl) return;
    try {
      if ((navigator as any).share) await (navigator as any).share({ title: config?.businessName || 'Mi tienda', url: publicUrl });
      else { await navigator.clipboard.writeText(publicUrl); toast.success('Link copiado'); }
    } catch { /* cancelado */ }
  };
  const openStore = () => { if (publicUrl) window.open(publicUrl, '_blank', 'noopener'); };

  const title = config?.businessName || 'Mi tienda';
  const status = config ? (config.isPublished ? 'Publicada' : 'Sin publicar') : storeId ? 'Cargando…' : 'Todavía no la creaste';

  const body = (
    <div className={`${mobile ? 'px-4 py-4' : 'p-6 max-w-5xl w-full mx-auto'} space-y-5`}>
      {!storeId && (
        <button onClick={() => navigate('/online-store')} className="w-full text-left bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 active:scale-[0.99]">
          <span className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center shrink-0"><Store className="w-6 h-6 text-rose-600" /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-[16px] font-bold text-slate-900">Armá tu tienda online</span>
            <span className="block text-[13px] text-slate-500">Elegí el nombre, los colores y qué productos mostrar. En minutos está lista para compartir.</span>
          </span>
          <ChevronRight className="w-5 h-5 text-slate-400" />
        </button>
      )}

      {config && !config.isPublished && (
        <button onClick={() => navigate('/online-store')} className="w-full text-left bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0" />
          <span className="flex-1 text-[13.5px] text-amber-900">Tu tienda no está publicada: los clientes todavía no la ven. Tocá para publicarla.</span>
          <ChevronRight className="w-4 h-4 text-amber-700" />
        </button>
      )}

      <div className={`grid gap-3 ${mobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
        <Stat label="Pedidos nuevos" value={String(stats.nuevos)} tone={stats.nuevos ? 'text-rose-700' : 'text-slate-900'} icon={ClipboardList} onClick={() => navigate('/pedidos')} />
        <Stat label="En preparación" value={String(stats.enCurso)} icon={Clock} onClick={() => navigate('/pedidos')} />
        <Stat label="Vendido online hoy" value={money(stats.vendidoHoy)} icon={CheckCircle2} />
        <Stat label="Pedidos de hoy" value={String(stats.hoy)} icon={Globe} />
      </div>

      <section>
        <div className="flex items-center justify-between mb-2 px-1">
          <p className="text-[12.5px] font-semibold text-slate-500">Últimos pedidos</p>
          <button onClick={() => navigate('/pedidos')} className="text-[12.5px] font-semibold text-rose-700">Ver todos</button>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
          {orders.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13.5px] text-slate-400">{storeId ? 'Todavía no llegaron pedidos. Compartí el link de tu tienda para recibir los primeros.' : 'Cuando tengas tu tienda, los pedidos van a aparecer acá.'}</p>
          ) : orders.slice(0, 6).map((o: StoreOrder) => {
            const st = STAGE[(o.stage || 'NEW') as OrderStage];
            const d = toDate(o.createdAt);
            return (
              <button key={o.id} onClick={() => navigate('/pedidos')} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-medium text-slate-800 truncate">{o.customerName || 'Cliente'}{o.orderCode ? ` · #${o.orderCode}` : ''}</span>
                  <span className="block text-[12px] text-slate-500">{isToday(d) ? `Hoy ${hour(d)}` : d ? d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : ''} · {o.items?.length || 0} {o.items?.length === 1 ? 'producto' : 'productos'}</span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-[14px] font-semibold text-slate-900 tabular-nums">{money(o.total || 0)}</span>
                  <span className={`inline-block mt-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {lowStock !== null && lowStock > 0 && (
        <button onClick={() => navigate('/stock-control')} className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3 active:scale-[0.99]">
          <span className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0"><Package className="w-5 h-5 text-amber-700" /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold text-slate-900">{lowStock} {lowStock === 1 ? 'producto con stock bajo' : 'productos con stock bajo'}</span>
            <span className="block text-[12.5px] text-slate-500">Reponelos para no perder ventas en la tienda.</span>
          </span>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
      )}

      <section>
        <p className="text-[12.5px] font-semibold text-slate-500 mb-2 px-1">Administrar</p>
        <div className={`grid gap-3 ${mobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
          <Shortcut icon={Settings} label="Configurar tienda" hint="Nombre, colores, envíos" onClick={() => navigate('/online-store')} />
          <Shortcut icon={Package} label="Productos" hint="Precios, fotos y stock" onClick={() => navigate('/products')} />
          <Shortcut icon={Tag} label="Promociones" hint="Ofertas y combos" onClick={() => navigate('/promos')} />
          <Shortcut icon={ClipboardList} label="Pedidos" hint="Preparar y entregar" onClick={() => navigate('/pedidos')} />
          <Shortcut icon={CalendarDays} label="Agenda" hint="Turnos online" onClick={() => navigate('/agenda')} />
        </div>
      </section>
    </div>
  );

  const actions = publicUrl ? (
    <div className="flex gap-2">
      <button onClick={openStore} className={`h-10 px-4 rounded-xl text-[13.5px] font-semibold flex items-center gap-2 ${mobile ? 'bg-white/15 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
        <ExternalLink className="w-4 h-4" /> Ver tienda
      </button>
      <button onClick={share} className={`h-10 px-4 rounded-xl text-[13.5px] font-semibold flex items-center gap-2 ${mobile ? 'bg-white text-rose-700' : 'bg-rose-600 text-white'}`}>
        <Share2 className="w-4 h-4" /> Compartir
      </button>
    </div>
  ) : null;

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader title={title} subtitle={`Ventra Tienda · ${status}`}>{actions}</ScreenHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl w-full mx-auto px-6 pt-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.14em] text-rose-600">VENTRA TIENDA</p>
          <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">{title}</h1>
          <p className="text-[13px] text-slate-500">{status}{publicUrl ? ` · ${publicUrl}` : ''}</p>
        </div>
        {actions}
      </div>
      {body}
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = 'text-slate-900', onClick }: { label: string; value: string; icon: any; tone?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className="text-left bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <Icon className="w-4 h-4 text-slate-400" />
      <p className={`mt-2 text-[22px] font-bold tabular-nums tracking-tight ${tone}`}>{value}</p>
      <p className="text-[12px] text-slate-500">{label}</p>
    </Tag>
  );
}

function Shortcut({ icon: Icon, label, hint, onClick }: { icon: any; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left bg-white rounded-2xl border border-slate-200/80 p-4 active:scale-[0.99] hover:border-slate-300 transition-colors">
      <span className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center"><Icon className="w-[18px] h-[18px] text-rose-600" /></span>
      <span className="mt-2.5 block text-[14px] font-semibold text-slate-900">{label}</span>
      <span className="block text-[12px] text-slate-500">{hint}</span>
    </button>
  );
}
