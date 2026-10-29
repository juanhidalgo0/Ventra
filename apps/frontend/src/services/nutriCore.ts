/**
 * Consultorio de nutrición: tipos y cálculos sin Firebase (se prueban solos, ver
 * scripts/test-nutri.ts). Pesos en kg, alturas y circunferencias en cm, pliegues en mm.
 * Fechas como 'AAAA-MM-DD' (hora de Argentina), igual que la agenda.
 */

export type Sex = 'F' | 'M';
export type Activity = 'sedentario' | 'ligera' | 'moderada' | 'intensa' | 'muy_intensa';

export const ACTIVITY: Record<Activity, { label: string; hint: string; factor: number }> = {
  sedentario: { label: 'Sedentario', hint: 'Poco o nada de ejercicio', factor: 1.2 },
  ligera: { label: 'Actividad ligera', hint: '1 a 3 días por semana', factor: 1.375 },
  moderada: { label: 'Actividad moderada', hint: '3 a 5 días por semana', factor: 1.55 },
  intensa: { label: 'Actividad intensa', hint: '6 o 7 días por semana', factor: 1.725 },
  muy_intensa: { label: 'Muy intensa', hint: 'Doble turno o trabajo físico', factor: 1.9 },
};

/** Historia clínica: texto libre por tema, como la escribe la nutricionista. */
export type HistoryKey =
  | 'reason' | 'pathologies' | 'medication' | 'allergies' | 'intolerances' | 'surgeries' | 'familyHistory'
  | 'digestive' | 'sleep' | 'water' | 'alcoholSmoking' | 'physicalActivity' | 'eating' | 'likes' | 'dislikes'
  | 'supplements' | 'gyneco' | 'labs' | 'other';
export type ClinicalHistory = Partial<Record<HistoryKey, string>>;

export const HISTORY_SECTIONS: { title: string; fields: { key: HistoryKey; label: string; placeholder: string }[] }[] = [
  {
    title: 'Motivo de consulta',
    fields: [{ key: 'reason', label: 'Motivo y expectativas', placeholder: 'Ej.: quiere bajar de peso para mejorar el colesterol; probó dietas sin sostenerlas' }],
  },
  {
    title: 'Antecedentes',
    fields: [
      { key: 'pathologies', label: 'Patologías', placeholder: 'Ej.: hipotiroidismo, HTA, diabetes tipo 2, celiaquía…' },
      { key: 'medication', label: 'Medicación', placeholder: 'Ej.: levotiroxina 75 mcg en ayunas' },
      { key: 'allergies', label: 'Alergias', placeholder: 'Ej.: maní, mariscos' },
      { key: 'intolerances', label: 'Intolerancias', placeholder: 'Ej.: lactosa' },
      { key: 'surgeries', label: 'Cirugías', placeholder: 'Ej.: colecistectomía (2019)' },
      { key: 'familyHistory', label: 'Antecedentes familiares', placeholder: 'Ej.: padre diabético, madre con HTA' },
      { key: 'gyneco', label: 'Ginecológicos', placeholder: 'Ej.: embarazo, lactancia, ciclo, menopausia, anticonceptivos' },
    ],
  },
  {
    title: 'Hábitos',
    fields: [
      { key: 'physicalActivity', label: 'Actividad física', placeholder: 'Ej.: camina 30 min 3 veces por semana' },
      { key: 'sleep', label: 'Sueño', placeholder: 'Ej.: duerme 6 h, se despierta cansado' },
      { key: 'water', label: 'Agua', placeholder: 'Ej.: 1 litro por día, mucha gaseosa' },
      { key: 'alcoholSmoking', label: 'Alcohol y tabaco', placeholder: 'Ej.: vino los fines de semana, no fuma' },
      { key: 'digestive', label: 'Digestivo', placeholder: 'Ej.: tránsito lento, distensión después de comer' },
      { key: 'supplements', label: 'Suplementos', placeholder: 'Ej.: vitamina D, proteína en polvo' },
    ],
  },
  {
    title: 'Alimentación',
    fields: [
      { key: 'eating', label: 'Cómo come hoy (recordatorio de 24 h)', placeholder: 'Desayuno: café con leche y 2 medialunas. Almuerzo: …' },
      { key: 'likes', label: 'Le gusta', placeholder: 'Ej.: pastas, frutas, carne' },
      { key: 'dislikes', label: 'No come / no le gusta', placeholder: 'Ej.: pescado, verduras de hoja; vegetariano' },
    ],
  },
  {
    title: 'Otros',
    fields: [
      { key: 'labs', label: 'Laboratorio', placeholder: 'Ej.: 03/2026 colesterol total 240, LDL 160, glucemia 105' },
      { key: 'other', label: 'Otros datos', placeholder: '' },
    ],
  },
];

export interface Skinfolds { triceps?: number; biceps?: number; subscapular?: number; suprailiac?: number }

/** Lo que se mide en una consulta. Todo opcional: no siempre se mide todo. */
export interface Measures {
  weight?: number;
  height?: number;
  waist?: number;
  hip?: number;
  arm?: number;
  skinfolds?: Skinfolds;
  /** Bioimpedancia (balanza): lo que marca el equipo */
  bia?: { fatPct?: number; musclePct?: number; visceral?: number };
}

export interface Addendum { at: number; text: string }

/** Una consulta: mediciones y evolución. Pasadas 24 h no se edita: se le agregan notas (ley 26.529). */
export interface Consulta extends Measures {
  id: string;
  dateKey: string;
  first?: boolean;
  /** Cómo le fue desde la última consulta (lo que cuenta el paciente) */
  progress?: string;
  /** Evaluación de la nutricionista */
  assessment?: string;
  /** Indicaciones y objetivos hasta el próximo control */
  plan?: string;
  nextControl?: string;
  /** Cómo se cubrió: particular, obra social (con los datos de ese día) o una sesión de un pack */
  coverage?: Coverage;
  addenda?: Addendum[];
  createdAt?: any;
}

export type Coverage =
  | { type: 'particular' }
  | { type: 'obra_social'; name: string; number?: string; plan?: string }
  | { type: 'pack'; packId: string; packName: string };

/** Pack de consultas pagado por adelantado (se descuenta una sesión por consulta) */
export interface Pack { id: string; name: string; sessions: number; used: number; price: number; method: string; dateKey: string; paidAt: number }

/** Ficha previa que completa el paciente desde su link, antes de la primera consulta */
export const INTAKE_FIELDS: { key: HistoryKey; label: string; placeholder: string }[] = [
  { key: 'reason', label: '¿Por qué querés hacer la consulta? ¿Qué te gustaría lograr?', placeholder: 'Ej.: bajar de peso, comer más ordenado, mejorar el colesterol' },
  { key: 'pathologies', label: '¿Tenés alguna enfermedad o problema de salud?', placeholder: 'Ej.: hipotiroidismo, presión alta, diabetes' },
  { key: 'medication', label: '¿Tomás alguna medicación o suplemento?', placeholder: 'Ej.: levotiroxina, vitamina D' },
  { key: 'allergies', label: '¿Tenés alergias a algún alimento?', placeholder: 'Ej.: maní, mariscos' },
  { key: 'intolerances', label: '¿Algún alimento te cae mal?', placeholder: 'Ej.: la leche me inflama' },
  { key: 'physicalActivity', label: '¿Hacés actividad física? ¿Cuál y cuántas veces por semana?', placeholder: 'Ej.: camino 30 minutos 3 veces' },
  { key: 'sleep', label: '¿Cuántas horas dormís?', placeholder: 'Ej.: 6 horas, me despierto cansada' },
  { key: 'water', label: '¿Cuánta agua tomás por día? ¿Y otras bebidas?', placeholder: 'Ej.: 1 litro de agua y gaseosa en las comidas' },
  { key: 'eating', label: 'Contanos qué comiste ayer, desde que te levantaste', placeholder: 'Desayuno: … Almuerzo: … Merienda: … Cena: …' },
  { key: 'likes', label: '¿Qué comidas te gustan?', placeholder: 'Ej.: pastas, frutas, carne' },
  { key: 'dislikes', label: '¿Qué no comés o no te gusta?', placeholder: 'Ej.: pescado; soy vegetariana' },
];

export interface Intake { at: number; data: ClinicalHistory; reviewed?: boolean }

export interface PatientSummary {
  visits: number;
  firstDate?: string;
  lastVisit?: string;
  nextControl?: string;
  firstWeight?: number;
  lastWeight?: number;
  height?: number;
  bmi?: number;
}

export interface Patient extends Partial<PatientSummary> {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  dni?: string;
  birthDate?: string;
  sex?: Sex;
  obraSocial?: string;
  occupation?: string;
  goal?: string;
  goalWeight?: number;
  activity?: Activity;
  history?: ClinicalHistory;
  /** Número de afiliado y plan de la obra social o prepaga */
  obraSocialNumber?: string;
  obraSocialPlan?: string;
  packs?: Pack[];
  /** Link del portal del paciente (nutri_portal/{token}) */
  portalToken?: string;
  /** Sala de videollamada para las consultas online */
  videoLink?: string;
  intake?: Intake;
  /** Para qué control ya se le mandó el recordatorio (la fecha del control) */
  remindedFor?: string;
  /** Clave del cliente en la agenda (ver clientKeyOf en agendaCore): une al paciente con sus turnos */
  agendaKey?: string | null;
  archived?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

// ─── Fechas ───

/** Edad cumplida en una fecha. null sin fecha de nacimiento. */
export function ageOn(birthDate: string | undefined, dateKey: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = dateKey.split('-').map(Number);
  const age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

// ─── Antropometría ───

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pos = (n: unknown): n is number => typeof n === 'number' && isFinite(n) && n > 0;

export function bmi(weight?: number, heightCm?: number): number | null {
  if (!pos(weight) || !pos(heightCm)) return null;
  return round(weight / (heightCm / 100) ** 2);
}

/** Clasificación de la OMS para adultos. En menores de 18 el IMC se evalúa con percentiles, no con esta tabla. */
export function bmiCategory(value: number | null, age: number | null): { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' } | null {
  if (value == null) return null;
  if (age != null && age < 18) return { label: 'Menor de 18: evaluar con percentiles', tone: 'info' };
  if (value < 18.5) return { label: 'Bajo peso', tone: 'warn' };
  if (value < 25) return { label: 'Normal', tone: 'ok' };
  if (value < 30) return { label: 'Sobrepeso', tone: 'warn' };
  if (value < 35) return { label: 'Obesidad grado I', tone: 'bad' };
  if (value < 40) return { label: 'Obesidad grado II', tone: 'bad' };
  return { label: 'Obesidad grado III', tone: 'bad' };
}

/** Peso para un IMC de 18,5 a 24,9 con esa altura (referencia, no objetivo). */
export function healthyWeightRange(heightCm?: number): [number, number] | null {
  if (!pos(heightCm)) return null;
  const m2 = (heightCm / 100) ** 2;
  return [round(18.5 * m2), round(24.9 * m2)];
}

export function waistHipRatio(waist?: number, hip?: number): number | null {
  return pos(waist) && pos(hip) ? round(waist / hip, 2) : null;
}

/** Riesgo cardiometabólico por cintura (OMS): mujeres ≥80 aumentado, ≥88 muy aumentado; hombres ≥94 y ≥102. */
export function waistRisk(waist: number | undefined, sex: Sex | undefined): { label: string; tone: 'ok' | 'warn' | 'bad' } | null {
  if (!pos(waist) || !sex) return null;
  const [high, veryHigh] = sex === 'F' ? [80, 88] : [94, 102];
  if (waist >= veryHigh) return { label: 'Riesgo muy aumentado', tone: 'bad' };
  if (waist >= high) return { label: 'Riesgo aumentado', tone: 'warn' };
  return { label: 'Sin riesgo aumentado', tone: 'ok' };
}

/** Coeficientes de Durnin y Womersley (1974) por sexo y edad: densidad = c − m · log10(Σ 4 pliegues). */
const DW: Record<Sex, [number, number, number][]> = {
  // [edad desde, c, m]
  M: [[17, 1.1620, 0.0630], [20, 1.1631, 0.0632], [30, 1.1422, 0.0544], [40, 1.1620, 0.0700], [50, 1.1715, 0.0779]],
  F: [[17, 1.1549, 0.0678], [20, 1.1599, 0.0717], [30, 1.1423, 0.0632], [40, 1.1333, 0.0612], [50, 1.1339, 0.0645]],
};

/**
 * % de grasa con 4 pliegues (bíceps, tríceps, subescapular, suprailíaco): densidad de Durnin y
 * Womersley y fórmula de Siri. Hacen falta los 4, el sexo y la edad (17 años o más).
 */
export function bodyFatDW(folds: Skinfolds | undefined, sex: Sex | undefined, age: number | null): number | null {
  if (!folds || !sex || age == null || age < 17) return null;
  const list = [folds.biceps, folds.triceps, folds.subscapular, folds.suprailiac];
  if (!list.every(pos)) return null;
  const sum = (list as number[]).reduce((s, n) => s + n, 0);
  const [, c, m] = [...DW[sex]].reverse().find(([from]) => age >= from)!;
  const density = c - m * Math.log10(sum);
  const pct = 495 / density - 450;
  return pct > 0 && pct < 70 ? round(pct) : null;
}

export const sumFolds = (f?: Skinfolds) => {
  const l = [f?.biceps, f?.triceps, f?.subscapular, f?.suprailiac].filter(pos) as number[];
  return l.length ? round(l.reduce((s, n) => s + n, 0)) : null;
};

/** % de grasa de la consulta: el de los pliegues y, si no, el de la balanza. */
export function fatPctOf(c: Measures, sex: Sex | undefined, age: number | null): { value: number; source: 'pliegues' | 'bioimpedancia' } | null {
  const dw = bodyFatDW(c.skinfolds, sex, age);
  if (dw != null) return { value: dw, source: 'pliegues' };
  return pos(c.bia?.fatPct) ? { value: c.bia!.fatPct!, source: 'bioimpedancia' } : null;
}

// ─── Requerimiento de energía ───

/** Metabolismo basal (kcal/día) por Mifflin-St Jeor: el más usado hoy en adultos. */
export function mifflin(weight?: number, heightCm?: number, age?: number | null, sex?: Sex): number | null {
  if (!pos(weight) || !pos(heightCm) || age == null || !sex) return null;
  return Math.round(10 * weight + 6.25 * heightCm - 5 * age + (sex === 'M' ? 5 : -161));
}

/** Metabolismo basal por Harris-Benedict (original, 1919), para quien prefiere comparar. */
export function harrisBenedict(weight?: number, heightCm?: number, age?: number | null, sex?: Sex): number | null {
  if (!pos(weight) || !pos(heightCm) || age == null || !sex) return null;
  return Math.round(sex === 'M'
    ? 66.473 + 13.7516 * weight + 5.0033 * heightCm - 6.755 * age
    : 655.0955 + 9.5634 * weight + 1.8496 * heightCm - 4.6756 * age);
}

/** Gasto energético total: basal × factor de actividad. */
export const totalEnergy = (basal: number | null, activity?: Activity) =>
  basal != null && activity ? Math.round(basal * ACTIVITY[activity].factor) : null;

// ─── Resumen del paciente ───

/** La última medida conocida de cada cosa (la altura casi nunca se vuelve a medir). */
export function latest<K extends keyof Measures>(list: Consulta[], key: K): Measures[K] | undefined {
  for (let i = list.length - 1; i >= 0; i--) if (list[i][key] != null) return list[i][key];
  return undefined;
}

export const byDate = (a: Consulta, b: Consulta) => a.dateKey.localeCompare(b.dateKey) || (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);

/** Lo que se guarda en la ficha para mostrar la lista sin leer todas las consultas. */
export function summarize(consultas: Consulta[], todayKey: string): PatientSummary {
  const list = [...consultas].sort(byDate);
  const weights = list.filter((c) => pos(c.weight));
  const height = latest(list, 'height');
  const lastWeight = weights.length ? weights[weights.length - 1].weight : undefined;
  const next = list.map((c) => c.nextControl).filter((d): d is string => !!d && d >= todayKey).sort()[0];
  const out: PatientSummary = { visits: list.length };
  if (list.length) { out.firstDate = list[0].dateKey; out.lastVisit = list[list.length - 1].dateKey; }
  if (next) out.nextControl = next;
  if (weights.length) { out.firstWeight = weights[0].weight; out.lastWeight = lastWeight; }
  if (pos(height)) out.height = height;
  const b = bmi(lastWeight, height);
  if (b != null) out.bmi = b;
  return out;
}

/** Puntos para los gráficos de evolución, con lo calculado en cada consulta. */
export interface EvolutionPoint { dateKey: string; weight?: number; bmi?: number; waist?: number; hip?: number; fatPct?: number; sumFolds?: number; muscle?: number }

export function evolution(consultas: Consulta[], p: Pick<Patient, 'birthDate' | 'sex'>): EvolutionPoint[] {
  const list = [...consultas].sort(byDate);
  let height: number | undefined;
  return list.map((c) => {
    if (pos(c.height)) height = c.height;
    const point: EvolutionPoint = { dateKey: c.dateKey };
    if (pos(c.weight)) point.weight = c.weight;
    const b = bmi(c.weight, height);
    if (b != null) point.bmi = b;
    if (pos(c.waist)) point.waist = c.waist;
    if (pos(c.hip)) point.hip = c.hip;
    const fat = fatPctOf(c, p.sex, ageOn(p.birthDate, c.dateKey));
    if (fat) point.fatPct = fat.value;
    const folds = sumFolds(c.skinfolds);
    if (folds != null) point.sumFolds = folds;
    if (pos(c.bia?.musclePct)) point.muscle = c.bia!.musclePct;
    return point;
  });
}

/** Una consulta se puede corregir durante 24 h; después solo se le agregan notas. */
export const EDIT_WINDOW_MS = 24 * 3600 * 1000;
export function editable(c: Consulta, now = Date.now()): boolean {
  const created = c.createdAt?.toMillis ? c.createdAt.toMillis() : typeof c.createdAt?.seconds === 'number' ? c.createdAt.seconds * 1000 : null;
  // Recién guardada (el servidor todavía no puso la hora): se puede editar
  return created == null || now - created < EDIT_WINDOW_MS;
}

/** Número escrito a mano ("72,5", "72.5 kg") → 72.5. Vacío o inválido → undefined. */
export function parseNum(v: string | number | undefined | null): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
  return isFinite(n) && n > 0 ? n : undefined;
}

export const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? '—' : n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: d });

// ─── Packs, obra social y recordatorios ───

/** "Particular", "Ninguna", "-" y vacío no son una obra social */
export const hasObraSocial = (p: Pick<Patient, 'obraSocial'>) => !!p.obraSocial && !/^(particular|ninguna|no|no tiene|-+)$/i.test(p.obraSocial.trim());

/** El pack del que se descuenta la próxima consulta: el más viejo con sesiones libres */
export function activePack(p: Pick<Patient, 'packs'>): Pack | null {
  return [...(p.packs || [])].sort((a, b) => a.paidAt - b.paidAt).find((k) => k.used < k.sessions) || null;
}

/** Cobertura que se propone al cargar la consulta: pack con sesiones, si no obra social, si no particular */
export function defaultCoverage(p: Pick<Patient, 'packs' | 'obraSocial' | 'obraSocialNumber' | 'obraSocialPlan'>): Coverage {
  const pack = activePack(p);
  if (pack) return { type: 'pack', packId: pack.id, packName: pack.name };
  if (hasObraSocial(p)) {
    const c: Coverage = { type: 'obra_social', name: p.obraSocial!.trim() };
    if (p.obraSocialNumber?.trim()) c.number = p.obraSocialNumber.trim();
    if (p.obraSocialPlan?.trim()) c.plan = p.obraSocialPlan.trim();
    return c;
  }
  return { type: 'particular' };
}

/** Suma o devuelve una sesión del pack (al cargar o borrar la consulta). Nunca baja de 0 ni pasa del total. */
export function applyPackSession(packs: Pack[] | undefined, packId: string, delta: 1 | -1): Pack[] {
  return (packs || []).map((k) => (k.id === packId ? { ...k, used: Math.max(0, Math.min(k.sessions, k.used + delta)) } : k));
}

export const coverageLabel = (c?: Coverage) => (!c || c.type === 'particular' ? 'Particular' : c.type === 'pack' ? c.packName : c.name);

/** Controles para recordar: dentro de los próximos `days` días, sin recordatorio mandado para esa fecha. */
export function controlsToRemind<T extends Pick<Patient, 'nextControl' | 'remindedFor' | 'archived'>>(list: T[], todayKey: string, days = 3): T[] {
  return list
    .filter((p) => !p.archived && !!p.nextControl && p.nextControl >= todayKey && daysBetween(todayKey, p.nextControl) <= days && p.remindedFor !== p.nextControl)
    .sort((a, b) => a.nextControl!.localeCompare(b.nextControl!));
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "hoy", "mañana" o "el jueves 30/10" */
export function whenLabel(dateKey: string, todayKey: string): string {
  const d = daysBetween(todayKey, dateKey);
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  const [y, m, day] = dateKey.split('-').map(Number);
  return `el ${WEEKDAYS[new Date(Date.UTC(y, m - 1, day, 12)).getUTCDay()]} ${day}/${m}`;
}

/** Mensaje de WhatsApp para recordar el control */
export function reminderText(p: Pick<Patient, 'name' | 'nextControl'>, todayKey: string, opts: { from?: string; bookingUrl?: string } = {}): string {
  const name = p.name.trim().split(/\s+/)[0];
  const when = p.nextControl ? whenLabel(p.nextControl, todayKey) : 'pronto';
  return [
    `Hola ${name}! Te recuerdo que ${when} te toca el control de nutrición.`,
    opts.bookingUrl ? `Si todavía no tenés turno, lo reservás acá: ${opts.bookingUrl}` : 'Avisame qué día y horario te queda bien.',
    opts.from || '',
  ].filter(Boolean).join('\n');
}

/** Sala de videollamada nueva (Jitsi Meet: sin cuenta ni app, se abre en el navegador) */
export function newVideoLink(rand = () => Math.random().toString(36).slice(2, 8)): string {
  return `https://meet.jit.si/ventra-consulta-${rand()}${rand()}`;
}

/**
 * Pasa la ficha previa a la historia clínica: completa lo vacío y, donde ya había algo escrito,
 * lo agrega abajo marcado como respuesta del paciente.
 */
export function mergeIntake(history: ClinicalHistory | undefined, intake: ClinicalHistory): ClinicalHistory {
  const out: ClinicalHistory = { ...(history || {}) };
  for (const [k, v] of Object.entries(intake) as [HistoryKey, string | undefined][]) {
    const text = v?.trim();
    if (!text) continue;
    const prev = out[k]?.trim();
    if (!prev) out[k] = text;
    else if (!prev.includes(text)) out[k] = `${prev}\n(Ficha previa) ${text}`;
  }
  return out;
}
