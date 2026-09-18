import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';

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

let signingIn: Promise<User> | null = null;

/**
 * Sesión anónima de este POS. Es invisible para el usuario y queda guardada en
 * el equipo: las reglas solo dejan editar una tienda a la sesión que la creó
 * (o la reclamó), así nadie que conozca el ID puede modificarla.
 */
export function ensureVentraSession(): Promise<User> {
  const auth = getAuth(getVentraApp());
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (signingIn) return signingIn;
  signingIn = new Promise<User>((resolve, reject) => {
    // Esperar a que Firebase restaure una sesión previa antes de crear otra
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (user) return resolve(user);
      signInAnonymously(auth).then((cred) => resolve(cred.user), reject);
    }, reject);
  }).finally(() => { signingIn = null; });
  return signingIn;
}
