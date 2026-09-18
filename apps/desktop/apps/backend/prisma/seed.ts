import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  console.log('✅ Default users skipped (must be created on first start)');

  const categories = await Promise.all([
    prisma.category.upsert({ where: { name: 'Bebidas' }, update: {}, create: { name: 'Bebidas', color: '#3b82f6', icon: 'GlassWater', displayOrder: 1 } }),
    prisma.category.upsert({ where: { name: 'Snacks' }, update: {}, create: { name: 'Snacks', color: '#f59e0b', icon: 'Cookie', displayOrder: 2 } }),
    prisma.category.upsert({ where: { name: 'Lácteos' }, update: {}, create: { name: 'Lácteos', color: '#10b981', icon: 'Milk', displayOrder: 3 } }),
    prisma.category.upsert({ where: { name: 'Panadería' }, update: {}, create: { name: 'Panadería', color: '#f97316', icon: 'Croissant', displayOrder: 4 } }),
    prisma.category.upsert({ where: { name: 'Limpieza' }, update: {}, create: { name: 'Limpieza', color: '#06b6d4', icon: 'SprayCan', displayOrder: 5 } }),
    prisma.category.upsert({ where: { name: 'Golosinas' }, update: {}, create: { name: 'Golosinas', color: '#ec4899', icon: 'Candy', displayOrder: 6 } }),
    prisma.category.upsert({ where: { name: 'Cigarrillos' }, update: {}, create: { name: 'Cigarrillos', color: '#6b7280', icon: 'Cigarette', displayOrder: 7 } }),
    prisma.category.upsert({ where: { name: 'Fiambrería' }, update: {}, create: { name: 'Fiambrería', color: '#ef4444', icon: 'Beef', displayOrder: 8 } }),
    prisma.category.upsert({ where: { name: 'Almacén' }, update: {}, create: { name: 'Almacén', color: '#8b5cf6', icon: 'ShoppingBasket', displayOrder: 9 } }),
    prisma.category.upsert({ where: { name: 'Varios' }, update: {}, create: { name: 'Varios', color: '#64748b', icon: 'Package', displayOrder: 10 } }),
  ]);
  console.log('✅ Categories created');
  console.log('\n🎉 Seed complete!\n');
  console.log('📋 System requires initial admin creation on first boot.');
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(async () => {
    try {
      await prisma.$executeRawUnsafe('PRAGMA journal_mode = DELETE;');
      console.log('✅ SQLite WAL merged and cleaned.');
    } catch (err) {
      console.error('Failed to clean SQLite WAL:', err);
    }
    await prisma.$disconnect();
  });
