import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getVentraApp, getVentraDb, ensureVentraSession } from './ventraFirebase';
import { IS_DEMO_BUILD } from '../demo/flag';

/**
 * Avisos en el celular del dueño (pedidos online nuevos), aunque la app esté cerrada.
 * Funciona en la app instalada (PWA) con el service worker de la web.
 */
const VAPID_KEY = 'BNepkrmldYbNVN7zoa8-TIirVdDibhwZ1Yp4y8Rhfjd1afFkcjnSLNi9uyNauDiTVMOCaKcIwO6NXaI9mh0j6-k';

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

export function pushState(): PushState {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  // Solo en la web con https (la app de escritorio avisa con sonido en pantalla)
  if (location.protocol !== 'https:' || (window as any).__TAURI__) return 'unsupported';
  return Notification.permission as PushState;
}

/** Pide permiso (tiene que llamarse desde un toque del usuario) y registra este celular. */
export async function enablePush(): Promise<PushState> {
  if (pushState() === 'unsupported') return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm as PushState;
  await registerPushToken();
  return 'granted';
}

/** Registra (o renueva) el token de este equipo en la tienda. Silencioso si no hay permiso. */
export async function registerPushToken(): Promise<void> {
  if (pushState() !== 'granted') return;
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) return;
  const reg = (await navigator.serviceWorker.getRegistration('./')) || (await navigator.serviceWorker.register('./sw.js'));
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(getVentraApp()), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return;
  const user = await ensureVentraSession();
  // El id del documento es una huella del token (los tokens tienen caracteres raros para un id)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const id = [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  await setDoc(doc(getVentraDb(), 'ventra_push', user.uid, 'tokens', id), {
    token, userAgent: navigator.userAgent.slice(0, 200), updatedAt: serverTimestamp(),
  });
}

/** Qué avisos recibe la cuenta (se guardan en la nube, valen para todos sus celulares). */
export interface NotifyPrefs {
  orders: boolean; orderIdle: boolean; bookings: boolean; cashDiff: boolean; invoiceFail: boolean; lowStock: boolean; expiry: boolean; mpUnmatched: boolean;
  saleCancel: boolean; dailySummary: boolean; summaryHour: number; quietFrom: number; quietTo: number;
}
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  orders: true, orderIdle: true, bookings: true, cashDiff: true, invoiceFail: true, lowStock: true, expiry: true, mpUnmatched: true,
  saleCancel: false, dailySummary: false, summaryHour: 21, quietFrom: 23, quietTo: 8,
};

export async function loadNotifyPrefs(): Promise<NotifyPrefs> {
  const user = await ensureVentraSession();
  const snap = await getDoc(doc(getVentraDb(), 'ventra_push', user.uid));
  return { ...DEFAULT_NOTIFY_PREFS, ...((snap.exists() && snap.data().prefs) || {}) };
}

export async function saveNotifyPrefs(prefs: NotifyPrefs): Promise<void> {
  const user = await ensureVentraSession();
  await setDoc(doc(getVentraDb(), 'ventra_push', user.uid), { prefs, updatedAt: serverTimestamp() }, { merge: true });
}

/** Muestra un aviso armado en el mismo celular: prueba que el sistema deja mostrar notificaciones. */
export async function testLocalNotification(): Promise<void> {
  const reg = (await navigator.serviceWorker.getRegistration('./')) || (await navigator.serviceWorker.ready);
  await reg.showNotification('Ventra · Prueba en este celular', { body: 'El celular puede mostrar avisos de Ventra.', icon: './icon-192.png', tag: 'local-test' });
}

/** Pide a la nube un aviso de prueba a todos los celulares de la cuenta (camino completo). */
export async function testPushFromCloud(): Promise<{ devices: number; sent: number; errors?: string[] }> {
  if (IS_DEMO_BUILD) throw new Error('Los avisos al celular no están disponibles en la demo');
  await registerPushToken();
  const user = await ensureVentraSession();
  const res = await fetch('https://us-central1-ventra-9cba5.cloudfunctions.net/ventraPushTest', {
    method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'La prueba desde la nube todavía no está publicada' : 'No se pudo enviar el aviso de prueba');
  return res.json();
}
