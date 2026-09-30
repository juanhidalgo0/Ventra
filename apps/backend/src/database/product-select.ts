import { Prisma } from '@prisma/client';

/**
 * Todas las columnas del producto menos la foto. Las fotos guardadas en la base (base64)
 * pesan decenas de MB en total: cualquier consulta que traiga "el producto completo"
 * las arrastra aunque la pantalla no las muestre. Usar esto en los `include` / `select`
 * y, si hace falta mostrar la foto, pedir un enlace liviano con ProductsService.
 */
export const PRODUCT_WITHOUT_IMAGE = Object.fromEntries(
  Object.keys(Prisma.ProductScalarFieldEnum)
    .filter((field) => field !== 'imageUrl')
    .map((field) => [field, true]),
) as { [K in Exclude<keyof typeof Prisma.ProductScalarFieldEnum, 'imageUrl'>]: true };

/** Enlace liviano a una foto guardada en la base; lo sirve ProductImagesController. */
export const productImageLink = (id: string, updatedAt: Date | string | number) =>
  `/api/product-images/${encodeURIComponent(id)}?v=${new Date(updatedAt).getTime() || 0}`;

/** Id del producto si `url` es uno de esos enlaces (relativo o absoluto), si no null. */
export const productIdFromImageLink = (url: unknown): string | null => {
  if (typeof url !== 'string') return null;
  const m = /\/api\/product-images\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};
