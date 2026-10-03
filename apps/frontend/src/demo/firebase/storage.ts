// SOLO DEMO PÚBLICA: reemplaza a 'firebase/storage' (ver firestore.ts). Las fotos quedan en el
// navegador (como data URL): no se sube nada.
export type FirebaseStorage = { __demo: true };
type Ref = { fullPath: string };
const files = new Map<string, string>();

export const getStorage = (_app?: any): FirebaseStorage => ({ __demo: true });
export const ref = (_storage: any, path: string): Ref => ({ fullPath: path });
export async function uploadBytes(r: Ref, blob: Blob) {
  const url = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  files.set(r.fullPath, url);
  return { ref: r };
}
export async function getDownloadURL(r: Ref) {
  const url = files.get(r.fullPath);
  if (!url) throw new Error('Archivo inexistente en la demo');
  return url;
}
export async function deleteObject(r: Ref) { files.delete(r.fullPath); }
