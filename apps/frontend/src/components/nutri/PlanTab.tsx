import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Plus, Trash2, Search, FileDown, Printer, MessageCircle, Pencil, Copy, Save, Wand2, X, Utensils, BookmarkPlus } from 'lucide-react';
import {
  subscribePlans, savePlan, deletePlan, subscribeCustomFoods, addCustomFood, subscribeOwnTemplates, saveOwnTemplate, deleteOwnTemplate, portalUrl,
  planTotals, mealTotals, macroSplit, proteinPerKg, itemLine, itemFromFood, household, searchFoods, scalePlan, planFromTemplate, suggestedKcal, planText, newId,
  ageOn, mifflin, totalEnergy, latest, fmt, parseNum, PLAN_TEMPLATES, FOOD_GROUPS,
  type Patient, type Consulta, type MealPlan, type PlanMeal, type PlanItem, type Food, type FoodGroup, type OwnTemplate, type Totals,
} from '../../services/nutri';
import { localNow, waPhone } from '../../services/agenda';
import { downloadPrintableAsPdf, afterPaint } from '../../utils/printToPdf';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { Modal, input, label } from '../agenda/agendaUi';
import { useConfirm } from '../common/ConfirmDialog';
import { shortDate } from './nutriUi';

type Draft = Omit<MealPlan, 'id' | 'status' | 'createdAt' | 'updatedAt'>;

const BLANK_MEALS = (): PlanMeal[] => [['Desayuno', '08:00'], ['Almuerzo', '13:00'], ['Merienda', '17:00'], ['Cena', '21:00']]
  .map(([name, time]) => ({ id: newId(), name, time, items: [] }));

const storeName = () => { try { return localStorage.getItem('gd_store_name') || ''; } catch { return ''; } };

/** Gasto total del paciente con lo último medido (null si falta algún dato) */
function energyOf(p: Patient, consultas: Consulta[]) {
  const weight = latest(consultas, 'weight') ?? p.lastWeight;
  const height = latest(consultas, 'height') ?? p.height;
  const basal = mifflin(weight, height, ageOn(p.birthDate, localNow().dateKey), p.sex);
  return { weight, get: totalEnergy(basal, p.activity) };
}

/** Pestaña "Plan alimentario" de la ficha: el plan vigente, los anteriores y el armado. */
export default function PlanTab({ storeId, p, consultas }: { storeId: string; p: Patient; consultas: Consulta[] }) {
  const [plans, setPlans] = useState<MealPlan[] | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [own, setOwn] = useState<OwnTemplate[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const [ask, askDialog] = useConfirm();
  useEffect(() => subscribePlans(storeId, p.id, setPlans), [storeId, p.id]);
  useEffect(() => subscribeCustomFoods(storeId, setFoods), [storeId]);
  useEffect(() => subscribeOwnTemplates(storeId, setOwn), [storeId]);
  const { weight, get } = energyOf(p, consultas);

  const sorted = useMemo(() => [...(plans || [])].sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0)), [plans]);
  const active = sorted.find((x) => x.status === 'active');
  const old = sorted.filter((x) => x !== active);

  if (editing) {
    return <PlanEditor storeId={storeId} p={p} weight={weight} get={get} foods={foods} planId={editing.id} initial={editing.draft} others={plans || []} onClose={() => setEditing(null)} />;
  }
  if (!plans) return <div className="py-10 flex justify-center"><span className="w-6 h-6 border-[3px] border-rose-600 border-t-transparent rounded-full animate-spin" /></div>;

  const copyOf = (x: MealPlan): Draft => ({ title: x.title, kcalTarget: x.kcalTarget, meals: x.meals.map((m) => ({ ...m, id: newId(), items: m.items.map((i) => ({ ...i, id: newId() })) })), recommendations: x.recommendations });
  const remove = async (x: MealPlan) => {
    if (!(await ask({ title: 'Borrar este plan', message: `"${x.title}" se borra y deja de verse en el link del paciente.`, confirmLabel: 'Borrar', danger: true }))) return;
    try { await deletePlan(storeId, p.id, x.id); toast.success('Plan borrado'); } catch { toast.error('No se pudo borrar'); }
  };

  return (
    <div className="space-y-3">
      {askDialog}
      {!active && (
        <div className="rounded-2xl bg-white border border-slate-200/80 p-6 text-center">
          <span className="mx-auto w-11 h-11 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center"><Utensils className="w-5 h-5" /></span>
          <p className="mt-2 text-[15px] font-bold text-slate-900">{old.length ? 'Sin plan vigente' : 'Todavía no tiene plan alimentario'}</p>
          <p className="mt-1 text-[13px] text-slate-500 max-w-md mx-auto">Elegí una plantilla, se ajusta sola a sus calorías{get ? ` (gasta unas ${get.toLocaleString('es-AR')} kcal por día)` : ''} y la terminás a mano. Se lo mandás en PDF o por WhatsApp y lo ve en su link.</p>
          <button onClick={() => setChoosing(true)} className="mt-4 h-11 px-5 rounded-xl bg-rose-600 text-white text-[14px] font-semibold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Armar plan</button>
        </div>
      )}
      {active && (
        <PlanView storeId={storeId} p={p} plan={active} weight={weight}
          onEdit={() => setEditing({ id: active.id, draft: copyOf(active) })}
          onNew={() => setChoosing(true)} onDelete={() => remove(active)} />
      )}
      {old.length > 0 && (
        <section className="rounded-2xl bg-white border border-slate-200/80">
          <p className="px-4 pt-3.5 pb-1 text-[13px] font-bold text-slate-900">Planes anteriores</p>
          {old.map((x) => {
            const t = planTotals(x);
            return (
              <div key={x.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-slate-100 first:border-t-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-slate-800 truncate">{x.title}</p>
                  <p className="text-[12px] text-slate-500">{t.kcal.toLocaleString('es-AR')} kcal{x.updatedAt?.seconds ? ` · ${shortDate(new Date(x.updatedAt.seconds * 1000).toLocaleDateString('en-CA'))}` : ''}</p>
                </div>
                <button onClick={() => setEditing({ draft: copyOf(x) })} title="Usar de base para uno nuevo" className="h-9 px-3 rounded-full bg-slate-100 text-slate-700 text-[12.5px] font-semibold inline-flex items-center gap-1"><Copy className="w-3.5 h-3.5" /> Reusar</button>
                <button onClick={() => remove(x)} title="Borrar" className="w-9 h-9 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
        </section>
      )}
      {choosing && (
        <TemplatePicker storeId={storeId} get={get} own={own} onClose={() => setChoosing(false)}
          onPick={(draft) => { setChoosing(false); setEditing({ draft }); }} />
      )}
    </div>
  );
}

// ─── Plan vigente (lectura) ───

function TotalsBar({ t, target, weight }: { t: Totals; target?: number; weight?: number }) {
  const split = macroSplit(t);
  const ppk = proteinPerKg(t, weight);
  const diff = target ? t.kcal - target : 0;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div className="rounded-xl bg-slate-50 px-3 py-2">
        <p className="text-[11.5px] text-slate-500">Calorías</p>
        <p className="text-[17px] font-bold text-slate-900 tabular-nums">{t.kcal.toLocaleString('es-AR')}<span className="text-[12px] font-semibold text-slate-400"> kcal</span></p>
        {target ? <p className={`text-[11.5px] tabular-nums ${Math.abs(diff) <= 50 ? 'text-emerald-600' : 'text-amber-600'}`}>{Math.abs(diff) <= 50 ? 'En el objetivo' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('es-AR')} del objetivo`}</p> : null}
      </div>
      {([['Proteínas', t.p, split?.p, ppk != null ? `${fmt(ppk)} g/kg` : null], ['Hidratos', t.c, split?.c, null], ['Grasas', t.f, split?.f, null]] as const).map(([name, g, pct, extra]) => (
        <div key={name} className="rounded-xl bg-slate-50 px-3 py-2">
          <p className="text-[11.5px] text-slate-500">{name}</p>
          <p className="text-[17px] font-bold text-slate-900 tabular-nums">{fmt(g, 0)}<span className="text-[12px] font-semibold text-slate-400"> g</span></p>
          <p className="text-[11.5px] text-slate-500 tabular-nums">{pct != null ? `${pct} %` : '—'}{extra ? ` · ${extra}` : ''}</p>
        </div>
      ))}
    </div>
  );
}

function PlanView({ storeId, p, plan, weight, onEdit, onNew, onDelete }: { storeId: string; p: Patient; plan: MealPlan; weight?: number; onEdit: () => void; onNew: () => void; onDelete: () => void }) {
  const mobile = useOwnerMobile().active;
  const t = planTotals(plan);
  const sheet = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const from = storeName();
  const fileName = `Plan_${p.name.replace(/\s+/g, '_')}.pdf`;
  const pdf = async () => {
    if (!sheet.current) return;
    setBusy(true);
    try { await afterPaint(); await downloadPrintableAsPdf(sheet.current, fileName); toast.success('PDF descargado'); }
    catch (err) { console.warn('[Nutri] PDF del plan', err); toast.error('No se pudo armar el PDF'); }
    finally { setBusy(false); }
  };
  const whatsapp = () => {
    const text = planText(plan, { patient: p.name, from: [p.portalToken ? `También lo ves en tu espacio: ${portalUrl(p.portalToken)}` : '', from].filter(Boolean).join('\n') });
    if (p.phone) window.open(`https://wa.me/${waPhone(p.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    else navigator.clipboard?.writeText(text).then(() => toast.success('Sin teléfono: copiamos el plan para que lo pegues'), () => toast.error('Cargale el teléfono para mandarlo'));
  };
  const btn = 'h-9 px-3 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 shrink-0';
  return (
    <section className="rounded-2xl bg-white border border-slate-200/80 p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[180px]">
          <p className="text-[11.5px] font-semibold text-emerald-700 uppercase tracking-wide">Plan vigente</p>
          <p className="text-[17px] font-bold text-slate-900">{plan.title}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={whatsapp} className={`${btn} bg-[#1FAF55] text-white`}><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</button>
          <button disabled={busy} onClick={pdf} className={`${btn} bg-slate-100 text-slate-700 disabled:opacity-60`}><FileDown className="w-3.5 h-3.5" /> {busy ? 'Armando…' : 'PDF'}</button>
          {!mobile && <button onClick={() => window.print()} className={`${btn} bg-slate-100 text-slate-700`}><Printer className="w-3.5 h-3.5" /> Imprimir</button>}
          <button onClick={onEdit} className={`${btn} bg-slate-100 text-slate-700`}><Pencil className="w-3.5 h-3.5" /> Editar</button>
          <button onClick={onNew} className={`${btn} bg-rose-600 text-white`}><Plus className="w-3.5 h-3.5" /> Nuevo</button>
          <button onClick={onDelete} title="Borrar" className="w-9 h-9 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      <TotalsBar t={t} target={plan.kcalTarget} weight={weight} />
      <div className="grid sm:grid-cols-2 gap-2.5">
        {plan.meals.filter((m) => m.items.length || m.note).map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 px-3.5 py-3">
            <p className="flex justify-between gap-2 text-[13.5px] font-bold text-slate-900">
              <span>{m.name}{m.time && <span className="font-normal text-slate-400"> · {m.time}</span>}</span>
              <span className="text-[12px] font-semibold text-slate-500 tabular-nums">{mealTotals(m).kcal} kcal</span>
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {m.items.map((i) => <li key={i.id} className="text-[13px] text-slate-700">• {itemLine(i)}</li>)}
            </ul>
            {m.note && <p className="mt-1.5 text-[12.5px] italic text-slate-500">{m.note}</p>}
          </div>
        ))}
      </div>
      {plan.recommendations && <p className="text-[13px] text-slate-600 whitespace-pre-line"><b className="text-slate-800">Recomendaciones: </b>{plan.recommendations}</p>}
      <PlanSheet ref={sheet} p={p} plan={plan} from={from} />
    </section>
  );
}

/** Hoja A4 del plan: se monta oculta en <body>, se imprime en la PC y es la que se pasa a PDF. */
const PlanSheet = forwardRef<HTMLDivElement, { p: Patient; plan: MealPlan; from: string }>(({ p, plan, from }, ref) => {
  const today = localNow().dateKey;
  return createPortal(
    <div ref={ref} id="printable-nutri-plan" className="hidden print:block" style={{ fontFamily: 'Inter, Arial, sans-serif', color: '#000', background: '#fff', padding: '8mm 10mm' }}>
      <style>{`@media print {
        html, body { height: auto !important; overflow: visible !important; }
        #root { display: none !important; }
        #printable-nutri-plan { display: block !important; }
        @page { size: A4 portrait; margin: 6mm; }
      }`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #111', paddingBottom: 10 }}>
        <div>
          <p style={{ fontSize: 22, fontWeight: 800 }}>Plan alimentario</p>
          <p style={{ fontSize: 14 }}>{p.name} · {shortDate(today)}</p>
        </div>
        {from && <p style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{from}</p>}
      </div>
      <p style={{ marginTop: 10, fontSize: 15, fontWeight: 700 }}>{plan.title}{plan.kcalTarget ? ` · ${plan.kcalTarget.toLocaleString('es-AR')} kcal` : ''}</p>
      {plan.meals.filter((m) => m.items.length || m.note).map((m) => (
        <div key={m.id} style={{ marginTop: 14, breakInside: 'avoid' }}>
          <p style={{ fontSize: 15, fontWeight: 800, borderBottom: '1px solid #ccc', paddingBottom: 3 }}>{m.name}{m.time ? ` (${m.time})` : ''}</p>
          <ul style={{ margin: '6px 0 0 0', padding: 0, listStyle: 'none' }}>
            {m.items.map((i) => <li key={i.id} style={{ fontSize: 13.5, padding: '2px 0' }}>• {itemLine(i)}</li>)}
          </ul>
          {m.note && <p style={{ fontSize: 13, fontStyle: 'italic', marginTop: 4 }}>{m.note}</p>}
        </div>
      ))}
      {plan.recommendations && (
        <div style={{ marginTop: 18, breakInside: 'avoid' }}>
          <p style={{ fontSize: 15, fontWeight: 800 }}>Recomendaciones</p>
          <p style={{ fontSize: 13.5, whiteSpace: 'pre-line', marginTop: 4 }}>{plan.recommendations}</p>
        </div>
      )}
    </div>,
    document.body,
  );
});

// ─── Elegir plantilla ───

function TemplatePicker({ storeId, get, own, onClose, onPick }: { storeId: string; get: number | null; own: OwnTemplate[]; onClose: () => void; onPick: (d: Draft) => void }) {
  const [sel, setSel] = useState<string>(PLAN_TEMPLATES[0].id);
  const ownSel = own.find((t) => `own:${t.id}` === sel);
  const defaultKcal = (id: string) => (id.startsWith('own:') ? own.find((t) => `own:${t.id}` === id)?.kcal : id === 'blank' ? undefined : suggestedKcal(id, get));
  const [kcal, setKcal] = useState(String(defaultKcal(sel) ?? ''));
  const [ask, askDialog] = useConfirm();
  const choose = (id: string) => { setSel(id); setKcal(String(defaultKcal(id) ?? '')); };
  const go = () => {
    const target = parseNum(kcal);
    if (sel === 'blank') return onPick({ title: 'Plan alimentario', kcalTarget: target, meals: BLANK_MEALS() });
    if (ownSel) {
      const base = { meals: ownSel.meals.map((m) => ({ ...m, id: newId(), items: m.items.map((i) => ({ ...i, id: newId() })) })) };
      const meals = target ? scalePlan(base, target).meals : base.meals;
      return onPick({ title: ownSel.title, kcalTarget: target, meals, recommendations: ownSel.recommendations });
    }
    onPick(planFromTemplate(sel, target));
  };
  const removeOwn = async (t: OwnTemplate) => {
    if (!(await ask({ title: 'Borrar plantilla', message: `"${t.title}" deja de aparecer para armar planes. Los planes ya hechos no cambian.`, confirmLabel: 'Borrar', danger: true }))) return;
    await deleteOwnTemplate(storeId, t.id).catch(() => toast.error('No se pudo borrar'));
    if (sel === `own:${t.id}`) choose(PLAN_TEMPLATES[0].id);
  };
  const option = (id: string, title: string, desc: string, extra?: React.ReactNode) => (
    <div key={id} role="button" tabIndex={0} onClick={() => choose(id)} onKeyDown={(e) => e.key === 'Enter' && choose(id)}
      className={`w-full text-left rounded-xl border px-3.5 py-2.5 flex items-center gap-2 cursor-pointer ${sel === id ? 'border-rose-500 bg-rose-50/60 ring-1 ring-rose-500' : 'border-slate-200 bg-white'}`}>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-slate-900">{title}</p>
        <p className="text-[12.5px] text-slate-500">{desc}</p>
      </div>
      {extra}
    </div>
  );
  return (
    <Modal title="Armar plan alimentario" onClose={onClose}
      footer={<button onClick={go} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold">Armar el plan</button>}>
      {askDialog}
      <div className="space-y-2">
        {PLAN_TEMPLATES.map((t) => option(t.id, t.title, t.description))}
        {own.length > 0 && <p className="pt-2 text-[12px] font-semibold text-slate-500 uppercase tracking-wide">Tus plantillas</p>}
        {own.map((t) => option(`own:${t.id}`, t.title, `${t.kcal.toLocaleString('es-AR')} kcal`, (
          <button onClick={(e) => { e.stopPropagation(); removeOwn(t); }} title="Borrar plantilla" className="w-8 h-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
        )))}
        {option('blank', 'En blanco', 'Las 4 comidas vacías, para armarlo de cero.')}
        {sel !== 'blank' && (
          <div className="pt-2">
            <label className={label}>Calorías por día</label>
            <input value={kcal} onChange={(e) => setKcal(e.target.value)} inputMode="numeric" placeholder="Ej.: 1800" className={input} />
            <p className="mt-1 text-[12px] text-slate-500">{get ? `Gasto estimado: ${get.toLocaleString('es-AR')} kcal (Mifflin-St Jeor × actividad). ` : 'Con peso, talla, edad, sexo y actividad cargados te sugerimos las calorías. '}Las cantidades se ajustan a lo que pongas.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Armado del plan ───

function PlanEditor({ storeId, p, weight, get, foods, planId, initial, others, onClose }: {
  storeId: string; p: Patient; weight?: number; get: number | null; foods: Food[]; planId?: string; initial: Draft; others: MealPlan[]; onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [newFood, setNewFood] = useState<{ mealId: string; name: string } | null>(null);
  const [ask, askDialog] = useConfirm();
  const t = planTotals(d);
  const setMeal = (id: string, fn: (m: PlanMeal) => PlanMeal) => setD((x) => ({ ...x, meals: x.meals.map((m) => (m.id === id ? fn(m) : m)) }));
  const setItem = (mealId: string, itemId: string, patch: Partial<PlanItem>) => setMeal(mealId, (m) => ({ ...m, items: m.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
  const target = d.kcalTarget;

  const save = async () => {
    if (!d.title.trim()) return toast.error('Ponele un nombre al plan');
    if (!d.meals.some((m) => m.items.length)) return toast.error('Agregá al menos un alimento');
    setSaving(true);
    try {
      const meals = d.meals.filter((m) => m.items.length || m.note?.trim()).map((m) => ({ ...m, name: m.name.trim() || 'Comida', note: m.note?.trim() || undefined }));
      await savePlan(storeId, p.id, { ...d, title: d.title.trim(), meals, recommendations: d.recommendations?.trim() || undefined, status: 'active' }, planId, others);
      toast.success('Plan guardado');
      onClose();
    } catch (err) { console.warn('[Nutri] No se pudo guardar el plan', err); toast.error('No se pudo guardar. Revisá la conexión.'); }
    finally { setSaving(false); }
  };
  const asTemplate = async () => {
    if (!d.meals.some((m) => m.items.length)) return toast.error('Agregá alimentos antes de guardarlo como plantilla');
    try {
      await saveOwnTemplate(storeId, { title: d.title.trim() || 'Mi plantilla', kcal: t.kcal, meals: d.meals.filter((m) => m.items.length), recommendations: d.recommendations?.trim() || undefined });
      toast.success('Guardado en tus plantillas');
    } catch { toast.error('No se pudo guardar la plantilla'); }
  };
  const cancel = async () => {
    if (JSON.stringify(d) !== JSON.stringify(initial) && !(await ask({ title: 'Salir sin guardar', message: 'Los cambios de este plan se pierden.', confirmLabel: 'Salir' }))) return;
    onClose();
  };

  return (
    <div className="space-y-3">
      {askDialog}
      <section className="rounded-2xl bg-white border border-slate-200/80 p-4 space-y-3 sticky top-0 z-10 shadow-sm">
        <div className="grid sm:grid-cols-[1fr_160px] gap-3">
          <div>
            <label className={label}>Nombre del plan</label>
            <input value={d.title} onChange={(e) => setD((x) => ({ ...x, title: e.target.value }))} maxLength={80} className={input} />
          </div>
          <div>
            <label className={label}>Objetivo (kcal/día)</label>
            <input value={target ?? ''} onChange={(e) => setD((x) => ({ ...x, kcalTarget: parseNum(e.target.value) }))} inputMode="numeric" placeholder={get ? String(get) : 'Ej.: 1800'} className={input} />
          </div>
        </div>
        <TotalsBar t={t} target={target} weight={weight} />
        {target && Math.abs(t.kcal - target) > 50 && t.kcal > 0 && (
          <button onClick={() => setD((x) => ({ ...x, ...scalePlan(x, target) }))} className="h-9 px-3.5 rounded-full bg-violet-50 text-violet-800 border border-violet-200 text-[12.5px] font-semibold inline-flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5" /> Ajustar cantidades a {target.toLocaleString('es-AR')} kcal
          </button>
        )}
      </section>

      {d.meals.map((m, idx) => (
        <section key={m.id} className="rounded-2xl bg-white border border-slate-200/80 p-3.5 space-y-2">
          <div className="flex items-center gap-2">
            <input value={m.name} onChange={(e) => setMeal(m.id, (x) => ({ ...x, name: e.target.value }))} maxLength={40} aria-label="Comida"
              className="flex-1 min-w-0 h-9 px-2 -mx-2 rounded-lg text-[15px] font-bold text-slate-900 outline-none focus:bg-slate-50" />
            <input type="time" value={m.time || ''} onChange={(e) => setMeal(m.id, (x) => ({ ...x, time: e.target.value || undefined }))} aria-label="Hora"
              className="h-9 px-2 rounded-lg bg-slate-50 border border-slate-200 text-[13px] tabular-nums" />
            <span className="text-[12.5px] font-semibold text-slate-500 tabular-nums w-16 text-right">{mealTotals(m).kcal} kcal</span>
            <button onClick={() => setD((x) => ({ ...x, meals: x.meals.filter((y) => y.id !== m.id) }))} title="Sacar esta comida" className="w-8 h-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
          {m.items.map((i) => (
            <div key={i.id} className="flex items-center gap-2 py-1 border-t border-slate-100">
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] text-slate-800 truncate">{i.name}</p>
                {i.grams > 0 && <p className="text-[11.5px] text-slate-500 truncate">{household(i) || 'sin medida casera'} · {Math.round((i.per100?.k || 0) * i.grams / 100)} kcal</p>}
              </div>
              {i.per100 ? (
                <div className="relative w-24 shrink-0">
                  <input value={i.grams ? String(i.grams) : ''} onChange={(e) => setItem(m.id, i.id, { grams: parseNum(e.target.value) || 0 })} inputMode="decimal" aria-label={`Gramos de ${i.name}`}
                    className="w-full h-9 pl-2.5 pr-7 rounded-lg bg-slate-50 border border-slate-200 text-[13.5px] tabular-nums text-right outline-none focus:border-rose-500" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11.5px] text-slate-400">g</span>
                </div>
              ) : <span className="text-[11.5px] text-slate-400 w-24 text-right shrink-0">a gusto</span>}
              <button onClick={() => setMeal(m.id, (x) => ({ ...x, items: x.items.filter((y) => y.id !== i.id) }))} title="Sacar" className="w-8 h-8 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <FoodPicker foods={foods}
            onPick={(f) => setMeal(m.id, (x) => ({ ...x, items: [...x.items, itemFromFood(f)] }))}
            onFree={(name) => setMeal(m.id, (x) => ({ ...x, items: [...x.items, { id: newId(), name, grams: 0 }] }))}
            onCreate={(name) => setNewFood({ mealId: m.id, name })} />
          <input value={m.note || ''} onChange={(e) => setMeal(m.id, (x) => ({ ...x, note: e.target.value }))} maxLength={300}
            placeholder={idx === 0 ? 'Nota (opcional). Ej.: podés cambiar el pan por 3 galletas de arroz' : 'Nota (opcional)'}
            className="w-full h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 text-[13px] outline-none focus:border-rose-500 focus:bg-white" />
        </section>
      ))}
      <button onClick={() => setD((x) => ({ ...x, meals: [...x.meals, { id: newId(), name: 'Colación', items: [] }] }))}
        className="w-full h-11 rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 text-[13.5px] font-semibold inline-flex items-center justify-center gap-1.5 hover:border-rose-400 hover:text-rose-700">
        <Plus className="w-4 h-4" /> Agregar comida
      </button>
      <section className="rounded-2xl bg-white border border-slate-200/80 p-3.5">
        <label className={label}>Recomendaciones</label>
        <textarea value={d.recommendations || ''} onChange={(e) => setD((x) => ({ ...x, recommendations: e.target.value }))} rows={3} maxLength={2000}
          placeholder="Ej.: 2 litros de agua por día; cocciones al horno o a la plancha; el aceite, en crudo"
          className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-rose-500 focus:bg-white resize-y" />
      </section>
      <div className="flex flex-wrap gap-2 pb-6">
        <button disabled={saving} onClick={save} className="flex-1 min-w-[180px] h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"><Save className="w-4 h-4" /> {saving ? 'Guardando…' : 'Guardar plan'}</button>
        <button onClick={asTemplate} className="h-12 px-4 rounded-2xl bg-slate-100 text-slate-700 text-[14px] font-semibold inline-flex items-center gap-1.5"><BookmarkPlus className="w-4 h-4" /> Guardar como plantilla</button>
        <button onClick={cancel} className="h-12 px-4 rounded-2xl text-slate-500 text-[14px] font-semibold">Cancelar</button>
      </div>
      {newFood && (
        <CustomFoodModal storeId={storeId} name={newFood.name} onClose={() => setNewFood(null)}
          onSaved={(f) => { setMeal(newFood.mealId, (x) => ({ ...x, items: [...x.items, itemFromFood(f)] })); setNewFood(null); }} />
      )}
    </div>
  );
}

/** Buscador de alimentos de la tabla (y los propios). Lo que no está, se escribe a mano o se crea. */
function FoodPicker({ foods, onPick, onFree, onCreate }: { foods: Food[]; onPick: (f: Food) => void; onFree: (name: string) => void; onCreate: (name: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => (q.trim() ? searchFoods(q, foods, 8) : []), [q, foods]);
  const done = () => { setQ(''); setOpen(false); };
  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { onPick(hits[0]); done(); } if (e.key === 'Escape') done(); }}
          placeholder="Agregar alimento (ej.: pollo, avena, banana)" className="w-full h-10 pl-9 pr-3 rounded-xl bg-white border border-dashed border-slate-300 text-[13.5px] outline-none focus:border-rose-500 focus:border-solid" />
      </div>
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {hits.map((f) => (
            <button key={f.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(f); done(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] text-slate-800 truncate">{f.name}{f.custom && <span className="ml-1.5 text-[11px] text-violet-700 font-semibold">tuyo</span>}</span>
                <span className="block text-[11.5px] text-slate-500">{f.measure} ({f.grams} g) · {f.k} kcal c/100 g</span>
              </span>
            </button>
          ))}
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { onFree(q.trim()); done(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-[13px] text-slate-600 border-t border-slate-100">
            Agregar «{q.trim()}» sin cantidad (ej.: «a gusto»)
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { onCreate(q.trim()); done(); }} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-[13px] font-semibold text-violet-700 border-t border-slate-100">
            Crear el alimento «{q.trim()}» con sus valores
          </button>
        </div>
      )}
    </div>
  );
}

/** Alimento propio del consultorio: queda para todos los planes. */
function CustomFoodModal({ storeId, name, onClose, onSaved }: { storeId: string; name: string; onClose: () => void; onSaved: (f: Food) => void }) {
  const [f, setF] = useState({ name, group: 'preparaciones' as FoodGroup, k: '', p: '', c: '', fat: '', measure: '1 porción', grams: '100' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const n = (v: string) => Number(String(v).replace(',', '.')) || 0;
  const save = async () => {
    if (!f.name.trim()) return toast.error('Escribí el nombre');
    const grams = parseNum(f.grams);
    if (!grams) return toast.error('Poné cuánto pesa la medida');
    // Si no cargó las kcal, se calculan con los macros
    const k = n(f.k) || Math.round(n(f.p) * 4 + n(f.c) * 4 + n(f.fat) * 9);
    setSaving(true);
    try { onSaved(await addCustomFood(storeId, { name: f.name, group: f.group, k, p: n(f.p), c: n(f.c), f: n(f.fat), measure: f.measure, grams })); toast.success('Alimento guardado'); }
    catch { toast.error('No se pudo guardar'); setSaving(false); }
  };
  const box = (k: keyof typeof f, text: string) => (
    <div><label className={label}>{text}</label><input value={f[k]} onChange={set(k)} inputMode="decimal" className={`${input} tabular-nums`} /></div>
  );
  return (
    <Modal title="Nuevo alimento" onClose={onClose}
      footer={<button disabled={saving} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar y agregar'}</button>}>
      <div className="space-y-3">
        <div><label className={label}>Nombre</label><input value={f.name} onChange={set('name')} maxLength={80} className={input} /></div>
        <div>
          <label className={label}>Grupo</label>
          <select value={f.group} onChange={set('group')} className={input}>{Object.entries(FOOD_GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        <p className="text-[12.5px] font-semibold text-slate-700">Valores cada 100 g</p>
        <div className="grid grid-cols-4 gap-2">{box('k', 'Kcal')}{box('p', 'Prot. g')}{box('c', 'Hidr. g')}{box('fat', 'Grasa g')}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Medida casera</label><input value={f.measure} onChange={set('measure')} maxLength={40} placeholder="1 unidad" className={input} /></div>
          {box('grams', 'Cuánto pesa (g)')}
        </div>
      </div>
    </Modal>
  );
}
