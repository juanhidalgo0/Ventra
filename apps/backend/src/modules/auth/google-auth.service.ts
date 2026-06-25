import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { ProductsService } from '../products/products.service';
import * as https from 'https';

@Injectable()
export class GoogleAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private productsService: ProductsService,
  ) {}

  private linkedUser: any = null;

  setLinkedGoogleUser(user: any) {
    this.linkedUser = user;
  }

  getLinkedGoogleUser() {
    return this.linkedUser;
  }

  clearLinkedGoogleUser() {
    this.linkedUser = null;
  }

  public verifyToken(idToken: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error_description || parsed.error) {
              reject(new Error(parsed.error_description || parsed.error));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  async loginWithGoogle(idToken: string) {
    try {
      const payload = await this.verifyToken(idToken);
      const email = payload.email;
      const name = payload.name || payload.given_name || 'Usuario Google';
      const picture = payload.picture;

      if (!email) {
        throw new UnauthorizedException('Token de Google no contiene email');
      }

      let user = await this.prisma.user.findUnique({ where: { username: email } });
      
      if (!user) {
        // Create user in POS local SQLite dynamically
        user = await this.prisma.user.create({
          data: {
            username: email,
            passwordHash: '$2b$10$DUMMYHASHGOOGLEOAUTHUSERDONOTTRYTOLOGINWITHPASSWORD',
            fullName: name,
            role: 'CASHIER',
            avatarUrl: picture || null,
          },
        });
      }

      if (!user.isActive) {
        throw new UnauthorizedException('El usuario está inactivo');
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      const jwtPayload = { sub: user.id, username: user.username, role: user.role };
      const accessToken = this.jwtService.sign(jwtPayload);
      const refreshToken = this.jwtService.sign(jwtPayload, {
        secret: this.config.get('JWT_REFRESH_SECRET', 'paulos-refresh-default'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRATION', '7d'),
      });

      await this.prisma.auditLog.create({
        data: { userId: user.id, entityType: 'AUTH', entityId: user.id, action: 'GOOGLE_LOGIN' },
      });

      // Intentar iniciar la sincronización si la cuenta de Google es la dueña del comercio
      this.productsService.verifyGoogleEmailOwnsTerminalCommerce(email).catch(err => {
        console.error('[GoogleAuthService] Error al verificar propiedad para sincronización tras login:', err.message);
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
    } catch (err: any) {
      console.error('Error verifying Google Token:', err);
      throw new UnauthorizedException('Token de Google inválido: ' + err.message);
    }
  }

  async verifyGoogleEmailLink(email: string): Promise<boolean> {
    return this.productsService.verifyGoogleEmailOwnsTerminalCommerce(email);
  }
}
