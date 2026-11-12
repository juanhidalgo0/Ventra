// Firestore falso en memoria para las pruebas de mails (documentos, consultas simples, transacciones).
const ts = (m) => ({ toMillis: () => m, _ts: true });
const DELETE = { _delete: true };
const inc = (n) => ({ _inc: n });
const fakeAdmin = { firestore: { Timestamp: { fromMillis: ts, now: () => ts(Date.now()) }, FieldValue: { delete: () => DELETE, increment: inc, serverTimestamp: () => ts(Date.now()) } } };
function merge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === DELETE) delete dst[k];
    else if (v && v._inc !== undefined) dst[k] = (Number(dst[k]) || 0) + v._inc;
    else if (v && typeof v === "object" && !v._ts && !Array.isArray(v)) dst[k] = merge(dst[k] && typeof dst[k] === "object" ? dst[k] : {}, v);
    else dst[k] = v;
  }
  return dst;
}
function fakeDb(data = {}) {
  const col = (name) => (data[name] = data[name] || {});
  const snap = (name, id) => ({ id, exists: id in col(name), data: () => col(name)[id], ref: ref(name, id) });
  // Subcolecciones: viven en data["coleccion/doc/sub"]
  const ref = (name, id) => ({
    _n: name, id, get: async () => snap(name, id), set: async (v) => { merge(col(name)[id] = col(name)[id] || {}, v); }, delete: async () => { delete col(name)[id]; },
    create: async (v) => { if (id in col(name)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 }); col(name)[id] = merge({}, v); },
    collection: (sub) => collection(`${name}/${id}/${sub}`),
  });
  const val = (x) => (x && x.toMillis ? x.toMillis() : x);
  const query = (name, filters, order = null, lim = 1e9) => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]], order, lim),
    orderBy: (f, dir) => query(name, filters, [f, dir], lim),
    limit: (n) => query(name, filters, order, n),
    get: async () => {
      let ids = Object.keys(col(name)).filter((id) => filters.every(([f, op, v]) => {
        const a = val(col(name)[id][f]), b = val(v);
        return op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : op === "<=" ? a <= b : a === b;
      }));
      if (order) ids.sort((x, y) => (val(col(name)[x][order[0]]) - val(col(name)[y][order[0]])) * (order[1] === "desc" ? -1 : 1));
      const docs = ids.slice(0, lim).map((id) => snap(name, id));
      return { docs, size: docs.length };
    },
  });
  let auto = 0;
  function collection(name) {
    return {
      doc: (id) => ref(name, id === undefined ? `auto${++auto}` : id), where: (...w) => query(name, [w]), orderBy: (...o) => query(name, []).orderBy(...o),
      add: async (v) => { const id = `auto${++auto}`; col(name)[id] = merge({}, v); return ref(name, id); },
    };
  }
  return {
    data,
    collection,
    getAll: async (...refs) => refs.map((r) => snap(r._n, r.id)),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v) => merge(col(r._n)[r.id] = col(r._n)[r.id] || {}, v) }),
  };
}

module.exports = { ts, fakeAdmin, fakeDb, merge };
