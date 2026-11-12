/**
 * Aviso de foto mala antes de subir una boleta (plan-boletas-ia.md, tanda 1.5).
 * Mira la foto en el navegador, sin subir nada: si está movida (borrosa), oscura o muy chica.
 * Nunca bloquea: la pantalla ofrece "Sacar de nuevo" o "Usar igual".
 *
 * Movida: varianza del laplaciano sobre la foto achicada a 800 px (una boleta nítida tiene muchos bordes
 * de letras; movida, casi ninguno). Oscura: brillo medio bajo. Chica: no da la resolución para leer
 * renglones de letra chica. Los umbrales son conservadores: mejor no avisar que avisar de más.
 */
export interface PhotoStats { width: number; height: number; brightness: number; sharpness: number }
export type PhotoProblem = 'movida' | 'oscura' | 'chica';

export const PHOTO_LIMITS = { sharpness: 30, brightness: 65, minSide: 700, maxSide: 1000 };

/** Qué problemas tiene una foto según sus números. Pura. */
export function judgePhoto(s: PhotoStats): PhotoProblem[] {
  const out: PhotoProblem[] = [];
  if (Math.max(s.width, s.height) < PHOTO_LIMITS.maxSide || Math.min(s.width, s.height) < PHOTO_LIMITS.minSide) out.push('chica');
  if (s.brightness < PHOTO_LIMITS.brightness) out.push('oscura');
  // Una foto oscura casi no tiene bordes: se avisa lo oscuro, que es la causa
  else if (s.sharpness < PHOTO_LIMITS.sharpness) out.push('movida');
  return out;
}

/** Brillo medio y nitidez de una imagen en escala de grises (ancho × alto). Pura. */
export function measureGray(gray: Uint8ClampedArray | number[], w: number, h: number): { brightness: number; sharpness: number } {
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += gray[i];
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      n++;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  return { brightness: w * h ? sum / (w * h) : 0, sharpness: n > 1 ? m2 / (n - 1) : 0 };
}

/** Mide una foto (File de imagen). null si el navegador no la puede abrir: en ese caso no se avisa nada. */
export async function photoStats(file: File): Promise<PhotoStats | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const m = measureGray(gray, w, h);
    const out = { width: bmp.width, height: bmp.height, ...m };
    bmp.close?.();
    return out;
  } catch {
    return null;
  }
}

export interface PhotoWarning { index: number; name: string; problems: PhotoProblem[] }

/** Las fotos con problemas (de una lista), con su número en la lista */
export async function checkPhotos(files: File[], offset = 0): Promise<PhotoWarning[]> {
  const out: PhotoWarning[] = [];
  for (let i = 0; i < files.length; i++) {
    const s = await photoStats(files[i]);
    const problems = s ? judgePhoto(s) : [];
    if (problems.length) out.push({ index: offset + i, name: files[i].name, problems });
  }
  return out;
}

const WHAT: Record<PhotoProblem, string> = { movida: 'está movida', oscura: 'está oscura', chica: 'es muy chica' };
/** "La foto 2 está movida y oscura" */
export function warningText(w: PhotoWarning, total: number) {
  const which = total === 1 ? 'La foto' : `La foto ${w.index + 1}`;
  const parts = w.problems.map((p) => WHAT[p]);
  return `${which} ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0]}`;
}
export const PHOTO_TIP = 'Puede que la IA no lea bien algunos renglones. Sacala de nuevo, de frente, con buena luz y sin mover el celular.';
