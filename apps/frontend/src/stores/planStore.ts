import { create } from 'zustand';
import api from '../services/api';

/**
 * Qué incluye el plan de Ventra de este comercio (viene de la licencia firmada, ver
 * /subscription/status). Caja = sistema de ventas; Tienda = tienda online (trae la agenda);
 * Agenda = solo turnos, sin productos ni caja; Full = todo.
 * Mientras no se sabe (o sin conexión con el backend) se muestra todo: el límite real lo
 * pone el servidor.
 */
export interface PlanFeatures {
  caja: boolean; tienda: boolean; agenda: boolean;
  /** Recordatorios automáticos por WhatsApp (Agenda Pro y Full). El cupo lo cuenta la nube. */
  reminders: boolean;
}

export type PlanId = 'caja' | 'tienda' | 'agenda' | 'agenda_pro' | 'full';

/** Planes que se venden. Mismo reparto que planFeatures en el backend (subscription.service). */
export const PLANS: Record<PlanId, { name: string; tagline: string; features: PlanFeatures }> = {
  caja: { name: 'Ventra Caja', tagline: 'Mostrador: caja, stock y reportes', features: { caja: true, tienda: false, agenda: false, reminders: false } },
  tienda: { name: 'Ventra Tienda', tagline: 'Tienda online y agenda de turnos', features: { caja: false, tienda: true, agenda: true, reminders: false } },
  agenda: { name: 'Ventra Agenda', tagline: 'Solo turnos, desde el celular', features: { caja: false, tienda: false, agenda: true, reminders: false } },
  agenda_pro: { name: 'Ventra Agenda Pro', tagline: 'Turnos con recordatorio automático', features: { caja: false, tienda: false, agenda: true, reminders: true } },
  full: { name: 'Ventra Full', tagline: 'Todo: caja, tienda y agenda', features: { caja: true, tienda: true, agenda: true, reminders: true } },
};

const DEMO_PLAN_KEY = 'demo_plan';
const readDemoPlan = (): PlanId => {
  try { const v = localStorage.getItem(DEMO_PLAN_KEY) as PlanId | null; return v && PLANS[v] ? v : 'full'; } catch { return 'full'; }
};

interface PlanState {
  plan: string | null;
  planName: string | null;
  /** Rubro con el que se suscribió desde una landing por rubro (ver services/signupRubro) */
  signupRubro: string | null;
  /** Email de la cuenta de Ventra (para habilitar antes funciones en prueba, ver utils/comingSoon) */
  email: string | null;
  features: PlanFeatures;
  loaded: boolean;
  /** Demo pública: el visitante elige qué plan probar (queda en su navegador, no en el servidor compartido) */
  isDemo: boolean;
  load: () => Promise<void>;
  setDemoPlan: (plan: PlanId) => void;
}

export const usePlanStore = create<PlanState>((set) => ({
  plan: null,
  planName: null,
  signupRubro: null,
  email: null,
  features: { caja: true, tienda: true, agenda: true, reminders: true },
  loaded: false,
  isDemo: false,
  load: async () => {
    try {
      const [{ data }, info] = await Promise.all([
        api.get('/subscription/status', { silent: true } as any),
        api.get('/system/info', { silent: true } as any).then((r) => r.data).catch(() => null),
      ]);
      if (info?.isDemo) {
        const demo = readDemoPlan();
        set({ isDemo: true, plan: demo, planName: PLANS[demo].name, features: PLANS[demo].features, loaded: true });
        return;
      }
      set({
        plan: data?.plan ?? null,
        planName: data?.planName ?? null,
        signupRubro: data?.rubro ?? null,
        email: data?.email ?? null,
        // Backends viejos no mandan `agenda`: venía incluida en la tienda
        features: data?.features
          ? {
            caja: !!data.features.caja, tienda: !!data.features.tienda, agenda: data.features.agenda ?? !!data.features.tienda,
            // Backends anteriores a Agenda Pro no lo mandan: se deduce del plan (el límite real lo pone la nube)
            reminders: data.features.reminders ?? (!data.plan || ['full', 'agenda_pro', 'prueba'].includes(data.plan)),
          }
          : { caja: true, tienda: true, agenda: true, reminders: true },
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
  setDemoPlan: (plan) => {
    try { localStorage.setItem(DEMO_PLAN_KEY, plan); } catch { /* sin espacio */ }
    set({ isDemo: true, plan, planName: PLANS[plan].name, features: PLANS[plan].features, loaded: true });
  },
}));

/** Secciones que solo incluye el plan Caja (sistema de ventas). */
const CAJA_PATHS = ['/pos', '/cash', '/cash-control', '/clients', '/treasury', '/suppliers', '/purchases', '/gastos', '/historial', '/reports', '/dashboard', '/fiscal', '/earnings-division', '/quotes', '/inicio', '/employee-consumption'];
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
