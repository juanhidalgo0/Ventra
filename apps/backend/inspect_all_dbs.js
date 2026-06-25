const { execSync } = require('child_process');
const path = require('path');

const dbs = [
  'C:/Users/PC/Desktop/Kiosco/apps/backend/prisma/dev.db',
  'C:/Users/PC/Desktop/Kiosco/apps/desktop/apps/backend/prisma/dev.db',
  'C:/Users/PC/Desktop/Kiosco/src-tauri/target/debug/_up_/apps/backend/prisma/dev.db',
  'C:/Users/PC/Desktop/Kiosco/src-tauri/target/release/_up_/apps/backend/prisma/dev.db'
];

dbs.forEach(dbPath => {
  console.log(`\n=== INSPECCIONANDO: ${dbPath} ===`);
  try {
    const code = `
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: { url: 'file:${dbPath}' }
  }
});
async function main() {
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
  console.log(products.map(p => ({ id: p.id, barcode: p.barcode, name: p.name, stock: p.stock, price: p.salePrice })));
  await prisma.$disconnect();
}
main();
    `;
    const result = execSync(`node -e "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, { encoding: 'utf8' });
    console.log(result);
  } catch (err) {
    console.error('Error al inspeccionar:', err.message);
  }
});
