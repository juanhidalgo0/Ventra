import { timingSafeEqual } from 'crypto';
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';
import { assertValidPassword } from './password-policy';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private productsService: ProductsService,
  ) {}

  // Sin límite de intentos fallidos: lo pidió el dueño de Ventra (los comercios quedaban
  // bloqueados hasta 15 minutos). `origin` queda en la firma por compatibilidad con el controlador.
  async login(username: string, password: string, longSession = false, _origin = '') {
    const normUsername = username.toUpperCase();
    const user = await this.prisma.user.findUnique({ where: { username: normUsername } });
    const passwordValid = !!user && user.isActive && await bcrypt.compare(password, user.passwordHash);
    if (!user || !passwordValid) throw new UnauthorizedException('Credenciales inválidas');

    return this.issueSession(user, longSession && user.role === 'ADMIN', 'LOGIN');
  }

  /**
   * Acceso de administrador desde la caja (candado del menú y del POS): con la contraseña del
   * administrador del comercio, se llame como se llame (el usuario con rol ADMIN; hay uno solo).
   * Antes se probaba contra un usuario llamado literalmente "ADMIN" y en los comercios cuyo
   * administrador tiene otro nombre la clave nunca coincidía.
   */
  async adminUnlock(password: string) {
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
    for (const admin of admins) {
      if (await bcrypt.compare(String(password || ''), admin.passwordHash)) return this.issueSession(admin, false, 'ADMIN_UNLOCK');
    }
    throw new UnauthorizedException('Contraseña de administrador incorrecta');
  }

  /**
   * Soporte de Ventra desde ventra.store/admin: entra como el administrador del comercio
   * sin contraseña. Solo en la caja en la nube, y solo si el pedido trae la llave que el
   * anfitrión le dio a esta caja al arrancarla (el anfitrión la agrega él mismo y descarta
   * cualquiera que mande el navegador). En las PCs no hay llave y esto siempre se rechaza.
   */
  async supportLogin(key: string | undefined) {
    const expected = Buffer.from(process.env.VENTRA_SUPPORT_KEY || '');
    const given = Buffer.from(String(key || ''));
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Acceso de soporte no autorizado');
    }
    const user = await this.prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!user) throw new UnauthorizedException('El comercio no tiene un administrador activo');
    return this.issueSession(user, false, 'SUPPORT_LOGIN');
  }

  async issueSession(
    user: { id: string; username: string; fullName: string; role: string; avatarUrl: string | null },
    longSession: boolean,
    action: string,
  ) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = { sub: user.id, username: user.username, role: user.role };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.signRefresh(payload, longSession);

    await this.prisma.auditLog.create({
      data: { userId: user.id, entityType: 'AUTH', entityId: user.id, action },
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
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: longSession ? '180d' : this.config.get('JWT_REFRESH_EXPIRATION', '7d'),
    });
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
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

    assertValidPassword(newPassword);

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
    assertValidPassword(password);
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
