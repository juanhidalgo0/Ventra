import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private productsService: ProductsService,
  ) {}

  async login(username: string, password: string) {
    const normUsername = username.toUpperCase();
    const user = await this.prisma.user.findUnique({ where: { username: normUsername } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = { sub: user.id, username: user.username, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET', 'paulos-refresh-default'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRATION', '7d'),
    });

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
        refreshToken: this.jwtService.sign(newPayload, {
          secret: this.config.get('JWT_REFRESH_SECRET', 'paulos-refresh-default'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRATION', '7d'),
        }),
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
