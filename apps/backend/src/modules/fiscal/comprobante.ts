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
export function notaCreditoDe(cbteTipo: number): number {
  switch (cbteTipo) {
    case CBTE_TIPO.FACTURA_A: return CBTE_TIPO.NOTA_CREDITO_A;
    case CBTE_TIPO.FACTURA_B: return CBTE_TIPO.NOTA_CREDITO_B;
    default: return CBTE_TIPO.NOTA_CREDITO_C;
  }
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
  if (dni.length >= 7) {
    return {
      docTipo: DOC_TIPO.DNI,
      docNro: dni,
      name: input?.name || '',
      ivaCondition,
      condicionIvaId: IVA_RECEPTOR[ivaCondition],
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

export interface ItemInput {
  /** Importe final de la línea, con IVA incluido (así se venden los precios en el mostrador) */
  total: number;
  /** Alícuota del producto: 0, 10.5, 21, 27... */
  taxRate: number;
}

export interface IvaLine {
  Id: number;
  BaseImp: number;
  Importe: number;
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

/**
 * Reparte el total de la venta en neto e IVA por alícuota.
 *
 * Los precios del POS son finales (con IVA), así que se va para atrás: neto = final / (1 + tasa).
 * ARCA valida que ImpTotal sea exactamente ImpNeto + ImpIVA + ImpTrib + ImpOpEx; por eso la
 * última alícuota absorbe el resto del redondeo en vez de dejar una diferencia de un centavo,
 * que es el rechazo 10048 y el más común al integrar.
 */
export function buildImportes(items: ItemInput[], saleDiscount: number, tipo: ComprobanteTipo): Importes {
  const brutoItems = items.reduce((acc, i) => acc + (Number(i.total) || 0), 0);
  const descuento = Math.max(0, Number(saleDiscount) || 0);
  const factor = brutoItems > 0 ? Math.max(0, brutoItems - descuento) / brutoItems : 0;
  const totalFinal = round2(brutoItems * factor);

  if (!tipo.discriminatesIva) {
    // Factura C: el total va derecho al neto, sin alícuotas
    return { ImpTotal: totalFinal, ImpNeto: totalFinal, ImpIVA: 0, ImpTotConc: 0, ImpOpEx: 0, ImpTrib: 0 };
  }

  const porTasa = new Map<number, number>();
  for (const item of items) {
    const tasa = Number(item.taxRate) || 0;
    const bruto = (Number(item.total) || 0) * factor;
    porTasa.set(tasa, (porTasa.get(tasa) || 0) + bruto);
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
      neto = round2(totalFinal - netoAcumulado - ivaAcumulado - iva);
      iva = round2(totalFinal - netoAcumulado - ivaAcumulado - neto);
    }

    netoAcumulado = round2(netoAcumulado + neto);
    ivaAcumulado = round2(ivaAcumulado + iva);

    const alicuotaId = IVA_ALICUOTA_ID[String(tasa)] ?? IVA_ALICUOTA_ID['21'];
    lineas.push({ Id: alicuotaId, BaseImp: neto, Importe: iva });
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

/** Fecha en el formato que pide ARCA: AAAAMMDD, sin separadores. */
export function fechaArca(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Vuelve de AAAAMMDD a Date (el vencimiento del CAE llega así). */
export function parseFechaArca(value?: string | null): Date | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  return new Date(y, m - 1, d);
}
