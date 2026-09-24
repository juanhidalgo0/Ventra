import { create } from 'zustand';
import api from '../services/api';

/**
 * Qué incluye el plan de Ventra de este comercio (viene de la licencia firmada, ver
 * /subscription/status). Caja = sistema de ventas; Tienda = tienda online; Full = las dos.
 * Mientras no se sabe (o sin conexión con el backend) se muestra todo: el límite real lo
 * pone el servidor.
 */
export interface PlanFeatures { caja: boolean; tienda: boolean }

interface PlanState {
  plan: string | null;
  planName: string | null;
  features: PlanFeatures;
  loaded: boolean;
  load: () => Promise<void>;
}

export const usePlanStore = create<PlanState>((set) => ({
  plan: null,
  planName: null,
  features: { caja: true, tienda: true },
  loaded: false,
  load: async () => {
    try {
      const { data } = await api.get('/subscription/status', { silent: true } as any);
      set({
        plan: data?.plan ?? null,
        planName: data?.planName ?? null,
        features: data?.features || { caja: true, tienda: true },
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
}));

/** Secciones que solo incluye el plan Caja (sistema de ventas). */
const CAJA_PATHS = ['/pos', '/cash', '/cash-control', '/clients', '/treasury', '/suppliers', '/purchases', '/gastos', '/historial', '/reports', '/dashboard', '/fiscal', '/earnings-division', '/quotes', '/inicio'];
/** Secciones que solo incluye el plan Tienda (tienda online). */
const TIENDA_PATHS = ['/tienda', '/online-store', '/pedidos', '/agenda'];

const under = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + '/'));

/** Plan que hace falta para una pantalla, o null si la incluyen todos. */
export function planAreaOf(path: string): 'caja' | 'tienda' | null {
  if (under(path, CAJA_PATHS)) return 'caja';
  if (under(path, TIENDA_PATHS)) return 'tienda';
  return null;
}

export function planAllows(features: PlanFeatures, path: string) {
  const area = planAreaOf(path);
  return !area || features[area];
}

/** Pantalla de inicio según el plan: sin caja, la tienda online. */
export function planHome(features: PlanFeatures, mobile: boolean) {
  if (features.caja) return mobile ? '/inicio' : '/pos';
  return '/tienda';
}
