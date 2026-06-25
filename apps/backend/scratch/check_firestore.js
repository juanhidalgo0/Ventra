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
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  const db = admin.firestore();
  const commerceId = '6R8ikb9wsjUCQuOANOMHuAZZxss2';
  const doc = await db.collection('comercios').doc(commerceId).get();
  if (doc.exists) {
    console.log('Commerce Doc Data:', JSON.stringify(doc.data(), null, 2));
  } else {
    console.log('Commerce Doc not found in Firestore!');
  }
}

main().catch(console.error);
