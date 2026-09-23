import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import * as forge from 'node-forge';
import * as fs from 'fs';
import { PrismaService } from '../../database/prisma.service';
import { ARCA_ENDPOINTS, ArcaEnvironment } from './arca-endpoints';
import { arcaHttpsAgent } from './arca-http';

export interface AccessTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

export interface Credentials {
  certPem: string;
  keyPem: string;
}

/**
 * WSAA: autenticación con ARCA.
 *
 * El circuito es: se arma un pedido (TRA) en XML, se lo firma con el certificado en
 * formato CMS/PKCS#7, se lo manda en base64 a LoginCms y ARCA devuelve un ticket de
 * acceso (token + sign) que vale 12 horas.
 *
 * El ticket se guarda en la base y se reusa: pedir uno nuevo mientras el anterior sigue
 * vigente hace que ARCA conteste "El CEE ya posee un TA valido para el acceso al WSN
 * solicitado" y rechace el pedido. Es el error más común al integrar.
 */
@Injectable()
export class WsaaService {
  private readonly logger = new Logger(WsaaService.name);
  /** Margen antes del vencimiento real: mejor renovar de más que quedarse sin ticket a mitad de una venta */
  private readonly RENEW_MARGIN_MS = 10 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  /**
   * Certificado con el que se firma. Con delegación es uno solo de Ventra, guardado
   * como secreto del servidor: nunca viaja en el instalador que se entrega al comercio,
   * porque cualquiera podría sacarlo del disco y facturar en nombre de otro.
   */
  getDelegatedCredentials(): Credentials | null {
    // En Fly el certificado entra como secreto (el PEM completo); en desarrollo es más
    // cómodo apuntar a un archivo fuera del repo, así la clave nunca toca el proyecto.
    const certPem = process.env.ARCA_CERT_PEM || this.readFileOrNull(process.env.ARCA_CERT_PATH);
    const keyPem = process.env.ARCA_KEY_PEM || this.readFileOrNull(process.env.ARCA_KEY_PATH);
    if (!certPem || !keyPem) return null;
    return { certPem: certPem.replace(/\\n/g, '\n'), keyPem: keyPem.replace(/\\n/g, '\n') };
  }

  private readFileOrNull(path?: string): string | null {
    if (!path) return null;
    try {
      return fs.readFileSync(path, 'utf8');
    } catch (err: any) {
      this.logger.error(`No se pudo leer el certificado de ARCA en ${path}: ${err.message}`);
      return null;
    }
  }

  /** CUIT del titular del certificado (Ventra cuando hay delegación). */
  getDelegatedCuit(): string | null {
    return process.env.ARCA_CUIT || null;
  }

  /**
   * Devuelve un ticket válido: reusa el guardado si todavía sirve y pide uno nuevo si no.
   * `cuit` es el del titular del certificado, no el del comercio que factura.
   */
  async getAccessTicket(
    cuit: string,
    environment: ArcaEnvironment,
    credentials: Credentials,
    service = 'wsfe',
  ): Promise<AccessTicket> {
    const cached = await this.prisma.fiscalToken.findUnique({
      where: { cuit_service_environment: { cuit, service, environment } },
    });

    if (cached && cached.expiresAt.getTime() - Date.now() > this.RENEW_MARGIN_MS) {
      return { token: cached.token, sign: cached.sign, expiresAt: cached.expiresAt };
    }

    const ticket = await this.requestTicket(environment, credentials, service);

    await this.prisma.fiscalToken.upsert({
      where: { cuit_service_environment: { cuit, service, environment } },
      create: { cuit, service, environment, token: ticket.token, sign: ticket.sign, expiresAt: ticket.expiresAt },
      update: { token: ticket.token, sign: ticket.sign, expiresAt: ticket.expiresAt },
    });

    return ticket;
  }

  /** El TRA es el pedido de acceso: dice a qué servicio se quiere entrar y por cuánto tiempo. */
  buildTra(service: string, now = new Date()): string {
    // El reloj del servidor puede estar corrido respecto al de ARCA: se abre la ventana
    // diez minutos para atrás y dos horas para adelante.
    const from = new Date(now.getTime() - 10 * 60 * 1000);
    const to = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    // uniqueId tiene que crecer entre pedidos; los segundos de la época alcanzan
    const uniqueId = Math.floor(now.getTime() / 1000);

    return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${from.toISOString()}</generationTime>
    <expirationTime>${to.toISOString()}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
  }

  /** Firma el TRA en CMS/PKCS#7 y lo devuelve en base64, que es lo que espera LoginCms. */
  signTra(tra: string, credentials: Credentials): string {
    try {
      const cert = forge.pki.certificateFromPem(credentials.certPem);
      const privateKey = forge.pki.privateKeyFromPem(credentials.keyPem);

      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(tra, 'utf8');
      p7.addCertificate(cert);
      p7.addSigner({
        key: privateKey,
        certificate: cert,
        digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
          { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
          { type: forge.pki.oids.messageDigest },
          { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
        ],
      });
      p7.sign({ detached: false });

      const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
      return forge.util.encode64(der);
    } catch (err: any) {
      this.logger.error(`No se pudo firmar el TRA: ${err.message}`);
      throw new InternalServerErrorException('El certificado de ARCA no es válido o está mal cargado');
    }
  }

  private async requestTicket(
    environment: ArcaEnvironment,
    credentials: Credentials,
    service: string,
  ): Promise<AccessTicket> {
    const tra = this.buildTra(service);
    const cms = this.signTra(tra, credentials);

    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

    let body: string;
    try {
      const { data } = await axios.post(ARCA_ENDPOINTS[environment].wsaa, envelope, {
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
        timeout: 30000,
        httpsAgent: arcaHttpsAgent,
      });
      body = String(data);
    } catch (err: any) {
      const detalle = err.response?.data ? String(err.response.data) : err.message;
      const fault = this.extractFault(detalle);
      // ARCA no entrega un ticket nuevo mientras el anterior siga vivo, y tampoco deja
      // recuperarlo. Pasa si se perdió la caché (base restaurada, otra instancia). No hay
      // nada que hacer más que esperar: la venta queda en la cola y se reintenta sola.
      if (fault && /ya posee un TA valido/i.test(fault)) {
        throw new InternalServerErrorException(
          'Ya hay un ticket de acceso de ARCA vigente emitido por otra instancia. Los comprobantes quedan en cola y se emiten en cuanto venza (hasta 12 horas).',
        );
      }
      throw new InternalServerErrorException(`ARCA rechazó la autenticación: ${fault || detalle}`);
    }

    // La respuesta trae el XML del ticket escapado adentro del sobre SOAP
    const inner = this.unescapeXml(this.pick(body, 'loginCmsReturn') || '');
    const token = this.pick(inner, 'token');
    const sign = this.pick(inner, 'sign');
    const expiration = this.pick(inner, 'expirationTime');

    if (!token || !sign) {
      const fault = this.extractFault(body);
      throw new InternalServerErrorException(`ARCA no devolvió el ticket de acceso: ${fault || 'respuesta inesperada'}`);
    }

    const expiresAt = expiration ? new Date(expiration) : new Date(Date.now() + 11 * 60 * 60 * 1000);
    this.logger.log(`Ticket de acceso de ${service} obtenido, vence ${expiresAt.toISOString()}`);
    return { token, sign, expiresAt };
  }

  private pick(xml: string, tag: string): string | null {
    const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i'));
    return match ? match[1].trim() : null;
  }

  private extractFault(xml: string): string | null {
    return this.pick(xml, 'faultstring');
  }

  private unescapeXml(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
}
