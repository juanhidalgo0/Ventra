import toast from 'react-hot-toast';
import api from '../services/api';
import { forgetStoreSettings } from '../services/storeSettings';
import { usePOSStore } from '../stores/posStore';
import { PROFILE_LABELS, type BusinessProfile } from '../stores/businessStore';

/**
 * SOLO DEMO PÚBLICA. Cada visitante tiene su propia base en el servidor (ver
 * apps/backend/src/modules/system/demo-visitors.ts), identificada por una cookie.
 */

/** Antes de entrar: sigue con la demo de este navegador o arranca una nueva desde cero. */
export async function startDemo() {
  const { data } = await api.post('/demo/start');
  if (data?.created) {
    // Demo nueva: lo que se eligió en una demo anterior (rubro, nombre, bienvenida) no sigue
    forgetStoreSettings();
    usePOSStore.getState().clearCart();
  }
}

/** Al elegir rubro: el servidor carga sus productos y ejemplos, y la app se vuelve a abrir con ellos. */
export async function loadDemoRubro(profile: BusinessProfile) {
  const id = toast.loading(`Armando la demo de ${PROFILE_LABELS[profile].title}…`);
  try {
    await api.post('/demo/rubro', { profile });
    // Un momento para que el rubro elegido termine de guardarse (ver setStoreSetting)
    setTimeout(() => window.location.reload(), 700);
  } catch (err: any) {
    toast.error(err?.response?.data?.message || 'No se pudieron cargar los ejemplos del rubro', { id });
  }
}
