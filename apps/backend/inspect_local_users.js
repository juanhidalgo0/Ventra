const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("--- Local SQLite Users ---");
  const users = await prisma.user.findMany();
  console.log(users);
}

main().catch(console.error).finally(() => prisma.$disconnect());
