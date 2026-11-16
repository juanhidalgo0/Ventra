import { useEffect, useMemo, useState } from 'react';
import CashSourcePicker, { CashSource } from '../common/CashSourcePicker';
import toast from 'react-hot-toast';
import { Beef, Loader2, Plus, Wand2, PackagePlus, Info } from 'lucide-react';
import api from '../../services/api';
import { money, parseAmount } from '../mobile/ui';
import { setStoreSetting } from '../../services/storeSettings';
import { useBusinessStore } from '../../stores/businessStore';
import CutsLoader from './CutsLoader';
import { loadCatalog, mergeIntoPosCatalog } from './cuts';

/**
 * Desposte: entra una media res (o un cuarto, un medio cerdo, un cajón de pollo) con lo que se
 * pagó, y se anota cuántos kilos salieron de cada corte. Con eso:
 * - se reparte lo que se pagó entre los cortes según lo que vale cada uno vendido (el lomo carga
 *   más costo por kilo que el osobuco) y sale el costo real por kilo de cada corte. Con ese reparto
 *   todos los cortes dejan el mismo % de ganancia (el de la media res entera, que se ve en el
 *   resumen), así los reportes de ganancia salen parejos en vez de mostrar el osobuco a pérdida;
 * - se ve el rendimiento (kilos de cortes sobre kilos que entraron) y la merma (hueso, grasa);
 * - al guardar entra como una compra al proveedor: suma el stock de cada corte, deja su costo
 *   nuevo (el precio de venta no se toca) y, si quedó a cuenta, la deuda con el frigorífico.
 * Lo que rindió cada corte queda guardado (desposte_template) para estimar el próximo.
 */

const WHAT = ['Media res', 'Cuarto delantero', 'Cuarto trasero', 'Medio cerdo', 'Cajón de pollo', 'Otro'];
const TEMPLATE_KEY = 'ventra_desposte_template';

interface Template { what?: string; pct: Record<string, number> }
const readTemplate = (): Template | null => {
  try {
    const t = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || 'null');
    return t && typeof t.pct === 'object' ? t : null;
  } catch { return null; }
};

/** Kilos escritos a mano: "1,5", "1.5" o "110" */
const parseKg = (v: string) => {
  const n = parseFloat(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmtKg = (n: number) => `${(Math.round(n * 1000) / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 })} kg`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('es-AR')} %`;

export default function DesposteScreen() {
  const rubros = useBusinessStore((s) => s.profiles);
  const [products, setProducts] = useState<any[] | null>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [newSupplier, setNewSupplier] = useState<string | null>(null);
  const [what, setWhat] = useState(() => readTemplate()?.what || 'Media res');
  const [kgIn, setKgIn] = useState('');
  const [pricePerKg, setPricePerKg] = useState('');
  const [invoice, setInvoice] = useState('');
  /** Cómo se pagó: como en Compras (Efectivo, Transferencia) o a cuenta del proveedor */
  const [pay, setPay] = useState<'Efectivo' | 'Transferencia' | 'A cuenta'>('Efectivo');
  const owed = pay === 'A cuenta';
  const [cashSource, setCashSource] = useState<CashSource | null>(null);
  const [kgOut, setKgOut] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showLoader, setShowLoader] = useState(false);
  const template = useMemo(readTemplate, [saving]);

  const load = () => {
    loadCatalog().then(setProducts).catch(() => setProducts([]));
  };
  useEffect(() => {
    load();
    api.get('/suppliers', { silent: true } as any).then(({ data }) => {
      const list = (Array.isArray(data) ? data : data?.suppliers || []).filter((s: any) => s.isActive !== false);
      setSuppliers(list);
      // El frigorífico de siempre: el de la última compra con nombre de frigorífico, o el único
      const frig = list.find((s: any) => /frigor|matarife|carne|faena/i.test(s.name || ''));
      setSupplierId((cur) => cur || frig?.id || (list.length === 1 ? list[0].id : ''));
    }).catch(() => {});
  }, []);

  // Cortes: lo que se vende por kilo, por categoría; los del último desposte primero
  const cuts = useMemo(() => {
    const list = (products || []).filter((p) => p.unit === 'KG' && p.isActive !== false);
    const inTpl = (p: any) => (template?.pct[p.id] ? 0 : 1);
    return list.sort((a, b) => inTpl(a) - inTpl(b) || (a.category?.name || '').localeCompare(b.category?.name || '') || a.name.localeCompare(b.name));
  }, [products, template]);

  const inKg = parseKg(kgIn);
  const totalCost = inKg * parseAmount(pricePerKg);

  const calc = useMemo(() => {
    const rows = cuts.map((p) => {
      const kg = parseKg(kgOut[p.id] || '');
      const price = Number(p.salePrice) || 0;
      return { p, kg, price, value: kg * price };
    }).filter((r) => r.kg > 0);
    const outKg = rows.reduce((s, r) => s + r.kg, 0);
    const value = rows.reduce((s, r) => s + r.value, 0);
    // Lo pagado se reparte por lo que vale cada corte; si ninguno tiene precio, por kilo
    const byValue = value > 0;
    const withCost = rows.map((r) => {
      const share = byValue ? r.value / value : r.kg / outKg;
      const cost = totalCost * share;
      const costKg = r.kg > 0 ? cost / r.kg : 0;
      return { ...r, cost, costKg };
    });
    return {
      rows: withCost, outKg, value, byValue,
      byId: new Map(withCost.map((r) => [r.p.id, r])),
      yieldPct: inKg > 0 ? (outKg / inKg) * 100 : 0,
      waste: Math.max(0, inKg - outKg),
      noPrice: rows.filter((r) => !(r.price > 0)).length,
    };
  }, [cuts, kgOut, totalCost, inKg]);

  const gain = calc.value - totalCost;

  const estimate = () => {
    if (!template || !inKg) return;
    const next: Record<string, string> = {};
    for (const p of cuts) {
      const share = template.pct[p.id];
      if (share > 0) next[p.id] = String(Math.round(inKg * share * 10) / 10).replace('.', ',');
    }
    setKgOut(next);
    toast.success('Kilos estimados con el último desposte: corregí los que salieron distinto');
  };

  const addSupplier = async () => {
    const name = (newSupplier || '').trim();
    if (name.length < 2) return;
    try {
      const { data } = await api.post('/suppliers', { name });
      setSuppliers((s) => [...s, data]);
      setSupplierId(data.id);
      setNewSupplier(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo crear el proveedor');
    }
  };

  const canSave = !!supplierId && inKg > 0 && totalCost > 0 && calc.rows.length > 0 && calc.outKg <= inKg * 1.02;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const since = new Date(Date.now() - 2000).toISOString();
    try {
      await api.post('/purchases', {
        supplierId,
        invoiceNumber: invoice.trim() || undefined,
        paymentStatus: owed ? 'OWED' : 'PAID',
        paymentMethod: owed ? null : pay,
        cashSource: pay === 'Efectivo' ? cashSource : null,
        manualTotal: Math.round(totalCost * 100) / 100,
        notes: `Desposte: ${what} de ${fmtKg(inKg)} a ${money(parseAmount(pricePerKg))} el kilo · rindió ${pct(calc.yieldPct)} (${fmtKg(calc.outKg)} de cortes, ${fmtKg(calc.waste)} de hueso y grasa)`,
        // La compra guarda el costo con IVA (lo multiplica por 1,21): se manda sin IVA para que quede el costo real.
        // El precio de venta de cada corte no cambia: el desposte dice el costo, el precio lo pone el carnicero.
        items: calc.rows.map((r) => ({
          productId: r.p.id,
          quantity: Math.round(r.kg * 1000) / 1000,
          cost: Math.round((r.costKg / 1.21) * 10000) / 10000,
          salePrice: r.price > 0 ? r.price : undefined,
        })),
      });
      // Cuánto rindió cada corte, para estimar el próximo
      const tpl: Template = { what, pct: Object.fromEntries(calc.rows.map((r) => [r.p.id, Math.round((r.kg / inKg) * 10000) / 10000])) };
      setStoreSetting('desposte_template', JSON.stringify(tpl));
      await mergeIntoPosCatalog(since);
      toast.success(`Desposte guardado: ${fmtKg(calc.outKg)} sumados al stock de ${calc.rows.length} cortes`, { duration: 6000 });
      setKgOut({});
      setKgIn('');
      setInvoice('');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el desposte');
    } finally {
      setSaving(false);
    }
  };

  const field = 'h-10 px-3 rounded-xl border border-slate-300 bg-white text-[14px] text-slate-900 outline-none focus:border-rose-500 w-full';

  return (
    <div className="p-4 sm:p-6 max-w-6xl w-full mx-auto space-y-4 pb-28">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Beef className="w-5 h-5 text-rose-700" /> Desposte</h1>
          <p className="text-[13px] text-slate-500 max-w-2xl">Cargá lo que entró y los kilos que salieron de cada corte: suma el stock y te dice cuánto te cuesta de verdad cada corte y cuánto ganás.</p>
        </div>
        <button onClick={() => setShowLoader(true)} className="h-10 px-3.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-[13px] font-semibold text-slate-700 flex items-center gap-1.5">
          <PackagePlus className="w-4 h-4 text-rose-600" /> Cargar cortes
        </button>
      </div>

      <div className="grid lg:grid-cols-[1fr,320px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {/* Lo que entró */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">Lo que entró</h2>
            <div className="flex flex-wrap gap-1.5">
              {WHAT.map((w) => (
                <button key={w} onClick={() => setWhat(w)}
                  className={`px-3 h-8 rounded-lg text-[13px] font-semibold ${what === w ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{w}</button>
              ))}
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[12px] font-semibold text-slate-700">Kilos</span>
                <input inputMode="decimal" value={kgIn} onChange={(e) => setKgIn(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="Ej.: 112,5" className={field + ' tabular-nums'} />
              </label>
              <label className="block">
                <span className="text-[12px] font-semibold text-slate-700">Precio por kilo</span>
                <input inputMode="decimal" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="$ que te cobraron el kilo" className={field + ' tabular-nums'} />
              </label>
              <div>
                <span className="text-[12px] font-semibold text-slate-700">Total</span>
                <div className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center text-[15px] font-bold text-slate-900 tabular-nums">{money(totalCost)}</div>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block sm:col-span-2">
                <span className="text-[12px] font-semibold text-slate-700">Proveedor</span>
                {newSupplier === null ? (
                  <div className="flex gap-2">
                    <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={field}>
                      <option value="">Elegí el frigorífico</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setNewSupplier('')} className="h-10 px-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-[13px] font-semibold text-slate-700 flex items-center gap-1 shrink-0"><Plus className="w-4 h-4" /> Nuevo</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input autoFocus value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSupplier(); }} placeholder="Nombre del frigorífico" className={field} />
                    <button type="button" onClick={addSupplier} className="h-10 px-3 rounded-xl bg-rose-600 text-white text-[13px] font-semibold shrink-0">Crear</button>
                    <button type="button" onClick={() => setNewSupplier(null)} className="h-10 px-3 rounded-xl border border-slate-300 text-[13px] font-semibold text-slate-600 shrink-0">Cancelar</button>
                  </div>
                )}
              </label>
              <label className="block">
                <span className="text-[12px] font-semibold text-slate-700">N° de remito o factura <span className="font-normal text-slate-400">(opcional)</span></span>
                <input value={invoice} onChange={(e) => setInvoice(e.target.value)} className={field} />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([['Efectivo', 'Pagué en efectivo'], ['Transferencia', 'Pagué con transferencia'], ['A cuenta', 'Queda a cuenta']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setPay(v)}
                  className={`px-3 h-8 rounded-lg text-[13px] font-semibold ${pay === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{l}</button>
              ))}
            </div>
            {pay === 'Efectivo' && <CashSourcePicker value={cashSource} onChange={setCashSource} />}
          </section>

          {/* Lo que salió */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">Kilos de cada corte</h2>
              {template && (
                <button onClick={estimate} disabled={!inKg} title={!inKg ? 'Primero poné los kilos que entraron' : undefined}
                  className="h-8 px-3 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 text-[12.5px] font-semibold flex items-center gap-1.5 disabled:opacity-40">
                  <Wand2 className="w-3.5 h-3.5" /> Estimar con el último desposte
                </button>
              )}
            </div>

            {products === null ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : !cuts.length ? (
              <div className="py-8 text-center">
                <p className="text-[14px] text-slate-600">Todavía no tenés productos por kilo.</p>
                <button onClick={() => setShowLoader(true)} className="mt-3 h-10 px-4 rounded-xl bg-rose-600 text-white text-[14px] font-semibold">Cargar los cortes de una</button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                <li className="hidden sm:grid grid-cols-[1fr,110px,110px,110px,80px] gap-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <span>Corte</span><span className="text-right">Kilos</span><span className="text-right">Venta el kilo</span><span className="text-right">Te cuesta el kilo</span><span className="text-right">Rinde</span>
                </li>
                {cuts.map((p) => {
                  const r = calc.byId.get(p.id);
                  return (
                    <li key={p.id} className="py-2 grid grid-cols-[1fr,96px] sm:grid-cols-[1fr,110px,110px,110px,80px] gap-x-3 gap-y-0.5 items-center">
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-slate-800 truncate">{p.name}</span>
                        {p.category?.name && <span className="block text-[11.5px] text-slate-400 truncate">{p.category.name}</span>}
                      </span>
                      <input inputMode="decimal" value={kgOut[p.id] || ''} placeholder="0"
                        onChange={(e) => setKgOut((m) => ({ ...m, [p.id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                        aria-label={`Kilos de ${p.name}`}
                        className="h-9 px-2 rounded-lg border border-slate-300 text-right text-[14px] tabular-nums outline-none focus:border-rose-500" />
                      <span className="col-span-2 sm:col-span-1 sm:text-right text-[12.5px] sm:text-[13px] text-slate-500 tabular-nums">
                        <span className="sm:hidden">Venta </span>{Number(p.salePrice) > 0 ? money(p.salePrice) : <span className="text-amber-600">sin precio</span>}
                        {r && <span className="sm:hidden"> · te cuesta {money(r.costKg)} el kilo{inKg > 0 && ` · rinde ${pct((r.kg / inKg) * 100)}`}</span>}
                      </span>
                      <span className="hidden sm:block text-right text-[13px] font-semibold text-slate-800 tabular-nums">{r ? money(r.costKg) : ''}</span>
                      <span className="hidden sm:block text-right text-[13px] font-semibold text-slate-500 tabular-nums">
                        {r && inKg > 0 ? pct((r.kg / inKg) * 100) : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Resumen */}
        <aside className="bg-slate-900 text-white rounded-2xl p-5 space-y-3 lg:sticky lg:top-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-lime-300">Cómo rindió</h2>
          <dl className="space-y-2 text-[13.5px]">
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Entró</dt><dd className="font-semibold tabular-nums">{fmtKg(inKg)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Cortes</dt><dd className="font-semibold tabular-nums">{fmtKg(calc.outKg)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Hueso, grasa y merma</dt><dd className="font-semibold tabular-nums">{fmtKg(calc.waste)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Rendimiento</dt><dd className="font-bold text-lime-300 tabular-nums">{inKg ? pct(calc.yieldPct) : '—'}</dd></div>
          </dl>
          <div className="h-px bg-white/10" />
          <dl className="space-y-2 text-[13.5px]">
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Pagaste</dt><dd className="font-semibold tabular-nums">{money(totalCost)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-400">Vendiendo todo</dt><dd className="font-semibold tabular-nums">{money(calc.value)}</dd></div>
            <div className="flex justify-between gap-3 text-[15px]"><dt className="text-slate-300 font-semibold">Ganancia</dt><dd className={`font-bold tabular-nums ${gain < 0 ? 'text-red-400' : 'text-lime-300'}`}>{money(gain)}</dd></div>
            {calc.value > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-400">Ganás sobre la venta</dt><dd className={`font-semibold tabular-nums ${gain / calc.value < 0.2 ? 'text-amber-300' : ''}`}>{pct((gain / calc.value) * 100)}</dd></div>}
          </dl>
          {calc.value > 0 && totalCost > 0 && gain / calc.value < 0.2 && (
            <p className="text-[12px] text-amber-300">Con estos precios ganás poco por cada kilo vendido. Para llegar al 30 % habría que subir los cortes un {pct(((totalCost / 0.7) / calc.value - 1) * 100)} (Productos → Aumentar precios).</p>
          )}
          {calc.outKg > inKg * 1.02 && inKg > 0 && (
            <p className="text-[12px] text-amber-300">Salieron más kilos de cortes de los que entraron: revisá los números.</p>
          )}
          {calc.noPrice > 0 && (
            <p className="text-[12px] text-amber-300 flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{calc.noPrice} corte{calc.noPrice === 1 ? '' : 's'} sin precio de venta: no {calc.noPrice === 1 ? 'carga' : 'cargan'} costo hasta que {calc.noPrice === 1 ? 'le' : 'les'} pongas precio.</p>
          )}
          <button onClick={save} disabled={!canSave || saving}
            className="w-full h-12 rounded-xl bg-lime-300 text-slate-900 text-[15px] font-bold disabled:opacity-40 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar y sumar al stock
          </button>
          <p className="text-[11.5px] text-slate-400 leading-snug">
            Entra como una compra {owed ? 'a cuenta del' : 'al'} proveedor. Cada corte queda con su costo nuevo; los precios de venta no se tocan.
            {!supplierId && ' Falta elegir el proveedor.'}
          </p>
        </aside>
      </div>

      {showLoader && <CutsLoader rubros={rubros.includes('CARNICERIA') ? ['CARNICERIA', ...rubros.filter((r) => r !== 'CARNICERIA')] : ['CARNICERIA']} onClose={() => setShowLoader(false)} onDone={load} />}
    </div>
  );
}
