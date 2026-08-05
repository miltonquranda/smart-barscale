const path = require('path');
const Module = require('module');
const { makeDb, Ts } = require('./fakeFirestore.js');
const LIB = path.join(__dirname, '..', 'lib');

// ── Fixture ────────────────────────────────────────────────────────────────
// One bottle: 750ml, $25 cost, $12 per 45ml pour.
// Two readings 3h apart in the NY evening: 1500ml -> 1200ml on hand = 300ml poured.
const BC = '00000001';
const now = new Date();
const at = h => new Date(now.getTime() - h * 3600000);
const ymd = d => d.toISOString().slice(0,10);

const seed = {
  businesses: [{ _id: 'biz1', name: 'The Anchor', timezone: 'America/New_York' }],
  bottles: [{ _id: 'prod1', barcode: BC, name: 'House Vodka', brand: 'Well', category: 'cat1',
              bottle_volume_ml: 750, bottle_full_weight_g: 1200, bottle_empty_weight_g: 450,
              cost_per_bottle: 25, pour_price: 12, pour_volume_ml: 45 }],
  categories: [{ _id: 'cat1', name: 'Vodka' }],
  shifts: [
    { _id: 'sh_day',  business: 'biz1', name: 'Day',     start_hour: 8,  end_hour: 16, days: [], active: true, target_pour_cost_pct: 20, color: '#28a745' },
    { _id: 'sh_eve',  business: 'biz1', name: 'Evening', start_hour: 16, end_hour: 0,  days: [], active: true, target_pour_cost_pct: 20, color: '#f0ad4e' },
    { _id: 'sh_late', business: 'biz1', name: 'Late',    start_hour: 0,  end_hour: 8,  days: [], active: true, target_pour_cost_pct: 20, color: '#dc3545' },
  ],
  inventory_readings: [
    { business:'biz1', barcode:BC, product_id:'prod1', product_name:'House Vodka',
      total_volume_on_hand_ml:1500, total_value_on_hand:50, sealed_count:1,
      bottle_volume_ml:750, cost_per_bottle:25, timestamp: Ts.fromDate(at(5)) },
    { business:'biz1', barcode:BC, product_id:'prod1', product_name:'House Vodka',
      total_volume_on_hand_ml:1200, total_value_on_hand:40, sealed_count:1,
      bottle_volume_ml:750, cost_per_bottle:25, timestamp: Ts.fromDate(at(2)) },
  ],
  inventory_events: [
    { business:'biz1', barcode:BC, event_type:'breakage', quantity:1, weight_g:null, date: ymd(at(2)) },
    { business:'biz1', barcode:BC, event_type:'delivery', quantity:6, weight_g:null, date: ymd(at(2)) },
  ],
};

const db = makeDb(seed);

// Stub firebase-admin + our firebase module before the controller loads them.
const origResolve = Module._resolveFilename;
const fakeAdmin = { firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => new Date(), increment: n => n }, Timestamp: Ts, Query: class {} }) };
require.cache[require.resolve('firebase-admin', { paths: [path.join(__dirname,'..')] })] = { id:'fa', filename:'fa', loaded:true, exports: fakeAdmin };
require.cache[path.join(LIB,'firebase.js')] = { id:'fb', filename: path.join(LIB,'firebase.js'), loaded:true, exports: { db, bucket: {} } };

const DashboardCtrl = require(path.join(LIB,'controllers','dashboard.js')).default;

// ── Run ────────────────────────────────────────────────────────────────────
let pass=0, fail=0;
const eq=(a,b,m)=>{ const ok=JSON.stringify(a)===JSON.stringify(b); ok?pass++:fail++; console.log((ok?'PASS':'FAIL')+' '+m+(ok?'':`\n     got ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`)); };

(async () => {
  const ctrl = new DashboardCtrl();
  let payload=null, status=0;
  const res = { status(s){ status=s; return this; }, json(d){ payload=d; return this; } };
  await ctrl.get({ user:{ _id:'u1', business:[{_id:'biz1'}] }, query:{ days:7 } }, res);

  if (status !== 200) { console.log('FAILED, status', status, JSON.stringify(payload)); process.exit(1); }
  const p = payload.products[0];

  eq(status, 200, 'returns 200');
  eq(payload.business.name, 'The Anchor', 'scopes to the caller business');
  eq(payload.business.timezone, 'America/New_York', 'uses business timezone');

  console.log('\n-- consumption --');
  eq(p.consumed_ml, 300, '1500ml -> 1200ml = 300ml consumed');
  eq(p.consumed_value, 10, '300ml of a $25/750ml bottle costs $10.00');
  eq(p.revenue_value, 80, '300ml / 45ml x $12 = $80.00 revenue');
  eq(p.pour_cost_pct, 12.5, 'pour cost = 10/80 = 12.5%');
  eq(p.on_hand_ml, 1200, 'on hand = latest reading');
  eq(p.scans, 2, 'both readings counted');
  eq(p.category, 'Vodka', 'category id resolved to name');
  eq(p.missing, [], 'no missing specs for a fully configured product');

  console.log('\n-- documented loss (replaces the invented tax panel) --');
  eq(p.waste_ml, 750, 'breakage of 1 bottle = 750ml');
  eq(p.waste_value, 25, 'valued at cost = $25.00');
  eq(payload.documentedLosses.map(l=>l.type), ['breakage'], 'only real event types listed');
  eq(payload.summary.totalDocumentedLoss, 25, 'total documented loss = $25.00');
  eq(payload.inboundEvents.map(e=>[e.type,e.value]), [['delivery',150]], 'delivery of 6 x $25 = $150');

  console.log('\n-- shift attribution --');
  const evening = payload.shifts.find(s=>s.name==='Evening');
  const totalScans = payload.shifts.reduce((s,x)=>s+x.scans,0);
  eq(payload.coverage.unattributed_deltas, 0, 'every delta landed in a shift');
  eq(totalScans, 1, 'one consumption delta attributed across all shifts');
  eq(payload.shifts.length, 3, 'all three shifts returned');

  console.log('\n-- summary + coverage --');
  eq(payload.summary.totalConsumed, 10, 'summary consumption = $10.00');
  eq(payload.summary.totalRevenue, 80, 'summary revenue = $80.00');
  eq(payload.summary.avgPourCost, 12.5, 'weighted avg pour cost = 12.5%');
  eq(payload.coverage.revenue_available, true, 'revenue flagged available');
  eq(payload.coverage.missing_pour_price, 0, 'nothing missing pour price');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
