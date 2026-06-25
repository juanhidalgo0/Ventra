import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SurchargesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const list = await this.prisma.surcharge.findMany({
      include: {
        category: {
          select: { id: true, name: true }
        }
      }
    });
    return list.map(item => ({
      ...item,
      paymentMethods: item.paymentMethods ? item.paymentMethods.split(',') : []
    }));
  }

  async upsert(data: { categoryId: string; percentage: number; paymentMethods: string[] }) {
    if (!data.categoryId) {
      throw new BadRequestException('El id de la categoría es obligatorio');
    }

    const paymentMethodsStr = (data.paymentMethods || []).join(',');

    const existing = await this.prisma.surcharge.findUnique({
      where: { categoryId: data.categoryId }
    });

    let result;
    if (existing) {
      result = await this.prisma.surcharge.update({
        where: { categoryId: data.categoryId },
        data: {
          percentage: Number(data.percentage),
          paymentMethods: paymentMethodsStr,
          updatedAt: new Date()
        }
      });
    } else {
      result = await this.prisma.surcharge.create({
        data: {
          categoryId: data.categoryId,
          percentage: Number(data.percentage),
          paymentMethods: paymentMethodsStr
        }
      });
    }

    return {
      ...result,
      paymentMethods: result.paymentMethods ? result.paymentMethods.split(',') : []
    };
  }

  async remove(id: string) {
    const existing = await this.prisma.surcharge.findUnique({
      where: { id }
    });
    if (!existing) {
      throw new NotFoundException('Recargo no encontrado');
    }
    return this.prisma.surcharge.delete({
      where: { id }
    });
  }
}
