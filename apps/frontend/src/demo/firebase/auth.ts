// SOLO DEMO PÚBLICA: reemplaza a 'firebase/auth' (ver firestore.ts). Una sesión fija, local:
// es la dueña de la tienda y la agenda de ejemplo (seed.ts).
import { DEMO_UID, DEMO_STORE_ID } from '../seed';

export type User = { uid: string; isAnonymous: boolean; email: string | null; getIdToken: () => Promise<string> };
const user: User = { uid: DEMO_UID, isAnonymous: true, email: null, getIdToken: async () => 'demo' };
const auth = { currentUser: null as User | null };

export const getAuth = (_app?: any) => auth;
// La tienda de ejemplo es la de este equipo (clave STORE_ID_KEY de ventraFirebase.ts)
function signIn() {
  try { if (!localStorage.getItem('ventra_store_id')) localStorage.setItem('ventra_store_id', DEMO_STORE_ID); } catch { /* sin almacenamiento */ }
  auth.currentUser = user;
  return { user };
}
export async function signInAnonymously(_auth?: any) { return signIn(); }
export async function signInWithCustomToken(_auth?: any, _token?: string) { return signIn(); }
export function onAuthStateChanged(_auth: any, next: (u: User | null) => void) {
  queueMicrotask(() => next(auth.currentUser));
  return () => {};
}
export async function signOut() { auth.currentUser = null; }
