const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Querying categories...');
    const result = await prisma.category.findMany({
      include: { 
        _count: { select: { products: true } },
        parentCategory: { select: { id: true, name: true } }
      },
      orderBy: { displayOrder: 'asc' },
    });
    console.log('Success! Result size:', result.length);
  } catch (err) {
    console.error('Error querying categories:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
