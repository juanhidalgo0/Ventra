/**
 * Fotos de boletas sacadas con el celular (2026-11-14): una foto de cámara pesa 3 a 8 MB y con datos
 * móviles tardaba más en subir que en leerse. Se achica en el teléfono a 2600 px del lado largo (lo que
 * usa el lector del QR de ARCA; la IA lee a 2000) y queda en ~0,5-1 MB, sin perder lo que hace falta.
 * También se arma una miniatura chica para la pantalla: mostrar la foto entera en cada cuadradito
 * obligaba al teléfono a abrir varias fotos de 12 MP y trababa la app.
 */
export const UPLOAD_MAX_SIDE = 2600;
const THUMB_SIDE = 320;

export interface PreparedPhoto { file: File; thumb: string }

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

function draw(bmp: ImageBitmap, maxSide: number): HTMLCanvasElement | null {
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Achica una foto para subir y arma su miniatura. Si el navegador no la puede abrir, va tal cual. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bmp: ImageBitmap | null = null;
  try {
    // La orientación de la cámara (EXIF) se respeta: la foto queda derecha
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as any).catch(() => createImageBitmap(file));
    const thumbCanvas = draw(bmp, THUMB_SIDE);
    const thumbBlob = thumbCanvas ? await toBlob(thumbCanvas, 0.7) : null;
    const thumb = URL.createObjectURL(thumbBlob || file);
    // Ya es chica y liviana: no se toca (achicarla de nuevo solo pierde calidad)
    if (Math.max(bmp.width, bmp.height) <= UPLOAD_MAX_SIDE && file.size <= 1_500_000) return { file, thumb };
    const big = draw(bmp, UPLOAD_MAX_SIDE);
    const blob = big ? await toBlob(big, 0.86) : null;
    // Libera la memoria del lienzo grande (en Android con poca memoria se nota)
    if (big) { big.width = 0; big.height = 0; }
    if (!blob || blob.size >= file.size) return { file, thumb };
    const name = (file.name || 'boleta').replace(/\.[a-z0-9]+$/i, '') + '.jpg';
    return { file: new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }), thumb };
  } catch {
    return { file, thumb: URL.createObjectURL(file) };
  } finally {
    bmp?.close?.();
  }
}
