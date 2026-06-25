import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { SalesService } from './sales.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Post()
  create(@Request() req, @Body() dto: any) { return this.salesService.create(req.user.sub, dto); }

  @Get()
  findAll(@Query('sessionId') sessionId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('paymentMethod') paymentMethod?: string, @Query('limit') limit?: string) {
    return this.salesService.findAll({ sessionId, from, to, paymentMethod, limit: limit ? parseInt(limit) : undefined });
  }

  @Get('today-summary')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getTodaySummary(@Query('from') from?: string, @Query('to') to?: string) { return this.salesService.getTodaySummary(from, to); }

  @Get('dashboard')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getDashboardData(
    @Query('period') period?: 'day' | 'week' | 'month',
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.salesService.getDashboardData(period, from, to);
  }

  @Get('godelivery/metrics')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getGoDeliveryMetrics(
    @Query('email') email: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.salesService.getGoDeliveryMetrics(email, from, to);
  }

  @Get('consolidated-metrics')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  getConsolidatedMetrics(
    @Query('email') email: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.salesService.getConsolidatedMetrics(email, from, to);
  }

  @Get(':id')
  findById(@Param('id') id: string) { return this.salesService.findById(id); }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Request() req) { return this.salesService.cancel(id, req.user.sub); }
}

