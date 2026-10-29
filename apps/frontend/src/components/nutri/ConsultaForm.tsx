import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, Lock } from 'lucide-react';
import {
  createConsulta, updateConsulta, deleteConsulta, parseNum, bmi, bmiCategory, waistHipRatio, waistRisk, fatPctOf, sumFolds, ageOn, latest, byDate, fmt,
  defaultCoverage, hasObraSocial, activePack,
  type Patient, type Consulta, type Measures, type Coverage,
} from '../../services/nutri';
import { localNow, addDays } from '../../services/agendaCore';
import { Modal, input, label } from '../agenda/agendaUi';
import { useConfirm } from '../common/ConfirmDialog';
import { TONE, WeightDelta, shortDate } from './nutriUi';

type Num = string;
const str = (n?: number) => (n == null ? '' : String(n).replace('.', ','));

/**
 * Cargar (o corregir, dentro de las 24 h) una consulta: lo que se midió, con IMC, % de grasa y
 * riesgo por cintura calculados en el momento, y la evolución escrita.
 */
export default function ConsultaForm({ storeId, patient: p, consultas, editing, onClose }: {
  storeId: string; patient: Patient; consultas: Consulta[]; editing?: Consulta; onClose: () => void;
}) {
  const today = localNow().dateKey;
  const others = useMemo(() => consultas.filter((c) => c.id !== editing?.id).sort(byDate), [consultas, editing?.id]);
  const prev = useMemo(() => [...others].reverse().find((c) => c.dateKey <= (editing?.dateKey || today)), [others, editing?.dateKey, today]);
  const e = editing;
  const [f, setF] = useState({
    dateKey: e?.dateKey || today,
    first: e ? !!e.first : others.length === 0,
    weight: str(e?.weight) as Num,
    // La altura casi nunca cambia en un adulto: viene la última medida
    height: str(e ? e.height : latest(others, 'height')) as Num,
    waist: str(e?.waist), hip: str(e?.hip), arm: str(e?.arm),
    biceps: str(e?.skinfolds?.biceps), triceps: str(e?.skinfolds?.triceps), subscapular: str(e?.skinfolds?.subscapular), suprailiac: str(e?.skinfolds?.suprailiac),
    fatPct: str(e?.bia?.fatPct), musclePct: str(e?.bia?.musclePct), visceral: str(e?.bia?.visceral),
    progress: e?.progress || '', assessment: e?.assessment || '', plan: e?.plan || '', nextControl: e?.nextControl || '',
  });
  // Si alguna vez se midió, se abre solo: la nutricionista que usa pliegues o balanza los usa siempre
  const [openFolds, setOpenFolds] = useState([e, ...others].some((c) => c?.skinfolds && Object.keys(c.skinfolds).length));
  const [openBia, setOpenBia] = useState([e, ...others].some((c) => c?.bia && Object.keys(c.bia).length));
  // Cómo se cubre: al cargarla se propone el pack con sesiones, la obra social o particular
  const [coverage, setCoverage] = useState<Coverage>(() => e ? (e.coverage || { type: 'particular' }) : defaultCoverage(p));
  const pack = activePack(p);
  const coverageOptions: { key: string; text: string; value: Coverage }[] = [
    { key: 'particular', text: 'Particular', value: { type: 'particular' } },
    ...(hasObraSocial(p) ? [{ key: 'os', text: p.obraSocial!.trim(), value: defaultCoverage({ obraSocial: p.obraSocial, obraSocialNumber: p.obraSocialNumber, obraSocialPlan: p.obraSocialPlan }) }] : []),
    ...(pack ? [{ key: 'pack', text: `${pack.name} (${pack.sessions - pack.used} libres)`, value: { type: 'pack', packId: pack.id, packName: pack.name } as Coverage }] : []),
  ];
  // Al corregir una consulta de pack, el pack sigue siendo una opción aunque ya no tenga sesiones libres
  if (e?.coverage?.type === 'pack' && !coverageOptions.some((o) => o.key === 'pack')) coverageOptions.push({ key: 'pack', text: e.coverage.packName, value: e.coverage });
  const coverageKey = coverage.type === 'particular' ? 'particular' : coverage.type === 'pack' ? 'pack' : 'os';
  const [saving, setSaving] = useState(false);
  const [ask, askDialog] = useConfirm();
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) => setF((x) => ({ ...x, [k]: ev.target.value }));

  const measures: Measures = {
    weight: parseNum(f.weight), height: parseNum(f.height), waist: parseNum(f.waist), hip: parseNum(f.hip), arm: parseNum(f.arm),
    skinfolds: { biceps: parseNum(f.biceps), triceps: parseNum(f.triceps), subscapular: parseNum(f.subscapular), suprailiac: parseNum(f.suprailiac) },
    bia: { fatPct: parseNum(f.fatPct), musclePct: parseNum(f.musclePct), visceral: parseNum(f.visceral) },
  };
  const age = ageOn(p.birthDate, f.dateKey);
  const imc = bmi(measures.weight, measures.height);
  const imcCat = bmiCategory(imc, age);
  const icc = waistHipRatio(measures.waist, measures.hip);
  const risk = waistRisk(measures.waist, p.sex);
  const fat = fatPctOf(measures, p.sex, age);
  const folds = sumFolds(measures.skinfolds);
  const foldsCount = [measures.skinfolds?.biceps, measures.skinfolds?.triceps, measures.skinfolds?.subscapular, measures.skinfolds?.suprailiac].filter((x) => x != null).length;
  const prevWeight = prev ? latest(others.filter((c) => c.dateKey <= f.dateKey), 'weight') : undefined;

  const save = async () => {
    if (!f.dateKey) return toast.error('Elegí la fecha de la consulta');
    if (f.dateKey > today) return toast.error('La fecha de la consulta no puede ser futura');
    const data = {
      dateKey: f.dateKey,
      first: f.first || undefined,
      ...measures,
      progress: f.first ? undefined : f.progress.trim() || undefined,
      assessment: f.assessment.trim() || undefined,
      plan: f.plan.trim() || undefined,
      nextControl: f.nextControl || undefined,
      coverage,
    };
    if (!Object.values(measures).some((v) => v != null && (typeof v !== 'object' || Object.values(v).some((x) => x != null))) && !data.assessment && !data.plan && !data.progress) {
      return toast.error('Cargá alguna medida o escribí la evolución');
    }
    setSaving(true);
    try {
      if (e) await updateConsulta(storeId, p.id, e.id, data, e);
      else await createConsulta(storeId, p.id, data);
      toast.success(e ? 'Consulta corregida' : 'Consulta guardada');
      onClose();
    } catch (err: any) {
      console.warn('[Nutri] No se pudo guardar la consulta', err);
      toast.error(err?.code === 'permission-denied' ? 'Pasaron más de 24 h: ya no se puede corregir. Agregale una nota.' : 'No se pudo guardar. Revisá la conexión.');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!e || !(await ask({ title: 'Borrar esta consulta', message: 'Se borra con sus mediciones. Solo se puede durante las primeras 24 h.', confirmLabel: 'Borrar', danger: true }))) return;
    setSaving(true);
    try { await deleteConsulta(storeId, p.id, e); toast.success('Consulta borrada'); onClose(); }
    catch { toast.error('No se pudo borrar'); setSaving(false); }
  };

  const num = (k: keyof typeof f, text: string, unit: string, ph = '') => (
    <div className="min-w-0">
      <label className={label}>{text}</label>
      <div className="relative">
        <input value={f[k] as string} onChange={set(k)} inputMode="decimal" placeholder={ph} className={`${input} pr-10 tabular-nums`} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-slate-400 pointer-events-none">{unit}</span>
      </div>
    </div>
  );
  const nextIn = (days: number) => setF((x) => ({ ...x, nextControl: addDays(x.dateKey || today, days) }));

  return (
    <Modal title={e ? 'Corregir consulta' : 'Nueva consulta'} onClose={onClose}
      footer={(
        <div className="flex gap-2">
          {e && <button disabled={saving} onClick={remove} className="h-12 px-4 rounded-2xl bg-red-50 text-red-700 text-[14px] font-semibold disabled:opacity-60">Borrar</button>}
          <button disabled={saving} onClick={save} className="flex-1 h-12 rounded-2xl bg-rose-600 text-white text-[15px] font-bold disabled:opacity-60">{saving ? 'Guardando…' : 'Guardar consulta'}</button>
        </div>
      )}>
      {askDialog}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className={label}>Fecha</label>
            <input type="date" value={f.dateKey} max={today} onChange={set('dateKey')} className={input} />
          </div>
          <label className="h-11 flex items-center gap-2.5 px-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input type="checkbox" checked={f.first} onChange={(ev) => setF((x) => ({ ...x, first: ev.target.checked }))} className="w-4 h-4 accent-rose-600" />
            <span className="text-[13.5px] font-medium text-slate-700">Primera consulta</span>
          </label>
        </div>

        <section className="rounded-2xl border border-slate-200 p-3.5 space-y-3">
          <p className="text-[13px] font-bold text-slate-900">Mediciones</p>
          <div className="grid grid-cols-2 gap-3">
            {num('weight', 'Peso', 'kg', prevWeight != null ? `Antes ${fmt(prevWeight)}` : '')}
            {num('height', 'Talla', 'cm')}
            {num('waist', 'Cintura', 'cm')}
            {num('hip', 'Cadera', 'cm')}
            {num('arm', 'Brazo relajado', 'cm')}
          </div>

          {(imc != null || icc != null || risk || (measures.weight != null && prevWeight != null)) && (
            <div className="flex flex-wrap gap-1.5">
              {measures.weight != null && prevWeight != null && (
                <span className="text-[12px] px-2 py-1 rounded-full bg-slate-100 text-slate-700">Desde {shortDate(prev?.dateKey)}: <WeightDelta from={prevWeight} to={measures.weight} goalWeight={p.goalWeight} /></span>
              )}
              {imc != null && <span className={`text-[12px] font-semibold px-2 py-1 rounded-full ring-1 ring-inset ${TONE[imcCat?.tone || 'info']}`}>IMC {fmt(imc)}{imcCat ? ` · ${imcCat.label}` : ''}</span>}
              {icc != null && <span className="text-[12px] font-semibold px-2 py-1 rounded-full bg-slate-100 text-slate-700">Cintura/cadera {fmt(icc, 2)}</span>}
              {risk && <span className={`text-[12px] font-semibold px-2 py-1 rounded-full ring-1 ring-inset ${TONE[risk.tone]}`}>{risk.label}</span>}
            </div>
          )}

          <button type="button" onClick={() => setOpenFolds((v) => !v)} className="w-full flex items-center justify-between text-[13px] font-semibold text-slate-700 pt-1">
            <span>Pliegues cutáneos {folds != null && <span className="font-normal text-slate-500">· Σ {fmt(folds)} mm</span>}</span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openFolds ? 'rotate-180' : ''}`} />
          </button>
          {openFolds && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {num('biceps', 'Bicipital', 'mm')}
                {num('triceps', 'Tricipital', 'mm')}
                {num('subscapular', 'Subescapular', 'mm')}
                {num('suprailiac', 'Suprailíaco', 'mm')}
              </div>
              {foldsCount > 0 && foldsCount < 4 && <p className="text-[12px] text-slate-500">Con los 4 pliegues se calcula el % de grasa (Durnin y Womersley).</p>}
              {foldsCount === 4 && fat?.source !== 'pliegues' && (
                <p className="text-[12px] text-amber-700">Para el % de grasa faltan {!p.sex ? 'el sexo' : ''}{!p.sex && age == null ? ' y ' : ''}{age == null ? 'la fecha de nacimiento' : age < 17 ? 'tener 17 años o más' : ''} en los datos del paciente.</p>
              )}
            </>
          )}

          <button type="button" onClick={() => setOpenBia((v) => !v)} className="w-full flex items-center justify-between text-[13px] font-semibold text-slate-700">
            <span>Balanza de bioimpedancia</span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${openBia ? 'rotate-180' : ''}`} />
          </button>
          {openBia && (
            <div className="grid grid-cols-3 gap-3">
              {num('fatPct', '% grasa', '%')}
              {num('musclePct', '% músculo', '%')}
              {num('visceral', 'Visceral', 'niv.')}
            </div>
          )}
          {fat && (
            <p className="text-[12.5px] text-slate-600">
              Grasa corporal: <b className="text-slate-900 tabular-nums">{fmt(fat.value)} %</b> <span className="text-slate-400">({fat.source === 'pliegues' ? 'por pliegues' : 'de la balanza'})</span>
            </p>
          )}
        </section>

        {!f.first && (
          <div>
            <label className={label}>Cómo le fue desde la última consulta</label>
            <textarea value={f.progress} onChange={set('progress')} rows={2} maxLength={3000} placeholder="Ej.: cumplió el plan entre semana, los fines de semana le cuesta; menos hinchazón"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-rose-500 focus:bg-white resize-y" />
          </div>
        )}
        <div>
          <label className={label}>Evaluación</label>
          <textarea value={f.assessment} onChange={set('assessment')} rows={3} maxLength={3000} placeholder="Ej.: buena adherencia; bajó 1,2 kg y 2 cm de cintura"
            className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-rose-500 focus:bg-white resize-y" />
        </div>
        <div>
          <label className={label}>Indicaciones y objetivos hasta el próximo control</label>
          <textarea value={f.plan} onChange={set('plan')} rows={3} maxLength={3000} placeholder="Ej.: sumar colación de media tarde; 2 litros de agua; caminar 3 veces por semana"
            className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14px] outline-none focus:border-rose-500 focus:bg-white resize-y" />
        </div>
        <div>
          <label className={label}>Próximo control</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {([[15, '15 días'], [30, '1 mes'], [60, '2 meses']] as const).map(([d, t]) => (
              <button key={d} type="button" onClick={() => nextIn(d)} className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border ${f.nextControl === addDays(f.dateKey || today, d) ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200'}`}>{t}</button>
            ))}
            {f.nextControl && <button type="button" onClick={() => setF((x) => ({ ...x, nextControl: '' }))} className="h-8 px-3 rounded-full text-[12.5px] font-semibold text-slate-500">Sin fecha</button>}
          </div>
          <input type="date" value={f.nextControl} min={f.dateKey || today} onChange={set('nextControl')} className={input} />
        </div>
        {coverageOptions.length > 1 && (
          <div>
            <label className={label}>Cómo se cubre</label>
            <div className="flex flex-wrap gap-1.5">
              {coverageOptions.map((o) => (
                <button key={o.key} type="button" onClick={() => setCoverage(o.value)}
                  className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border ${coverageKey === o.key ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200'}`}>{o.text}</button>
              ))}
            </div>
            {coverage.type === 'pack' && !e && <p className="mt-1.5 text-[12px] text-slate-500">Se descuenta una sesión del pack.</p>}
          </div>
        )}
        {!e && (
          <p className="flex items-start gap-2 text-[12px] text-slate-500"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Podés corregirla durante 24 horas. Después queda guardada en la historia clínica y solo se le agregan notas.</p>
        )}
      </div>
    </Modal>
  );
}
