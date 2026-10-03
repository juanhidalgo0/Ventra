import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FiscalDocument } from '@prisma/client';
import { NotifyService } from '../subscription/notify.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { PrismaService } from '../../database/prisma.service';
import { nodeIndex, numberRange } from '../sync/numbering';
import { WsaaService } from './wsaa.service';
import { WsfeContext, WsfeService, RespuestaCae, CbteAsociado } from './wsfe.service';
import { ArcaTransport, DirectTransport, GatewayTransport } from './arca-transport';
import { ArcaError } from './arca-error';
import { ArcaEnvironment, IvaCondition } from './arca-endpoints';
import {
  buildImportes,
  ComprobanteError,
  ComprobanteTipo,
  cuitValida,
  decideCbteTipo,
  EmisorCondition,
  esFacturable,
  fechaArca,
  fechaArcaIso,
  Importes,
  IvaLine,
  notaCreditoDe,
  parseFechaArca,
  qrUrl,
  Receptor,
  ReceptorInput,
  resolveReceptor,
  round2,
  tipoDesdeCodigo,
} from './comprobante';

type DocKind = 'FACTURA' | 'NOTA_CREDITO';

/** Cada cuánto la cola de esta caja mira si hay comprobantes para emitir. */
const TICK_MS = 20_000;
/** Lo que espera el cajero al facturar: si ARCA tarda más, sigue en segundo plano. */
const INTERACTIVE_WAIT_MS = 20_000;
/** Esperas entre reintentos cuando ARCA o internet fallan. */
const BACKOFF_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000];
/** Con algo para corregir del comercio (delegación, punto de venta) se reintenta despacio. */
const CONFIG_RETRY_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];
/** La factura automática revisa las ventas de los últimos días por si alguna quedó sin comprobante. */
const AUTO_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const ALICUOTAS = [2.5, 5, 10.5, 21, 27];
/** La alícuota con la que se declara un producto: la suya, o la general del comercio. */
const lineRate = (propia: any, general: any) => (ALICUOTAS.includes(Number(propia)) ? Number(propia) : ALICUOTAS.includes(Number(general)) ? Number(general) : 21);
const SALE_ITEMS = { items: { include: { product: { select: { taxRate: true } } } } } as const;

interface Plan {
  tipo: ComprobanteTipo;
  importes: Importes;
  receptor: Receptor;
  environment: ArcaEnvironment;
  cuit: string;
  pointOfSale: number;
  cbtesAsoc?: CbteAsociado[];
}

/**
 * Facturación electrónica: decide el comprobante, pide el CAE y lo guarda.
 *
 * Reglas:
 * - La venta nunca se frena por ARCA. Si no hay internet o ARCA no responde, el comprobante
 *   queda en cola (PENDING) y esta misma caja lo emite cuando puede.
 * - Cada comprobante lo emite solo la caja que lo pidió (ownerNode), de a uno por vez.
 * - Un pedido de CAE que salió y no volvió (corte de internet a mitad de camino) deja anotado
 *   el número usado. Antes de pedir otro se le pregunta a ARCA por ese: si se emitió, se
 *   recupera. Con la pasarela de Ventra, además, el mismo comprobante nunca se emite dos veces.
 * - Anular una venta facturada emite su nota de crédito sola.
 */
@Injectable()
export class FiscalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Facturación');
  private chain: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private gatewayInfo: { at: number; data: any } | null = null;

  constructor(
    private prisma: PrismaService,
    private wsaa: WsaaService,
    private wsfe: WsfeService,
    private notify: NotifyService,
    private subscription: SubscriptionService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
    setTimeout(() => {
      this.migrateLegacy().catch((err) => this.logger.warn(`No se pudieron pasar los comprobantes viejos: ${err.message}`));
      this.tick();
    }, 8000).unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
  }

  /** De a un comprobante por vez en esta caja: dos pedidos seguidos pedirían el mismo número. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ─── Configuración ────────────────────────────────────────────────

  private async loadConfig() {
    const config = await this.prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    return config || this.prisma.fiscalConfig.create({ data: { id: 'fiscal_config' } });
  }

  async getConfig() {
    return this.publicConfig(await this.loadConfig());
  }

  /** La clave privada nunca sale del servidor, ni siquiera hacia la pantalla de configuración. */
  private async publicConfig(config: any) {
    const { keyPem, certPem, ...rest } = config;
    const info = await this.ventraInfo();
    const env = info?.environments?.[config.environment];
    const direct = this.wsaa.getDelegatedCredentials();
    return {
      ...rest,
      hasOwnCertificate: Boolean(certPem && keyPem),
      // Con qué se firma en esta caja y la CUIT que el comercio tiene que autorizar en ARCA
      transport: config.certSource === 'OWN' ? 'own' : direct ? 'direct' : 'gateway',
      ventraCuit: direct ? this.wsaa.getDelegatedCuit() : env?.cuit || null,
      ventraAvailable: direct ? true : env ? Boolean(env.available) : null,
      linked: Boolean(this.subscription.getDeviceCredentials()),
      node: await nodeIndex(this.prisma),
      // Compatibilidad con pantallas anteriores
      delegatedAvailable: direct ? true : Boolean(env?.available),
      delegatedCuit: direct ? this.wsaa.getDelegatedCuit() : env?.cuit || null,
    };
  }

  /**
   * Datos de la pasarela de Ventra (qué entornos están habilitados y con qué CUIT).
   * El POS lee la configuración en cada cobro: esto nunca lo hace esperar más de un momento.
   */
  private async ventraInfo(maxWaitMs = 2500): Promise<any | null> {
    const fresh = this.gatewayInfo && Date.now() - this.gatewayInfo.at < (this.gatewayInfo.data ? 10 * 60_000 : 60_000);
    if (fresh) return this.gatewayInfo!.data;
    if (!this.subscription.getDeviceCredentials()) return null;
    if (!this.infoRequest) {
      this.infoRequest = new GatewayTransport(() => this.subscription.getDeviceCredentials())
        .info()
        .then((data) => { this.gatewayInfo = { at: Date.now(), data }; })
        .catch(() => { this.gatewayInfo = { at: Date.now(), data: this.gatewayInfo?.data || null }; })
        .finally(() => { this.infoRequest = null; });
    }
    await Promise.race([this.infoRequest, new Promise((r) => setTimeout(r, maxWaitMs))]);
    return this.gatewayInfo?.data || null;
  }
  private infoRequest: Promise<void> | null = null;

  async updateConfig(data: any) {
    const current = await this.loadConfig();
    const update: any = {};
    const text = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);

    if (data.enabled !== undefined) update.enabled = Boolean(data.enabled);
    if (data.cuit !== undefined) {
      const cuit = String(data.cuit || '').replace(/\D/g, '');
      if (cuit && !cuitValida(cuit)) throw new BadRequestException('La CUIT no es válida: revisá los 11 números (el último es el dígito verificador).');
      update.cuit = cuit;
    }
    if (data.razonSocial !== undefined) update.razonSocial = text(data.razonSocial);
    if (data.domicilio !== undefined) update.domicilio = text(data.domicilio);
    if (data.iibb !== undefined) update.iibb = text(data.iibb, 60);
    if (data.ivaCondition !== undefined) {
      if (!['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO'].includes(data.ivaCondition)) throw new BadRequestException('Condición frente al IVA inválida');
      update.ivaCondition = data.ivaCondition;
    }
    if (data.pointOfSale !== undefined) {
      const pv = Number(data.pointOfSale);
      if (!Number.isInteger(pv) || pv < 1 || pv > 99998) throw new BadRequestException('El punto de venta es un número entre 1 y 99998');
      update.pointOfSale = pv;
    }
    if (data.environment !== undefined) {
      if (!['HOMOLOGACION', 'PRODUCCION'].includes(data.environment)) throw new BadRequestException('Entorno inválido');
      update.environment = data.environment;
    }
    if (data.defaultIvaRate !== undefined) {
      const rate = Number(data.defaultIvaRate);
      if (!ALICUOTAS.includes(rate)) throw new BadRequestException('Alícuota de IVA inválida');
      update.defaultIvaRate = rate;
    }
    if (data.inicioActividades !== undefined) {
      const d = data.inicioActividades ? new Date(data.inicioActividades) : null;
      if (d && isNaN(d.getTime())) throw new BadRequestException('Fecha de inicio de actividades inválida');
      update.inicioActividades = d;
    }
    if (data.startDate !== undefined) update.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.autoInvoice !== undefined) {
      update.autoInvoice = Boolean(data.autoInvoice);
      // Prenderla no factura las ventas de antes: rige desde ahora
      if (update.autoInvoice && !current.autoInvoice) update.autoInvoiceSince = new Date();
    }
    if (data.certSource !== undefined) {
      if (!['DELEGATED', 'OWN'].includes(data.certSource)) throw new BadRequestException('Origen del certificado inválido');
      update.certSource = data.certSource;
    }
    if (data.certPem !== undefined || data.keyPem !== undefined) {
      const certPem = String(data.certPem || '').trim();
      const keyPem = String(data.keyPem || '').trim();
      if (certPem || keyPem) {
        try {
          const desc = this.wsaa.describeCertificate(certPem);
          this.wsaa.signTra('<prueba/>', { certPem, keyPem });
          update.certExpiresAt = desc.expiresAt;
        } catch {
          throw new BadRequestException('El certificado o la clave no son válidos, o no se corresponden entre sí');
        }
      }
      update.certPem = certPem || null;
      update.keyPem = keyPem || null;
    }

    const next = { ...current, ...update };
    if (next.enabled) {
      const faltan: string[] = [];
      if (!cuitValida(next.cuit)) faltan.push('la CUIT');
      if (!next.razonSocial) faltan.push('la razón social');
      // El comprobante impreso los tiene que llevar: en producción no se factura sin ellos
      if (next.environment === 'PRODUCCION') {
        if (!next.domicilio) faltan.push('el domicilio comercial');
        if (!next.inicioActividades) faltan.push('la fecha de inicio de actividades');
      }
      if (faltan.length) throw new BadRequestException(`Para activar la facturación falta cargar ${faltan.join(', ')}.`);
    }

    const saved = await this.prisma.fiscalConfig.update({ where: { id: 'fiscal_config' }, data: update });
    if (saved.enabled) this.kick();
    return this.publicConfig(saved);
  }

  /** Con qué se habla con ARCA desde esta caja. */
  private transportFor(config: any): ArcaTransport {
    if (config.certSource === 'OWN') {
      if (!config.certPem || !config.keyPem) throw new ArcaError('CONFIG', 'Falta cargar el certificado del comercio', 'NO_CERT');
      const desc = this.wsaa.describeCertificate(config.certPem);
      return new DirectTransport(this.wsaa, { certPem: config.certPem, keyPem: config.keyPem }, desc.cuit || config.cuit);
    }
    // Desarrollo o servidor propio con el certificado de Ventra en sus variables de entorno
    const direct = this.wsaa.getDelegatedCredentials();
    const directCuit = this.wsaa.getDelegatedCuit();
    if (direct && directCuit) return new DirectTransport(this.wsaa, direct, directCuit);
    return new GatewayTransport(() => this.subscription.getDeviceCredentials());
  }

  // ─── Prueba de conexión ───────────────────────────────────────────

  /**
   * Revisa todo lo que hace falta para facturar, sin emitir nada, y dice qué corregir.
   */
  async testConnection() {
    const config = await this.loadConfig();
    const environment = config.environment as ArcaEnvironment;
    const checks: { key: string; label: string; ok: boolean; level: 'ok' | 'warn' | 'error'; detail: string }[] = [];
    const add = (key: string, label: string, level: 'ok' | 'warn' | 'error', detail: string) => checks.push({ key, label, ok: level !== 'error', level, detail });
    let ultimoComprobante: number | null = null;

    // 1. Datos del comercio
    const faltan: string[] = [];
    if (!config.razonSocial) faltan.push('razón social');
    if (!config.domicilio) faltan.push('domicilio comercial');
    if (!config.inicioActividades) faltan.push('inicio de actividades');
    if (!config.iibb) faltan.push('ingresos brutos');
    if (!cuitValida(config.cuit)) add('datos', 'Datos del comercio', 'error', 'Falta cargar una CUIT válida.');
    else if (faltan.length) add('datos', 'Datos del comercio', 'warn', `Faltan datos que van impresos en el comprobante: ${faltan.join(', ')}.`);
    else add('datos', 'Datos del comercio', 'ok', `CUIT ${config.cuit} · ${config.razonSocial}`);

    // 2. Conexión con Ventra / certificado
    let transport: ArcaTransport | null = null;
    try {
      transport = this.transportFor(config);
      if (transport.kind === 'gateway') {
        const info = await (transport as GatewayTransport).info();
        this.gatewayInfo = { at: Date.now(), data: info };
        const env = info?.environments?.[environment];
        if (!env?.available) {
          add('ventra', 'Servidor de facturación de Ventra', 'error', environment === 'PRODUCCION'
            ? 'La facturación en producción de Ventra todavía no está habilitada.'
            : 'El entorno de pruebas no está disponible.');
          transport = null;
        } else {
          add('ventra', 'Servidor de facturación de Ventra', 'ok', `Conectado. Ventra factura con la CUIT ${env.cuit}.`);
        }
      } else {
        add('ventra', 'Certificado', 'ok', config.certSource === 'OWN' ? 'Certificado propio del comercio.' : 'Certificado de Ventra en este servidor.');
      }
    } catch (err: any) {
      add('ventra', 'Servidor de facturación de Ventra', 'error', this.friendly(err, config));
      transport = null;
    }

    if (transport && cuitValida(config.cuit)) {
      const ctx: WsfeContext = { transport, environment, cuit: config.cuit };
      // 3. ARCA responde
      try {
        const d = await this.wsfe.dummy(ctx);
        const ok = d.appServer === 'OK' && d.dbServer === 'OK' && d.authServer === 'OK';
        add('arca', 'Servicio de ARCA', ok ? 'ok' : 'warn', ok ? 'ARCA responde normalmente.' : `ARCA responde con problemas (app ${d.appServer}, base ${d.dbServer}, auth ${d.authServer}).`);
      } catch (err: any) {
        add('arca', 'Servicio de ARCA', 'error', this.friendly(err, config));
      }
      // 4. Delegación: si ARCA deja consultar con la CUIT del comercio, la autorización está
      try {
        const tipo = decideCbteTipo(config.ivaCondition as EmisorCondition, 'CONSUMIDOR_FINAL');
        ultimoComprobante = await this.wsfe.ultimoAutorizado(ctx, config.pointOfSale, tipo.cbteTipo);
        add('delegacion', 'Autorización en ARCA', 'ok', `ARCA acepta facturar con la CUIT ${config.cuit}. Último comprobante en el punto de venta ${config.pointOfSale}: ${ultimoComprobante}.`);
      } catch (err: any) {
        add('delegacion', 'Autorización en ARCA', 'error', this.friendly(err, config));
      }
      // 5. Punto de venta para web services (en homologación no existen y no hacen falta)
      if (environment === 'PRODUCCION') {
        try {
          const puntos = await this.wsfe.puntosVenta(ctx);
          const pv = puntos.find((p) => p.numero === config.pointOfSale);
          const disponibles = puntos.filter((p) => !p.bloqueado && !p.baja).map((p) => p.numero);
          if (!puntos.length) {
            add('puntoVenta', 'Punto de venta', 'error', 'La CUIT no tiene puntos de venta para web services. Creá uno en ARCA → "Administración de puntos de venta y domicilios" con el sistema "Factura Electrónica - Monotributo - Web Services" o "RECE para aplicativo y web services".');
          } else if (!pv) {
            add('puntoVenta', 'Punto de venta', 'error', `El punto de venta ${config.pointOfSale} no está habilitado para web services. Los habilitados son: ${disponibles.join(', ') || 'ninguno'}.`);
          } else if (pv.bloqueado || pv.baja) {
            add('puntoVenta', 'Punto de venta', 'error', `El punto de venta ${config.pointOfSale} está ${pv.baja ? 'dado de baja' : 'bloqueado'} en ARCA.`);
          } else {
            add('puntoVenta', 'Punto de venta', 'ok', `Punto de venta ${config.pointOfSale} habilitado para web services.`);
          }
        } catch (err: any) {
          add('puntoVenta', 'Punto de venta', 'warn', `No se pudo revisar el punto de venta: ${this.friendly(err, config)}`);
        }
      } else {
        add('puntoVenta', 'Punto de venta', 'ok', 'En pruebas cualquier número sirve.');
      }
    }

    const ok = checks.every((c) => c.ok);
    await this.prisma.fiscalConfig.update({ where: { id: 'fiscal_config' }, data: { lastError: ok ? null : checks.filter((c) => !c.ok).map((c) => c.detail).join(' · ').slice(0, 500) } }).catch(() => {});
    if (ok) this.kick();
    return { ok, environment, checks, ultimoComprobante, puntoVenta: config.pointOfSale };
  }

  /** Un error de ARCA explicado para el comerciante, con lo que tiene que hacer. */
  private friendly(err: any, config: any): string {
    if (err instanceof ArcaError && err.code === 'DELEGATION') {
      const ventra = this.gatewayInfo?.data?.environments?.[config?.environment]?.cuit || this.wsaa.getDelegatedCuit();
      return `ARCA todavía no tiene la autorización de la CUIT ${config?.cuit || ''} a Ventra. Entrá a ARCA con tu clave fiscal → "Administrador de Relaciones de Clave Fiscal" → "Nueva relación" → servicio "Facturación electrónica" (ARCA → Web Services) → representante: CUIT ${ventra || 'de Ventra'}. Si ya lo hiciste, Ventra tiene que aceptarla de su lado (suele quedar lista en el día): mientras tanto las facturas quedan en cola y salen solas.`;
    }
    if (err instanceof ArcaError || err instanceof ComprobanteError) return err.message;
    return err?.response?.message || err?.message || 'Error desconocido';
  }

  // ─── Pedidos del mostrador ────────────────────────────────────────

  /**
   * Factura una venta ya cobrada. Si ARCA tarda, devuelve el comprobante en cola y lo
   * termina de emitir en segundo plano: el cajero nunca queda esperando.
   */
  async invoiceSale(saleId: string, receptorInput?: ReceptorInput, userId?: string) {
    const docId = await this.exclusive(async () => {
      const config = await this.loadConfig();
      if (!config.enabled) throw new BadRequestException('La facturación electrónica no está activada');
      if (!cuitValida(config.cuit)) throw new BadRequestException('Falta cargar la CUIT del comercio');

      const sale = await this.saleForInvoice(saleId);
      if (sale.status === 'CANCELLED') throw new BadRequestException('No se puede facturar una venta anulada');

      const docs = await this.prisma.fiscalDocument.findMany({ where: { saleId, kind: 'FACTURA' }, orderBy: { createdAt: 'asc' } });
      const credited = await this.creditedIds(docs.map((d) => d.id));
      const activa = docs.find((d) => (d.status === 'AUTHORIZED' && !credited.has(d.id)) || d.status === 'PENDING');
      const node = await nodeIndex(this.prisma);

      if (activa?.status === 'AUTHORIZED') {
        throw new ConflictException(`La venta ya tiene la ${this.docLabel(activa)} autorizada`);
      }
      if (activa && activa.ownerNode !== node) {
        throw new ConflictException(`Esta venta ya se está facturando desde la caja #${activa.ownerNode}. Si esa caja no va a volver, tomá el comprobante desde Facturación.`);
      }

      const receptor = resolveReceptor({
        cuit: receptorInput?.cuit ?? sale.client?.cuit,
        dni: receptorInput?.dni ?? sale.client?.dni,
        name: receptorInput?.name ?? sale.client?.name,
        ivaCondition: receptorInput?.ivaCondition ?? sale.client?.ivaCondition,
      });
      // Se valida antes de crear nada: el cajero corrige en el momento
      try {
        this.planFactura(sale, receptor, config);
      } catch (err: any) {
        if (err instanceof ComprobanteError) throw new BadRequestException(err.message);
        throw err;
      }

      // En cola en esta caja: si el pedido anterior quedó sin respuesta, se resuelve ese primero
      if (activa) {
        if (activa.reservedNumber == null) await this.prisma.fiscalDocument.update({ where: { id: activa.id }, data: { ...this.receptorData(receptor), nextAttemptAt: null } });
        else await this.prisma.fiscalDocument.update({ where: { id: activa.id }, data: { nextAttemptAt: null } });
        return activa.id;
      }
      const rechazada = docs.find((d) => d.status === 'REJECTED');
      if (rechazada) {
        await this.prisma.fiscalDocument.update({
          where: { id: rechazada.id },
          data: { ...this.receptorData(receptor), status: 'PENDING', ownerNode: node, error: null, errorKind: null, nextAttemptAt: null },
        });
        return rechazada.id;
      }
      const id = `${saleId}:F${docs.length + 1}`;
      await this.prisma.fiscalDocument.create({
        data: { id, saleId, kind: 'FACTURA', ...this.baseDoc(config, node), ...this.receptorData(receptor), createdById: userId || null },
      });
      return id;
    });

    return this.emitInteractive(docId);
  }

  /** Nota de crédito que anula una factura (devolución total o factura con datos mal). */
  async creditNote(facturaId: string, reason?: string, userId?: string) {
    const docId = await this.exclusive(async () => {
      const factura = await this.prisma.fiscalDocument.findUnique({ where: { id: facturaId } });
      if (!factura || factura.kind !== 'FACTURA') throw new NotFoundException('Factura no encontrada');
      if (factura.status !== 'AUTHORIZED') throw new BadRequestException('Solo se anula con nota de crédito una factura autorizada');
      const id = await this.ensureCreditNote(factura, reason || 'Anulación de la factura', userId);
      if (!id) throw new ConflictException('Esta factura ya tiene una nota de crédito');
      return id;
    });
    return this.emitInteractive(docId);
  }

  /** Vuelve a intentar un comprobante en cola o rechazado (con datos del cliente corregidos, si vienen). */
  async retryDocument(id: string, receptorInput?: ReceptorInput) {
    await this.exclusive(async () => {
      const doc = await this.prisma.fiscalDocument.findUnique({ where: { id } });
      if (!doc) throw new NotFoundException('Comprobante no encontrado');
      if (!['PENDING', 'REJECTED'].includes(doc.status)) throw new BadRequestException('Ese comprobante no está pendiente');
      const node = await nodeIndex(this.prisma);
      if (doc.ownerNode !== node) {
        throw new ConflictException(`Este comprobante lo emite la caja #${doc.ownerNode}. Si esa caja no va a volver, tomalo con "Emitir desde esta caja".`);
      }
      const data: any = { status: 'PENDING', nextAttemptAt: null, error: null, errorKind: null };
      const hasReceptor = receptorInput && (receptorInput.cuit || receptorInput.dni || receptorInput.ivaCondition || receptorInput.name);
      if (doc.kind === 'FACTURA' && hasReceptor && doc.reservedNumber == null) {
        Object.assign(data, this.receptorData(resolveReceptor(receptorInput)));
      }
      await this.prisma.fiscalDocument.update({ where: { id }, data });
    });
    return this.emitInteractive(id);
  }

  /**
   * Pasa a esta caja un comprobante en cola de otra que no va a volver (se rompió, se
   * reinstaló). Antes de pedir un número nuevo se revisa en ARCA el que esa caja haya usado.
   */
  async takeOver(id: string) {
    await this.exclusive(async () => {
      const doc = await this.prisma.fiscalDocument.findUnique({ where: { id } });
      if (!doc) throw new NotFoundException('Comprobante no encontrado');
      if (!['PENDING', 'REJECTED'].includes(doc.status)) throw new BadRequestException('Ese comprobante no está pendiente');
      const node = await nodeIndex(this.prisma);
      await this.prisma.fiscalDocument.update({
        where: { id },
        data: { ownerNode: node, status: 'PENDING', nextAttemptAt: null, observations: this.addObs(doc.observations, `Tomado por la caja #${node} (antes #${doc.ownerNode})`) },
      });
    });
    return this.emitInteractive(id);
  }

  private async emitInteractive(id: string) {
    const done = this.exclusive(() => this.emit(id));
    await Promise.race([done.catch(() => undefined), new Promise((r) => setTimeout(r, INTERACTIVE_WAIT_MS))]);
    return this.documentViewById(id);
  }

  // ─── Ganchos de las ventas ────────────────────────────────────────

  /** Después de cada venta: con factura automática, la venta entra a la cola. Nunca tira error. */
  async onSaleCreated(saleId: string) {
    try {
      const config = await this.loadConfig();
      if (!config.enabled || !config.autoInvoice) return;
      await this.exclusive(() => this.createAutoDoc(saleId, config));
      this.kick();
    } catch (err: any) {
      this.logger.warn(`No se pudo encolar la factura de la venta ${saleId}: ${err.message}`);
    }
  }

  /**
   * Venta anulada: si tenía factura, se emite la nota de crédito; si la factura todavía no
   * había salido, ya no hace falta. Nunca tira error: la anulación ya está hecha.
   */
  async onSaleCancelled(saleId: string, userId?: string) {
    try {
      await this.exclusive(async () => {
        const node = await nodeIndex(this.prisma);
        const docs = await this.prisma.fiscalDocument.findMany({ where: { saleId, kind: 'FACTURA' } });
        for (const doc of docs) {
          if (doc.status === 'AUTHORIZED') {
            await this.ensureCreditNote(doc, 'Anulación de la venta', userId);
          } else if (doc.status === 'PENDING' && doc.ownerNode === node && doc.reservedNumber == null) {
            await this.prisma.fiscalDocument.update({ where: { id: doc.id }, data: { status: 'VOID', error: 'La venta se anuló antes de emitir la factura', errorKind: null, nextAttemptAt: null } });
          } else if (doc.status === 'REJECTED') {
            await this.prisma.fiscalDocument.update({ where: { id: doc.id }, data: { status: 'VOID', nextAttemptAt: null } });
          }
          // En cola con un pedido sin respuesta: la cola lo resuelve y, si salió, emite la NC
        }
      });
      this.kick();
    } catch (err: any) {
      this.logger.warn(`No se pudo preparar la nota de crédito de la venta ${saleId}: ${err.message}`);
    }
  }

  // ─── Cola ─────────────────────────────────────────────────────────

  /** Despierta la cola enseguida (después de una venta, una anulación o un cambio de configuración). */
  kick() {
    if (this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      this.tick();
    }, 300);
    this.kickTimer.unref?.();
  }

  /** Procesa la cola ahora (botón "Reintentar"). */
  async processQueue() {
    const node = await nodeIndex(this.prisma);
    await this.prisma.fiscalDocument.updateMany({ where: { status: 'PENDING', ownerNode: node }, data: { nextAttemptAt: null } });
    await this.tick(true);
    const pendientes = await this.prisma.fiscalDocument.count({ where: { status: 'PENDING', ownerNode: node } });
    return { pending: pendientes };
  }

  private async tick(wait = false): Promise<void> {
    if (this.ticking) {
      if (!wait) return;
      for (let i = 0; this.ticking && i < 120; i++) await new Promise((r) => setTimeout(r, 500));
      if (this.ticking) return;
    }
    this.ticking = true;
    try {
      const config = await this.prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
      if (!config?.enabled) return;
      const node = await nodeIndex(this.prisma);

      await this.sweepAuto(config, node);
      await this.sweepCancelled(node);

      const due = await this.prisma.fiscalDocument.findMany({
        where: { status: 'PENDING', ownerNode: node, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
        orderBy: { createdAt: 'asc' },
        take: 15,
        select: { id: true },
      });
      for (const { id } of due) await this.exclusive(() => this.emit(id));
    } catch (err: any) {
      this.logger.warn(`Cola de comprobantes: ${err.message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Red de seguridad de la factura automática: ventas de esta caja que quedaron sin comprobante. */
  private async sweepAuto(config: any, node: number) {
    if (!config.autoInvoice || !config.autoInvoiceSince) return;
    const desde = new Date(Math.max(new Date(config.autoInvoiceSince).getTime(), Date.now() - AUTO_LOOKBACK_MS, config.startDate ? new Date(config.startDate).getTime() : 0));
    const range = await numberRange(this.prisma);
    const sales = await this.prisma.sale.findMany({
      where: {
        saleNumber: { gte: range.from, lt: range.to },
        status: 'COMPLETED',
        total: { gt: 0 },
        createdAt: { gte: desde },
        fiscalDocuments: { none: {} },
        items: { some: { productId: { notIn: ['PAGO_CTA_CTE', 'VIRTUAL_LOAD_1', 'VIRTUAL_LOAD_2'] } } },
      },
      select: { id: true },
      take: 20,
    });
    for (const { id } of sales) await this.exclusive(() => this.createAutoDoc(id, config));
  }

  /** Facturas autorizadas de ventas anuladas (en esta u otra caja) que todavía no tienen su nota de crédito. */
  private async sweepCancelled(node: number) {
    const facturas = await this.prisma.fiscalDocument.findMany({
      where: { kind: 'FACTURA', status: 'AUTHORIZED', ownerNode: node, sale: { status: 'CANCELLED' } },
      take: 50,
    });
    if (!facturas.length) return;
    const conNota = await this.prisma.fiscalDocument.findMany({
      where: { kind: 'NOTA_CREDITO', assocDocumentId: { in: facturas.map((f) => f.id) } },
      select: { assocDocumentId: true },
    });
    const ya = new Set(conNota.map((n) => n.assocDocumentId));
    for (const f of facturas.filter((x) => !ya.has(x.id)).slice(0, 20)) {
      await this.exclusive(() => this.ensureCreditNote(f, 'Anulación de la venta'));
    }
  }

  private async createAutoDoc(saleId: string, config: any) {
    const exists = await this.prisma.fiscalDocument.count({ where: { saleId, kind: 'FACTURA' } });
    if (exists) return;
    const sale = await this.saleForInvoice(saleId).catch(() => null);
    if (!sale || sale.status !== 'COMPLETED') return;
    if (config.startDate && sale.createdAt < new Date(config.startDate)) return;
    const facturables = sale.items.filter((i) => esFacturable(i.productId));
    const node = await nodeIndex(this.prisma);
    if (!facturables.length || facturables.reduce((a, i) => a + i.total, 0) <= 0) {
      // Queda anotado para que la red de seguridad no la vuelva a evaluar en cada vuelta
      await this.prisma.fiscalDocument.create({
        data: {
          id: `${saleId}:F1`, saleId, kind: 'FACTURA', ...this.baseDoc(config, node), status: 'VOID',
          error: 'Sin productos para facturar (pagos de cuenta corriente, cargas virtuales o devoluciones)',
        },
      });
      return;
    }

    const receptor = resolveReceptor({ cuit: sale.client?.cuit, dni: sale.client?.dni, name: sale.client?.name, ivaCondition: sale.client?.ivaCondition });
    const data: any = { id: `${saleId}:F1`, saleId, kind: 'FACTURA', ...this.baseDoc(config, node), ...this.receptorData(receptor) };
    // Un dato que impide emitir (factura A sin CUIT, alícuota en negativo) queda a la vista para corregirlo
    try {
      this.planFactura(sale, receptor, config);
    } catch (err: any) {
      if (!(err instanceof ComprobanteError)) throw err;
      Object.assign(data, { status: 'REJECTED', error: err.message, errorKind: 'REJECTED' });
      this.notify.enqueue('invoiceFail', { saleId, saleNumber: sale.saleNumber, total: sale.total, error: err.message });
    }
    await this.prisma.fiscalDocument.create({ data });
  }

  /** Crea la nota de crédito de una factura si todavía no tiene. Devuelve su id, o null si ya existía. */
  private async ensureCreditNote(factura: FiscalDocument, reason: string, userId?: string): Promise<string | null> {
    const id = `${factura.id}:NC`;
    const existing = await this.prisma.fiscalDocument.findUnique({ where: { id } });
    const node = await nodeIndex(this.prisma);
    if (existing) {
      if (existing.status !== 'REJECTED' && existing.status !== 'VOID') return null;
      await this.prisma.fiscalDocument.update({ where: { id }, data: { status: 'PENDING', ownerNode: node, error: null, errorKind: null, nextAttemptAt: null, reason } });
      return id;
    }
    await this.prisma.fiscalDocument.create({
      data: {
        id,
        saleId: factura.saleId,
        kind: 'NOTA_CREDITO',
        status: 'PENDING',
        // La nota de crédito va con la misma CUIT, entorno y punto de venta que su factura
        environment: factura.environment,
        emisorCuit: factura.emisorCuit,
        pointOfSale: factura.pointOfSale,
        total: factura.total,
        neto: factura.neto,
        iva: factura.iva,
        ivaDetail: factura.ivaDetail,
        receptorDocTipo: factura.receptorDocTipo,
        receptorDocNro: factura.receptorDocNro,
        receptorName: factura.receptorName,
        receptorIvaCondition: factura.receptorIvaCondition,
        assocDocumentId: factura.id,
        reason,
        ownerNode: node,
        createdById: userId || null,
      },
    });
    return id;
  }

  // ─── Emisión ──────────────────────────────────────────────────────

  /**
   * Emite un comprobante en cola. Siempre se llama dentro de `exclusive`.
   * Nunca tira error: el resultado queda en el comprobante.
   */
  private async emit(id: string): Promise<void> {
    const doc = await this.prisma.fiscalDocument.findUnique({ where: { id } });
    if (!doc || doc.status !== 'PENDING') return;
    const node = await nodeIndex(this.prisma);
    if (doc.ownerNode !== node) return;

    const config = await this.loadConfig();
    if (!config.enabled) {
      await this.prisma.fiscalDocument.update({ where: { id }, data: { error: 'La facturación electrónica está desactivada', errorKind: 'CONFIG', nextAttemptAt: new Date(Date.now() + 15 * 60_000) } });
      return;
    }

    const sale = await this.saleForInvoice(doc.saleId).catch(() => null);
    if (!sale) {
      await this.prisma.fiscalDocument.update({ where: { id }, data: { status: 'VOID', error: 'La venta ya no existe', nextAttemptAt: null } });
      return;
    }
    if (doc.kind === 'FACTURA' && sale.status === 'CANCELLED' && doc.reservedNumber == null) {
      await this.prisma.fiscalDocument.update({ where: { id }, data: { status: 'VOID', error: 'La venta se anuló antes de emitir la factura', errorKind: null, nextAttemptAt: null } });
      return;
    }

    await this.prisma.fiscalDocument.update({ where: { id }, data: { attempts: { increment: 1 }, lastAttemptAt: new Date() } });

    try {
      const transport = this.transportFor(config);

      // 1. Un pedido anterior quedó sin respuesta: ¿ARCA lo emitió?
      if (doc.reservedNumber != null && doc.cbteTipo) {
        const ctx: WsfeContext = { transport, environment: doc.environment as ArcaEnvironment, cuit: doc.emisorCuit };
        const found = await this.wsfe.consultar(ctx, doc.cbteTipo, doc.pointOfSale, doc.reservedNumber);
        if (found && (await this.isOurs(doc, found))) {
          await this.markAuthorized(doc, {
            cae: found.cae, caeVencimiento: found.caeVencimiento, numero: found.numero, fecha: found.fecha,
            observaciones: ['Recuperado: ARCA lo había emitido en un intento que quedó sin respuesta'], replayed: false,
          });
          return;
        }
        await this.prisma.fiscalDocument.update({ where: { id }, data: { reservedNumber: null } });
        doc.reservedNumber = null;
      }

      // 2. Qué se emite, con la configuración de ahora
      const plan = await this.buildPlan(doc, sale, config);
      await this.prisma.fiscalDocument.update({
        where: { id },
        data: {
          environment: plan.environment,
          emisorCuit: plan.cuit,
          pointOfSale: plan.pointOfSale,
          cbteTipo: plan.tipo.cbteTipo,
          invoiceType: plan.tipo.invoiceType,
          total: plan.importes.ImpTotal,
          neto: plan.importes.ImpNeto,
          iva: plan.importes.ImpIVA,
          ivaDetail: plan.importes.Iva ? JSON.stringify(plan.importes.Iva) : null,
          ...this.receptorData(plan.receptor),
        },
      });
      const ctx: WsfeContext = { transport, environment: plan.environment, cuit: plan.cuit };

      // 3. Número y CAE. Si otra caja emitió en el medio, se pide el siguiente
      for (let intento = 0; intento < 3; intento++) {
        const numero = (await this.wsfe.ultimoAutorizado(ctx, plan.pointOfSale, plan.tipo.cbteTipo)) + 1;
        const fecha = fechaArca(new Date());
        // Se anota ANTES de salir: si la respuesta no vuelve, se sabe por qué número preguntar
        await this.prisma.fiscalDocument.update({ where: { id }, data: { reservedNumber: numero, issueDate: fecha } });
        try {
          const resp = await this.wsfe.solicitarCae(ctx, {
            puntoVenta: plan.pointOfSale,
            cbteTipo: plan.tipo.cbteTipo,
            numero,
            fecha,
            docTipo: plan.receptor.docTipo,
            docNro: plan.receptor.docNro,
            condicionIvaReceptorId: plan.receptor.condicionIvaId,
            importes: plan.importes,
            cbtesAsoc: plan.cbtesAsoc,
          }, { docId: doc.id, saleId: doc.saleId, kind: doc.kind });
          await this.markAuthorized({ ...doc, ...this.receptorData(plan.receptor), cbteTipo: plan.tipo.cbteTipo, pointOfSale: plan.pointOfSale, environment: plan.environment, emisorCuit: plan.cuit } as FiscalDocument, resp);
          return;
        } catch (err) {
          // Solo un pedido que quizás llegó a ARCA conserva el número reservado
          if (!(err instanceof ArcaError && err.kind === 'AMBIGUOUS')) {
            await this.prisma.fiscalDocument.update({ where: { id }, data: { reservedNumber: null } });
          }
          if (err instanceof ArcaError && err.kind === 'NUMBERING') continue;
          throw err;
        }
      }
      throw new ArcaError('TRANSIENT', 'Otra caja está emitiendo con el mismo punto de venta: se reintenta enseguida', 'NUMBERING');
    } catch (err: any) {
      await this.handleFailure(doc, sale, err, config);
    }
  }

  private async handleFailure(doc: FiscalDocument, sale: any, err: any, config: any) {
    const attempts = doc.attempts + 1;
    const message = this.friendly(err, config);
    const label = `${doc.kind === 'NOTA_CREDITO' ? 'NC' : 'Factura'} de la venta #${sale?.saleNumber ?? '?'}`;

    if (err instanceof ComprobanteError || (err instanceof ArcaError && err.kind === 'REJECTED')) {
      await this.prisma.fiscalDocument.update({ where: { id: doc.id }, data: { status: 'REJECTED', error: message, errorKind: 'REJECTED', nextAttemptAt: null } });
      this.logger.warn(`${label} rechazada: ${message}`);
      this.notify.enqueue('invoiceFail', { saleId: doc.saleId, saleNumber: sale?.saleNumber, total: doc.total || sale?.total, error: message });
      return;
    }

    if (err instanceof ArcaError && err.kind === 'CONFIG') {
      const yaTrabadas = await this.prisma.fiscalDocument.count({ where: { status: 'PENDING', errorKind: 'CONFIG', id: { not: doc.id } } });
      const wait = CONFIG_RETRY_MS[Math.min(attempts - 1, CONFIG_RETRY_MS.length - 1)];
      await this.prisma.fiscalDocument.update({ where: { id: doc.id }, data: { error: message, errorKind: 'CONFIG', nextAttemptAt: new Date(Date.now() + wait) } });
      this.logger.warn(`${label} en espera: ${message}`);
      // Se avisa la primera vez que la cola se traba por algo del comercio, no por cada venta
      if (!yaTrabadas && doc.errorKind !== 'CONFIG') {
        this.notify.enqueue('invoiceFail', { saleId: doc.saleId, saleNumber: sale?.saleNumber, total: doc.total || sale?.total, error: message });
      }
      return;
    }

    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    const ambiguous = err instanceof ArcaError && err.kind === 'AMBIGUOUS';
    await this.prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: { error: ambiguous ? `${message} (se verifica en ARCA antes de reintentar)` : message, errorKind: 'TRANSIENT', nextAttemptAt: new Date(Date.now() + wait) },
    });
    if (!(err instanceof ArcaError)) this.logger.error(`${label}: error inesperado`, err?.stack || err);
    else this.logger.warn(`${label} sigue en cola: ${message}`);
  }

  private async markAuthorized(doc: FiscalDocument, resp: RespuestaCae) {
    const data: any = {
      status: 'AUTHORIZED',
      number: resp.numero,
      cae: resp.cae,
      caeExpiresAt: parseFechaArca(resp.caeVencimiento),
      issueDate: resp.fecha,
      reservedNumber: null,
      error: null,
      errorKind: null,
      nextAttemptAt: null,
      observations: resp.observaciones.length ? this.addObs(doc.observations, resp.observaciones.join(' | ')) : doc.observations,
    };
    // La pasarela devolvió un comprobante ya emitido (otro intento u otra caja): se toman los
    // datos que tiene ARCA, que son los que valen
    if (resp.replayed && doc.cbteTipo) {
      try {
        const config = await this.loadConfig();
        const found = await this.wsfe.consultar({ transport: this.transportFor(config), environment: doc.environment as ArcaEnvironment, cuit: doc.emisorCuit }, doc.cbteTipo, doc.pointOfSale, resp.numero);
        if (found) {
          data.total = found.impTotal;
          data.receptorDocTipo = found.docTipo;
          data.receptorDocNro = found.docNro;
          data.issueDate = found.fecha || resp.fecha;
        }
      } catch { /* se queda con lo que tiene */ }
      data.observations = this.addObs(data.observations, 'Ya estaba emitido: se recuperó de la pasarela de Ventra');
    }
    const saved = await this.prisma.fiscalDocument.update({ where: { id: doc.id }, data });
    this.logger.log(`CAE ${saved.cae} · ${this.docLabel(saved)} (venta ${saved.saleId})`);

    // La venta se anuló mientras la factura estaba en camino: corresponde la nota de crédito
    if (saved.kind === 'FACTURA') {
      const sale = await this.prisma.sale.findUnique({ where: { id: saved.saleId }, select: { status: true } });
      if (sale?.status === 'CANCELLED') {
        await this.ensureCreditNote(saved, 'Anulación de la venta');
        this.kick();
      }
    }
  }

  /** ¿El comprobante que ARCA tiene con el número reservado es este? */
  private async isOurs(doc: FiscalDocument, found: { impTotal: number; docTipo: number; docNro: string; fecha: string; numero: number; resultado: string | null }) {
    if (found.resultado && found.resultado !== 'A') return false;
    if (Math.abs(found.impTotal - doc.total) > 0.01) return false;
    if (found.docTipo !== doc.receptorDocTipo) return false;
    if (String(Number(found.docNro) || 0) !== String(Number(doc.receptorDocNro) || 0)) return false;
    if (doc.issueDate && found.fecha && found.fecha !== doc.issueDate) return false;
    // Si otro comprobante de esta base ya tiene ese número, no es este
    const otro = await this.prisma.fiscalDocument.findFirst({
      where: { id: { not: doc.id }, status: 'AUTHORIZED', emisorCuit: doc.emisorCuit, pointOfSale: doc.pointOfSale, cbteTipo: doc.cbteTipo, number: found.numero },
      select: { id: true },
    });
    return !otro;
  }

  // ─── Qué se declara ───────────────────────────────────────────────

  private async saleForInvoice(saleId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: { select: { taxRate: true } } } }, client: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    return sale;
  }

  private planFactura(sale: any, receptor: Receptor, config: any): Plan {
    const tipo = decideCbteTipo(config.ivaCondition as EmisorCondition, receptor.ivaCondition as IvaCondition);
    if (tipo.requiresCuit && receptor.docTipo !== 80) throw new ComprobanteError('Para una factura A hace falta la CUIT del cliente');
    if (receptor.docTipo === 80 && !cuitValida(receptor.docNro)) throw new ComprobanteError(`La CUIT del cliente (${receptor.docNro}) no es válida`);
    const items = sale.items.filter((i: any) => esFacturable(i.productId)).map((i: any) => ({ total: i.total, taxRate: i.product?.taxRate ?? 0 }));
    if (!items.length) throw new ComprobanteError('La venta no tiene productos para facturar (los pagos de cuenta corriente y las cargas virtuales no se facturan)');
    const importes = buildImportes(items, sale.discountAmount, tipo, config.defaultIvaRate);
    return { tipo, importes, receptor, environment: config.environment as ArcaEnvironment, cuit: config.cuit, pointOfSale: config.pointOfSale };
  }

  private async buildPlan(doc: FiscalDocument, sale: any, config: any): Promise<Plan> {
    const receptor = this.receptorFromDoc(doc);
    if (doc.kind === 'FACTURA') return this.planFactura(sale, receptor, config);

    // Nota de crédito: copia exacta de su factura, con la misma CUIT, entorno y punto de venta
    const factura = doc.assocDocumentId ? await this.prisma.fiscalDocument.findUnique({ where: { id: doc.assocDocumentId } }) : null;
    if (!factura || factura.status !== 'AUTHORIZED' || !factura.cbteTipo || !factura.number || !factura.issueDate) {
      throw new ComprobanteError('La factura que anula esta nota de crédito no está autorizada');
    }
    const tipo = notaCreditoDe(tipoDesdeCodigo(factura.cbteTipo));
    const iva: IvaLine[] | undefined = factura.ivaDetail ? JSON.parse(factura.ivaDetail) : undefined;
    return {
      tipo,
      receptor: this.receptorFromDoc(factura),
      importes: {
        ImpTotal: round2(factura.total), ImpNeto: round2(factura.neto), ImpIVA: round2(factura.iva),
        ImpTotConc: 0, ImpOpEx: 0, ImpTrib: 0, ...(tipo.discriminatesIva && iva?.length ? { Iva: iva } : {}),
      },
      environment: factura.environment as ArcaEnvironment,
      cuit: factura.emisorCuit,
      pointOfSale: factura.pointOfSale,
      cbtesAsoc: [{ tipo: factura.cbteTipo, ptoVta: factura.pointOfSale, nro: factura.number, cuit: factura.emisorCuit, fecha: factura.issueDate }],
    };
  }

  private receptorFromDoc(doc: FiscalDocument): Receptor {
    return resolveReceptor({
      cuit: doc.receptorDocTipo === 80 ? doc.receptorDocNro : null,
      dni: doc.receptorDocTipo === 96 ? doc.receptorDocNro : null,
      name: doc.receptorName,
      ivaCondition: doc.receptorIvaCondition,
    });
  }

  private receptorData(r: Receptor) {
    return { receptorDocTipo: r.docTipo, receptorDocNro: r.docNro, receptorName: r.name || null, receptorIvaCondition: r.ivaCondition };
  }

  private baseDoc(config: any, node: number) {
    return { status: 'PENDING', environment: config.environment, emisorCuit: config.cuit, pointOfSale: config.pointOfSale, ownerNode: node };
  }

  private async creditedIds(facturaIds: string[]): Promise<Set<string>> {
    if (!facturaIds.length) return new Set();
    const notas = await this.prisma.fiscalDocument.findMany({
      where: { kind: 'NOTA_CREDITO', status: 'AUTHORIZED', assocDocumentId: { in: facturaIds } },
      select: { assocDocumentId: true },
    });
    return new Set(notas.map((n) => n.assocDocumentId!));
  }

  private addObs(prev: string | null, text: string) {
    return [prev, text].filter(Boolean).join(' · ').slice(-1000);
  }

  private docLabel(doc: { invoiceType?: string | null; pointOfSale: number; number?: number | null }) {
    const tipo = (doc.invoiceType || 'FACTURA').replace('FACTURA_', 'Factura ').replace('NC_', 'Nota de crédito ');
    return doc.number ? `${tipo} ${String(doc.pointOfSale).padStart(5, '0')}-${String(doc.number).padStart(8, '0')}` : tipo;
  }

  // ─── Consultas ────────────────────────────────────────────────────

  /** Comprobantes de una venta, para el POS y la reimpresión. */
  async getSaleFiscal(saleId: string) {
    const config = await this.loadConfig();
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId }, include: SALE_ITEMS });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    const docs = await this.prisma.fiscalDocument.findMany({ where: { saleId }, orderBy: { createdAt: 'asc' } });
    const node = await nodeIndex(this.prisma);
    const views = docs.map((d) => this.documentView(d, config, sale, docs, node));
    const facturas = views.filter((v) => v.kind === 'FACTURA' && v.status !== 'VOID');
    // La vigente es la última sin nota de crédito autorizada (si se anuló y refacturó, la nueva)
    const invoice = [...facturas].reverse().find((v) => v.creditedBy?.status !== 'AUTHORIZED') || facturas[facturas.length - 1] || null;
    return { invoice, documents: views };
  }

  async documentViewById(id: string) {
    const doc = await this.prisma.fiscalDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Comprobante no encontrado');
    const [config, sale, related, node] = await Promise.all([
      this.loadConfig(),
      this.prisma.sale.findUnique({ where: { id: doc.saleId }, include: SALE_ITEMS }),
      this.prisma.fiscalDocument.findMany({ where: { saleId: doc.saleId } }),
      nodeIndex(this.prisma),
    ]);
    return this.documentView(doc, config, sale, related, node);
  }

  /** Todo lo que hace falta para mostrar o imprimir un comprobante. */
  private documentView(doc: FiscalDocument, config: any, sale: any, related: FiscalDocument[], node: number) {
    const assoc = doc.assocDocumentId ? related.find((d) => d.id === doc.assocDocumentId) : null;
    const nota = related.find((d) => d.kind === 'NOTA_CREDITO' && d.assocDocumentId === doc.id && d.status !== 'VOID');
    const items = (sale?.items || []) as any[];
    const ivaDetail: IvaLine[] = doc.ivaDetail ? JSON.parse(doc.ivaDetail) : [];
    const authorized = doc.status === 'AUTHORIZED' && doc.cae && doc.number && doc.cbteTipo && doc.issueDate;
    return {
      id: doc.id,
      saleId: doc.saleId,
      saleNumber: sale?.saleNumber ?? null,
      saleTotal: sale?.total ?? null,
      saleCreatedAt: sale?.createdAt ?? null,
      kind: doc.kind as DocKind,
      status: doc.status,
      type: doc.invoiceType,
      letter: doc.invoiceType ? doc.invoiceType.slice(-1) : null,
      cbteTipo: doc.cbteTipo,
      pointOfSale: doc.pointOfSale,
      number: doc.number,
      cae: doc.cae,
      caeExpiresAt: doc.caeExpiresAt,
      issueDate: fechaArcaIso(doc.issueDate),
      // Compatibilidad: la pantalla de venta usa `date`
      date: fechaArcaIso(doc.issueDate),
      total: doc.total,
      neto: doc.neto,
      iva: doc.iva,
      ivaDetail: ivaDetail.map((l) => ({ rate: l.rate, base: l.BaseImp, amount: l.Importe })),
      // Lo que va en el comprobante y lo que no (pagos de cuenta corriente, cargas virtuales)
      // `rate`: alícuota con la que se declaró la línea (la factura A muestra los precios sin IVA)
      lines: items.filter((i) => esFacturable(i.productId)).map((i) => ({
        name: i.productName, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total,
        rate: doc.cbteTipo && tipoDesdeCodigo(doc.cbteTipo).discriminatesIva ? lineRate(i.product?.taxRate, config.defaultIvaRate) : null,
      })),
      excludedLines: items.filter((i) => !esFacturable(i.productId)).map((i) => ({ name: i.productName, quantity: i.quantity, total: i.total })),
      environment: doc.environment,
      emisor: {
        cuit: doc.emisorCuit,
        razonSocial: config.razonSocial,
        domicilio: config.domicilio,
        iibb: config.iibb,
        inicioActividades: config.inicioActividades,
        // La condición sale de la letra del comprobante: una B reimpresa después de pasar a
        // monotributo tiene que seguir diciendo Responsable Inscripto
        ivaCondition: doc.cbteTipo ? (tipoDesdeCodigo(doc.cbteTipo).discriminatesIva ? 'RESPONSABLE_INSCRIPTO' : 'MONOTRIBUTO') : config.ivaCondition,
        pointOfSale: doc.pointOfSale,
        environment: doc.environment,
      },
      receptor: {
        docTipo: doc.receptorDocTipo,
        docNro: doc.receptorDocNro,
        name: doc.receptorName,
        ivaCondition: doc.receptorIvaCondition,
      },
      assoc: assoc ? { id: assoc.id, type: assoc.invoiceType, pointOfSale: assoc.pointOfSale, number: assoc.number, issueDate: fechaArcaIso(assoc.issueDate) } : null,
      creditedBy: nota ? { id: nota.id, status: nota.status, number: nota.number, pointOfSale: nota.pointOfSale, type: nota.invoiceType } : null,
      reason: doc.reason,
      error: doc.error,
      errorKind: doc.errorKind,
      attempts: doc.attempts,
      nextAttemptAt: doc.nextAttemptAt,
      ownerNode: doc.ownerNode,
      mine: doc.ownerNode === node,
      verifying: doc.reservedNumber != null,
      observations: doc.observations,
      createdAt: doc.createdAt,
      qrUrl: authorized
        ? qrUrl({
            issueDate: doc.issueDate!, cuit: doc.emisorCuit, pointOfSale: doc.pointOfSale, cbteTipo: doc.cbteTipo!, number: doc.number!,
            total: doc.total, docTipo: doc.receptorDocTipo, docNro: doc.receptorDocNro, cae: doc.cae!,
          })
        : null,
    };
  }

  /** Comprobantes para la pantalla de facturación, con el resumen de la cola. */
  async listDocuments(params: { status?: string; kind?: string; from?: string; to?: string; search?: string; limit?: number }) {
    const where: any = {};
    if (params.status === 'CONFIG') Object.assign(where, { status: 'PENDING', errorKind: 'CONFIG' });
    else if (params.status && params.status !== 'ALL') where.status = params.status;
    if (params.kind && params.kind !== 'ALL') where.kind = params.kind;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }
    const q = (params.search || '').trim();
    if (q) {
      const n = Number(q.replace(/\D/g, ''));
      where.OR = [
        { receptorName: { contains: q } },
        { receptorDocNro: { contains: q.replace(/\D/g, '') || q } },
        { cae: { contains: q } },
        ...(n ? [{ number: n }, { sale: { saleNumber: n } }] : []),
      ];
    }

    const [docs, grouped, config, node] = await Promise.all([
      this.prisma.fiscalDocument.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(params.limit || 100, 500) }),
      this.prisma.fiscalDocument.groupBy({ by: ['status'], _count: { _all: true } }),
      this.loadConfig(),
      nodeIndex(this.prisma),
    ]);
    const saleIds = [...new Set(docs.map((d) => d.saleId))];
    const [sales, related] = await Promise.all([
      this.prisma.sale.findMany({ where: { id: { in: saleIds } }, include: { items: true } }),
      this.prisma.fiscalDocument.findMany({ where: { saleId: { in: saleIds } } }),
    ]);
    const saleById = new Map(sales.map((s) => [s.id, s]));

    const summary: Record<string, number> = { PENDING: 0, AUTHORIZED: 0, REJECTED: 0, VOID: 0 };
    for (const g of grouped) summary[g.status] = g._count._all;
    summary.CONFIG = await this.prisma.fiscalDocument.count({ where: { status: 'PENDING', errorKind: 'CONFIG' } });
    summary.PENDING_MINE = await this.prisma.fiscalDocument.count({ where: { status: 'PENDING', ownerNode: node } });

    return {
      documents: docs.map((d) => {
        const v = this.documentView(d, config, saleById.get(d.saleId), related, node);
        // La lista no necesita el detalle de ítems
        const { lines: _l, excludedLines: _e, ...rest } = v;
        return rest;
      }),
      summary,
    };
  }

  /** Ventas cobradas sin factura vigente (para facturar a mano desde la pantalla). */
  async listUninvoiced(params: { from?: string; to?: string; limit?: number }) {
    const where: any = { status: 'COMPLETED', total: { gt: 0 } };
    where.createdAt = { gte: params.from ? new Date(params.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
    if (params.to) where.createdAt.lte = new Date(params.to);
    const sales = await this.prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.limit || 100, 300),
      select: {
        id: true, saleNumber: true, createdAt: true, total: true,
        client: { select: { name: true, cuit: true, dni: true, ivaCondition: true } },
        fiscalDocuments: { select: { id: true, kind: true, status: true, assocDocumentId: true } },
      },
    });
    return sales
      .filter((s) => {
        const notas = new Set(s.fiscalDocuments.filter((d) => d.kind === 'NOTA_CREDITO' && d.status === 'AUTHORIZED').map((d) => d.assocDocumentId));
        return !s.fiscalDocuments.some((d) => d.kind === 'FACTURA' && (d.status === 'PENDING' || (d.status === 'AUTHORIZED' && !notas.has(d.id))));
      })
      .map(({ fiscalDocuments: _f, ...s }) => s);
  }

  /** Libro de comprobantes para el contador: CSV con lo autorizado en el período. */
  async exportCsv(params: { from?: string; to?: string }) {
    const where: any = { status: 'AUTHORIZED' };
    if (params.from || params.to) {
      where.issueDate = {};
      if (params.from) where.issueDate.gte = params.from.replace(/-/g, '').slice(0, 8);
      if (params.to) where.issueDate.lte = params.to.replace(/-/g, '').slice(0, 8);
    }
    const docs = await this.prisma.fiscalDocument.findMany({ where, orderBy: [{ issueDate: 'asc' }, { cbteTipo: 'asc' }, { number: 'asc' }] });
    const sales = await this.prisma.sale.findMany({ where: { id: { in: [...new Set(docs.map((d) => d.saleId))] } }, select: { id: true, saleNumber: true } });
    const saleNumber = new Map(sales.map((s) => [s.id, s.saleNumber]));
    const docName: Record<number, string> = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: 'Consumidor final' };
    const num = (n: number, sign = 1) => (sign * n).toFixed(2).replace('.', ',');
    const cell = (v: any) => {
      const s = String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ['Fecha', 'Tipo', 'Código', 'Punto de venta', 'Número', 'CAE', 'Vto. CAE', 'Tipo doc.', 'Documento', 'Receptor', 'Neto', 'IVA', 'Total', 'Entorno', 'Venta'];
    const rows = docs.map((d) => {
      // Las notas de crédito restan
      const sign = d.kind === 'NOTA_CREDITO' ? -1 : 1;
      return [
        fechaArcaIso(d.issueDate)?.split('-').reverse().join('/') || '',
        (d.invoiceType || '').replace('FACTURA_', 'Factura ').replace('NC_', 'Nota de crédito '),
        String(d.cbteTipo ?? '').padStart(3, '0'),
        String(d.pointOfSale).padStart(5, '0'),
        String(d.number ?? '').padStart(8, '0'),
        d.cae || '',
        d.caeExpiresAt ? d.caeExpiresAt.toISOString().slice(0, 10).split('-').reverse().join('/') : '',
        docName[d.receptorDocTipo] || d.receptorDocTipo,
        d.receptorDocNro === '0' ? '' : d.receptorDocNro,
        d.receptorName || '',
        num(d.neto, sign),
        num(d.iva, sign),
        num(d.total, sign),
        d.environment === 'PRODUCCION' ? 'Producción' : 'Prueba',
        saleNumber.get(d.saleId) ?? '',
      ].map(cell).join(';');
    });
    // BOM para que Excel lo abra con acentos
    return '﻿' + [header.join(';'), ...rows].join('\r\n');
  }

  // ─── Lo emitido antes de la 1.0.43 ────────────────────────────────

  /**
   * Las facturas que se emitieron cuando los datos vivían en la venta pasan a la tabla de
   * comprobantes. El id es determinístico: todas las cajas generan la misma fila.
   */
  private async migrateLegacy() {
    const legacy = await this.prisma.sale.findMany({
      where: { invoiceStatus: 'AUTHORIZED', cae: { not: null }, fiscalDocuments: { none: {} } },
      take: 500,
    });
    if (!legacy.length) return;
    const config = await this.loadConfig();
    for (const s of legacy) {
      const tipo = s.invoiceCbteTipo ? tipoDesdeCodigo(s.invoiceCbteTipo) : null;
      await this.prisma.fiscalDocument.create({
        data: {
          id: `${s.id}:F1`,
          saleId: s.id,
          kind: 'FACTURA',
          status: 'AUTHORIZED',
          environment: config.environment,
          emisorCuit: config.cuit,
          cbteTipo: s.invoiceCbteTipo,
          invoiceType: tipo?.invoiceType || s.invoiceType,
          pointOfSale: s.invoicePointOfSale || config.pointOfSale,
          number: s.invoiceNumber,
          cae: s.cae,
          caeExpiresAt: s.caeExpiresAt,
          issueDate: fechaArca(s.invoiceDate || s.createdAt),
          total: s.total,
          neto: s.invoiceNeto ?? s.total,
          iva: s.invoiceIva ?? 0,
          receptorDocTipo: s.receptorDocTipo ?? 99,
          receptorDocNro: s.receptorDocNro ?? '0',
          receptorName: s.receptorName,
          receptorIvaCondition: s.receptorIvaCondition || 'CONSUMIDOR_FINAL',
          ownerNode: 0,
          observations: 'Emitida con una versión anterior de Ventra',
        },
      }).catch(() => { /* otra caja ya la creó */ });
    }
    this.logger.log(`${legacy.length} comprobantes anteriores pasados a la tabla de comprobantes`);
  }
}
