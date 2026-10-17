import { Controller, Get, Put, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PreOrdersService } from './preorders.service';

/** Pedidos de preventa (distribuidora). Ver PreOrdersService. */
@Controller('preorders')
@UseGuards(AuthGuard('jwt'))
export class PreOrdersController {
  constructor(private preOrders: PreOrdersService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('clientId') clientId?: string,
    @Query('locality') locality?: string,
    @Query('mine') mine?: string,
    @Query('unassigned') unassigned?: string,
    @Request() req?: any,
  ) {
    return this.preOrders.list({ status, from, to, clientId, locality, userId: mine === '1' ? req?.user?.sub : undefined, unassigned: unassigned === '1' });
  }

    /** Unidades de cada producto que ya están en pedidos pendientes (todavía no salieron) */
    @Get('committed')
  committed() {
    return this.preOrders.committed();
  }

  /** El último pedido de cada cliente (para "Repetir el último pedido", también sin señal) */
  @Get('last-by-client')
  lastByClient() {
    return this.preOrders.lastByClient();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.preOrders.findOne(id);
  }

  /** Crea o corrige un pedido. El id lo pone el celular: repetir el envío no lo duplica. */
  @Put(':id')
  save(@Param('id') id: string, @Body() data: any, @Request() req: any) {
        return this.preOrders.save(id, data, req.user?.sub, req.user?.role === 'ADMIN');
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.preOrders.cancel(id);
  }
}
