const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('firebase-credentials.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log("--- User Roles ---");
  const doc = await db.collection('users').doc('7Sq9bA7OGuegcowu2ASktLm05og2').get();
  console.log(doc.id, doc.data());
}

run().catch(console.error);
