import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Request, UseInterceptors, UploadedFiles, BadRequestException, HttpException } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PurchasesService } from './purchases.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';

@Controller('purchases')
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(private purchasesService: PurchasesService) {}

  @Get()
  findAll() {
    return this.purchasesService.findAll();
  }

  /** Boletas escaneadas que esperan revisión (las que se sacan con el celular): liviano, para avisar en la PC */
  @Get('pending')
  pending() {
    return this.purchasesService.pending();
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
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
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

  /** Cómo se cargan las boletas escaneadas desde el celular (ver PurchasesService.scanSettings) */
  @Get('scan-settings')
  scanSettings() {
    return this.purchasesService.scanSettings();
  }

  /** Aumentos desde la última compra y si otro proveedor lo vendió más barato */
  @Post('cost-insights')
  costInsights(@Body() body: { supplierId?: string; items?: { productId: string; cost: number }[] }) {
    return this.purchasesService.costInsights(body?.supplierId, body?.items || []);
  }

  @Post('scan-invoice')
  @UseInterceptors(FilesInterceptor('files'))
  async scanInvoice(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req,
    @Body('manualTotal') manualTotal?: string,
    @Body('mode') mode?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No se recibió ningún archivo');
    }
    try {
      const parsedTotal = manualTotal ? Number(manualTotal) : undefined;
      // inline: la PC la revisa en la misma pantalla; sin modo (celular): se carga sola si cierra
      return await this.purchasesService.scanInvoice(files, parsedTotal, req.user.sub, { inline: mode === 'inline' });
    } catch (err: any) {
      console.error('Controller Error Stack:', err.stack);
      // El mensaje tiene que llegar a la pantalla (antes quedaba un "Internal server error")
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(err.message || 'No se pudo procesar la boleta');
    }
  }

  /**
   * Leer una boleta con las fotos en el cuerpo (base64), sin guardar nada: es la vista previa que
   * usa el bot de WhatsApp del dueño. Después la compra se carga con POST /purchases.
   */
  @Post('scan-invoice-json')
  async scanInvoiceJson(@Body() body: { images?: { data: string; mime?: string; name?: string }[]; manualTotal?: number }, @Request() req) {
    const files = (Array.isArray(body?.images) ? body.images : []).slice(0, 6).map((im, i) => {
      const buffer = Buffer.from(String(im?.data || ''), 'base64');
      return { buffer, size: buffer.length, mimetype: String(im?.mime || 'image/jpeg'), originalname: String(im?.name || `boleta-${i + 1}.jpg`) } as Express.Multer.File;
    });
    if (!files.length || files.some((f) => !f.size)) throw new BadRequestException('No llegó ninguna foto de la boleta');
    try {
      return await this.purchasesService.scanInvoice(files, body?.manualTotal ? Number(body.manualTotal) : undefined, req.user.sub, { inline: true });
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(err.message || 'No se pudo leer la boleta');
    }
  }

  /** Boleta leída por el bot de WhatsApp que el dueño quiere revisar en la PC: queda pendiente */
  @Post('pending-from-preview')
  pendingFromPreview(@Body() body: { preview?: any; via?: string }, @Request() req) {
    return this.purchasesService.pendingFromPreview(body?.preview, req.user.sub, body?.via === 'fotos' ? 'fotos' : body?.via === 'celular' ? 'el celular' : 'WhatsApp');
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
