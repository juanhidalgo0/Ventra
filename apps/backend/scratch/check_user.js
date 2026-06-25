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
  
  const email = 'kioscopaulos7@gmail.com';
  const userSnapshot = await db.collection('users').where('email', '==', email).get();
  console.log(`Found ${userSnapshot.size} users with email ${email}:`);
  userSnapshot.docs.forEach(doc => {
    console.log(`User ${doc.id}:`, JSON.stringify(doc.data(), null, 2));
  });

  const allComercios = await db.collection('comercios').get();
  console.log(`All Comercios:`);
  allComercios.docs.forEach(doc => {
    console.log(`Commerce ${doc.id}: ownerId=${doc.data().ownerId}, name=${doc.data().name}`);
  });
}

main().catch(console.error);
