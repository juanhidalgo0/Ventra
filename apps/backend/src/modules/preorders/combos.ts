/**
 * Combos de Promociones en los pedidos: "estos productos juntos a precio fijo" (FIXED_COMBO), de un
 * solo grupo (12 empanadas de cualquier gusto) o de varios (lavandina + detergente); "llevá 3, pagá 2"
 * (NX_M: de cada 3 unidades de un mismo producto se pagan 2) y "% de descuento" (DISCOUNT_PERCENT:
 * cada unidad de esos productos con el %). Igual que la caja (getCartItemsWithDiscounts en
 * posStore). Los dos últimos no tienen precio fijo: pagan una parte (`ratio`) de lo que valen.
 *
 * La MISMA cuenta está en cuatro lugares, mantener iguales:
 *   - acá (pedidos de preventa y de la tienda aceptados en Pedidos)
 *   - apps/frontend/src/services/combos.ts (lo que ve el vendedor en Preventa)
 *   - firebase/tienda/index.html (applyCombos: el carrito de la tienda)
 *   - firebase/functions/order-check.js (control del descuento de los pedidos de la tienda)
 *
 * Reglas: se arman primero los combos de más unidades (a igual cantidad, por id). Cada combo se
 * arma tantas veces como se pueda, tomando en cada grupo las unidades más caras primero; deja de
 * armarse cuando falta alguna unidad o cuando ya no ahorra nada. Solo cuentan unidades enteras
 * sueltas (el bulto tiene su propio precio).
 */

export interface ComboDef {
  id: string;
  name: string;
  /** Precio del combo entero (para el cliente: minorista o mayorista). 0 si va con `ratio` */
  price: number;
  /** NxM y %: parte que se paga de lo que valen las unidades (3x2 = 2/3, 15% = 0,85) */
  ratio?: number;
  groups: { qty: number; productIds: string[] }[];
  /** Tope de veces (promo con límite de unidades). Sin tope: undefined */
  maxTimes?: number;
}

/** Un renglón del pedido: `price` es lo que vale cada unidad sin el combo */
export interface ComboLine { key: string; productId: string; quantity: number; price: number }

export interface ComboUse {
  id: string;
  name: string;
  times: number;
  /** Precio de un combo (con `ratio`, el promedio de las veces que se armó) */
  price: number;
  /** Lo que se paga por todas las veces */
  total: number;
  /** NxM y %: parte que se paga (no tiene precio fijo) */
  ratio?: number;
  /** Lo que valen esas unidades sueltas */
  regular: number;
  discount: number;
  /** Unidades usadas de cada renglón */
  used: { key: string; productId: string; quantity: number; price: number }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Promos que se arman solas en los pedidos y en la caja */
export const COMBO_TYPES = ['FIXED_COMBO', 'NX_M', 'DISCOUNT_PERCENT'];

/**
 * Los combos vigentes de Promociones con el precio del cliente (el mayorista si es de esa lista y
 * el combo lo tiene). `keep`: combos que ya estaban en el pedido, que siguen valiendo aunque la
 * promo se haya pausado o vencido después (como el precio de un producto ya pedido).
 */
export function combosFromPromotions(promos: any[], opts: { trade?: boolean; now?: number; keep?: Set<string> } = {}): ComboDef[] {
  const now = opts.now ?? Date.now();
  const out: ComboDef[] = [];
  for (const pr of promos || []) {
    if (!pr || !COMBO_TYPES.includes(pr.type)) continue;
    const kept = !!opts.keep?.has(String(pr.id));
    if (!kept) {
      if (pr.isActive === false) continue;
      if (pr.startDate && new Date(pr.startDate).getTime() > now) continue;
      if (pr.endDate && new Date(pr.endDate).getTime() < now) continue;
    }
    let price = 0;
    let ratio: number | undefined;
    let list: { qty: number; productIds: string[] }[];
    const ids = [...new Set((pr.products || []).map((pp: any) => String(pp.productId)))] as string[];
    if (pr.type === 'NX_M') {
      // Llevá N, pagá M: N unidades del mismo producto (cada producto de la promo por separado)
      const n = Math.round(Number(pr.nValue) || 0), m = Math.round(Number(pr.mValue) || 0);
      if (!(n >= 2) || !(m >= 0) || m >= n || !ids.length) continue;
      const maxTimes = !kept && pr.limitType === 'STOCK' && pr.limitStock != null
        ? Math.floor(Math.max(0, Number(pr.limitStock) - (Number(pr.soldStock) || 0)) / n) : undefined;
      if (maxTimes !== undefined && maxTimes <= 0) continue;
      for (const id of ids) out.push({ id: String(pr.id), name: String(pr.name || `${n}x${m}`), price: 0, ratio: m / n, groups: [{ qty: n, productIds: [id] }], ...(maxTimes !== undefined ? { maxTimes } : {}) });
      continue;
    } else if (pr.type === 'DISCOUNT_PERCENT') {
      // Cada unidad de cualquiera de esos productos con el %
      const pct = opts.trade && Number(pr.tradeDiscountPercentage) > 0 ? Number(pr.tradeDiscountPercentage) : Number(pr.discountPercentage) || 0;
      if (!(pct > 0 && pct < 100) || !ids.length) continue;
      ratio = 1 - pct / 100;
      list = [{ qty: 1, productIds: ids }];
    } else {
      const trade = opts.trade && Number(pr.tradeFixedPrice) > 0 ? Number(pr.tradeFixedPrice) : 0;
      price = trade || Number(pr.fixedPrice);
      if (!(price > 0)) continue;
      const groups = new Map<string, { qty: number; productIds: string[] }>();
      (pr.products || []).forEach((pp: any, idx: number) => {
        const gid = pp.groupId || `single_${pp.productId}_${idx}`;
        if (!groups.has(gid)) groups.set(gid, { qty: Math.max(1, Math.round(Number(pp.quantity) || 1)), productIds: [] });
        groups.get(gid)!.productIds.push(String(pp.productId));
      });
      list = [...groups.values()];
    }
    const units = list.reduce((s, g) => s + g.qty, 0);
    // Un solo producto suelto a un precio no es un combo (con %, sí: cada unidad lleva el descuento)
    if (!list.length || (units < 2 && ratio === undefined)) continue;
    let maxTimes: number | undefined;
    if (!kept && pr.limitType === 'STOCK' && pr.limitStock != null) {
      maxTimes = Math.floor(Math.max(0, Number(pr.limitStock) - (Number(pr.soldStock) || 0)) / units);
      if (maxTimes <= 0) continue;
    }
    out.push({ id: String(pr.id), name: String(pr.name || 'Combo'), price, ...(ratio !== undefined ? { ratio } : {}), groups: list, ...(maxTimes !== undefined ? { maxTimes } : {}) });
  }
  return out;
}

/** Lo que se paga por un combo armado con unidades que valen `sum` sueltas */
export const comboPrice = (c: { price: number; ratio?: number }, sum: number) => (c.ratio !== undefined ? round2(sum * c.ratio) : c.price);

const unitsOf = (c: ComboDef) => c.groups.reduce((s, g) => s + g.qty, 0);

export function applyCombos(lines: ComboLine[], combos: ComboDef[]): ComboUse[] {
  const left = new Map<string, number>();
  for (const l of lines) left.set(l.key, (left.get(l.key) || 0) + Math.max(0, Math.floor(Number(l.quantity) + 1e-9)));
  const sorted = [...combos].sort((a, b) => unitsOf(b) - unitsOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: ComboUse[] = [];
  for (const c of sorted) {
    const used = new Map<string, number>();
    let times = 0;
    let regular = 0;
    let paid = 0;
    while (c.maxTimes === undefined || times < c.maxTimes) {
      const taken = new Map<string, number>();
      let ok = true;
      let sum = 0;
      for (const g of c.groups) {
        const cands = lines
          .filter((l) => g.productIds.includes(l.productId) && (left.get(l.key) || 0) - (taken.get(l.key) || 0) > 0)
          .sort((a, b) => b.price - a.price || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        let need = g.qty;
        for (const l of cands) {
          if (need <= 0) break;
          const n = Math.min(need, (left.get(l.key) || 0) - (taken.get(l.key) || 0));
          taken.set(l.key, (taken.get(l.key) || 0) + n);
          sum += n * l.price;
          need -= n;
        }
        if (need > 0) { ok = false; break; }
      }
      const pay = comboPrice(c, sum);
      if (!ok || sum - pay <= 0.005) break;
      for (const [k, n] of taken) {
        left.set(k, (left.get(k) || 0) - n);
        used.set(k, (used.get(k) || 0) + n);
      }
      times++;
      regular += sum;
      paid += pay;
    }
    if (!times) continue;
    const byKey = new Map(lines.map((l) => [l.key, l]));
    out.push({
      id: c.id, name: c.name, times, price: round2(paid / times), total: round2(paid), ...(c.ratio !== undefined ? { ratio: c.ratio } : {}), regular: round2(regular),
      discount: round2(regular - paid),
      used: [...used].map(([key, quantity]) => ({ key, productId: byKey.get(key)!.productId, quantity, price: byKey.get(key)!.price })),
    });
  }
  return out;
}

/**
 * Lo que paga cada renglón del combo: el precio del combo repartido según lo que vale cada
 * producto suelto, en centavos justos (la suma da exacto el precio del combo).
 */
export function comboShares(use: ComboUse): { key: string; productId: string; quantity: number; price: number; total: number }[] {
  const cents = Math.round((use.total ?? use.times * use.price) * 100);
  const weights = use.used.map((u) => u.quantity * u.price);
  const sumW = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (cents * w) / sumW);
  const base = raw.map((r) => Math.floor(r));
  let rest = cents - base.reduce((s, b) => s + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length, rest--) base[order[k].i]++;
  return use.used.map((u, i) => ({ ...u, total: base[i] / 100 }));
}
