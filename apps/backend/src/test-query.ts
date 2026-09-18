import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Querying recent sale items ---');
  const items = await prisma.saleItem.findMany({
    take: 10,
    orderBy: { id: 'desc' }
  });
  console.log(JSON.stringify(items, null, 2));

  console.log('--- Querying recent sales ---');
  const sales = await prisma.sale.findMany({
    take: 5,
    orderBy: { id: 'desc' },
    include: { items: true }
  });
  console.log(JSON.stringify(sales, null, 2));
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
