// Minimal in-memory Firestore stand-in: enough of the query surface that
// dashboard.ts and shift.ts exercise, so the real controller code runs unmodified.
class Ts {
  constructor(d){ this._d = d; }
  toDate(){ return this._d; }
  static fromDate(d){ return new Ts(d); }
  static now(){ return new Ts(new Date()); }
  valueOf(){ return this._d.getTime(); }
}
const val = v => (v instanceof Ts ? v._d.getTime() : v);
const cmp = (a, b) => { a = val(a); b = val(b); return a < b ? -1 : a > b ? 1 : 0; };

class Query {
  constructor(docs, filters = [], orders = [], lim = null) {
    this.docs_ = docs; this.filters = filters; this.orders = orders; this.lim = lim;
  }
  where(field, op, value){ return new Query(this.docs_, [...this.filters, {field, op, value}], this.orders, this.lim); }
  orderBy(field, dir='asc'){ return new Query(this.docs_, this.filters, [...this.orders, {field, dir}], this.lim); }
  limit(n){ return new Query(this.docs_, this.filters, this.orders, n); }
  async get(){
    let out = this.docs_.filter(d => this.filters.every(f => {
      const v = d.data[f.field];
      switch(f.op){
        case '==': return val(v) === val(f.value);
        case '>=': return cmp(v, f.value) >= 0;
        case '<=': return cmp(v, f.value) <= 0;
        case '>':  return cmp(v, f.value) > 0;
        case '<':  return cmp(v, f.value) < 0;
        case 'array-contains': return Array.isArray(v) && v.includes(f.value);
        default: throw new Error('unsupported op ' + f.op);
      }
    }));
    for (const o of [...this.orders].reverse()) {
      out = out.slice().sort((a,b) => (o.dir==='desc'?-1:1) * cmp(a.data[o.field], b.data[o.field]));
    }
    if (this.lim != null) out = out.slice(0, this.lim);
    const docs = out.map(d => ({ id: d.id, exists: true, data: () => d.data, ref: { update: async p => Object.assign(d.data, p), delete: async () => {} } }));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: f => docs.forEach(f) };
  }
}

function makeDb(seed){
  const store = {};
  for (const [col, rows] of Object.entries(seed)) {
    store[col] = rows.map((r, i) => ({ id: r._id || `${col}_${i}`, data: { ...r } }));
  }
  let auto = 0;
  return {
    _store: store,
    collection(name){
      if (!store[name]) store[name] = [];
      const docs = store[name];
      const q = new Query(docs);
      q.doc = id => {
        const found = docs.find(d => d.id === id);
        return {
          id,
          async get(){ return { id, exists: !!found, data: () => found && found.data, ref: this }; },
          async set(v){ found ? Object.assign(found.data, v) : docs.push({ id, data: { ...v } }); },
          async update(v){ if (found) Object.assign(found.data, v); },
          async delete(){ const i = docs.indexOf(found); if (i >= 0) docs.splice(i,1); },
        };
      };
      q.add = async v => { const id = `${name}_auto${auto++}`; docs.push({ id, data: { ...v } }); return q.doc(id); };
      return q;
    },
    batch(){ const ops = []; return { set:(r,v)=>ops.push(()=>r.set(v)), update:(r,v)=>ops.push(()=>r.update(v)), delete:r=>ops.push(()=>r.delete()), commit: async()=>{ for(const o of ops) await o(); } }; },
  };
}
module.exports = { makeDb, Ts };
