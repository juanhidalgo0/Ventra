const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

async function main() {
  const serviceAccountPath = path.join(process.cwd(), 'firebase-credentials.json');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('firebase-credentials.json not found!');
    return;
  }
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  const db = admin.firestore();
  const commerceId = '6R8ikb9wsjUCQuOANOMHuAZZxss2';
  const snapshot = await db.collection('orders')
    .where('comercioId', '==', commerceId)
    .get();

  console.log(`Found ${snapshot.size} total orders.`);
  const orders = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  // Sort by createdAt desc in memory
  orders.sort((a, b) => {
    const timeA = a.createdAt ? (a.createdAt._seconds || 0) : 0;
    const timeB = b.createdAt ? (b.createdAt._seconds || 0) : 0;
    return timeB - timeA;
  });

  orders.slice(0, 5).forEach(o => {
    console.log(`Order ${o.id} (Status: ${o.status}, orderId: ${o.orderId}):`, JSON.stringify(o.items, null, 2));
    console.log(`stockDiscountedLocal:`, o.stockDiscountedLocal);
  });
}

main().catch(console.error);
