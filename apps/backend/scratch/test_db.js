const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    try {
        console.log('Testing Product.findMany with additionalBarcodes include...');
        const products = await prisma.product.findMany({
            where: { isActive: true },
            include: { 
                category: { select: { id: true, name: true, color: true } },
                additionalBarcodes: true
            },
            take: 5
        });
        console.log(`Success! Found ${products.length} products.`);
        console.log('Sample:', JSON.stringify(products[0], null, 2));
    } catch (err) {
        console.error('DATABASE ERROR:', err);
    } finally {
        await prisma.$disconnect();
    }
}

test();
