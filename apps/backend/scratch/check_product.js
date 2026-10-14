const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.product.count();
    console.log(`Total products in database: ${count}`);

    const productByBarcode = await prisma.product.findFirst({
      where: {
        OR: [
          { barcode: '77981813' },
          { additionalBarcodes: { some: { barcode: '77981813' } } }
        ]
      },
      include: { category: true, additionalBarcodes: true }
    });

    console.log("Product by barcode '77981813':", JSON.stringify(productByBarcode, null, 2));

    const productsByName = await prisma.product.findMany({
      where: {
        name: { contains: 'PHILIP' }
      },
      include: { category: true }
    });
    console.log("Products containing 'PHILIP':", JSON.stringify(productsByName, null, 2));

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
