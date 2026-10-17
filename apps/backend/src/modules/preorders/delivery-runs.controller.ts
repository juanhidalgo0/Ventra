import { Controller, Get, Post, Patch, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DeliveryRunsService } from './delivery-runs.service';
import { TodayService } from './today.service';

/** Repartos: qué pedidos salen en cada camión, con su hoja de carga y de ruta. */
@Controller('delivery-runs')
@UseGuards(AuthGuard('jwt'))
export class DeliveryRunsController {
  constructor(private runs: DeliveryRunsService, private today: TodayService) {}

  /** Pantalla "Hoy": pedidos por zona, repartos activos y la plata del día */
  @Get('today')
  todaySummary() {
    return this.today.summary();
  }

    @Get()
  list(@Query('status') status?: string, @Query('driver') driver?: string, @Request() req?: any) {
    return this.runs.list(status, driver === 'me' ? req?.user?.sub : undefined);
  }

  /** Quiénes pueden manejar: los usuarios activos (los choferes primero) */
  @Get('drivers')
  drivers() {
    return this.runs.drivers();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.runs.findOne(id);
  }

  @Post()
  create(@Body() data: any) {
    return this.runs.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.runs.update(id, data);
  }

  /** Las paradas del reparto, en orden: los pedidos que no vienen salen del reparto */
  @Put(':id/stops')
  setStops(@Param('id') id: string, @Body('orderIds') orderIds: string[]) {
    return this.runs.setStops(id, orderIds);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.runs.remove(id);
  }

  /** Lo que pasó en una parada: qué se entregó y cómo pagó (se puede corregir hasta la rendición) */
  @Put(':id/stops/:orderId/delivery')
  saveDelivery(@Param('id') id: string, @Param('orderId') orderId: string, @Body() data: any) {
    return this.runs.saveDelivery(id, orderId, data);
  }

  /** "Salió a reparto": los pedidos quedan como ventas a cuenta, sale el stock y la factura queda en cola */
  @Post(':id/dispatch')
  dispatch(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.runs.dispatch(id, data, req.user?.sub);
  }

  /** Varias paradas de una vez: entregadas completas y pagadas todas igual */
  @Put(':id/deliveries')
  saveMany(@Param('id') id: string, @Body() data: any) {
    return this.runs.saveManyDelivered(id, data?.orderIds, data?.payment);
  }

  /** Rendición: cada entrega queda como venta en la caja abierta y el reparto se cierra */
  @Post(':id/settle')
  settle(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.runs.settle(id, data, req.user?.sub);
  }
}
