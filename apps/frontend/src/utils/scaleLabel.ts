import { gtinCheckOk } from './scanCheck';

/**
 * Etiquetas de balanza (carnicería, fiambrería, verdulería).
 *
 * La balanza pesa, calcula el importe e imprime una etiqueta con un código EAN-13 que empieza con
 * 2 (códigos de uso interno: ningún producto de fábrica empieza así). Adentro trae el código del
 * producto en la balanza (PLU) y el importe a cobrar o el peso. Por ejemplo, con el formato de
 * fábrica de la mayoría de las balanzas argentinas:
 *
 *   2 0 | 0 0 0 1 2 | 1 5 0 0 0 | 7
 *   tipo   PLU 12     importe      verificador
 *          (cifras    $15.000
 *          3 a 7)
 *
 * Cada marca (y cada carnicero) lo configura distinto, así que el formato se guarda por comercio
 * (store_settings.scale_format) y en Configuración se detecta solo con una etiqueta de muestra
 * (`detectScaleFormat`).
 *
 * El PLU de cada producto es su código interno (SKU), o su código si es un número corto. Así no
 * hace falta ningún campo nuevo en la base ni en la sincronización.
 */

export interface ScaleFormat {
  /** Con qué empiezan las etiquetas ("2" toma del 20 al 29) */
  prefix: string;
  /** Dónde empieza el PLU (posición desde 0) y cuántas cifras tiene */
  pluStart: number;
  pluLen: number;
  /** Qué trae la etiqueta: el importe a cobrar o el peso */
  kind: 'price' | 'weight';
  /** Cuántas cifras tiene el importe o el peso: terminan justo antes del verificador */
  valueLen: number;
  /** Importe: cuántas de esas cifras son centavos (0 = pesos enteros). El peso viene siempre en gramos */
  decimals: number;
}

/** 2X PPPPP IIIII V: lo que trae de fábrica la mayoría de las balanzas que se usan en Argentina */
export const DEFAULT_SCALE_FORMAT: ScaleFormat = { prefix: '2', pluStart: 2, pluLen: 5, kind: 'price', valueLen: 5, decimals: 0 };

export const SCALE_FORMAT_KEY = 'ventra_scale_format';

const int = (v: unknown, min: number, max: number, def: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
};

/** Formato sano: el PLU y el valor no se pisan y todo entra en las 12 cifras antes del verificador. */
export function cleanScaleFormat(raw: Partial<ScaleFormat> | null | undefined): ScaleFormat {
  const d = DEFAULT_SCALE_FORMAT;
  const prefix = /^\d{1,3}$/.test(String(raw?.prefix ?? '')) ? String(raw!.prefix) : d.prefix;
  const kind = raw?.kind === 'weight' ? 'weight' : 'price';
  const valueLen = int(raw?.valueLen, 3, 7, d.valueLen);
  const pluStart = int(raw?.pluStart, 1, 4, d.pluStart);
  const pluLen = int(raw?.pluLen, 1, 7, d.pluLen);
  const decimals = kind === 'weight' ? 3 : int(raw?.decimals, 0, 2, 0);
  const f = { prefix, pluStart, pluLen, kind, valueLen, decimals } as ScaleFormat;
  return pluStart + pluLen <= 12 - valueLen ? f : { ...d };
}

export function readScaleFormat(): ScaleFormat {
  try { return cleanScaleFormat(JSON.parse(localStorage.getItem(SCALE_FORMAT_KEY) || 'null')); } catch { return { ...DEFAULT_SCALE_FORMAT }; }
}

export interface ScaleRead {
  /** PLU sin ceros adelante ("00012" → "12") */
  plu: string;
  kind: 'price' | 'weight';
  /** Importe impreso en la etiqueta (kind = price) */
  amount?: number;
  /** Peso en kilos (kind = weight) */
  kg?: number;
}

/** Lee una etiqueta de balanza. null si el código no es una etiqueta (o se leyó mal). */
export function parseScaleLabel(code: string, format: ScaleFormat = readScaleFormat()): ScaleRead | null {
  const c = String(code || '').trim();
  if (!/^\d{13}$/.test(c) || !c.startsWith(format.prefix) || !gtinCheckOk(c)) return null;
  const plu = String(Number(c.substr(format.pluStart, format.pluLen)));
  const raw = Number(c.substr(12 - format.valueLen, format.valueLen));
  if (!(Number(plu) > 0) || !(raw > 0)) return null;
  if (format.kind === 'weight') return { plu, kind: 'weight', kg: raw / 1000 };
  return { plu, kind: 'price', amount: raw / 10 ** format.decimals };
}

/** El dígito verificador que corresponde a las 12 primeras cifras (para armar etiquetas de prueba). */
export function eanCheckDigit(first12: string): string {
  let sum = 0;
  for (let i = first12.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(first12[i]) * w;
  return String((10 - (sum % 10)) % 10);
}

/** Arma una etiqueta como la imprimiría la balanza con este formato (práctica, pruebas y demo). */
export function buildScaleLabel(plu: number | string, value: number, format: ScaleFormat = readScaleFormat()): string {
  const raw = format.kind === 'weight' ? Math.round(value * 1000) : Math.round(value * 10 ** format.decimals);
  const head = format.prefix.padEnd(format.pluStart, '0').slice(0, format.pluStart);
  const pluPart = String(Number(plu)).padStart(format.pluLen, '0').slice(-format.pluLen);
  const gap = '0'.repeat(12 - format.pluStart - format.pluLen - format.valueLen);
  const first12 = head + pluPart + gap + String(raw).padStart(format.valueLen, '0').slice(-format.valueLen);
  return first12 + eanCheckDigit(first12);
}

/**
 * Formatos que explican una etiqueta de muestra: el dueño pasa una etiqueta y dice qué producto
 * es (su PLU) y qué importe o peso tiene impreso. Primero el más probable: PLU pegado al valor
 * (sin cifras de relleno), PLU después de las dos cifras de tipo (2X) y pesos enteros.
 */
export function detectScaleFormat(code: string, plu: string | number, value: { amount?: number; kg?: number }): ScaleFormat[] {
  const c = String(code || '').trim();
  const wantPlu = Number(plu);
  if (!/^\d{13}$/.test(c) || !c.startsWith('2') || !(wantPlu > 0)) return [];
  const out: { f: ScaleFormat; score: number }[] = [];
  for (const pluStart of [2, 1, 3]) {
    for (let pluLen = 3; pluLen <= 6; pluLen++) {
      if (Number(c.substr(pluStart, pluLen)) !== wantPlu) continue;
      for (const gap of [0, 1]) {
        const valueLen = 12 - pluStart - pluLen - gap;
        if (valueLen < 4 || valueLen > 7) continue;
        const raw = Number(c.substr(12 - valueLen, valueLen));
        if (value.kg != null) {
          if (Math.abs(raw / 1000 - value.kg) < 0.0005) out.push({ f: { prefix: '2', pluStart, pluLen, kind: 'weight', valueLen, decimals: 3 }, score: gap * 10 + (pluStart === 2 ? 0 : 1) });
        } else if (value.amount != null) {
          for (const decimals of [0, 2, 1]) {
            if (Math.abs(raw / 10 ** decimals - value.amount) < 0.005) {
              out.push({ f: { prefix: '2', pluStart, pluLen, kind: 'price', valueLen, decimals }, score: gap * 10 + (pluStart === 2 ? 0 : 1) + decimals * 0.1 });
            }
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.score - b.score).map((x) => x.f);
}

/** "Cifras 3 a 7: código · cifras 8 a 12: importe en pesos" (posiciones contando desde 1) */
export function describeScaleFormat(f: ScaleFormat): string {
  const from = f.pluStart + 1;
  const vFrom = 13 - f.valueLen;
  const what = f.kind === 'weight' ? 'peso en gramos' : f.decimals ? `importe con ${f.decimals} decimal${f.decimals > 1 ? 'es' : ''}` : 'importe en pesos';
  return `Empieza con ${f.prefix} · cifras ${from} a ${from + f.pluLen - 1}: código del producto · cifras ${vFrom} a 12: ${what} · la 13: verificador`;
}

/** Productos por su PLU: el código interno (SKU) o el código, si son un número corto. Los "por kilo" ganan. */
export function buildPluIndex(products: any[]): Map<string, any> {
  const map = new Map<string, any>();
  const put = (code: unknown, p: any) => {
    const s = String(code ?? '').trim();
    if (!/^\d{1,6}$/.test(s) || !(Number(s) > 0)) return;
    const key = String(Number(s));
    const cur = map.get(key);
    if (!cur || (cur.unit !== 'KG' && p.unit === 'KG')) map.set(key, p);
  };
  for (const p of products) if (p?.isActive !== false) put(p.sku, p);
  for (const p of products) if (p?.isActive !== false && !map.has(String(Number(p.barcode)))) put(p.barcode, p);
  return map;
}

/**
 * Cómo entra la etiqueta al ticket. Con el peso, entra el peso al precio del producto. Con el
 * importe, los kilos salen del precio por kilo (3 decimales, como toda la caja); si redondeando
 * los kilos el renglón no da el importe de la etiqueta (diferencia de $1 o más), se cobra lo que
 * dice la etiqueta con el precio ajustado: el cliente paga lo que ve impreso.
 */
export function scaleLine(price: number, read: ScaleRead): { qty: number; customPrice?: number } {
  if (read.kind === 'weight') return { qty: Math.max(0.001, Math.round((read.kg || 0) * 1000) / 1000) };
  const amount = read.amount || 0;
  if (!(price > 0)) return { qty: 1, customPrice: amount };
  const qty = Math.max(0.001, Math.round((amount / price) * 1000) / 1000);
  return Math.abs(qty * price - amount) < 1 ? { qty } : { qty, customPrice: amount / qty };
}
