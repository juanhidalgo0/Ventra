import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('categories')
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.category.findMany({
      include: { 
        _count: { select: { products: true } },
        parentCategory: { select: { id: true, name: true } }
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /** Rubros ordenados por lo más vendido, para dejarlos a mano en el POS. */
  @Get('top')
  async top(@Query('days') days?: string, @Query('limit') limit?: string) {
    const since = new Date(Date.now() - (days ? parseInt(days) : 30) * 24 * 60 * 60 * 1000);
    const rows: { categoryId: string; sold: number }[] = await this.prisma.$queryRaw`
      SELECT p.category_id AS categoryId, SUM(si.quantity) AS sold
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at >= ${since} AND s.status = 'COMPLETED' AND p.category_id IS NOT NULL
      GROUP BY p.category_id
      ORDER BY sold DESC
      LIMIT ${limit ? parseInt(limit) : 10}
    `;
    return rows.map(r => ({ categoryId: r.categoryId, sold: Number(r.sold) }));
  }

  @Post()
  async create(@Body() data: { name: string; color?: string; icon?: string; parentCategoryId?: string }) {
    const createData: any = {
      name: data.name,
      color: data.color || '#6366f1',
      icon: data.icon || 'Package',
      parentCategoryId: data.parentCategoryId || null,
    };
    return this.prisma.category.create({ data: createData });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    if (data.parentCategoryId === id) {
      data.parentCategoryId = null;
    }
    return this.prisma.category.update({ where: { id }, data });
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.prisma.category.update({ where: { id }, data: { isActive: false } });
  }
}
