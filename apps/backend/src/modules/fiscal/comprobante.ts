import { CBTE_TIPO, DOC_TIPO, IVA_ALICUOTA_ID, IVA_RECEPTOR, IvaCondition } from './arca-endpoints';

/**
 * Decisiones puras de facturación: qué comprobante corresponde y cómo se reparten
 * los importes. Está separado del cliente de ARCA a propósito, para poder probarlo
 * sin conexión: es donde se juegan los rechazos más caros.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type EmisorCondition = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO';

export interface ComprobanteTipo {
  cbteTipo: number;
  invoiceType: string;
  /** La factura A sólo se puede emitir con CUIT del receptor */
  requiresCuit: boolean;
  /** El monotributo no discrimina IVA: el total va derecho, sin alícuotas */
  discriminatesIva: boolean;
}

/**
 * Qué factura corresponde. La letra la define el emisor; la A o B, la condición del
 * receptor. El monotributista emite siempre C, le venda a quien le venda.
 */
export function decideCbteTipo(emisor: EmisorCondition, receptor: IvaCondition): ComprobanteTipo {
  if (emisor === 'MONOTRIBUTO') {
    return { cbteTipo: CBTE_TIPO.FACTURA_C, invoiceType: 'FACTURA_C', requiresCuit: false, discriminatesIva: false };
  }
  if (receptor === 'RESPONSABLE_INSCRIPTO') {
    return { cbteTipo: CBTE_TIPO.FACTURA_A, invoiceType: 'FACTURA_A', requiresCuit: true, discriminatesIva: true };
  }
  return { cbteTipo: CBTE_TIPO.FACTURA_B, invoiceType: 'FACTURA_B', requiresCuit: false, discriminatesIva: true };
}

/** La nota de crédito de una factura es la de su misma letra. */
export function notaCreditoDe(factura: ComprobanteTipo): ComprobanteTipo {
  switch (factura.cbteTipo) {
    case CBTE_TIPO.FACTURA_A: return { ...factura, cbteTipo: CBTE_TIPO.NOTA_CREDITO_A, invoiceType: 'NC_A' };
    case CBTE_TIPO.FACTURA_B: return { ...factura, cbteTipo: CBTE_TIPO.NOTA_CREDITO_B, invoiceType: 'NC_B' };
    default: return { ...factura, cbteTipo: CBTE_TIPO.NOTA_CREDITO_C, invoiceType: 'NC_C' };
  }
}

/** Tipo de comprobante a partir del código de ARCA (para reconstruir el de una factura ya emitida). */
export function tipoDesdeCodigo(cbteTipo: number): ComprobanteTipo {
  const discriminatesIva = cbteTipo !== CBTE_TIPO.FACTURA_C && cbteTipo !== CBTE_TIPO.NOTA_CREDITO_C;
  const map: Record<number, string> = {
    [CBTE_TIPO.FACTURA_A]: 'FACTURA_A', [CBTE_TIPO.FACTURA_B]: 'FACTURA_B', [CBTE_TIPO.FACTURA_C]: 'FACTURA_C',
    [CBTE_TIPO.NOTA_CREDITO_A]: 'NC_A', [CBTE_TIPO.NOTA_CREDITO_B]: 'NC_B', [CBTE_TIPO.NOTA_CREDITO_C]: 'NC_C',
  };
  return {
    cbteTipo,
    invoiceType: map[cbteTipo] || 'FACTURA_C',
    requiresCuit: cbteTipo === CBTE_TIPO.FACTURA_A || cbteTipo === CBTE_TIPO.NOTA_CREDITO_A,
    discriminatesIva,
  };
}

/** CUIT válida: 11 dígitos y dígito verificador (módulo 11). */
export function cuitValida(value?: string | null): boolean {
  const cuit = (value || '').replace(/\D/g, '');
  if (cuit.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(cuit[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(cuit[10]);
}

export interface ReceptorInput {
  cuit?: string | null;
  dni?: string | null;
  name?: string | null;
  ivaCondition?: string | null;
}

export interface Receptor {
  docTipo: number;
  docNro: string;
  name: string;
  ivaCondition: IvaCondition;
  condicionIvaId: number;
}

const LIMPIAR_DOC = (v?: string | null) => (v || '').replace(/\D/g, '');

/**
 * Datos del receptor tal como van al comprobante. Sin cliente identificado es
 * consumidor final, que es la venta de mostrador de todos los días.
 */
export function resolveReceptor(input: ReceptorInput | null | undefined): Receptor {
  const cuit = LIMPIAR_DOC(input?.cuit);
  const dni = LIMPIAR_DOC(input?.dni);
  const condition = (input?.ivaCondition || 'CONSUMIDOR_FINAL') as IvaCondition;
  const ivaCondition: IvaCondition = condition in IVA_RECEPTOR ? condition : 'CONSUMIDOR_FINAL';

  if (cuit.length === 11) {
    return {
      docTipo: DOC_TIPO.CUIT,
      docNro: cuit,
      name: input?.name || '',
      ivaCondition,
      condicionIvaId: IVA_RECEPTOR[ivaCondition],
    };
  }
  if (dni.length >= 7 && dni.length <= 8) {
    // Con DNI el receptor no puede ser responsable inscripto: eso pide CUIT
    const conDni: IvaCondition = ivaCondition === 'RESPONSABLE_INSCRIPTO' ? 'CONSUMIDOR_FINAL' : ivaCondition;
    return {
      docTipo: DOC_TIPO.DNI,
      docNro: dni,
      name: input?.name || '',
      ivaCondition: conDni,
      condicionIvaId: IVA_RECEPTOR[conDni],
    };
  }
  return {
    docTipo: DOC_TIPO.CONSUMIDOR_FINAL,
    docNro: '0',
    name: input?.name || 'Consumidor Final',
    ivaCondition: 'CONSUMIDOR_FINAL',
    condicionIvaId: IVA_RECEPTOR.CONSUMIDOR_FINAL,
  };
}

/**
 * Lo que no es una venta propia del comercio y no va a la factura: los pagos de cuenta
 * corriente (es cobrar una deuda, la venta ya se facturó) y las cargas virtuales
 * (recargas y similares, que el comercio cobra por cuenta de otro).
 */
const NO_FACTURABLES = new Set(['PAGO_CTA_CTE', 'VIRTUAL_LOAD_1', 'VIRTUAL_LOAD_2']);
export const esFacturable = (productId: string) => !NO_FACTURABLES.has(productId);

export interface ItemInput {
  /** Importe final de la línea, con IVA incluido (así se venden los precios en el mostrador) */
  total: number;
  /** Alícuota del producto: 0, 10.5, 21, 27... (0 o sin cargar = la alícuota general del comercio) */
  taxRate: number;
}

export interface IvaLine {
  Id: number;
  BaseImp: number;
  Importe: number;
  /** Alícuota en porcentaje, para imprimirla */
  rate: number;
}

export interface Importes {
  ImpTotal: number;
  ImpNeto: number;
  ImpIVA: number;
  ImpTotConc: number;
  ImpOpEx: number;
  ImpTrib: number;
  Iva?: IvaLine[];
}

/** Alícuotas que ARCA acepta para productos (las de 0 % no se usan: el producto sin dato toma la general). */
const ALICUOTAS_VALIDAS = new Set([2.5, 5, 10.5, 21, 27]);

/**
 * Reparte el total de la venta en neto e IVA por alícuota.
 *
 * Los precios del POS son finales (con IVA), así que se va para atrás: neto = final / (1 + tasa).
 * ARCA valida que ImpTotal sea exactamente ImpNeto + ImpIVA + ImpTrib + ImpOpEx; por eso la
 * última alícuota absorbe el resto del redondeo en vez de dejar una diferencia de un centavo,
 * que es el rechazo 10048 y el más común al integrar.
 */
export function buildImportes(items: ItemInput[], saleDiscount: number, tipo: ComprobanteTipo, defaultIvaRate = 21): Importes {
  const brutoItems = items.reduce((acc, i) => acc + (Number(i.total) || 0), 0);
  const descuento = Math.max(0, Number(saleDiscount) || 0);
  const factor = brutoItems > 0 ? Math.max(0, brutoItems - descuento) / brutoItems : 0;
  const totalFinal = round2(brutoItems * factor);

  if (totalFinal <= 0) {
    throw new ComprobanteError('El total a facturar tiene que ser mayor a cero');
  }

  if (!tipo.discriminatesIva) {
    // Factura C: el total va derecho al neto, sin alícuotas
    return { ImpTotal: totalFinal, ImpNeto: totalFinal, ImpIVA: 0, ImpTotConc: 0, ImpOpEx: 0, ImpTrib: 0 };
  }

  const general = ALICUOTAS_VALIDAS.has(Number(defaultIvaRate)) ? Number(defaultIvaRate) : 21;
  const porTasa = new Map<number, number>();
  for (const item of items) {
    const propia = Number(item.taxRate) || 0;
    const tasa = ALICUOTAS_VALIDAS.has(propia) ? propia : general;
    const bruto = (Number(item.total) || 0) * factor;
    porTasa.set(tasa, (porTasa.get(tasa) || 0) + bruto);
  }
  // Una devolución dentro de la venta puede dejar una alícuota en negativo: ARCA no lo acepta
  for (const [tasa, bruto] of porTasa) {
    if (round2(bruto) < 0) {
      throw new ComprobanteError(`Los productos al ${tasa}% suman en negativo (hay una devolución): emití una nota de crédito en vez de una factura`);
    }
    if (round2(bruto) === 0) porTasa.delete(tasa);
  }

  const lineas: IvaLine[] = [];
  let netoAcumulado = 0;
  let ivaAcumulado = 0;

  const tasas = [...porTasa.keys()].sort((a, b) => a - b);
  tasas.forEach((tasa, index) => {
    const bruto = porTasa.get(tasa)!;
    const esUltima = index === tasas.length - 1;

    let neto = round2(bruto / (1 + tasa / 100));
    let iva = round2(bruto - neto);

    if (esUltima) {
      // La última alícuota cierra el total exacto: ARCA no perdona un centavo de diferencia
      const resto = round2(totalFinal - netoAcumulado - ivaAcumulado);
      neto = round2(resto / (1 + tasa / 100));
      iva = round2(resto - neto);
    }

    netoAcumulado = round2(netoAcumulado + neto);
    ivaAcumulado = round2(ivaAcumulado + iva);
    lineas.push({ Id: IVA_ALICUOTA_ID[String(tasa)], BaseImp: neto, Importe: iva, rate: tasa });
  });

  return {
    ImpTotal: totalFinal,
    ImpNeto: netoAcumulado,
    ImpIVA: ivaAcumulado,
    ImpTotConc: 0,
    ImpOpEx: 0,
    ImpTrib: 0,
    Iva: lineas,
  };
}

/** Un dato de la venta o del cliente que impide emitir: no tiene sentido reintentarlo solo. */
export class ComprobanteError extends Error {}

// ─── Fechas ─────────────────────────────────────────────────────────
// ARCA trabaja con fechas de Argentina. El servidor de la nube corre en UTC: a las 21 h de
// acá ya es el día siguiente allá, y una venta del 31 quedaría declarada en el mes que viene.
const TZ = 'America/Argentina/Buenos_Aires';

/** AAAA-MM-DD en hora argentina. */
export function isoDateArgentina(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Fecha en el formato que pide ARCA: AAAAMMDD, sin separadores, en hora argentina. */
export function fechaArca(date: Date): string {
  return isoDateArgentina(date).replace(/-/g, '');
}

/** AAAAMMDD → AAAA-MM-DD */
export const fechaArcaIso = (value?: string | null) =>
  value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;

/**
 * Vuelve de AAAAMMDD a Date (el vencimiento del CAE llega así). Se fija al mediodía de
 * Argentina para que se muestre el mismo día en cualquier huso.
 */
export function parseFechaArca(value?: string | null): Date | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
}

/**
 * QR obligatorio en el comprobante (RG 4892): un JSON en base64 colgado de la URL de
 * ARCA, que es lo que lee el cliente para verificar que el comprobante existe.
 * Los datos tienen que ser exactamente los declarados: fecha e importe del comprobante.
 */
export function qrUrl(d: {
  issueDate: string; cuit: string; pointOfSale: number; cbteTipo: number; number: number;
  total: number; docTipo: number; docNro: string; cae: string;
}): string {
  const datos = {
    ver: 1,
    fecha: fechaArcaIso(d.issueDate),
    cuit: Number(d.cuit),
    ptoVta: d.pointOfSale,
    tipoCmp: d.cbteTipo,
    nroCmp: d.number,
    importe: round2(d.total),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: d.docTipo,
    nroDocRec: Number(d.docNro) || 0,
    tipoCodAut: 'E',
    codAut: Number(d.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(datos), 'utf8').toString('base64')}`;
}
