const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('firebase-credentials.json', 'utf8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();
const comercioId = '6R8ikb9wsjUCQuOANOMHuAZZxss2';

async function run() {
  console.log('Querying Firestore products for commerce:', comercioId);
  const productsSnap = await db.collection('comercios').doc(comercioId).collection('products').get();
  console.log(`Found ${productsSnap.size} products.`);
  productsSnap.docs.forEach(doc => {
    const data = doc.data();
    if (data.name && (data.name.includes('CAÑUELAS') || data.name.includes('Aceite') || data.name.includes('GIRASOL'))) {
      console.log({
        docId: doc.id,
        name: data.name,
        barcode: data.barcode,
        stockQuantity: data.stockQuantity,
        price: data.price
      });
    }
  });
}

run().catch(console.error);
