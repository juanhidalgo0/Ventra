import { Controller, Get, Post, UseGuards, ServiceUnavailableException } from '@nestjs/common';
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

  @Post('refresh')
  refresh() {
    return this.subscription.refresh();
  }
}
