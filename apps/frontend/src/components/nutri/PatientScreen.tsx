import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, MessageCircle, Pencil, Archive, ArchiveRestore, Plus, AlertTriangle, Lock, CalendarDays, Flame, Target, StickyNote, ClipboardList,
} from 'lucide-react';
import {
  subscribePatient, subscribeConsultas, updatePatient, setPatientArchived, addAddendum, evolution, editable, byDate,
  ageOn, bmi, bmiCategory, healthyWeightRange, waistRisk, fatPctOf, sumFolds, mifflin, harrisBenedict, totalEnergy, latest, fmt, ACTIVITY, HISTORY_SECTIONS,
  type Patient, type Consulta, type ClinicalHistory,
} from '../../services/nutri';
import { fetchClientBookings, localNow, dayLabel, hhmm, waPhone, type Booking } from '../../services/agenda';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';
import { Modal, STATUS, label } from '../agenda/agendaUi';
import { useConfirm } from '../common/ConfirmDialog';
import PatientForm from './PatientForm';
import ConsultaForm from './ConsultaForm';
import EvolutionCharts from './EvolutionCharts';
import { useNutriStore, Stat, WeightDelta, TONE, SEX_LABEL, shortDate, initials, alertsOf } from './nutriUi';

type Tab = 'resumen' | 'consultas' | 'mediciones' | 'historia' | 'turnos';
const TABS: [Tab, string][] = [['resumen', 'Resumen'], ['consultas', 'Consultas'], ['mediciones', 'Mediciones'], ['historia', 'Historia clínica'], ['turnos', 'Turnos']];

/** Ficha del paciente: resumen, consultas con su evolución, mediciones con gráficos, historia clínica y turnos. */
export default function PatientScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const mobile = useOwnerMobile().active;
  const { storeId, error } = useNutriStore();
  const [p, setP] = useState<Patient | null | undefined>(undefined);
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [tab, setTab] = useState<Tab>('resumen');
  const [editing, setEditing] = useState(false);
  const [consulta, setConsulta] = useState<{ edit?: Consulta } | null>(null);
  const [ask, askDialog] = useConfirm();

  useEffect(() => { if (storeId) return subscribePatient(storeId, id, setP); }, [storeId, id]);
  useEffect(() => { if (storeId) return subscribeConsultas(storeId, id, setConsultas); }, [storeId, id]);

  const sorted = useMemo(() => [...consultas].sort(byDate), [consultas]);
  const points = useMemo(() => (p ? evolution(sorted, p) : []), [sorted, p]);

  if (error) return <p className="p-10 text-center text-[14px] text-slate-500">{error}</p>;
  if (p === undefined) return <div className="flex-1 flex items-center justify-center"><span className="w-7 h-7 border-[3px] border-rose-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (p === null) {
    return (
      <div className="p-10 text-center">
        <p className="text-[14px] text-slate-500">No encontramos este paciente.</p>
        <button onClick={() => navigate('/pacientes')} className="mt-4 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold">Ver pacientes</button>
      </div>
    );
  }

  const today = localNow().dateKey;
  const age = ageOn(p.birthDate, today);
  const subtitle = [age != null ? `${age} años` : null, p.sex ? SEX_LABEL[p.sex] : null, p.obraSocial].filter(Boolean).join(' · ') || 'Completá sus datos';
  const archive = async () => {
    if (!p.archived && !(await ask({ title: `Archivar a ${p.name}`, message: 'Deja de aparecer en la lista de pacientes activos. Su historia clínica queda guardada y la podés volver a activar cuando quieras.', confirmLabel: 'Archivar' }))) return;
    try { await setPatientArchived(storeId!, p.id, !p.archived); toast.success(p.archived ? 'Paciente activo otra vez' : 'Paciente archivado'); } catch { toast.error('No se pudo guardar'); }
  };
  const newConsulta = () => setConsulta({});

  const actions = (
    <div className="flex items-center gap-2">
      {p.phone && (
        <a href={`https://wa.me/${waPhone(p.phone)}`} target="_blank" rel="noopener" title="WhatsApp"
          className={`h-10 ${mobile ? 'w-10 bg-white/15' : 'px-3.5 bg-[#1FAF55] text-white'} rounded-full flex items-center justify-center gap-1.5 text-[13px] font-semibold`}>
          <MessageCircle className="w-4.5 h-4.5" />{!mobile && 'WhatsApp'}
        </a>
      )}
      <button onClick={() => setEditing(true)} title="Editar datos" className={`h-10 w-10 rounded-full flex items-center justify-center ${mobile ? 'bg-white/15' : 'bg-white border border-slate-200 text-slate-600'}`}><Pencil className="w-4 h-4" /></button>
      <button onClick={archive} title={p.archived ? 'Volver a activar' : 'Archivar'} className={`h-10 w-10 rounded-full flex items-center justify-center ${mobile ? 'bg-white/15' : 'bg-white border border-slate-200 text-slate-600'}`}>{p.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}</button>
    </div>
  );

  const tabs = (
    <div style={{ scrollbarWidth: 'none' }} className={`flex gap-1 overflow-x-auto overflow-y-hidden no-scrollbar ${mobile ? '' : 'shadow-[inset_0_-1px_0_#E2E8F0]'}`}>
      {TABS.map(([t, text]) => (
        <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
          className={mobile
            ? `h-9 px-3.5 rounded-full text-[13px] font-semibold shrink-0 ${tab === t ? 'bg-white text-rose-700' : 'text-white/85'}`
            : `h-10 px-3.5 text-[13.5px] font-semibold shrink-0 border-b-2 ${tab === t ? 'border-rose-600 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {text}{t === 'consultas' && consultas.length ? ` (${consultas.length})` : ''}
        </button>
      ))}
    </div>
  );

  const content = (
    <div className={`${mobile ? 'px-4 py-4 pb-24' : 'px-6 py-5 max-w-5xl w-full mx-auto'} space-y-3`}>
      {p.archived && <p className="rounded-xl bg-slate-100 text-slate-600 text-[13px] px-3 py-2.5">Paciente archivado. Su historia clínica sigue guardada.</p>}
      {tab === 'resumen' && <Summary p={p} consultas={sorted} points={points} onNew={newConsulta} onTab={setTab} />}
      {tab === 'consultas' && <Consultas storeId={storeId!} p={p} list={sorted} onNew={newConsulta} onEdit={(c) => setConsulta({ edit: c })} />}
      {tab === 'mediciones' && <Measurements p={p} points={points} onNew={newConsulta} />}
      {tab === 'historia' && <History storeId={storeId!} p={p} />}
      {tab === 'turnos' && <Turnos storeId={storeId!} p={p} />}
    </div>
  );

  const modals = (
    <>
      {askDialog}
      {editing && <PatientForm storeId={storeId!} patient={p} onClose={() => setEditing(false)} />}
      {consulta && <ConsultaForm storeId={storeId!} patient={p} consultas={consultas} editing={consulta.edit} onClose={() => setConsulta(null)} />}
    </>
  );

  if (mobile) {
    return (
      <div className="relative flex-1 min-h-0 flex flex-col">
        <ScreenHeader back title={p.name} subtitle={subtitle} action={actions}>{tabs}</ScreenHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{content}</div>
        {tab !== 'consultas' && tab !== 'historia' && (
          <button onClick={newConsulta} className="absolute right-4 bottom-4 z-20 h-12 pl-4 pr-5 rounded-full bg-rose-600 text-white text-[14px] font-bold shadow-lg inline-flex items-center gap-1.5 active:scale-95 transition-transform">
            <Plus className="w-5 h-5" /> Consulta
          </button>
        )}
        {modals}
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl w-full mx-auto px-6 pt-5">
          <button onClick={() => navigate('/pacientes')} className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="w-4 h-4" /> Pacientes</button>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="w-14 h-14 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center text-[19px] font-bold shrink-0">{initials(p.name)}</span>
            <div className="flex-1 min-w-[200px]">
              <h1 className="text-[24px] font-bold text-slate-900 tracking-tight truncate">{p.name}</h1>
              <p className="text-[13px] text-slate-500 truncate">{subtitle}{p.phone ? ` · ${p.phone}` : ''}</p>
            </div>
            {actions}
            <button onClick={newConsulta} className="h-10 px-4 rounded-full bg-rose-600 text-white text-[13.5px] font-semibold inline-flex items-center gap-1.5 shrink-0"><Plus className="w-4 h-4" /> Nueva consulta</button>
          </div>
          <div className="mt-4">{tabs}</div>
        </div>
      </div>
      {content}
      {modals}
    </div>
  );
}

function Summary({ p, consultas, points, onNew, onTab }: { p: Patient; consultas: Consulta[]; points: ReturnType<typeof evolution>; onNew: () => void; onTab: (t: Tab) => void }) {
  const today = localNow().dateKey;
  const age = ageOn(p.birthDate, today);
  const weight = latest(consultas, 'weight');
  const height = latest(consultas, 'height');
  const waist = latest(consultas, 'waist');
  const imc = bmi(weight, height);
  const cat = bmiCategory(imc, age);
  const lastFat = [...consultas].reverse().map((c) => fatPctOf(c, p.sex, ageOn(p.birthDate, c.dateKey))).find(Boolean) || null;
  const risk = waistRisk(waist, p.sex);
  const basal = mifflin(weight, height, age, p.sex);
  const hb = harrisBenedict(weight, height, age, p.sex);
  const get = totalEnergy(basal, p.activity);
  const range = healthyWeightRange(height);
  const alerts = alertsOf(p);
  const missing = [!p.sex && 'sexo', age == null && 'fecha de nacimiento', weight == null && 'peso', height == null && 'talla'].filter(Boolean) as string[];
  const toGoal = p.goalWeight != null && weight != null ? Math.round((weight - p.goalWeight) * 10) / 10 : null;

  if (!consultas.length) {
    return (
      <>
        {alerts.length > 0 && <Alerts alerts={alerts} />}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
          <ClipboardList className="w-10 h-10 text-rose-500 mx-auto" />
          <p className="mt-3 text-[16px] font-bold text-slate-900">Primera consulta</p>
          <p className="text-[13.5px] text-slate-500 mt-1 max-w-sm mx-auto">Cargá el peso, la talla y las medidas: calculamos IMC, % de grasa y calorías, y desde la segunda consulta ves la evolución en gráficos.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button onClick={onNew} className="h-11 px-5 rounded-xl bg-rose-600 text-white text-[14px] font-semibold">Cargar la consulta</button>
            <button onClick={() => onTab('historia')} className="h-11 px-5 rounded-xl bg-slate-100 text-slate-700 text-[14px] font-semibold">Completar historia clínica</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {alerts.length > 0 && <Alerts alerts={alerts} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Stat label="Peso" value={fmt(weight)} unit="kg"
          hint={p.firstWeight != null && weight != null && p.firstWeight !== weight ? <><WeightDelta from={p.firstWeight} to={weight} goalWeight={p.goalWeight} /> desde el inicio</> : p.lastVisit ? `Al ${shortDate(p.lastVisit)}` : undefined} />
        <Stat label="IMC" value={fmt(imc)} chip={cat} hint={imc == null ? 'Falta la talla' : undefined} />
        <Stat label="Grasa corporal" value={fmt(lastFat?.value)} unit="%" hint={lastFat ? (lastFat.source === 'pliegues' ? 'Por pliegues' : 'De la balanza') : 'Sin pliegues ni balanza'} />
        <Stat label="Cintura" value={fmt(waist)} unit="cm" chip={risk} hint={waist != null && !p.sex ? 'Cargá el sexo para el riesgo' : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-2.5">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 p-4">
          <EvolutionCharts points={points} goalWeight={p.goalWeight} compact />
          <button onClick={() => onTab('mediciones')} className="mt-2 text-[13px] font-semibold text-rose-700 hover:underline">Ver todas las mediciones</button>
        </div>
        <div className="space-y-2.5">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><Flame className="w-4 h-4 text-rose-600" /> Requerimiento de energía</p>
            {basal != null ? (
              <div className="mt-2 space-y-1 text-[13px]">
                <p className="flex justify-between"><span className="text-slate-500">Basal (Mifflin-St Jeor)</span><b className="tabular-nums">{basal.toLocaleString('es-AR')} kcal</b></p>
                <p className="flex justify-between"><span className="text-slate-500">Basal (Harris-Benedict)</span><span className="tabular-nums text-slate-700">{hb?.toLocaleString('es-AR')} kcal</span></p>
                {get != null ? (
                  <p className="flex justify-between pt-1 border-t border-slate-100"><span className="text-slate-500">Gasto total · {ACTIVITY[p.activity!].label.toLowerCase()}</span><b className="tabular-nums text-rose-700">{get.toLocaleString('es-AR')} kcal</b></p>
                ) : <p className="text-[12px] text-slate-400 pt-1">Cargá la actividad física en sus datos para el gasto total.</p>}
              </div>
            ) : <p className="mt-1.5 text-[12.5px] text-slate-500">Para calcularlo falta: {missing.join(', ')}.</p>}
          </div>
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><Target className="w-4 h-4 text-rose-600" /> Objetivo</p>
            <p className="mt-1.5 text-[13px] text-slate-700">{p.goal || <span className="text-slate-400">Sin objetivo cargado.</span>}</p>
            {toGoal != null && (
              <p className="mt-1 text-[12.5px] text-slate-500">{toGoal === 0 ? '¡Llegó a su peso objetivo!' : `Le ${toGoal > 0 ? 'faltan bajar' : 'faltan subir'} ${fmt(Math.abs(toGoal))} kg para ${fmt(p.goalWeight)} kg.`}</p>
            )}
            {range && <p className="mt-1 text-[12px] text-slate-400">Peso con IMC normal para su talla: {fmt(range[0])} a {fmt(range[1])} kg.</p>}
          </div>
        </div>
      </div>

      {(() => {
        const last = consultas[consultas.length - 1];
        if (!last.plan && !last.assessment) return null;
        return (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
            <p className="text-[13px] font-bold text-slate-900">Última consulta · {dayLabel(last.dateKey, true)}</p>
            {last.assessment && <p className="mt-1.5 text-[13.5px] text-slate-700 whitespace-pre-line">{last.assessment}</p>}
            {last.plan && <p className="mt-1.5 text-[13.5px] text-slate-700 whitespace-pre-line"><span className="font-semibold">Indicaciones: </span>{last.plan}</p>}
            {p.nextControl && <p className="mt-2 text-[12.5px] font-semibold text-emerald-700">Próximo control: {dayLabel(p.nextControl, true)}</p>}
          </div>
        );
      })()}
    </>
  );
}

function Alerts({ alerts }: { alerts: { label: string; text: string }[] }) {
  return (
    <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-[13px] text-amber-900 space-y-0.5">
      {alerts.map((a) => <p key={a.label} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span><b>{a.label}:</b> {a.text}</span></p>)}
    </div>
  );
}

function Consultas({ storeId, p, list, onNew, onEdit }: { storeId: string; p: Patient; list: Consulta[]; onNew: () => void; onEdit: (c: Consulta) => void }) {
  const [noteFor, setNoteFor] = useState<Consulta | null>(null);
  const desc = [...list].reverse();
  return (
    <>
      <button onClick={onNew} className="w-full h-12 rounded-2xl border-2 border-dashed border-rose-300 text-rose-700 text-[14px] font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-rose-50/50"><Plus className="w-4 h-4" /> Nueva consulta</button>
      {desc.length === 0 && <p className="py-8 text-center text-[13.5px] text-slate-400">Todavía no hay consultas.</p>}
      {desc.map((c, i) => {
        const prevW = latest(desc.slice(i + 1).reverse(), 'weight');
        const age = ageOn(p.birthDate, c.dateKey);
        const height = c.height ?? latest(desc.slice(i + 1).reverse(), 'height');
        const imc = bmi(c.weight, height);
        const fat = fatPctOf(c, p.sex, age);
        const folds = sumFolds(c.skinfolds);
        const open = editable(c);
        const chips = [
          c.weight != null && `Peso ${fmt(c.weight)} kg`, imc != null && `IMC ${fmt(imc)}`, c.waist != null && `Cintura ${fmt(c.waist)}`, c.hip != null && `Cadera ${fmt(c.hip)}`,
          c.arm != null && `Brazo ${fmt(c.arm)}`, folds != null && `Σ pliegues ${fmt(folds)} mm`, fat && `Grasa ${fmt(fat.value)} %`, c.bia?.musclePct != null && `Músculo ${fmt(c.bia.musclePct)} %`,
          c.bia?.visceral != null && `Visceral ${fmt(c.bia.visceral)}`,
        ].filter(Boolean) as string[];
        return (
          <article key={c.id} className="bg-white rounded-2xl border border-slate-200/80 p-4">
            <header className="flex items-center gap-2">
              <p className="flex-1 text-[14px] font-bold text-slate-900">{dayLabel(c.dateKey, true)}{c.first && <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">Primera consulta</span>}</p>
              {open
                ? <button onClick={() => onEdit(c)} className="h-8 px-3 rounded-full bg-slate-100 text-slate-700 text-[12.5px] font-semibold inline-flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Corregir</button>
                : <button onClick={() => setNoteFor(c)} className="h-8 px-3 rounded-full bg-slate-100 text-slate-700 text-[12.5px] font-semibold inline-flex items-center gap-1"><StickyNote className="w-3.5 h-3.5" /> Agregar nota</button>}
            </header>
            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((t) => <span key={t} className="text-[12px] px-2 py-1 rounded-full bg-slate-100 text-slate-700 tabular-nums">{t}</span>)}
                {c.weight != null && prevW != null && <span className="text-[12px] px-2 py-1 rounded-full bg-slate-50"><WeightDelta from={prevW} to={c.weight} goalWeight={p.goalWeight} /></span>}
              </div>
            )}
            {c.progress && <Block title="Cómo le fue" text={c.progress} />}
            {c.assessment && <Block title="Evaluación" text={c.assessment} />}
            {c.plan && <Block title="Indicaciones" text={c.plan} />}
            {c.nextControl && <p className="mt-2 text-[12.5px] text-slate-500">Próximo control: {dayLabel(c.nextControl, true)}</p>}
            {(c.addenda || []).map((a) => (
              <div key={a.at} className="mt-2.5 rounded-xl bg-amber-50/70 border border-amber-100 px-3 py-2">
                <p className="text-[11.5px] font-semibold text-amber-800">Nota agregada el {new Date(a.at).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                <p className="text-[13px] text-slate-700 whitespace-pre-line">{a.text}</p>
              </div>
            ))}
            {!open && <p className="mt-2 text-[11.5px] text-slate-400 inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Guardada en la historia clínica</p>}
          </article>
        );
      })}
      {noteFor && <AddendumModal storeId={storeId} patientId={p.id} consulta={noteFor} onClose={() => setNoteFor(null)} />}
    </>
  );
}

const Block = ({ title, text }: { title: string; text: string }) => (
  <div className="mt-2.5">
    <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
    <p className="text-[13.5px] text-slate-700 whitespace-pre-line">{text}</p>
  </div>
);

function AddendumModal({ storeId, patientId, consulta, onClose }: { storeId: string; patientId: string; consulta: Consulta; onClose: () => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (text.trim().length < 2) return;
    setSaving(true);
    try { await addAddendum(storeId, patientId, consulta, text); toast.success('Nota agregada'); onClose(); }
    catch { toast.error('No se pudo guardar la nota'); setSaving(false); }
  };
  return (
    <Modal title={`Nota a la consulta del ${shortDate(consulta.dateKey)}`} onClose={onClose}
      footer={<button disabled={saving || text.trim().length < 2} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold disabled:opacity-50">{saving ? 'Guardando…' : 'Agregar nota'}</button>}>
      <p className="text-[13px] text-slate-500 mb-3">La consulta ya quedó en la historia clínica y no se modifica: la nota se suma al final, con la fecha de hoy.</p>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder="Ej.: corrijo el peso: fue 78,4 kg, no 87,4"
        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-rose-500 focus:bg-white resize-y" />
    </Modal>
  );
}

function Measurements({ p, points, onNew }: { p: Patient; points: ReturnType<typeof evolution>; onNew: () => void }) {
  const rows = [...points].reverse();
  const withData = rows.filter((r) => Object.keys(r).length > 1);
  if (!withData.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
        <p className="text-[14px] text-slate-500">Todavía no hay mediciones.</p>
        <button onClick={onNew} className="mt-3 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-semibold">Cargar una consulta</button>
      </div>
    );
  }
  const cols: [keyof (typeof rows)[number], string][] = [['weight', 'Peso'], ['bmi', 'IMC'], ['waist', 'Cintura'], ['hip', 'Cadera'], ['fatPct', '% grasa'], ['sumFolds', 'Σ pliegues'], ['muscle', '% músculo']];
  const used = cols.filter(([k]) => withData.some((r) => r[k] != null));
  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
        <EvolutionCharts points={points} goalWeight={p.goalWeight} />
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/80 overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="text-left text-[11.5px] font-semibold text-slate-500 border-b border-slate-100">
              <th className="px-4 py-2.5 font-semibold">Fecha</th>
              {used.map(([k, t]) => <th key={k} className="px-3 py-2.5 font-semibold text-right">{t}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {withData.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2.5 text-slate-700">{shortDate(r.dateKey)}</td>
                {used.map(([k]) => <td key={k} className="px-3 py-2.5 text-right text-slate-800">{fmt(r[k] as number | undefined)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function History({ storeId, p }: { storeId: string; p: Patient }) {
  const [h, setH] = useState<ClinicalHistory>(p.history || {});
  const [saving, setSaving] = useState(false);
  // Si cambia desde otro equipo y acá no se tocó nada, se muestra lo nuevo
  const saved = JSON.stringify(p.history || {});
  const [base, setBase] = useState(saved);
  useEffect(() => { if (JSON.stringify(h) === base) { setH(p.history || {}); setBase(saved); } }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(h) !== base;

  const save = async () => {
    setSaving(true);
    const clean = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, (v || '').trim()]).filter(([, v]) => v)) as ClinicalHistory;
    try { await updatePatient(storeId, p, { history: clean }); setBase(JSON.stringify(clean)); setH(clean); toast.success('Historia clínica guardada'); }
    catch { toast.error('No se pudo guardar. Revisá la conexión.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {HISTORY_SECTIONS.map((s) => (
        <section key={s.title} className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3">
          <p className="text-[14px] font-bold text-slate-900">{s.title}</p>
          <div className={s.fields.length > 2 ? 'grid sm:grid-cols-2 gap-3' : 'space-y-3'}>
            {s.fields.map((fl) => (
              <div key={fl.key} className={fl.key === 'eating' || fl.key === 'reason' ? 'sm:col-span-2' : ''}>
                <label className={label}>{fl.label}</label>
                <textarea value={h[fl.key] || ''} onChange={(e) => setH((x) => ({ ...x, [fl.key]: e.target.value }))} maxLength={4000}
                  rows={fl.key === 'eating' ? 5 : 2} placeholder={fl.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-rose-500 focus:bg-white resize-y" />
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className={`sticky bottom-3 ${dirty ? '' : 'hidden'}`}>
        <button disabled={saving} onClick={save} className="w-full h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold shadow-lg disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar historia clínica'}</button>
      </div>
    </div>
  );
}

function Turnos({ storeId, p }: { storeId: string; p: Patient }) {
  const navigate = useNavigate();
  const [list, setList] = useState<Booking[] | null>(null);
  useEffect(() => {
    if (!p.agendaKey) { setList([]); return; }
    fetchClientBookings(storeId, p.agendaKey, p.name).then(setList).catch(() => setList([]));
  }, [storeId, p.agendaKey, p.name]);
  const today = localNow().dateKey;
  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
        {list === null ? <p className="px-4 py-8 text-center text-[13px] text-slate-400">Cargando…</p>
          : list.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-slate-400">{p.phone ? 'No tiene turnos en la agenda.' : 'Sin turnos. Con el teléfono cargado se cruzan solos los turnos que reserve.'}</p>
          : list.map((b) => {
            const st = b.payment ? { label: `Cobrado ${money(b.payment.amount)}`, cls: TONE.ok } : STATUS[b.status];
            return (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                <CalendarDays className={`w-4 h-4 shrink-0 ${b.dateKey >= today && (b.status === 'PENDING' || b.status === 'CONFIRMED') ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-semibold text-slate-800 truncate">{b.serviceName}</span>
                  <span className="block text-[12px] text-slate-500">{dayLabel(b.dateKey, true)} · {hhmm(b.startMin)}</span>
                </span>
                <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ring-1 ring-inset shrink-0 ${st.cls}`}>{st.label}</span>
              </div>
            );
          })}
      </div>
      <button onClick={() => navigate('/agenda')} className="h-11 px-4 rounded-xl bg-slate-100 text-slate-700 text-[13.5px] font-semibold">Ir a la agenda</button>
    </>
  );
}
