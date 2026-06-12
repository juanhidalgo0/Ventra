const { PrismaClient } = require('../apps/backend/node_modules/@prisma/client');

async function inspectDb(dbUrl) {
  process.env.DATABASE_URL = dbUrl;
  const prisma = new PrismaClient();
  try {
    const licenses = await prisma.appLicense.findMany();
    console.log(`=== DB: ${dbUrl} ===`);
    console.log(JSON.stringify(licenses, null, 2));
  } catch (err) {
    console.error(`❌ Error al inspeccionar en ${dbUrl}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await inspectDb('file:C:/Users/PC/Desktop/Kiosco/apps/backend/prisma/dev.db');
  await inspectDb('file:C:/Users/PC/AppData/Roaming/com.godelivery.pos/dev.db');
}

main();
