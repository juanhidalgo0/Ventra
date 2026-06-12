import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:./dev.db',
    },
  },
});

async function main() {
  console.log('[Checkpoint] Running WAL checkpoint on SQLite database...');
  try {
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
    console.log('[Checkpoint] Checkpoint completed successfully.');
  } catch (err) {
    console.error('[Checkpoint] Error during checkpoint:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
