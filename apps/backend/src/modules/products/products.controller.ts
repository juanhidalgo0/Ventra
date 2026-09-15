import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { SyncImageService } from './sync-image.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import * as path from 'path';
import * as fs from 'fs';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private syncImageService: SyncImageService,
  ) {}

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('isFavorite') isFavorite?: string,
    @Query('lowStock') lowStock?: string,
    @Query('hasImage') hasImage?: string,
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
      skip: isNaN(skipNum) ? 0 : skipNum,
      take: isNaN(takeNum) ? 50 : takeNum,
    });
  }

  @Get('count')
  getCount(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('hasImage') hasImage?: string,
  ) {
    return this.productsService.count({
      search,
      categoryId,
      hasImage: hasImage === 'true' ? true : hasImage === 'false' ? false : undefined,
    });
  }

  @Get('barcode/:barcode')
  findByBarcode(@Param('barcode') barcode: string) {
    return this.productsService.findByBarcode(barcode);
  }

  @Get('pos-catalog')
  getPOSCatalog(@Query('updatedAfter') updatedAfter?: string) {
    return this.productsService.getPOSCatalog(updatedAfter);
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
