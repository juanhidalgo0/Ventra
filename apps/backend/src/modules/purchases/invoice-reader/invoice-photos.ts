/**
 * Fotos de las boletas escaneadas (2026-11-26): se guardan en la caja con la compra que queda "Por
 * revisar", así la revisión visual muestra el pedacito de foto de cada renglón aunque la boleta se haya
 * escaneado en otro aparato (el celular, otra PC). Ya achicadas (≤ 2000 px, ~200 KB cada una).
 *
 * Carpeta ventra-invoice-photos/<id de la compra>/<n>.jpg, con n la posición de la foto en el
 * comprobante (el mismo orden que draft.images). Se borran a los 60 días, o al descartar la compra.
 */
import * as fs from 'fs';
import * as path from 'path';

const DIR = path.join(process.cwd(), 'ventra-invoice-photos');
const KEEP_MS = 60 * 864e5;
const safeId = (id: string) => /^[a-zA-Z0-9-]{8,64}$/.test(String(id || ''));

/** Guarda las fotos de una compra (base64), en orden. No frena nada si falla. Devuelve cuántas guardó. */
export function savePhotos(purchaseId: string, images: { data?: string; mediaType?: string }[]): number {
  if (!safeId(purchaseId) || !Array.isArray(images) || !images.length) return 0;
  try {
    const dir = path.join(DIR, purchaseId);
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    images.slice(0, 30).forEach((im, k) => {
      if (!im || typeof im.data !== 'string' || !im.data) return;
      fs.writeFileSync(path.join(dir, `${k}.jpg`), Buffer.from(im.data, 'base64'));
      n++;
    });
    return n;
  } catch {
    return 0;
  }
}

/** Cuántas fotos tiene guardadas una compra (las posiciones 0..n-1) */
export function photoCount(purchaseId: string): number {
  if (!safeId(purchaseId)) return 0;
  try {
    return fs.readdirSync(path.join(DIR, purchaseId)).filter((f) => /^\d+\.jpg$/.test(f)).length;
  } catch {
    return 0;
  }
}

/** La foto n de una compra, o null */
export function readPhoto(purchaseId: string, n: number): Buffer | null {
  if (!safeId(purchaseId) || !Number.isInteger(n) || n < 0 || n > 99) return null;
  try {
    return fs.readFileSync(path.join(DIR, purchaseId, `${n}.jpg`));
  } catch {
    return null;
  }
}

/** Las fotos de otra compra pasan a esta (la pendiente se confirma como compra nueva, con otro id) */
export function movePhotos(fromId: string, toId: string) {
  if (!safeId(fromId) || !safeId(toId) || fromId === toId) return;
  try {
    const from = path.join(DIR, fromId);
    if (!fs.existsSync(from)) return;
    fs.renameSync(from, path.join(DIR, toId));
  } catch { /* quedan donde estaban: se borran solas a los 60 días */ }
}

export function removePhotos(purchaseId: string) {
  if (!safeId(purchaseId)) return;
  try { fs.rmSync(path.join(DIR, purchaseId), { recursive: true, force: true }); } catch { /* ya no estaban */ }
}

/** Borra las carpetas de más de 60 días */
export function cleanupPhotos(now = Date.now()) {
  try {
    if (!fs.existsSync(DIR)) return;
    for (const d of fs.readdirSync(DIR)) {
      const p = path.join(DIR, d);
      try { if (now - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { recursive: true, force: true }); } catch { /* sigue con la otra */ }
    }
  } catch { /* sin carpeta */ }
}
