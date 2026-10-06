import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { assertValidPassword } from '../auth/password-policy';

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

  /**
   * Un comercio tiene UN administrador (el dueño): su clave es la del acceso de administrador
   * de la caja. Los demás usuarios son supervisores o cajeros.
   */
  private async otherActiveAdmin(exceptId?: string) {
    return this.prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { username: true } });
  }

  async create(data: { username: string; password: string; fullName: string; role: string }) {
    const normUsername = data.username.toUpperCase();
    assertValidPassword(data.password);
    if (data.role === 'ADMIN') {
      const admin = await this.otherActiveAdmin();
      if (admin) throw new ConflictException(`Solo puede haber un administrador y ya es ${admin.username}. Creá este usuario como supervisor o cajero.`);
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
    if (data.role === 'ADMIN' && user.role !== 'ADMIN') {
      const admin = await this.otherActiveAdmin(id);
      if (admin) throw new ConflictException(`Solo puede haber un administrador y ya es ${admin.username}.`);
    }
    // Sin administrador nadie podría entrar a la configuración
    const losesAdmin = user.role === 'ADMIN' && ((data.role && data.role !== 'ADMIN') || data.isActive === false);
    if (losesAdmin && !(await this.otherActiveAdmin(id))) throw new BadRequestException('El comercio tiene que tener un administrador activo');
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
      assertValidPassword(data.password);
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
