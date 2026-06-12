const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.client.findMany()
  .then(clients => {
    console.log("CLIENTS IN DB:", JSON.stringify(clients, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error("ERROR QUERYING DB:", err);
    process.exit(1);
  });
