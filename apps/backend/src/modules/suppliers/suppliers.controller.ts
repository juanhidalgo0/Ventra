import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private suppliersService: SuppliersService, private cash: CashRegisterService) {}

  @Get()
  findAll(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.suppliersService.findAll(startDate, endDate);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.suppliersService.findOne(id, startDate, endDate);
  }

  @Post()
  create(@Body() data: any) {
    return this.suppliersService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.suppliersService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }

  @Post(':id/payments')
  async addPayment(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    const { cashSource, userId: _u, ...rest } = data || {};
    // Primero sale la plata (si la caja no sirve, no queda un pago anotado sin descontar)
    const supplier = await this.suppliersService.findOne(id).catch(() => null);
    await this.cash.payOut(req.user.sub, req.user.role, cashSource, Number(rest.amount), `${(supplier as any)?.name || 'Proveedor'}${rest.reference ? ` · ${rest.reference}` : ''}`);
    return this.suppliersService.addPayment({ ...rest, amount: Number(rest.amount), supplierId: id, userId: req.user.sub });
  }
}
