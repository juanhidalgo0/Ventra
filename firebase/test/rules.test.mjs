// Pruebas de firestore.rules contra el emulador local (no toca el proyecto real).
// Correr desde Kiosco/firebase/test:  npm install && npm test
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, limit, getDocs, serverTimestamp } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'ventra-rules-test',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'ventra_stores/owned'), { businessName: 'A', subdomain: 'kiosco-a', ownerUid: 'posA', claimed: true, isPublished: true });
    await setDoc(doc(db, 'ventra_stores/migrated'), { businessName: 'B', subdomain: 'kiosco-b', claimed: false });
    await setDoc(doc(db, 'ventra_stores/owned/orders/o1'), { total: 10 });
    await setDoc(doc(db, 'ventra_accounts/userX'), { plan: 'caja' });
    await setDoc(doc(db, 'ventra_desktop/latest_version'), { version: '1.0.0' });
  });
});

const as = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const order = (extra = {}) => ({
  items: [{ productId: 'p', name: 'Coca', price: 10, qty: 1 }], total: 10,
  customerName: 'Ana', customerPhone: '123', customerNote: '', status: 'PENDING', syncedLocal: false,
  createdAt: serverTimestamp(), ...extra,
});

test('la tienda publica encuentra una tienda reclamada por subdominio', async () => {
  const q = query(collection(as(null), 'ventra_stores'), where('claimed', '==', true), where('subdomain', '==', 'kiosco-a'), limit(1));
  await assertSucceeds(getDocs(q));
});
test('no se pueden listar tiendas sin filtrar por reclamadas (no se exponen las migradas)', async () => {
  await assertFails(getDocs(query(collection(as(null), 'ventra_stores'), where('subdomain', '==', 'kiosco-b'))));
});
test('el dueño edita su tienda', async () => {
  await assertSucceeds(updateDoc(doc(as('posA'), 'ventra_stores/owned'), { businessName: 'Nuevo' }));
});
test('otra sesión NO puede editar una tienda ajena', async () => {
  await assertFails(updateDoc(doc(as('intruso'), 'ventra_stores/owned'), { businessName: 'Hackeado' }));
});
test('nadie puede quitarle el dueño a una tienda', async () => {
  await assertFails(updateDoc(doc(as('posA'), 'ventra_stores/owned'), { ownerUid: 'otro' }));
});
test('sin sesión no se escribe', async () => {
  await assertFails(updateDoc(doc(as(null), 'ventra_stores/owned'), { businessName: 'x' }));
});
test('un POS reclama una tienda migrada sin dueño', async () => {
  await assertSucceeds(updateDoc(doc(as('posB'), 'ventra_stores/migrated'), { ownerUid: 'posB', claimed: true }));
});
test('un POS crea su tienda nueva siendo el dueño', async () => {
  await assertSucceeds(setDoc(doc(as('posC'), 'ventra_stores/nueva'), { businessName: 'C', ownerUid: 'posC', claimed: true }));
  await assertFails(setDoc(doc(as('posC'), 'ventra_stores/otra'), { businessName: 'C', ownerUid: 'posZ', claimed: true }));
});
test('solo el dueño sube productos', async () => {
  await assertSucceeds(setDoc(doc(as('posA'), 'ventra_stores/owned/products/p1'), { name: 'x', price: 1 }));
  await assertFails(setDoc(doc(as('intruso'), 'ventra_stores/owned/products/p1'), { name: 'x', price: 1 }));
  await assertSucceeds(getDoc(doc(as(null), 'ventra_stores/owned/products/p1')));
});
test('un cliente sin sesión hace un pedido válido', async () => {
  await assertSucceeds(addDoc(collection(as(null), 'ventra_stores/owned/orders'), order()));
});
test('se rechazan pedidos inválidos', async () => {
  await assertFails(addDoc(collection(as(null), 'ventra_stores/owned/orders'), order({ status: 'SYNCED' })));
  await assertFails(addDoc(collection(as(null), 'ventra_stores/owned/orders'), order({ items: [] })));
  await assertFails(addDoc(collection(as(null), 'ventra_stores/owned/orders'), order({ admin: true })));
});
test('solo el dueño lee y marca pedidos', async () => {
  await assertFails(getDoc(doc(as(null), 'ventra_stores/owned/orders/o1')));
  await assertFails(getDoc(doc(as('intruso'), 'ventra_stores/owned/orders/o1')));
  await assertSucceeds(getDoc(doc(as('posA'), 'ventra_stores/owned/orders/o1')));
  await assertSucceeds(updateDoc(doc(as('posA'), 'ventra_stores/owned/orders/o1'), { syncedLocal: true }));
});
test('cuentas: cada usuario lee solo la suya y nadie escribe', async () => {
  await assertSucceeds(getDoc(doc(as('userX'), 'ventra_accounts/userX')));
  await assertFails(getDoc(doc(as('userY'), 'ventra_accounts/userX')));
  await assertFails(setDoc(doc(as('userX'), 'ventra_accounts/userX'), { status: 'active' }));
});
test('aviso de versión: lectura pública, escritura prohibida', async () => {
  await assertSucceeds(getDoc(doc(as(null), 'ventra_desktop/latest_version')));
  await assertFails(setDoc(doc(as('cualquiera'), 'ventra_desktop/latest_version'), { version: '9.9.9' }));
});
