import { timingSafeEqual } from 'crypto';
import { Injectable, UnauthorizedException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';
import { assertValidPassword } from './password-policy';

/**
 * Freno a quien prueba claves una tras otra (son numéricas: sin freno, una de 4 dígitos
 * sale en minutos). Se cuenta por usuario y equipo, y por usuario en total: pasado el
 * límite, cada intento fallido duplica la espera, hasta 15 minutos.
 */
const LOGIN_FREE_FAILS = 5;
const LOGIN_FREE_FAILS_ANY_ORIGIN = 20;
const LOGIN_BASE_LOCK_MS = 30 * 1000;
const LOGIN_MAX_LOCK_MS = 15 * 60 * 1000;
const LOGIN_FORGET_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private loginFailures = new Map<string, { count: number; until: number; last: number }>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private productsService: ProductsService,
  ) {}

  private lockedFor(key: string) {
    const f = this.loginFailures.get(key);
    return f && f.until > Date.now() ? f.until - Date.now() : 0;
  }

  private recordFailure(key: string, freeFails: number) {
    const now = Date.now();
    const prev = this.loginFailures.get(key);
    const count = (prev && now - prev.last < LOGIN_FORGET_MS ? prev.count : 0) + 1;
    const until = count >= freeFails ? now + Math.min(LOGIN_BASE_LOCK_MS * 2 ** (count - freeFails), LOGIN_MAX_LOCK_MS) : 0;
    this.loginFailures.set(key, { count, until, last: now });
    if (this.loginFailures.size > 10000) {
      for (const [k, v] of this.loginFailures) if (now - v.last > LOGIN_FORGET_MS) this.loginFailures.delete(k);
    }
  }

  async login(username: string, password: string, longSession = false, origin = '') {
    const normUsername = username.toUpperCase();
    const keyOrigin = `${normUsername}|${origin}`;
    const keyUser = `${normUsername}|*`;
    const wait = Math.max(this.lockedFor(keyOrigin), this.lockedFor(keyUser));
    if (wait > 0) {
      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Demasiados intentos fallidos. Probá de nuevo en ${Math.ceil(wait / 60000)} ${wait > 60000 ? 'minutos' : 'minuto'}.`,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { username: normUsername } });
    const passwordValid = !!user && user.isActive && await bcrypt.compare(password, user.passwordHash);
    if (!user || !passwordValid) {
      this.recordFailure(keyOrigin, LOGIN_FREE_FAILS);
      this.recordFailure(keyUser, LOGIN_FREE_FAILS_ANY_ORIGIN);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    this.loginFailures.delete(keyOrigin);
    this.loginFailures.delete(keyUser);

    return this.issueSession(user, longSession && user.role === 'ADMIN', 'LOGIN');
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
