import { create } from 'zustand';

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
  | 'variants';      // Talles y colores

export type BusinessProfile = 'KIOSKO' | 'FERRETERIA' | 'INDUMENTARIA' | 'MULTIRUBRO';

export const ALL_FEATURES: BusinessFeature[] = [
  'quotes', 'acopio', 'tradePricing', 'substitutes', 'fractional', 'hardwareImages', 'variants',
];

export const FEATURE_LABELS: Record<BusinessFeature, { title: string; description: string }> = {
  quotes:         { title: 'Presupuestos', description: 'Armar cotizaciones y convertirlas en venta.' },
  acopio:         { title: 'Acopio y remitos', description: 'El cliente paga y retira la mercadería en varias veces.' },
  tradePricing:   { title: 'Lista Gremio', description: 'Precio especial para clientes del rubro (gremio / profesional).' },
  substitutes:    { title: 'Sustitutos', description: 'Sugerir equivalentes cuando un artículo no tiene stock.' },
  fractional:     { title: 'Medidas y fraccionado', description: 'Vender por metro, kilo o litro, con tamaño de pieza y ubicación.' },
  hardwareImages: { title: 'Fotos por medida', description: 'Buscador de fotos donde todas las medidas de un artículo comparten imagen.' },
  variants:       { title: 'Talles y colores', description: 'Un modelo con varias variantes, cada una con su stock y su código.' },
};

export const PROFILE_FEATURES: Record<BusinessProfile, BusinessFeature[]> = {
  KIOSKO: [],
  FERRETERIA: ['quotes', 'acopio', 'tradePricing', 'substitutes', 'fractional', 'hardwareImages'],
  INDUMENTARIA: ['variants'],
  MULTIRUBRO: ['quotes', 'tradePricing', 'substitutes', 'fractional', 'variants'],
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

const persist = (profile: BusinessProfile, features: FeatureMap) => {
  localStorage.setItem(PROFILE_KEY, profile);
  localStorage.setItem(FEATURES_KEY, JSON.stringify(features));
  // Compatibilidad con versiones anteriores (y con cualquier pantalla que todavía no se haya migrado)
  localStorage.setItem(LEGACY_KEY, features.fractional ? 'FERRETERIA' : 'KIOSKO');
};

interface BusinessState {
  profile: BusinessProfile;
  features: FeatureMap;
  setProfile: (profile: BusinessProfile) => void;
  setFeature: (feature: BusinessFeature, enabled: boolean) => void;
}

export const useBusinessStore = create<BusinessState>((set, get) => ({
  ...loadState(),

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

/** Para leer fuera de React o dentro del render sin suscribirse (reemplazo directo del viejo localStorage.getItem). */
export const hasFeature = (feature: BusinessFeature): boolean => useBusinessStore.getState().features[feature];

/** Igual que `hasFeature` pero re-renderiza cuando se cambia la configuración. */
export const useFeature = (feature: BusinessFeature): boolean =>
  useBusinessStore((s) => s.features[feature]);
