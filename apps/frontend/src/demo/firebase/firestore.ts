// SOLO DEMO PÚBLICA: reemplaza a 'firebase/firestore' al compilar la demo (ver vite.config.ts,
// VENTRA_DEMO=true). Misma forma de uso que el SDK, pero los documentos viven en el navegador
// del visitante (localStorage): en la demo nada se escribe en el Firebase real.
// Implementa solo lo que usa la app: doc/collection/query/where/orderBy/limit, lecturas,
// escrituras, lotes, transacciones y onSnapshot.
import { seedDemoData } from '../seed';

const KEY = 'ventra_demo_firestore';

// ─── Timestamp ───
export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromMillis(ms: number) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d: Date) { return Timestamp.fromMillis(d.getTime()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  valueOf() { return String(this.toMillis()).padStart(15, '0'); }
}
export type Firestore = { __demo: true };

const DELETE = { __demoDelete: true };
export const deleteField = () => DELETE as any;
export const serverTimestamp = () => Timestamp.now() as any;

// ─── Almacenamiento ───
type Data = Record<string, any>;
const encode = (v: any): any => {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
};
const decode = (v: any): any => {
  if (v && typeof v === 'object' && '__ts' in v && Object.keys(v).length === 1) return Timestamp.fromMillis(v.__ts);
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  return v;
};

let docs: Record<string, Data> | null = null;
function store(): Record<string, Data> {
  if (docs) return docs;
  try { docs = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { docs = null; }
  if (!docs) {
    docs = {};
    seedDemoData((path, data) => { docs![path] = encode(data); });
    persist();
  }
  return docs!;
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(docs)); } catch { /* sin espacio: queda en memoria */ }
}

const listeners = new Set<() => void>();
const notify = () => { persist(); queueMicrotask(() => listeners.forEach((l) => l())); };

// ─── Referencias ───
type DocRef = { type: 'document'; path: string; id: string; parent: ColRef };
type ColRef = { type: 'collection'; path: string; id: string };
type Constraint = { kind: 'where'; field: string; op: string; value: any } | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' } | { kind: 'limit'; n: number };
type Query = { type: 'query'; col: ColRef; constraints: Constraint[] };

const join = (base: string, parts: string[]) => [base, ...parts].filter(Boolean).join('/');
const newId = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 10);

export function getFirestore(_app?: any): Firestore { return { __demo: true }; }

export function collection(parent: any, ...segments: string[]): ColRef {
  const base = parent && parent.type === 'document' ? parent.path : '';
  const path = join(base, segments);
  return { type: 'collection', path, id: path.split('/').pop()! };
}

export function doc(parent: any, ...segments: string[]): DocRef {
  let path: string;
  if (parent && parent.type === 'collection') path = join(parent.path, segments.length ? segments : [newId()]);
  else if (parent && parent.type === 'document') path = join(parent.path, segments);
  else path = join('', segments);
  const parts = path.split('/');
  return { type: 'document', path, id: parts[parts.length - 1], parent: { type: 'collection', path: parts.slice(0, -1).join('/'), id: parts[parts.length - 2] } };
}

export const where = (field: string, op: string, value: any): Constraint => ({ kind: 'where', field, op, value });
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field, dir });
export const limit = (n: number): Constraint => ({ kind: 'limit', n });
export function query(col: ColRef | Query, ...constraints: Constraint[]): Query {
  return col.type === 'query' ? { ...col, constraints: [...col.constraints, ...constraints] } : { type: 'query', col, constraints };
}

// ─── Lecturas ───
const getField = (data: Data, field: string) => field.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), data);
const cmpVal = (v: any) => (v instanceof Timestamp ? v.toMillis() : v);
const compare = (a: any, b: any) => { const x = cmpVal(a), y = cmpVal(b); return x === y ? 0 : x == null ? -1 : y == null ? 1 : x < y ? -1 : 1; };

function matches(data: Data, c: Constraint & { kind: 'where' }) {
  const v = getField(data, c.field);
  switch (c.op) {
    case '==': return compare(v, c.value) === 0;
    case '!=': return compare(v, c.value) !== 0;
    case '<': return v != null && compare(v, c.value) < 0;
    case '<=': return v != null && compare(v, c.value) <= 0;
    case '>': return v != null && compare(v, c.value) > 0;
    case '>=': return v != null && compare(v, c.value) >= 0;
    case 'in': return (c.value as any[]).some((x) => compare(v, x) === 0);
    case 'array-contains': return Array.isArray(v) && v.some((x) => compare(x, c.value) === 0);
    default: return false;
  }
}

function snapshotOf(ref: DocRef) {
  const raw = store()[ref.path];
  const data = raw ? decode(raw) : undefined;
  return { id: ref.id, ref, exists: () => !!raw, data: () => (data ? { ...data } : undefined), get: (f: string) => (data ? getField(data, f) : undefined) };
}

function runQuery(q: Query | ColRef) {
  const col = q.type === 'query' ? q.col : q;
  const constraints = q.type === 'query' ? q.constraints : [];
  const prefix = col.path + '/';
  let list = Object.keys(store())
    .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
    .map((p) => snapshotOf(doc({ type: 'collection', path: col.path, id: col.id } as ColRef, p.slice(prefix.length))))
    .filter((s) => constraints.every((c) => c.kind !== 'where' || matches(s.data()!, c)));
  for (const c of constraints) if (c.kind === 'orderBy') list.sort((a, b) => compare(getField(a.data()!, c.field), getField(b.data()!, c.field)) * (c.dir === 'desc' ? -1 : 1));
  const lim = constraints.find((c) => c.kind === 'limit') as { n: number } | undefined;
  if (lim) list = list.slice(0, lim.n);
  return { docs: list, empty: list.length === 0, size: list.length, forEach: (fn: (d: any) => void) => list.forEach(fn), docChanges: () => [] };
}

export async function getDoc(ref: DocRef) { return snapshotOf(ref); }
export async function getDocs(q: Query | ColRef) { return runQuery(q); }

export function onSnapshot(target: any, next: (s: any) => void, error?: (e: Error) => void) {
  const emit = () => { try { next(target.type === 'document' ? snapshotOf(target) : runQuery(target)); } catch (e: any) { error?.(e); } };
  listeners.add(emit);
  queueMicrotask(emit);
  return () => { listeners.delete(emit); };
}

// ─── Escrituras ───
function applyFields(base: Data, patch: Data) {
  const out: Data = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const keys = k.split('.');
    let o = out;
    for (const part of keys.slice(0, -1)) { o[part] = { ...(o[part] || {}) }; o = o[part]; }
    const last = keys[keys.length - 1];
    if (v === DELETE) delete o[last]; else o[last] = encode(v);
  }
  return out;
}
function write(ref: DocRef, data: Data, mode: 'set' | 'merge' | 'update') {
  const all = store();
  if (mode === 'update' && !all[ref.path]) throw new Error(`No existe el documento ${ref.path}`);
  all[ref.path] = mode === 'set' ? applyFields({}, data) : applyFields(all[ref.path] || {}, data);
}

export async function setDoc(ref: DocRef, data: Data, opts?: { merge?: boolean }) { write(ref, data, opts?.merge ? 'merge' : 'set'); notify(); }
export async function updateDoc(ref: DocRef, data: Data) { write(ref, data, 'update'); notify(); }
export async function deleteDoc(ref: DocRef) { delete store()[ref.path]; notify(); }
export async function addDoc(col: ColRef, data: Data) { const ref = doc(col); write(ref, data, 'set'); notify(); return ref; }

export function writeBatch(_db?: any) {
  const ops: (() => void)[] = [];
  const b = {
    set: (ref: DocRef, data: Data, opts?: { merge?: boolean }) => { ops.push(() => write(ref, data, opts?.merge ? 'merge' : 'set')); return b; },
    update: (ref: DocRef, data: Data) => { ops.push(() => write(ref, data, 'update')); return b; },
    delete: (ref: DocRef) => { ops.push(() => { delete store()[ref.path]; }); return b; },
    commit: async () => { ops.forEach((op) => op()); notify(); },
  };
  return b;
}

export async function runTransaction<T>(_db: any, fn: (tx: any) => Promise<T>): Promise<T> {
  const tx = {
    get: async (ref: DocRef) => snapshotOf(ref),
    set: (ref: DocRef, data: Data, opts?: { merge?: boolean }) => { write(ref, data, opts?.merge ? 'merge' : 'set'); return tx; },
    update: (ref: DocRef, data: Data) => { write(ref, data, 'update'); return tx; },
    delete: (ref: DocRef) => { delete store()[ref.path]; return tx; },
  };
  const result = await fn(tx);
  notify();
  return result;
}
