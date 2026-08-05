const path=require('path'); const { makeDb, Ts }=require('./fakeFirestore.js');
const FN=path.join(__dirname,'..');
const LIB=path.join(FN,'lib');
const now=new Date(); const at=h=>new Date(now.getTime()-h*3600000); const ymd=d=>d.toISOString().slice(0,10);
let pass=0,fail=0;
const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b);ok?pass++:fail++;console.log((ok?'PASS':'FAIL')+' '+m+(ok?'':`\n     got ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`));};

async function run(seed, query={days:7}){
  for(const k of Object.keys(require.cache)) if(k.includes('/lib/')) delete require.cache[k];
  const db=makeDb(seed);
  const fakeAdmin={firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>new Date(),increment:n=>n},Timestamp:Ts,Query:class{}})};
  require.cache[require.resolve('firebase-admin',{paths:[FN]})]={id:'fa',filename:'fa',loaded:true,exports:fakeAdmin};
  require.cache[path.join(LIB,'firebase.js')]={id:'fb',filename:path.join(LIB,'firebase.js'),loaded:true,exports:{db,bucket:{}}};
  const Ctrl=require(path.join(LIB,'controllers','dashboard.js')).default;
  let payload=null,status=0;
  await new Ctrl().get({user:{_id:'u1',business:[{_id:'biz1'}]},query},{status(s){status=s;return this;},json(d){payload=d;return this;}});
  return {status,payload};
}
const BC='00000001';
const base=extra=>({
  businesses:[{_id:'biz1',name:'Bar',timezone:'UTC'}],
  categories:[{_id:'cat1',name:'Vodka'}],
  shifts:[], inventory_events:[], ...extra });

(async()=>{
console.log('== 1. No pour price: revenue/pour cost must be null, never 0 ==');
let r=await run(base({
  bottles:[{_id:'p1',barcode:BC,name:'V',category:'cat1',bottle_volume_ml:750,bottle_full_weight_g:1200,bottle_empty_weight_g:450,cost_per_bottle:25}],
  inventory_readings:[
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:750,total_value_on_hand:25,timestamp:Ts.fromDate(at(5))},
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:600,total_value_on_hand:20,timestamp:Ts.fromDate(at(2))}]}));
eq(r.payload.products[0].consumed_ml,150,'consumption still measured (150ml)');
eq(r.payload.products[0].consumed_value,5,'cost still valued ($5.00)');
eq(r.payload.products[0].revenue_value,null,'revenue is null, NOT $0');
eq(r.payload.products[0].pour_cost_pct,null,'pour cost is null, NOT 0%');
eq(r.payload.summary.totalRevenue,null,'summary revenue null');
eq(r.payload.summary.avgPourCost,null,'summary pour cost null');
eq(r.payload.coverage.missing_pour_price,1,'coverage reports the gap');
eq(r.payload.coverage.revenue_available,false,'revenue flagged unavailable');

console.log('\n== 2. Bottle swap: a >1-bottle drop must not count as a pour ==');
r=await run(base({
  bottles:[{_id:'p1',barcode:BC,name:'V',category:'cat1',bottle_volume_ml:750,bottle_full_weight_g:1200,bottle_empty_weight_g:450,cost_per_bottle:25,pour_price:12,pour_volume_ml:45}],
  inventory_readings:[
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:3000,total_value_on_hand:100,timestamp:Ts.fromDate(at(6))},
    // 2000ml vanishes at once - a swap or mis-scan, not 44 pours
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:1000,total_value_on_hand:33,timestamp:Ts.fromDate(at(4))},
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:900,total_value_on_hand:30,timestamp:Ts.fromDate(at(2))}]}));
eq(r.payload.products[0].consumed_ml,100,'only the plausible 100ml drop counted (2000ml swap ignored)');

console.log('\n== 3. Restock must not read as negative consumption ==');
r=await run(base({
  bottles:[{_id:'p1',barcode:BC,name:'V',category:'cat1',bottle_volume_ml:750,bottle_full_weight_g:1200,bottle_empty_weight_g:450,cost_per_bottle:25,pour_price:12,pour_volume_ml:45}],
  inventory_readings:[
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:700,total_value_on_hand:23,timestamp:Ts.fromDate(at(6))},
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:600,total_value_on_hand:20,timestamp:Ts.fromDate(at(5))},
    {business:'biz1',barcode:BC,product_id:'p1',total_volume_on_hand_ml:5000,total_value_on_hand:166,timestamp:Ts.fromDate(at(3))}]}));
eq(r.payload.products[0].consumed_ml,100,'restock ignored; consumption stays 100ml (not negative)');
eq(r.payload.products[0].on_hand_ml,5000,'on-hand reflects the restock');

console.log('\n== 4. Business with no data ==');
r=await run(base({bottles:[],inventory_readings:[]}));
eq(r.status,200,'empty business returns 200, not an error');
eq(r.payload.empty,true,'flagged empty so the UI shows onboarding');
eq(r.payload.summary.totalRevenue,null,'no fabricated revenue');
eq(r.payload.products,[],'no products');

console.log('\n== 5. User with no business must not trigger a logout loop ==');
for(const k of Object.keys(require.cache)) if(k.includes('/lib/')) delete require.cache[k];
const db=makeDb(base({bottles:[],inventory_readings:[]}));
const fa={firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>new Date(),increment:n=>n},Timestamp:Ts,Query:class{}})};
require.cache[require.resolve('firebase-admin',{paths:[FN]})]={id:'fa',filename:'fa',loaded:true,exports:fa};
require.cache[path.join(LIB,'firebase.js')]={id:'fb',filename:path.join(LIB,'firebase.js'),loaded:true,exports:{db,bucket:{}}};
const C=require(path.join(LIB,'controllers','dashboard.js')).default;
let st=0,pl=null;
await new C().get({user:{_id:'u1'},query:{}},{status(s){st=s;return this;},json(d){pl=d;return this;}});
eq(st,400,'400 (not 403) so the client interceptor does not clear the session');
eq(pl.code,'NO_BUSINESS','machine-readable code for the UI');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
})().catch(e=>{console.error('THREW:',e);process.exit(1);});
