import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, fullName: true, role: true, isActive: true, avatarUrl: true, lastLogin: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, fullName: true, role: true, isActive: true, avatarUrl: true, lastLogin: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async create(data: { username: string; password: string; fullName: string; role: string }) {
    const normUsername = data.username.toUpperCase();
    if (!/^\d+$/.test(data.password)) {
      throw new BadRequestException('La contraseña debe ser puramente numérica');
    }
    const exists = await this.prisma.user.findUnique({ where: { username: normUsername } });
    if (exists) throw new ConflictException('El usuario ya existe');
    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: { username: normUsername, passwordHash, fullName: normUsername, role: data.role },
      select: { id: true, username: true, fullName: true, role: true, isActive: true, createdAt: true },
    });
  }

  async update(id: string, data: { username?: string; fullName?: string; role?: string; isActive?: boolean; password?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const updateData: any = {};
    if (data.username) {
      const normUsername = data.username.toUpperCase().replace(/\s+/g, '');
      const exists = await this.prisma.user.findFirst({
        where: {
          username: normUsername,
          NOT: { id }
        }
      });
      if (exists) throw new ConflictException('El nombre de usuario ya está en uso');
      updateData.username = normUsername;
      updateData.fullName = normUsername;
    }
    if (data.fullName && !data.username) updateData.fullName = data.fullName;
    if (data.role) updateData.role = data.role;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.password) {
      if (!/^\d+$/.test(data.password)) {
        throw new BadRequestException('La contraseña debe ser puramente numérica');
      }
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }
    return this.prisma.user.update({
      where: { id }, data: updateData,
      select: { id: true, username: true, fullName: true, role: true, isActive: true, createdAt: true },
    });
  }

  async delete(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    
    return this.prisma.$transaction(async (tx) => {
      // Clean up all related movements and logs to maintain SQLite integrity
      await tx.auditLog.deleteMany({ where: { userId: id } });
      await tx.cashMovement.deleteMany({ where: { userId: id } });
      await tx.inventoryMovement.deleteMany({ where: { userId: id } });
      await tx.priceHistory.deleteMany({ where: { userId: id } });
      await tx.accountMovement.deleteMany({ where: { userId: id } });
      await tx.supplierPayment.deleteMany({ where: { userId: id } });
      
      // Purchases
      await tx.purchaseItem.deleteMany({ where: { purchase: { userId: id } } });
      await tx.purchase.deleteMany({ where: { userId: id } });
      
      // Sales
      await tx.payment.deleteMany({ where: { sale: { userId: id } } });
      await tx.saleItem.deleteMany({ where: { sale: { userId: id } } });
      await tx.sale.deleteMany({ where: { userId: id } });
      
      // Register sessions
      await tx.cashRegisterSession.deleteMany({ where: { userId: id } });
      
      // Finally, delete the user record completely
      return tx.user.delete({ where: { id } });
    });
  }
}
