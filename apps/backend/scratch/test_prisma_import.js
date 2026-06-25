const { PrismaClient } = require('@prisma/client');
const { DBFFile } = require('dbffile');
const path = require('path');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:../prisma/dev.db'
    }
  }
});

async function run() {
  const dbfPath = 'c:/Users/PC/Desktop/Kiosco/ARTICULO.DBF';
  try {
    const dbf = await DBFFile.open(dbfPath);
    console.log(`Importing ${dbf.recordCount} products from DBF...`);

    let importedCount = 0;
    let updatedCount = 0;

    const batchSize = 500;
    for (let i = 0; i < dbf.recordCount; i += batchSize) {
      const records = await dbf.readRecords(batchSize);
      if (records.length === 0) continue;
      
      await prisma.$transaction(async (tx) => {
        for (const record of records) {
          const sku = record.NUM_ART.trim();
          if (!sku) continue;

          const name = record.DESC.trim().toUpperCase();
          const stock = record.EXISTENCIA || 0;
          const paquete = record.PAQUETE || 1;
          const costPrice = record.COSTO / paquete;
          const salePrice = record.PRECIOA || 0;

          const existing = await tx.product.findUnique({
            where: { sku },
          });

          if (existing) {
            await tx.product.update({
              where: { id: existing.id },
              data: {
                stock,
                costPrice,
                salePrice,
                updatedAt: new Date(),
              },
            });
            updatedCount++;
          } else {
            await tx.product.create({
              data: {
                sku,
                name,
                stock,
                costPrice,
                salePrice,
              },
            });
            importedCount++;
          }
        }
      }, {
        timeout: 30000,
      });
      console.log(`Processed ${Math.min(i + batchSize, dbf.recordCount)} / ${dbf.recordCount}`);
    }
    console.log(`Done. Imported: ${importedCount}, Updated: ${updatedCount}`);
  } catch (err) {
    console.error('Error during Prisma import:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
