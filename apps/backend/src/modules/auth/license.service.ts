import { Injectable, OnModuleInit, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';
import * as os from 'os';
import { execSync } from 'child_process';
import axios from 'axios';

const SECRET_WORD = 'paulos-pos-license-key-lock-2026';

@Injectable()
export class LicenseService implements OnModuleInit {
  private machineUuid: string = '';

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    this.machineUuid = this.detectMachineUuid();
    console.log(`[LicenseService] Detected Machine UUID: ${this.machineUuid}`);
    
    // Auto-create or sync the license entry in database
    await this.syncLicenseEntry();

    // Trigger an asynchronous online check if internet is available
    this.triggerOnlineCheck().catch(() => {});
  }

  getMachineId(): string {
    return this.machineUuid;
  }

  detectMachineUuid(): string {
    try {
      if (process.platform === 'win32') {
        try {
          const output = execSync('powershell -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"').toString().trim();
          if (output && output !== '00000000-0000-0000-0000-000000000000') {
            return output;
          }
        } catch {
          const output = execSync('wmic csproduct get uuid').toString();
          const uuid = output.replace(/UUID/g, '').trim();
          if (uuid && uuid !== '00000000-0000-0000-0000-000000000000') {
            return uuid;
          }
        }
      }
    } catch (e) {
      // Ignore and fallback
    }

    try {
      const interfaces = os.networkInterfaces();
      const macs: string[] = [];
      for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name] || []) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            macs.push(net.mac);
          }
        }
      }
      const rawString = macs.sort().join('|') + '|' + os.hostname();
      return crypto.createHash('sha256').update(rawString).digest('hex').substring(0, 16).toUpperCase();
    } catch {
      return 'FALLBACK-UUID-KEY';
    }
  }

  async syncLicenseEntry() {
    const license = await this.prisma.appLicense.findUnique({
      where: { id: 'license_config' }
    });

    if (!license) {
      // First install: block by default (expires in the past)
      const expiresAt = new Date(0); // Epoch

      await this.prisma.appLicense.create({
        data: {
          id: 'license_config',
          machineUuid: this.machineUuid,
          expiresAt
        }
      });
    } else {
      // For developer testing, only force expiresAt to past if no activation key has been entered yet
      if (!license.licenseKey) {
        await this.prisma.appLicense.update({
          where: { id: 'license_config' },
          data: {
            expiresAt: new Date(0)
          }
        });
      }
    }
  }

  async getLicenseStatus() {
    const license = await this.prisma.appLicense.findUnique({
      where: { id: 'license_config' }
    });

    const isExpired = license ? new Date() > new Date(license.expiresAt) : true;
    const isClockTampered = await this.checkClockTampering();

    let isDemo = false;
    if (license && license.licenseKey) {
      try {
        const parsed = JSON.parse(license.licenseKey);
        isDemo = !!parsed.isDemo;
      } catch {}
    }

    return {
      machineUuid: this.machineUuid,
      expiresAt: license ? license.expiresAt : new Date(),
      isActive: !isExpired && !isClockTampered,
      isClockTampered,
      isDemo,
      lastCheckedAt: license ? license.lastCheckedAt : new Date()
    };
  }

  async checkClockTampering(): Promise<boolean> {
    try {
      // Find the latest completed sale
      const lastSale = await this.prisma.sale.findFirst({
        orderBy: { createdAt: 'desc' }
      });
      if (lastSale && new Date() < new Date(lastSale.createdAt)) {
        // System time is set before the last registered sale! Clock tampered.
        return true;
      }
    } catch {}
    return false;
  }

  async triggerOnlineCheck() {
    const licenseCheckUrl = process.env.LICENSE_CHECK_URL;
    if (!licenseCheckUrl) return;

    try {
      const { data } = await axios.get(licenseCheckUrl, { timeout: 6000 });
      if (data && data[this.machineUuid]) {
        const expirationStr = data[this.machineUuid];
        const newExpiry = new Date(expirationStr);
        if (!isNaN(newExpiry.getTime())) {
          await this.prisma.appLicense.update({
            where: { id: 'license_config' },
            data: {
              expiresAt: newExpiry,
              lastCheckedAt: new Date()
            }
          });
        }
      }
    } catch (e) {
      // Ignore network errors, keep offline access
    }
  }

  private getYearWeek(date: Date): string {
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
    }
    const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    return `${target.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  private getYearMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private generateActivationCodeForType(machineUuid: string, type: '1W' | '1M' | 'DEMO', period: string): string {
    const input = `${machineUuid.trim().toUpperCase()}-${type}-${period}-${SECRET_WORD}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex').toUpperCase();
    const part1 = hash.substring(0, 4);
    const part2 = hash.substring(4, 8);
    const part3 = hash.substring(8, 12);
    return `${part1}-${part2}-${part3}`;
  }

  private generateActivationCode(machineUuid: string, yearMonth: string): string {
    const input = `${machineUuid}-${yearMonth}-${SECRET_WORD}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex').toUpperCase();
    const part1 = hash.substring(0, 4);
    const part2 = hash.substring(4, 8);
    const part3 = hash.substring(8, 12);
    return `${part1}-${part2}-${part3}`;
  }

  async activateWithCode(code: string): Promise<boolean> {
    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const today = new Date();
    let newExpiry: Date | null = null;
    let isUniversal = false;
    let isDemo = false;

    // 1. Check if it is a universal key (starts with U, W, or D, length 12)
    if ((cleanCode.startsWith('U') || cleanCode.startsWith('W') || cleanCode.startsWith('D')) && cleanCode.length === 12) {
      const typeChar = cleanCode.charAt(0);
      const keyId = cleanCode.substring(1, 6);
      const sig = cleanCode.substring(6, 12);
      
      let typeStr = '1M';
      if (typeChar === 'W') {
        typeStr = '1W';
      } else if (typeChar === 'D') {
        typeStr = 'DEMO';
      }
      
      const input = `UNIVERSAL-${typeStr}-${keyId}-${SECRET_WORD}`;
      const expectedSig = crypto.createHash('sha256').update(input).digest('hex').substring(0, 6).toUpperCase();

      if (sig === expectedSig) {
        isUniversal = true;
        if (typeChar === 'W' || typeChar === 'D') {
          newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
          if (typeChar === 'D') {
            isDemo = true;
          }
        } else {
          newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        }
      }

      // Legacy universal key fallback (starts with U, uses old hash format)
      if (!isUniversal && typeChar === 'U') {
        const legacyInput = `UNIVERSAL-${keyId}-${SECRET_WORD}`;
        const legacyExpectedSig = crypto.createHash('sha256').update(legacyInput).digest('hex').substring(0, 6).toUpperCase();
        if (sig === legacyExpectedSig) {
          isUniversal = true;
          newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }
      }
    }

    // 2. Check 1 Week Key (1W) - checks last week, current week, and next 2 weeks
    if (!newExpiry) {
      for (let i = -1; i <= 2; i++) {
        const checkDate = new Date();
        checkDate.setDate(today.getDate() + i * 7);
        const period = this.getYearWeek(checkDate);
        const expected = this.generateActivationCodeForType(this.machineUuid, '1W', period);
        if (expected.replace(/[^A-Z0-9]/g, '') === cleanCode) {
          newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days duration
          break;
        }
      }
    }

    // 3. Check Demo Key (DEMO) - checks last week, current week, and next 2 weeks
    if (!newExpiry) {
      for (let i = -1; i <= 2; i++) {
        const checkDate = new Date();
        checkDate.setDate(today.getDate() + i * 7);
        const period = this.getYearWeek(checkDate);
        const expected = this.generateActivationCodeForType(this.machineUuid, 'DEMO', period);
        if (expected.replace(/[^A-Z0-9]/g, '') === cleanCode) {
          newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days duration
          isDemo = true;
          break;
        }
      }
    }

    // 3. Check 1 Month Key (1M) - checks last month, current month, and next 2 months
    if (!newExpiry) {
      for (let i = -1; i <= 2; i++) {
        const checkDate = new Date();
        checkDate.setMonth(today.getMonth() + i);
        const period = this.getYearMonth(checkDate);
        const expected = this.generateActivationCodeForType(this.machineUuid, '1M', period);
        if (expected.replace(/[^A-Z0-9]/g, '') === cleanCode) {
          newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days duration
          break;
        }
      }
    }

    // 4. Check legacy monthly code format (backward compatibility)
    if (!newExpiry) {
      for (let i = 0; i < 12; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        
        const expectedCode = this.generateActivationCode(this.machineUuid, yearMonth);
        if (expectedCode.replace(/[^A-Z0-9]/g, '') === cleanCode) {
          newExpiry = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
          break;
        }
      }
    }

    if (newExpiry) {
      const license = await this.prisma.appLicense.findUnique({
        where: { id: 'license_config' }
      });

      let usedUniversal: string[] = [];
      if (license && license.licenseKey) {
        try {
          const parsed = JSON.parse(license.licenseKey);
          if (parsed && Array.isArray(parsed.usedUniversal)) {
            usedUniversal = parsed.usedUniversal;
          }
        } catch {
          // Backward compatibility: not a JSON string, ignore
        }
      }

      if (isUniversal) {
        if (usedUniversal.includes(cleanCode)) {
          throw new BadRequestException('Esta clave de prueba ya fue utilizada en esta computadora');
        }
        usedUniversal.push(cleanCode);
      }

      const saveData = JSON.stringify({
        key: cleanCode,
        usedUniversal,
        isDemo
      });

      await this.prisma.appLicense.update({
        where: { id: 'license_config' },
        data: {
          licenseKey: saveData,
          expiresAt: newExpiry,
          lastCheckedAt: new Date()
        }
      });
      return true;
    }

    return false;
  }

  async devResetLicense() {
    await this.prisma.appLicense.upsert({
      where: { id: 'license_config' },
      update: {
        licenseKey: '',
        expiresAt: new Date(0),
      },
      create: {
        id: 'license_config',
        licenseKey: '',
        expiresAt: new Date(0),
        machineUuid: this.machineUuid
      }
    });
  }
}
