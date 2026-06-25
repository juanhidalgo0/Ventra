import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('marketing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  @Post()
  create(@Body() createMarketingDto: { name: string; description?: string; items: { productId: string; order?: number }[] }) {
    return this.marketingService.create(createMarketingDto);
  }

  @Get()
  findAll() {
    return this.marketingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketingService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMarketingDto: { name?: string; description?: string; items?: { productId: string; order?: number }[] }) {
    return this.marketingService.update(id, updateMarketingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.marketingService.remove(id);
  }
}
