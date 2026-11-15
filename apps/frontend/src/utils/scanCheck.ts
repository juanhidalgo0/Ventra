/**
 * ¿El lector leyó bien el código? Se usa en la caja cuando un código no está en el catálogo, para
 * no abrir la ventana de "producto nuevo" con una lectura mala de un producto que sí existe.
 *
 * - Los códigos de comercio (EAN-13, EAN-8, UPC-A de 12 y GTIN-14) traen un dígito verificador al
 *   final: si la cuenta no da, el lector se comió o cambió una cifra.
 * - Si es un código conocido al que le faltan 1 o 2 cifras (al principio o al final), también es una
 *   lectura cortada.
 * Los códigos internos del comercio (letras, o largos que no son de comercio) no se juzgan.
 */

/** Dígito verificador GTIN (módulo 10, pesos 3 y 1 desde la derecha sin contar el último) */
export function gtinCheckOk(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** ok: false = lectura mala; similar: el código conocido al que se parece, si hay uno */
export type ScanVerdict = { ok: boolean; reason?: 'check' | 'cut'; similar?: string };

/**
 * known: los códigos del catálogo en memoria (en mayúsculas). Solo se recorre cuando el código no
 * se encontró, así que no frena el escaneo normal.
 */
export function judgeScan(code: string, known: Iterable<string>): ScanVerdict {
  const c = code.trim();
  if (!/^\d+$/.test(c)) return { ok: true };
  if ([8, 12, 13, 14].includes(c.length) && !gtinCheckOk(c)) {
    // Si además se parece a uno conocido (una sola cifra distinta), se dice cuál
    return { ok: false, reason: 'check', similar: oneDigitAway(c, known) };
  }
  if (c.length >= 6 && c.length <= 13) {
    for (const k of known) {
      const extra = k.length - c.length;
      if (extra >= 1 && extra <= 2 && /^\d+$/.test(k) && (k.startsWith(c) || k.endsWith(c))) {
        return { ok: false, reason: 'cut', similar: k };
      }
    }
  }
  return { ok: true };
}

function oneDigitAway(c: string, known: Iterable<string>): string | undefined {
  for (const k of known) {
    if (k.length !== c.length) continue;
    let diff = 0;
    for (let i = 0; i < c.length && diff < 2; i++) if (k[i] !== c[i]) diff++;
    if (diff === 1) return k;
  }
  return undefined;
}
