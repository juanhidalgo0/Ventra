import type { BusinessProfile } from './stores/businessStore';

/**
 * Novedades de cada versión, para el comerciante (no para programadores).
 *
 * Al publicar una versión: agregá arriba de todo una entrada con el MISMO número del package.json raíz.
 * Se muestra sola una vez al dueño después de actualizar (ver WhatsNew.tsx) y queda en Ayuda → Novedades.
 *
 * Cómo escribirlas:
 * - De 3 a 5 puntos. Lo que el usuario nota: nada de sync, auditorías ni cambios internos.
 * - Hablale al comerciante: "Ahora podés…", "Ya no pasa que…". Sin nombres de archivos ni de funciones.
 * - `plan`: solo lo ve quien tiene esa parte (caja, tienda o agenda). `rubros`: solo esos rubros.
 * - Una versión que no tenga nada que contar no lleva entrada.
 * - `pedido: true` si la idea vino de un cliente (Sugerí una idea): sale "Lo pidió un cliente".
 */
export type TipoNovedad = 'nuevo' | 'mejora' | 'arreglo';

export interface Novedad {
  tipo: TipoNovedad;
  titulo: string;
  detalle?: string;
  plan?: 'caja' | 'tienda' | 'agenda';
  /** Salió de "Sugerí una idea": muestra "Lo pidió un cliente" */
  pedido?: boolean;
  rubros?: BusinessProfile[];
}

export interface VersionNovedades {
  version: string;
  /** AAAA-MM-DD */
  fecha: string;
  items: Novedad[];
}

export const NOVEDADES: VersionNovedades[] = [
  {
    version: '1.0.120',
    fecha: '2026-11-27',
    items: [
      {
        tipo: 'nuevo',
        titulo: 'Tu año en Ventra',
        detalle: 'Tu año contado en historias: lo que vendiste, tu día récord, el producto estrella, la hora pico y mes a mes. Está en Reportes, y en diciembre te lo avisamos.',
        plan: 'caja',
      },
      {
        tipo: 'nuevo',
        titulo: 'Llega la Navidad a tu caja',
        detalle: 'Del 1 de diciembre al 6 de enero la caja se pone de fiesta sola: luces, gorrito y cuántos días faltan para Navidad. No hace falta cerrar ni reiniciar nada.',
      },
      {
        tipo: 'mejora',
        titulo: 'Productos por kilo que vienen en bolsa',
        detalle: 'Al cargar algo que se vende por kilo, poné lo que pesa la bolsa o el bulto (por ejemplo, gomitas de 900 g) y lo que te costó: el precio por kilo se calcula solo.',
      },
      {
        tipo: 'nuevo',
        titulo: 'Deshacer',
        detalle: 'Si borrás algo sin querer (un producto, un gasto, un cliente, una promo), tocá Deshacer o Ctrl+Z en los 8 segundos siguientes y vuelve como estaba.',
      },
      {
        tipo: 'nuevo',
        titulo: 'Invitá un comercio y ganá un mes gratis',
        detalle: 'Mandale tu link a otro comercio: prueba Ventra 30 días gratis y, cuando paga su primer mes, tu próximo mes sale gratis. Lo encontrás con Ctrl+K o en el celular, en Más.',
      },
      {
        tipo: 'nuevo',
        titulo: 'Boletas con bonificaciones y redondeo',
        detalle: 'Los regalos del proveedor (24 + 2 sin cargo) y los descuentos por renglón se cargan solos, y podés redondear los precios a $10, $50, $100 o $1.000.',
        plan: 'caja',
      },
      {
        tipo: 'mejora',
        titulo: 'Más cómodo de usar',
        detalle: 'Letra más grande en Configuración → Esta PC. Arriba, un punto verde te dice si está todo funcionando (internet, nube, impresora). Y en Ayuda → Sugerí una idea nos contás qué le falta a Ventra.',
      },
      {
        tipo: 'arreglo',
        titulo: 'Costos con decimales y hora trabajada',
        detalle: 'Un costo como 1802.67 ya no se lee como 18 millones, y el valor de la hora trabajada se puede borrar.',
      },
    ],
  },
];
