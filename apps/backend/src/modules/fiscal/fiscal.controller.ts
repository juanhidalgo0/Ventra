import { Body, Controller, Get, Param, Post, Patch, Query, UseGuards } from '@nestjs/common';
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

  /** Prueba de conexión: no emite ningún comprobante. */
  @Post('test')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  test() {
    return this.fiscal.testConnection();
  }

  /** Factura una venta ya cobrada. Los datos del receptor son opcionales: sin ellos va consumidor final. */
  @Post('sales/:saleId/invoice')
  invoiceSale(@Param('saleId') saleId: string, @Body() body: any) {
    return this.fiscal.invoiceSale(saleId, body);
  }

  @Get('sales/:saleId/invoice')
  getInvoice(@Param('saleId') saleId: string) {
    return this.fiscal.getInvoice(saleId);
  }

  /** Ventas con su estado fiscal, para la pantalla de facturación. */
  @Get('sales')
  listSales(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.fiscal.listSales({ status, limit: limit ? Number(limit) : 50 });
  }

  /** Reintenta las ventas que quedaron sin CAE (sin internet o ARCA caído). */
  @Post('pending/process')
  processPending(@Query('limit') limit?: string) {
    return this.fiscal.processPending(limit ? Number(limit) : 20);
  }
}
