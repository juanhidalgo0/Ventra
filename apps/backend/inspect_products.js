const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('firebase-credentials.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const gmarketSnap = await db.collection('comercios').doc('6R8ikb9wsjUCQuOANOMHuAZZxss2').collection('products').get();
  console.log(`Go! Market (6R8ikb9wsjUCQuOANOMHuAZZxss2) products count: ${gmarketSnap.size}`);

  const paulosSnap = await db.collection('comercios').doc('7mdgE7txSCQqWQl1Hzrqa5PCo8C2').collection('products').get();
  console.log(`Maxikiosco Paulos (7mdgE7txSCQqWQl1Hzrqa5PCo8C2) products count: ${paulosSnap.size}`);
}

run().catch(console.error);
