import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AcopioService } from './acopio.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('acopio')
@UseGuards(JwtAuthGuard)
export class AcopioController {
  constructor(private readonly acopioService: AcopioService) {}

  @Get()
  async getAcopios(@Query() query: any) {
    return this.acopioService.getAcopios(query);
  }

  @Get(':id')
  async getAcopioById(@Param('id') id: string) {
    return this.acopioService.getAcopioById(id);
  }

  @Post(':saleId/remitos')
  async createDeliveryReceipt(
    @Param('saleId') saleId: string,
    @Request() req: any,
    @Body() body: {
      receiverName?: string;
      driverName?: string;
      deliveryAddress?: string;
      notes?: string;
      items: { saleItemId: string; quantity: number }[];
    }
  ) {
    const userId = req.user?.id || req.user?.sub;
    return this.acopioService.createDeliveryReceipt(saleId, userId, body);
  }
}
