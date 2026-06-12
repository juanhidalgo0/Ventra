import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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

  const brands = await Promise.all([
    prisma.brand.upsert({ where: { name: 'Coca-Cola' }, update: {}, create: { name: 'Coca-Cola' } }),
    prisma.brand.upsert({ where: { name: 'Quilmes' }, update: {}, create: { name: 'Quilmes' } }),
    prisma.brand.upsert({ where: { name: 'Arcor' }, update: {}, create: { name: 'Arcor' } }),
    prisma.brand.upsert({ where: { name: 'Bimbo' }, update: {}, create: { name: 'Bimbo' } }),
    prisma.brand.upsert({ where: { name: 'La Serenísima' }, update: {}, create: { name: 'La Serenísima' } }),
  ]);
  console.log('✅ Brands created');

  const suppliers = await Promise.all([
    prisma.supplier.upsert({ where: { id: 'sup1' }, update: {}, create: { id: 'sup1', name: 'Distribuidora Norte', contact: 'Carlos López', phone: '11-2345-6789', email: 'ventas@distnorte.com' } }),
    prisma.supplier.upsert({ where: { id: 'sup2' }, update: {}, create: { id: 'sup2', name: 'Mayorista Central', contact: 'Ana Ruiz', phone: '11-3456-7890', email: 'pedidos@maycentral.com' } }),
    prisma.supplier.upsert({ where: { id: 'sup3' }, update: {}, create: { id: 'sup3', name: 'Proveedor Directo SA', contact: 'Roberto Sánchez', phone: '11-4567-8901', email: 'info@provdirecto.com' } }),
  ]);
  console.log('✅ Suppliers created');

  const products = [
    { barcode: '7790895000539', name: 'Coca-Cola 500ml', categoryId: categories[0].id, brandId: brands[0].id, supplierId: suppliers[0].id, costPrice: 800, salePrice: 1500, stock: 48, minStock: 12, isFavorite: true },
    { barcode: '7790895001239', name: 'Coca-Cola 1.5L', categoryId: categories[0].id, brandId: brands[0].id, supplierId: suppliers[0].id, costPrice: 1200, salePrice: 2200, stock: 24, minStock: 6 },
    { barcode: '7790895002000', name: 'Coca-Cola 2.25L', categoryId: categories[0].id, brandId: brands[0].id, supplierId: suppliers[0].id, costPrice: 1500, salePrice: 2800, stock: 18, minStock: 6 },
    { barcode: '7790895006008', name: 'Sprite 500ml', categoryId: categories[0].id, brandId: brands[0].id, supplierId: suppliers[0].id, costPrice: 750, salePrice: 1400, stock: 36, minStock: 12 },
    { barcode: '7790895007005', name: 'Fanta 500ml', categoryId: categories[0].id, brandId: brands[0].id, supplierId: suppliers[0].id, costPrice: 750, salePrice: 1400, stock: 24, minStock: 12 },
    { barcode: '7792799000110', name: 'Agua Mineral 500ml', categoryId: categories[0].id, supplierId: suppliers[0].id, costPrice: 400, salePrice: 800, stock: 60, minStock: 24, isFavorite: true },
    { barcode: '7792799000220', name: 'Agua Mineral 1.5L', categoryId: categories[0].id, supplierId: suppliers[0].id, costPrice: 600, salePrice: 1100, stock: 30, minStock: 12 },
    { barcode: '7790045001001', name: 'Cerveza Quilmes 473ml', categoryId: categories[0].id, brandId: brands[1].id, supplierId: suppliers[1].id, costPrice: 900, salePrice: 1800, stock: 48, minStock: 24, isFavorite: true },
    { barcode: '7790045002001', name: 'Cerveza Quilmes 1L', categoryId: categories[0].id, brandId: brands[1].id, supplierId: suppliers[1].id, costPrice: 1500, salePrice: 2500, stock: 24, minStock: 12 },
    { barcode: '7790580100100', name: 'Energizante Speed 250ml', categoryId: categories[0].id, supplierId: suppliers[0].id, costPrice: 800, salePrice: 1600, stock: 36, minStock: 12 },
    { barcode: '7790580200200', name: 'Papas Lays Clásicas 100g', categoryId: categories[1].id, supplierId: suppliers[1].id, costPrice: 600, salePrice: 1200, stock: 30, minStock: 10, isFavorite: true },
    { barcode: '7790580200300', name: 'Doritos 100g', categoryId: categories[1].id, supplierId: suppliers[1].id, costPrice: 650, salePrice: 1300, stock: 24, minStock: 10 },
    { barcode: '7790580200400', name: 'Cheetos 80g', categoryId: categories[1].id, supplierId: suppliers[1].id, costPrice: 500, salePrice: 1000, stock: 20, minStock: 10 },
    { barcode: '7790040100100', name: 'Palitos Salados 200g', categoryId: categories[1].id, brandId: brands[2].id, supplierId: suppliers[1].id, costPrice: 400, salePrice: 850, stock: 15, minStock: 5 },
    { barcode: '7790040100200', name: 'Maní Salado 100g', categoryId: categories[1].id, supplierId: suppliers[1].id, costPrice: 500, salePrice: 950, stock: 20, minStock: 8 },
    { barcode: '7790070100100', name: 'Leche Entera 1L', categoryId: categories[2].id, brandId: brands[4].id, supplierId: suppliers[2].id, costPrice: 700, salePrice: 1300, stock: 24, minStock: 12, isFavorite: true },
    { barcode: '7790070100200', name: 'Yogur Bebible 1L', categoryId: categories[2].id, brandId: brands[4].id, supplierId: suppliers[2].id, costPrice: 800, salePrice: 1500, stock: 18, minStock: 6 },
    { barcode: '7790070100300', name: 'Queso Cremoso 1kg', categoryId: categories[2].id, brandId: brands[4].id, supplierId: suppliers[2].id, costPrice: 3000, salePrice: 5500, stock: 8, minStock: 3, unit: 'KG' },
    { barcode: '7790070100400', name: 'Manteca 200g', categoryId: categories[2].id, brandId: brands[4].id, supplierId: suppliers[2].id, costPrice: 800, salePrice: 1500, stock: 15, minStock: 5 },
    { barcode: '7790090100100', name: 'Pan Lactal Blanco', categoryId: categories[3].id, brandId: brands[3].id, supplierId: suppliers[2].id, costPrice: 800, salePrice: 1600, stock: 12, minStock: 4, isFavorite: true },
    { barcode: '7790090100200', name: 'Pan de Hamburguesa x4', categoryId: categories[3].id, brandId: brands[3].id, supplierId: suppliers[2].id, costPrice: 600, salePrice: 1200, stock: 10, minStock: 4 },
    { barcode: '7790090100300', name: 'Medialunas x6', categoryId: categories[3].id, supplierId: suppliers[2].id, costPrice: 900, salePrice: 1800, stock: 8, minStock: 3 },
    { barcode: '7790110100100', name: 'Detergente 750ml', categoryId: categories[4].id, supplierId: suppliers[1].id, costPrice: 600, salePrice: 1100, stock: 20, minStock: 6 },
    { barcode: '7790110100200', name: 'Lavandina 1L', categoryId: categories[4].id, supplierId: suppliers[1].id, costPrice: 400, salePrice: 800, stock: 15, minStock: 5 },
    { barcode: '7790110100300', name: 'Papel Higiénico x4', categoryId: categories[4].id, supplierId: suppliers[1].id, costPrice: 800, salePrice: 1500, stock: 25, minStock: 8 },
    { barcode: '7790110100400', name: 'Jabón en Polvo 800g', categoryId: categories[4].id, supplierId: suppliers[1].id, costPrice: 900, salePrice: 1700, stock: 12, minStock: 4 },
    { barcode: '77900401000A1', name: 'Alfajor Jorgito', categoryId: categories[5].id, brandId: brands[2].id, supplierId: suppliers[0].id, costPrice: 300, salePrice: 600, stock: 50, minStock: 20, isFavorite: true },
    { barcode: '77900401000A2', name: 'Alfajor Havanna', categoryId: categories[5].id, supplierId: suppliers[0].id, costPrice: 600, salePrice: 1200, stock: 30, minStock: 10 },
    { barcode: '77900401000A3', name: 'Chicle Beldent x3', categoryId: categories[5].id, brandId: brands[2].id, supplierId: suppliers[0].id, costPrice: 200, salePrice: 400, stock: 40, minStock: 15 },
    { barcode: '77900401000A4', name: 'Caramelos Surtidos x10', categoryId: categories[5].id, brandId: brands[2].id, supplierId: suppliers[0].id, costPrice: 150, salePrice: 350, stock: 60, minStock: 20 },
    { barcode: '77900401000A5', name: 'Chocolate Milka 100g', categoryId: categories[5].id, supplierId: suppliers[0].id, costPrice: 700, salePrice: 1400, stock: 20, minStock: 8 },
    { barcode: '77901201000C1', name: 'Marlboro Box 20', categoryId: categories[6].id, supplierId: suppliers[0].id, costPrice: 1500, salePrice: 2800, stock: 30, minStock: 10 },
    { barcode: '77901201000C2', name: 'Camel Box 20', categoryId: categories[6].id, supplierId: suppliers[0].id, costPrice: 1400, salePrice: 2600, stock: 20, minStock: 10 },
    { barcode: '77901301000F1', name: 'Jamón Cocido (por kg)', categoryId: categories[7].id, supplierId: suppliers[2].id, costPrice: 4000, salePrice: 7500, stock: 5, minStock: 2, unit: 'KG' },
    { barcode: '77901301000F2', name: 'Queso de Máquina (por kg)', categoryId: categories[7].id, supplierId: suppliers[2].id, costPrice: 3500, salePrice: 6500, stock: 4, minStock: 2, unit: 'KG' },
    { barcode: '77901401000L1', name: 'Arroz 1kg', categoryId: categories[8].id, supplierId: suppliers[1].id, costPrice: 600, salePrice: 1100, stock: 20, minStock: 8 },
    { barcode: '77901401000L2', name: 'Fideos 500g', categoryId: categories[8].id, supplierId: suppliers[1].id, costPrice: 400, salePrice: 800, stock: 25, minStock: 10 },
    { barcode: '77901401000L3', name: 'Aceite Girasol 900ml', categoryId: categories[8].id, supplierId: suppliers[1].id, costPrice: 800, salePrice: 1500, stock: 15, minStock: 5 },
    { barcode: '77901401000L4', name: 'Azúcar 1kg', categoryId: categories[8].id, supplierId: suppliers[1].id, costPrice: 500, salePrice: 950, stock: 18, minStock: 6 },
    { barcode: '77901401000L5', name: 'Yerba Mate 1kg', categoryId: categories[8].id, supplierId: suppliers[1].id, costPrice: 1200, salePrice: 2200, stock: 12, minStock: 5, isFavorite: true },
    { barcode: '77901501000V1', name: 'Encendedor BIC', categoryId: categories[9].id, supplierId: suppliers[0].id, costPrice: 300, salePrice: 600, stock: 40, minStock: 15 },
    { barcode: '77901501000V2', name: 'Pilas AA x2', categoryId: categories[9].id, supplierId: suppliers[0].id, costPrice: 500, salePrice: 1000, stock: 20, minStock: 8 },
    { barcode: '77901501000V3', name: 'Bolsa de Residuos x10', categoryId: categories[9].id, supplierId: suppliers[1].id, costPrice: 400, salePrice: 800, stock: 15, minStock: 5 },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { barcode: product.barcode },
      update: {},
      create: { ...product, unit: (product as any).unit || 'UNIT', isFavorite: (product as any).isFavorite || false },
    });
  }

  console.log(`✅ ${products.length} Products created`);
  console.log('\n🎉 Seed complete!\n');
  console.log('📋 System requires initial admin creation on first boot.');
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
