import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, Query } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

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
  addPayment(@Param('id') id: string, @Body() data: any, @Request() req: any) {
    return this.suppliersService.addPayment({ ...data, supplierId: id, userId: req.user.sub });
  }
}
