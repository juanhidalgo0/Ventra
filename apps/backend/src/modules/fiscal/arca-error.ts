/**
 * Qué hacer con un error de ARCA. Es la decisión más importante de toda la integración:
 * reintentar algo rechazado no sirve, y dar por fallado algo que quizás se emitió duplica facturas.
 *
 * TRANSIENT  sin conexión, ARCA caído, ticket en renovación: se reintenta solo.
 * AMBIGUOUS  el pedido de CAE salió y no volvió respuesta: quizás se emitió. Antes de pedir
 *            otro número se le pregunta a ARCA por el que se usó.
 * CONFIG     falta algo del comercio (delegación, punto de venta, suscripción): se reintenta
 *            despacio y se muestra qué hay que hacer.
 * REJECTED   ARCA rechazó los datos: no se reintenta hasta que alguien corrija.
 * NUMBERING  otra caja usó el número: se pide el siguiente enseguida.
 */
export type ArcaErrorKind = 'TRANSIENT' | 'AMBIGUOUS' | 'CONFIG' | 'REJECTED' | 'NUMBERING';

export class ArcaError extends Error {
  constructor(public kind: ArcaErrorKind, message: string, public code: string | null = null) {
    super(message);
  }
}
