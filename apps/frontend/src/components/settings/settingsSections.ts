import {
  Store, LayoutGrid, Printer, Wallet, CreditCard, Users, Laptop, BadgeCheck, Link2, Database, ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import type { BusinessFeature } from '../../stores/businessStore';

export type SettingsTab =
  | 'comercio' | 'rubros' | 'tickets'
  | 'caja' | 'pagos'
  | 'personal'
  | 'equipo' | 'suscripcion' | 'integraciones' | 'backups'
  | 'mantenimiento';

export interface SettingsSection {
  id: SettingsTab;
  label: string;
  description: string;
  icon: LucideIcon;
  group: 'Tu negocio' | 'Caja' | 'Equipo' | 'Sistema' | null;
  adminOnly?: boolean;
  danger?: boolean;
}

/**
 * Índice de Configuración, igual en la PC y en el celular. El orden es el del menú:
 * primero el negocio, después la caja, la gente y el sistema; borrar datos va al final.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'comercio', label: 'Comercio', description: 'Nombre, datos fiscales y logo de tu negocio.', icon: Store, group: 'Tu negocio' },
  { id: 'rubros', label: 'Rubros y funciones', description: 'Qué vendés y qué partes de Ventra usás.', icon: LayoutGrid, group: 'Tu negocio' },
  { id: 'tickets', label: 'Tickets e impresoras', description: 'Cómo sale el ticket y por qué impresora.', icon: Printer, group: 'Tu negocio' },
  { id: 'caja', label: 'Caja y cobro', description: 'Vuelto, stock, cierres y fondo inicial.', icon: Wallet, group: 'Caja' },
  { id: 'pagos', label: 'Medios de pago', description: 'Posnets, recargos y cargas virtuales.', icon: CreditCard, group: 'Caja' },
  { id: 'personal', label: 'Personal', description: 'Usuarios, celulares, claves y sueldos.', icon: Users, group: 'Equipo', adminOnly: true },
  { id: 'equipo', label: 'Esta PC', description: 'Nombre y rendimiento de este equipo.', icon: Laptop, group: 'Sistema' },
  { id: 'suscripcion', label: 'Plan y nube', description: 'Tu plan de Ventra y la copia en la nube.', icon: BadgeCheck, group: 'Sistema', adminOnly: true },
  { id: 'integraciones', label: 'Conexiones', description: 'Mercado Pago y GO Delivery.', icon: Link2, group: 'Sistema', adminOnly: true },
  { id: 'backups', label: 'Copias de seguridad', description: 'Copias automáticas y restauración.', icon: Database, group: 'Sistema', adminOnly: true },
  { id: 'mantenimiento', label: 'Borrar datos', description: 'Vaciar stock, cajas o productos. No se puede deshacer.', icon: ShieldAlert, group: null, danger: true },
];

/** Nombres viejos de las secciones (links guardados, la app del celular de antes, "Primeros pasos"). */
const LEGACY_TABS: Record<string, SettingsTab> = { general: 'comercio', posnets: 'pagos', recargos: 'pagos' };

export function normalizeSettingsTab(tab: string | null | undefined): SettingsTab | null {
  if (!tab) return null;
  if (LEGACY_TABS[tab]) return LEGACY_TABS[tab];
  return SETTINGS_SECTIONS.some((s) => s.id === tab) ? (tab as SettingsTab) : null;
}

export function settingsSection(tab: string | null | undefined): SettingsSection | undefined {
  const id = normalizeSettingsTab(tab);
  return SETTINGS_SECTIONS.find((s) => s.id === id);
}

/** Funciones activables, agrupadas por tema para que la lista no sea una sola tira. */
export const FEATURE_GROUPS: { title: string; features: BusinessFeature[] }[] = [
  { title: 'Ventas y clientes', features: ['quotes', 'acopio', 'tradePricing', 'substitutes', 'delivery'] },
  { title: 'Productos y stock', features: ['fractional', 'hardwareImages', 'variants', 'expiry', 'bulk'] },
  { title: 'Pedidos y encargos', features: ['preorders', 'workorders', 'clientorders'] },
  { title: 'Rubros especiales', features: ['scaleLabels', 'desposte', 'patients', 'monthfund'] },
];
