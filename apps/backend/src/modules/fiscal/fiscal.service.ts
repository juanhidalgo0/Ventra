import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WsaaService, Credentials } from './wsaa.service';
import { WsfeService } from './wsfe.service';
import { ArcaEnvironment, IvaCondition } from './arca-endpoints';
import {
  buildImportes,
  decideCbteTipo,
  EmisorCondition,
  fechaArca,
  parseFechaArca,
  resolveReceptor,
} from './comprobante';

/**
 * Orquesta la facturación: decide el comprobante, pide el CAE y lo guarda en la venta.
 *
 * Regla de oro del mostrador: la venta nunca se frena por ARCA. Si el servicio no
 * responde, la venta queda con `invoiceStatus = PENDING` y se reintenta después;
 * el cliente se lleva su mercadería igual.
 */
@Injectable()
export class FiscalService {
  private readonly logger = new Logger(FiscalService.name);
  private readonly MAX_ATTEMPTS = 8;

  constructor(
    private prisma: PrismaService,
    private wsaa: WsaaService,
    private wsfe: WsfeService,
  ) {}

  async getConfig() {
    const config = await this.prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    if (config) return this.publicConfig(config);
    const created = await this.prisma.fiscalConfig.create({ data: { id: 'fiscal_config' } });
    return this.publicConfig(created);
  }

  /** La clave privada nunca sale del servidor, ni siquiera hacia la pantalla de configuración. */
  private publicConfig(config: any) {
    const { keyPem, certPem, ...rest } = config;
    return {
      ...rest,
      hasOwnCertificate: Boolean(certPem && keyPem),
      delegatedAvailable: Boolean(this.wsaa.getDelegatedCredentials()),
      delegatedCuit: this.wsaa.getDelegatedCuit(),
    };
  }

  async updateConfig(data: any) {
    const allowed = [
      'enabled', 'cuit', 'razonSocial', 'ivaCondition', 'pointOfSale',
      'environment', 'certSource', 'certPem', 'keyPem', 'autoInvoice', 'startDate',
    ];
    const update: any = {};
    for (const key of allowed) if (data[key] !== undefined) update[key] = data[key];
    if (update.cuit) update.cuit = String(update.cuit).replace(/\D/g, '');
    if (update.pointOfSale !== undefined) update.pointOfSale = Number(update.pointOfSale) || 1;

    const saved = await this.prisma.fiscalConfig.upsert({
      where: { id: 'fiscal_config' },
      create: { id: 'fiscal_config', ...update },
      update,
    });
    return this.publicConfig(saved);
  }

  /**
   * De dónde sale el certificado con el que se firma.
   * DELEGATED: el del servidor de Ventra, y el comercio sólo autorizó nuestra CUIT en ARCA.
   * OWN: el que cargó el comercio, que entonces factura con el suyo.
   */
  private async resolveCredentials(config: any): Promise<{ credentials: Credentials; titularCuit: string }> {
    if (config.certSource === 'OWN') {
      if (!config.certPem || !config.keyPem) {
        throw new BadRequestException('Falta cargar el certificado del comercio');
      }
      return { credentials: { certPem: config.certPem, keyPem: config.keyPem }, titularCuit: config.cuit };
    }

    const delegated = this.wsaa.getDelegatedCredentials();
    const delegatedCuit = this.wsaa.getDelegatedCuit();
    if (!delegated || !delegatedCuit) {
      // Pasa en la PC del local: el certificado vive sólo en el servidor de Ventra
      throw new BadRequestException(
        'Esta terminal no tiene el certificado de facturación. Los comprobantes se emiten desde el servidor de Ventra.',
      );
    }
    return { credentials: delegated, titularCuit: delegatedCuit };
  }

  /** Prueba de conexión sin emitir nada: responde el servicio y el certificado autentica. */
  async testConnection() {
    const config = await this.prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    if (!config) throw new BadRequestException('Falta configurar los datos fiscales');
    const environment = config.environment as ArcaEnvironment;

    const dummy = await this.wsfe.dummy(environment);
    const { credentials, titularCuit } = await this.resolveCredentials(config);
    const ticket = await this.wsaa.getAccessTicket(titularCuit, environment, credentials);
    const ultimo = await this.wsfe.ultimoAutorizado(
      { ticket, cuit: config.cuit, environment },
      config.pointOfSale,
      config.ivaCondition === 'MONOTRIBUTO' ? 11 : 6,
    );

    return {
      environment,
      servicios: dummy,
      ticketVence: ticket.expiresAt,
      ultimoComprobante: ultimo,
      puntoVenta: config.pointOfSale,
    };
  }

  /**
   * Emite el comprobante de una venta. Si ARCA no contesta, la venta queda en la cola
   * y se reintenta: nunca se le devuelve un error al cajero que ya cobró.
   */
  async invoiceSale(saleId: string, receptorInput?: { cuit?: string; dni?: string; name?: string; ivaCondition?: string }) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { product: { select: { taxRate: true } } } }, client: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.invoiceStatus === 'AUTHORIZED') {
      throw new BadRequestException(
        `La venta ya tiene el comprobante ${String(sale.invoicePointOfSale ?? 0).padStart(4, '0')}-${String(sale.invoiceNumber ?? 0).padStart(8, '0')} autorizado`,
      );
    }
    // Dos clicks seguidos pedirían el mismo número a ARCA y uno de los dos se rechazaría.
    // Si hay un pedido en curso de hace menos de un minuto, este espera.
    if (sale.invoiceStatus === 'PENDING' && sale.invoiceRequestedAt) {
      const segundos = (Date.now() - sale.invoiceRequestedAt.getTime()) / 1000;
      if (segundos < 60) {
        throw new BadRequestException('Ya hay un pedido de comprobante en curso para esta venta. Esperá unos segundos.');
      }
    }
    if (sale.status === 'CANCELLED') {
      throw new BadRequestException('No se puede facturar una venta cancelada');
    }

    const config = await this.prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    if (!config || !config.enabled) throw new BadRequestException('La facturación electrónica no está activada');
    if (!config.cuit) throw new BadRequestException('Falta cargar el CUIT del comercio');

    const receptor = resolveReceptor({
      cuit: receptorInput?.cuit ?? sale.client?.cuit,
      dni: receptorInput?.dni ?? sale.client?.dni,
      name: receptorInput?.name ?? sale.client?.name,
      ivaCondition: receptorInput?.ivaCondition ?? sale.client?.ivaCondition,
    });

    const tipo = decideCbteTipo(config.ivaCondition as EmisorCondition, receptor.ivaCondition as IvaCondition);
    if (tipo.requiresCuit && receptor.docTipo !== 80) {
      throw new BadRequestException('Para una factura A hace falta el CUIT del cliente');
    }

    const importes = buildImportes(
      sale.items.map((i) => ({ total: i.total, taxRate: i.product?.taxRate ?? 0 })),
      sale.discountAmount,
      tipo,
    );

    // Se marca el intento antes de salir a la red: si el proceso se corta, la venta
    // queda en la cola y no se pierde
    await this.prisma.sale.update({
      where: { id: saleId },
      data: {
        invoiceStatus: 'PENDING',
        invoiceType: tipo.invoiceType,
        invoiceCbteTipo: tipo.cbteTipo,
        invoicePointOfSale: config.pointOfSale,
        invoiceRequestedAt: new Date(),
        invoiceAttempts: { increment: 1 },
        receptorDocTipo: receptor.docTipo,
        receptorDocNro: receptor.docNro,
        receptorName: receptor.name,
        receptorIvaCondition: receptor.ivaCondition,
      },
    });

    const environment = config.environment as ArcaEnvironment;
    try {
      const { credentials, titularCuit } = await this.resolveCredentials(config);
      const ticket = await this.wsaa.getAccessTicket(titularCuit, environment, credentials);
      const auth = { ticket, cuit: config.cuit, environment };

      // La numeración la lleva ARCA: se pregunta el último y se sigue de ahí
      const ultimo = await this.wsfe.ultimoAutorizado(auth, config.pointOfSale, tipo.cbteTipo);
      const numero = ultimo + 1;

      const respuesta = await this.wsfe.solicitarCae(auth, {
        puntoVenta: config.pointOfSale,
        cbteTipo: tipo.cbteTipo,
        numero,
        fecha: fechaArca(new Date()),
        docTipo: receptor.docTipo,
        docNro: receptor.docNro,
        condicionIvaReceptorId: receptor.condicionIvaId,
        importes,
      });

      const updated = await this.prisma.sale.update({
        where: { id: saleId },
        data: {
          invoiceStatus: 'AUTHORIZED',
          invoiceNumber: numero,
          cae: respuesta.cae,
          caeExpiresAt: parseFechaArca(respuesta.caeVencimiento),
          invoiceDate: new Date(),
          invoiceNeto: importes.ImpNeto,
          invoiceIva: importes.ImpIVA,
          invoiceError: respuesta.observaciones.length ? respuesta.observaciones.join(' | ') : null,
        },
      });

      this.logger.log(`CAE ${respuesta.cae} para la venta ${sale.saleNumber} (${tipo.invoiceType} ${numero})`);
      return this.invoiceView(updated, config);
    } catch (err: any) {
      const mensaje = err?.response?.message || err.message || 'Error desconocido';
      // Un rechazo por datos no se reintenta solo: hay que corregir algo y volver a pedirlo
      const esRechazo = err?.status === 400;
      await this.prisma.sale.update({
        where: { id: saleId },
        data: { invoiceStatus: esRechazo ? 'REJECTED' : 'PENDING', invoiceError: mensaje },
      });
      throw err;
    }
  }

  /**
   * Cola de comprobantes: las ventas que quedaron pendientes porque no había internet
   * o ARCA no respondía. La corre el servidor que tiene el certificado.
   */
  async processPending(limit = 20) {
    const config = await this.prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    if (!config?.enabled) return { processed: 0, authorized: 0, failed: 0, skipped: 'no está activada' };

    const pendientes = await this.prisma.sale.findMany({
      where: { invoiceStatus: 'PENDING', invoiceAttempts: { lt: this.MAX_ATTEMPTS }, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    let authorized = 0;
    let failed = 0;
    for (const { id } of pendientes) {
      try {
        await this.invoiceSale(id);
        authorized++;
      } catch (err: any) {
        failed++;
        this.logger.warn(`La venta ${id} sigue sin CAE: ${err.message}`);
      }
    }
    return { processed: pendientes.length, authorized, failed };
  }

  /** Ventas y su estado fiscal, para la pantalla de facturación. */
  async listSales(params: { status?: string; limit?: number }) {
    const where: any = {};
    if (params.status && params.status !== 'ALL') where.invoiceStatus = params.status;

    const sales = await this.prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.limit || 50, 200),
      select: {
        id: true, saleNumber: true, createdAt: true, total: true, status: true,
        invoiceStatus: true, invoiceType: true, invoicePointOfSale: true, invoiceNumber: true,
        cae: true, caeExpiresAt: true, invoiceDate: true, invoiceError: true, invoiceAttempts: true,
        receptorName: true, receptorDocNro: true,
        client: { select: { name: true } },
      },
    });

    const counts = await this.prisma.sale.groupBy({ by: ['invoiceStatus'], _count: { _all: true } });
    const resumen: Record<string, number> = {};
    for (const c of counts) resumen[c.invoiceStatus] = c._count._all;

    return { sales, resumen };
  }

  /** Datos del comprobante para imprimir, incluido el QR obligatorio. */
  async getInvoice(saleId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    const config = await this.prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    return this.invoiceView(sale, config);
  }

  private invoiceView(sale: any, config: any) {
    return {
      saleId: sale.id,
      saleNumber: sale.saleNumber,
      status: sale.invoiceStatus,
      type: sale.invoiceType,
      pointOfSale: sale.invoicePointOfSale,
      number: sale.invoiceNumber,
      cbteTipo: sale.invoiceCbteTipo,
      cae: sale.cae,
      caeExpiresAt: sale.caeExpiresAt,
      date: sale.invoiceDate,
      neto: sale.invoiceNeto,
      iva: sale.invoiceIva,
      error: sale.invoiceError,
      // Datos del emisor: el ticket los imprime y no puede inventarlos
      emisor: config ? {
        cuit: config.cuit,
        razonSocial: config.razonSocial,
        ivaCondition: config.ivaCondition,
        pointOfSale: config.pointOfSale,
        environment: config.environment,
      } : null,
      receptor: {
        docTipo: sale.receptorDocTipo,
        docNro: sale.receptorDocNro,
        name: sale.receptorName,
        ivaCondition: sale.receptorIvaCondition,
      },
      qrUrl: sale.cae && config ? this.buildQrUrl(sale, config) : null,
    };
  }

  /**
   * QR obligatorio en el comprobante (RG 4892): un JSON en base64 colgado de la URL
   * de ARCA, que es lo que lee el cliente para verificar que el comprobante existe.
   */
  buildQrUrl(sale: any, config: any): string {
    const datos = {
      ver: 1,
      fecha: (sale.invoiceDate ? new Date(sale.invoiceDate) : new Date()).toISOString().slice(0, 10),
      cuit: Number(config.cuit),
      ptoVta: sale.invoicePointOfSale,
      tipoCmp: sale.invoiceCbteTipo,
      nroCmp: sale.invoiceNumber,
      importe: Number(sale.total),
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: sale.receptorDocTipo,
      nroDocRec: Number(sale.receptorDocNro) || 0,
      tipoCodAut: 'E',
      codAut: Number(sale.cae),
    };
    const payload = Buffer.from(JSON.stringify(datos), 'utf8').toString('base64');
    return `https://www.afip.gob.ar/fe/qr/?p=${payload}`;
  }
}
