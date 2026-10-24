import { useEffect, useMemo, useRef, useState } from 'react';
import { X, FileSpreadsheet, Upload, Loader2, AlertTriangle, Sparkles, ArrowRight, Search, Link2 } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { usePOSStore } from '../../stores/posStore';

type IvaMode = 'incluido' | 'sumar' | 'sin';
interface ListRow {
  i: number; code: string; barcode: string; name: string; price: number; packUnits: number;
  product: { id: string; name: string; costPrice: number; salePrice: number; unitsPerPack: number } | null;
  by: 'barcode' | 'code' | 'learned' | 'name' | 'ia' | 'manual' | null;
  confidence: 'alta' | 'media' | 'baja' | null;
  perPack: boolean;
  /** Sin encontrar: los productos más parecidos del catálogo */
  candidates?: Prod[];
}
type Prod = { id: string; name: string; costPrice: number; salePrice: number; unitsPerPack: number };
interface Calc { productId: string; oldCost: number; newCost: number; oldSale: number; newSale: number; changePct: number | null; saleUnchanged: boolean }

const money = (n: number) => `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const BY_LABEL: Record<string, string> = { barcode: 'Código de barras', code: 'Código', learned: 'Ya lo conocía de este proveedor', name: 'Nombre', ia: 'Encontrado con IA', manual: 'Elegido por vos' };

/** ¿El precio de la lista es del bulto? Si así queda más cerca del costo que tenía */
const guessPerPack = (r: { price: number; packUnits: number }, p: Prod) => {
  const upp = Number(p.unitsPerPack) || 1;
  if (upp <= 1) return false;
  if (r.packUnits === upp) return true;
  return p.costPrice > 0 && Math.abs(Math.log(r.price / upp / p.costPrice)) < Math.abs(Math.log(r.price / p.costPrice));
};

/** Un renglón sin encontrar: elegir el producto tuyo (sugeridos o buscando) */
function MissingRow({ r, onPick }: { r: ListRow; onPick: (p: Prod) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Prod[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get('/products', { params: { search: q.trim() }, silent: true } as any)
        .then(({ data }) => setResults((Array.isArray(data) ? data : data?.products || []).slice(0, 8)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="px-3 py-2.5 text-[12.5px]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-700 truncate">{r.code ? <span className="text-slate-400 mr-1.5">{r.code}</span> : null}{r.name}</span>
        <span className="shrink-0 flex items-center gap-2">
          <span className="tabular-nums text-slate-500">{money(r.price)}</span>
          <button type="button" onClick={() => setSearching((v) => !v)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
            <Search className="w-3 h-3" /> Buscar el mío
          </button>
        </span>
      </div>
      {!!r.candidates?.length && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className="text-[11px] text-slate-500">¿Es alguno de estos?</span>
          {r.candidates.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)} className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100">{c.name}</button>
          ))}
        </div>
      )}
      {searching && (
        <div className="mt-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o código de tu producto" className="w-full h-8 px-2.5 rounded-lg border border-slate-300 text-[12.5px] outline-none focus:border-rose-500" />
          {results.length > 0 && (
            <div className="mt-1 rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {results.map((p) => (
                <button key={p.id} type="button" onClick={() => onPick(p)} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50">
                  <span className="truncate text-slate-800">{p.name}</span>
                  <Link2 className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
/** Cambios muy grandes: quedan sin marcar para revisarlos (puede ser otro producto o el precio de otra presentación) */
const suspicious = (c?: Calc) => !!c && c.changePct !== null && (c.changePct > 60 || c.changePct < -40);

/**
 * Lista de precios del proveedor → costos nuevos (ver PriceListService en el backend).
 * Paso 1: subir la lista. Paso 2: revisar qué producto es cada renglón y cuánto cambia, y aplicar.
 */
export default function PriceListModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState('');
  /** Nombre que parece ser el del proveedor pero no está cargado: se ofrece crearlo */
  const [supplierGuess, setSupplierGuess] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [info, setInfo] = useState<{ source: string; truncated: boolean; aiMatched: number } | null>(null);
  const [ivaMode, setIvaMode] = useState<IvaMode>('incluido');
  const [discount, setDiscount] = useState('');
  const [keepMargin, setKeepMargin] = useState(true);
  const [round, setRound] = useState(10);
  const [calc, setCalc] = useState<Record<string, Calc>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [tab, setTab] = useState<'cambian' | 'revisar' | 'faltan'>('cambian');
  const [applying, setApplying] = useState(false);
  const firstPreview = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.get('/suppliers').then(({ data }) => setSuppliers(data || [])).catch(() => {}); }, []);

  const read = async () => {
    if (!files.length) return toast.error('Elegí el archivo o las fotos de la lista');
    setReading(true);
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      if (supplierId) form.append('supplierId', supplierId);
      const { data } = await api.post('/ai/price-list/read', form, { timeout: 240000 } as any);
      setRows(data.rows || []);
      setInfo({ source: data.source, truncated: data.truncated, aiMatched: data.aiMatched || 0 });
      if (data.supplier) {
        setSupplierId(data.supplier.id);
        setSuppliers((list) => (list.some((s) => s.id === data.supplier.id) ? list : [...list, data.supplier]));
      }
      setSupplierGuess(data.supplierGuess || '');
      setIvaMode(data.priceIncludesIva === 'no' ? 'sumar' : 'incluido');
      firstPreview.current = true;
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo leer la lista');
    } finally {
      setReading(false);
    }
  };

  const matched = useMemo(() => (rows || []).filter((r) => r.product), [rows]);
  const missing = useMemo(() => (rows || []).filter((r) => !r.product), [rows]);

  // Costos y precios nuevos con las opciones elegidas (los calcula la PC, igual que al aplicar)
  useEffect(() => {
    if (!matched.length) return;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post('/ai/price-list/preview', {
          items: matched.map((r) => ({ productId: r.product!.id, price: r.price, perPack: r.perPack })),
          ivaMode, discount: parseFloat(discount.replace(',', '.')) || 0, keepMargin, round,
        });
        const next: Record<string, Calc> = {};
        for (const c of data || []) if (!c.missing) next[c.productId] = c;
        setCalc(next);
        if (firstPreview.current) {
          firstPreview.current = false;
          const init: Record<number, boolean> = {};
          for (const r of matched) init[r.i] = r.confidence !== 'baja' && !suspicious(next[r.product!.id]);
          setChecked(init);
        }
      } catch { /* se reintenta al cambiar una opción */ }
    }, 250);
    return () => clearTimeout(t);
  }, [matched, ivaMode, discount, keepMargin, round]);

  const needsReview = (r: ListRow) => r.confidence === 'baja' || suspicious(calc[r.product!.id]);
  const changing = matched.filter((r) => !needsReview(r));
  const review = matched.filter(needsReview);
  const list = tab === 'cambian' ? changing : tab === 'revisar' ? review : missing;
  const selected = matched.filter((r) => checked[r.i]);

  /** Este renglón es este producto: pasa a "Encontrados" y, con proveedor elegido, se aprende ya */
  const pick = async (r: ListRow, p: Prod) => {
    if (rows?.some((x) => x.product?.id === p.id && x.i !== r.i)) {
      if (!window.confirm(`${p.name} ya está asociado a otro renglón de la lista. ¿Usarlo también para este?`)) return;
    }
    setRows((rs) => (rs || []).map((x) => (x.i === r.i ? { ...x, product: p, by: 'manual', confidence: 'alta', perPack: guessPerPack(x, p) } : x)));
    setChecked((c) => ({ ...c, [r.i]: true }));
    if (!supplierId) { toast('Elegí el proveedor arriba para que Ventra lo recuerde en las próximas listas y boletas.', { icon: 'ℹ️' }); return; }
    try {
      await api.post('/ai/price-list/learn', { supplierId, items: [{ code: r.code, name: r.name, productId: p.id }] }, { silent: true } as any);
      toast.success(`${p.name}: las próximas boletas de este proveedor lo reconocen solas`);
    } catch { /* se aprende igual al aplicar */ }
  };

  /** Se eligió el proveedor después de asociar: se aprenden los que ya se asociaron a mano */
  const chooseSupplier = async (id: string) => {
    setSupplierId(id);
    const manual = (rows || []).filter((x) => x.by === 'manual' && x.product);
    if (id && manual.length) {
      await api.post('/ai/price-list/learn', { supplierId: id, items: manual.map((x) => ({ code: x.code, name: x.name, productId: x.product!.id })) }, { silent: true } as any).catch(() => {});
    }
  };

  const togglePerPack = (i: number) => setRows((rs) => (rs || []).map((r) => (r.i === i ? { ...r, perPack: !r.perPack } : r)));

  const apply = async () => {
    if (!selected.length) return toast.error('No hay productos marcados');
    if (!window.confirm(`Se actualizan ${selected.length} productos${keepMargin ? ', manteniendo su margen de ganancia' : ' (solo el costo)'}. ¿Seguir?`)) return;
    setApplying(true);
    try {
      const { data } = await api.post('/ai/price-list/apply', {
        items: selected.map((r) => ({ productId: r.product!.id, price: r.price, perPack: r.perPack, code: r.code, name: r.name })),
        supplierId: supplierId || undefined,
        ivaMode, discount: parseFloat(discount.replace(',', '.')) || 0, keepMargin, round,
      }, { timeout: 120000 } as any);
      toast.success(`Listo: se actualizaron ${data.updated} productos`);
      usePOSStore.getState().setProducts([]);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron aplicar los precios');
    } finally {
      setApplying(false);
    }
  };

  const chip = (active: boolean) => `px-2.5 py-1.5 rounded-lg border text-[11.5px] font-bold transition-colors ${active ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl w-full ${rows ? 'max-w-5xl' : 'max-w-lg'} shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]`}>
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl"><FileSpreadsheet className="w-5 h-5" /></div>
            <div>
              <h2 className="text-base font-bold text-slate-800">Lista de precios del proveedor</h2>
              <p className="text-xs text-slate-500">Subí la lista nueva: Ventra encuentra cada producto y te muestra cuánto cambia</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
        </div>

        {!rows ? (
          <div className="p-6 space-y-4 overflow-y-auto">
            <div>
              <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-1.5">Proveedor (opcional)</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm">
                <option value="">Sin elegir</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">Ayuda a encontrar los productos de ese proveedor y se lo asigna a los que no tienen.</p>
            </div>
            <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,image/*" className="hidden"
              onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 6))} />
            <button type="button" onClick={() => inputRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-slate-300 hover:border-rose-400 bg-slate-50 px-4 py-6 text-center">
              <Upload className="w-6 h-6 text-rose-600 mx-auto mb-2" />
              <span className="block text-sm font-semibold text-slate-800">{files.length ? files.map((f) => f.name).join(', ') : 'Elegir la lista'}</span>
              <span className="block text-[11.5px] text-slate-500 mt-1">PDF, Excel o CSV. También fotos de la lista impresa (hasta 6).</span>
            </button>
            <button onClick={read} disabled={reading || !files.length}
              className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {reading ? <><Loader2 className="w-4 h-4 animate-spin" /> Leyendo la lista… (un PDF o fotos pueden tardar un minuto)</> : 'Leer la lista'}
            </button>
          </div>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-slate-200 space-y-2.5 shrink-0">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11.5px] font-semibold text-slate-600">Los precios de la lista</span>
                  <button className={chip(ivaMode === 'incluido')} onClick={() => setIvaMode('incluido')}>tienen IVA</button>
                  <button className={chip(ivaMode === 'sumar')} onClick={() => setIvaMode('sumar')}>son sin IVA: sumarlo</button>
                  <button className={chip(ivaMode === 'sin')} onClick={() => setIvaMode('sin')}>son sin IVA: dejarlos así</button>
                </div>
                <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600">
                  Descuento del proveedor
                  <input value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" className="w-14 h-8 px-2 rounded-lg border border-slate-300 text-sm text-right" />%
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11.5px] font-semibold text-slate-600">Precio de venta</span>
                  <button className={chip(keepMargin)} onClick={() => setKeepMargin(true)}>mantener el margen</button>
                  <button className={chip(!keepMargin)} onClick={() => setKeepMargin(false)}>no tocarlo</button>
                </div>
                {keepMargin && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11.5px] font-semibold text-slate-600">Redondear</span>
                    {[0, 10, 100].map((n) => <button key={n} className={chip(round === n)} onClick={() => setRound(n)}>{n ? `a $ ${n}` : 'no'}</button>)}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11.5px] font-semibold text-slate-600">Proveedor</span>
                <select value={supplierId} onChange={(e) => chooseSupplier(e.target.value)} className={`h-8 px-2 rounded-lg border text-[12.5px] bg-white ${supplierId ? 'border-slate-300' : 'border-amber-400'}`}>
                  <option value="">Sin elegir</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {!supplierId && supplierGuess && (
                  <button type="button" onClick={async () => {
                    try {
                      const { data } = await api.post('/suppliers', { name: supplierGuess });
                      setSuppliers((list) => [...list, data]);
                      await chooseSupplier(data.id);
                      setSupplierGuess('');
                    } catch { toast.error('No se pudo crear el proveedor'); }
                  }} className="px-2 py-1 rounded-md bg-amber-50 border border-amber-300 text-[11px] font-bold text-amber-800">
                    Crear proveedor «{supplierGuess}»
                  </button>
                )}
                {!supplierId && <span className="text-[11px] text-amber-700">Elegilo para que Ventra recuerde los productos de este proveedor.</span>}
              </div>
              {info?.truncated && <p className="text-[11.5px] text-amber-700">La lista es muy larga: se leyeron los primeros 5.000 renglones.</p>}
            </div>

            <div className="px-6 pt-3 flex gap-1.5 shrink-0">
              {([['cambian', `Encontrados (${changing.length})`], ['revisar', `Para revisar (${review.length})`], ['faltan', `Sin encontrar (${missing.length})`]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-full text-[12px] font-semibold ${tab === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>
              ))}
              {tab !== 'faltan' && list.length > 0 && (
                <button onClick={() => { const all = list.every((r) => checked[r.i]); setChecked((c) => { const n = { ...c }; list.forEach((r) => { n[r.i] = !all; }); return n; }); }}
                  className="ml-auto text-[12px] font-semibold text-rose-700">{list.every((r) => checked[r.i]) ? 'Desmarcar todos' : 'Marcar todos'}</button>
              )}
            </div>
            {tab === 'revisar' && review.length > 0 && <p className="px-6 pt-2 text-[11.5px] text-amber-700">Cambian mucho o no es seguro que sea el mismo producto: fijate antes de marcarlos. Si el precio es del bulto, tocá "por bulto".</p>}

            <div className="flex-1 overflow-y-auto px-6 py-3">
              {list.length === 0 ? (
                <p className="text-center text-sm text-slate-500 py-10">{tab === 'faltan' ? 'Se encontraron todos los productos de la lista.' : 'No hay productos acá.'}</p>
              ) : tab === 'faltan' ? (
                <div className="space-y-2">
                  <p className="text-[11.5px] text-slate-600">
                    Si lo tenés con otro nombre, tocá el tuyo (o "Buscar el mío"): pasa a Encontrados y Ventra lo recuerda para las próximas listas y boletas de este proveedor. Los que no vendés, dejalos.
                  </p>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {list.slice(0, 500).map((r) => <MissingRow key={r.i} r={r} onPick={(p) => pick(r, p)} />)}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {list.map((r) => {
                    const c = calc[r.product!.id];
                    return (
                      <label key={r.i} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
                        <input type="checkbox" checked={!!checked[r.i]} onChange={(e) => setChecked((x) => ({ ...x, [r.i]: e.target.checked }))} className="w-4 h-4 accent-rose-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{r.product!.name}</p>
                          <p className="text-[11.5px] text-slate-500 truncate">
                            En la lista: {r.name}
                            <span className={`ml-1.5 inline-flex items-center gap-0.5 ${r.by === 'ia' ? 'text-violet-700' : 'text-slate-400'}`}>
                              {r.by === 'ia' && <Sparkles className="w-3 h-3" />}· {BY_LABEL[r.by || ''] || ''}
                            </span>
                          </p>
                        </div>
                        {r.product!.unitsPerPack > 1 && (
                          <button type="button" onClick={(e) => { e.preventDefault(); togglePerPack(r.i); }}
                            title={`El bulto trae ${r.product!.unitsPerPack} unidades`}
                            className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-bold border ${r.perPack ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-500'}`}>
                            {r.perPack ? `por bulto (÷${r.product!.unitsPerPack})` : 'por unidad'}
                          </button>
                        )}
                        <div className="w-44 shrink-0 text-right">
                          <p className="text-[11px] text-slate-400">Costo</p>
                          <p className="text-[12.5px] tabular-nums text-slate-700">
                            {c ? <>{money(c.oldCost)} <ArrowRight className="inline w-3 h-3 text-slate-400" /> <b>{money(c.newCost)}</b></> : '…'}
                          </p>
                          {c && c.changePct !== null && (
                            <p className={`text-[11px] font-bold tabular-nums ${suspicious(c) ? 'text-amber-700' : c.changePct > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {suspicious(c) && <AlertTriangle className="inline w-3 h-3 mr-0.5" />}{c.changePct > 0 ? '+' : ''}{c.changePct.toLocaleString('es-AR')}%
                            </p>
                          )}
                        </div>
                        <div className="w-40 shrink-0 text-right">
                          <p className="text-[11px] text-slate-400">Venta</p>
                          <p className="text-[12.5px] tabular-nums text-slate-700">
                            {!c ? '…' : c.saleUnchanged ? <span className="text-slate-500">{money(c.oldSale)} (igual)</span> : <>{money(c.oldSale)} <ArrowRight className="inline w-3 h-3 text-slate-400" /> <b>{money(c.newSale)}</b></>}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
              <p className="text-[12px] text-slate-600">
                {matched.length} de {rows.length} productos encontrados{info?.aiMatched ? ` (${info.aiMatched} con IA)` : ''} · <b>{selected.length} marcados</b>
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setRows(null); setFiles([]); }} className="h-10 px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700">Otra lista</button>
                <button onClick={apply} disabled={applying || !selected.length}
                  className="h-10 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-2">
                  {applying && <Loader2 className="w-4 h-4 animate-spin" />} Aplicar {selected.length} precios
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
