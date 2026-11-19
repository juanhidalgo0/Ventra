/**
 * Combos (promos FIXED_COMBO) en los pedidos: "estos productos juntos a precio fijo", de un solo
 * grupo (12 empanadas de cualquier gusto) o de varios (lavandina + detergente).
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
  /** Precio del combo entero (para el cliente: minorista o mayorista) */
  price: number;
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
  /** Precio de un combo */
  price: number;
  /** Lo que valen esas unidades sueltas */
  regular: number;
  discount: number;
  /** Unidades usadas de cada renglón */
  used: { key: string; productId: string; quantity: number; price: number }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Los combos vigentes de Promociones con el precio del cliente (el mayorista si es de esa lista y
 * el combo lo tiene). `keep`: combos que ya estaban en el pedido, que siguen valiendo aunque la
 * promo se haya pausado o vencido después (como el precio de un producto ya pedido).
 */
export function combosFromPromotions(promos: any[], opts: { trade?: boolean; now?: number; keep?: Set<string> } = {}): ComboDef[] {
  const now = opts.now ?? Date.now();
  const out: ComboDef[] = [];
  for (const pr of promos || []) {
    if (!pr || pr.type !== 'FIXED_COMBO') continue;
    const kept = !!opts.keep?.has(String(pr.id));
    if (!kept) {
      if (pr.isActive === false) continue;
      if (pr.startDate && new Date(pr.startDate).getTime() > now) continue;
      if (pr.endDate && new Date(pr.endDate).getTime() < now) continue;
    }
    const trade = opts.trade && Number(pr.tradeFixedPrice) > 0 ? Number(pr.tradeFixedPrice) : 0;
    const price = trade || Number(pr.fixedPrice);
    if (!(price > 0)) continue;
    const groups = new Map<string, { qty: number; productIds: string[] }>();
    (pr.products || []).forEach((pp: any, idx: number) => {
      const gid = pp.groupId || `single_${pp.productId}_${idx}`;
      if (!groups.has(gid)) groups.set(gid, { qty: Math.max(1, Math.round(Number(pp.quantity) || 1)), productIds: [] });
      groups.get(gid)!.productIds.push(String(pp.productId));
    });
    const list = [...groups.values()];
    const units = list.reduce((s, g) => s + g.qty, 0);
    // Un solo producto suelto a un precio no es un combo
    if (!list.length || units < 2) continue;
    let maxTimes: number | undefined;
    if (!kept && pr.limitType === 'STOCK' && pr.limitStock != null) {
      maxTimes = Math.floor(Math.max(0, Number(pr.limitStock) - (Number(pr.soldStock) || 0)) / units);
      if (maxTimes <= 0) continue;
    }
    out.push({ id: String(pr.id), name: String(pr.name || 'Combo'), price, groups: list, ...(maxTimes !== undefined ? { maxTimes } : {}) });
  }
  return out;
}

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
      if (!ok || sum - c.price <= 0.005) break;
      for (const [k, n] of taken) {
        left.set(k, (left.get(k) || 0) - n);
        used.set(k, (used.get(k) || 0) + n);
      }
      times++;
      regular += sum;
    }
    if (!times) continue;
    const byKey = new Map(lines.map((l) => [l.key, l]));
    out.push({
      id: c.id, name: c.name, times, price: c.price, regular: round2(regular),
      discount: round2(regular - times * c.price),
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
  const cents = Math.round(use.times * use.price * 100);
  const weights = use.used.map((u) => u.quantity * u.price);
  const sumW = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (cents * w) / sumW);
  const base = raw.map((r) => Math.floor(r));
  let rest = cents - base.reduce((s, b) => s + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length, rest--) base[order[k].i]++;
  return use.used.map((u, i) => ({ ...u, total: base[i] / 100 }));
}
