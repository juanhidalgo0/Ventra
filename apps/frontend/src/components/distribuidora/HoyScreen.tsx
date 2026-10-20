import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, Truck, ShoppingCart, PackagePlus, Users, MapPin, ChevronRight, Loader2, Banknote, Landmark,
  Wallet, AlertTriangle, RefreshCw, CheckCircle2, BarChart3,
} from 'lucide-react';
import api from '../../services/api';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { readRouteDays, zonesFor } from '../../services/routeDays';
import { Navigate } from 'react-router-dom';
import { useWorkRole, WORK_PATH } from '../../services/workRole';
import { useAuthStore } from '../../stores/authStore';
import { useAutoTour } from '../common/tour/GuidedTour';
import { setTourScreen } from '../common/tour/tourContext';

/**
 * Inicio de la distribuidora: lo que hay que mirar al empezar el día y durante la jornada.
 * Tres bloques en el orden en que trabaja: pedidos para repartir (por zona), repartos (armando,
 * en la calle, rendidos) y la plata (lo cobrado hoy, lo que está en la calle y quién debe).
 */

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
const qty = (n: number) => (Math.round(n * 10) / 10).toLocaleString('es-AR', { maximumFractionDigits: 1 });
const plural = (n: number, one: string, many: string) => `${qty(n)} ${n === 1 ? one : many}`;
const dayLabel = (d: any) => {
  const date = new Date(d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(date); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 86400000);
  return diff === 0 ? 'Hoy' : diff === 1 ? 'Mañana' : diff === -1 ? 'Ayer' : date.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' });
};

function Card({ title, icon: Icon, action, tour, children }: { title: string; icon: any; action?: { label: string; onClick: () => void }; tour?: string; children: any }) {
  return (
    <section data-tour={tour} className="rounded-3xl bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col min-h-0">
      <div className="px-5 pt-4 pb-3 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center"><Icon className="w-4 h-4" /></span>
        <h2 className="flex-1 text-[16px] font-bold text-slate-900">{title}</h2>
        {action && <button onClick={action.onClick} className="text-[12.5px] font-bold text-rose-700 hover:underline cursor-pointer">{action.label}</button>}
      </div>
      <div className="px-5 pb-5 flex-1 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Empty({ text, cta }: { text: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-6 gap-3">
      <p className="text-[13.5px] text-slate-500 max-w-[240px]">{text}</p>
      {cta && <button onClick={cta.onClick} className="h-10 px-4 rounded-xl bg-slate-900 text-white text-[13px] font-bold cursor-pointer">{cta.label}</button>}
    </div>
  );
}

const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  ARMANDO: { label: 'Armando', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  EN_REPARTO: { label: 'En reparto', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  CERRADO: { label: 'Rendido', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

export default function HoyScreen() {
  const navigate = useNavigate();
  const inShell = useOwnerMobile().active;
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
      const storeName = (localStorage.getItem('gd_store_name') || '').trim();
  const todayZones = zonesFor(readRouteDays());
  // Vendedores y choferes van a lo suyo: la plata del día es del encargado
  const workRole = useWorkRole();
  const manager = useAuthStore((s) => s.user?.role === 'ADMIN' || s.user?.role === 'SUPERVISOR');
  // El recorrido completo de la distribuidora arranca acá la primera vez (en el celular del dueño, sin pasar por la PC)
  setTourScreen({ mobile: inShell });
  useAutoTour('distrib', !!data);

  const load = useCallback(() => {
    api.get('/delivery-runs/today', { silent: true } as any)
      .then(({ data }) => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60000);
    window.addEventListener('focus', load);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', load); };
  }, [load]);

  const actions = [
    { label: 'Nuevo pedido', icon: ClipboardList, to: '/preventa?nuevo=1', primary: true },
    { label: 'Armar reparto', icon: Truck, to: '/reparto?nuevo=1' },
    { label: inShell ? 'Mostrador' : 'Venta de mostrador', icon: ShoppingCart, to: '/pos' },
    { label: 'Cargar compra', icon: PackagePlus, to: '/purchases' },
    { label: 'Clientes', icon: Users, to: '/clients' },
    { label: 'Informes', icon: BarChart3, to: '/informes' },
  ];
  const todayRaw = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const today = todayRaw.charAt(0).toUpperCase() + todayRaw.slice(1);

  if (!manager) return <Navigate to={workRole ? WORK_PATH[workRole] : '/pos'} replace />;
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      {inShell && (
        // En el celular, como el inicio de la app: encabezado verde con la plata del día
        <header className="bg-rose-600 text-white px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-14 rounded-b-[28px]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] text-rose-100">{today}</p>
              <h1 className="text-[19px] font-bold tracking-tight truncate">{storeName || 'Hoy'}</h1>
            </div>
            <button onClick={() => { setLoading(true); load(); }} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-95 shrink-0" aria-label="Actualizar">
              <RefreshCw className={`w-[18px] h-[18px] ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="mt-4 text-[12px] text-rose-100">Cobrado hoy</p>
          <p className="text-[32px] leading-tight font-bold tracking-tight tabular-nums">{data ? money(data.money.collected) : '—'}</p>
          {todayZones.length > 0 && <p className="mt-1 text-[12.5px] text-orange-200 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Hoy se visita {todayZones.join(', ')}</p>}
        </header>
      )}
      <div className={`max-w-6xl mx-auto space-y-5 pb-16 ${inShell ? 'px-4 -mt-9 relative' : 'px-4 sm:px-6 py-6'}`}>
        {!inShell && <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-500">{today}</p>
                        <h1 className="text-[26px] font-bold text-slate-900 tracking-tight leading-tight truncate">{storeName ? `Hoy en ${storeName}` : 'Hoy'}</h1>
            {todayZones.length > 0 && <p className="text-[13px] text-slate-600 mt-0.5 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-rose-600" /> Hoy se visita {todayZones.join(', ')}</p>}
          </div>
          <button onClick={() => { setLoading(true); load(); }} className="shrink-0 w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center cursor-pointer hover:bg-slate-50" aria-label="Actualizar">
            <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>}

        <div data-tour="hoy-actions" className={inShell ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5'}>
          {actions.map((a) => inShell ? (
            <button key={a.label} onClick={() => navigate(a.to)}
              className={`h-[92px] rounded-2xl px-2 flex flex-col items-center justify-center gap-2 text-center cursor-pointer active:scale-[0.97] transition-transform shadow-sm ${a.primary ? 'bg-orange-200 text-orange-950' : 'bg-white border border-slate-200 text-slate-800'}`}>
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${a.primary ? 'bg-white/60' : 'bg-rose-50 text-rose-700'}`}><a.icon className="w-5 h-5" /></span>
              <span className="text-[12.5px] font-bold leading-tight">{a.label}</span>
            </button>
          ) : (
            <button key={a.label} onClick={() => navigate(a.to)}
              className={`h-[74px] rounded-2xl px-4 flex items-center gap-3 text-left cursor-pointer transition-all active:scale-[0.98] ${a.primary ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm col-span-2 sm:col-span-1' : 'bg-white border border-slate-200 hover:border-slate-300 text-slate-800'}`}>
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.primary ? 'bg-white/15' : 'bg-slate-100 text-slate-700'}`}><a.icon className="w-5 h-5" /></span>
              <span className="text-[14.5px] font-bold leading-tight">{a.label}</span>
            </button>
          ))}
        </div>

        {!data ? (
          <div className="py-20 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {/* 1. Pedidos para repartir */}
            <Card tour="hoy-pedidos" title="Pedidos para repartir" icon={ClipboardList}  action={{ label: 'Ver pedidos', onClick: () => navigate('/preventa') }}>
              {data.orders.pending === 0 ? (
                <Empty text="No hay pedidos esperando reparto." cta={{ label: 'Tomar un pedido', onClick: () => navigate('/preventa?nuevo=1') }} />
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[30px] font-bold text-slate-900 leading-none">{data.orders.pending}</span>
                    <span className="text-[13.5px] text-slate-500">{data.orders.pending === 1 ? 'pedido' : 'pedidos'} · {plural(data.orders.bultos, 'bulto', 'bultos')} · {money(data.orders.total)}</span>
                  </div>
                  {data.orders.newToday > 0 && <p className="text-[12.5px] font-semibold text-emerald-700 -mt-1">{plural(data.orders.newToday, 'pedido nuevo', 'pedidos nuevos')} hoy</p>}
                  <div className="rounded-2xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                    {data.orders.zones.map((z: any) => (
                      <div key={z.zone} className="px-3.5 py-3 flex items-center gap-3">
                        <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[14.5px] font-bold text-slate-900 truncate">{z.zone}</p>
                          <p className="text-[12px] text-slate-500">{plural(z.count, 'pedido', 'pedidos')} · {plural(z.bultos, 'bulto', 'bultos')} · {money(z.total)}</p>
                        </div>
                        <button onClick={() => navigate(`/reparto?nuevo=1&zona=${encodeURIComponent(z.zone)}`)} className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[12.5px] font-bold cursor-pointer flex items-center gap-1.5 shrink-0">
                          <Truck className="w-3.5 h-3.5" /> Armar
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            {/* 2. Repartos */}
            <Card tour="hoy-repartos" title="Repartos" icon={Truck}  action={{ label: 'Ver todos', onClick: () => navigate('/reparto') }}>
              {data.runs.length === 0 ? (
                <Empty text="No hay repartos armándose ni en camino." cta={data.orders.pending ? { label: 'Armar reparto', onClick: () => navigate('/reparto?nuevo=1') } : undefined} />
              ) : data.runs.map((r: any) => {
                const st = RUN_STATUS[r.status] || RUN_STATUS.ARMANDO;
                const pct = r.stops ? Math.round((r.registered / r.stops) * 100) : 0;
                const diff = r.cashReceived != null && r.expectedCash != null ? Math.round((r.cashReceived - r.expectedCash) * 100) / 100 : null;
                return (
                  <button key={r.id} onClick={() => navigate(`/reparto?run=${r.id}`)} className="text-left rounded-2xl border border-slate-200 hover:border-slate-300 px-4 py-3.5 cursor-pointer space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                      <span className="text-[13px] font-semibold text-slate-500">{dayLabel(r.date)} · N° {r.runNumber}</span>
                      <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
                    </div>
                    <p className="text-[15px] font-bold text-slate-900 leading-tight">{r.driverName || 'Sin chofer'} · {plural(r.stops, 'parada', 'paradas')} · {plural(r.bultos, 'bulto', 'bultos')}</p>
                    {r.zones?.length > 0 && <p className="text-[12px] text-slate-500 truncate">{r.zones.join(', ')}</p>}
                    {r.status === 'ARMANDO' && <p className="text-[12.5px] font-semibold text-amber-800">Listo para cargar · {money(r.total)}</p>}
                    {r.status === 'EN_REPARTO' && (
                      <>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-sky-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                        <p className="text-[12.5px] text-slate-600">{r.registered} de {r.stops} entregas registradas · cobró {money(r.cashSoFar + r.transferSoFar)} de {money(r.total)}</p>
                      </>
                    )}
                    {r.status === 'CERRADO' && (
                      <p className={`text-[12.5px] font-semibold flex items-center gap-1.5 ${diff == null || Math.abs(diff) < 0.01 ? 'text-emerald-700' : diff < 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {diff == null || Math.abs(diff) < 0.01 ? `Rindió ${money(r.expectedCash || 0)}, justo` : diff < 0 ? `Faltaron ${money(-diff)} en la rendición` : `Sobraron ${money(diff)} en la rendición`}
                      </p>
                    )}
                  </button>
                );
              })}
            </Card>

            {/* 3. Plata */}
            <Card tour="hoy-plata" title="La plata de hoy" icon={Wallet}>
              <div>
                <p className="text-[12.5px] font-semibold text-slate-500">Cobrado hoy</p>
                <p className="text-[30px] font-bold text-slate-900 leading-tight">{money(data.money.collected)}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[12.5px] text-slate-600">
                  <span className="flex items-center gap-1"><Banknote className="w-3.5 h-3.5" /> Efectivo {money(data.money.cash)}</span>
                  <span className="flex items-center gap-1"><Landmark className="w-3.5 h-3.5" /> Transferencias {money(data.money.transfer)}</span>
                  {data.money.other > 0 && <span>Otros {money(data.money.other)}</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-slate-50 px-3.5 py-3">
                  <p className="text-[11.5px] font-semibold text-slate-500">Vendido hoy</p>
                  <p className="text-[17px] font-bold text-slate-900">{money(data.money.sold)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-3.5 py-3" title="Lo vendido en los repartos que salieron y todavía no volvieron a rendir">
                  <p className="text-[11.5px] font-semibold text-slate-500">Por cobrar en reparto</p>
                  <p className="text-[17px] font-bold text-slate-900">{money(data.money.onStreet)}</p>
                  <p className="text-[10.5px] text-slate-500 leading-tight mt-0.5">En camiones que todavía no rindieron</p>
                </div>
              </div>
              <button onClick={() => navigate('/clients')} className="text-left rounded-2xl border border-slate-200 hover:border-slate-300 px-4 py-3 cursor-pointer">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-600">Te deben</span>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </div>
                <p className="text-[19px] font-bold text-slate-900">{money(data.money.owed)} <span className="text-[12.5px] font-medium text-slate-500">· {plural(data.money.debtorsCount, 'cliente', 'clientes')}</span></p>
                {data.money.topDebtors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {data.money.topDebtors.slice(0, 3).map((c: any) => (
                      <li key={c.id} className="flex justify-between text-[12.5px]"><span className="text-slate-700 truncate pr-2">{c.name}{c.locality ? ` · ${c.locality}` : ''}</span><span className="font-semibold text-slate-900">{money(c.balance)}</span></li>
                    ))}
                  </ul>
                )}
              </button>
              {data.money.overLimitCount > 0 && (
                <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3">
                  <p className="text-[13px] font-bold text-rose-800 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {plural(data.money.overLimitCount, 'cliente pasó', 'clientes pasaron')} su límite</p>
                  <ul className="mt-1.5 space-y-1">
                    {data.money.overLimit.map((c: any) => (
                      <li key={c.id} className="flex justify-between text-[12.5px] text-rose-900"><span className="truncate pr-2">{c.name}</span><span className="font-semibold">{money(c.balance)} / {money(c.creditLimit)}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
