/**
 * Plan alimentario del consultorio: tipos, cuentas y plantillas, sin Firebase (se prueban solos,
 * ver scripts/test-nutri.ts). Cada alimento del plan guarda sus valores por 100 g: si la tabla
 * cambia, un plan ya entregado sigue diciendo lo mismo.
 */
import { foodById, type Per100, type Food } from './nutriFoods';

export interface PlanItem {
  id: string;
  /** De qué alimento de la tabla salió (vacío si se escribió a mano) */
  foodId?: string;
  name: string;
  /** Cantidad en gramos (o ml). 0 en lo escrito a mano sin cantidad ("verduras a gusto") */
  grams: number;
  per100?: Per100;
  /** Medida casera de la tabla ("1 taza") y cuánto pesa, para mostrar "1½ taza" */
  measure?: string;
  unitGrams?: number;
}

export interface PlanMeal { id: string; name: string; time?: string; items: PlanItem[]; note?: string }

export type PlanStatus = 'active' | 'old';

export interface MealPlan {
  id: string;
  title: string;
  /** Calorías buscadas por día */
  kcalTarget?: number;
  meals: PlanMeal[];
  /** Recomendaciones generales (hidratación, cocción, qué evitar…) */
  recommendations?: string;
  status: PlanStatus;
  createdAt?: any;
  updatedAt?: any;
}

export interface Totals { kcal: number; p: number; c: number; f: number }

const r1 = (n: number) => Math.round(n * 10) / 10;
export const newId = () => Math.random().toString(36).slice(2, 10);

export function itemTotals(i: PlanItem): Totals {
  if (!i.per100 || !(i.grams > 0)) return { kcal: 0, p: 0, c: 0, f: 0 };
  const x = i.grams / 100;
  return { kcal: i.per100.k * x, p: i.per100.p * x, c: i.per100.c * x, f: i.per100.f * x };
}

const add = (a: Totals, b: Totals): Totals => ({ kcal: a.kcal + b.kcal, p: a.p + b.p, c: a.c + b.c, f: a.f + b.f });
const ZERO: Totals = { kcal: 0, p: 0, c: 0, f: 0 };
const rounded = (t: Totals): Totals => ({ kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f) });

export const mealTotals = (m: PlanMeal): Totals => rounded(m.items.map(itemTotals).reduce(add, ZERO));
export const planTotals = (p: Pick<MealPlan, 'meals'>): Totals => rounded(p.meals.flatMap((m) => m.items).map(itemTotals).reduce(add, ZERO));

/** Qué parte de las calorías aporta cada macro (proteínas e hidratos 4 kcal/g, grasas 9). */
export function macroSplit(t: Totals): { p: number; c: number; f: number } | null {
  const kcal = t.p * 4 + t.c * 4 + t.f * 9;
  if (!(kcal > 0)) return null;
  const p = Math.round((t.p * 4 * 100) / kcal), f = Math.round((t.f * 9 * 100) / kcal);
  return { p, c: 100 - p - f, f };
}

/** Proteínas por kilo de peso del paciente */
export const proteinPerKg = (t: Totals, weight?: number) => (weight && weight > 0 ? r1(t.p / weight) : null);

// ─── Medidas caseras ───

const FRACTION: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

/** "1/2" → 0.5, "3" → 3 */
function parseLead(s: string): number | null {
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  return /^\d+$/.test(s) ? Number(s) : null;
}

/** 1.5 → "1½", 0.25 → "¼", 2 → "2" */
export function nice(n: number): string {
  const q = Math.round(n * 4) / 4;
  const whole = Math.floor(q), frac = FRACTION[String(q - whole)];
  if (!frac) return String(whole);
  return whole ? `${whole}${frac}` : frac;
}

/**
 * La cantidad en medida casera: 300 g de leche con "1 taza" de 200 g → "1½ taza".
 * null si no hay medida o la cuenta da menos de un cuarto.
 */
export function household(i: Pick<PlanItem, 'grams' | 'measure' | 'unitGrams'>): string | null {
  if (!i.measure || !(i.unitGrams && i.unitGrams > 0) || !(i.grams > 0)) return null;
  const [lead, ...rest] = i.measure.split(' ');
  const base = parseLead(lead);
  if (base == null || !rest.length) return null;
  const amount = (base * i.grams) / i.unitGrams;
  if (amount < 0.25) return null;
  return `${nice(amount)} ${rest.join(' ')}`;
}

/** Cómo se lee un renglón: "1½ taza de Leche descremada (300 g)" o lo escrito a mano. */
export function itemLine(i: PlanItem): string {
  if (!(i.grams > 0)) return i.name;
  const h = household(i);
  return h ? `${h} · ${i.name} (${Math.round(i.grams)} g)` : `${i.name} · ${Math.round(i.grams)} g`;
}

export function itemFromFood(f: Food, grams = f.grams): PlanItem {
  return { id: newId(), foodId: f.id, name: f.name, grams, per100: { k: f.k, p: f.p, c: f.c, f: f.f }, measure: f.measure, unitGrams: f.grams };
}

// ─── Plantillas ───

/** Redondea a 5 g (o a 10 g desde 100 g): nadie pesa 137 g de arroz */
export const roundGrams = (g: number) => (g >= 100 ? Math.round(g / 10) * 10 : Math.max(5, Math.round(g / 5) * 5));

/** Lo que no se escala con las calorías: bebidas sin calorías y verduras (son libres) */
const FIXED_GROUPS = new Set(['verduras', 'bebidas']);
const isFixed = (i: PlanItem) => {
  if (!i.per100 || i.per100.k < 5) return true;
  const f = i.foodId ? foodById(i.foodId) : null;
  return !!f && FIXED_GROUPS.has(f.group) && f.k < 50;
};

/**
 * Lleva el plan a otras calorías multiplicando las cantidades (menos verduras y bebidas sin
 * calorías). Con varias vueltas porque el redondeo y lo fijo corren el total.
 */
export function scalePlan<T extends Pick<MealPlan, 'meals'>>(plan: T, kcalTarget: number): T {
  let meals = plan.meals;
  for (let round = 0; round < 3; round++) {
    const total = planTotals({ meals }).kcal;
    const fixed = Math.round(meals.flatMap((m) => m.items).filter(isFixed).map(itemTotals).reduce((s, t) => s + t.kcal, 0));
    const scalable = total - fixed;
    if (!(scalable > 0) || Math.abs(total - kcalTarget) <= 15) break;
    const k = Math.max(0.3, Math.min(3, (kcalTarget - fixed) / scalable));
    meals = meals.map((m) => ({ ...m, items: m.items.map((i) => (isFixed(i) || !(i.grams > 0) ? i : { ...i, grams: roundGrams(i.grams * k) })) }));
  }
  return { ...plan, meals };
}

type TemplateItem = [foodId: string, grams: number] | string;
interface TemplateDef { id: string; title: string; description: string; kcalDelta: number; meals: [name: string, time: string, items: TemplateItem[]][]; recommendations: string }

const HYDRATION = 'Tomá entre 2 y 2,5 litros de agua por día. Cociná al horno, a la plancha, hervido o al vapor. Usá el aceite en crudo, medido con cuchara.';

/** Plantillas de partida: se eligen, se llevan a las calorías del paciente y se ajustan a mano. */
export const PLAN_TEMPLATES: TemplateDef[] = [
  {
    id: 'descenso', title: 'Descenso de peso', description: 'Unas 500 kcal debajo de su gasto, con proteínas en cada comida.', kcalDelta: -500,
    meals: [
      ['Desayuno', '08:00', [['infusion', 200], ['leche-descremada', 200], ['pan-integral', 50], ['queso-untable-desc', 20], ['mermelada-light', 20]]],
      ['Almuerzo', '13:00', [['verduras-mix', 250], ['pollo-pechuga', 150], ['arroz-integral', 50], ['aceite', 10], ['manzana', 150]]],
      ['Merienda', '17:00', [['infusion', 200], ['yogur-descremado', 190], ['avena', 30], ['frutillas', 150]]],
      ['Cena', '21:00', [['verduras-mix', 250], ['merluza', 150], ['papa', 150], ['aceite', 10], ['naranja', 180]]],
    ],
    recommendations: `${HYDRATION} Evitá gaseosas y jugos azucarados. Si tenés hambre entre comidas, sumá una fruta o un yogur descremado.`,
  },
  {
    id: 'mantenimiento', title: 'Mantenimiento', description: 'Las calorías de su gasto, alimentación variada.', kcalDelta: 0,
    meals: [
      ['Desayuno', '08:00', [['infusion', 200], ['leche-entera', 200], ['pan-integral', 50], ['queso-untable-desc', 20], ['mermelada', 20]]],
      ['Almuerzo', '13:00', [['verduras-mix', 250], ['carne-magra', 150], ['fideos', 80], ['aceite', 13], ['banana', 120]]],
      ['Merienda', '17:00', [['infusion', 200], ['yogur-entero', 190], ['granola', 30], ['manzana', 150]]],
      ['Cena', '21:00', [['verduras-mix', 250], ['pollo-muslo', 150], ['batata', 150], ['aceite', 13], ['naranja', 180]]],
      ['Colación', '11:00', [['almendras', 20]]],
    ],
    recommendations: `${HYDRATION} Variá las carnes: pescado 2 veces por semana. Sumá legumbres 2 o 3 veces por semana.`,
  },
  {
    id: 'masa-muscular', title: 'Aumento de masa muscular', description: 'Unas 300 kcal arriba de su gasto, con más proteínas.', kcalDelta: 300,
    meals: [
      ['Desayuno', '08:00', [['infusion', 200], ['leche-entera', 250], ['avena', 50], ['banana', 120], ['pasta-mani', 15]]],
      ['Almuerzo', '13:00', [['verduras-mix', 250], ['carne-magra', 200], ['arroz-blanco', 90], ['aceite', 13]]],
      ['Merienda', '17:00', [['yogur-entero', 190], ['granola', 40], ['whey', 30]]],
      ['Cena', '21:00', [['verduras-mix', 200], ['pollo-pechuga', 200], ['fideos', 100], ['aceite', 13], ['manzana', 150]]],
      ['Colación', '11:00', [['pan-integral', 50], ['huevo', 100], ['palta', 50]]],
    ],
    recommendations: `${HYDRATION} Repartí las proteínas en todas las comidas. Después de entrenar, una comida con proteínas e hidratos dentro de las 2 horas.`,
  },
  {
    id: 'vegetariano', title: 'Vegetariano', description: 'Sin carnes, con huevo, lácteos, legumbres y cereales integrales.', kcalDelta: 0,
    meals: [
      ['Desayuno', '08:00', [['infusion', 200], ['yogur-entero', 190], ['avena', 40], ['chia', 10], ['frutillas', 150]]],
      ['Almuerzo', '13:00', [['verduras-mix', 250], ['lentejas-cocidas', 150], ['arroz-integral', 60], ['aceite', 13]]],
      ['Merienda', '17:00', [['infusion', 200], ['pan-integral', 50], ['queso-port-light', 30], ['tomate', 120]]],
      ['Cena', '21:00', [['verduras-mix', 250], ['huevo', 100], ['quinoa', 60], ['tofu', 100], ['aceite', 13], ['pera', 150]]],
      ['Colación', '11:00', [['nueces', 20], ['mandarina', 100]]],
    ],
    recommendations: `${HYDRATION} Combiná legumbres con cereales en el día. Sumá semillas y frutos secos. Consultá por la vitamina B12.`,
  },
  {
    id: 'glucemia', title: 'Control de glucemia', description: 'Hidratos integrales repartidos y fruta entera, sin azúcar agregada.', kcalDelta: -250,
    meals: [
      ['Desayuno', '08:00', [['infusion', 200], ['leche-descremada', 200], ['pan-integral', 50], ['queso-untable-desc', 20]]],
      ['Almuerzo', '13:00', [['verduras-mix', 300], ['pollo-pechuga', 150], ['garbanzos-cocidos', 100], ['aceite', 10], ['manzana', 150]]],
      ['Merienda', '17:00', [['infusion', 200], ['yogur-descremado', 190], ['avena', 20], ['nueces', 10]]],
      ['Cena', '21:00', [['verduras-mix', 300], ['merluza', 150], ['arroz-integral', 40], ['aceite', 10], ['pera', 150]]],
      ['Colación', '11:00', [['queso-port-light', 30], ['galletas-arroz', 18]]],
    ],
    recommendations: `${HYDRATION} Sin azúcar ni miel: usá edulcorante si hace falta. Hacé las 4 comidas y no estés más de 4 horas sin comer. La fruta, entera y no en jugo.`,
  },
];

/** Arma un plan nuevo desde una plantilla, llevado a las calorías indicadas. */
export function planFromTemplate(id: string, kcalTarget?: number): Omit<MealPlan, 'id' | 'status'> {
  const t = PLAN_TEMPLATES.find((x) => x.id === id) || PLAN_TEMPLATES[0];
  const meals: PlanMeal[] = t.meals.map(([name, time, items]) => ({
    id: newId(), name, time,
    items: items.map((it) => {
      if (typeof it === 'string') return { id: newId(), name: it, grams: 0 };
      const f = foodById(it[0]);
      return f ? itemFromFood(f, it[1]) : { id: newId(), name: it[0], grams: 0 };
    }),
  }));
  // Por el horario: la colación de media mañana va entre el desayuno y el almuerzo
  meals.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const base = { title: t.title, meals, recommendations: t.recommendations };
  return kcalTarget && kcalTarget > 0 ? { ...scalePlan(base, kcalTarget), kcalTarget } : base;
}

/** Calorías sugeridas para la plantilla según el gasto total del paciente */
export function suggestedKcal(templateId: string, totalEnergy: number | null): number | undefined {
  if (!totalEnergy) return undefined;
  const t = PLAN_TEMPLATES.find((x) => x.id === templateId);
  return Math.max(1200, Math.round((totalEnergy + (t?.kcalDelta || 0)) / 50) * 50);
}

/** El plan como mensaje de WhatsApp (con *negritas* de WhatsApp). */
export function planText(plan: Pick<MealPlan, 'title' | 'meals' | 'recommendations'>, opts: { patient?: string; from?: string } = {}): string {
  const lines: string[] = [];
  if (opts.patient) lines.push(`Hola ${opts.patient.split(' ')[0]}, te paso tu plan alimentario.`, '');
  lines.push(`*${plan.title}*`);
  for (const m of plan.meals) {
    if (!m.items.length && !m.note) continue;
    lines.push('', `*${m.name}*${m.time ? ` (${m.time})` : ''}`);
    for (const i of m.items) lines.push(`• ${itemLine(i)}`);
    if (m.note) lines.push(`_${m.note}_`);
  }
  if (plan.recommendations?.trim()) lines.push('', '*Recomendaciones*', plan.recommendations.trim());
  if (opts.from) lines.push('', opts.from);
  return lines.join('\n');
}
