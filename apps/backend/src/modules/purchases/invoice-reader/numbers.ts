/** Números como los imprimen las boletas argentinas: "1.226.212,81", "46480,65", "$ 929,61", "5,00 %" */

const NUMBER_RE = /^[-−]?\s*\$?\s*[-−]?\d[\d.,\s]*%?$/;

export function isNumberText(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!NUMBER_RE.test(t)) return false;
  // "30343-B" o "01-02" no son importes
  return /\d/.test(t) && !/\d\s*-\s*\d/.test(t);
}

export function parseArNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value).trim().replace(/[−]/g, '-');
  const negative = /^-|-$/.test(s.replace(/[\s$%]/g, '')) || /^\(.*\)$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es el decimal: 1.234,56 (AR) o 1,234.56 (US)
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Solo coma: en Argentina es decimal (929,61). Varias comas = miles (1,234,567),
    // salvo que el último grupo no tenga 3 cifras ("23,000,50": la última es la decimal)
    const groups = s.split(',');
    if (groups.length === 2) s = s.replace(',', '.');
    else s = groups[groups.length - 1].length === 3 ? groups.join('') : `${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`;
  } else if (lastDot >= 0) {
    // Solo punto: "1.500" o "1.226.212" son miles; "929.61" es decimal;
    // "23.000.00" (transcripciones) tiene miles y decimal con punto
    const groups = s.split('.');
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = groups.join('');
    else if (groups.length > 2) s = `${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`;
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Iguales a efectos de una boleta: solo diferencias de redondeo (unos centavos) */
export function closeEnough(a: number, b: number, abs = 1): boolean {
  return Math.abs(a - b) <= abs;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
