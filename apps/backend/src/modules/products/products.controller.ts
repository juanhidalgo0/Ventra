import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ProductsService } from './products.service';
import { SyncImageService } from './sync-image.service';
import { VentraImportService } from './ventra-import.service';
import { HardwareImageService } from './hardware-image.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import * as path from 'path';
import * as fs from 'fs';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private syncImageService: SyncImageService,
    private ventraImport: VentraImportService,
    private hardwareImages: HardwareImageService,
  ) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('isFavorite') isFavorite?: string,
    @Query('lowStock') lowStock?: string,
    @Query('hasImage') hasImage?: string,
    @Query('noBarcode') noBarcode?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    console.log(`GET /api/products - params: search="${search}", skip=${skip}, take=${take}, hasImage=${hasImage}`);
    
    const skipNum = skip ? parseInt(skip) : 0;
    const takeNum = take ? parseInt(take) : 50;

    return this.productsService.findAll({
      search,
      categoryId,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      isFavorite: isFavorite === 'true',
      lowStock: lowStock === 'true',
      hasImage: hasImage === 'true' ? true : hasImage === 'false' ? false : undefined,
      noBarcode: noBarcode === 'true',
      skip: isNaN(skipNum) ? 0 : skipNum,
      take: isNaN(takeNum) ? 50 : takeNum,
    });
  }

  @Get('count')
  getCount(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('hasImage') hasImage?: string,
    @Query('noBarcode') noBarcode?: string,
  ) {
    return this.productsService.count({
      search,
      categoryId,
      hasImage: hasImage === 'true' ? true : hasImage === 'false' ? false : undefined,
      noBarcode: noBarcode === 'true',
    });
  }

  @Get('internal-barcode/next')
  getNextInternalBarcode() {
    return this.productsService.getNextInternalBarcode();
  }

  @Post('internal-barcode/assign')
  assignInternalBarcodes(@Body('ids') ids?: string[]) {
    return this.productsService.assignInternalBarcodes(Array.isArray(ids) ? ids : undefined);
  }

  @Get('barcode/:barcode')
  findByBarcode(@Param('barcode') barcode: string) {
    return this.productsService.findByBarcode(barcode);
  }

  /** Liviano (sin fotos): qué productos están en o por debajo del stock mínimo. Lo usa la app del celular. */
  @Get('low-stock-ids')
  getLowStockIds() {
    return this.productsService.getLowStockIds();
  }

  @Get('pos-catalog')
  getPOSCatalog(@Query('updatedAfter') updatedAfter?: string) {
    return this.productsService.getPOSCatalog(updatedAfter);
  }

  // Variantes (talle / color): se declaran antes de ':id' para que no las capture esa ruta
  @Get('variant-group/:variantGroupId')
  findVariantGroup(@Param('variantGroupId') variantGroupId: string) {
    return this.productsService.findVariantGroup(variantGroupId);
  }

  @Post('variant-matrix')
  saveVariantMatrix(@Body() data: any, @Request() req) {
    return this.productsService.saveVariantMatrix(data, req.user.sub);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post()
  create(@Body() data: any) {
    return this.productsService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: any, @Request() req) {
    return this.productsService.update(id, data, req.user.sub);
  }

  @Patch(':id/favorite')
  toggleFavorite(@Param('id') id: string) {
    return this.productsService.toggleFavorite(id);
  }

  @Post(':id/movement')
  addMovement(@Param('id') id: string, @Body() data: any, @Request() req) {
    return this.productsService.addMovement(id, { ...data, userId: req.user.sub });
  }

  @Get('movements/all')
  getMovements(@Query('productId') productId?: string, @Query('limit') limit?: string) {
    return this.productsService.getMovements({ productId, limit: limit ? parseInt(limit) : 50 });
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { dest: path.join(process.cwd(), 'uploads') }))
  importFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new Error('No se recibió ningún archivo');
    }
    return this.productsService.importFile(file);
  }

  // --- Formato propio de Ventra (.xlsx): exportar, plantilla, vista previa e importación ---
  private sendXlsx(res: Response, buffer: Buffer, filename: string) {
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get('export/ventra')
  async exportVentra(@Res() res: Response) {
    const date = new Date().toISOString().split('T')[0];
    this.sendXlsx(res, await this.ventraImport.exportProducts(), `ventra_productos_${date}.xlsx`);
  }

  @Get('import/ventra/template')
  ventraTemplate(@Res() res: Response) {
    this.sendXlsx(res, this.ventraImport.template(), 'ventra_plantilla_productos.xlsx');
  }

  @Post('import/ventra/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewVentraImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    return this.ventraImport.preview(file.buffer);
  }

  @Post('import/ventra')
  @UseInterceptors(FileInterceptor('file'))
  importVentra(@UploadedFile() file: Express.Multer.File, @Body('updateStock') updateStock: string, @Request() req) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    return this.ventraImport.import(file.buffer, { updateStock: updateStock !== 'false' }, req.user?.sub);
  }

  // --- Fotos para ferretería (productos sin código de barras) ---
  @Post('images/hardware/start')
  startHardwareImages(@Body('retryDiscarded') retryDiscarded?: boolean) {
    return this.hardwareImages.start({ retryDiscarded: !!retryDiscarded });
  }

  @Post('images/hardware/cancel')
  cancelHardwareImages() {
    this.hardwareImages.cancel();
    return { success: true };
  }

  @Get('images/hardware/summary')
  hardwareImagesSummary() {
    return this.hardwareImages.summary();
  }

  @Get('images/hardware/suggestions')
  hardwareImageSuggestions(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.hardwareImages.listPending(skip ? parseInt(skip) : 0, take ? Math.min(parseInt(take), 50) : 20);
  }

  @Post('images/hardware/suggestions/:id/accept')
  acceptImageSuggestion(@Param('id') id: string, @Body('url') url: string) {
    return this.hardwareImages.accept(id, url);
  }

  @Post('images/hardware/suggestions/:id/reject')
  rejectImageSuggestion(@Param('id') id: string) {
    return this.hardwareImages.reject(id);
  }

  @Post('images/hardware/suggestions/:id/search')
  researchImageSuggestion(@Param('id') id: string, @Body('query') query: string) {
    return this.hardwareImages.research(id, query);
  }

  @Get('images/search')
  searchImages(@Query('q') q: string) {
    return this.hardwareImages.searchByText(q);
  }

  @Post('import-local-dbf')
  importLocalDbf() {
    return this.productsService.importFromLocalDbf();
  }

  @Post('sync-all')
  syncAll(@Request() req, @Body('googleEmail') googleEmail?: string) {
    return this.productsService.syncAllToGoDelivery(req.user?.sub, googleEmail);
  }

  @Post('bulk-update-prices')
  bulkUpdatePrices(@Body() body: any) {
    return this.productsService.bulkUpdatePrices(body);
  }

  @Post('bulk-round-prices')
  bulkRoundPrices(@Body('multiple') multiple?: number) {
    return this.productsService.bulkRoundPrices(multiple ? Number(multiple) : 10);
  }

  @Post('bulk-reset-stock')
  bulkResetStock() {
    return this.productsService.bulkResetStock();
  }

  @Post('bulk-delete')
  bulkDelete() {
    return this.productsService.bulkDeleteAll();
  }

  @Post('bulk-delete-zero-negative')
  bulkDeleteZeroNegative() {
    return this.productsService.bulkDeleteZeroNegative();
  }

  @Post('bulk-remove-images')
  bulkRemoveImages() {
    return this.productsService.bulkRemoveAllImages();
  }

  @Post('auto-assign-images')
  autoAssignImages(@Request() req) {
    this.syncImageService.assignImagesToProducts(req.user.sub).catch(err => {
      console.error('Error running auto-image assigner:', err);
    });
    return { success: true, message: 'Buscador de imágenes de alta precisión iniciado' };
  }

  @Post('auto-assign-images/cancel')
  cancelAutoAssignImages() {
    this.syncImageService.cancelAssignment();
    return { success: true, message: 'Proceso de asignación de imágenes cancelado' };
  }

  @Get('export/godelivery')
  exportGoDelivery() {
    return this.productsService.exportForGoDelivery();
  }

  @Get('godelivery/stats')
  getGoDeliveryStats(@Request() req, @Query('email') email?: string) {
    return this.productsService.getGoDeliveryStats(req.user?.sub, email);
  }

  @Post('godelivery/settings')
  updateGoDeliverySettings(@Request() req, @Body() body: any) {
    const { googleEmail, ...configData } = body;
    return this.productsService.updateGoDeliverySettings(req.user?.sub, configData, googleEmail);
  }

  @Post('bulk-remove-images-subset')
  bulkRemoveImagesSubset(@Body('ids') ids: string[]) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Se debe proporcionar una lista de IDs de productos.');
    }
    return this.productsService.bulkRemoveImagesSubset(ids);
  }

  @Post('bulk-delete-subset')
  bulkDeleteSubset(@Body('ids') ids: string[]) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Se debe proporcionar una lista de IDs de productos.');
    }
    return this.productsService.bulkDeleteSubset(ids);
  }

  @Post('bulk-update-category-subset')
  bulkUpdateCategorySubset(@Body('ids') ids: string[], @Body('categoryId') categoryId: string) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Se debe proporcionar una lista de IDs de productos.');
    }
    if (!categoryId) {
      throw new BadRequestException('Se debe proporcionar el ID de la nueva categoría.');
    }
    return this.productsService.bulkUpdateCategorySubset(ids, categoryId);
  }

  @Post('bulk-set-show-online')
  bulkSetShowOnline(@Body('ids') ids: string[] | undefined, @Body('showOnline') showOnline: boolean) {
    return this.productsService.bulkSetShowOnline(ids, showOnline);
  }

  @Get('search-external-image/:barcode')
  async searchExternalImage(@Param('barcode') barcode: string) {
    const imageUrl = await this.syncImageService.searchImageByBarcode(barcode);
    return { imageUrl };
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.productsService.delete(id);
  }
}
