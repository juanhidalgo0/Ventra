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
      secretOrKey: config.get('JWT_SECRET', 'paulos-pos-default-secret'),
    });
  }

  async validate(payload: any) {
    if (!payload.sub) throw new UnauthorizedException();

    // Verify user exists in database to handle database resets/restores gracefully
    const userExists = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!userExists) throw new UnauthorizedException('Sesión inválida o base de datos restaurada');

    return { sub: payload.sub, username: payload.username, role: payload.role };
  }
}
