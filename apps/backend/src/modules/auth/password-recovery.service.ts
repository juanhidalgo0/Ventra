import { randomBytes } from 'crypto';
import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { AuthService } from './auth.service';
import { assertValidPassword } from './password-policy';

/** Proyecto de Firebase de Ventra: el mismo de las cuentas (ventra.store, web.ventra.store). */
const FIREBASE_PROJECT = 'ventra-9cba5';
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const TTL_MS = 10 * 60 * 1000;
const MAX_OPEN = 20;
const MAX_VERIFY_TRIES = 5;

interface Recovery { createdAt: number; verifiedEmail: string | null; tries: number }

/**
 * "Olvidé la contraseña del administrador": quien entra con la cuenta de Google de la
 * suscripción (la de la licencia firmada de esta PC) elige una contraseña nueva para un
 * administrador. Reemplaza a la clave maestra fija, que era la misma para todos los comercios.
 *
 * Google no abre su ventana dentro de la app, así que la PC abre una página suya en el
 * navegador de Windows (localhost: dominio autorizado en Firebase). Esa página entra con
 * Google y devuelve el token de Firebase; la PC lo verifica con las claves públicas de Google
 * y compara el email con el de la licencia. El pedido (id al azar) lo conoce solo la pantalla
 * que lo abrió y vence a los 10 minutos.
 */
@Injectable()
export class PasswordRecoveryService {
  private open = new Map<string, Recovery>();
  private certs: { at: number; keys: Record<string, string> } | null = null;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private subscription: SubscriptionService,
    private auth: AuthService,
  ) {}

  /** Email de la cuenta de Ventra a la que está vinculada esta PC (o null). */
  private accountEmail(): string | null {
    if (process.env.DEMO_MODE === 'true') return null;
    const email = (this.subscription.getStatus() as any).email;
    return email ? String(email).trim().toLowerCase() : null;
  }

  private prune() {
    const now = Date.now();
    for (const [id, r] of this.open) if (now - r.createdAt > TTL_MS) this.open.delete(id);
  }

  private get(id: string): Recovery {
    this.prune();
    const r = this.open.get(String(id || ''));
    if (!r) throw new NotFoundException('El pedido venció. Empezá de nuevo.');
    return r;
  }

  start() {
    const email = this.accountEmail();
    if (!email) {
      throw new ForbiddenException('Esta PC no está vinculada a una cuenta de Ventra: pedile a soporte que te ayude a entrar.');
    }
    this.prune();
    if (this.open.size >= MAX_OPEN) throw new BadRequestException('Hay demasiados pedidos abiertos. Probá en unos minutos.');
    const id = randomBytes(24).toString('hex');
    this.open.set(id, { createdAt: Date.now(), verifiedEmail: null, tries: 0 });
    // Se muestra solo parte del email: alcanza para saber con qué cuenta entrar
    const [user, domain] = email.split('@');
    return { id, hint: `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}` };
  }

  private async publicKeys(): Promise<Record<string, string>> {
    if (this.certs && Date.now() - this.certs.at < 60 * 60 * 1000) return this.certs.keys;
    const { data } = await axios.get(CERTS_URL, { timeout: 10000 });
    this.certs = { at: Date.now(), keys: data };
    return data;
  }

  /** Token de Firebase de quien entró con Google en la página: tiene que ser la cuenta de esta PC. */
  async verify(id: string, idToken: string) {
    const r = this.get(id);
    if (r.verifiedEmail) return { ok: true };
    if (++r.tries > MAX_VERIFY_TRIES) {
      this.open.delete(id);
      throw new ForbiddenException('Demasiados intentos. Empezá de nuevo desde Ventra.');
    }
    const decoded: any = this.jwt.decode(String(idToken || ''), { complete: true });
    const kid = decoded?.header?.kid;
    const keys = await this.publicKeys().catch(() => {
      throw new BadRequestException('No se pudo verificar con Google. Revisá internet y probá de nuevo.');
    });
    if (!kid || !keys[kid]) throw new BadRequestException('Inicio de sesión de Google inválido');
    let claims: any;
    try {
      // `secret` y no `publicKey`: el módulo ya tiene su propio secreto y Nest lo usaría antes
      claims = await this.jwt.verifyAsync(idToken, {
        secret: keys[kid],
        algorithms: ['RS256'],
        audience: FIREBASE_PROJECT,
        issuer: `https://securetoken.google.com/${FIREBASE_PROJECT}`,
      } as any);
    } catch {
      throw new BadRequestException('Inicio de sesión de Google inválido o vencido');
    }
    const email = String(claims.email || '').trim().toLowerCase();
    const expected = this.accountEmail();
    if (!claims.email_verified || !email || !expected || email !== expected) {
      throw new ForbiddenException('Esa cuenta de Google no es la de la suscripción de este comercio. Entrá con la cuenta con la que pagás Ventra.');
    }
    r.verifiedEmail = email;
    return { ok: true };
  }

  /** Si ya entró con Google: los administradores a los que se les puede cambiar la contraseña. */
  async status(id: string) {
    const r = this.get(id);
    if (!r.verifiedEmail) return { verified: false };
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { username: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    return { verified: true, admins };
  }

  /** Nueva contraseña para un administrador y sesión abierta con él. */
  async reset(id: string, username: string, newPassword: string) {
    const r = this.get(id);
    if (!r.verifiedEmail) throw new ForbiddenException('Primero entrá con la cuenta de Google del comercio.');
    assertValidPassword(newPassword);
    const user = await this.prisma.user.findUnique({ where: { username: String(username || '').toUpperCase() } });
    if (!user || user.role !== 'ADMIN' || !user.isActive) throw new BadRequestException('Elegí un administrador activo');
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    this.open.delete(id);
    console.log(`[Auth] Contraseña de ${user.username} restablecida con la cuenta de Google ${r.verifiedEmail}`);
    return this.auth.issueSession(user, false, 'PASSWORD_RECOVERY');
  }
}
