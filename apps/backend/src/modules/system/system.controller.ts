import { Controller, Get, Post, UseGuards, BadRequestException } from '@nestjs/common';
import * as os from 'os';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { DemoResetService } from './demo-reset.service';

@Controller('system')
export class SystemController {
  constructor(private prisma: PrismaService, private demoResetService: DemoResetService) {}

  // Manual trigger for the public demo's sample data reset — lets an admin
  // refresh the demo (e.g. after updating DEMO_PRODUCTS) without waiting for
  // the 6-hour cron. No-ops outside DEMO_MODE.
  @Post('demo-reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async triggerDemoReset() {
    if (process.env.DEMO_MODE !== 'true') {
      throw new BadRequestException('Demo mode is not enabled on this instance.');
    }
    await this.demoResetService.resetAndSeed();
    return { success: true };
  }

  @Get('info')
  getSystemInfo() {
    const interfaces = os.networkInterfaces();
    const candidates: string[] = [];

    for (const name of Object.keys(interfaces)) {
      const lowerName = name.toLowerCase();
      // Skip virtual interfaces commonly created by Docker, WSL, VirtualBox, VMware, etc.
      if (
        lowerName.includes('virtual') || 
        lowerName.includes('vbox') || 
        lowerName.includes('virtualbox') || 
        lowerName.includes('vmware') || 
        lowerName.includes('wsl') || 
        lowerName.includes('docker') || 
        lowerName.includes('vethernet') ||
        lowerName.includes('loopback')
      ) {
        continue;
      }

      for (const iface of interfaces[name]!) {
        // Skip internal (127.0.0.1) and non-ipv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          // Skip APIPA link-local addresses (169.254.x.x)
          if (!iface.address.startsWith('169.254.')) {
            candidates.push(iface.address);
          }
        }
      }
    }

    // Choose the best candidate: prioritize standard home/office networks (192.168.* or 10.* or 172.*)
    let localIp = 'localhost';
    if (candidates.length > 0) {
      const wifiOrLan = candidates.find(ip => ip.startsWith('192.168.'));
      if (wifiOrLan) {
        localIp = wifiOrLan;
      } else {
        const otherPrivate = candidates.find(ip => ip.startsWith('10.') || ip.startsWith('172.'));
        if (otherPrivate) {
          localIp = otherPrivate;
        } else {
          localIp = candidates[0];
        }
      }
    } else {
      // Fallback: search including virtual and link-local if nothing else exists
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIp = iface.address;
            break;
          }
        }
        if (localIp !== 'localhost') break;
      }
    }

    const tailscaleIps: string[] = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]!) {
        if (iface.family === 'IPv4' && !iface.internal) {
          if (iface.address.startsWith('100.')) {
            tailscaleIps.push(iface.address);
          }
        }
      }
    }
    const tailscaleIp = tailscaleIps.length > 0 ? tailscaleIps[0] : null;

    return {
      localIp,
      tailscaleIp,
      // Puerto donde otro dispositivo encuentra la interfaz (producción: este backend; desarrollo: Vite)
      uiPort: Number(process.env.UI_PORT) || Number(process.env.PORT) || 3001,
      serverTime: new Date(),
      platform: os.platform(),
      arch: os.arch(),
      isDemo: process.env.DEMO_MODE === 'true',
    };
  }

  @Post('hard-reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async hardReset() {
    console.log('[SystemController] Starting DATABASE HARD RESET...');
    
    const tables = [
      'auditLog',
      'priceHistory',
      'inventoryMovement',
      'purchaseItem',
      'purchase',
      'supplierPayment',
      'cashMovement',
      'accountMovement',
      'payment',
      'saleItem',
      'sale',
      'cashRegisterSession',
      'dailyZReport',
      'productBarcode',
      'promotionProduct',
      'promotion',
      'marketingGroupItem',
      'marketingGroup',
      'product',
      'category',
      'brand',
      'supplier',
      'client'
    ];

    for (const table of tables) {
      try {
        if ((this.prisma as any)[table]) {
          await (this.prisma as any)[table].deleteMany({});
        }
      } catch (err: any) {
        console.warn(`[SystemController] Failed to delete table ${table}:`, err.message);
      }
    }

    try {
      await this.prisma.$executeRawUnsafe('DELETE FROM sqlite_sequence;');
      console.log('[SystemController] SQLite auto-increment sequences reset successfully.');
    } catch (err: any) {
      console.warn('[SystemController] Failed to reset sqlite_sequence:', err.message);
    }

    // Se borran TODOS los usuarios: al volver a entrar aparece "Crear administrador", igual
    // que en una instalación nueva. Antes quedaba un ADMIN con clave 1234 que nadie conocía
    // y parecía que el sistema no tenía usuarios.
    try {
      await this.prisma.user.deleteMany({});
    } catch (err: any) {
      console.warn('[SystemController] Failed to delete users:', err.message);
    }

    console.log('[SystemController] DATABASE HARD RESET completed.');
    return { success: true, message: 'La base de datos ha sido reseteada por completo.' };
  }
}
