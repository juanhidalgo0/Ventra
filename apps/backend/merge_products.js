const { PrismaClient } = require('@prisma/client');

const dbs = [
  'C:/Users/PC/Desktop/Kiosco/apps/backend/prisma/dev.db',
  'C:/Users/PC/Desktop/Kiosco/apps/desktop/apps/backend/prisma/dev.db'
];

async function run() {
  for (const dbPath of dbs) {
    console.log(`\n=== PROCESANDO BASE DE DATOS: ${dbPath} ===`);
    const prisma = new PrismaClient({
      datasources: {
        db: { url: `file:${dbPath}` }
      }
    });

    try {
      // Buscar el producto duplicado con 'cCAÑUELAS'
      const duplicate = await prisma.product.findFirst({
        where: {
          name: { contains: 'cCAÑUELAS' },
          isActive: true
        }
      });

      // Buscar el producto original 'CAÑUELAS'
      const original = await prisma.product.findFirst({
        where: {
          name: 'CAÑUELAS ACEITE GIRASOL 900 ML',
          isActive: true
        }
      });

      if (duplicate && original) {
        console.log(`Encontrados duplicado y original.`);
        console.log(`Original: ID=${original.id}, Barcode=${original.barcode}, Stock=${original.stock}`);
        console.log(`Duplicado: ID=${duplicate.id}, Barcode=${duplicate.barcode}, Stock=${duplicate.stock}`);

        // 1. Asignar el código de barras y stock al producto original
        const barcodeToSet = duplicate.barcode || 'f24b7821-f71f-435e-b1b5-a6dbc3ce9ce3';
        await prisma.product.update({
          where: { id: original.id },
          data: {
            barcode: barcodeToSet,
            stock: duplicate.stock // Sincronizar stock
          }
        });
        console.log(`✓ Producto original actualizado con Barcode="${barcodeToSet}" y Stock=${duplicate.stock}`);

        // 2. Eliminar o desactivar el duplicado
        await prisma.product.update({
          where: { id: duplicate.id },
          data: {
            isActive: false,
            barcode: null // Liberar código de barras único
          }
        });
        console.log(`✓ Producto duplicado desactivado.`);
      } else {
        console.log('No se encontraron duplicados para fusionar en esta BD.');
      }
    } catch (err) {
      console.error('Error al procesar:', err.message);
    } finally {
      await prisma.$disconnect();
    }
  }
}

run();
