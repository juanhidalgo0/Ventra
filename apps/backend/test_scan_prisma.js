const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const parsedData = {
  "supplierName": "RICARDO NINI S.A.",
  "invoiceNumber": "0101-01181099",
  "date": "2026-06-11",
  "items": [
    {
      "barcode": "1000103359",
      "name": "MILKA alf.tri.mousse 55 g",
      "quantity": 1,
      "cost": 1549.03,
      "total": 6528.97
    },
    {
      "barcode": "1000106244001",
      "name": "KNORR caldo x 2 un (x24 un). verd. NVO",
      "quantity": 1,
      "cost": 1316.68,
      "total": 9153.36
    },
    {
      "barcode": "1000102912",
      "name": "LA SER.rallado sobre x 35g (x 10un)",
      "quantity": 1,
      "cost": 1562.46,
      "total": 12912.9
    },
    {
      "barcode": "1000002807",
      "name": "CAÑUELAS aceite girasol 900 ml",
      "quantity": 1,
      "cost": 3143.08,
      "total": 31171.08
    },
    {
      "barcode": "1000106244003",
      "name": "KNORR caldo x 2 un (x24 un). carne NVO.",
      "quantity": 1,
      "cost": 456.52,
      "total": 9054.96
    },
    {
      "barcode": "1000116364",
      "name": "DOMINO azúcar comun 1 kg",
      "quantity": 1,
      "cost": 1240.24,
      "total": 5124.95
    },
    {
      "barcode": "1000106244002",
      "name": "KNORR caldo gall.nvo x 2 un (x24 un)",
      "quantity": 1,
      "cost": 461.48,
      "total": 9153.36
    },
    {
      "barcode": "1000000019",
      "name": "LEDESMA azucar clasica 1 kg",
      "quantity": 1,
      "cost": 1298.92,
      "total": 5367.45
    },
    {
      "barcode": "1000000008",
      "name": "GALLO ORO arroz parb.bsa 500 g",
      "quantity": 1,
      "cost": 1175.26,
      "total": 9712.9
    },
    {
      "barcode": "1000003721",
      "name": "PEPITOS alfajor triple 57 g",
      "quantity": 1,
      "cost": 1579.04,
      "total": 6524.95
    },
    {
      "barcode": "1000011799",
      "name": "NATURA mayonesa dp. 237 g",
      "quantity": 1,
      "cost": 1309.69,
      "total": 12988.68
    },
    {
      "barcode": "1000000017",
      "name": "MOLINOS ALA arroz 00000 largo fino 1KG.",
      "quantity": 1,
      "cost": 1292.99,
      "total": 10685.9
    },
    {
      "barcode": "1000007023",
      "name": "NATURA mostaza dp. 250 g",
      "quantity": 1,
      "cost": 955.4,
      "total": 9475.08
    },
    {
      "barcode": "1000114141",
      "name": "SOL MAYOR roll.coc.40p. 3 un",
      "quantity": 1,
      "cost": 1162.8,
      "total": 5765.94
    },
    {
      "barcode": "1000101947",
      "name": "LA PAULINA rallado x 40 g (x 24un)",
      "quantity": 1,
      "cost": 1814.99,
      "total": 35999.76
    },
    {
      "barcode": "1000007101",
      "name": "AGUILA alf.minitorta 72 g",
      "quantity": 1,
      "cost": 1454.65,
      "total": 5367.75
    },
    {
      "barcode": "100003688001",
      "name": "SOL PAMP.fid.largos spaghetti 500 g",
      "quantity": 1,
      "cost": 736.64,
      "total": 12175.8
    },
    {
      "barcode": "100003687001",
      "name": "SOL PAMP.fid.guis. tirabuzon 500 g",
      "quantity": 1,
      "cost": 736.64,
      "total": 9131.85
    },
    {
      "barcode": "1000007021",
      "name": "NATURA ketchup dp. 250 g",
      "quantity": 1,
      "cost": 1409.52,
      "total": 12882.6
    },
    {
      "barcode": "1000101368",
      "name": "MAÑANITA yerba 4flex 500 g",
      "quantity": 1,
      "cost": 1798.89,
      "total": 14866.9
    },
    {
      "barcode": "1000101278",
      "name": "PLAYADITO yerba c/palo 500 g",
      "quantity": 1,
      "cost": 2175.33,
      "total": 17977.9
    }
  ]
};

async function test() {
  try {
    console.log('Loading supplier...');
    let matchedSupplier = null;
    if (parsedData.supplierName) {
      matchedSupplier = await prisma.supplier.findFirst({
        where: {
          name: {
            contains: parsedData.supplierName,
          },
        },
      });
    }
    console.log('Supplier matched:', matchedSupplier ? matchedSupplier.name : 'None');

    console.log('Loading products...');
    const allProducts = await prisma.product.findMany({
      where: { isActive: true },
      include: { additionalBarcodes: true },
    });
    console.log(`Loaded ${allProducts.length} products`);

    console.log('Matching items...');
    const items = (parsedData.items || []).map((item, idx) => {
      let matchedProduct = null;
      try {
        if (item.barcode) {
          const barcodeStr = String(item.barcode);
          matchedProduct = allProducts.find(
            p => p.barcode === barcodeStr || p.additionalBarcodes.some(ab => ab.barcode === barcodeStr)
          );
        }

        if (!matchedProduct && item.name) {
          const searchName = item.name.toUpperCase();
          matchedProduct = allProducts.find(
            p => p.name && p.name.toUpperCase().includes(searchName)
          );
        }

        return {
          barcode: item.barcode || '',
          name: item.name,
          quantity: item.quantity || 1,
          cost: item.cost || 0,
          total: item.total || (item.quantity * item.cost) || 0,
          product: matchedProduct ? {
            id: matchedProduct.id,
            barcode: matchedProduct.barcode,
            name: matchedProduct.name,
            costPrice: matchedProduct.costPrice,
            salePrice: matchedProduct.salePrice,
            unit: matchedProduct.unit,
            presentationType: matchedProduct.presentationType,
            unitsPerPack: matchedProduct.unitsPerPack,
          } : null,
        };
      } catch (innerErr) {
        console.error(`CRASHED AT ITEM INDEX ${idx} (${item.name}):`, innerErr.message);
        throw innerErr;
      }
    });

    console.log('Match success! Items count:', items.length);

  } catch (err) {
    console.error('CRASHED WITH ERROR:', err.message);
    console.error(err.stack);
  } finally {
    await prisma.$disconnect();
  }
}

test();
