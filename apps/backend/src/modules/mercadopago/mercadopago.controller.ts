import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { MercadoPagoService } from './mercadopago.service';
import { MpAlertsService } from './mp-alerts.service';

@Controller('mercadopago')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MercadoPagoController {
  constructor(private readonly mp: MercadoPagoService, private readonly alerts: MpAlertsService) {}

  // ── Conexión de la cuenta y configuración de la maquinita (solo administradores) ──

  @Get('status')
  status() {
    return this.mp.status();
  }

  @Post('connect')
  @Roles('ADMIN')
  connect() {
    return this.mp.start();
  }

  @Post('disconnect')
  @Roles('ADMIN')
  disconnect() {
    return this.mp.disconnect();
  }

  @Post('settings')
  @Roles('ADMIN')
  settings(@Body() body: { countTransfers?: boolean }) {
    return this.mp.settings(typeof body?.countTransfers === 'boolean' ? { countTransfers: body.countTransfers } : {});
  }

  /** La caja informa qué medios de pago son Mercado Pago (para el aviso de pagos sin venta). */
  @Post('local-methods')
  async localMethods(@Body() body: { methods?: string[] }) {
    await this.alerts.setMpMethods(Array.isArray(body?.methods) ? body.methods : []);
    return { ok: true };
  }

  @Get('terminals')
  @Roles('ADMIN')
  terminals() {
    return this.mp.terminals();
  }

  @Post('terminals/pdv')
  @Roles('ADMIN')
  setPdv(@Body() body: { terminalId?: string }) {
    if (!body?.terminalId) throw new BadRequestException('Falta la maquinita');
    return this.mp.setPdv(String(body.terminalId));
  }

  // ── Cobro en la maquinita (cualquier cajero) ──

  @Post('point/charge')
  charge(@Body() body: { terminalId?: string; amount?: number; externalReference?: string; description?: string }) {
    const amount = Number(body?.amount);
    if (!body?.terminalId) throw new BadRequestException('Esta caja no tiene una maquinita elegida');
    if (!(amount > 0)) throw new BadRequestException('Monto inválido');
    return this.mp.charge(String(body.terminalId), amount, String(body.externalReference || ''), body.description);
  }

  @Get('point/orders/:id')
  order(@Param('id') id: string) {
    return this.mp.order(id);
  }

  @Post('point/orders/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.mp.cancel(id);
  }

  // ── Cierre de caja: pagos reales de Mercado Pago contra las ventas ──

  @Get('reconcile/:sessionId')
  reconcile(@Param('sessionId') sessionId: string, @Query('mpMethods') mpMethods?: string) {
    return this.mp.reconcile(sessionId, String(mpMethods || '').split(',').map((m) => m.trim()).filter(Boolean));
  }

  @Post('reconcile/fix')
  fix(@Request() req, @Body() body: { paymentRowId?: string; action?: string; mpPaymentId?: string; method?: string; mpMethods?: string[] }) {
    return this.mp.fix(req.user.sub, body || {});
  }
}
