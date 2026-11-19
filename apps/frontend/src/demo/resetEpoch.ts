import { IS_DEMO_BUILD } from './flag';

/**
 * SOLO DEMO PÚBLICA. Reinicio general: cuando cambia DEMO_EPOCH, todo navegador que ya había
 * abierto la demo olvida lo de antes (sesión, rubro, nombre, bienvenida, recorridos, tienda y
 * agenda de ejemplo) y la vuelve a ver como la primera vez. Va junto con DEMO_COOKIE del
 * servidor (apps/backend/src/modules/system/demo-visitors.ts): al cambiar uno, cambiar el otro.
 * Se importa primero en main.tsx: los stores leen el navegador apenas se cargan.
 */
export const DEMO_EPOCH = '2026-11-19';
const KEY = 'ventra_demo_epoch';

if (IS_DEMO_BUILD) {
  try {
    if (localStorage.getItem(KEY) !== DEMO_EPOCH) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(KEY, DEMO_EPOCH);
      if (location.hash && location.hash !== '#/' && !location.hash.startsWith('#/login')) location.hash = '#/login';
    }
  } catch { /* sin almacenamiento: no hay nada viejo que borrar */ }
}
