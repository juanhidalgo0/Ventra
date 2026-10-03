import { Body, Controller, Get, Header, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { FiscalService } from './fiscal.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('fiscal')
@UseGuards(JwtAuthGuard)
export class FiscalController {
  constructor(private fiscal: FiscalService) {}

  @Get('config')
  getConfig() {
    return this.fiscal.getConfig();
  }

  @Patch('config')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  updateConfig(@Body() data: any) {
    return this.fiscal.updateConfig(data);
  }

  /** Revisa conexión, autorización en ARCA y punto de venta. No emite ningún comprobante. */
  @Post('test')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  test() {
    return this.fiscal.testConnection();
  }

  /** Factura una venta ya cobrada. Los datos del receptor son opcionales: sin ellos va consumidor final. */
  @Post('sales/:saleId/invoice')
  invoiceSale(@Param('saleId') saleId: string, @Body() body: any, @Request() req: any) {
    return this.fiscal.invoiceSale(saleId, body || {}, req.user?.sub);
  }

  /** Comprobantes de una venta (la factura vigente y su historia). */
  @Get('sales/:saleId/invoice')
  getSaleFiscal(@Param('saleId') saleId: string) {
    return this.fiscal.getSaleFiscal(saleId);
  }

  /** Ventas cobradas que no tienen factura. */
  @Get('uninvoiced')
  uninvoiced(@Query('from') from?: string, @Query('to') to?: string, @Query('limit') limit?: string) {
    return this.fiscal.listUninvoiced({ from, to, limit: limit ? Number(limit) : undefined });
  }

  @Get('documents')
  listDocuments(
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.fiscal.listDocuments({ status, kind, from, to, search, limit: limit ? Number(limit) : undefined });
  }

  /** Libro de comprobantes autorizados, para el contador (CSV que abre Excel). */
  @Get('documents/export')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  exportCsv(@Query('from') from?: string, @Query('to') to?: string) {
    return this.fiscal.exportCsv({ from, to });
  }

  @Get('documents/:id')
  getDocument(@Param('id') id: string) {
    return this.fiscal.documentViewById(id);
  }

  /** Reintenta un comprobante en cola o rechazado (con los datos del cliente corregidos, si vienen). */
  @Post('documents/:id/retry')
  retry(@Param('id') id: string, @Body() body: any) {
    return this.fiscal.retryDocument(id, body || {});
  }

  /** Anula una factura autorizada con su nota de crédito. */
  @Post('documents/:id/credit-note')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  creditNote(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.fiscal.creditNote(id, body?.reason, req.user?.sub);
  }

  /** Pasa a esta caja un comprobante en cola de otra caja que no va a volver. */
  @Post('documents/:id/take-over')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  takeOver(@Param('id') id: string) {
    return this.fiscal.takeOver(id);
  }

  /** Procesa ya la cola de esta caja (sin esperar al próximo reintento). */
  @Post('queue/process')
  processQueue() {
    return this.fiscal.processQueue();
  }
}
