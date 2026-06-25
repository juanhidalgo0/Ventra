import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MarketingService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.marketingGroup.findMany({
      include: {
        items: {
          include: {
            product: true
          },
          orderBy: {
            order: 'asc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async findOne(id: string) {
    const group = await this.prisma.marketingGroup.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true
          },
          orderBy: {
            order: 'asc'
          }
        }
      }
    });
    if (!group) throw new NotFoundException('Marketing group not found');
    return group;
  }

  async create(data: { name: string; description?: string; items: { productId: string; order?: number }[] }) {
    return this.prisma.marketingGroup.create({
      data: {
        name: data.name,
        description: data.description,
        items: {
          create: data.items.map((item, index) => ({
            productId: item.productId,
            order: item.order ?? index
          }))
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });
  }

  async update(id: string, data: { name?: string; description?: string; items?: { productId: string; order?: number }[] }) {
    const group = await this.prisma.marketingGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Marketing group not found');

    if (data.items) {
      // Replace all items if provided
      await this.prisma.marketingGroupItem.deleteMany({
        where: { marketingGroupId: id }
      });
    }

    return this.prisma.marketingGroup.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        ...(data.items && {
          items: {
            create: data.items.map((item, index) => ({
              productId: item.productId,
              order: item.order ?? index
            }))
          }
        })
      },
      include: {
        items: {
          include: {
            product: true
          },
          orderBy: {
            order: 'asc'
          }
        }
      }
    });
  }

  async remove(id: string) {
    const group = await this.prisma.marketingGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Marketing group not found');

    return this.prisma.marketingGroup.delete({
      where: { id }
    });
  }
}
