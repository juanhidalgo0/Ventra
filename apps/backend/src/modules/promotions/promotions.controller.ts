import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('promotions')
@UseGuards(JwtAuthGuard)
export class PromotionsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.promotion.findMany({
      include: { 
        products: { 
          include: { 
            product: { 
              select: { 
                id: true, 
                name: true, 
                barcode: true, 
                salePrice: true 
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
      const { products, ...promoData } = data;
      
      if (promoData.endDate) {
        promoData.endDate = new Date(promoData.endDate + 'T23:59:59.999Z');
      } else {
        promoData.endDate = null;
      }
      
      return this.prisma.$transaction(async (tx) => {
        const promotion = await tx.promotion.create({
          data: {
            ...promoData,
            products: {
              create: products.map((p: any) => ({
                productId: p.productId,
                quantity: p.quantity || 1
              }))
            }
          },
          include: { products: true }
        });
        return promotion;
      });
    } catch (error) {
      console.error('Error creating promotion:', error);
      throw new InternalServerErrorException('Error al crear promoción: ' + error.message);
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    try {
      const { products, ...promoData } = data;
      
      if (promoData.endDate) {
        promoData.endDate = new Date(promoData.endDate + 'T23:59:59.999Z');
      } else {
        promoData.endDate = null;
      }
      
      return this.prisma.$transaction(async (tx) => {
        // Delete old relations
        await tx.promotionProduct.deleteMany({ where: { promotionId: id } });
        
        // Update promo and create new relations
        return tx.promotion.update({
          where: { id },
          data: {
            ...promoData,
            products: {
              create: products.map((p: any) => ({
                productId: p.productId,
                quantity: p.quantity || 1
              }))
            }
          },
          include: { products: true }
        });
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al actualizar promoción: ' + error.message);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.prisma.promotion.update({ 
      where: { id }, 
      data: { isActive: false } 
    });
  }
}
