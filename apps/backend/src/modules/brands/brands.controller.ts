import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('brands')
@UseGuards(JwtAuthGuard)
export class BrandsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  async create(@Body() data: { name: string }) {
    const nameUpper = data.name.trim().toUpperCase();
    
    const existing = await this.prisma.brand.findUnique({
      where: { name: nameUpper },
    });
    if (existing) {
      return existing;
    }
    
    return this.prisma.brand.create({
      data: { name: nameUpper },
    });
  }
}
