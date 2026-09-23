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
/** true cuando ya se sabe si hay cuenta (sesión de cuenta abierta o PC sin vincular). */
let accountResolved = false;
let lastAccountAttempt = 0;

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
  // Si el intento anterior falló por un error pasajero (sin internet, sesión del POS vencida)
  // se reintenta, pero como mucho una vez por minuto.
  const retryAccount = !accountResolved && Date.now() - lastAccountAttempt > 60_000;
  if (auth.currentUser && (!auth.currentUser.isAnonymous || !retryAccount)) return Promise.resolve(auth.currentUser);
  if (signingIn) return signingIn;
  signingIn = (async () => {
    const restored = await waitForRestoredUser();
    if (!accountResolved && Date.now() - lastAccountAttempt > 60_000) {
      lastAccountAttempt = Date.now();
      try {
        // Import dinámico: api.ts no se carga en el sitio público de la tienda
        const { default: api } = await import('./api');
        const legacyStoreId = localStorage.getItem(STORE_ID_KEY) || undefined;
        const legacyIdToken = restored?.isAnonymous ? await restored.getIdToken() : undefined;
        const { data } = await api.post('/subscription/store-session', { legacyStoreId, legacyIdToken });
        if (data && data.linked === false) accountResolved = true; // PC sin vincular: sesión del equipo
        if (data?.linked && data.customToken) {
          accountResolved = true;
          const user = restored && restored.uid === data.uid
            ? restored
            : (await signInWithCustomToken(auth, data.customToken)).user;
          if (data.storeId) localStorage.setItem(STORE_ID_KEY, data.storeId);
          return user;
        }
      } catch (err) {
        console.warn('[Tienda online] Sin sesión de cuenta, se usa la del equipo:', err);
      }
    }
    if (restored) return restored;
    return (await signInAnonymously(auth)).user;
  })().finally(() => { signingIn = null; });
  return signingIn;
}
