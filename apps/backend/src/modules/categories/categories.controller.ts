import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
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
