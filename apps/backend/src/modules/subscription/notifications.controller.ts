import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../database/prisma.service';

/** Campanita del POS / admin: historial de avisos de esta PC y estado en vivo. */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const [items, unread, lowStock] = await Promise.all([
      this.prisma.appNotification.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.appNotification.count({ where: { readAt: null } }),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n FROM products WHERE is_active = 1 AND unlimited_stock = 0 AND min_stock > 0 AND stock <= min_stock;`,
      ),
    ]);
    // Vencimientos en vivo (no esperan al aviso diario)
    const lots = await this.prisma.productLot.findMany({
      where: { status: 'ACTIVE', product: { trackExpiry: true, isActive: true } },
      select: { expiresAt: true, product: { select: { expiryAlertDays: true } } },
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let expired = 0, soon = 0;
    for (const l of lots) {
      const d = new Date(l.expiresAt); d.setHours(0, 0, 0, 0);
      const days = Math.round((d.getTime() - today.getTime()) / 86400000);
      if (days < 0) expired++;
      else if (days <= (l.product.expiryAlertDays ?? 7)) soon++;
    }
    return { items, unread, live: { expired, soon, lowStock: Number(lowStock[0]?.n) || 0 } };
  }

  @Post('read-all')
  async readAll() {
    await this.prisma.appNotification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post(':id/read')
  async read(@Param('id') id: string) {
    await this.prisma.appNotification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
