#!/usr/bin/env node
/**
 * Copia los datos de Ventra del proyecto de GoDelivery (godelivery-magdalena)
 * al proyecto propio de Ventra (ventra-9cba5). NO borra nada del origen.
 *
 * Qué copia:
 *   - ventra_accounts            (suscripciones)
 *   - ventra_desktop             (aviso de versión)
 *   - ventra_stores + products + orders  (tiendas online)
 *   - Usuarios de Auth dueños de una cuenta en ventra_accounts, con el MISMO uid
 *     (así cada suscripción sigue asociada a su usuario).
 *
 * Las tiendas se copian SIN dueño (ownerUid/claimed se quitan): cada POS la
 * reclama sola la primera vez que abre Ventra ya actualizado. Hasta entonces
 * la tienda no aparece en tienda.ventra.store (ver firestore.rules).
 *
 * Se puede correr más de una vez (por ejemplo, para traer pedidos nuevos
 * después del cambio): no pisa las tiendas que ya existen en Ventra.
 *
 * Uso (desde Kiosco/firebase/scripts, después de `npm install`):
 *   node migrate-from-godelivery.js --from ./godelivery-key.json --to ./ventra-key.json            (simulación)
 *   node migrate-from-godelivery.js --from ./godelivery-key.json --to ./ventra-key.json --write    (copia real)
 *
 * Las claves (.json de cuentas de servicio) NO se suben a git: borralas al terminar.
 */
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const WRITE = process.argv.includes('--write');
const fromKey = arg('--from');
const toKey = arg('--to');
if (!fromKey || !toKey) {
  console.error('Uso: node migrate-from-godelivery.js --from <clave-godelivery.json> --to <clave-ventra.json> [--write]');
  process.exit(1);
}

function loadApp(keyPath, name, expectedProject) {
  const key = JSON.parse(fs.readFileSync(path.resolve(keyPath), 'utf8'));
  if (key.project_id !== expectedProject) {
    throw new Error(`La clave ${keyPath} es del proyecto "${key.project_id}", se esperaba "${expectedProject}".`);
  }
  return admin.initializeApp({ credential: admin.credential.cert(key) }, name);
}

const src = loadApp(fromKey, 'source', 'godelivery-magdalena');
const dst = loadApp(toKey, 'target', 'ventra-9cba5');
const srcDb = src.firestore();
const dstDb = dst.firestore();

const stats = { docs: 0, users: 0, skippedUsers: 0 };

async function copyCollection(srcRef, dstRef, transform, subcollections = [], keepExisting = false) {
  const snap = await srcRef.get();
  let batch = dstDb.batch();
  let pending = 0;
  for (const d of snap.docs) {
    const data = transform ? transform(d.data()) : d.data();
    // Tiendas: si ya existe en Ventra (por ejemplo, ya reclamada por su POS),
    // no se pisa el documento; solo se completan productos y pedidos.
    const skipDoc = keepExisting && WRITE && (await dstRef.doc(d.id).get()).exists;
    if (WRITE && !skipDoc) {
      batch.set(dstRef.doc(d.id), data);
      if (++pending === 400) { await batch.commit(); batch = dstDb.batch(); pending = 0; }
    }
    stats.docs++;
    for (const sub of subcollections) {
      // Pedidos ya sincronizados en Ventra no se pisan (evita importarlos dos veces)
      await copyCollection(d.ref.collection(sub), dstRef.doc(d.id).collection(sub), undefined, [], keepExisting);
    }
  }
  if (WRITE && pending) await batch.commit();
  console.log(`  ${srcRef.path}: ${snap.size} documentos`);
}

async function copyUsers() {
  const accounts = await srcDb.collection('ventra_accounts').get();
  const uids = accounts.docs.map((d) => d.id);
  for (let i = 0; i < uids.length; i += 100) {
    const { users, notFound } = await src.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    stats.skippedUsers += notFound.length;
    const toImport = users.map((u) => ({
      uid: u.uid,
      email: u.email,
      emailVerified: u.emailVerified,
      displayName: u.displayName,
      photoURL: u.photoURL,
      disabled: u.disabled,
      metadata: { creationTime: u.metadata.creationTime, lastSignInTime: u.metadata.lastSignInTime },
      providerData: u.providerData
        .filter((p) => p.providerId === 'google.com')
        .map((p) => ({ uid: p.uid, providerId: p.providerId, email: p.email, displayName: p.displayName, photoURL: p.photoURL })),
    }));
    if (WRITE && toImport.length) {
      const result = await dst.auth().importUsers(toImport);
      result.errors.forEach((e) => console.warn(`  ! usuario ${toImport[e.index].email}: ${e.error.message}`));
      stats.users += result.successCount;
    } else {
      stats.users += toImport.length;
    }
  }
  console.log(`  Usuarios de Auth: ${stats.users} (sin cuenta en Auth: ${stats.skippedUsers})`);
}

(async () => {
  console.log(WRITE ? '== COPIA REAL ==' : '== SIMULACIÓN (agregá --write para copiar) ==');

  await copyCollection(srcDb.collection('ventra_accounts'), dstDb.collection('ventra_accounts'));
  await copyCollection(srcDb.collection('ventra_desktop'), dstDb.collection('ventra_desktop'));
  await copyCollection(
    srcDb.collection('ventra_stores'),
    dstDb.collection('ventra_stores'),
    ({ ownerUid, claimed, ...rest }) => ({ ...rest, claimed: false }),
    ['products', 'orders'],
    true,
  );
  await copyUsers();

  console.log(`\nListo: ${stats.docs} documentos${WRITE ? ' copiados' : ' a copiar'}.`);
  process.exit(0);
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
