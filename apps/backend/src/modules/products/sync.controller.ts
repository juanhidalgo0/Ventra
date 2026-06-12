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
    this.validateToken(token);

    const { barcode, name, salePrice, stock, costPrice, sku, description } = body;
    if (!barcode) {
      throw new BadRequestException('El campo barcode es obligatorio.');
    }
    if (!name) {
      throw new BadRequestException('El campo name es obligatorio para crear/actualizar.');
    }
    if (salePrice === undefined || isNaN(salePrice)) {
      throw new BadRequestException('El campo salePrice es obligatorio.');
    }

    // Find if product exists by barcode
    const existing = await this.prisma.product.findUnique({
      where: { barcode },
    });

    let product;

    if (existing) {
      product = await this.prisma.product.update({
        where: { id: existing.id },
        data: {
          name,
          salePrice: parseFloat(salePrice),
          stock: stock !== undefined ? parseFloat(stock) : existing.stock,
          costPrice: costPrice !== undefined ? parseFloat(costPrice) : existing.costPrice,
          sku: sku || existing.sku,
          description: description !== undefined ? description : existing.description,
          isActive: true, // Reactivate if it was deactivated
          updatedAt: new Date(),
        },
      });
      console.log(`[LocalSync] Producto [${barcode}] actualizado desde GoDelivery.`);
    } else {
      product = await this.prisma.product.create({
        data: {
          barcode,
          sku: sku || barcode,
          name,
          salePrice: parseFloat(salePrice),
          costPrice: costPrice !== undefined ? parseFloat(costPrice) : 0,
          stock: stock !== undefined ? parseFloat(stock) : 0,
          description: description || '',
          isActive: true,
        },
      });
      console.log(`[LocalSync] Producto [${barcode}] creado desde GoDelivery.`);
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
