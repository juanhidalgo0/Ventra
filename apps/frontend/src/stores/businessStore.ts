import { create } from 'zustand';
import { setStoreSetting, STORE_SETTINGS_EVENT } from '../services/storeSettings';
import { planAllows, type PlanFeatures } from './planStore';
import { IS_DEMO_BUILD } from '../demo/flag';

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
  if (isConsultorio(useBusinessStore.getState().profile) && CONSULTORIO_HIDDEN.some((p) => path === p || path.startsWith(p + '/'))) return false;
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
  | 'expiry'         // Vencimientos por lote y avisos
  | 'bulk'           // Venta por bulto (cajas, packs, fardos) además de por unidad
  | 'delivery'       // Nota de venta y remito en hoja A4, localidad de los clientes
  | 'preorders'      // Preventa: los vendedores toman pedidos en el celular
  | 'workorders'     // Encargos: trabajos a pedido con seña, fecha de entrega y estados
  | 'clientorders'   // Encargos en la caja: revistas y demás que llegan, se avisa y se retiran
  | 'patients'       // Pacientes: historia clínica y mediciones (consultorio de nutrición)
  | 'scaleLabels'    // Etiquetas de balanza: la caja lee el código con el precio o el peso adentro (ver utils/scaleLabel)
  | 'monthfund'      // Caja del mes: la plata guardada aparte, le entra el Z y lo que trae el chofer
  | 'desposte';      // Desposte de media res: entra como compra, suma el stock de cada corte con su costo real

export type BusinessProfile = 'KIOSKO' | 'CARNICERIA' | 'FIAMBRERIA' | 'VERDULERIA' | 'FERRETERIA' | 'INDUMENTARIA' | 'GASTRONOMIA' | 'MULTIRUBRO' | 'DISTRIBUIDORA' | 'IMPRENTA' | 'NUTRICION';

export const ALL_FEATURES: BusinessFeature[] = [
  'quotes', 'acopio', 'tradePricing', 'substitutes', 'fractional', 'hardwareImages', 'variants', 'expiry', 'bulk', 'delivery', 'preorders', 'workorders', 'clientorders', 'patients', 'scaleLabels', 'desposte', 'monthfund',
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
  bulk:           { title: 'Venta por bulto', description: 'Vender por caja, pack o fardo con su propio precio, o suelto por unidad.' },
  delivery:       { title: 'Nota de venta y remito', description: 'Imprimir nota de venta y remito en hoja A4 para el reparto, con la localidad del cliente.' },
  workorders:     { title: 'Encargos', description: 'Trabajos a pedido con seña, fecha de entrega y prioridad: pendiente, en proceso, listo y entregado, con comprobante para el cliente y aviso por WhatsApp.' },
  clientorders:   { title: 'Encargos en la caja', description: 'Revistas, diarios y otros artículos que el cliente encarga: el cajero lo anota desde la caja con sus datos y una seña opcional, le avisa cuando llega y cobra la diferencia cuando lo retira.' },
  preorders:      { title: 'Preventa y reparto', description: 'Los vendedores toman pedidos en el celular (también sin señal), se arman los repartos con hoja de carga y de ruta, y en la caja se cobran.' },
  patients:       { title: 'Pacientes', description: 'Ficha de cada paciente con historia clínica, consultas y mediciones (peso, IMC, pliegues, % de grasa) con gráficos de evolución.' },
  scaleLabels:    { title: 'Etiquetas de balanza', description: 'La caja lee el código de barras que imprime la balanza (con el importe o el peso adentro) y suma el producto con su precio justo.' },
  monthfund:      { title: 'Caja del mes', description: 'La plata que se guarda aparte del cajón: al hacer el Cierre Z se pasa el efectivo, lo que trae el chofer entra solo al rendir el reparto, y a fin de mes se cuenta y se hace el balance en Tesorería.' },
  desposte:       { title: 'Desposte de media res', description: 'Cargás lo que pagaste y los kilos de cada corte: suma el stock y te dice cuánto te cuesta y cuánto ganás en cada corte.' },
};

export const PROFILE_FEATURES: Record<BusinessProfile, BusinessFeature[]> = {
  KIOSKO: ['expiry'],
  CARNICERIA: ['scaleLabels', 'desposte'],
  FIAMBRERIA: ['scaleLabels', 'expiry'],
  VERDULERIA: ['scaleLabels'],
  FERRETERIA: ['quotes', 'acopio', 'tradePricing', 'substitutes', 'fractional', 'hardwareImages'],
  INDUMENTARIA: ['variants'],
  GASTRONOMIA: ['variants', 'expiry'],
  MULTIRUBRO: ['quotes', 'tradePricing', 'substitutes', 'fractional', 'variants', 'expiry'],
  DISTRIBUIDORA: ['bulk', 'delivery', 'preorders', 'expiry', 'monthfund'],
  IMPRENTA: ['workorders', 'quotes'],
  NUTRICION: ['patients'],
};

export const PROFILE_LABELS: Record<BusinessProfile, { emoji: string; title: string; description: string }> = {
  KIOSKO: {
    emoji: '🍬',
    title: 'Kiosco / Almacén',
    description: 'Interfaz simple por unidades o packs. Sin acopios, presupuestos ni sustitutos para no saturar el mostrador.',
  },
  CARNICERIA: {
    emoji: '🥩',
    title: 'Carnicería',
    description: 'Venta por kilo o por plata, etiquetas de la balanza, cortes con su código PLU y desposte de la media res con el costo real de cada corte.',
  },
  FIAMBRERIA: {
    emoji: '🧀',
    title: 'Fiambrería / Quesería',
    description: 'Venta por kilo o por plata ("$3.000 de jamón"), etiquetas de la balanza y vencimientos por lote para fiambres y quesos.',
  },
  VERDULERIA: {
    emoji: '🥬',
    title: 'Verdulería / Frutería',
    description: 'Frutas y verduras por kilo o por plata ("$2.000 de papa"), lo que va por unidad o atado, etiquetas de la balanza y mermas de lo que se tira.',
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
  IMPRENTA: {
    emoji: '🖨️',
    title: 'Imprenta / Trabajos a pedido',
    description: 'Encargos con seña y fecha de entrega, prioridad y estados, comprobante para el cliente y aviso por WhatsApp cuando está listo.',
  },
  DISTRIBUIDORA: {
    emoji: '🚚',
    title: 'Distribuidora / Mayorista',
    description: 'Venta por bulto o por unidad a comercios, con nota de venta y remito en A4 para el reparto.',
  },
  NUTRICION: {
    emoji: '🥗',
    title: 'Nutricionista / Consultorio',
    description: 'Sin caja ni productos: pacientes con historia clínica, mediciones y gráficos de evolución, turnos y cobro de las consultas.',
  },
};

/**
 * Rubros que no venden: el sistema deja de ser una caja y gira alrededor de los pacientes.
 * Se esconde todo lo de vender (caja, productos, tienda online) y el inicio son los pacientes.
 */
export const isConsultorio = (profile: BusinessProfile) => profile === 'NUTRICION';

/** Lo que un consultorio no usa: vender, stock y tienda online (la facturación sí: cobra consultas). */
const CONSULTORIO_HIDDEN = [
  '/pos', '/cash', '/cash-control', '/clients', '/treasury', '/suppliers', '/purchases', '/gastos', '/historial', '/reports', '/dashboard',
  '/earnings-division', '/quotes', '/inicio', '/employee-consumption', '/anulaciones', '/informes', '/encargos', '/preventa', '/reparto', '/hoy',
  '/products', '/inventory', '/promos', '/stock-control', '/stock-audit', '/tienda', '/online-store', '/pedidos', '/desposte',
  // Los clientes de la agenda son los pacientes
  '/agenda/clientes',
];

const PROFILE_KEY = 'business_profile';
const PROFILES_KEY = 'business_profiles';
const FEATURES_KEY = 'business_features';
const LEGACY_KEY = 'business_type';

type FeatureMap = Record<BusinessFeature, boolean>;

const emptyMap = (): FeatureMap =>
  ALL_FEATURES.reduce((acc, f) => { acc[f] = false; return acc; }, {} as FeatureMap);

export const featuresOfProfile = (profile: BusinessProfile): FeatureMap => featuresOfProfiles([profile]);

/** Funciones de varios rubros juntos: las de todos (un kiosco con carnicería tiene las dos). */
export const featuresOfProfiles = (profiles: BusinessProfile[]): FeatureMap => {
  const map = emptyMap();
  for (const p of profiles) for (const f of PROFILE_FEATURES[p] || []) map[f] = true;
  return map;
};

/**
 * Rubros del comercio, el principal primero. Un kiosco o almacén puede tener también carnicería o
 * fiambrería: se marcan todos y se suman sus funciones. El principal (`profile`) es el que manda
 * en lo que necesita uno solo: la práctica de la caja, los recorridos, el texto para la IA y lo
 * que lee la nube (business_profile). El consultorio no se combina: no vende.
 */
export const normalizeProfiles = (list: BusinessProfile[]): BusinessProfile[] => {
  const clean = [...new Set(list.filter((p) => !!PROFILE_FEATURES[p]))];
  if (!clean.length) return ['KIOSKO'];
  if (isConsultorio(clean[0])) return [clean[0]];
  return clean.filter((p) => !isConsultorio(p));
};

const readProfiles = (main: BusinessProfile): BusinessProfile[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null');
    if (Array.isArray(v)) {
      const list = normalizeProfiles(v);
      // El principal manda: si otro equipo viejo cambió solo business_profile, queda primero
      return normalizeProfiles([main, ...list.filter((p) => p !== main)]);
    }
  } catch { /* lista corrupta: queda el principal solo */ }
  return [main];
};

/** Lee la config guardada; si sólo existe el `business_type` viejo, lo migra al perfil equivalente. */
const loadState = (): { profile: BusinessProfile; profiles: BusinessProfile[]; features: FeatureMap } => {
  const savedProfile = localStorage.getItem(PROFILE_KEY) as BusinessProfile | null;
  const legacy = localStorage.getItem(LEGACY_KEY);
  const profile: BusinessProfile =
    savedProfile && PROFILE_FEATURES[savedProfile]
      ? savedProfile
      : legacy === 'FERRETERIA' ? 'FERRETERIA' : 'KIOSKO';
  const profiles = readProfiles(profile);

  const features = featuresOfProfiles(profiles);
  try {
    const saved = JSON.parse(localStorage.getItem(FEATURES_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const f of ALL_FEATURES) if (typeof saved[f] === 'boolean') features[f] = saved[f];
    }
  } catch { /* config corrupta: quedan los valores del perfil */ }

  return { profile: profiles[0], profiles, features };
};

const writeLegacy = (features: FeatureMap) => {
  // Compatibilidad con versiones anteriores (y con cualquier pantalla que todavía no se haya migrado)
  localStorage.setItem(LEGACY_KEY, features.fractional ? 'FERRETERIA' : 'KIOSKO');
};

/** Rubro y funciones son del comercio: viajan a los otros equipos (ver services/storeSettings). */
const persist = (profiles: BusinessProfile[], features: FeatureMap) => {
  setStoreSetting('business_profile', profiles[0]);
  setStoreSetting('business_profiles', JSON.stringify(profiles));
  setStoreSetting('business_features', JSON.stringify(features));
  writeLegacy(features);
};

interface BusinessState {
  /** Rubro principal (= profiles[0]) */
  profile: BusinessProfile;
  /** Todos los rubros del comercio, el principal primero */
  profiles: BusinessProfile[];
  features: FeatureMap;
  intents: BusinessIntent[] | null;
  /** Un solo rubro (deja las funciones de ese rubro, como antes) */
  setProfile: (profile: BusinessProfile) => void;
  /** Todos los rubros de una vez (bienvenida): las funciones quedan las de todos */
  setProfiles: (profiles: BusinessProfile[]) => void;
  /** Suma o saca un rubro sin tocar lo que el comercio prendió o apagó a mano en los otros */
  toggleProfile: (profile: BusinessProfile) => void;
  /** Pasa un rubro que ya tiene a principal */
  setMainProfile: (profile: BusinessProfile) => void;
  setFeature: (feature: BusinessFeature, enabled: boolean) => void;
  setIntents: (intents: BusinessIntent[]) => void;
}

export const useBusinessStore = create<BusinessState>((set, get) => {
  /** Guarda los rubros nuevos con sus funciones y ajusta lo que depende del consultorio y la demo. */
  const apply = (next: BusinessProfile[], features: FeatureMap) => {
    const profiles = normalizeProfiles(next);
    const was = get().profiles;
    persist(profiles, features);
    // Un consultorio solo da turnos; al volver a un rubro que vende, se le devuelve todo
    if (isConsultorio(profiles[0]) && !isConsultorio(was[0])) get().setIntents(['turnos']);
    else if (!isConsultorio(profiles[0]) && isConsultorio(was[0])) get().setIntents(ALL_INTENTS);
    set({ profile: profiles[0], profiles, features });
    // Demo pública: cada rubro se muestra con sus productos y ejemplos (encargos, pedidos…)
    if (IS_DEMO_BUILD && profiles.join() !== was.join()) import('../demo/session').then((m) => m.loadDemoRubro(profiles));
  };

  return {
    ...loadState(),
    intents: readIntents(),

    setIntents: (intents) => {
      const clean = ALL_INTENTS.filter((i) => intents.includes(i));
      setStoreSetting('business_intents', JSON.stringify(clean));
      set({ intents: clean });
    },

    setProfile: (profile) => apply([profile], featuresOfProfile(profile)),

    setProfiles: (profiles) => {
      const clean = normalizeProfiles(profiles);
      apply(clean, featuresOfProfiles(clean));
    },

    toggleProfile: (profile) => {
      const { profiles, features } = get();
      // El consultorio no se combina: elegirlo es quedarse solo con él (y dejarlo, volver a kiosco)
      if (isConsultorio(profile) || isConsultorio(profiles[0])) {
        const only: BusinessProfile = profiles.includes(profile) ? 'KIOSKO' : profile;
        return apply([only], featuresOfProfile(only));
      }
      if (profiles.includes(profile)) {
        if (profiles.length === 1) return; // siempre queda al menos uno
        const rest = profiles.filter((p) => p !== profile);
        // Se apaga lo que traía ese rubro y no usa ninguno de los que quedan
        const keep = featuresOfProfiles(rest);
        const next = { ...features };
        for (const f of PROFILE_FEATURES[profile]) if (!keep[f]) next[f] = false;
        return apply(rest, next);
      }
      const next = { ...features };
      for (const f of PROFILE_FEATURES[profile]) next[f] = true;
      apply([...profiles, profile], next);
    },

    setMainProfile: (profile) => {
      const { profiles, features } = get();
      if (!profiles.includes(profile) || profiles[0] === profile) return;
      apply([profile, ...profiles.filter((p) => p !== profile)], features);
    },

    setFeature: (feature, enabled) => {
      const features = { ...get().features, [feature]: enabled };
      persist(get().profiles, features);
      set({ features });
    },
  };
});

// Otro equipo cambió el rubro o las funciones: se aplican sin reiniciar
window.addEventListener(STORE_SETTINGS_EVENT, (e) => {
  const keys = (e as CustomEvent<string[]>).detail || [];
  if (keys.includes('business_intents')) useBusinessStore.setState({ intents: readIntents() });
  if (!keys.includes('business_profile') && !keys.includes('business_profiles') && !keys.includes('business_features')) return;
  const next = loadState();
  writeLegacy(next.features);
  useBusinessStore.setState(next);
});

/** El comercio tiene este rubro (como principal o sumado a otro). */
export const hasRubro = (profile: BusinessProfile): boolean => useBusinessStore.getState().profiles.includes(profile);

/** Igual que `hasRubro` pero re-renderiza cuando se cambian los rubros. */
export const useHasRubro = (profile: BusinessProfile): boolean =>
  useBusinessStore((s) => s.profiles.includes(profile));

/** "Kiosco / Almacén + Carnicería": para mostrar o para darle contexto a la IA. */
export const rubrosTitle = (profiles: BusinessProfile[]): string =>
  profiles.map((p) => PROFILE_LABELS[p]?.title).filter(Boolean).join(' + ');

/** Rubros que venden por kilo con balanza: los productos nuevos arrancan "por kilo". */
export const SCALE_PROFILES: BusinessProfile[] = ['CARNICERIA', 'FIAMBRERIA', 'VERDULERIA'];

/** Para leer fuera de React o dentro del render sin suscribirse (reemplazo directo del viejo localStorage.getItem). */
export const hasFeature = (feature: BusinessFeature): boolean => useBusinessStore.getState().features[feature];

/** Igual que `hasFeature` pero re-renderiza cuando se cambia la configuración. */
export const useFeature = (feature: BusinessFeature): boolean =>
  useBusinessStore((s) => s.features[feature]);
