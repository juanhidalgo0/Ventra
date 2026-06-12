import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    return client;
  }

  async create(data: any) {
    return this.prisma.client.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.client.update({ where: { id }, data });
  }

  async addMovement(clientId: string, data: { type: 'DEBT' | 'PAYMENT', amount: number, description?: string, saleId?: string, userId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) throw new NotFoundException('Cliente no encontrado');

      const balanceBefore = client.balance;
      const balanceAfter = data.type === 'DEBT' ? balanceBefore + data.amount : balanceBefore - data.amount;

      const movement = await tx.accountMovement.create({
        data: {
          clientId,
          saleId: data.saleId,
          userId: data.userId,
          type: data.type,
          amount: data.amount,
          balanceBefore,
          balanceAfter,
          description: data.description,
        },
      });

      await tx.client.update({
        where: { id: clientId },
        data: { balance: balanceAfter },
      });

      return movement;
    });
  }
}
