import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { QuotesService } from './quotes.service';

@Controller('quotes')
@UseGuards(AuthGuard('jwt'))
export class QuotesController {
  constructor(private quotesService: QuotesService) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.quotesService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotesService.findOne(id);
  }

  @Post()
  create(@Body() data: any, @Request() req: any) {
    return this.quotesService.create({
      ...data,
      userId: req.user?.sub || data.userId,
    });
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: 'PENDING' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED') {
    return this.quotesService.updateStatus(id, status);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.quotesService.delete(id);
  }
}
