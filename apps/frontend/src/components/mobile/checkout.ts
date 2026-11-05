/**
 * Recargos por medio de pago, con la misma regla que PaymentModal (POS de PC):
 * cada categoría puede tener un % para ciertos medios; efectivo y cuenta corriente no llevan.
 * El recargo por unidad se redondea al peso, igual que en la PC, para que el total coincida.
 */
export function applySurcharges(
  baseItems: { productId: string; quantity: number; discount: number; price?: number; categoryId?: string }[],
  products: any[],
  surcharges: { categoryId: string; paymentMethods: string[]; percentage: number }[],
  method: string,
) {
  let totalSurcharge = 0;
  const items = baseItems.map((item) => {
    if (method === 'CASH' || method === 'DEBT') return { ...item };
    const product = products.find((p) => p.id === item.productId);
    const categoryId = item.categoryId || product?.categoryId;
    if (!categoryId) return { ...item };
    const match = surcharges.find((s) => s.categoryId === categoryId && s.paymentMethods.includes(method));
    if (!match || !match.percentage) return { ...item };
    const originalPrice = item.price ?? (product ? product.salePrice : 0);
    const perUnit = Math.round(originalPrice * (match.percentage / 100));
    totalSurcharge += perUnit * item.quantity;
    return { ...item, price: originalPrice + perUnit };
  });
  return { items, totalSurcharge };
}

/** Medios de cobro configurados en el comercio (los mismos posnets que usa la PC). */
export function getPaymentMethods() {
  let posnets: { id: string; name: string }[] = [
    { id: 'CLOVER', name: 'Clover' },
    { id: 'MERCADOPAGO', name: 'Mercado Pago' },
  ];
  try {
    const stored = localStorage.getItem('posnet_configs');
    if (stored) posnets = JSON.parse(stored);
  } catch { /* se usan los de siempre */ }
  return [{ id: 'CASH', name: 'Efectivo' }, ...posnets, { id: 'DEBT', name: 'Cuenta corriente' }];
}

export type ManualSurcharge = { mode: 'FIXED' | 'PCT'; value: number; reason: string };

/**
 * Recargo puesto a mano al cobrar (barra, servicio, envío): monto fijo o porcentaje sobre el
 * ticket. Se reparte entre los productos según lo que vale cada renglón (sin el recargo por
 * medio de pago), así cada uno queda vendido más caro y la ganancia de los reportes sale bien.
 * Lo usan la caja de la PC (PaymentModal) y la del celular.
 */
export function applyManualSurcharge<T extends { productId: string; quantity: number; discount?: number; price?: number }>(
  baseItems: T[],
  adjustedItems: T[],
  products: any[] | undefined,
  surcharge: ManualSurcharge | null,
) {
  const priceOf = (item: T) => item.price ?? (products?.find((p: any) => p.id === item.productId)?.salePrice || 0);
  const lineBase = (item: T) => Math.max(0, priceOf(item) * item.quantity - (item.discount || 0));
  const baseSum = baseItems.reduce((s, it) => s + lineBase(it), 0);
  if (!surcharge || !(surcharge.value > 0) || baseSum <= 0) return { items: adjustedItems, manualTotal: 0 };
  let manualTotal = 0;
  const items = adjustedItems.map((item, index) => {
    const base = lineBase(baseItems[index]);
    if (base <= 0 || !item.quantity) return item;
    const lineExtra = surcharge.mode === 'PCT' ? base * surcharge.value / 100 : surcharge.value * base / baseSum;
    const perUnit = Math.round((lineExtra / item.quantity) * 100) / 100;
    manualTotal += perUnit * item.quantity;
    return { ...item, price: Math.round((priceOf(item) + perUnit) * 100) / 100 };
  });
  // Monto fijo: los centavos que se pierden al redondear por unidad los absorbe el renglón con
  // menos unidades (con uno de 1 unidad queda exacto)
  if (surcharge.mode === 'FIXED') {
    const diff = Math.round((surcharge.value - manualTotal) * 100) / 100;
    const candidates = items.map((it, i) => i).filter((i) => lineBase(baseItems[i]) > 0 && items[i].quantity > 0);
    const idx = candidates.sort((a, b) => items[a].quantity - items[b].quantity)[0];
    if (diff !== 0 && idx !== undefined) {
      const it = items[idx];
      const fix = Math.round((diff / it.quantity) * 100) / 100;
      items[idx] = { ...it, price: Math.round((priceOf(it) + fix) * 100) / 100 };
      manualTotal += fix * it.quantity;
    }
  }
  return { items, manualTotal: Math.round(manualTotal * 100) / 100 };
}

/** Lo que queda escrito en la venta y sale en el ticket: "Recargo +$40.000 · Barra evento" */
export function manualSurchargeNote(surcharge: ManualSurcharge | null, manualTotal: number, money: (n: number) => string) {
  if (!surcharge || manualTotal <= 0) return undefined;
  const how = surcharge.mode === 'PCT' ? ` (${surcharge.value}%)` : '';
  return `Recargo +${money(manualTotal)}${how}${surcharge.reason ? ` · ${surcharge.reason}` : ''}`;
}

/** Lee lo que se escribió: en pesos el punto separa miles ("40.000"); en %, punto o coma son decimales */
export function parseSurchargeValue(mode: 'FIXED' | 'PCT', raw: string) {
  const s = String(raw || '').trim();
  return Number(mode === 'FIXED' ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.'));
}

/** Recargo a mano escrito en las notas de una venta ("Recargo +$ 40.000,00 · Barra"), o null */
export function manualSurchargeOfNotes(notes?: string | null): { amount: number; reason: string } | null {
  const line = String(notes || '').split('\n').find((l) => l.startsWith('Recargo +'));
  if (!line) return null;
  const m = line.match(/^Recargo \+\D*([\d.]+(?:,\d+)?)/);
  if (!m) return null;
  const amount = Number(m[1].replace(/\./g, '').replace(',', '.'));
  const reason = line.includes(' · ') ? line.slice(line.indexOf(' · ') + 3) : '';
  return Number.isFinite(amount) && amount > 0 ? { amount, reason } : null;
}
