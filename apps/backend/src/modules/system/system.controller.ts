import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import * as os from 'os';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('system')
export class SystemController {
  constructor(private prisma: PrismaService) {}

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
      serverTime: new Date(),
      platform: os.platform(),
      arch: os.arch(),
    };
  }

  @Post('hard-reset')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async hardReset() {
    console.log('[SystemController] Starting DATABASE HARD RESET...');
    await this.prisma.$transaction(async (tx) => {
      // 1. Audit logs
      await tx.auditLog.deleteMany({});
      
      // 2. Price History
      await tx.priceHistory.deleteMany({});
      
      // 3. Inventory movements
      await tx.inventoryMovement.deleteMany({});
      
      // 4. Purchase items and Purchases
      await tx.purchaseItem.deleteMany({});
      await tx.purchase.deleteMany({});
      
      // 5. Supplier payments
      await tx.supplierPayment.deleteMany({});
      
      // 6. Cash movements
      await tx.cashMovement.deleteMany({});
      
      // 7. Account movements
      await tx.accountMovement.deleteMany({});
      
      // 8. Payments, sale items, sales
      await tx.payment.deleteMany({});
      await tx.saleItem.deleteMany({});
      await tx.sale.deleteMany({});
      
      // 9. Cash register sessions and Daily Z Reports
      await tx.cashRegisterSession.deleteMany({});
      await tx.dailyZReport.deleteMany({});
      
      // 10. Product barcodes, promotion products, promotions, marketing groups, products
      await tx.productBarcode.deleteMany({});
      await tx.promotionProduct.deleteMany({});
      await tx.promotion.deleteMany({});
      await tx.marketingGroupItem.deleteMany({});
      await tx.marketingGroup.deleteMany({});
      await tx.product.deleteMany({});
      
      // 11. Categories, brands, suppliers, clients
      await tx.category.deleteMany({});
      await tx.brand.deleteMany({});
      await tx.supplier.deleteMany({});
      await tx.client.deleteMany({});
      
      // 12. Delete all users except 'admin'
      await tx.user.deleteMany({
        where: {
          NOT: {
            username: 'ADMIN',
          },
        },
      });

      // 13. Create or reset the default admin user with password '1234'
      const adminPasswordHash = await bcrypt.hash('1234', 10);
      
      const existingAdmin = await tx.user.findFirst({
        where: {
          username: 'ADMIN',
        },
      });

      if (existingAdmin) {
        await tx.user.update({
          where: { id: existingAdmin.id },
          data: {
            passwordHash: adminPasswordHash,
            fullName: 'ADMIN',
            role: 'ADMIN',
            isActive: true,
          },
        });
      } else {
        await tx.user.create({
          data: {
            username: 'ADMIN',
            passwordHash: adminPasswordHash,
            fullName: 'ADMIN',
            role: 'ADMIN',
            isActive: true,
          },
        });
      }
    });

    console.log('[SystemController] DATABASE HARD RESET completed successfully.');
    return { success: true, message: 'La base de datos ha sido reseteada por completo.' };
  }
}
