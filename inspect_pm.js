const { DatabaseSync } = require('node:sqlite');
const path = require('path');

async function main() {
  const dbPath = path.join(__dirname, 'apps', 'backend', 'prisma', 'dev.db');
  console.log('Connecting to SQLite at:', dbPath);
  const db = new DatabaseSync(dbPath);

  // Search for products containing 'morris'
  const query = db.prepare("SELECT * FROM products WHERE name LIKE ?");
  const results = query.all('%morris%');
  
  console.log('Results (name LIKE %morris%):');
  console.log(JSON.stringify(results, null, 2));

  // Let's also print counts of active vs inactive products
  const countQuery = db.prepare("SELECT is_active, COUNT(*) as cnt FROM products GROUP BY is_active");
  console.log('Product counts by active status:', countQuery.all());

  // Let's also check if barcode is null or empty
  const barcodeQuery = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE barcode IS NULL OR barcode = ''");
  console.log('Products without barcode:', barcodeQuery.all());
}

main().catch(console.error);
