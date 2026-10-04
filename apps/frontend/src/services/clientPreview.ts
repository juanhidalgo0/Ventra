import { create } from 'zustand';
import { doc, getDoc, getDocs, collection, query, where, limit, addDoc, updateDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getVentraDb, ensureVentraSession } from './ventraFirebase';
import { fetchOnlineSummary } from './onlineStore';
import { fullAgenda, startAtMs, toMin } from './agendaCore';
import { IS_DEMO_BUILD } from '../demo/flag';

/**
 * "Vista del cliente": la página pública de verdad (firebase/tienda/index.html) dentro de la app,
 * para que el comercio vea su tienda o su página de turnos como la ven sus clientes, aunque
 * todavía no la haya publicado. La página lee los datos del comercio por este puente
 * (window.__ventraClientPreview) y NUNCA escribe en la nube: los pedidos y las reservas se
 * simulan. En la demo pública la reserva sí queda en la agenda local del visitante, así ve
 * cómo le llega un turno.
 */

export type PreviewSection = 'tienda' | 'turnos';

interface PreviewState {
  open: { storeId: string; section: PreviewSection; note?: string } | null;
  show: (storeId: string, section: PreviewSection, note?: string) => void;
  close: () => void;
}

export const useClientPreview = create<PreviewState>((set) => ({
  open: null,
  show: (storeId, section, note) => set({ open: { storeId, section, note } }),
  close: () => set({ open: null }),
}));

/** Estados de turno que ocupan horario (igual que ACTIVE en firebase/functions/agenda.js) */
const ACTIVE = new Set(['PENDING', 'CONFIRMED', 'DONE', 'BLOCK']);

/** Valores de Firestore a JSON simple (las fechas, en milisegundos): la página vive en otro marco */
const plain = (v: any): any => {
  if (v instanceof Timestamp) return v.toMillis();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};

const code = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

/** Arma el puente para una tienda. Devuelve también el slug que usa la página. */
export async function createPreviewBridge(storeId: string) {
  await ensureVentraSession();
  const db = getVentraDb();
  const storeSnap = await getDoc(doc(db, 'ventra_stores', storeId));
  const store = storeSnap.exists() ? (storeSnap.data() as any) : {};
  const slug = store.subdomain || 'vista-previa';
  const agenda = fullAgenda(store.agenda);

  // Lo que hoy ve el público si ya publicó el catálogo; si no, lo que se publicaría
  let catalogParts = Number(store.catalogParts) || 0;
  if (catalogParts) {
    const parts = await Promise.all(Array.from({ length: catalogParts }, (_, i) => getDoc(doc(db, 'ventra_stores', storeId, 'catalog', `p${i}`)).catch(() => null)));
    if (parts.some((p) => !p?.exists())) catalogParts = 0;
  }
  let localProducts: any[] | null = null;
  const productsOf = async () => {
    if (!localProducts) {
      localProducts = await fetchOnlineSummary().catch(() => []);
      // Sin fotos en el resumen ('x' = tiene foto en la PC): la página muestra la inicial
      localProducts = localProducts.map((p) => ({ ...p, imageUrl: p.imageUrl && p.imageUrl !== 'x' ? p.imageUrl : '' }));
    }
    return localProducts.map((p) => ({ id: p.productId, data: p }));
  };

  // Para que se vea como quedaría publicada: visible, con la agenda prendida si está armada
  const storeForClient = {
    ...plain(store),
    isPublished: true,
    claimed: true,
    subdomain: slug,
    catalogParts,
    agenda: { ...plain(agenda), enabled: agenda.enabled || (agenda.services.length > 0 && agenda.staff.length > 0) },
  };

  const busyOf = async (dateKey: string) => {
    const day = await getDocs(query(collection(db, 'ventra_stores', storeId, 'bookings'), where('dateKey', '==', dateKey)));
    return day.docs.map((d) => d.data() as any).filter((b) => ACTIVE.has(b.status)).map((b) => ({ staffId: b.staffId, s: b.startMin, e: b.endMin }));
  };

  const get = async (path: string): Promise<any> => {
    const parts = path.split('/');
    if (parts[0] === 'ventra_store_slugs') return parts[1] === slug ? { storeId } : null;
    if (path === `ventra_stores/${storeId}`) return storeForClient;
    if (parts[0] === 'ventra_stores' && parts[1] === storeId && parts[2] === 'agenda_busy') {
      const items = await busyOf(parts[3]);
      return items.length ? { items } : null;
    }
    if (parts[0] !== 'ventra_stores' || parts[1] !== storeId) return null;
    const s = await getDoc(doc(db, path)).catch(() => null);
    return s?.exists() ? plain(s.data()) : null;
  };

  const list = async (path: string, wheres: [string, string, any][], lim: number) => {
    if (path === `ventra_stores/${storeId}/products`) return productsOf();
    if (path === 'ventra_stores') {
      const ok = wheres.every(([f, , v]) => (storeForClient as any)[f] === v);
      return ok ? [{ id: storeId, data: storeForClient }] : [];
    }
    if (!path.startsWith(`ventra_stores/${storeId}/`)) return [];
    let q: any = collection(db, path);
    q = query(q, ...wheres.map(([f, o, v]) => where(f, o as any, v)), ...(lim ? [limit(lim)] : []));
    const snap = await getDocs(q).catch(() => null);
    return snap ? snap.docs.map((d: any) => ({ id: d.id, data: plain(d.data()) })) : [];
  };

  /** Reserva desde la página: misma respuesta que la función agendaBook */
  const book = async (b: { serviceId: string; staffId: string; date: string; time: string; name: string; phone: string; note?: string }) => {
    const service = agenda.services.find((s) => s.id === b.serviceId && s.active !== false);
    if (!service) return { status: 400, body: { error: 'Ese servicio ya no está disponible' } };
    const staffList = agenda.staff.filter((s) => s.active !== false && (b.staffId === 'ANY' || s.id === b.staffId) && (!service.staffIds?.length || service.staffIds.includes(s.id)));
    const startMin = toMin(b.time);
    const dur = Math.max(5, Number(service.durationMin) || 30);
    const busy = await busyOf(b.date);
    const staff = staffList.find((s) => !busy.some((x) => (x.staffId === s.id || x.staffId === 'ALL') && x.s < startMin + dur && startMin < x.e));
    if (!staff) return { status: 409, body: { error: 'Ese horario se acaba de ocupar. Elegí otro.' } };
    const status = agenda.autoConfirm === false ? 'PENDING' : 'CONFIRMED';
    const bookingCode = code();
    // Solo en la demo queda guardado (en el navegador): en un comercio real nunca se crea un turno de prueba
    let id = `preview_${bookingCode}`;
    if (IS_DEMO_BUILD) {
      const phone = b.phone.trim();
      const ref = await addDoc(collection(db, 'ventra_stores', storeId, 'bookings'), {
        kind: 'booking', dateKey: b.date, startMin, endMin: startMin + dur, startAt: Timestamp.fromMillis(startAtMs(b.date, startMin)),
        staffId: staff.id, staffName: staff.name, serviceId: service.id, serviceName: service.name, durationMin: dur, price: Number(service.price) || 0,
        customerName: b.name.trim(), customerPhone: phone, customerPhoneKey: phone.replace(/\D/g, '').slice(-10), customerNote: (b.note || '').trim(),
        code: bookingCode, status, source: 'online', createdAt: serverTimestamp(),
      });
      id = ref.id;
    }
    return { status: 200, body: { ok: true, id, code: bookingCode, staffName: staff.name, serviceName: service.name, date: b.date, time: b.time, status } };
  };

  /** Link del turno (función agendaManage): ver y cancelar. Cancelar solo vale en la demo. */
  const manage = async (m: { id: string; code: string; action: string }) => {
    if (String(m.id).startsWith('preview_')) return { status: 404, body: { error: 'En la vista previa el turno de prueba no se guarda.' } };
    const ref = doc(db, 'ventra_stores', storeId, 'bookings', m.id);
    const snap = await getDoc(ref).catch(() => null);
    const t: any = snap?.exists() ? snap.data() : null;
    if (!t || t.code !== m.code) return { status: 404, body: { error: 'No encontramos ese turno.' } };
    const startMs = t.startAt?.toMillis ? t.startAt.toMillis() : startAtMs(t.dateKey, t.startMin);
    const view = (status: string) => ({ serviceName: t.serviceName || '', staffName: t.staffName || '', date: t.dateKey, time: `${String(Math.floor(t.startMin / 60)).padStart(2, '0')}:${String(t.startMin % 60).padStart(2, '0')}`, status, canCancel: (status === 'PENDING' || status === 'CONFIRMED') && startMs > Date.now() });
    if (m.action !== 'cancel') return { status: 200, body: view(t.status) };
    if (!IS_DEMO_BUILD) return { status: 409, body: { error: 'Vista previa: el turno no se cancela de verdad.' } };
    await updateDoc(ref, { status: 'CANCELLED', cancelledBy: 'client', statusAt: serverTimestamp() });
    return { status: 200, body: { ...view('CANCELLED'), canCancel: false } };
  };

  return {
    slug,
    bridge: {
      manage: (json: string) => manage(JSON.parse(json)).then((r) => JSON.stringify(r)),
      slug,
      get: (path: string) => get(path).then((r) => JSON.stringify(r ?? null)),
      list: (path: string, wheres: [string, string, any][], lim: number) => list(path, wheres, lim).then((r) => JSON.stringify(r)),
      /** Pedidos: no se guardan en ningún lado, solo se muestra cómo sigue */
      add: async (_path: string) => `preview_${code()}`,
      book: (json: string) => book(JSON.parse(json)).then((r) => JSON.stringify(r)),
    },
  };
}

/**
 * La página pública con el puente en lugar de Firebase. Si la página cambia y alguna pieza
 * no se encuentra, devuelve null (la vista previa avisa en vez de mostrar algo roto).
 */
export function buildPreviewHtml(raw: string, section: PreviewSection): string | null {
  let html = raw;
  const swap = (from: string | RegExp, to: string) => {
    const next = html.replace(from, to);
    if (next === html) throw new Error(`Vista del cliente: no se encontró ${String(from).slice(0, 60)}`);
    html = next;
  };
  try {
    swap(/<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-app-compat\.js"><\/script>\s*<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-firestore-compat\.js"><\/script>/,
      `<script>${PREVIEW_SHIM}</script><script>window.__PREVIEW_HASH=${JSON.stringify(section === 'turnos' ? '#turnos' : '')};</script>`);
    html = html.split("decodeURIComponent(location.pathname.replace(/^\\/+|\\/+$/g,''))").join('window.__PREVIEW_SLUG');
    swap("location.hash==='#turnos'", "window.__PREVIEW_HASH==='#turnos'");
    swap('if(!viaApp) window.location.href=url;', 'if(!viaApp) window.__previewWhatsApp(url);');
    // Imágenes propias de la página (logo de Ventra) desde el sitio real
    swap('<head>', '<head><base href="https://tienda.ventra.store/">');
    return html;
  } catch (e) {
    console.warn(e);
    return null;
  }
}

/** Reemplaza al SDK compat de Firebase dentro de la página: todo pasa por el puente del marco padre. */
const PREVIEW_SHIM = `(function(){
var P=parent.__ventraClientPreview;
window.__PREVIEW_SLUG=P.slug;
function snap(path,r){ return {id:path.split('/').pop(),exists:r!=null,ref:docRef(path),data:function(){ return r==null?undefined:JSON.parse(JSON.stringify(r)); }}; }
function docRef(path){ return {id:path.split('/').pop(),path:path,
  get:function(){ return P.get(path).then(function(j){ return snap(path,JSON.parse(j)); }); },
  collection:function(c){ return colRef(path+'/'+c); }}; }
function q(path,w,l){ return {
  where:function(f,o,v){ return q(path,w.concat([[f,o,v]]),l); },
  limit:function(n){ return q(path,w,n); },
  get:function(){ return P.list(path,w,l||0).then(function(j){ var docs=JSON.parse(j).map(function(x){ return snap(path+'/'+x.id,x.data); }); return {docs:docs,size:docs.length,empty:!docs.length,forEach:function(f){ docs.forEach(f); }}; }); }}; }
function colRef(path){ var r=q(path,[],0); r.doc=function(id){ return docRef(path+'/'+id); }; r.add=function(){ return P.add(path).then(function(id){ return docRef(path+'/'+id); }); }; return r; }
var fs=function(){ return {collection:colRef}; };
fs.FieldValue={serverTimestamp:function(){ return null; }};
window.firebase={initializeApp:function(){},firestore:fs};
var realFetch=window.fetch.bind(window);
window.fetch=function(u,o){
  if(String(u).indexOf('/agendaManage')>=0){ var mb=JSON.parse(o.body); return P.manage(JSON.stringify(mb)).then(function(j){ var r=JSON.parse(j); return new Response(JSON.stringify(r.body),{status:r.status,headers:{'Content-Type':'application/json'}}); }); }
  if(String(u).indexOf('/agendaBook')>=0) return P.book(o.body).then(function(j){ var r=JSON.parse(j); return new Response(JSON.stringify(r.body),{status:r.status,headers:{'Content-Type':'application/json'}}); });
  return realFetch(u,o);
};
document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest?e.target.closest('a[href*="#turno="]'):null; if(!a) return;
  var m=a.getAttribute('href').match(/#turno=([A-Za-z0-9_]+)\\.([A-Za-z0-9]{4})/); if(!m||!window.openManage) return;
  e.preventDefault(); if(window.closeSheets) window.closeSheets(); setTimeout(function(){ window.openManage(m[1],m[2].toUpperCase()); },150);
},true);
window.__previewWhatsApp=function(){ if(window.toast) window.toast('Vista previa: el pedido no se envía de verdad'); };
})();`;

const DEMO_NOTE = 'En la demo tu página no está en internet: así la verían tus clientes.';

/** Abre la página pública. En la demo no existe en internet: se muestra la vista del cliente. */
export function openPublicPage(url: string, storeId: string | null | undefined, section: PreviewSection) {
  if (IS_DEMO_BUILD && storeId) { useClientPreview.getState().show(storeId, section, DEMO_NOTE); return; }
  window.open(url, '_blank', 'noopener');
}

/** En la demo, compartir el link muestra la vista del cliente (el link no existe). true si lo resolvió. */
export function demoShareInstead(storeId: string | null | undefined, section: PreviewSection) {
  if (!IS_DEMO_BUILD || !storeId) return false;
  useClientPreview.getState().show(storeId, section, 'En la demo el link no es real. Con tu cuenta lo compartís por WhatsApp o Instagram, y tus clientes ven esto:');
  return true;
}
