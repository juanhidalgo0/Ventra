import { Controller, Get, Put, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WorkOrdersService } from './workorders.service';

/**
 * Encargos (imprenta y trabajos a pedido). Ver WorkOrdersService.
 * Qué puede hacer cada uno depende de su rol (Mostrador, Taller, Diseño): lo controla el servicio.
 */
@Controller('work-orders')
@UseGuards(AuthGuard('jwt'))
export class WorkOrdersController {
  constructor(private orders: WorkOrdersService) {}

  @Get()
  list(@Request() req: any, @Query('status') status?: string, @Query('search') search?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('clientId') clientId?: string) {
    return this.orders.list({ status, search, from, to, clientId }, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.orders.findForUser(id, req.user);
  }

  /** Crea o corrige un encargo. El id lo pone la pantalla: repetir el envío no lo duplica. */
  @Put(':id')
  save(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.orders.save(id, data, req.user);
  }

  @Post(':id/status')
  setStatus(@Param('id') id: string, @Body('status') status: string, @Request() req: any) {
    return this.orders.setStatus(id, status, req.user);
  }

  /** Notas del trabajo y detalle de cada ítem (lo que corrige Diseño) */
  @Post(':id/notes')
  notes(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.orders.updateNotes(id, data, req.user);
  }

  @Post(':id/notified')
  notified(@Param('id') id: string, @Request() req: any) {
    return this.orders.markNotified(id, req.user);
  }

  /** Seña o pago a cuenta antes de entregar */
  @Post(':id/collect')
  collect(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.orders.collect(id, data, req.user);
  }

  @Post(':id/deliver')
  deliver(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.orders.deliver(id, data, req.user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.orders.cancel(id, data, req.user);
  }
}
