const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const product = await prisma.product.create({
      data: {
        name: 'CARAMELOS TEST',
        barcode: '99999999',
        salePrice: 10,
        costPrice: 5,
        allowCustomPrice: true
      }
    });
    console.log('Product created successfully:', product);
    // Delete it right away
    await prisma.product.delete({ where: { id: product.id } });
    console.log('Product deleted successfully');
  } catch (error) {
    console.error('Error during product creation:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
