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
  const snapshot = await db.collection('orders').where('comercioId', '==', commerceId).get();
  console.log(`Found ${snapshot.size} orders:`);
  snapshot.docs.forEach(doc => {
    console.log(`Order ${doc.id}:`, JSON.stringify(doc.data(), null, 2));
  });
}

main().catch(console.error);
