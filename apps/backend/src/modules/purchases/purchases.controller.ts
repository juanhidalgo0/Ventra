import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Request, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PurchasesService } from './purchases.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('purchases')
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(private purchasesService: PurchasesService) {}

  @Get()
  findAll() {
    return this.purchasesService.findAll();
  }

  @Get('suggested-replenishment')
  getSuggestedReplenishment() {
    return this.purchasesService.getSuggestedReplenishment();
  }

  @Post()
  create(@Body() data: any, @Request() req) {
    return this.purchasesService.create({ ...data, userId: req.user.sub });
  }

  @Delete()
  deleteAll() {
    return this.purchasesService.deleteAll();
  }

  @Delete(':id')
  deleteOne(@Param('id') id: string) {
    return this.purchasesService.deleteOne(id);
  }

  @Post(':id/restore')
  restorePurchase(@Param('id') id: string) {
    return this.purchasesService.restorePurchase(id);
  }

  @Post('scan-invoice')
  @UseInterceptors(FilesInterceptor('files'))
  async scanInvoice(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req,
    @Body('manualTotal') manualTotal?: string
  ) {
    if (!files || files.length === 0) {
      throw new Error('No se recibió ningún archivo');
    }
    try {
      const parsedTotal = manualTotal ? Number(manualTotal) : undefined;
      return await this.purchasesService.scanInvoice(files, parsedTotal, req.user.sub);
    } catch (err: any) {
      console.error('Controller Error Stack:', err.stack);
      throw new Error(`Controller Error: ${err.message} -- Stack: ${err.stack}`);
    }
  }

  @Put(':id/confirm')
  confirmPending(
    @Param('id') id: string,
    @Body() data: any,
    @Request() req
  ) {
    return this.purchasesService.confirmPending(id, { ...data, userId: req.user.sub });
  }
}
