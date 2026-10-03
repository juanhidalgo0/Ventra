import axios from 'axios';
import { ARCA_ENDPOINTS, ArcaEnvironment } from './arca-endpoints';
import { arcaHttpsAgent } from './arca-http';
import { Credentials, WsaaService } from './wsaa.service';
import { ArcaError, ArcaErrorKind } from './arca-error';

export interface CallOptions {
  environment: ArcaEnvironment;
  /** CUIT del comercio que factura (va en Auth.Cuit) */
  cuit: string;
  /** Identifica el comprobante: la pasarela no emite dos veces el mismo */
  ref?: { docId: string; saleId: string; kind: string };
}

export interface ArcaTransport {
  readonly kind: 'gateway' | 'direct';
  /**
   * Manda un método de WSFEv1. `body` es el elemento del método con un marcador <Auth/>
   * donde va la autenticación: la completa quien tiene el certificado.
   */
  call(method: string, body: string, opts: CallOptions): Promise<{ xml: string; replayed?: boolean }>;
}

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';
/** Se puede apuntar a otra pasarela (pruebas) sin tocar la sincronización. */
export const FISCAL_URL = process.env.VENTRA_FISCAL_URL || `${FUNCTIONS_URL}/ventraFiscal`;

/** Errores de la pasarela que pasan ANTES de mandarle nada a ARCA: nunca dejan un CAE en el aire. */
const GATEWAY_PRESEND: Record<string, ArcaErrorKind> = {
  NOT_LINKED: 'CONFIG',
  NO_ACCOUNT: 'CONFIG',
  UNPAID: 'CONFIG',
  PLAN_NO_CAJA: 'CONFIG',
  SUBSCRIPTION_EXPIRED: 'CONFIG',
  CUIT_TAKEN: 'CONFIG',
  // La CUIT espera que Ventra confirme que es de este comercio (ver functions/fiscal.js)
  CUIT_PENDING: 'CONFIG',
  CUIT_MISMATCH: 'CONFIG',
  BAD_CUIT: 'CONFIG',
  ENV_UNAVAILABLE: 'CONFIG',
  TA_COOLDOWN: 'TRANSIENT',
  TA_BUSY: 'TRANSIENT',
  IN_FLIGHT: 'TRANSIENT',
  WSAA_UNREACHABLE: 'TRANSIENT',
  WSAA_ERROR: 'TRANSIENT',
  BAD_BODY: 'REJECTED',
  BAD_METHOD: 'REJECTED',
  BAD_ENV: 'REJECTED',
  BAD_ACTION: 'REJECTED',
  NO_REF: 'REJECTED',
};

/**
 * Por la pasarela de Ventra: el certificado vive en la nube y esta caja manda el pedido con
 * su vinculación. Es el camino normal (delegación).
 */
export class GatewayTransport implements ArcaTransport {
  readonly kind = 'gateway' as const;

  constructor(private device: () => { deviceId: string; deviceSecret: string } | null) {}

  private creds() {
    const creds = this.device();
    if (!creds) {
      throw new ArcaError('CONFIG', 'Esta PC no está vinculada a tu cuenta de Ventra: vinculala en Configuración → Suscripción y nube para facturar.', 'NOT_LINKED');
    }
    return creds;
  }

  /** Qué entornos tiene habilitados Ventra y con qué CUIT (la que el comercio tiene que autorizar). */
  async info(): Promise<{ environments: Record<string, { available: boolean; cuit: string | null }> }> {
    const { data } = await axios.post(FISCAL_URL, { ...this.creds(), action: 'info' }, { timeout: 15000 });
    return data;
  }

  async call(method: string, body: string, opts: CallOptions) {
    const creds = this.creds();
    const emission = method === 'FECAESolicitar';
    try {
      const { data } = await axios.post(
        FISCAL_URL,
        { ...creds, action: 'call', method, body, environment: opts.environment, cuit: opts.cuit, ref: opts.ref },
        { timeout: 60000 },
      );
      return { xml: String(data.xml || ''), replayed: Boolean(data.replayed) };
    } catch (err: any) {
      const res = err?.response;
      const code: string | null = res?.data?.code || null;
      const message: string = res?.data?.error || err?.message || 'Error de conexión';
      if (code && GATEWAY_PRESEND[code]) throw new ArcaError(GATEWAY_PRESEND[code], message, code);
      if (res?.status === 401) throw new ArcaError('CONFIG', 'Esta PC perdió la vinculación con Ventra: volvé a vincularla.', 'NOT_LINKED');
      // Sin respuesta, o ARCA no contestó a la pasarela: si era una emisión, quizás salió
      const kind: ArcaErrorKind = emission ? 'AMBIGUOUS' : 'TRANSIENT';
      throw new ArcaError(kind, res ? message : `No hay conexión con el servidor de facturación de Ventra (${message})`, code || 'NETWORK');
    }
  }
}

/** Errores de red que garantizan que el pedido no llegó a salir. */
const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

/**
 * Directo contra ARCA, firmando acá. Para el comercio que factura con su propio certificado,
 * o para un servidor que tiene el de Ventra en sus variables de entorno (desarrollo).
 */
export class DirectTransport implements ArcaTransport {
  readonly kind = 'direct' as const;

  constructor(private wsaa: WsaaService, private credentials: Credentials, private titularCuit: string) {}

  async call(method: string, body: string, opts: CallOptions) {
    const emission = method === 'FECAESolicitar';
    let ticket = await this.wsaa.getAccessTicket(this.titularCuit, opts.environment, this.credentials);
    const send = (t: { token: string; sign: string }) =>
      this.post(opts.environment, method, body.replace('<Auth/>', `<Auth><Token>${t.token}</Token><Sign>${t.sign}</Sign><Cuit>${opts.cuit}</Cuit></Auth>`), emission);

    let xml = await send(ticket);
    // Comercio que delegó después de pedido el ticket: uno nuevo ya lo incluye
    if (/<Code>\s*600\s*<\/Code>/i.test(xml) && /relaci/i.test(xml)) {
      const renewed = await this.wsaa
        .getAccessTicket(this.titularCuit, opts.environment, this.credentials, 'wsfe', { renewIfOlderThan: Date.now() - WsaaService.cooldownMs(opts.environment) })
        .catch(() => ticket);
      if (renewed.token !== ticket.token) {
        ticket = renewed;
        xml = await send(ticket);
      }
    }
    return { xml };
  }

  private async post(environment: ArcaEnvironment, method: string, body: string, emission: boolean): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
    try {
      const { data } = await axios.post(ARCA_ENDPOINTS[environment].wsfe, envelope, {
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://ar.gov.afip.dif.FEV1/${method}` },
        timeout: 30000,
        httpsAgent: arcaHttpsAgent,
        // Los SOAP Fault vienen con 500: se leen igual
        validateStatus: () => true,
      });
      const xml = String(data);
      const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
      if (fault) throw new ArcaError(emission ? 'AMBIGUOUS' : 'TRANSIENT', `ARCA respondió con un error: ${fault[1].trim()}`, 'ARCA_FAULT');
      if (!/<(?:\w+:)?Body/i.test(xml)) throw new ArcaError(emission ? 'AMBIGUOUS' : 'TRANSIENT', 'ARCA devolvió una respuesta ilegible', 'ARCA_FAULT');
      return xml;
    } catch (err: any) {
      if (err instanceof ArcaError) throw err;
      const kind: ArcaErrorKind = emission && !NOT_SENT.has(err?.code) ? 'AMBIGUOUS' : 'TRANSIENT';
      throw new ArcaError(kind, `No se pudo contactar a ARCA: ${err?.message || err}`, err?.code || 'NETWORK');
    }
  }
}
