/**
 * Servicios web de ARCA (ex AFIP) para facturación electrónica.
 *
 * Son dos servicios encadenados:
 *   WSAA   autentica con un certificado y devuelve un ticket de acceso (token + sign) que dura 12 horas.
 *   WSFEv1 pide el CAE de cada comprobante, usando ese ticket.
 *
 * Los dominios siguen siendo afip.gov.ar después del cambio de nombre del organismo.
 */

export type ArcaEnvironment = 'HOMOLOGACION' | 'PRODUCCION';

interface Endpoints {
  wsaa: string;
  wsfe: string;
}

export const ARCA_ENDPOINTS: Record<ArcaEnvironment, Endpoints> = {
  HOMOLOGACION: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  PRODUCCION: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
};

/** Códigos de comprobante de ARCA (tabla FEParamGetTiposCbte). */
export const CBTE_TIPO = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FACTURA_B: 6,
  NOTA_DEBITO_B: 7,
  NOTA_CREDITO_B: 8,
  FACTURA_C: 11,
  NOTA_DEBITO_C: 12,
  NOTA_CREDITO_C: 13,
} as const;

/** Tipos de documento del receptor (tabla FEParamGetTiposDoc). */
export const DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
} as const;

/**
 * Condición del receptor frente al IVA. Desde la RG 5616 el comprobante tiene que
 * declararla siempre, así que la guardamos en el cliente y la copiamos a la venta.
 */
export const IVA_RECEPTOR = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 15,
} as const;

export type IvaCondition = keyof typeof IVA_RECEPTOR;

/** Códigos de alícuota de IVA (tabla FEParamGetTiposIva). */
export const IVA_ALICUOTA_ID: Record<string, number> = {
  '0': 3,
  '10.5': 4,
  '21': 5,
  '27': 6,
  '5': 8,
  '2.5': 9,
};

/** Monedas: por ahora sólo pesos, que es el 100% del mostrador. */
export const MONEDA_PESOS = 'PES';
