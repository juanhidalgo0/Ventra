import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, Users, MapPin, Package, XCircle, UserX, Wallet, ShoppingBag, MessageCircle, Phone } from 'lucide-react';
import api from '../../services/api';
import { setStoreSetting } from '../../services/storeSettings';
import { useOwnerMobile } from '../../utils/ownerMobile';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const DAY = 86400000;

type Tab = 'sellers' | 'zones' | 'products' | 'reasons' | 'lost' | 'debt' | 'buy';
const TABS: [Tab, string, any][] = [
  ['sellers', 'Vendedores', Users],
  ['zones', 'Zonas', MapPin],
  ['products', 'Productos', Package],
  ['reasons', 'Rechazos', XCircle],
  ['lost', 'Dejaron de comprar', UserX],
  ['debt', 'Deuda por zona', Wallet],
  ['buy', 'Qué comprar', ShoppingBag],
];
const PERIODS: [string, string, () => { from: Date; to: Date }][] = [
  ['7', 'Últimos 7 días', () => ({ from: new Date(Date.now() - 7 * DAY), to: new Date() })],
  ['30', 'Últimos 30 días', () => ({ from: new Date(Date.now() - 30 * DAY), to: new Date() })],
  ['mes', 'Este mes', () => { const d = new Date(); return { from: new Date(d.getFullYear(), d.getMonth(), 1), to: new Date() }; }],
  ['ant', 'Mes pasado', () => { const d = new Date(); return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1), to: new Date(d.getFullYear(), d.getMonth(), 1) }; }],
];

/**
 * Informes de la distribuidora: cuánto vendió cada vendedor (y su comisión), cada zona y cada
 * producto, qué se rechazó y por qué, quién dejó de comprar, quién debe en cada zona y qué
 * hay que comprar para cubrir los pedidos. "Entregado" es lo que el cliente recibió.
 */
export default function DistribReportsScreen() {
  const navigate = useNavigate();
  const phone = useOwnerMobile();
  const [tab, setTab] = useState<Tab>('sellers');
  const [period, setPeriod] = useState('30');
  const [data, setData] = useState<any | null>(null);
  const [buy, setBuy] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [commission, setCommission] = useState(() => localStorage.getItem('seller_commission_pct') || '');

  const load = async () => {
    setLoading(true);
    const { from, to } = PERIODS.find((p) => p[0] === period)![2]();
    try {
      const [r, b] = await Promise.all([
        api.get('/preorders/report', { params: { from: from.toISOString(), to: to.toISOString() } }),
        api.get('/preorders/purchase-suggestion'),
      ]);
      setData(r.data);
      setBuy(b.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [period]);

  const pctNum = Math.max(0, Math.min(100, Number(String(commission).replace(',', '.')) || 0));
  const saveCommission = (v: string) => {
    setCommission(v);
    setStoreSetting('seller_commission_pct', v);
  };

  const card = 'rounded-2xl bg-white border border-slate-200';
  const th = 'px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap';
  const td = 'px-3 py-2.5 text-[14px] text-slate-800 whitespace-nowrap';
  const num = 'text-right tabular-nums';

  const body = useMemo(() => {
    if (!data) return null;
    if (tab === 'sellers') {
      return (
        <div className="space-y-3">
          <div className={`${card} p-4 flex flex-wrap items-center gap-3`}>
            <label htmlFor="comision" className="text-[14px] font-semibold text-slate-800">Comisión de los vendedores</label>
            <div className="flex items-center gap-1.5">
              <input id="comision" inputMode="decimal" value={commission} onChange={(e) => saveCommission(e.target.value)} placeholder="0"
                className="w-20 h-10 px-3 rounded-xl border border-slate-300 text-[15px] text-right outline-none focus:border-rose-500" />
              <span className="text-[14px] text-slate-600">% de lo entregado</span>
            </div>
          </div>
          <Table head={['Vendedor', 'Pedidos', 'Clientes', 'Pedido', 'Entregado', 'Rechazado', 'Sin entregar', ...(pctNum ? ['Comisión'] : [])]} th={th} card={card}>
            {data.sellers.map((s: any) => (
              <tr key={s.userId} className="border-t border-slate-100">
                <td className={`${td} font-semibold`}>{s.name}</td>
                <td className={`${td} ${num}`}>{s.orders}</td>
                <td className={`${td} ${num}`}>{s.clients}</td>
                <td className={`${td} ${num}`}>{money(s.ordered)}</td>
                <td className={`${td} ${num} font-semibold`}>{money(s.delivered)}</td>
                <td className={`${td} ${num} ${s.rejected > 0 ? 'text-rose-700' : ''}`}>{money(s.rejected)} <span className="text-[12px] text-slate-500">{pct(s.rejected, s.ordered - s.pending)}</span></td>
                <td className={`${td} ${num} text-slate-500`}>{money(s.pending)}</td>
                {pctNum ? <td className={`${td} ${num} font-bold text-emerald-700`}>{money(s.delivered * pctNum / 100)}</td> : null}
              </tr>
            ))}
          </Table>
          <p className="text-[12.5px] text-slate-500">La comisión se calcula sobre lo entregado: lo rechazado y lo que todavía no salió no cuentan.</p>
        </div>
      );
    }
    if (tab === 'zones') {
      return (
        <Table head={['Localidad', 'Pedidos', 'Clientes', 'Pedido', 'Entregado', 'Rechazado']} th={th} card={card}>
          {data.zones.map((z: any) => (
            <tr key={z.zone} className="border-t border-slate-100">
              <td className={`${td} font-semibold`}>{z.zone}</td>
              <td className={`${td} ${num}`}>{z.orders}</td>
              <td className={`${td} ${num}`}>{z.clients}</td>
              <td className={`${td} ${num}`}>{money(z.ordered)}</td>
              <td className={`${td} ${num} font-semibold`}>{money(z.delivered)}</td>
              <td className={`${td} ${num} ${z.rejected > 0 ? 'text-rose-700' : ''}`}>{money(z.rejected)}</td>
            </tr>
          ))}
        </Table>
      );
    }
    if (tab === 'products') {
      return (
        <Table head={['Producto', 'Bultos', 'Unidades', 'Plata']} th={th} card={card}>
          {data.products.map((p: any) => (
            <tr key={p.productId} className="border-t border-slate-100">
              <td className={`${td} font-semibold whitespace-normal min-w-[180px]`}>{p.name}</td>
              <td className={`${td} ${num}`}>{p.bultos ? qty(p.bultos) : '—'}</td>
              <td className={`${td} ${num}`}>{qty(p.units)}</td>
              <td className={`${td} ${num} font-semibold`}>{money(p.amount)}</td>
            </tr>
          ))}
        </Table>
      );
    }
    if (tab === 'reasons') {
      if (!data.reasons.length) return <Empty text="No hubo rechazos en este período." />;
      return (
        <Table head={['Motivo', 'Veces', 'Plata que volvió']} th={th} card={card}>
          {data.reasons.map((r: any) => (
            <tr key={r.reason} className="border-t border-slate-100">
              <td className={`${td} font-semibold whitespace-normal`}>{r.reason}</td>
              <td className={`${td} ${num}`}>{r.count}</td>
              <td className={`${td} ${num}`}>{money(r.amount)}</td>
            </tr>
          ))}
        </Table>
      );
    }
    if (tab === 'lost') {
      if (!data.lostClients.length) return <Empty text="Todos los clientes que venían comprando pidieron en las últimas 3 semanas." />;
      return (
        <div className="space-y-2">
          <p className="text-[13px] text-slate-600">Venían comprando y hace más de 3 semanas que no piden. Ordenados por lo que suelen comprar.</p>
          <div className={`${card} divide-y divide-slate-100`}>
            {data.lostClients.map((c: any) => (
              <div key={c.clientId} className="px-4 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-slate-900 truncate">{c.name}</p>
                  <p className="text-[12.5px] text-slate-500">{c.locality || 'Sin localidad'} · último pedido hace {c.days} días · suele pedir {money(c.average)}</p>
                </div>
                {c.phone && (
                  <>
                    <a href={`tel:${c.phone}`} className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center shrink-0" aria-label={`Llamar a ${c.name}`}><Phone className="w-4 h-4 text-slate-600" /></a>
                    <a href={`https://wa.me/${String(c.phone).replace(/\D/g, '').replace(/^0?/, '549')}`} target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center shrink-0" aria-label={`WhatsApp a ${c.name}`}><MessageCircle className="w-4 h-4 text-emerald-600" /></a>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (tab === 'debt') {
      if (!data.debtByZone.length) return <Empty text="Nadie debe nada." />;
      return (
        <div className="space-y-3">
          {data.debtByZone.map((z: any) => (
            <div key={z.zone} className={card}>
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
                <p className="text-[15px] font-bold text-slate-900">{z.zone}</p>
                <p className="text-[15px] font-bold text-rose-700 tabular-nums">{money(z.total)}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {z.clients.map((c: any) => (
                  <div key={c.id} className="px-4 py-2.5 flex items-center justify-between text-[14px]">
                    <span className="text-slate-800 truncate">{c.name}{c.overLimit && <span className="ml-2 text-[11.5px] font-bold text-rose-700">pasó su límite</span>}</span>
                    <span className="tabular-nums text-slate-700 shrink-0">{money(c.balance)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    // Qué comprar
    if (!buy?.length) return <Empty text="Con el stock que hay alcanza para los pedidos pendientes y el stock mínimo." />;
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">Lo que falta para cubrir los pedidos que todavía no salieron y dejar el stock mínimo de cada producto, en bultos enteros.</p>
        {buy.map((s: any) => (
          <div key={s.supplierId || 'sin'} className={card}>
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
              <p className="text-[15px] font-bold text-slate-900">{s.supplier}</p>
              {s.cost > 0 && <p className="text-[13px] text-slate-600 tabular-nums">aprox. {money(s.cost)}</p>}
            </div>
            <div className="divide-y divide-slate-100">
              {s.items.map((it: any) => (
                <div key={it.productId} className="px-4 py-2.5 flex items-center gap-3 text-[14px]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-800 truncate">{it.name}</span>
                    <span className="block text-[12px] text-slate-500">Hay {qty(it.stock)} · pedidos {qty(it.committed)}{it.minStock ? ` · mínimo ${qty(it.minStock)}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-right font-bold text-slate-900 tabular-nums">{it.bultos ? `${qty(it.bultos)} bulto(s)` : `${qty(it.units)} u.`}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }, [data, buy, tab, commission]);

  return (
    <div className={`h-full overflow-y-auto bg-slate-50 ${phone ? '' : 'p-6'}`}>
      <div className={`max-w-5xl mx-auto space-y-4 ${phone ? 'px-4 pt-4 pb-24' : ''}`}>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer shrink-0" aria-label="Volver"><ArrowLeft className="w-5 h-5 text-slate-700" /></button>
          <h1 className="flex-1 text-[22px] font-bold text-slate-900">Informes</h1>
          <button onClick={load} className="w-10 h-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center cursor-pointer" aria-label="Actualizar"><RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
          {PERIODS.map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)} className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold border cursor-pointer ${period === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
          ))}
        </div>

        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Pedidos" value={String(data.totals.orders)} />
            <Stat label="Pedido" value={money(data.totals.ordered)} />
            <Stat label="Entregado" value={money(data.totals.delivered)} />
            <Stat label="Rechazado" value={money(data.totals.rejected)} tone={data.totals.rejected > 0 ? 'text-rose-700' : ''} />
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
          {TABS.map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={`shrink-0 h-10 px-3.5 rounded-xl text-[13.5px] font-semibold border cursor-pointer flex items-center gap-1.5 ${tab === k ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200'}`}>
              <Icon className="w-4 h-4" /> {l}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : !data ? (
          <Empty text="No se pudieron traer los informes. Revisá la conexión y tocá actualizar." />
        ) : body}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-[19px] font-bold text-slate-900 tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function Table({ head, th, card, children }: { head: string[]; th: string; card: string; children: any }) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full">
        <thead><tr>{head.map((h, i) => <th key={h} className={`${th} ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl bg-white border border-slate-200 px-4 py-10 text-center text-[14px] text-slate-600">{text}</div>;
}
