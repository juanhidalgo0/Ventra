import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, TrendingUp, TrendingDown, Undo2, RotateCcw, Loader2, CheckCircle2, AlertTriangle, Tags, Percent } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { usePOSStore } from '../../stores/posStore';
import { useConfirm } from '../common/ConfirmDialog';
import {
  ALL_FIELDS, FIELD_LABELS, SELL_FIELDS, adjust, followCost, hasField, marginPct, money, pctChange, pctText, realChanges,
  type Adjustment, type EditorProduct, type PriceField, type Prices,
} from './priceEditorMath';

/**
 * Aumentar precios por grupos.
 *
 * Se filtra (buscador + marca + categoría + proveedor, todo junto), se tilda, se aplica un % o un
 * monto a los tildados, y se repite con otro grupo. También se puede escribir el costo o la venta
 * a mano en cada fila. Nada se guarda hasta "Guardar": ahí va todo en una sola operación, que
 * después se puede deshacer.
 */

interface Draft { prices: Prices; how: string }
interface LastBatch { id: string; createdAt: number; userName: string | null; label: string; count: number }
type View = 'all' | 'pending' | 'changed';

const PAGE = 150;
const ROUNDS = [{ v: 0, label: 'Sin redondeo' }, { v: 10, label: 'A $10' }, { v: 50, label: 'A $50' }, { v: 100, label: 'A $100' }];
const STALE = [{ v: 0, label: 'Cualquier fecha' }, { v: 30, label: 'Sin aumento hace +30 días' }, { v: 60, label: 'Sin aumento hace +60 días' }, { v: 90, label: 'Sin aumento hace +90 días' }];

const chip = (on: boolean) =>
  `px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${on ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`;
const selectCls = 'w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-500';

function daysAgo(ms: number | null) {
  if (!ms) return null;
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
}

export default function PriceEditorModal({ onClose, onSaved, onPrintLabels }: { onClose: () => void; onSaved: () => void; onPrintLabels: () => void }) {
  const [confirm, confirmDialog] = useConfirm();

  // Filtros
  const [search, setSearch] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [staleDays, setStaleDays] = useState(0);
  const [brands, setBrands] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);

  // Productos: todos los que se vieron (para no perder lo cambiado al buscar otra cosa) y los de la búsqueda actual
  const [known, setKnown] = useState<Record<string, EditorProduct>>({});
  const [visible, setVisible] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<View>('all');
  const [shown, setShown] = useState(PAGE);

  // La tanda
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [mode, setMode] = useState<'pct' | 'amount'>('pct');
  const [value, setValue] = useState('');
  const [fields, setFields] = useState<PriceField[]>(['salePrice']);
  const [round, setRound] = useState(10);
  const [keepMargin, setKeepMargin] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ updated: number } | null>(null);
  const [lastBatch, setLastBatch] = useState<LastBatch | null>(null);
  const [undoing, setUndoing] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    Promise.allSettled([api.get('/brands'), api.get('/categories'), api.get('/suppliers')]).then(([b, c, s]) => {
      if (b.status === 'fulfilled') setBrands(b.value.data || []);
      if (c.status === 'fulfilled') setCategories(c.value.data || []);
      if (s.status === 'fulfilled') setSuppliers(s.value.data || []);
    });
    loadLastBatch();
  }, []);

  const loadLastBatch = () => api.get('/products/price-editor/last').then(({ data }) => setLastBatch(data || null)).catch(() => {});

  // Buscar: el texto espera a que se deje de escribir; las listas buscan al toque
  const runSearch = useCallback(async () => {
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const { data } = await api.get('/products/price-editor', { params: { search, brandId, categoryId, supplierId, staleDays } });
      if (seq !== searchSeq.current) return;
      const list: EditorProduct[] = data?.products || [];
      // Los que ya tienen cambios conservan su precio "de hoy" original (el que se vio primero)
      setKnown((k) => {
        const next = { ...k };
        for (const p of list) if (!next[p.id]) next[p.id] = p;
        return next;
      });
      setVisible(list.map((p) => p.id));
      setTruncated(!!data?.truncated);
      setChecked(Object.fromEntries(list.map((p) => [p.id, true])));
      setShown(PAGE);
      if (view === 'changed') setView('all');
    } catch (err: any) {
      if (seq === searchSeq.current) toast.error(err?.response?.data?.message || 'No se pudieron buscar los productos');
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, brandId, categoryId, supplierId, staleDays]);

  useEffect(() => {
    const t = setTimeout(runSearch, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [runSearch, search]);

  // Qué cambia de verdad (comparado con el precio de hoy)
  const changes = useMemo(() => {
    const out: Record<string, Prices> = {};
    for (const [id, d] of Object.entries(drafts)) {
      const p = known[id];
      if (!p) continue;
      const c = realChanges(p, d.prices);
      if (Object.keys(c).length) out[id] = c;
    }
    return out;
  }, [drafts, known]);
  const changedIds = Object.keys(changes);

  const rows = useMemo(() => {
    if (view === 'changed') return changedIds.map((id) => known[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    const list = visible.map((id) => known[id]).filter(Boolean);
    return view === 'pending' ? list.filter((p) => !changes[p.id]) : list;
  }, [view, visible, known, changes, changedIds]);

  // Al cambiar de vista se tilda todo lo que muestra (si no, lo de búsquedas anteriores aparece
  // sin tildar en "Con cambios" y parece que no se va a guardar)
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    setChecked((ch) => ({ ...ch, ...Object.fromEntries(rowsRef.current.map((p) => [p.id, true])) }));
  }, [view]);

  const checkedRows = rows.filter((p) => checked[p.id]);
  const allChecked = rows.length > 0 && checkedRows.length === rows.length;

  // Qué precios existen en lo que se ve (mayorista, comercio y bulto solo si alguno los tiene)
  const availableFields = useMemo(
    () => ALL_FIELDS.filter((f) => f === 'salePrice' || f === 'costPrice' || rows.some((p) => hasField(p, f))),
    [rows],
  );

  const toggleField = (f: PriceField) => setFields((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]));

  const merge = (id: string, prices: Prices, how: string) =>
    setDrafts((d) => ({ ...d, [id]: { prices: { ...(d[id]?.prices || {}), ...prices }, how } }));

  const applyBatch = () => {
    const v = Number(String(value).replace(',', '.'));
    if (!(v > 0)) { toast.error(mode === 'pct' ? 'Escribí el porcentaje' : 'Escribí el monto'); valueRef.current?.focus(); return; }
    if (!fields.length) { toast.error('Elegí qué precios se mueven'); return; }
    if (!checkedRows.length) { toast.error('No hay productos tildados'); return; }
    if (mode === 'pct' && direction === 'down' && v >= 100) { toast.error('No se puede bajar 100 % o más'); return; }
    const a: Adjustment = { direction, mode, value: v, fields, round };
    const how = `${direction === 'up' ? '+' : '−'}${mode === 'pct' ? `${v}%` : money(v)}`;
    let n = 0;
    const next: Record<string, Draft> = { ...drafts };
    for (const p of checkedRows) {
      let prices = adjust(p, a);
      // Con "mantener la ganancia", si se movió el costo, la venta lo acompaña
      if (keepMargin && prices.costPrice !== undefined) prices = { ...prices, ...followCost(p, prices.costPrice, round) };
      if (!Object.keys(prices).length) continue;
      next[p.id] = { prices: { ...(next[p.id]?.prices || {}), ...prices }, how };
      n++;
    }
    setDrafts(next);
    toast.success(`${how} a ${n} producto${n === 1 ? '' : 's'}. Falta guardar.`);
  };

  const editCost = (p: EditorProduct, raw: string) => {
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) return;
    merge(p.id, keepMargin ? followCost(p, n, round) : { costPrice: n }, 'a mano');
  };
  const editSale = (p: EditorProduct, raw: string) => {
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) return;
    merge(p.id, { salePrice: n }, 'a mano');
  };
  const resetRow = (id: string) => setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });

  // Enter en un precio baja a la fila de abajo (para cargar una boleta de corrido)
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const col = e.currentTarget.dataset.col;
    const row = Number(e.currentTarget.dataset.row) + (e.key === 'ArrowUp' ? -1 : 1);
    const nextEl = document.querySelector<HTMLInputElement>(`input[data-col="${col}"][data-row="${row}"]`);
    if (nextEl) { nextEl.focus(); nextEl.select(); }
  };

  // Resumen para confirmar
  const summary = useMemo(() => {
    let up = 0, down = 0, belowCost = 0;
    for (const id of changedIds) {
      const p = known[id]; const c = changes[id];
      const sale = c.salePrice ?? p.salePrice; const cost = c.costPrice ?? p.costPrice;
      const ref = c.salePrice !== undefined ? [p.salePrice, c.salePrice] : c.costPrice !== undefined ? [p.costPrice, c.costPrice] : null;
      if (ref) { if (ref[1] > ref[0]) up++; else if (ref[1] < ref[0]) down++; }
      if (cost > 0 && sale < cost) belowCost++;
    }
    return { up, down, belowCost };
  }, [changedIds, changes, known]);

  const save = async () => {
    if (!changedIds.length) return;
    const parts = [`${changedIds.length} producto${changedIds.length === 1 ? '' : 's'} cambian de precio`];
    if (summary.up) parts.push(`${summary.up} suben`);
    if (summary.down) parts.push(`${summary.down} bajan`);
    const ok = await confirm({
      title: `¿Guardar ${changedIds.length} precio${changedIds.length === 1 ? '' : 's'}?`,
      message: parts.join(' · ') + '.'
        + (summary.belowCost ? `\n\nOjo: ${summary.belowCost} quedan con la venta por debajo del costo.` : '')
        + '\n\nSe puede deshacer con "Deshacer último aumento".',
      confirmLabel: 'Guardar',
      cancelLabel: 'Revisar',
      danger: summary.belowCost > 0,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const hows = Array.from(new Set(changedIds.map((id) => drafts[id]?.how).filter(Boolean)));
      const filterName = [brands.find((b) => b.id === brandId)?.name, categories.find((c) => c.id === categoryId)?.name, suppliers.find((s) => s.id === supplierId)?.name].filter(Boolean).join(' · ');
      const label = `${changedIds.length} productos${filterName ? ` (${filterName})` : ''}${hows.length ? `: ${hows.slice(0, 4).join(', ')}` : ''}`;
      const { data } = await api.post('/products/price-editor/apply', {
        label,
        items: changedIds.map((id) => ({ id, prices: changes[id] })),
      }, { timeout: 0 });
      // Lo guardado pasa a ser el precio "de hoy"
      setKnown((k) => {
        const n = { ...k };
        for (const id of changedIds) n[id] = { ...n[id], ...changes[id], priceChangedAt: changes[id].salePrice !== undefined ? Date.now() : n[id].priceChangedAt };
        return n;
      });
      setDrafts({});
      setSaved({ updated: data?.updated ?? changedIds.length });
      usePOSStore.getState().setProducts([]);
      loadLastBatch();
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron guardar los precios. No se cambió nada.');
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!lastBatch) return;
    const when = new Date(lastBatch.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const ok = await confirm({
      title: '¿Deshacer el último aumento?',
      message: `${lastBatch.label}\nGuardado el ${when}${lastBatch.userName ? ` por ${lastBatch.userName}` : ''}.\n\nVuelven los precios de antes. Si a algún producto le cambiaron el precio después, ese no se toca.`,
      confirmLabel: 'Deshacer',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!ok) return;
    setUndoing(true);
    try {
      const { data } = await api.post(`/products/price-editor/undo/${lastBatch.id}`, {}, { timeout: 0 });
      const skipped: string[] = data?.skipped || [];
      toast.success(`Volvieron los precios de ${data?.restored ?? 0} productos`);
      if (skipped.length) toast(`${skipped.length} no se tocaron porque cambiaron después: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`, { duration: 7000, icon: 'ℹ️' });
      // Volver a leer los precios de hoy
      setKnown({}); setDrafts({});
      usePOSStore.getState().setProducts([]);
      await runSearch();
      loadLastBatch();
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo deshacer');
    } finally {
      setUndoing(false);
    }
  };

  const close = async () => {
    if (changedIds.length && !(await confirm({ title: '¿Salir sin guardar?', message: `Hay ${changedIds.length} precio${changedIds.length === 1 ? '' : 's'} cambiados sin guardar. Se pierden.`, confirmLabel: 'Salir sin guardar', cancelLabel: 'Volver', danger: true }))) return;
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const catLabel = (c: any) => (c.parentCategory?.name ? `${c.parentCategory.name} › ${c.name}` : c.name);
  const sortedCats = useMemo(() => [...categories].sort((a, b) => catLabel(a).localeCompare(catLabel(b))), [categories]);

  // ─────────────────────────────── pantalla de "guardado"
  if (saved) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-slate-200 p-6 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <div>
            <h2 className="text-lg font-bold text-slate-800">Se guardaron {saved.updated} precios</h2>
            <p className="text-sm text-slate-500 mt-1">Las cajas abiertas ya tienen los precios nuevos. Si te equivocaste, usá "Deshacer último aumento".</p>
          </div>
          <div className="flex flex-col gap-2">
            <button className="btn-primary" onClick={() => { onPrintLabels(); onClose(); }}><Tags className="w-4 h-4" /> Imprimir etiquetas de lo que cambió</button>
            <button className="btn-secondary" onClick={() => setSaved(null)}>Seguir aumentando otros productos</button>
            <button className="text-sm font-semibold text-slate-500 hover:text-slate-700 py-1" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    );
  }

  const sellChosen = fields.some((f) => SELL_FIELDS.includes(f));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-6xl h-[94vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Encabezado */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl"><Percent className="w-5 h-5 stroke-[2.5]" /></div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-800">Aumentar precios</h2>
              <p className="text-xs text-slate-500 truncate">Filtrá un grupo, aplicale un % y repetí con otro. También podés escribir el costo o la venta a mano. Nada se guarda hasta "Guardar".</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lastBatch && (
              <button onClick={undo} disabled={undoing} title={lastBatch.label} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Deshacer último aumento
              </button>
            )}
            <button onClick={close} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700" aria-label="Cerrar"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Filtros */}
        <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-slate-200">
          <div className="relative col-span-2 md:col-span-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o código (ej: papas kento)" className={selectCls + ' pl-8'} />
          </div>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={selectCls}>
            <option value="">Todas las marcas</option>
            <option value="none">Sin marca</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectCls}>
            <option value="">Todas las categorías</option>
            {sortedCats.map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
          </select>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={selectCls}>
            <option value="">Todos los proveedores</option>
            <option value="none">Sin proveedor</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={staleDays} onChange={(e) => setStaleDays(Number(e.target.value))} className={selectCls}>
            {STALE.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>

        {/* La tanda */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-bold text-slate-600">A los {checkedRows.length} tildados:</span>
          <div className="flex gap-1">
            <button type="button" className={chip(direction === 'up')} onClick={() => setDirection('up')}><TrendingUp className="w-3.5 h-3.5 inline -mt-0.5" /> Subir</button>
            <button type="button" className={chip(direction === 'down')} onClick={() => setDirection('down')}><TrendingDown className="w-3.5 h-3.5 inline -mt-0.5" /> Bajar</button>
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={valueRef}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyBatch(); } }}
              placeholder={mode === 'pct' ? '12' : '100'}
              inputMode="decimal"
              className="w-20 bg-white border-2 border-rose-200 rounded-lg px-2 py-1 text-sm font-bold text-slate-800 outline-none focus:border-rose-600"
            />
            <button type="button" className={chip(mode === 'pct')} onClick={() => setMode('pct')}>%</button>
            <button type="button" className={chip(mode === 'amount')} onClick={() => setMode('amount')}>$</button>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-500">Precios:</span>
            {availableFields.map((f) => (
              <button key={f} type="button" className={chip(fields.includes(f))} onClick={() => toggleField(f)}>{FIELD_LABELS[f]}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500">Redondeo:</span>
            <select value={round} onChange={(e) => setRound(Number(e.target.value))} className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-semibold">
              {ROUNDS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer" title="Si cambia el costo (por % o a mano), la venta, el mayorista y el bulto suben en la misma proporción">
            <input type="checkbox" checked={keepMargin} onChange={(e) => setKeepMargin(e.target.checked)} className="accent-rose-600" />
            Mantener la ganancia
          </label>
          <button type="button" onClick={applyBatch} className="ml-auto btn-primary !py-1.5 !px-4 text-sm">Aplicar a tildados</button>
          {keepMargin && fields.includes('costPrice') && sellChosen && (
            <p className="w-full text-[11px] text-slate-500 -mt-1">Con "Mantener la ganancia", al mover el costo la venta lo acompaña en la misma proporción.</p>
          )}
        </div>

        {/* Vista */}
        <div className="px-5 py-2 flex items-center gap-2 border-b border-slate-200 text-xs">
          <button className={chip(view === 'all')} onClick={() => setView('all')}>Lo que coincide ({visible.length}{truncated ? '+' : ''})</button>
          <button className={chip(view === 'pending')} onClick={() => setView('pending')}>Falta tocar</button>
          <button className={chip(view === 'changed')} onClick={() => setView('changed')}>Con cambios ({changedIds.length})</button>
          {truncated && view !== 'changed' && <span className="text-amber-700 font-semibold">Hay más de 3.000: afiná la búsqueda.</span>}
          {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white z-10 shadow-[0_1px_0_#e2e8f0]">
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="w-9 py-2 pl-5 text-left">
                  <input type="checkbox" checked={allChecked} onChange={(e) => setChecked(Object.fromEntries(rows.map((p) => [p.id, e.target.checked])))} className="accent-rose-600" aria-label="Tildar todo" />
                </th>
                <th className="text-left font-bold py-2">Producto</th>
                <th className="text-right font-bold py-2 w-44">Costo</th>
                <th className="text-right font-bold py-2 w-48">Venta</th>
                <th className="text-right font-bold py-2 w-24">Ganancia</th>
                <th className="w-10 pr-4" />
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-12">{view === 'changed' ? 'Todavía no cambiaste ningún precio.' : 'No hay productos con esos filtros.'}</td></tr>
              )}
              {rows.slice(0, shown).map((p, i) => {
                const c = changes[p.id] || {};
                const d = drafts[p.id];
                const cost = c.costPrice ?? p.costPrice;
                const sale = c.salePrice ?? p.salePrice;
                const m = marginPct(sale, cost);
                const below = cost > 0 && sale < cost;
                const others = (['wholesalePrice', 'tradePrice', 'packPrice'] as PriceField[]).filter((f) => hasField(p, f));
                const touched = Object.keys(c).length > 0;
                return (
                  <tr key={p.id} className={`border-t border-slate-100 align-top ${touched ? 'bg-emerald-50/50' : ''} ${checked[p.id] ? '' : 'opacity-60'}`}>
                    <td className="py-2 pl-5">
                      <input type="checkbox" checked={!!checked[p.id]} onChange={(e) => setChecked((ch) => ({ ...ch, [p.id]: e.target.checked }))} className="accent-rose-600 mt-1" aria-label={`Tildar ${p.name}`} />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-semibold text-slate-800 leading-tight">{p.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {[p.brand, p.category, p.supplier].filter(Boolean).join(' · ') || 'Sin marca ni categoría'}
                        {daysAgo(p.priceChangedAt) && <> · último cambio {daysAgo(p.priceChangedAt)}</>}
                        {touched && d && <span className="ml-1 font-bold text-emerald-700">· {d.how}</span>}
                      </div>
                      {others.length > 0 && (
                        <div className="text-[11px] text-slate-600 mt-0.5 flex flex-wrap gap-x-3">
                          {others.map((f) => (
                            <span key={f}>
                              {FIELD_LABELS[f]}{f === 'packPrice' && p.unitsPerPack > 1 ? ` x${p.unitsPerPack}` : ''}: {money(p[f] as number)}
                              {c[f] !== undefined && <> → <b className="text-emerald-700">{money(c[f])}</b></>}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <div className="text-[11px] text-slate-400">hoy {money(p.costPrice)}</div>
                      <input
                        type="number" step="any" min="0"
                        data-col="cost" data-row={i}
                        value={c.costPrice ?? (d?.prices.costPrice ?? '')}
                        placeholder={String(p.costPrice || '')}
                        onChange={(e) => (e.target.value === '' ? merge(p.id, { costPrice: p.costPrice }, d?.how || 'a mano') : editCost(p, e.target.value))}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={onCellKey}
                        className="w-28 text-right bg-white border border-slate-300 rounded-md px-2 py-1 text-sm font-semibold outline-none focus:border-rose-500"
                      />
                      {c.costPrice !== undefined && <div className="text-[11px] font-bold text-slate-500">{pctText(pctChange(p.costPrice, c.costPrice))}</div>}
                    </td>
                    <td className="py-2 text-right">
                      <div className="text-[11px] text-slate-400">hoy {money(p.salePrice)}</div>
                      <input
                        type="number" step="any" min="0"
                        data-col="sale" data-row={i}
                        value={c.salePrice ?? (d?.prices.salePrice ?? '')}
                        placeholder={String(p.salePrice || '')}
                        onChange={(e) => (e.target.value === '' ? merge(p.id, { salePrice: p.salePrice }, d?.how || 'a mano') : editSale(p, e.target.value))}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={onCellKey}
                        className={`w-28 text-right bg-white border rounded-md px-2 py-1 text-sm font-bold outline-none focus:border-rose-500 ${below ? 'border-red-400 text-red-700' : 'border-slate-300 text-slate-800'}`}
                      />
                      {c.salePrice !== undefined && (
                        <div className={`text-[11px] font-bold ${c.salePrice >= p.salePrice ? 'text-emerald-700' : 'text-rose-700'}`}>{pctText(pctChange(p.salePrice, c.salePrice))}</div>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {below
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700"><AlertTriangle className="w-3.5 h-3.5" /> Bajo el costo</span>
                        : <span className="text-xs font-semibold text-slate-600">{m === null ? '—' : `${Math.round(m)}%`}</span>}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {d && (
                        <button onClick={() => resetRow(p.id)} title="Volver al precio de hoy" className="p-1 rounded hover:bg-slate-200 text-slate-500"><RotateCcw className="w-4 h-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown && (
            <div className="text-center py-3">
              <button className="btn-secondary !py-1.5 text-sm mx-auto" onClick={() => setShown((s) => s + PAGE)}>Ver {Math.min(PAGE, rows.length - shown)} más (de {rows.length})</button>
            </div>
          )}
        </div>

        {/* Pie */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            {changedIds.length
              ? <>
                  <b className="text-slate-800">{changedIds.length} producto{changedIds.length === 1 ? '' : 's'} cambian</b>
                  {summary.up > 0 && <> · {summary.up} suben</>}
                  {summary.down > 0 && <> · {summary.down} bajan</>}
                  {summary.belowCost > 0 && <span className="text-red-700 font-bold"> · {summary.belowCost} bajo el costo</span>}
                </>
              : 'Todavía no hay cambios.'}
          </div>
          <div className="flex gap-2">
            {changedIds.length > 0 && (
              <button className="btn-secondary !py-2 text-sm" onClick={async () => { if (await confirm({ title: '¿Descartar los cambios?', message: 'Los precios vuelven a como están hoy.', confirmLabel: 'Descartar', cancelLabel: 'Volver', danger: true })) setDrafts({}); }}>Descartar cambios</button>
            )}
            <button className="btn-primary !py-2 text-sm" disabled={!changedIds.length || saving} onClick={save}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</> : <><CheckCircle2 className="w-4 h-4" /> Guardar {changedIds.length ? `${changedIds.length} precio${changedIds.length === 1 ? '' : 's'}` : ''}</>}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
