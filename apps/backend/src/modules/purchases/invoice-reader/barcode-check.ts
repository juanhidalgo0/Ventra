/**
 * ¿Es un código de barras de verdad o el código interno del proveedor?
 *
 * Un código de barras (EAN-13, EAN-8, UPC-A) identifica al producto en cualquier comercio. El código
 * del proveedor (el "ARTICULO" de Nini, el "Cód." de un distribuidor) solo sirve con ese proveedor y
 * va al SKU / supplier_codes. Si un código interno se guarda como código de barras, el lector de la
 * caja nunca lo encuentra y la foto por código trae cualquier cosa. Por eso, ante la duda, NO es
 * código de barras.
 *
 * Controles:
 *   1. Solo dígitos y largo de EAN-8 (8), UPC-A (12) o EAN-13 (13). Los de 10 u 11 dígitos, no.
 *   2. Dígito verificador correcto (el último): un número cualquiera lo cumple 1 de cada 10 veces.
 *   3. Prefijo GS1 de producto: los de uso interno (2xx, 02x, 04x), cupones (05x, 98x, 99x) y los que
 *      empiezan con muchos ceros (rellenos de un código corto) no son de producto.
 *   4. Patrones de numeración interna: todos iguales, 12345678…
 *   5. En la boleta entera (splitInvoiceCodes): si la columna de códigos es de barras, casi todos
 *      pasan los controles; si la mayoría no pasa, es una columna de códigos internos y los pocos que
 *      pasaron fue de casualidad (pasa con el ~10%), así que tampoco se toman como código de barras.
 *
 * El prefijo 779 (Argentina) suma confianza pero no se exige: lo importado trae otros (789 Brasil,
 * 750 México, 7790… no siempre).
 */

/** Dígito verificador GS1 (el mismo cálculo para EAN-8, UPC-A y EAN-13) */
export function gs1CheckDigitOk(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** El motivo por el que no es un código de barras de producto, o null si lo es */
export function barcodeProblem(code: string | null | undefined): string | null {
  const c = String(code ?? '').trim();
  if (!c) return 'vacío';
  if (!/^\d+$/.test(c)) return 'tiene letras o signos';
  if (![8, 12, 13].includes(c.length)) return `tiene ${c.length} dígitos (un código de barras tiene 8, 12 o 13)`;
  if (!gs1CheckDigitOk(c)) return 'el dígito verificador no da';
  if (/^(\d)\1+$/.test(c)) return 'todos los dígitos iguales';
  // Números seguidos (sin contar el dígito verificador): 1234567-0, 012345678901-2
  const body = c.slice(0, -1);
  if ('0123456789012345'.includes(body) || '9876543210987654'.includes(body)) return 'números seguidos';
  if (c.length === 8) {
    // EAN-8 que empiezan con 0 o 2: numeración interna del comercio (balanzas, códigos propios)
    if (c[0] === '0' || c[0] === '2') return 'EAN-8 de uso interno';
    return null;
  }
  const ean13 = c.length === 12 ? `0${c}` : c;
  // Muchos ceros adelante: un código corto rellenado con ceros (código interno o EAN-8 de uso interno)
  if (/^00000/.test(ean13)) return 'empieza con muchos ceros (código corto rellenado)';
  const p3 = Number(ean13.slice(0, 3));
  if (p3 >= 20 && p3 <= 29) return 'prefijo de uso interno del comercio';
  if (p3 >= 40 && p3 <= 49) return 'prefijo de uso interno';
  if (p3 >= 50 && p3 <= 59) return 'prefijo de cupones';
  if (p3 >= 200 && p3 <= 299) return 'prefijo de uso interno (balanzas, códigos propios)';
  if (p3 >= 980) return 'prefijo de cupones o vales';
  return null;
}

/** Código de barras de producto de verdad (ver los controles arriba) */
export function isBarcode(code: string | null | undefined): boolean {
  return barcodeProblem(code) === null;
}

/** Argentina (GS1 779): suma confianza, no se exige */
export const isArgentineBarcode = (code: string) => isBarcode(code) && (code.length === 13 ? code : `0${code}`).startsWith('779');

/** Cuántos de la columna tienen que pasar para creer que es una columna de códigos de barras */
const COLUMN_MIN_SHARE = 0.7;

/** ¿Esta columna de códigos (todos los renglones de una boleta) es de códigos de barras? */
export function columnLooksLikeBarcodes(codes: string[]): boolean {
  const filled = codes.map((c) => String(c || '').trim()).filter(Boolean);
  if (!filled.length) return false;
  const good = filled.filter(isBarcode).length;
  // Con uno o dos códigos no hay columna para comparar: vale el control de cada uno
  if (filled.length < 3) return good === filled.length;
  return good / filled.length >= COLUMN_MIN_SHARE;
}

/**
 * Los códigos de los renglones de una boleta, separados en código de barras y código del proveedor.
 * rawBarcode / rawSku son lo que leyó la IA (o el lector de PDF/Excel), que a veces los pone cambiados.
 * Un código que no queda como código de barras se conserva como código del proveedor: no se pierde.
 */
export function splitInvoiceCodes(rows: { barcode?: string | null; sku?: string | null }[]): { barcode: string; sku: string }[] {
  const raw = rows.map((r) => ({ barcode: String(r.barcode ?? '').trim(), sku: String(r.sku ?? '').trim() }));
  const barcodeCol = columnLooksLikeBarcodes(raw.map((r) => r.barcode));
  const skuCol = columnLooksLikeBarcodes(raw.map((r) => r.sku));
  return raw.map(({ barcode: b, sku: s }) => {
    const barcode = barcodeCol && isBarcode(b) ? b : skuCol && isBarcode(s) ? s : '';
    // El que no quedó como código de barras es el código del proveedor (el SKU tiene prioridad)
    const sku = s && s !== barcode ? s : b && b !== barcode ? b : '';
    return { barcode, sku };
  });
}
