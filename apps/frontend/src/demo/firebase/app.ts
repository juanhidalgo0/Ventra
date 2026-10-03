// SOLO DEMO PÚBLICA: reemplaza a 'firebase/app' (ver firestore.ts). No se conecta a nada.
export type FirebaseApp = { name: string; options: Record<string, unknown> };
const apps: FirebaseApp[] = [];
export function initializeApp(options: Record<string, unknown> = {}, name = '[DEFAULT]'): FirebaseApp {
  const app = { name, options };
  apps.push(app);
  return app;
}
export const getApps = () => apps;
export const getApp = (name = '[DEFAULT]') => apps.find((a) => a.name === name) || initializeApp({}, name);
