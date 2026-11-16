import { BadRequestException } from '@nestjs/common';

/**
 * Caja del mes: la plata que se guarda aparte del cajón (la "caja fuerte"). Le entra el efectivo
 * de cada Cierre Z y lo que trae el chofer al rendir el reparto; de ahí salen gastos y retiros, y a
 * fin de mes se cuenta y se hace el balance.
 *
 * Igual que la cuenta del reparto, es una fila fija de cash_register_sessions (estado FONDO) con sus
 * cash_movements: no aparece como caja abierta, no entra en arqueos ni en el Z y viaja a la nube
 * como cualquier movimiento. El id es fijo: la de la PC y la de la nube son la misma fila.
 *
 * Movimientos: INCOME suma, EXPENSE y WITHDRAWAL restan, BALANCE es el ajuste del cierre del mes
 * (con signo: contado − esperado). Las etiquetas entre corchetes evitan cargar dos veces lo mismo.
 */
export const MONTH_FUND_ID = 'caja-del-mes';

export const fundSign = (type: string, amount: number) =>
  type === 'INCOME' ? amount : type === 'EXPENSE' || type === 'WITHDRAWAL' ? -amount : type === 'BALANCE' ? amount : 0;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Crea la fila de la caja del mes si todavía no existe (db puede ser una transacción). */
export async function ensureMonthFund(db: any, userId: string) {
  const found = await db.cashRegisterSession.findUnique({ where: { id: MONTH_FUND_ID }, select: { id: true, status: true } });
  if (found) {
    if (found.status !== 'FONDO') await db.cashRegisterSession.update({ where: { id: MONTH_FUND_ID }, data: { status: 'FONDO' } });
    return MONTH_FUND_ID;
  }
  await db.cashRegisterSession.create({
    data: { id: MONTH_FUND_ID, userId, terminalName: 'Caja del mes', openingAmount: 0, status: 'FONDO', openingNotes: 'Caja del mes: no se abre ni se cierra' },
  }).catch(async (err: any) => {
    if (!(await db.cashRegisterSession.findUnique({ where: { id: MONTH_FUND_ID } }))) throw err;
  });
  return MONTH_FUND_ID;
}

/** Suma a la caja del mes una sola vez por etiqueta (un Z, un reparto). Devuelve el movimiento. */
export async function depositToMonthFund(db: any, userId: string, tag: string, amount: number, text: string) {
  const value = round2(Number(amount) || 0);
  if (!(value > 0)) return null;
  await ensureMonthFund(db, userId);
  const mark = `[${tag}]`;
  const done = await db.cashMovement.findFirst({ where: { sessionId: MONTH_FUND_ID, description: { contains: mark } } });
  if (done) return done;
  return db.cashMovement.create({ data: { sessionId: MONTH_FUND_ID, userId, type: 'INCOME', amount: value, description: `${mark} ${text}` } });
}

/** "2026-11" → inicio y fin del mes en la hora local de la PC. */
export function monthRange(month?: string) {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  const year = m ? Number(m[1]) : now.getFullYear();
  const idx = m ? Number(m[2]) - 1 : now.getMonth();
  if (idx < 0 || idx > 11) throw new BadRequestException('Mes inválido');
  const from = new Date(year, idx, 1);
  const to = new Date(year, idx + 1, 1);
  return { from, to, key: `${year}-${String(idx + 1).padStart(2, '0')}` };
}

/** De dónde vino cada entrada, por su etiqueta. */
export const fundSource = (description?: string | null) => {
  const d = description || '';
  if (/^\[z:/.test(d)) return 'Z';
  if (/^\[reparto:/.test(d)) return 'REPARTO';
  if (/^\[cobro:/.test(d)) return 'COBRO';
  if (/^\[balance:/.test(d)) return 'BALANCE';
  return 'MANUAL';
};

export async function readMonthFund(db: any, month?: string) {
  const { from, to, key } = monthRange(month);
  const all = await db.cashMovement.findMany({
    where: { sessionId: MONTH_FUND_ID },
    include: { user: { select: { fullName: true, username: true } } },
    orderBy: { createdAt: 'asc' },
  });
  let opening = 0, balance = 0;
  const totals = { fromZ: 0, fromReparto: 0, fromCollections: 0, otherIncome: 0, expenses: 0, withdrawals: 0, adjustments: 0 };
  const movements: any[] = [];
  for (const m of all) {
    const signed = fundSign(m.type, m.amount);
    balance += signed;
    const at = new Date(m.createdAt);
    if (at < from) { opening += signed; continue; }
    if (at >= to) continue;
    const source = fundSource(m.description);
    if (m.type === 'INCOME') {
      if (source === 'Z') totals.fromZ += m.amount;
      else if (source === 'REPARTO') totals.fromReparto += m.amount;
      else if (source === 'COBRO') totals.fromCollections += m.amount;
      else totals.otherIncome += m.amount;
    } else if (m.type === 'EXPENSE') totals.expenses += m.amount;
    else if (m.type === 'WITHDRAWAL') totals.withdrawals += m.amount;
    else if (m.type === 'BALANCE') totals.adjustments += m.amount;
    movements.push({ ...m, source });
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round2(totals[k]);
  const closing = round2(opening + totals.fromZ + totals.fromReparto + totals.fromCollections + totals.otherIncome - totals.expenses - totals.withdrawals + totals.adjustments);
  const balanceMove = movements.find((m) => m.type === 'BALANCE' && (m.description || '').startsWith(`[balance:${key}]`));
  let closed: any = null;
  if (balanceMove) {
    const counted = Number(/contado=(-?[\d.]+)/.exec(balanceMove.description || '')?.[1]);
    closed = { at: balanceMove.createdAt, by: balanceMove.user?.fullName || balanceMove.user?.username || '', counted: Number.isFinite(counted) ? counted : null, difference: balanceMove.amount };
  }
  return {
    month: key,
    opening: round2(opening),
    closing,
    balance: round2(balance),
    totals,
    closed,
    movements: movements.reverse(),
  };
}

/**
 * Balance del mes: se cuenta la plata guardada y la diferencia contra lo esperado queda como ajuste
 * (también cuando da justo, para que el mes figure cerrado). Desde ahí sigue el mes siguiente.
 */
export async function closeMonthFund(db: any, userId: string, month: string | undefined, counted: number, notes?: string) {
  const value = round2(Number(counted));
  if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Ingresá cuánto contaste');
  const state = await readMonthFund(db, month);
  if (state.closed) throw new BadRequestException('Este mes ya tiene su balance');
  const { to, key } = monthRange(month);
  await ensureMonthFund(db, userId);
  const difference = round2(value - state.closing);
  // El balance de un mes que ya pasó queda con fecha de ese mes (último segundo), así no cambia el siguiente
  const at = new Date(Math.min(Date.now(), to.getTime() - 1000));
  const extra = (notes || '').trim().slice(0, 200);
  await db.cashMovement.create({
    data: {
      sessionId: MONTH_FUND_ID, userId, type: 'BALANCE', amount: difference, createdAt: at,
      description: `[balance:${key}] Balance del mes · contado=${value} esperado=${state.closing}${extra ? ` · ${extra}` : ''}`,
    },
  });
  return readMonthFund(db, key);
}
