const { PrismaClient } = require('../apps/backend/node_modules/@prisma/client');
const path = require('path');

// Test different SQLite URLs
const fs = require('fs');
const parentDir = `C:/Users/PC/AppData/Roaming/GoDelivery POS`;
if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true });
}

const testUrls = [
  `file:C:/Users/PC/AppData/Roaming/GoDelivery POS/dev.db`,
  `file:C:/Users/PC/AppData/Roaming/GoDelivery%20POS/dev.db`,
  `file:///C:/Users/PC/AppData/Roaming/GoDelivery%20POS/dev.db`,
  `file:///C:/Users/PC/AppData/Roaming/GoDelivery POS/dev.db`,
];

async function run() {
  for (const url of testUrls) {
    console.log(`\nTesting URL: ${url}`);
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: url,
        },
      },
    });
    try {
      await prisma.$connect();
      console.log(`✅ SUCCESS connecting to: ${url}`);
      await prisma.$disconnect();
    } catch (err) {
      console.log(`❌ FAILED connecting to: ${url}`);
      console.log(`Error message: ${err.message}`);
    }
  }
}

run();
