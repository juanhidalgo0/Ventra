import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * La clave privada del certificado del comercio se guarda cifrada (AES-256-GCM) con una llave
 * propia de cada comercio que vive en Firebase, no en la base. Así la copia de la nube (Neon) y
 * las otras cajas solo ven texto cifrado; cada caja vinculada pide la llave a Ventra una vez y
 * la guarda en su equipo (fuera de la base, no viaja con la sincronización).
 */
const PREFIX = 'enc:v1:';

export const isSealed = (value: string | null | undefined) => typeof value === 'string' && value.startsWith(PREFIX);

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function openSecret(sealed: string, key: Buffer): string {
  const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
