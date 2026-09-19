import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ProductsService } from './products.service';

/**
 * Sirve las fotos de productos guardadas en la base de datos. Es público (sin JWT)
 * porque lo pide directamente una etiqueta <img>, que no puede mandar el token;
 * solo expone la foto del producto, nada más.
 */
@Controller('product-images')
export class ProductImagesController {
  constructor(private productsService: ProductsService) {}

  @Get(':id')
  async getImage(@Param('id') id: string, @Res() res: Response) {
    const image = await this.productsService.getProductImage(id);
    if (!image) throw new NotFoundException();
    if ('redirect' in image) return res.redirect(image.redirect);
    // La URL lleva ?v=<fecha de modificación>, así que se puede cachear sin miedo
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(image.mime).send(image.data);
  }
}
