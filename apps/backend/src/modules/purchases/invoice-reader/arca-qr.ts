import { Jimp } from 'jimp';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jsQR = require('jsqr');

/**
 * QR de la factura electrónica de ARCA (plan-boletas-ia.md, tanda 1.4).
 *
 * Especificación oficial ("Especificaciones del QR incluido en las facturas electrónicas", versión 1,
 * arca.gob.ar/fe/qr): el QR codifica {URL}?p={JSON en Base64}, con URL https://www.arca.gob.ar/fe/qr/
 * (las facturas viejas: https://www.afip.gob.ar/fe/qr/). El JSON trae:
 *   ver, fecha (AAAA-MM-DD), cuit (emisor, 11 dígitos), ptoVta, tipoCmp (tabla de comprobantes),
 *   nroCmp, importe (total, en la moneda del comprobante), moneda ("PES", "DOL"…), ctz (cotización),
 *   tipoDocRec y nroDocRec (receptor, "de corresponder"), tipoCodAut ("E" CAE / "A" CAEA), codAut.
 *
 * Se lee en la caja sobre la foto ORIGINAL (achicada a 2000 px, un QR chico de la esquina no se lee).
 * Si no se lee, todo sigue como siempre.
 */
export interface ArcaQr {
  ver: number;
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: string;
  ctz: number;
  tipoDocRec?: number;
  nroDocRec?: number;
  tipoCodAut?: string;
  codAut?: number;
}

/** Texto del QR → datos del comprobante, o null si no es un QR de ARCA válido. Pura. */
export function parseArcaQrText(text: string): ArcaQr | null {
  const raw = String(text || '').trim();
  if (!/(afip|arca)\.gob\.ar\/fe\/qr/i.test(raw)) return null;
  const m = raw.match(/[?&]p=([^&#\s]+)/);
  if (!m) return null;
  let b64 = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (b64.length % 4) b64 += '=';
  let data: any;
  try {
    data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const cuit = Number(String(data.cuit ?? '').replace(/\D/g, ''));
  const out: ArcaQr = {
    ver: Number(data.ver) || 1,
    fecha: String(data.fecha || '').slice(0, 10),
    cuit,
    ptoVta: Math.trunc(Number(data.ptoVta)),
    tipoCmp: Math.trunc(Number(data.tipoCmp)),
    nroCmp: Math.trunc(Number(data.nroCmp)),
    importe: Number(data.importe) || 0,
    moneda: String(data.moneda || 'PES').toUpperCase().slice(0, 3),
    ctz: Number(data.ctz) || 1,
    tipoDocRec: data.tipoDocRec != null ? Math.trunc(Number(data.tipoDocRec)) : undefined,
    nroDocRec: data.nroDocRec != null ? Number(String(data.nroDocRec).replace(/\D/g, '')) : undefined,
    tipoCodAut: data.tipoCodAut != null ? String(data.tipoCodAut).slice(0, 1) : undefined,
    codAut: data.codAut != null ? Number(data.codAut) : undefined,
  };
  if (String(out.cuit).length !== 11 || !(out.ptoVta > 0) || !(out.nroCmp > 0) || !(out.tipoCmp > 0)) return null;
  return out;
}

const CREDIT = new Set([3, 8, 13, 21, 53, 203, 208, 213]);
const DEBIT = new Set([2, 7, 12, 20, 52, 202, 207, 212]);
/** Qué es el comprobante según su tipo (tabla de comprobantes de ARCA). Pura. */
export function qrKind(q: Pick<ArcaQr, 'tipoCmp'>): 'factura' | 'nota de crédito' | 'nota de débito' {
  return CREDIT.has(q.tipoCmp) ? 'nota de crédito' : DEBIT.has(q.tipoCmp) ? 'nota de débito' : 'factura';
}
/** Total a pagar en pesos (una factura en dólares, a la cotización que dice). Pura. */
export const qrTotalPesos = (q: Pick<ArcaQr, 'importe' | 'moneda' | 'ctz'>) =>
  Math.round((q.moneda === 'PES' ? q.importe : q.importe * (q.ctz || 1)) * 100) / 100;

/** Busca el QR de ARCA en una foto. Prueba a dos tamaños (el QR es chico y la foto grande). Nunca tira error. */
export async function readArcaQr(buffer: Buffer): Promise<ArcaQr | null> {
  try {
    const img = await Jimp.read(buffer);
    for (const side of [2600, 1400]) {
      const copy = img.clone();
      if (copy.width > side || copy.height > side) {
        if (copy.width >= copy.height) copy.resize({ w: side }); else copy.resize({ h: side });
      }
      const { data, width, height } = copy.bitmap;
      const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height, { inversionAttempts: 'dontInvert' });
      const parsed = code ? parseArcaQrText(code.data) : null;
      if (parsed) return parsed;
    }
  } catch { /* formato que no se abre (webp) o foto rota: sin QR */ }
  return null;
}
