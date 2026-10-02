import { Module } from '@nestjs/common';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoService } from './mercadopago.service';
import { MpAlertsService } from './mp-alerts.service';

@Module({
  controllers: [MercadoPagoController],
  providers: [MercadoPagoService, MpAlertsService],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
