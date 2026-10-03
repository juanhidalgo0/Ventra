import { create } from 'zustand';
import api from '../services/api';

/**
 * Qué incluye el plan de Ventra de este comercio (viene de la licencia firmada, ver
 * /subscription/status). Caja = sistema de ventas; Tienda = tienda online (trae la agenda);
 * Agenda = solo turnos, sin productos ni caja; Full = todo.
 * Mientras no se sabe (o sin conexión con el backend) se muestra todo: el límite real lo
 * pone el servidor.
 */
export interface PlanFeatures { caja: boolean; tienda: boolean; agenda: boolean }

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
  features: { caja: true, tienda: true, agenda: true },
  loaded: false,
  load: async () => {
    try {
      const { data } = await api.get('/subscription/status', { silent: true } as any);
      set({
        plan: data?.plan ?? null,
        planName: data?.planName ?? null,
        // Backends viejos no mandan `agenda`: venía incluida en la tienda
        features: data?.features
          ? { caja: !!data.features.caja, tienda: !!data.features.tienda, agenda: data.features.agenda ?? !!data.features.tienda }
          : { caja: true, tienda: true, agenda: true },
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
const TIENDA_PATHS = ['/tienda', '/online-store', '/pedidos'];
/** Agenda de turnos: planes Tienda, Agenda y Full. */
const AGENDA_PATHS = ['/agenda'];
/** Productos y stock: los usan la caja y la tienda, no el plan Agenda (solo turnos). */
const CATALOG_PATHS = ['/products', '/inventory', '/promos', '/stock-control', '/stock-audit'];

const under = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + '/'));

export type PlanArea = 'caja' | 'tienda' | 'agenda' | 'catalogo';

/** Plan que hace falta para una pantalla, o null si la incluyen todos. */
export function planAreaOf(path: string): PlanArea | null {
  if (under(path, CAJA_PATHS)) return 'caja';
  if (under(path, TIENDA_PATHS)) return 'tienda';
  if (under(path, AGENDA_PATHS)) return 'agenda';
  if (under(path, CATALOG_PATHS)) return 'catalogo';
  return null;
}

export function planAllows(features: PlanFeatures, path: string) {
  const area = planAreaOf(path);
  if (!area) return true;
  if (area === 'catalogo') return features.caja || features.tienda;
  return features[area];
}

/** Solo turnos: ni caja ni tienda. La app entera gira alrededor de la agenda. */
export const isAgendaOnly = (features: PlanFeatures) => !features.caja && !features.tienda && features.agenda;

/** Pantalla de inicio según el plan: sin caja, la tienda online; solo turnos, la agenda. */
export function planHome(features: PlanFeatures, mobile: boolean) {
  if (features.caja) return mobile ? '/inicio' : '/pos';
  if (features.tienda) return '/tienda';
  return '/agenda';
}
