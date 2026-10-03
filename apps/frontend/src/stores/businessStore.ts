import { create } from 'zustand';
import { setStoreSetting, STORE_SETTINGS_EVENT } from '../services/storeSettings';
import { planAllows, type PlanFeatures } from './planStore';

/**
 * Qué hace el comercio con Ventra. Lo elige el dueño en la bienvenida (y en Configuración).
 * El plan dice qué PUEDE usar; esto dice qué USA: lo que no usa no aparece en el menú
 * (sigue andando si entra por el link). null = nunca lo eligió: se muestra todo.
 */
export type BusinessIntent = 'mostrador' | 'online' | 'turnos';
export const ALL_INTENTS: BusinessIntent[] = ['mostrador', 'online', 'turnos'];

/** Parte del plan que hace falta para cada intención. */
export const INTENT_AREA: Record<BusinessIntent, keyof PlanFeatures> = { mostrador: 'caja', online: 'tienda', turnos: 'agenda' };

export const INTENT_LABELS: Record<BusinessIntent, { title: string; description: string }> = {
  mostrador: { title: 'Vender en el mostrador', description: 'Caja, stock, cierres y cuentas corrientes.' },
  online: { title: 'Vender por internet', description: 'Tu tienda online con pedidos por WhatsApp.' },
  turnos: { title: 'Dar turnos', description: 'Tus clientes reservan solos desde tu página.' },
};

const INTENT_PATHS: Partial<Record<BusinessIntent, string[]>> = {
  online: ['/online-store', '/pedidos', '/tienda'],
  turnos: ['/agenda'],
};

const readIntents = (): BusinessIntent[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem('business_intents') || 'null');
    return Array.isArray(v) ? v.filter((x) => ALL_INTENTS.includes(x)) : null;
  } catch { return null; }
};

/** Si una pantalla va en el menú: la incluye el plan y el comercio la usa. */
export function menuAllows(features: PlanFeatures, intents: BusinessIntent[] | null, path: string) {
  if (!planAllows(features, path)) return false;
  if (!intents) return true;
  for (const [intent, paths] of Object.entries(INTENT_PATHS) as [BusinessIntent, string[]][]) {
    if (!intents.includes(intent) && paths.some((p) => path === p || path.startsWith(p + '/'))) return false;
  }
  return true;
}

/**
 * Funciones del sistema que se prenden o se apagan según el rubro.
 * Antes esto era un único `business_type` (KIOSKO | FERRETERIA) leído suelto desde
 * localStorage en cada pantalla: un comercio que vende de todo (bazar + indumentaria)
 * no entraba en ninguno de los dos moldes.
 */
export type BusinessFeature =
  | 'quotes'         // Presupuestos / cotizaciones
  | 'acopio'         // Acopio y remitos parciales
  | 'tradePricing'   // Lista de precios Gremio
  | 'substitutes'    // Productos sustitutos / equivalentes
  | 'fractional'     // Unidades MT/KG/L, tamaño de pieza, ubicación, precio mayorista
  | 'hardwareImages' // Buscador de fotos por medida (las medidas comparten foto)
  | 'variants'       // Variantes: talles y colores, o tamaños (gastronomía)
  | 'expiry';        // Vencimientos por lote y avisos

export type BusinessProfile = 'KIOSKO' | 'FERRETERIA' | 'INDUMENTARIA' | 'GASTRONOMIA' | 'MULTIRUBRO';

export const ALL_FEATURES: BusinessFeature[] = [
  'quotes', 'acopio', 'tradePricing', 'substitutes', 'fractional', 'hardwareImages', 'variants', 'expiry',
];

export const FEATURE_LABELS: Record<BusinessFeature, { title: string; description: string }> = {
  quotes:         { title: 'Presupuestos', description: 'Armar cotizaciones y convertirlas en venta.' },
  acopio:         { title: 'Acopio y remitos', description: 'El cliente paga y retira la mercadería en varias veces.' },
  tradePricing:   { title: 'Lista Gremio', description: 'Precio especial para clientes del rubro (gremio / profesional).' },
  substitutes:    { title: 'Sustitutos', description: 'Sugerir equivalentes cuando un artículo no tiene stock.' },
  fractional:     { title: 'Medidas y fraccionado', description: 'Vender por metro, kilo o litro, con tamaño de pieza y ubicación.' },
  hardwareImages: { title: 'Fotos por medida', description: 'Buscador de fotos donde todas las medidas de un artículo comparten imagen.' },
  variants:       { title: 'Variantes (talles, colores, tamaños)', description: 'Un producto con varias opciones, cada una con su precio, su stock y su código.' },
  expiry:         { title: 'Vencimientos', description: 'Cargar fechas de vencimiento por lote y recibir avisos antes de que venzan.' },
};

export const PROFILE_FEATURES: Record<BusinessProfile, BusinessFeature[]> = {
  KIOSKO: ['expiry'],
  FERRETERIA: ['quotes', 'acopio', 'tradePricing', 'substitutes', 'fractional', 'hardwareImages'],
  INDUMENTARIA: ['variants'],
  GASTRONOMIA: ['variants', 'expiry'],
  MULTIRUBRO: ['quotes', 'tradePricing', 'substitutes', 'fractional', 'variants', 'expiry'],
};

export const PROFILE_LABELS: Record<BusinessProfile, { emoji: string; title: string; description: string }> = {
  KIOSKO: {
    emoji: '🍬',
    title: 'Kiosco / Almacén',
    description: 'Interfaz simple por unidades o packs. Sin acopios, presupuestos ni sustitutos para no saturar el mostrador.',
  },
  FERRETERIA: {
    emoji: '🔧',
    title: 'Ferretería / Corralón',
    description: 'Acopio y remitos parciales, presupuestos, sustitutos, tarifas de gremio y medidas (metros, kilos, litros).',
  },
  INDUMENTARIA: {
    emoji: '👕',
    title: 'Indumentaria / Calzado',
    description: 'Cada modelo con sus talles y colores, con stock y código de barras propio por variante.',
  },
  GASTRONOMIA: {
    emoji: '🍕',
    title: 'Gastronomía',
    description: 'Pizzerías, rotiserías, cafeterías: productos con tamaños a distinto precio y promos por cantidad (docena de empanadas).',
  },
  MULTIRUBRO: {
    emoji: '🏪',
    title: 'Multirubro / Bazar',
    description: 'Vende de todo: ropa con talles, bazar por unidad y artículos por medida conviviendo en el mismo mostrador.',
  },
};

const PROFILE_KEY = 'business_profile';
const FEATURES_KEY = 'business_features';
const LEGACY_KEY = 'business_type';

type FeatureMap = Record<BusinessFeature, boolean>;

const emptyMap = (): FeatureMap =>
  ALL_FEATURES.reduce((acc, f) => { acc[f] = false; return acc; }, {} as FeatureMap);

export const featuresOfProfile = (profile: BusinessProfile): FeatureMap => {
  const map = emptyMap();
  for (const f of PROFILE_FEATURES[profile]) map[f] = true;
  return map;
};

/** Lee la config guardada; si sólo existe el `business_type` viejo, lo migra al perfil equivalente. */
const loadState = (): { profile: BusinessProfile; features: FeatureMap } => {
  const savedProfile = localStorage.getItem(PROFILE_KEY) as BusinessProfile | null;
  const legacy = localStorage.getItem(LEGACY_KEY);
  const profile: BusinessProfile =
    savedProfile && PROFILE_FEATURES[savedProfile]
      ? savedProfile
      : legacy === 'FERRETERIA' ? 'FERRETERIA' : 'KIOSKO';

  const features = featuresOfProfile(profile);
  try {
    const saved = JSON.parse(localStorage.getItem(FEATURES_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const f of ALL_FEATURES) if (typeof saved[f] === 'boolean') features[f] = saved[f];
    }
  } catch { /* config corrupta: quedan los valores del perfil */ }

  return { profile, features };
};

const writeLegacy = (features: FeatureMap) => {
  // Compatibilidad con versiones anteriores (y con cualquier pantalla que todavía no se haya migrado)
  localStorage.setItem(LEGACY_KEY, features.fractional ? 'FERRETERIA' : 'KIOSKO');
};

/** Rubro y funciones son del comercio: viajan a los otros equipos (ver services/storeSettings). */
const persist = (profile: BusinessProfile, features: FeatureMap) => {
  setStoreSetting('business_profile', profile);
  setStoreSetting('business_features', JSON.stringify(features));
  writeLegacy(features);
};

interface BusinessState {
  profile: BusinessProfile;
  features: FeatureMap;
  intents: BusinessIntent[] | null;
  setProfile: (profile: BusinessProfile) => void;
  setFeature: (feature: BusinessFeature, enabled: boolean) => void;
  setIntents: (intents: BusinessIntent[]) => void;
}

export const useBusinessStore = create<BusinessState>((set, get) => ({
  ...loadState(),
  intents: readIntents(),

  setIntents: (intents) => {
    const clean = ALL_INTENTS.filter((i) => intents.includes(i));
    setStoreSetting('business_intents', JSON.stringify(clean));
    set({ intents: clean });
  },

  setProfile: (profile) => {
    const features = featuresOfProfile(profile);
    persist(profile, features);
    set({ profile, features });
  },

  setFeature: (feature, enabled) => {
    const features = { ...get().features, [feature]: enabled };
    persist(get().profile, features);
    set({ features });
  },
}));

// Otro equipo cambió el rubro o las funciones: se aplican sin reiniciar
window.addEventListener(STORE_SETTINGS_EVENT, (e) => {
  const keys = (e as CustomEvent<string[]>).detail || [];
  if (keys.includes('business_intents')) useBusinessStore.setState({ intents: readIntents() });
  if (!keys.includes('business_profile') && !keys.includes('business_features')) return;
  const next = loadState();
  writeLegacy(next.features);
  useBusinessStore.setState(next);
});

/** Para leer fuera de React o dentro del render sin suscribirse (reemplazo directo del viejo localStorage.getItem). */
export const hasFeature = (feature: BusinessFeature): boolean => useBusinessStore.getState().features[feature];

/** Igual que `hasFeature` pero re-renderiza cuando se cambia la configuración. */
export const useFeature = (feature: BusinessFeature): boolean =>
  useBusinessStore((s) => s.features[feature]);
