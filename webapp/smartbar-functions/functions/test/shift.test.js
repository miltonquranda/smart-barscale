const { inWindow, localParts, shiftForDate } = require('../lib/controllers/shift');
let pass=0, fail=0;
const eq=(a,b,m)=>{ const ok=JSON.stringify(a)===JSON.stringify(b); ok?pass++:fail++; console.log((ok?'PASS':'FAIL')+' '+m+(ok?'':`  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)); };

// --- window math ---
eq(inWindow(10*60, 8, 16), true,  'Day 08-16 contains 10:00');
eq(inWindow(16*60, 8, 16), false, 'Day 08-16 excludes 16:00 (end exclusive)');
eq(inWindow(8*60,  8, 16), true,  'Day 08-16 includes 08:00 (start inclusive)');
eq(inWindow(23*60, 16, 0), true,  'Evening 16-00 contains 23:00 (wraps to midnight)');
eq(inWindow(2*60,  16, 0), false, 'Evening 16-00 excludes 02:00');
eq(inWindow(2*60,  0,  8), true,  'Late 00-08 contains 02:00');
eq(inWindow(1*60,  22, 2), true,  'Late 22-02 contains 01:00 (wraps midnight)');
eq(inWindow(3*60,  22, 2), false, 'Late 22-02 excludes 03:00');

// --- three shifts must partition the day with no gap/overlap ---
const shifts=[
 {_id:'d',name:'Day',start_hour:8,end_hour:16,days:[],active:true},
 {_id:'e',name:'Evening',start_hour:16,end_hour:0,days:[],active:true},
 {_id:'l',name:'Late',start_hour:0,end_hour:8,days:[],active:true}];
let gaps=0, dupes=0;
for(let m=0;m<1440;m+=15){
  const hits=shifts.filter(s=>inWindow(m,s.start_hour,s.end_hour));
  if(hits.length===0)gaps++; if(hits.length>1)dupes++;
}
eq(gaps,0,'default shifts leave no uncovered minute');
eq(dupes,0,'default shifts never overlap');

// --- timezone bucketing: the reason day boundaries matter ---
// 03:00 UTC on the 5th is still the *evening of the 4th* in New York.
const d=new Date('2026-08-05T03:00:00Z');
eq(localParts(d,'UTC').ymd,'2026-08-05','UTC bucket = 5th');
eq(localParts(d,'America/New_York').ymd,'2026-08-04','NY bucket = 4th (late-night sale counts to prior day)');
eq(shiftForDate(d,shifts,'America/New_York').name,'Evening','23:00 NY -> Evening shift');
eq(shiftForDate(d,shifts,'UTC').name,'Late','03:00 UTC -> Late shift');

// --- pour cost / revenue, the figures an operator will act on ---
// 750ml bottle, $25 cost, $12 per 45ml pour. Two 45ml pours = 90ml.
const vol=750, cost=25, pourPrice=12, pourVol=45, consumed=90;
const consumedValue=Math.round((consumed/vol)*cost*100)/100;      // $3.00
const revenue=Math.round((consumed/pourVol)*pourPrice*100)/100;   // $24.00
const pourCost=Math.round((consumedValue/revenue)*100*100)/100;   // 12.5%
eq(consumedValue,3,'cost of 90ml from a $25/750ml bottle = $3.00');
eq(revenue,24,'2 x 45ml pours at $12 = $24.00');
eq(pourCost,12.5,'pour cost % = cost/revenue = 12.5%');

// Sanity: pour cost must be independent of how much was poured.
const c2=(180/vol)*cost, r2=(180/pourVol)*pourPrice;
eq(Math.round((c2/r2)*100*100)/100,12.5,'pour cost is volume-independent');

// --- weighted vs naive average (why the weighted form matters) ---
// House vodka: heavy volume, healthy margin. Rare scotch: tiny volume, awful margin.
const items=[{cost:100,rev:500},{cost:9,rev:10}];
const weighted=Math.round((items.reduce((s,i)=>s+i.cost,0)/items.reduce((s,i)=>s+i.rev,0))*100*100)/100;
const naive=Math.round(((100/500*100)+(9/10*100))/2*100)/100;
eq(weighted,21.37,'weighted avg pour cost = 21.37% (reflects the money)');
eq(naive,55,'naive mean = 55% -- one rare bottle would dominate');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
