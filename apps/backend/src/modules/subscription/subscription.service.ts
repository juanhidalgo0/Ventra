import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';

/**
 * Suscripción de Ventra de esta PC.
 *
 * - Instalación que ya venía funcionando antes de esta versión ("de antes"): queda
 *   libre para siempre, sin controles.
 * - Instalación nueva sin vincular: solo lectura hasta que se vincule con una cuenta
 *   (el instalador se baja desde ventra.store después de contratar un plan).
 * - Vinculada: se aplican las fechas del estado firmado que manda el servidor:
 *     hasta paidUntil ................ ACTIVE
 *     hasta paidUntil + graceDays .... GRACE (funciona normal, con aviso)
 *     después ........................ READ_ONLY (no se puede vender ni registrar nada)
 *
 * El estado viene firmado con Ed25519: la app solo tiene la clave pública, así que
 * editar el archivo local no sirve para extender la fecha. Se guarda en un archivo
 * de la carpeta de datos (no en la base) para que restaurar un backup no lo pise.
 */

// VENTRA_FUNCTIONS_URL permite apuntar a una nube de pruebas
const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';
const ACCOUNT_URL = 'https://ventra.store/cuenta.html';
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAQ/FfOROqai7PLh0ba7W4qeLWPbe63NY5WR5jc6fsZ7E=
-----END PUBLIC KEY-----`;
const DAY_MS = 24 * 60 * 60 * 1000;
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;

export type SubscriptionState = 'EXEMPT' | 'UNLINKED' | 'NEEDS_LINK' | 'ACTIVE' | 'GRACE' | 'READ_ONLY';

interface SignedLicense {
  v: number;
  deviceId: string;
  email: string | null;
  plan: string | null;
  planName: string | null;
  status: string | null;
  paidUntil: string | null;
  graceDays: number;
  issuedAt: string;
}

interface StoredSubscription {
  /** 'legacy' = instalación anterior a esta versión (libre); 'new' = instalación nueva (hay que vincular) */
  install?: { kind: 'legacy' | 'new'; at: string };
  deviceId?: string;
  deviceSecret?: string;
  license?: string;
  signature?: string;
  /** Primera vez que se vio la PC vinculada: base de la gracia si la cuenta nunca pagó. */
  linkedAt?: string;
  /** Hora más alta vista: si alguien atrasa el reloj de Windows, se usa esta. */
  lastSeen?: string;
  pending?: { code: string; deviceId: string; deviceSecret: string; expiresAt: string };
}

export interface SubscriptionStatus {
  state: SubscriptionState;
  enforced: boolean;
  email?: string | null;
  planName?: string | null;
  paidUntil?: string | null;
  graceEndsAt?: string | null;
  daysLeft?: number;
  lastSyncAt?: string | null;
  pending?: { code: string; url: string; expiresAt: string } | null;
}

/** Estado según las fechas. Pura, para poder probarla sola. */
export function computeState(license: SignedLicense, linkedAt: Date, now: Date) {
  const base = license.paidUntil ? new Date(license.paidUntil) : linkedAt;
  const graceEnd = new Date(base.getTime() + (license.graceDays ?? 7) * DAY_MS);
  const ceilDays = (ms: number) => Math.max(0, Math.ceil(ms / DAY_MS));
  if (license.paidUntil && now.getTime() <= base.getTime()) {
    return { state: 'ACTIVE' as const, graceEnd, daysLeft: ceilDays(base.getTime() - now.getTime()) };
  }
  if (now.getTime() <= graceEnd.getTime()) {
    return { state: 'GRACE' as const, graceEnd, daysLeft: ceilDays(graceEnd.getTime() - now.getTime()) };
  }
  return { state: 'READ_ONLY' as const, graceEnd, daysLeft: 0 };
}

@Injectable()
export class SubscriptionService implements OnModuleInit, OnModuleDestroy {
  private readonly file = path.join(process.cwd(), 'ventra-subscription.json');
  private stored: StoredSubscription = {};
  private timer: NodeJS.Timeout | null = null;
  private lastPersistedSeen = 0;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.stored = this.read();
    this.detectInstallKind().catch(() => {});
    // No bloquea el arranque: se sincroniza en segundo plano
    if (this.stored.deviceId) this.refresh().catch(() => {});
    this.timer = setInterval(() => {
      if (this.stored.deviceId) this.refresh().catch(() => {});
    }, REFRESH_EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * ¿Esta instalación venía de antes? Se decide una sola vez, la primera vez que
   * corre esta versión: si ya había productos o ventas, es una instalación anterior
   * y queda libre. Se guarda en la base y en el archivo (hay que borrar los dos para
   * reiniciarlo, y aun así una base con datos vuelve a marcarse como anterior).
   */
  private async detectInstallKind() {
    await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ventra_install (key TEXT PRIMARY KEY, value TEXT)`).catch(() => {});
    let rows: any[] = [];
    try {
      rows = await this.prisma.$queryRawUnsafe(`SELECT value FROM ventra_install WHERE key = 'kind'`);
    } catch {}
    const inDb = rows[0]?.value === 'legacy' || rows[0]?.value === 'new' ? rows[0].value : null;
    const inFile = this.stored.install?.kind || null;
    let kind: 'legacy' | 'new' | null = inDb === 'new' || inFile === 'new' ? 'new' : (inDb || inFile);

    if (!kind) {
      let hasData = false;
      try {
        const r: any[] = await this.prisma.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM sales) AS n`);
        hasData = Number(r[0].n) > 0;
      } catch {}
      kind = hasData ? 'legacy' : 'new';
      console.log(`[Subscription] Instalación detectada como ${kind === 'legacy' ? 'anterior (libre)' : 'nueva (hay que vincular)'}`);
    }
    if (inFile !== kind) {
      this.stored.install = { kind, at: this.stored.install?.at || new Date().toISOString() };
      this.write();
    }
    if (inDb !== kind) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO ventra_install (key, value) VALUES ('kind', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, kind).catch(() => {});
    }
  }

  private get exempt() {
    // Instalaciones alojadas (fly.io) o de desarrollo pueden excluirse del control
    return process.env.VENTRA_SUBSCRIPTION_EXEMPT === 'true';
  }

  private read(): StoredSubscription {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  private write() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.stored, null, 2));
    } catch (err: any) {
      console.error('[Subscription] No se pudo guardar el estado:', err.message);
    }
  }

  private verify(license: string, signature: string): SignedLicense | null {
    try {
      const ok = crypto.verify(null, Buffer.from(license), LICENSE_PUBLIC_KEY, Buffer.from(signature, 'base64'));
      return ok ? JSON.parse(license) : null;
    } catch {
      return null;
    }
  }

  /** Hora efectiva: nunca anterior a la última vista ni a la emisión del estado firmado. */
  private effectiveNow(license: SignedLicense): Date {
    const candidates = [Date.now(), Date.parse(license.issuedAt) || 0, Date.parse(this.stored.lastSeen || '') || 0];
    const now = Math.max(...candidates);
    if (now - this.lastPersistedSeen > 10 * 60 * 1000) {
      this.lastPersistedSeen = now;
      this.stored.lastSeen = new Date(now).toISOString();
      this.write();
    }
    return new Date(now);
  }

  getStatus(): SubscriptionStatus {
    const pending = this.stored.pending && Date.parse(this.stored.pending.expiresAt) > Date.now()
      ? { code: this.stored.pending.code, url: `${ACCOUNT_URL}?code=${this.stored.pending.code}`, expiresAt: this.stored.pending.expiresAt }
      : null;

    if (this.exempt) return { state: 'EXEMPT', enforced: false, pending };

    const license = this.stored.license && this.stored.signature ? this.verify(this.stored.license, this.stored.signature) : null;
    if (!license || license.deviceId !== this.stored.deviceId) {
      // Instalación nueva: hay que vincularla con la cuenta que pagó el plan
      if (this.stored.install?.kind === 'new') return { state: 'NEEDS_LINK', enforced: true, pending };
      return { state: 'UNLINKED', enforced: false, pending };
    }

    const linkedAt = new Date(this.stored.linkedAt || license.issuedAt);
    const { state, graceEnd, daysLeft } = computeState(license, linkedAt, this.effectiveNow(license));
    return {
      state,
      enforced: true,
      email: license.email,
      planName: license.planName,
      paidUntil: license.paidUntil,
      graceEndsAt: graceEnd.toISOString(),
      daysLeft,
      lastSyncAt: license.issuedAt,
      pending,
    };
  }

  /** Credenciales de la PC vinculada, para servicios que hablan con la nube (sincronización). */
  getDeviceCredentials(): { deviceId: string; deviceSecret: string } | null {
    if (this.exempt || !this.stored.deviceId || !this.stored.deviceSecret) return null;
    return { deviceId: this.stored.deviceId, deviceSecret: this.stored.deviceSecret };
  }

  isReadOnly(): boolean {
    const state = this.getStatus().state;
    return state === 'READ_ONLY' || state === 'NEEDS_LINK';
  }

  /** Pide un código de vinculación. La vinculación actual (si hay) sigue vigente hasta que se confirme la nueva. */
  async startLink() {
    const { data } = await axios.post(`${FUNCTIONS_URL}/ventraLinkStart`, { deviceName: os.hostname() }, { timeout: 15000 });
    this.stored.pending = {
      code: data.code,
      deviceId: data.deviceId,
      deviceSecret: data.deviceSecret,
      expiresAt: new Date(Date.now() + (data.expiresInSeconds || 900) * 1000).toISOString(),
    };
    this.write();
    return this.getStatus();
  }

  private async fetchSigned(deviceId: string, deviceSecret: string) {
    const { data } = await axios.post(`${FUNCTIONS_URL}/ventraDeviceStatus`, { deviceId, deviceSecret }, {
      timeout: 15000,
      validateStatus: (s) => s === 200 || s === 401,
    });
    return data as { linked?: boolean; license?: string; signature?: string; error?: string };
  }

  /** Sincroniza con el servidor: confirma una vinculación pendiente y actualiza el estado firmado. */
  async refresh(): Promise<SubscriptionStatus> {
    const pending = this.stored.pending;
    if (pending && Date.parse(pending.expiresAt) > Date.now() - 60 * 60 * 1000) {
      const res = await this.fetchSigned(pending.deviceId, pending.deviceSecret);
      const license = res.linked && res.license && res.signature ? this.verify(res.license, res.signature) : null;
      if (license && license.deviceId === pending.deviceId) {
        this.stored = {
          deviceId: pending.deviceId,
          deviceSecret: pending.deviceSecret,
          license: res.license,
          signature: res.signature,
          linkedAt: new Date().toISOString(),
          lastSeen: this.stored.lastSeen,
        };
        this.write();
        console.log(`[Subscription] PC vinculada a ${license.email}`);
        return this.getStatus();
      }
    }

    if (this.stored.deviceId && this.stored.deviceSecret) {
      try {
        const res = await this.fetchSigned(this.stored.deviceId, this.stored.deviceSecret);
        const license = res.linked && res.license && res.signature ? this.verify(res.license, res.signature) : null;
        if (license && license.deviceId === this.stored.deviceId) {
          this.stored.license = res.license;
          this.stored.signature = res.signature;
          this.write();
        } else if (res.linked === false || res.error) {
          // La vinculación se dio de baja en el servidor
          console.warn('[Subscription] El servidor ya no reconoce esta PC; queda sin vincular.');
          this.stored = { lastSeen: this.stored.lastSeen, pending: this.stored.pending };
          this.write();
        }
      } catch (err: any) {
        // Sin internet: se sigue usando el último estado firmado
        console.warn('[Subscription] No se pudo sincronizar:', err.message);
      }
    }
    return this.getStatus();
  }
}
