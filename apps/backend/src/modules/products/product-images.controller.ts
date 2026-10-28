import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
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
  async getImage(@Param('id') id: string, @Res() res: Response, @Query('inline') inline?: string) {
    const image = await this.productsService.getProductImage(id);
    if (!image) throw new NotFoundException();
    if ('redirect' in image) {
      // inline=1: la trae la PC (las imágenes para redes se dibujan en un lienzo, y una foto de
      // otro sitio sin permiso no deja descargar la imagen). Solo la URL guardada en el producto.
      if (inline && /^https?:\/\//i.test(image.redirect)) {
        try {
          const r = await fetch(image.redirect, { signal: AbortSignal.timeout(8000) });
          const type = r.headers.get('content-type') || '';
          const buf = Buffer.from(await r.arrayBuffer());
          if (r.ok && /^image\//.test(type) && buf.length < 6 * 1024 * 1024) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.type(type).send(buf);
          }
        } catch { /* sin internet o la foto ya no está: que la pida el navegador */ }
      }
      return res.redirect(image.redirect);
    }
    // La URL lleva ?v=<fecha de modificación>, así que se puede cachear sin miedo
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(image.mime).send(image.data);
  }
}
