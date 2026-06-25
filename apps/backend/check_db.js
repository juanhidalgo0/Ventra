const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const licenses = await prisma.appLicense.findMany();
    console.log("Licenses:", licenses);
    console.log("Tables exist.");
  } catch (e) {
    console.error("Error:", e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
