// Pruebas de firestore.rules contra el emulador local (no toca el proyecto real).
// Correr desde Kiosco/firebase/test:  npm install && npm test
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, limit, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';

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
  await assertSucceeds(setDoc(doc(as('posC'), 'ventra_stores/nueva'), { businessName: 'C', ownerUid: 'posC', claimed: true, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as('posC'), 'ventra_stores/otra'), { businessName: 'C', ownerUid: 'posZ', claimed: true, createdAt: serverTimestamp() }));
});
test('una tienda nueva no puede antedatarse ni cambiar su fecha de alta', async () => {
  // La fecha de alta decide qué tienda conserva una dirección repetida (functions/store-slugs.js)
  await assertFails(setDoc(doc(as('posC'), 'ventra_stores/vieja'), { ownerUid: 'posC', claimed: true, createdAt: new Date('2000-01-01') }));
  await assertFails(setDoc(doc(as('posC'), 'ventra_stores/sinfecha'), { ownerUid: 'posC', claimed: true }));
  await assertSucceeds(setDoc(doc(as('posC'), 'ventra_stores/nueva'), { ownerUid: 'posC', claimed: true, createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('posC'), 'ventra_stores/nueva'), { createdAt: new Date('2000-01-01') }));
  await assertSucceeds(updateDoc(doc(as('posC'), 'ventra_stores/nueva'), { businessName: 'Otra' }));
});
test('el registro de direcciones se lee por dirección y nadie lo escribe desde afuera', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'ventra_store_slugs/kiosco-a'), { storeId: 'owned' }));
  await assertSucceeds(getDoc(doc(as(null), 'ventra_store_slugs/kiosco-a')));
  await assertFails(getDocs(collection(as(null), 'ventra_store_slugs')));
  await assertFails(setDoc(doc(as('posA'), 'ventra_store_slugs/kiosco-a'), { storeId: 'owned' }));
  await assertFails(setDoc(doc(as('intruso'), 'ventra_store_slugs/kiosco-nueva'), { storeId: 'mia' }));
  await assertFails(updateDoc(doc(as('intruso'), 'ventra_store_slugs/kiosco-a'), { storeId: 'mia' }));
});
test('solo el dueño sube productos', async () => {
  await assertSucceeds(setDoc(doc(as('posA'), 'ventra_stores/owned/products/p1'), { name: 'x', price: 1 }));
  await assertFails(setDoc(doc(as('intruso'), 'ventra_stores/owned/products/p1'), { name: 'x', price: 1 }));
  await assertSucceeds(getDoc(doc(as(null), 'ventra_stores/owned/products/p1')));
  await assertSucceeds(setDoc(doc(as('posA'), 'ventra_stores/owned/catalog/p0'), { items: [{ productId: 'p1', name: 'x', price: 1 }] }));
  await assertFails(setDoc(doc(as('intruso'), 'ventra_stores/owned/catalog/p0'), { items: [] }));
  await assertSucceeds(getDoc(doc(as(null), 'ventra_stores/owned/catalog/p0')));
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
test('venta a comercios: el link del cliente se lee con su código; listarlos o escribirlos, solo el dueño', async () => {
  await assertSucceeds(setDoc(doc(as('posA'), 'ventra_stores/owned/clients/TOKEN1234567890abcd'), { clientId: 'c1', name: 'Almacén', active: true }));
  await assertSucceeds(getDoc(doc(as(null), 'ventra_stores/owned/clients/TOKEN1234567890abcd')));
  await assertFails(getDocs(collection(as(null), 'ventra_stores/owned/clients')));
  await assertFails(getDocs(collection(as('intruso'), 'ventra_stores/owned/clients')));
  await assertSucceeds(getDocs(collection(as('posA'), 'ventra_stores/owned/clients')));
  await assertFails(setDoc(doc(as(null), 'ventra_stores/owned/clients/TOKEN1234567890abcd'), { clientId: 'otro' }));
  await assertFails(updateDoc(doc(as('intruso'), 'ventra_stores/owned/clients/TOKEN1234567890abcd'), { name: 'x' }));
});
test('venta a comercios: los precios mayoristas se leen solo sabiendo la clave; listarlos o escribirlos, solo el dueño', async () => {
  await assertSucceeds(setDoc(doc(as('posA'), 'ventra_stores/owned/tradePrices/KEY1234567890abcdefgh'), { prices: { p: 650 } }));
  await assertSucceeds(getDoc(doc(as(null), 'ventra_stores/owned/tradePrices/KEY1234567890abcdefgh')));
  await assertFails(getDocs(collection(as(null), 'ventra_stores/owned/tradePrices')));
  await assertFails(getDocs(collection(as('intruso'), 'ventra_stores/owned/tradePrices')));
  await assertSucceeds(getDocs(collection(as('posA'), 'ventra_stores/owned/tradePrices')));
  await assertFails(setDoc(doc(as(null), 'ventra_stores/owned/tradePrices/KEY1234567890abcdefgh'), { prices: { p: 1 } }));
  await assertFails(setDoc(doc(as('intruso'), 'ventra_stores/owned/tradePrices/OTRA'), { prices: { p: 1 } }));
});
test('venta a comercios: el stock libre lo lee cualquiera y lo escribe solo el dueño', async () => {
  await assertSucceeds(setDoc(doc(as('posA'), 'ventra_stores/owned/stock/free'), { units: { p: 5 } }));
  await assertSucceeds(getDoc(doc(as(null), 'ventra_stores/owned/stock/free')));
  await assertFails(getDocs(collection(as(null), 'ventra_stores/owned/stock')));
  await assertFails(setDoc(doc(as(null), 'ventra_stores/owned/stock/free'), { units: { p: 999 } }));
  await assertFails(updateDoc(doc(as('intruso'), 'ventra_stores/owned/stock/free'), { units: {} }));
});
test('venta a comercios: pedido por reparto con el link, y nada de campos de la revisión', async () => {
  const ok = order({ delivery: 'REPARTO', address: 'Calle 1, Bavio', clientToken: 'TOKEN1234567890abcd', items: [{ productId: 'p', name: 'Coca', price: 120, qty: 2, packSize: 12 }], total: 240 });
  await assertSucceeds(addDoc(collection(as(null), 'ventra_stores/owned/orders'), ok));
  await assertFails(addDoc(collection(as(null), 'ventra_stores/owned/orders'), { ...ok, clientToken: 'corto' }));
  // El cliente no puede mandarlo ya "aceptado" ni trabado
  await assertFails(addDoc(collection(as(null), 'ventra_stores/owned/orders'), { ...ok, preorderId: 'x' }));
  await assertFails(addDoc(collection(as(null), 'ventra_stores/owned/orders'), { ...ok, reviewing: true }));
  await assertFails(addDoc(collection(as(null), 'ventra_stores/owned/orders'), { ...ok, chargedAt: serverTimestamp() }));
  // El dueño lo traba, lo acepta o lo carga en la caja
  await assertSucceeds(updateDoc(doc(as('posA'), 'ventra_stores/owned/orders/o1'), { reviewing: true, reviewAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as('posA'), 'ventra_stores/owned/orders/o1'), { preorderId: 'o1', reviewing: false, stage: 'PREPARING' }));
  await assertFails(updateDoc(doc(as('intruso'), 'ventra_stores/owned/orders/o1'), { preorderId: null }));
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

// ─── Consultorio de nutrición: datos de salud, solo el dueño; la historia clínica no se borra ───
const nutri = (db, path) => doc(db, `ventra_stores/owned/nutri_patients/${path}`);
const twoDaysAgo = () => Timestamp.fromMillis(Date.now() - 2 * 864e5);
const seedConsultas = () => env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(nutri(db, 'p1'), { name: 'Laura', visits: 2 });
  await setDoc(nutri(db, 'p1/consultas/vieja'), { dateKey: '2026-08-20', weight: 82, createdAt: twoDaysAgo(), addenda: [{ at: 1, text: 'primera nota' }] });
  await setDoc(nutri(db, 'p1/consultas/nueva'), { dateKey: '2026-10-22', weight: 78, createdAt: Timestamp.now() });
});

test('nutri: el dueño crea y lee pacientes; nadie más los ve', async () => {
  await assertSucceeds(setDoc(nutri(as('posA'), 'p2'), { name: 'Ana' }));
  await assertSucceeds(getDoc(nutri(as('posA'), 'p2')));
  await assertFails(getDoc(nutri(as('intruso'), 'p2')));
  await assertFails(getDoc(nutri(as(null), 'p2')));
  await assertFails(setDoc(nutri(as('intruso'), 'p3'), { name: 'X' }));
});
test('nutri: un paciente no se borra (se archiva)', async () => {
  await seedConsultas();
  await assertFails(deleteDoc(nutri(as('posA'), 'p1')));
  await assertSucceeds(updateDoc(nutri(as('posA'), 'p1'), { archived: true }));
});
test('nutri: la consulta nace con la hora del servidor', async () => {
  await seedConsultas();
  await assertSucceeds(addDoc(collection(as('posA'), 'ventra_stores/owned/nutri_patients/p1/consultas'), { dateKey: '2026-10-22', createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(as('posA'), 'ventra_stores/owned/nutri_patients/p1/consultas'), { dateKey: '2026-10-22', createdAt: twoDaysAgo() }));
  await assertFails(addDoc(collection(as('intruso'), 'ventra_stores/owned/nutri_patients/p1/consultas'), { dateKey: '2026-10-22', createdAt: serverTimestamp() }));
});
test('nutri: en las primeras 24 h la consulta se corrige y se borra', async () => {
  await seedConsultas();
  await assertSucceeds(updateDoc(nutri(as('posA'), 'p1/consultas/nueva'), { weight: 77.5 }));
  await assertFails(updateDoc(nutri(as('posA'), 'p1/consultas/nueva'), { createdAt: twoDaysAgo() }));
  await assertSucceeds(deleteDoc(nutri(as('posA'), 'p1/consultas/nueva')));
});
test('nutri: pasadas 24 h la consulta queda fija y solo se le agregan notas al final', async () => {
  await seedConsultas();
  const ref = nutri(as('posA'), 'p1/consultas/vieja');
  await assertFails(updateDoc(ref, { weight: 80 }));
  await assertFails(deleteDoc(ref));
  // Cambiar una nota anterior, o aprovechar la nota para tocar otro campo: no
  await assertFails(updateDoc(ref, { addenda: [{ at: 1, text: 'cambiada' }, { at: 2, text: 'nueva' }] }));
  await assertFails(updateDoc(ref, { weight: 80, addenda: [{ at: 1, text: 'primera nota' }, { at: 2, text: 'nueva' }] }));
  await assertFails(updateDoc(ref, { addenda: [] }));
  await assertSucceeds(updateDoc(ref, { addenda: [{ at: 1, text: 'primera nota' }, { at: 2, text: 'nueva' }] }));
  await assertFails(updateDoc(nutri(as('intruso'), 'p1/consultas/vieja'), { addenda: [{ at: 1, text: 'primera nota' }, { at: 2, text: 'x' }, { at: 3, text: 'y' }] }));
});

test('nutri: planes, alimentos, plantillas y cobros de packs, solo el dueño', async () => {
  await seedConsultas();
  await assertSucceeds(setDoc(nutri(as('posA'), 'p1/planes/a'), { title: 'Descenso', status: 'active', meals: [] }));
  await assertSucceeds(updateDoc(nutri(as('posA'), 'p1/planes/a'), { title: 'Descenso de peso' }));
  await assertSucceeds(deleteDoc(nutri(as('posA'), 'p1/planes/a')));
  await assertFails(getDoc(nutri(as('intruso'), 'p1/planes/a')));
  for (const col of ['nutri_foods', 'nutri_templates', 'nutri_payments']) {
    await assertSucceeds(setDoc(doc(as('posA'), `ventra_stores/owned/${col}/x`), { name: 'x' }));
    await assertFails(getDoc(doc(as('intruso'), `ventra_stores/owned/${col}/x`)));
    await assertFails(getDoc(doc(as(null), `ventra_stores/owned/${col}/x`)));
  }
});
test('nutri: el link del portal lo crea solo el dueño y nadie más lo lee', async () => {
  const token = 'abcdefghijkmnopqrstuvwx';
  const data = (uid, storeId = 'owned') => ({ ownerUid: uid, storeId, patientId: 'p1', createdAt: serverTimestamp() });
  await assertFails(setDoc(doc(as('intruso'), `nutri_portal/${token}`), data('intruso')));
  await assertFails(setDoc(doc(as('intruso'), `nutri_portal/${token}`), data('posA')));
  await assertFails(setDoc(doc(as('posA'), 'nutri_portal/corto'), data('posA')));
  await assertFails(setDoc(doc(as('posA'), `nutri_portal/${token}`), { ...data('posA'), extra: 1 }));
  await assertSucceeds(setDoc(doc(as('posA'), `nutri_portal/${token}`), data('posA')));
  await assertSucceeds(getDoc(doc(as('posA'), `nutri_portal/${token}`)));
  await assertFails(getDoc(doc(as('intruso'), `nutri_portal/${token}`)));
  await assertFails(getDoc(doc(as(null), `nutri_portal/${token}`)));
  await assertFails(updateDoc(doc(as('posA'), `nutri_portal/${token}`), { patientId: 'p2' }));
  await assertSucceeds(deleteDoc(doc(as('posA'), `nutri_portal/${token}`)));
});

// ─── Agenda: profesionales con usuario propio ───────────────────────
// Sesión del profesional: otra cuenta (pro_<dueño>_<profesional>) con vStore/vStaff, que vale
// mientras exista agenda_pros/<profesional> con ese uid (lo escribe la función ventraStoreSession).
const pro = (staff = 'juan', store = 'owned', uid = `pro_posA_${staff}`) => env.authenticatedContext(uid, { vStore: store, vStaff: staff }).firestore();
const turno = (staffId, extra = {}) => ({ kind: 'booking', staffId, dateKey: '2026-12-01', startMin: 600, endMin: 630, status: 'CONFIRMED', customerName: 'Ana', ...extra });
async function seedPros() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'ventra_stores/owned/agenda_pros/juan'), { uid: 'pro_posA_juan' });
    await setDoc(doc(db, 'ventra_stores/owned/bookings/bJuan'), turno('juan'));
    await setDoc(doc(db, 'ventra_stores/owned/bookings/bPedro'), turno('pedro'));
    await setDoc(doc(db, 'ventra_stores/owned/bookings/bAll'), turno('ALL', { kind: 'block' }));
  });
}

test('profesional: lee sus turnos y los bloqueos del local, no los de otro', async () => {
  await seedPros();
  await assertSucceeds(getDoc(doc(pro(), 'ventra_stores/owned/bookings/bJuan')));
  await assertSucceeds(getDoc(doc(pro(), 'ventra_stores/owned/bookings/bAll')));
  await assertFails(getDoc(doc(pro(), 'ventra_stores/owned/bookings/bPedro')));
  // La consulta de la app (filtrada por profesional) anda; sin filtrar, no
  await assertSucceeds(getDocs(query(collection(pro(), 'ventra_stores/owned/bookings'), where('staffId', 'in', ['juan', 'ALL']), where('dateKey', '>=', '2026-11-01'), where('dateKey', '<=', '2026-12-31'))));
  await assertFails(getDocs(query(collection(pro(), 'ventra_stores/owned/bookings'), where('dateKey', '>=', '2026-11-01'))));
  await assertFails(getDocs(query(collection(pro(), 'ventra_stores/owned/bookings'), where('staffId', '==', 'pedro'))));
});
test('profesional: carga, cambia y borra solo lo suyo', async () => {
  await seedPros();
  await assertSucceeds(addDoc(collection(pro(), 'ventra_stores/owned/bookings'), turno('juan')));
  await assertFails(addDoc(collection(pro(), 'ventra_stores/owned/bookings'), turno('pedro')));
  await assertFails(addDoc(collection(pro(), 'ventra_stores/owned/bookings'), turno('ALL', { kind: 'block' })));
  await assertSucceeds(updateDoc(doc(pro(), 'ventra_stores/owned/bookings/bJuan'), { status: 'DONE' }));
  await assertFails(updateDoc(doc(pro(), 'ventra_stores/owned/bookings/bJuan'), { staffId: 'pedro' }));
  await assertFails(updateDoc(doc(pro(), 'ventra_stores/owned/bookings/bPedro'), { status: 'CANCELLED' }));
  await assertFails(deleteDoc(doc(pro(), 'ventra_stores/owned/bookings/bAll')));
  await assertFails(deleteDoc(doc(pro(), 'ventra_stores/owned/bookings/bPedro')));
  await assertSucceeds(deleteDoc(doc(pro(), 'ventra_stores/owned/bookings/bJuan')));
});
test('profesional: sin el registro de acceso (se lo sacaron) o con otro uid, no ve nada', async () => {
  await seedPros();
  await assertFails(getDoc(doc(pro('juan', 'owned', 'pro_falso'), 'ventra_stores/owned/bookings/bJuan')));
  await assertFails(getDoc(doc(pro('pedro'), 'ventra_stores/owned/bookings/bPedro'))); // pedro no tiene acceso
  await assertFails(getDoc(doc(pro('juan', 'otra'), 'ventra_stores/owned/bookings/bJuan'))); // datos de otra tienda
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'ventra_stores/owned/agenda_pros/juan')));
  await assertFails(getDoc(doc(pro(), 'ventra_stores/owned/bookings/bJuan')));
});
test('profesional: no toca la tienda, los clientes, los pedidos ni el registro de accesos', async () => {
  await seedPros();
  await assertFails(updateDoc(doc(pro(), 'ventra_stores/owned'), { businessName: 'x' }));
  await assertFails(getDocs(collection(pro(), 'ventra_stores/owned/agenda_clients')));
  await assertFails(getDocs(collection(pro(), 'ventra_stores/owned/orders')));
  await assertFails(setDoc(doc(pro(), 'ventra_stores/owned/agenda_pros/juan'), { uid: 'pro_posA_juan' }));
  await assertFails(setDoc(doc(pro(), 'ventra_stores/owned/agenda_pros/pedro'), { uid: 'pro_posA_juan' }));
  // Sus celulares para los avisos: los guarda en su propia cuenta
  await assertSucceeds(setDoc(doc(pro(), 'ventra_push/pro_posA_juan/tokens/t1'), { token: 'x' }));
});
test('dueño: ve todos los turnos y ve/borra los accesos; nadie más los ve', async () => {
  await seedPros();
  await assertSucceeds(getDocs(collection(as('posA'), 'ventra_stores/owned/bookings')));
  await assertSucceeds(getDoc(doc(as('posA'), 'ventra_stores/owned/agenda_pros/juan')));
  await assertFails(setDoc(doc(as('posA'), 'ventra_stores/owned/agenda_pros/juan'), { uid: 'otro' }));
  await assertFails(getDoc(doc(as('intruso'), 'ventra_stores/owned/agenda_pros/juan')));
  await assertSucceeds(deleteDoc(doc(as('posA'), 'ventra_stores/owned/agenda_pros/juan')));
});
