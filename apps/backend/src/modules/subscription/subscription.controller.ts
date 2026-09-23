import { Controller, Get, Post, Body, UseGuards, ServiceUnavailableException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(private subscription: SubscriptionService) {}

  @Get('status')
  status() {
    return this.subscription.getStatus();
  }

  @Post('link/start')
  async startLink() {
    try {
      return await this.subscription.startLink();
    } catch {
      throw new ServiceUnavailableException('No hay conexión con ventra.store. Revisá internet y probá de nuevo.');
    }
  }

  /** Sesión de la cuenta para la tienda online. { linked: false } si esta instalación no está vinculada. */
  @Post('store-session')
  async storeSession(@Body() body: { legacyStoreId?: string; legacyIdToken?: string }) {
    try {
      const session = await this.subscription.storeSession({
        legacyStoreId: typeof body?.legacyStoreId === 'string' ? body.legacyStoreId : undefined,
        legacyIdToken: typeof body?.legacyIdToken === 'string' ? body.legacyIdToken : undefined,
      });
      return session ? { linked: true, ...session } : { linked: false };
    } catch {
      throw new ServiceUnavailableException('No se pudo conectar con la tienda online. Revisá internet y probá de nuevo.');
    }
  }

  @Post('refresh')
  refresh() {
    return this.subscription.refresh();
  }
}
