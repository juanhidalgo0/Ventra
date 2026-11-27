/**
 * Logros del negocio: qué festejar y cuándo. Puro (prueba: scratchpad logros-test.ts).
 *
 * - Ventas: 100, 500, 1.000, 5.000… Solo las que se cruzan DESPUÉS de instalar esta versión
 *   (`baseline`): un comercio con 40.000 ventas no recibe nueve festejos juntos el primer día.
 * - Día récord: ayer vendió más que cualquier día anterior (con 30 días de historia o más).
 * - Mes récord: el mes pasado fue el mejor (con 90 días de historia), durante la primera semana.
 * - Aniversario: 1, 2, 3… años desde la primera venta, durante la semana del aniversario.
 */
export interface Milestones {
  salesCount: number;
  daysWithSales: number;
  firstSaleAt: string | null;
  yesterday: { total: number; tickets: number };
  bestDayBefore: { day: string; total: number } | null;
  lastMonth: { total: number };
  bestMonthBefore: { month: string; total: number } | null;
}

export interface LogrosState { baseline?: number; seen: string[] }

export type Achievement =
  | { id: string; kind: 'ventas'; count: number }
  | { id: string; kind: 'record-dia'; total: number; prev: number }
  | { id: string; kind: 'record-mes'; total: number; prev: number; month: number }
  | { id: string; kind: 'aniversario'; years: number };

export const COUNT_STEPS = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
const DAY = 86400000;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Lo que toca festejar ahora (uno solo, el más lindo), o null. */
export function nextAchievement(m: Milestones, st: LogrosState, now = new Date()): Achievement | null {
  const seen = new Set(st.seen || []);
  const base = st.baseline ?? m.salesCount;
  const out: Achievement[] = [];

  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (m.daysWithSales >= 30 && m.bestDayBefore && m.yesterday.total > m.bestDayBefore.total && m.yesterday.tickets > 0) {
    const id = `record-dia-${ymd(yest)}`;
    if (!seen.has(id)) out.push({ id, kind: 'record-dia', total: m.yesterday.total, prev: m.bestDayBefore.total });
  }

  const step = [...COUNT_STEPS].reverse().find((s) => s <= m.salesCount && s > base);
  if (step && !seen.has(`ventas-${step}`)) out.push({ id: `ventas-${step}`, kind: 'ventas', count: step });

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (now.getDate() <= 7 && m.daysWithSales >= 90 && m.bestMonthBefore && m.lastMonth.total > m.bestMonthBefore.total) {
    const id = `record-mes-${lastMonthDate.getFullYear()}-${lastMonthDate.getMonth() + 1}`;
    if (!seen.has(id)) out.push({ id, kind: 'record-mes', total: m.lastMonth.total, prev: m.bestMonthBefore.total, month: lastMonthDate.getMonth() });
  }

  if (m.firstSaleAt) {
    const first = new Date(m.firstSaleAt);
    const years = now.getFullYear() - first.getFullYear();
    const anniv = new Date(first.getFullYear() + years, first.getMonth(), first.getDate());
    const since = now.getTime() - anniv.getTime();
    if (years >= 1 && since >= 0 && since <= 7 * DAY && !seen.has(`aniversario-${years}`)) {
      out.push({ id: `aniversario-${years}`, kind: 'aniversario', years });
    }
  }

  return out[0] || null;
}

/** Límites de hoy, ayer, este mes y el anterior en hora local, para el backend */
export function milestoneParams(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    today: today.toISOString(),
    yesterday: new Date(today.getTime() - DAY).toISOString(),
    thisMonth: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    lastMonth: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
    tzOffset: now.getTimezoneOffset(),
  };
}
