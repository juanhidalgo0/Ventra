import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, InternalServerErrorException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.promotion.findMany({
      where: { isActive: true },
      include: { 
        products: { 
          include: { 
            product: { 
              select: { 
                id: true, 
                name: true, 
                barcode: true, 
                salePrice: true,
                stock: true,
                unlimitedStock: true
              } 
            } 
          } 
        } 
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() data: any) {
    try {
      const { products, promoData } = this.clean(data);
      return await this.prisma.$transaction(async (tx) => {
        const promotion = await tx.promotion.create({
          data: {
            ...promoData,
            products: { create: products }
          },
          include: { products: true }
        });
        return promotion;
      });
    } catch (error) {
      console.error('Error creating promotion:', error);
      throw this.toHttpError(error, 'Error al crear promoción');
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    try {
      const { products, promoData } = this.clean(data);
      return await this.prisma.$transaction(async (tx) => {
        // Delete old relations
        await tx.promotionProduct.deleteMany({ where: { promotionId: id } });

        // Update promo and create new relations
        return tx.promotion.update({
          where: { id },
          data: {
            ...promoData,
            products: { create: products }
          },
          include: { products: true }
        });
      });
    } catch (error) {
      console.error('Error updating promotion:', error);
      throw this.toHttpError(error, 'Error al actualizar promoción');
    }
  }

  // Solo los campos de la tabla: el código vacío va como null (es único y dos promos sin código chocaban)
  private clean(data: any) {
    const num = (v: any) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const promoData = {
      name: String(data.name || '').trim() || 'Promoción',
      code: code || null,
      type: data.type,
      nValue: num(data.nValue) === null ? null : Math.round(num(data.nValue)),
      mValue: num(data.mValue) === null ? null : Math.round(num(data.mValue)),
      fixedPrice: num(data.fixedPrice),
      discountPercentage: num(data.discountPercentage),
      limitType: data.limitType || 'NONE',
      limitStock: num(data.limitStock),
      endDate: data.endDate ? new Date(String(data.endDate).slice(0, 10) + 'T23:59:59.999Z') : null,
    };
    const products = (Array.isArray(data.products) ? data.products : []).map((p: any) => ({
      productId: p.productId,
      quantity: Math.max(1, Math.round(Number(p.quantity) || 1)),
      groupId: p.groupId || null
    }));
    return { products, promoData };
  }

  private toHttpError(error: any, prefix: string) {
    if (error?.code === 'P2002') return new ConflictException('Ya hay otra promoción con ese código. Usá otro o dejalo vacío.');
    if (error?.code === 'P2003') return new BadRequestException('Uno de los productos de la promoción ya no existe. Sacalo y volvé a guardar.');
    return new InternalServerErrorException(prefix + ': ' + (error?.message || 'error desconocido'));
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.prisma.promotion.update({ 
      where: { id }, 
      data: { isActive: false } 
    });
  }
}
