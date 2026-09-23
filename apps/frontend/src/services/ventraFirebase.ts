import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, type User } from 'firebase/auth';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Proyecto Firebase propio de Ventra (separado de GoDelivery). Esta config es
// pública por diseño: la seguridad la dan las reglas de Firestore (firebase/firestore.rules).
const firebaseConfig = {
  apiKey: 'AIzaSyCFiHwebmIbwqVjaW0nu6_Swb646zFyX8k',
  authDomain: 'ventra-9cba5.firebaseapp.com',
  projectId: 'ventra-9cba5',
  storageBucket: 'ventra-9cba5.firebasestorage.app',
  messagingSenderId: '23136382753',
  appId: '1:23136382753:web:5d2f4115a77a607435d860',
};

function getVentraApp(): FirebaseApp {
  const existing = getApps().find((a) => a.name === 'ventra');
  return existing ?? initializeApp(firebaseConfig, 'ventra');
}

export function getVentraDb(): Firestore {
  return getFirestore(getVentraApp());
}

export function getVentraStorage(): FirebaseStorage {
  return getStorage(getVentraApp());
}

let signingIn: Promise<User> | null = null;
/**
 * 'account': equipo vinculado, se entra con la cuenta del comercio.
 * 'device': PC sin vincular (gratis), la tienda queda atada a este equipo.
 * null: todavía no se sabe (se pregunta al backend).
 */
let mode: 'account' | 'device' | null = null;

/** Clave donde cada equipo recuerda el id de su tienda online. */
export const STORE_ID_KEY = 'ventra_store_id';

function waitForRestoredUser(): Promise<User | null> {
  const auth = getAuth(getVentraApp());
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => { unsub(); resolve(user); }, reject);
  });
}

/**
 * Sesión de Firebase para la tienda online.
 *
 * Si esta instalación está vinculada a una cuenta de Ventra, se entra CON LA CUENTA
 * (el backend pide un token a la nube con la vinculación de la PC): la tienda es del
 * comercio y se administra igual desde la PC, el celular o la caja en la nube. La
 * primera vez, la tienda que este equipo tenía con su sesión anónima pasa a la cuenta.
 *
 * Sin vinculación (PC libre) se sigue usando la sesión anónima guardada en el equipo.
 */
export function ensureVentraSession(): Promise<User> {
  const auth = getAuth(getVentraApp());
  const current = auth.currentUser;
  if (current && ((mode === 'account' && !current.isAnonymous) || mode === 'device')) return Promise.resolve(current);
  if (signingIn) return signingIn;
  signingIn = (async () => {
    const restored = await waitForRestoredUser();
    // Import dinámico: api.ts no se carga en el sitio público de la tienda
    const { default: api } = await import('./api');
    const legacyStoreId = localStorage.getItem(STORE_ID_KEY) || undefined;
    const legacyIdToken = restored?.isAnonymous ? await restored.getIdToken() : undefined;
    let data: any;
    try {
      ({ data } = await api.post('/subscription/store-session', { legacyStoreId, legacyIdToken }));
    } catch (err) {
      // Equipo vinculado sin conexión con la cuenta: NUNCA se sigue con una sesión del
      // equipo, porque la tienda quedaría atada a este navegador y no a la cuenta.
      console.warn('[Tienda online] No se pudo abrir la sesión de la cuenta:', err);
      throw new Error('No pudimos conectar con tu cuenta de Ventra. Revisá internet y reintentá.');
    }

    if (data?.linked && data.customToken) {
      mode = 'account';
      const user = restored && !restored.isAnonymous && restored.uid === data.uid
        ? restored
        : (await signInWithCustomToken(auth, data.customToken)).user;
      // La tienda de la cuenta (o la de este equipo, si se acaba de pasar a la cuenta).
      // Si no hay ninguna, se olvida la vieja del equipo y se crea una nueva de la cuenta.
      if (data.storeId) localStorage.setItem(STORE_ID_KEY, data.storeId);
      else localStorage.removeItem(STORE_ID_KEY);
      return user;
    }

    // PC sin vincular: la tienda queda atada a este equipo (sesión anónima guardada)
    mode = 'device';
    if (restored) return restored;
    return (await signInAnonymously(auth)).user;
  })().finally(() => { signingIn = null; });
  return signingIn;
}
