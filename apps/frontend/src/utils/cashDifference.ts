/**
 * Diferencia de un turno cerrado (Cierre X), igual que la calcula la pantalla de cierre
 * del cajero: efectivo contado + lo declarado en cada posnet, contra lo esperado.
 *
 *   diferencia total = diferencia de efectivo + Σ (declarado − esperado) de cada posnet
 *
 * Lo declarado en posnet puede estar en el resumen del cierre (arqueo hecho después) o en
 * las notas, después de "[METADATA]" (cierre desde la pantalla de ventas). Si el turno no
 * tiene nada declarado (cierres viejos, o cerrado sin arqueo de posnet) no se inventa una
 * diferencia de posnet: queda solo la de efectivo.
 *
 * Posnets: los configurados en esta PC (posnet_configs), Clover y Mercado Pago, y cualquier
 * otro que figure declarado. Transferencias o cuenta corriente no son posnet: no se declaran
 * al cerrar y no cuentan como faltante.
 */

const parseJson = (v: any) => {
  if (!v) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

const num = (v: any) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? undefined : Number(v));

function configuredPosnets(): string[] {
  const ids = ['CLOVER', 'MERCADOPAGO'];
  try {
    const stored = JSON.parse(localStorage.getItem('posnet_configs') || 'null');
    if (Array.isArray(stored)) for (const p of stored) if (p?.id && !ids.includes(p.id)) ids.push(p.id);
  } catch {}
  return ids;
}

export interface PosnetLine { method: string; expected: number; declared: number }

export function cashClosingResult(s: any) {
  const sum = parseJson(s?.closingSummary) || {};
  const raw = String(s?.closingNotes || '');
  const at = raw.search(/\[\s*metadata\s*\]/i);
  const notes = (at >= 0 ? raw.slice(0, at) : raw).trim();
  const meta: any = at >= 0 ? parseJson(raw.slice(at).replace(/^\[\s*metadata\s*\]/i, '').trim()) || {} : {};

  const declared: Record<string, number> = {};
  const fromMeta = meta.posnetDeclarations || {};
  const clover = num(fromMeta.CLOVER) ?? num(meta.virtualClover);
  if (clover !== undefined) declared.CLOVER = clover;
  const mp1 = num(fromMeta.MERCADOPAGO) ?? num(meta.virtualMP1);
  const mp2 = num(meta.virtualMP2);
  if (mp1 !== undefined || mp2 !== undefined) declared.MERCADOPAGO = (mp1 || 0) + (mp2 || 0);
  for (const [k, v] of Object.entries(fromMeta)) if (declared[k] === undefined && num(v) !== undefined) declared[k] = Number(v);
  // El arqueo posterior guarda lo declarado en el resumen: tiene prioridad
  for (const [k, v] of Object.entries(sum.posnetDeclarations || {})) if (num(v) !== undefined) declared[k] = Number(v);

  const hasPosnet = !!meta.posnetDeclarations || !!sum.posnetDeclarations
    || meta.virtualClover !== undefined || meta.virtualMP1 !== undefined || meta.virtualMP2 !== undefined;

  const methods = Array.from(new Set([...configuredPosnets(), ...Object.keys(declared)]));
  const breakdown = sum.paymentBreakdown || {};
  const posnets: PosnetLine[] = methods
    .map((k) => ({ method: k, expected: Number(breakdown[k]) || 0, declared: declared[k] ?? 0 }))
    .filter((r) => Math.abs(r.expected) >= 0.01 || Math.abs(r.declared) >= 0.01);
  const posnetDiff = hasPosnet ? posnets.reduce((t, r) => t + (r.declared - r.expected), 0) : 0;

  const counted = s?.closingAmountCounted !== null && s?.closingAmountCounted !== undefined;
  const cashDiff = counted ? (s.difference ?? ((s.closingAmountCounted ?? 0) - (s.closingAmountExpected ?? 0))) : 0;
  const posnetDeclared = hasPosnet ? posnets.reduce((t, r) => t + r.declared, 0) : 0;
  return {
    summary: sum, meta, notes, counted, cashDiff, hasPosnet, posnets, posnetDiff, posnetDeclared,
    totalDiff: cashDiff + posnetDiff,
    /** Efectivo contado + posnet declarado */
    totalDeclared: (counted ? Number(s.closingAmountCounted) || 0 : 0) + posnetDeclared,
  };
}
