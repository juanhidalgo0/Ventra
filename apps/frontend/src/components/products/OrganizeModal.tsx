import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Undo2, Loader2, CheckCircle2, AlertTriangle, Sparkles, Pause } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useConfirm } from '../common/ConfirmDialog';
import { rubrosTitle, useBusinessStore } from '../../stores/businessStore';

/**
 * Organizar automáticamente: la IA sugiere categoría, subcategoría y marca de cada producto
 * (ver backend modules/ai/organize.service). Se procesa de a 100, se muestra todo en una vista previa
 * para destildar lo que no convence, y recién al "Guardar" se cambia; después se puede deshacer.
 */

interface CatSug { id: string | null; name: string; parent: string | null; isNew: boolean }
interface BrandSug { id: string | null; name: string; isNew: boolean }
interface Proposal { id: string; name: string; sure: boolean; before: { category: string | null; brand: string | null }; category: CatSug | null; brand: BrandSug | null }
interface Status { total: number; noCategory: number; noBrand: number; missing: number; categories: number; brands: number; last: LastBatch | null }
interface LastBatch { id: string; createdAt: number; userName: string | null; label: string; count: number }
type Step = 'start' | 'running' | 'review' | 'saved';
type View = 'all' | 'doubt' | 'new';

const BATCH = 100;
const PARALLEL = 2;
const PAGE = 150;
const n = (x: number) => x.toLocaleString('es-AR');
const catText = (c: CatSug) => (c.parent ? `${c.parent} › ${c.name}` : c.name);
const chip = (on: boolean) =>
  `px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors ${on ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'}`;

export default function OrganizeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const profiles = useBusinessStore((s) => s.profiles);
  const rubro = rubrosTitle(profiles);

  const [step, setStep] = useState<Step>('start');
  const [status, setStatus] = useState<Status | null>(null);
  const [scope, setScope] = useState<'missing' | 'all'>('missing');
  const [progress, setProgress] = useState({ done: 0, total: 0, phase: '' });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stopNote, setStopNote] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [useCats, setUseCats] = useState(true);
  const [useBrands, setUseBrands] = useState(true);
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ updated: number; newCategories: number; newBrands: number; batchId: string | null } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const stopRef = useRef(false);

  const loadStatus = () => api.get('/ai/organize/status').then(({ data }) => {
    setStatus(data);
    if (!data.missing && data.total) setScope('all');
  }).catch(() => {});
  useEffect(() => { loadStatus(); }, []);

  // ─────────────────────────────── recorrer el catálogo de a 100
  const run = async () => {
    stopRef.current = false;
    setStopNote('');
    setProposals([]);
    setChecked({});
    setStep('running');
    setProgress({ done: 0, total: 0, phase: 'Mirando tu catálogo y armando las categorías…' });
    let plan: { ids: string[]; tree: any[] };
    try {
      const { data } = await api.post('/ai/organize/plan', { scope, rubro }, { timeout: 150000 } as any);
      plan = data;
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo empezar. Probá de nuevo.');
      setStep('start');
      return;
    }
    if (!plan.ids.length) { toast.success('No hay productos para organizar.'); setStep('start'); return; }
    const chunks: string[][] = [];
    for (let k = 0; k < plan.ids.length; k += BATCH) chunks.push(plan.ids.slice(k, k + BATCH));
    setProgress({ done: 0, total: plan.ids.length, phase: '' });

    const newBrands = new Set<string>();
    let done = 0;
    let next = 0;
    let stopped = '';
    const one = async (ids: string[]) => {
      let tries = 0;
      for (;;) {
        try {
          const { data } = await api.post('/ai/organize/batch', { ids, tree: plan.tree, scope, rubro, extraBrands: [...newBrands] }, { timeout: 180000, silent: true } as any);
          const list: Proposal[] = data.proposals || [];
          for (const p of list) if (p.brand?.isNew) newBrands.add(p.brand.name);
          setProposals((prev) => [...prev, ...list]);
          setChecked((prev) => { const c = { ...prev }; for (const p of list) c[p.id] = p.sure; return c; });
          return;
        } catch (e: any) {
          const st = e?.response?.status;
          const msg = e?.response?.data?.message;
          // Tope de IA o PC sin vincular: no tiene sentido seguir
          if (st === 429 || st === 400 || st === 409 || ++tries >= 2) { stopped = msg || 'La IA no respondió. Lo que ya se ordenó está abajo.'; stopRef.current = true; return; }
        }
      }
    };
    // La primera tanda sola (para que las marcas nuevas sirvan a las siguientes), después de a dos
    const worker = async () => {
      while (!stopRef.current && next < chunks.length) {
        const ids = chunks[next++];
        await one(ids);
        done += ids.length;
        setProgress((p) => ({ ...p, done: Math.min(done, p.total) }));
      }
    };
    if (chunks.length) { next = 1; await one(chunks[0]); done += chunks[0].length; setProgress((p) => ({ ...p, done })); }
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (stopped) setStopNote(stopped);
    else if (stopRef.current) setStopNote(`Pausaste a los ${n(done)} productos. Podés guardar esto y volver a organizar el resto después.`);
    setStep('review');
  };

  // ─────────────────────────────── vista previa
  const rows = useMemo(() => {
    const words = search.trim().toUpperCase().split(/\s+/).filter(Boolean);
    return proposals.filter((p) => {
      if (!useCats && !p.brand) return false;
      if (!useBrands && !p.category) return false;
      if (view === 'doubt' && p.sure) return false;
      if (view === 'new' && !(p.category?.isNew || p.brand?.isNew)) return false;
      const hay = `${p.name} ${p.category ? catText(p.category) : ''} ${p.brand?.name || ''}`.toUpperCase();
      return words.every((w) => hay.includes(w));
    });
  }, [proposals, view, search, useCats, useBrands]);
  const chosen = useMemo(() => proposals.filter((p) => checked[p.id] && ((useCats && p.category) || (useBrands && p.brand))), [proposals, checked, useCats, useBrands]);
  const doubts = proposals.filter((p) => !p.sure).length;
  const newOnes = useMemo(() => {
    const cats = new Map<string, number>(); const brands = new Map<string, number>();
    for (const p of chosen) {
      if (useCats && p.category?.isNew) { const k = catText(p.category); cats.set(k, (cats.get(k) || 0) + 1); }
      if (useBrands && p.brand?.isNew) brands.set(p.brand.name, (brands.get(p.brand.name) || 0) + 1);
    }
    return { cats: [...cats.entries()].sort((a, b) => b[1] - a[1]), brands: [...brands.entries()].sort((a, b) => b[1] - a[1]) };
  }, [chosen, useCats, useBrands]);

  const setAllVisible = (on: boolean) => setChecked((prev) => { const c = { ...prev }; for (const p of rows) c[p.id] = on; return c; });

  const save = async () => {
    if (!chosen.length) return;
    setSaving(true);
    try {
      const items = chosen.map((p) => ({
        id: p.id,
        category: useCats && p.category ? { name: p.category.name, parent: p.category.parent } : null,
        brand: useBrands && p.brand ? { name: p.brand.name } : null,
      }));
      const { data } = await api.post('/ai/organize/apply', { items, label: `Organizar automáticamente: ${items.length} productos` }, { timeout: 300000 } as any);
      setSaved(data);
      setStep('saved');
      onSaved();
      loadStatus();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo guardar. No se cambió nada.');
    } finally {
      setSaving(false);
    }
  };

  const undo = async (batch: { id: string; count: number }) => {
    if (!(await confirm({ title: '¿Deshacer el último orden?', message: `Los ${n(batch.count)} productos vuelven a la categoría y marca que tenían. Las categorías y marcas nuevas que queden vacías se borran.`, confirmLabel: 'Deshacer', cancelLabel: 'Volver' }))) return;
    setUndoing(true);
    try {
      const { data } = await api.post(`/ai/organize/undo/${batch.id}`);
      toast.success(`Listo: ${n(data.restored)} productos volvieron a como estaban.`);
      if (data.skipped?.length) toast(`${data.skipped.length} no se tocaron porque alguien los cambió después.`, { icon: 'ℹ️' });
      onSaved();
      setSaved(null);
      setStep('start');
      loadStatus();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo deshacer.');
    } finally {
      setUndoing(false);
    }
  };

  const close = async () => {
    if (step === 'running') {
      if (!(await confirm({ title: '¿Cortar acá?', message: 'Se deja de organizar. Lo que ya ordenó la IA no se guarda.', confirmLabel: 'Cortar y salir', cancelLabel: 'Seguir', danger: true }))) return;
      stopRef.current = true;
    }
    if (step === 'review' && chosen.length) {
      if (!(await confirm({ title: '¿Salir sin guardar?', message: 'Los cambios sugeridos no se guardan.', confirmLabel: 'Salir sin guardar', cancelLabel: 'Volver', danger: true }))) return;
    }
    onClose();
  };

  // ─────────────────────────────── pantallas chicas: inicio, progreso y guardado
  if (step !== 'review') {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-xl"><Sparkles className="w-5 h-5 stroke-[2.5]" /></div>
              <h2 className="text-base font-bold text-slate-800">Organizar automáticamente</h2>
            </div>
            <button onClick={close} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700" aria-label="Cerrar"><X className="w-5 h-5" /></button>
          </div>

          {step === 'start' && (
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-600">La IA lee el nombre de cada producto y te sugiere su <b>categoría</b>, <b>subcategoría</b> y <b>marca</b>, usando las que ya tenés. Antes de guardar ves todo y destildás lo que no te convence.</p>
              {!status ? (
                <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-rose-500" /></div>
              ) : (
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${scope === 'missing' ? 'border-rose-400 bg-rose-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="radio" className="mt-1 accent-rose-600" checked={scope === 'missing'} onChange={() => setScope('missing')} disabled={!status.missing} />
                    <div>
                      <div className="text-sm font-bold text-slate-800">Solo los que les falta algo ({n(status.missing)})</div>
                      <div className="text-xs text-slate-500">{n(status.noCategory)} sin categoría · {n(status.noBrand)} sin marca. Lo que ya está cargado no se toca.</div>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${scope === 'all' ? 'border-rose-400 bg-rose-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="radio" className="mt-1 accent-rose-600" checked={scope === 'all'} onChange={() => setScope('all')} />
                    <div>
                      <div className="text-sm font-bold text-slate-800">Reorganizar todo ({n(status.total)})</div>
                      <div className="text-xs text-slate-500">También revisa los que ya tienen categoría o marca y te propone corregirlos.</div>
                    </div>
                  </label>
                  {(scope === 'all' ? status.total : status.missing) > 1000 && (
                    <p className="text-xs text-slate-500">Son muchos productos: tarda unos {Math.ceil((scope === 'all' ? status.total : status.missing) / 900)} minutos. Podés pausar cuando quieras y guardar lo que haya.</p>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2 pt-1">
                <button className="btn-primary" disabled={!status || !(scope === 'all' ? status.total : status.missing)} onClick={run}><Sparkles className="w-4 h-4" /> Organizar</button>
                {status?.last && (
                  <button className="btn-secondary" disabled={undoing} onClick={() => undo(status.last!)} title={status.last.label}>
                    {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Deshacer el último orden ({n(status.last.count)} productos)
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'running' && (
            <div className="p-6 space-y-4 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-rose-500 mx-auto" />
              <div>
                <div className="text-base font-bold text-slate-800">{progress.total ? `Ordenando ${n(progress.done)} de ${n(progress.total)}…` : progress.phase}</div>
                <div className="text-xs text-slate-500 mt-1">{n(proposals.length)} cambios sugeridos hasta ahora. Nada se guarda todavía.</div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-rose-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <button className="btn-secondary mx-auto" disabled={!progress.total} onClick={() => { stopRef.current = true; }}>
                <Pause className="w-4 h-4" /> Pausar y ver lo que hay
              </button>
            </div>
          )}

          {step === 'saved' && saved && (
            <div className="p-6 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
              <div>
                <h3 className="text-lg font-bold text-slate-800">Se organizaron {n(saved.updated)} productos</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {saved.newCategories > 0 && <>{n(saved.newCategories)} categorías nuevas. </>}
                  {saved.newBrands > 0 && <>{n(saved.newBrands)} marcas nuevas. </>}
                  Si algo no te gusta, lo podés deshacer.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button className="btn-primary" onClick={onClose}>Listo</button>
                {saved.batchId && (
                  <button className="btn-secondary" disabled={undoing} onClick={() => undo({ id: saved.batchId!, count: saved.updated })}>
                    {undoing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />} Deshacer
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {confirmDialog}
      </div>
    );
  }

  // ─────────────────────────────── vista previa
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-6xl h-[94vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 bg-rose-100 text-rose-700 rounded-xl"><Sparkles className="w-5 h-5 stroke-[2.5]" /></div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-800">Organizar automáticamente</h2>
              <p className="text-xs text-slate-500 truncate">Revisá lo que sugiere la IA. Lo tildado se guarda; lo dudoso viene sin tildar. Nada cambia hasta "Guardar".</p>
            </div>
          </div>
          <button onClick={close} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>

        {stopNote && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-xs font-semibold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {stopNote}
          </div>
        )}

        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }} placeholder="Buscar (ej: gaseosas, arcor)" className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-2.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-rose-500" />
          </div>
          <button className={chip(view === 'all')} onClick={() => { setView('all'); setShown(PAGE); }}>Todos ({n(proposals.length)})</button>
          <button className={chip(view === 'doubt')} onClick={() => { setView('doubt'); setShown(PAGE); }}>Para revisar ({n(doubts)})</button>
          <button className={chip(view === 'new')} onClick={() => { setView('new'); setShown(PAGE); }}>Con algo nuevo</button>
          <span className="w-px h-6 bg-slate-200 mx-1" />
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer"><input type="checkbox" className="accent-rose-600" checked={useCats} onChange={(e) => setUseCats(e.target.checked)} /> Categorías</label>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer"><input type="checkbox" className="accent-rose-600" checked={useBrands} onChange={(e) => setUseBrands(e.target.checked)} /> Marcas</label>
        </div>

        {(newOnes.cats.length > 0 || newOnes.brands.length > 0) && (
          <div className="px-5 py-2 border-b border-slate-200 bg-slate-50 text-[11px] text-slate-600 space-y-1 max-h-24 overflow-y-auto">
            {newOnes.cats.length > 0 && <div><b className="text-slate-800">Categorías nuevas:</b> {newOnes.cats.map(([k, c]) => `${k} (${c})`).join(' · ')}</div>}
            {newOnes.brands.length > 0 && <div><b className="text-slate-800">Marcas nuevas:</b> {newOnes.brands.slice(0, 60).map(([k, c]) => `${k} (${c})`).join(' · ')}{newOnes.brands.length > 60 ? ` y ${newOnes.brands.length - 60} más` : ''}</div>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {!proposals.length ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mb-2" />
              <div className="font-bold text-slate-700">No hay nada para cambiar</div>
              <div className="text-sm">Tus productos ya están ordenados como sugiere la IA.</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b border-slate-200 z-10">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-2 pl-5 w-10">
                    <input type="checkbox" className="accent-rose-600" checked={rows.length > 0 && rows.every((p) => checked[p.id])} onChange={(e) => setAllVisible(e.target.checked)} title="Tildar o destildar los que se ven" />
                  </th>
                  <th className="py-2">Producto</th>
                  <th className="py-2">Hoy</th>
                  <th className="py-2 pr-5">Sugerido</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((p) => (
                  <tr key={p.id} className={`border-b border-slate-100 ${checked[p.id] ? '' : 'opacity-60'} hover:bg-slate-50 cursor-pointer`} onClick={() => setChecked((c) => ({ ...c, [p.id]: !c[p.id] }))}>
                    <td className="py-2 pl-5"><input type="checkbox" className="accent-rose-600" checked={!!checked[p.id]} readOnly /></td>
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-slate-800 text-xs">{p.name}</div>
                      {!p.sure && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700"><AlertTriangle className="w-3 h-3" /> Revisar</span>}
                    </td>
                    <td className="py-2 pr-3 text-[11px] text-slate-500">
                      <div>{p.before.category || 'Sin categoría'}</div>
                      <div>{p.before.brand || 'Sin marca'}</div>
                    </td>
                    <td className="py-2 pr-5 text-xs">
                      {p.category && (
                        <div className={useCats ? 'text-slate-800 font-semibold' : 'text-slate-400 line-through'}>
                          {catText(p.category)} {p.category.isNew && <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">nueva</span>}
                        </div>
                      )}
                      {p.brand && (
                        <div className={useBrands ? 'text-slate-600' : 'text-slate-400 line-through'}>
                          Marca: {p.brand.name} {p.brand.isNew && <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">nueva</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > shown && (
            <div className="text-center py-3">
              <button className="btn-secondary !py-1.5 text-sm mx-auto" onClick={() => setShown((s) => s + PAGE)}>Ver {Math.min(PAGE, rows.length - shown)} más (de {n(rows.length)})</button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-600">
            <b className="text-slate-800">{n(chosen.length)} de {n(proposals.length)} tildados</b>
            {doubts > 0 && <> · {n(doubts)} para revisar</>}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary !py-2 text-sm" onClick={() => setStep('start')}>Volver a empezar</button>
            <button className="btn-primary !py-2 text-sm" disabled={!chosen.length || saving} onClick={save}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</> : <><CheckCircle2 className="w-4 h-4" /> Guardar {n(chosen.length)} cambios</>}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
