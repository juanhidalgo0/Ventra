import { Injectable, Logger } from '@nestjs/common';
import { ArcaEnvironment, MONEDA_PESOS } from './arca-endpoints';
import { ArcaTransport } from './arca-transport';
import { ArcaError } from './arca-error';
import { Importes } from './comprobante';

export interface WsfeContext {
  transport: ArcaTransport;
  environment: ArcaEnvironment;
  /** CUIT del comercio que factura. Con delegación no es el del certificado. */
  cuit: string;
}

export interface CbteAsociado {
  tipo: number;
  ptoVta: number;
  nro: number;
  cuit: string;
  fecha: string; // AAAAMMDD
}

export interface SolicitudCae {
  puntoVenta: number;
  cbteTipo: number;
  numero: number;
  fecha: string; // AAAAMMDD
  docTipo: number;
  docNro: string;
  condicionIvaReceptorId: number;
  importes: Importes;
  /** Notas de crédito: la factura que anulan */
  cbtesAsoc?: CbteAsociado[];
}

export interface RespuestaCae {
  cae: string;
  caeVencimiento: string; // AAAAMMDD
  numero: number;
  fecha: string; // AAAAMMDD
  observaciones: string[];
  /** La pasarela ya lo había emitido y devolvió la respuesta guardada */
  replayed: boolean;
}

export interface ComprobanteConsultado {
  numero: number;
  fecha: string;
  impTotal: number;
  docTipo: number;
  docNro: string;
  cae: string;
  caeVencimiento: string;
  /** Hora en que ARCA lo procesó, AAAAMMDDhhmmss */
  procesado: string | null;
  resultado: string | null;
}

export interface PuntoDeVenta {
  numero: number;
  emisionTipo: string;
  bloqueado: boolean;
  baja: string | null;
}

interface Mensaje { code: string; msg: string }

const NS = 'xmlns="http://ar.gov.afip.dif.FEV1/"';

/**
 * WSFEv1: el servicio que autoriza los comprobantes y devuelve el CAE.
 *
 * Se arma el XML a mano en vez de usar un cliente SOAP genérico: el sobre es corto,
 * evita una dependencia más y deja ver exactamente qué se le manda a ARCA, que es lo
 * primero que piden cuando hay que reclamar un rechazo. La autenticación va como
 * <Auth/>: la completa quien tiene el certificado (la pasarela de Ventra o esta caja).
 */
@Injectable()
export class WsfeService {
  private readonly logger = new Logger(WsfeService.name);

  /** Prueba de vida del servicio. Sirve para "Probar conexión" sin emitir nada. */
  async dummy(ctx: WsfeContext): Promise<{ appServer: string; dbServer: string; authServer: string }> {
    const { xml } = await ctx.transport.call('FEDummy', `<FEDummy ${NS}></FEDummy>`, ctx);
    return {
      appServer: this.pick(xml, 'AppServer') || '?',
      dbServer: this.pick(xml, 'DbServer') || '?',
      authServer: this.pick(xml, 'AuthServer') || '?',
    };
  }

  /**
   * Último número autorizado para ese punto de venta y tipo de comprobante.
   * La numeración la lleva ARCA, no nosotros: siempre se pregunta antes de emitir,
   * porque si se saltea un número el comprobante se rechaza.
   */
  async ultimoAutorizado(ctx: WsfeContext, puntoVenta: number, cbteTipo: number): Promise<number> {
    const body = `<FECompUltimoAutorizado ${NS}><Auth/><PtoVta>${puntoVenta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo></FECompUltimoAutorizado>`;
    const { xml } = await ctx.transport.call('FECompUltimoAutorizado', body, ctx);
    this.throwOnErrors(xml, 'query');
    return Number(this.pick(xml, 'CbteNro') || 0);
  }

  /** Puntos de venta habilitados para web services. En homologación no hay ninguno (y no hace falta). */
  async puntosVenta(ctx: WsfeContext): Promise<PuntoDeVenta[]> {
    const { xml } = await ctx.transport.call('FEParamGetPtosVenta', `<FEParamGetPtosVenta ${NS}><Auth/></FEParamGetPtosVenta>`, ctx);
    if (this.errores(xml).some((e) => e.code === '602')) return [];
    this.throwOnErrors(xml, 'query');
    return [...xml.matchAll(/<PtoVenta>([\s\S]*?)<\/PtoVenta>/gi)].map((m) => ({
      numero: Number(this.pick(m[1], 'Nro')),
      emisionTipo: this.pick(m[1], 'EmisionTipo') || '',
      bloqueado: (this.pick(m[1], 'Bloqueado') || 'N').toUpperCase() === 'S',
      baja: this.pick(m[1], 'FchBaja') && this.pick(m[1], 'FchBaja') !== 'NULL' ? this.pick(m[1], 'FchBaja') : null,
    }));
  }

  /** Un comprobante ya emitido. null si ARCA no lo tiene. */
  async consultar(ctx: WsfeContext, cbteTipo: number, puntoVenta: number, numero: number): Promise<ComprobanteConsultado | null> {
    const body = `<FECompConsultar ${NS}><Auth/><FeCompConsReq><CbteTipo>${cbteTipo}</CbteTipo><CbteNro>${numero}</CbteNro><PtoVta>${puntoVenta}</PtoVta></FeCompConsReq></FECompConsultar>`;
    const { xml } = await ctx.transport.call('FECompConsultar', body, ctx);
    if (this.errores(xml).some((e) => e.code === '602')) return null;
    this.throwOnErrors(xml, 'query');
    const res = this.pick(xml, 'ResultGet');
    if (!res) return null;
    return {
      numero: Number(this.pick(res, 'CbteDesde') || numero),
      fecha: this.pick(res, 'CbteFch') || '',
      impTotal: Number(this.pick(res, 'ImpTotal') || 0),
      docTipo: Number(this.pick(res, 'DocTipo') || 0),
      docNro: this.pick(res, 'DocNro') || '0',
      cae: this.pick(res, 'CodAutorizacion') || '',
      caeVencimiento: this.pick(res, 'FchVto') || '',
      procesado: this.pick(res, 'FchProceso'),
      resultado: this.pick(res, 'Resultado'),
    };
  }

  /** Pide el CAE de un comprobante. */
  async solicitarCae(ctx: WsfeContext, solicitud: SolicitudCae, ref: { docId: string; saleId: string; kind: string }): Promise<RespuestaCae> {
    const { importes } = solicitud;
    const plata = (n: number) => n.toFixed(2);

    const ivaXml = importes.Iva?.length
      ? `<Iva>${importes.Iva.map((a) => `<AlicIva><Id>${a.Id}</Id><BaseImp>${plata(a.BaseImp)}</BaseImp><Importe>${plata(a.Importe)}</Importe></AlicIva>`).join('')}</Iva>`
      : '';
    const asocXml = solicitud.cbtesAsoc?.length
      ? `<CbtesAsoc>${solicitud.cbtesAsoc.map((c) => `<CbteAsoc><Tipo>${c.tipo}</Tipo><PtoVta>${c.ptoVta}</PtoVta><Nro>${c.nro}</Nro><Cuit>${c.cuit}</Cuit><CbteFch>${c.fecha}</CbteFch></CbteAsoc>`).join('')}</CbtesAsoc>`
      : '';

    const body = `<FECAESolicitar ${NS}><Auth/><FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${solicitud.puntoVenta}</PtoVta><CbteTipo>${solicitud.cbteTipo}</CbteTipo></FeCabReq><FeDetReq><FECAEDetRequest>`
      + `<Concepto>1</Concepto><DocTipo>${solicitud.docTipo}</DocTipo><DocNro>${solicitud.docNro}</DocNro>`
      + `<CbteDesde>${solicitud.numero}</CbteDesde><CbteHasta>${solicitud.numero}</CbteHasta><CbteFch>${solicitud.fecha}</CbteFch>`
      + `<ImpTotal>${plata(importes.ImpTotal)}</ImpTotal><ImpTotConc>${plata(importes.ImpTotConc)}</ImpTotConc><ImpNeto>${plata(importes.ImpNeto)}</ImpNeto>`
      + `<ImpOpEx>${plata(importes.ImpOpEx)}</ImpOpEx><ImpTrib>${plata(importes.ImpTrib)}</ImpTrib><ImpIVA>${plata(importes.ImpIVA)}</ImpIVA>`
      + `<MonId>${MONEDA_PESOS}</MonId><MonCotiz>1</MonCotiz><CondicionIVAReceptorId>${solicitud.condicionIvaReceptorId}</CondicionIVAReceptorId>`
      + `${asocXml}${ivaXml}</FECAEDetRequest></FeDetReq></FeCAEReq></FECAESolicitar>`;

    const { xml, replayed } = await ctx.transport.call('FECAESolicitar', body, { ...ctx, ref });
    this.throwOnErrors(xml, 'emission');

    const det = this.pick(xml, 'FECAEDetResponse') || xml;
    const resultado = this.pick(det, 'Resultado') || this.pick(xml, 'Resultado');
    const observaciones = this.mensajes(this.pick(det, 'Observaciones')).map((o) => `[${o.code}] ${o.msg}`);
    const cae = this.pick(det, 'CAE');

    if (resultado === 'R' || !cae) {
      const obs = this.mensajes(this.pick(det, 'Observaciones'));
      // 10016: el número ya no es el próximo (otra caja emitió en el medio)
      if (obs.some((o) => o.code === '10016')) {
        throw new ArcaError('NUMBERING', 'Otra caja emitió con ese número', '10016');
      }
      const detalle = observaciones.length ? `: ${observaciones.join(' | ')}` : '';
      if (obs.some((o) => /punto de venta/i.test(o.msg))) {
        throw new ArcaError('CONFIG', `ARCA no acepta el punto de venta${detalle}`, obs[0]?.code || null);
      }
      if (resultado !== 'R') {
        // Ni aprobado ni rechazado: se trata como una respuesta que no llegó
        throw new ArcaError('AMBIGUOUS', `ARCA no devolvió el CAE${detalle}`, 'NO_CAE');
      }
      throw new ArcaError('REJECTED', `ARCA rechazó el comprobante${detalle}`, obs[0]?.code || null);
    }

    return {
      cae,
      caeVencimiento: this.pick(det, 'CAEFchVto') || '',
      numero: Number(this.pick(det, 'CbteDesde') || solicitud.numero),
      fecha: this.pick(det, 'CbteFch') || solicitud.fecha,
      observaciones,
      replayed: Boolean(replayed),
    };
  }

  /**
   * Los <Err> son problemas del pedido: token, CUIT sin permisos, datos mal.
   * En una emisión, lo que no es de configuración ni de ARCA caído es un rechazo.
   */
  private throwOnErrors(xml: string, mode: 'query' | 'emission') {
    const errores = this.errores(xml);
    if (!errores.length) return;
    const detalle = errores.map((e) => `[${e.code}] ${e.msg}`).join(' | ');
    const codes = errores.map((e) => e.code);

    // El comercio no autorizó a Ventra (o lo hizo hace segundos y el ticket no lo incluye)
    if (codes.some((c) => c === '600' || c === '601') && /relaci|representad/i.test(detalle)) {
      throw new ArcaError('CONFIG', `ARCA no tiene registrada la autorización de esta CUIT a Ventra (${detalle})`, 'DELEGATION');
    }
    if (codes.some((c) => c === '600' || c === '601')) {
      throw new ArcaError('TRANSIENT', `ARCA no aceptó el ticket de acceso: ${detalle}`, codes[0]);
    }
    // 500-504: error interno de ARCA
    if (codes.some((c) => /^50\d$/.test(c))) {
      throw new ArcaError(mode === 'emission' ? 'AMBIGUOUS' : 'TRANSIENT', `ARCA tuvo un error interno: ${detalle}`, codes[0]);
    }
    if (/punto de venta/i.test(detalle)) {
      throw new ArcaError('CONFIG', `ARCA no acepta el punto de venta: ${detalle}`, codes[0]);
    }
    if (mode === 'emission') throw new ArcaError('REJECTED', `ARCA rechazó el comprobante: ${detalle}`, codes[0]);
    throw new ArcaError('CONFIG', `ARCA devolvió un error: ${detalle}`, codes[0]);
  }

  private errores(xml: string): Mensaje[] {
    return this.mensajes(this.pick(xml, 'Errors'));
  }

  private mensajes(bloque: string | null): Mensaje[] {
    if (!bloque) return [];
    const mensajes = [...bloque.matchAll(/<Msg>([\s\S]*?)<\/Msg>/gi)].map((m) => m[1].trim());
    const codigos = [...bloque.matchAll(/<Code>([\s\S]*?)<\/Code>/gi)].map((m) => m[1].trim());
    return mensajes.map((msg, i) => ({ code: codigos[i] || '?', msg }));
  }

  private pick(xml: string, tag: string): string | null {
    const match = String(xml || '').match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i'));
    return match ? match[1].trim() : null;
  }
}
