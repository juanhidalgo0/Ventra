import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { ARCA_ENDPOINTS, ArcaEnvironment, MONEDA_PESOS } from './arca-endpoints';
import { arcaHttpsAgent } from './arca-http';
import { AccessTicket } from './wsaa.service';
import { Importes } from './comprobante';

export interface WsfeAuth {
  ticket: AccessTicket;
  /** CUIT del comercio que factura. Con delegación no es el del certificado. */
  cuit: string;
  environment: ArcaEnvironment;
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
}

export interface RespuestaCae {
  cae: string;
  caeVencimiento: string; // AAAAMMDD
  numero: number;
  observaciones: string[];
}

/**
 * WSFEv1: el servicio que autoriza los comprobantes y devuelve el CAE.
 *
 * Se arma el XML a mano en vez de usar un cliente SOAP genérico: el sobre es corto,
 * evita una dependencia más y deja ver exactamente qué se le manda a ARCA, que es lo
 * primero que piden cuando hay que reclamar un rechazo.
 */
@Injectable()
export class WsfeService {
  private readonly logger = new Logger(WsfeService.name);

  /** Prueba de vida del servicio. Sirve para el botón "Probar conexión" sin emitir nada. */
  async dummy(environment: ArcaEnvironment): Promise<{ appServer: string; dbServer: string; authServer: string }> {
    const body = '<FEDummy xmlns="http://ar.gov.afip.dif.FEV1/" />';
    const xml = await this.call(environment, 'FEDummy', body);
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
  async ultimoAutorizado(auth: WsfeAuth, puntoVenta: number, cbteTipo: number): Promise<number> {
    const body = `<FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">
      ${this.authXml(auth)}
      <PtoVta>${puntoVenta}</PtoVta>
      <CbteTipo>${cbteTipo}</CbteTipo>
    </FECompUltimoAutorizado>`;

    const xml = await this.call(auth.environment, 'FECompUltimoAutorizado', body);
    this.throwOnErrors(xml);
    const nro = this.pick(xml, 'CbteNro');
    return Number(nro || 0);
  }

  /** Pide el CAE de un comprobante. */
  async solicitarCae(auth: WsfeAuth, solicitud: SolicitudCae): Promise<RespuestaCae> {
    const { importes } = solicitud;

    const ivaXml = importes.Iva?.length
      ? `<Iva>${importes.Iva.map(
          (a) => `<AlicIva><Id>${a.Id}</Id><BaseImp>${a.BaseImp.toFixed(2)}</BaseImp><Importe>${a.Importe.toFixed(2)}</Importe></AlicIva>`,
        ).join('')}</Iva>`
      : '';

    const body = `<FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">
      ${this.authXml(auth)}
      <FeCAEReq>
        <FeCabReq>
          <CantReg>1</CantReg>
          <PtoVta>${solicitud.puntoVenta}</PtoVta>
          <CbteTipo>${solicitud.cbteTipo}</CbteTipo>
        </FeCabReq>
        <FeDetReq>
          <FECAEDetRequest>
            <Concepto>1</Concepto>
            <DocTipo>${solicitud.docTipo}</DocTipo>
            <DocNro>${solicitud.docNro}</DocNro>
            <CbteDesde>${solicitud.numero}</CbteDesde>
            <CbteHasta>${solicitud.numero}</CbteHasta>
            <CbteFch>${solicitud.fecha}</CbteFch>
            <ImpTotal>${importes.ImpTotal.toFixed(2)}</ImpTotal>
            <ImpTotConc>${importes.ImpTotConc.toFixed(2)}</ImpTotConc>
            <ImpNeto>${importes.ImpNeto.toFixed(2)}</ImpNeto>
            <ImpOpEx>${importes.ImpOpEx.toFixed(2)}</ImpOpEx>
            <ImpTrib>${importes.ImpTrib.toFixed(2)}</ImpTrib>
            <ImpIVA>${importes.ImpIVA.toFixed(2)}</ImpIVA>
            <MonId>${MONEDA_PESOS}</MonId>
            <MonCotiz>1</MonCotiz>
            <CondicionIVAReceptorId>${solicitud.condicionIvaReceptorId}</CondicionIVAReceptorId>
            ${ivaXml}
          </FECAEDetRequest>
        </FeDetReq>
      </FeCAEReq>
    </FECAESolicitar>`;

    const xml = await this.call(auth.environment, 'FECAESolicitar', body);
    this.throwOnErrors(xml);

    const resultado = this.pick(xml, 'Resultado');
    const observaciones = this.observaciones(xml);

    if (resultado === 'R') {
      // Rechazado: las observaciones dicen exactamente qué dato está mal
      throw new BadRequestException(
        `ARCA rechazó el comprobante${observaciones.length ? ': ' + observaciones.join(' | ') : ''}`,
      );
    }

    const cae = this.pick(xml, 'CAE');
    const caeVencimiento = this.pick(xml, 'CAEFchVto');
    if (!cae) {
      throw new InternalServerErrorException(
        `ARCA no devolvió el CAE${observaciones.length ? ': ' + observaciones.join(' | ') : ''}`,
      );
    }

    return { cae, caeVencimiento: caeVencimiento || '', numero: solicitud.numero, observaciones };
  }

  private authXml(auth: WsfeAuth): string {
    return `<Auth>
      <Token>${auth.ticket.token}</Token>
      <Sign>${auth.ticket.sign}</Sign>
      <Cuit>${auth.cuit}</Cuit>
    </Auth>`;
  }

  private async call(environment: ArcaEnvironment, action: string, body: string): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;

    try {
      const { data } = await axios.post(ARCA_ENDPOINTS[environment].wsfe, envelope, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `http://ar.gov.afip.dif.FEV1/${action}`,
        },
        timeout: 30000,
        httpsAgent: arcaHttpsAgent,
      });
      return String(data);
    } catch (err: any) {
      const detalle = err.response?.data ? String(err.response.data) : err.message;
      const fault = this.pick(detalle, 'faultstring');
      this.logger.error(`${action} falló: ${fault || detalle}`);
      throw new InternalServerErrorException(`No se pudo contactar a ARCA (${action}): ${fault || err.message}`);
    }
  }

  /** Los <Err> son problemas del pedido (token vencido, CUIT sin permisos, datos mal). */
  private throwOnErrors(xml: string) {
    const bloque = this.pick(xml, 'Errors');
    if (!bloque) return;
    const mensajes = [...bloque.matchAll(/<Msg>([\s\S]*?)<\/Msg>/gi)].map((m) => m[1].trim());
    const codigos = [...bloque.matchAll(/<Code>([\s\S]*?)<\/Code>/gi)].map((m) => m[1].trim());
    const detalle = mensajes.map((m, i) => `[${codigos[i] || '?'}] ${m}`).join(' | ');
    throw new BadRequestException(`ARCA devolvió un error: ${detalle}`);
  }

  /** Las <Obs> no impiden el CAE, pero hay que guardarlas y mostrarlas. */
  private observaciones(xml: string): string[] {
    const bloque = this.pick(xml, 'Observaciones');
    if (!bloque) return [];
    const mensajes = [...bloque.matchAll(/<Msg>([\s\S]*?)<\/Msg>/gi)].map((m) => m[1].trim());
    const codigos = [...bloque.matchAll(/<Code>([\s\S]*?)<\/Code>/gi)].map((m) => m[1].trim());
    return mensajes.map((m, i) => `[${codigos[i] || '?'}] ${m}`);
  }

  private pick(xml: string, tag: string): string | null {
    const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i'));
    return match ? match[1].trim() : null;
  }
}
