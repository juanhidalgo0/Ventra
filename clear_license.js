const { PrismaClient } = require('./apps/backend/node_modules/@prisma/client');

async function resetDb(dbUrl) {
  process.env.DATABASE_URL = dbUrl;
  const prisma = new PrismaClient();
  try {
    await prisma.appLicense.updateMany({
      data: {
        licenseKey: '',
        expiresAt: new Date(0)
      }
    });
    console.log(`✅ Licencia restablecida en: ${dbUrl}`);
  } catch (err) {
    console.error(`❌ Error al restablecer en ${dbUrl}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  // 1. Restablece la DB del proyecto local
  await resetDb('file:C:/Users/PC/Desktop/Kiosco/apps/backend/prisma/dev.db');
  
  // 2. Restablece la DB de ejecución de Tauri en AppData
  await resetDb('file:C:/Users/PC/AppData/Roaming/com.godelivery.pos/dev.db');
}

main();
