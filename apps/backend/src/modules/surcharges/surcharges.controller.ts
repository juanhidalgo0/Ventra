import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SurchargesService } from './surcharges.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('surcharges')
@UseGuards(JwtAuthGuard)
export class SurchargesController {
  constructor(private surchargesService: SurchargesService) {}

  @Get()
  findAll() {
    return this.surchargesService.findAll();
  }

  @Post()
  upsert(@Body() data: { categoryId: string; percentage: number; paymentMethods: string[] }) {
    return this.surchargesService.upsert(data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.surchargesService.remove(id);
  }
}
