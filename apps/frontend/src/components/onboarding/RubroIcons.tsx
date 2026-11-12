import type { BusinessProfile } from '../../stores/businessStore';

/**
 * Íconos propios de cada rubro para la bienvenida: mismo trazo, misma grilla (32 x 32) y un
 * relleno suave del mismo color, para que se vean de una familia y no como emojis sueltos.
 */
const FILL = { fill: 'currentColor', fillOpacity: 0.16 } as const;

const ICONS: Record<BusinessProfile, JSX.Element> = {
  // Almacén con toldo a rayas
  KIOSKO: (
    <>
      <path d="M6 14v12h20V14" />
      <path d="M4 8.5 6 5h20l2 3.5v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" {...FILL} />
      <path d="M10 5 8.6 10.5M16 5v5.5M22 5l1.4 5.5" />
      <path d="M13 26v-6.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5V26" {...FILL} />
    </>
  ),
  // Llave y tornillo
  FERRETERIA: (
    <>
      <path d="M19.5 5.5a6 6 0 0 0-6.9 8L5.2 20.9a2.5 2.5 0 0 0 3.5 3.5l7.4-7.4a6 6 0 0 0 8-6.9l-3.6 3.6-3.3-.6-.6-3.3z" {...FILL} />
      <path d="M22 20l5 5M24.5 18.5l-4 4M21 22.5l3 3" />
    </>
  ),
  // Remera colgada
  INDUMENTARIA: (
    <>
      <path d="M16 6.5a2 2 0 1 0-2-2" />
      <path d="M16 6.5v1.5" />
      <path d="M12 9 5 12.5l2.5 5 2.5-1V27h12V16.5l2.5 1 2.5-5L20 9a4 4 0 0 1-8 0z" {...FILL} />
    </>
  ),
  // Porción de pizza
  GASTRONOMIA: (
    <>
      <path d="M5 8.5C12 4 20 4 27 8.5L16 28z" {...FILL} />
      <path d="M7.3 12.3C12.8 9 19.2 9 24.7 12.3" />
      <circle cx="13" cy="15.5" r="1.6" />
      <circle cx="19" cy="17" r="1.6" />
      <circle cx="16" cy="21.5" r="1.4" />
    </>
  ),
  // Canasto con cosas de todo tipo
  MULTIRUBRO: (
    <>
      <path d="M10 14 13 6M22 14 19 6" />
      <path d="M4 14h24l-2.5 12.5a2 2 0 0 1-2 1.5h-15a2 2 0 0 1-2-1.5z" {...FILL} />
      <path d="M11 18.5v5M16 18.5v5M21 18.5v5" />
    </>
  ),
  // Camión de reparto
  DISTRIBUIDORA: (
    <>
      <path d="M3 8h15v14H3z" {...FILL} />
      <path d="M18 12h5.5l4.5 5v5h-10z" />
      <path d="M3 13h15M10.5 8v5" />
      <circle cx="8" cy="23.5" r="2.5" />
      <circle cx="23" cy="23.5" r="2.5" />
    </>
  ),
  // Impresora con hoja saliendo
  IMPRENTA: (
    <>
      <path d="M9 11V4h11l3 3v4" />
      <path d="M5 11h22a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.5M8.5 23H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2" {...FILL} />
      <path d="M8.5 18h15v10h-15z" />
      <path d="M12 22h8M12 25h5" />
      <circle cx="24" cy="15" r="1" fill="currentColor" />
    </>
  ),
  // Manzana con hoja
  NUTRICION: (
    <>
      <path d="M16 10c-2-2-8-2.5-9.5 3.5S8.5 27 13 27c1.4 0 2-.7 3-.7s1.6.7 3 .7c4.5 0 8-7.5 6.5-13.5S18 8 16 10z" {...FILL} />
      <path d="M16 10c0-2.5.8-4.5 2.5-6" />
      <path d="M17.5 7.5c1-2.5 4-3.5 6.5-3-.4 2.6-3.4 4.2-6.5 3z" />
    </>
  ),
};

export default function RubroIcon({ profile, className }: { profile: BusinessProfile; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[profile]}
    </svg>
  );
}
