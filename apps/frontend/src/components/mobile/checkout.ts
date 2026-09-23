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
