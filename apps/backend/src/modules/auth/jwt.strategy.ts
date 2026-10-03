import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    if (!payload.sub) throw new UnauthorizedException();

    // El usuario y su rol salen de la base, no del token: un usuario desactivado o al que le
    // bajaron el rol pierde el acceso enseguida, no cuando vence el token
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, isActive: true },
    });
    if (!user) throw new UnauthorizedException('Sesión inválida o base de datos restaurada');
    if (!user.isActive) throw new UnauthorizedException('Usuario desactivado');

    return { sub: user.id, username: user.username, role: user.role };
  }
}
