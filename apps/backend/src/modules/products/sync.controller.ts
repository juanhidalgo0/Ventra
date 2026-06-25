import { Controller, Post, Delete, Body, Param, Headers, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { ConfigService } from '@nestjs/config';

@Controller('sync')
export class SyncController {
  private localSyncToken: string;

  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private configService: ConfigService,
  ) {
    this.localSyncToken = this.configService.get<string>('LOCAL_SYNC_TOKEN', 'paulos-local-sync-token-secret-2026');
  }

  private validateToken(token: string) {
    if (!token || token !== this.localSyncToken) {
      throw new UnauthorizedException('Token de sincronización inválido o no provisto.');
    }
  }

  @Post('product')
  async syncProduct(
    @Headers('x-sync-token') token: string,
    @Body() body: any,
  ) {
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
