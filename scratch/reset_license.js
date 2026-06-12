const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.appLicense.upsert({
    where: { id: 'license_config' },
    update: {
      licenseKey: '',
      expiresAt: new Date(0),
    },
    create: {
      id: 'license_config',
      licenseKey: '',
      expiresAt: new Date(0),
      machineUuid: 'TEST-RESET-UUID'
    }
  });
  console.log('✅ Base de datos de licencia reseteada. La aplicación local ahora está bloqueada.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
