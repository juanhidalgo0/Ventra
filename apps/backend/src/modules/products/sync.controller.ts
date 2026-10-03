import { Controller, Post, Delete, Body, Param, Headers, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { ConfigService } from '@nestjs/config';

/** Valores que estuvieron escritos en el código (repositorio público): no valen como token. */
const PUBLIC_TOKENS = new Set(['paulos-local-sync-token-secret-2026']);

/**
 * Altas y bajas de productos desde GoDelivery (integración vieja). Apagado salvo que la
 * instalación tenga su propio LOCAL_SYNC_TOKEN largo: sin token, cualquiera en la red
 * podía cambiar precios, stock y costos.
 */
@Controller('sync')
export class SyncController {
  private localSyncToken: string;

  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private configService: ConfigService,
  ) {
    const configured = String(this.configService.get<string>('LOCAL_SYNC_TOKEN') || '');
    this.localSyncToken = configured.length >= 32 && !PUBLIC_TOKENS.has(configured) ? configured : '';
  }

  private validateToken(token: string) {
    const expected = Buffer.from(this.localSyncToken);
    const given = Buffer.from(String(token || ''));
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Token de sincronización inválido o no provisto.');
    }
  }

  @Post('product')
  async syncProduct(
    @Headers('x-sync-token') token: string,
    @Body() body: any,
  ) {
    this.validateToken(token);
    const { barcode, name, salePrice, stock, costPrice, sku, description, godeliveryId } = body;
    if (!name) {
      throw new BadRequestException('El campo name es obligatorio para crear/actualizar.');
    }
    if (salePrice === undefined || isNaN(salePrice)) {
      throw new BadRequestException('El campo salePrice es obligatorio.');
    }

    let existing = null;
    const hasValidBarcode = barcode && barcode.trim() !== '' && barcode.toLowerCase() !== 'sin código' && barcode.toLowerCase() !== 'sin codigo';

    if (hasValidBarcode) {
      existing = await this.prisma.product.findUnique({
        where: { barcode },
      });
    }

    // Buscar por ID de GoDelivery (guardado en ID local o en SKU)
    if (!existing && godeliveryId) {
      existing = await this.prisma.product.findFirst({
        where: {
          OR: [
            { id: godeliveryId },
            { sku: godeliveryId }
          ],
          isActive: true
        }
      });
    }

    if (!existing) {
      const cleanName = name.trim().toUpperCase();
      const allActive = await this.prisma.product.findMany({
        where: { isActive: true }
      });
      existing = allActive.find(p => p.name.trim().toUpperCase() === cleanName) || null;
    }

    let product;

    if (existing) {
      product = await this.prisma.product.update({
        where: { id: existing.id },
        data: {
          name,
          salePrice: parseFloat(salePrice),
          stock: stock !== undefined ? parseFloat(stock) : existing.stock,
          costPrice: costPrice !== undefined ? parseFloat(costPrice) : existing.costPrice,
          sku: sku || godeliveryId || existing.sku,
          description: description !== undefined ? description : existing.description,
          isActive: true,
          updatedAt: new Date(),
        },
      });
      console.log(`[LocalSync] Producto [${barcode}] actualizado desde GoDelivery.`);
    } else {
      product = await this.prisma.product.create({
        data: {
          id: godeliveryId || undefined,
          barcode,
          sku: sku || godeliveryId || barcode,
          name,
          salePrice: parseFloat(salePrice),
          costPrice: costPrice !== undefined ? parseFloat(costPrice) : 0,
          stock: stock !== undefined ? parseFloat(stock) : 0,
          description: description || '',
          isActive: true,
        },
      });
      console.log(`[LocalSync] Producto [${barcode || godeliveryId}] creado desde GoDelivery.`);
    }

    // Emit event to notify POS frontend in real-time
    this.eventsGateway.emitProductUpdated(product);

    return {
      success: true,
      action: existing ? 'updated' : 'created',
      product,
    };
  }

  @Delete('product/:barcode')
  async syncDeleteProduct(
    @Headers('x-sync-token') token: string,
    @Param('barcode') barcode: string,
  ) {
    this.validateToken(token);

    if (!barcode) {
      throw new BadRequestException('El código de barra es obligatorio.');
    }

    const existing = await this.prisma.product.findUnique({
      where: { barcode },
    });

    if (!existing) {
      console.log(`[LocalSync] Intento de eliminar producto [${barcode}] pero no existe en POS.`);
      return { success: true, action: 'none', message: 'Producto no encontrado localmente' };
    }

    const updated = await this.prisma.product.update({
      where: { id: existing.id },
      data: { isActive: false, updatedAt: new Date() },
    });

    console.log(`[LocalSync] Producto [${barcode}] marcado como inactivo desde GoDelivery.`);

    // Emit event to notify POS frontend in real-time
    this.eventsGateway.emitProductUpdated(updated);

    return {
      success: true,
      action: 'deleted',
      product: updated,
    };
  }
}
