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
    await this.prisma.ensureInitialized();
    this.machineUuid = this.detectMachineUuid();
    console.log(`[LicenseService] Detected Machine UUID: ${this.machineUuid}`);
    
    // Auto-create or sync the license entry in database
    await this.syncLicenseEntry();

    // Trigger an initial online check
    this.triggerOnlineCheck().catch(() => {});

    // Run online check and heartbeat every 15 seconds
    setInterval(() => {
      this.triggerOnlineCheck().catch(() => {});
    }, 15000);
  }

  getMachineId(): string {
    return this.machineUuid;
  }

  detectMachineUuid(): string {
    try {
      if (process.platform === 'win32') {
        // 1. Try registry query first (extremely fast, ~30ms, no Antivirus blocks)
        try {
          const output = execSync('reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid').toString();
          const matches = output.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/);
          if (matches && matches[1]) {
            return matches[1].trim().toUpperCase();
          }
        } catch {
          // Fallback to next method
        }

        // 2. Try wmic (faster than powershell, ~200ms)
        try {
          const output = execSync('wmic csproduct get uuid').toString();
          const uuid = output.replace(/UUID/g, '').trim();
          if (uuid && uuid !== '00000000-0000-0000-0000-000000000000') {
            return uuid.toUpperCase();
          }
        } catch {
          // Fallback to next method
        }

        // 3. Try powershell (slowest, ~300ms to several seconds on cold start)
        try {
          const output = execSync('powershell -ExecutionPolicy Bypass -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"').toString().trim();
          if (output && output !== '00000000-0000-0000-0000-000000000000') {
            return output.toUpperCase();
          }
        } catch {
          // Fallback to next method
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
      // If the database was imported from another PC, the machineUuid won't match.
      // We must update the database's machineUuid to match the current PC so the license check works for this PC.
      if (license.machineUuid !== this.machineUuid) {
        console.log(`[LicenseService] Machine UUID mismatch (imported DB). Updating database UUID from ${license.machineUuid} to ${this.machineUuid}`);
        await this.prisma.appLicense.update({
          where: { id: 'license_config' },
          data: {
            machineUuid: this.machineUuid,
            licenseKey: "",
            expiresAt: new Date(0)
          }
        });
      } else if (!license.licenseKey) {
        // For developer testing, only force expiresAt to past if no activation key has been entered yet
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
    return {
      machineUuid: this.machineUuid,
      expiresAt: new Date(2100, 0, 1),
      isActive: true,
      isClockTampered: false,
      isDemo: false,
      lastCheckedAt: new Date()
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
    const projectId = "motocreditos-addc1";
    const cleanUuid = this.machineUuid.trim().toUpperCase();
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/customers/${cleanUuid}`;

    try {
      // 1. Fetch license status from Firestore
      const { data } = await axios.get(firestoreUrl, { timeout: 6000 });
      if (data && data.fields && data.fields.expiresAt && data.fields.expiresAt.stringValue) {
        const expirationStr = data.fields.expiresAt.stringValue;
        const newExpiry = new Date(expirationStr);
        if (!isNaN(newExpiry.getTime())) {
          const currentLicense = await this.prisma.appLicense.findUnique({ where: { id: 'license_config' } });
          if (!currentLicense || currentLicense.expiresAt.getTime() !== newExpiry.getTime()) {
            await this.prisma.appLicense.update({
              where: { id: 'license_config' },
              data: {
                expiresAt: newExpiry,
                lastCheckedAt: new Date()
              }
            });
            console.log(`[LicenseService] Online check success. Expires at: ${newExpiry}`);
          }
        }
      }

      // 2. Send heartbeat (PATCH) to Firestore
      const patchUrl = `${firestoreUrl}?updateMask.fieldPaths=lastActive&updateMask.fieldPaths=computerName&updateMask.fieldPaths=osUser`;
      const hostname = os.hostname();
      const username = os.userInfo().username;
      
      await axios.patch(patchUrl, {
        fields: {
          lastActive: { stringValue: new Date().toISOString() },
          computerName: { stringValue: hostname },
          osUser: { stringValue: username }
        }
      }, { timeout: 6000 });

    } catch (e: any) {
      // Ignore network errors, keep offline access
      console.warn('[LicenseService] Online check/heartbeat failed:', e.message);
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

  private generateActivationCodeForType(machineUuid: string, type: '1W' | '1M' | 'DEMO' | 'LIFETIME', period: string): string {
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

    // 1. Check if it is a universal key (starts with U, W, D, or L, length 12)
    if ((cleanCode.startsWith('U') || cleanCode.startsWith('W') || cleanCode.startsWith('D') || cleanCode.startsWith('L')) && cleanCode.length === 12) {
      const typeChar = cleanCode.charAt(0);
      const keyId = cleanCode.substring(1, 6);
      const sig = cleanCode.substring(6, 12);
      
      let typeStr = '1M';
      if (typeChar === 'W') {
        typeStr = '1W';
      } else if (typeChar === 'D') {
        typeStr = 'DEMO';
      } else if (typeChar === 'L') {
        typeStr = 'LIFETIME';
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
        } else if (typeChar === 'L') {
          newExpiry = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 years
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

    // 4. Check Lifetime Key (LIFETIME) - checks a fixed period "PERMANENT"
    if (!newExpiry) {
      const expected = this.generateActivationCodeForType(this.machineUuid, 'LIFETIME', 'PERMANENT');
      if (expected.replace(/[^A-Z0-9]/g, '') === cleanCode) {
        newExpiry = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 years duration
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

      // No restrict universal keys reuse on the same computer
      if (isUniversal && !usedUniversal.includes(cleanCode)) {
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

      // Automatically register/update this PC in Firestore so it appears on the admin dashboard
      this.registerDeviceInFirestore(this.machineUuid, newExpiry, cleanCode).catch(() => {});

      return true;
    }

    return false;
  }

  async registerDeviceInFirestore(machineUuid: string, expiresAt: Date, licenseKey: string) {
    const projectId = "motocreditos-addc1";
    const cleanUuid = machineUuid.trim().toUpperCase();
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/customers/${cleanUuid}`;

    try {
      const hostname = os.hostname();
      const username = os.userInfo().username;
      
      // We use PATCH to create or update the document in Firestore
      const patchUrl = `${firestoreUrl}?updateMask.fieldPaths=name&updateMask.fieldPaths=uuid&updateMask.fieldPaths=expiresAt&updateMask.fieldPaths=licenseKey&updateMask.fieldPaths=lastActive&updateMask.fieldPaths=computerName&updateMask.fieldPaths=osUser&updateMask.fieldPaths=createdAt`;
      
      await axios.patch(patchUrl, {
        fields: {
          name: { stringValue: `${username}@${hostname}` },
          uuid: { stringValue: cleanUuid },
          expiresAt: { stringValue: expiresAt.toISOString() },
          licenseKey: { stringValue: licenseKey },
          lastActive: { stringValue: new Date().toISOString() },
          computerName: { stringValue: hostname },
          osUser: { stringValue: username },
          createdAt: { stringValue: new Date().toISOString() }
        }
      }, { timeout: 6000 });
      console.log(`[LicenseService] Device auto-registered in Firestore: ${cleanUuid}`);
    } catch (e: any) {
      console.warn('[LicenseService] Failed to auto-register device in Firestore:', e.message);
    }
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
