const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const barcodes = ['1000106244001', '1000102912', '1000102812', '1000103359', '1000102651'];
  for (const bc of barcodes) {
    const p = await prisma.product.findFirst({
      where: {
        OR: [
          { barcode: bc },
          { sku: bc }
        ]
      }
    });
    console.log(`Barcode/SKU ${bc}:`, p ? `${p.name} (id: ${p.id}, costPrice: ${p.costPrice}, salePrice: ${p.salePrice})` : 'NOT FOUND');
  }
  
  console.log('\nSample of 10 products:');
  const samples = await prisma.product.findMany({ take: 10 });
  samples.forEach(s => {
    console.log(`- ${s.name} (barcode: ${s.barcode}, costPrice: ${s.costPrice}, salePrice: ${s.salePrice})`);
  });
  
  await prisma.$disconnect();
}

run();
