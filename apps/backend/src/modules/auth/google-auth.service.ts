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
      const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
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

  async verifyGoogleEmailLink(email: string): Promise<boolean> {
    return this.productsService.verifyGoogleEmailOwnsTerminalCommerce(email);
  }
}
