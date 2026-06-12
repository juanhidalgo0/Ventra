const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const barcode = '5';
  console.log(`Checking barcode "${barcode}"...`);
  
  const mainProduct = await prisma.product.findUnique({
    where: { barcode },
    include: { additionalBarcodes: true }
  });
  console.log('Main product with this barcode:', mainProduct);

  const additionalProduct = await prisma.productBarcode.findUnique({
    where: { barcode },
    include: { product: true }
  });
  console.log('Product with this barcode as additional:', additionalProduct);

  const skuProduct = await prisma.product.findUnique({
    where: { sku: barcode }
  });
  console.log('Product with this SKU:', skuProduct);
}

main().catch(console.error).finally(() => prisma.$disconnect());
