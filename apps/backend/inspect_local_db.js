const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: 'aceite' } },
          { name: { contains: 'ACEITE' } },
          { name: { contains: 'cañuelas' } },
          { name: { contains: 'CAÑUELAS' } }
        ]
      }
    });

    console.log('\n--- PRODUCTOS ENCONTRADOS EN LA BD LOCAL ---');
    products.forEach(p => {
      console.log({
        id: p.id,
        barcode: p.barcode,
        name: p.name,
        stock: p.stock,
        salePrice: p.salePrice,
        isActive: p.isActive
      });
    });
    console.log('--------------------------------------------\n');
  } catch (err) {
    console.error('Error al inspeccionar la BD:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
