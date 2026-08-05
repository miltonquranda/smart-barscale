const path=require('path');
// The script only needs `db` at main(); stub it so the pure parsers can be tested.
require.cache[path.join(__dirname,'..','lib','firebase.js')]={id:'fb',filename:'x',loaded:true,exports:{db:{},bucket:{}}};
const { parseVolumeMl, estimateEmptyWeight, deriveSpecs } = require('../lib/scripts/backfill_bottle_specs.js');
let pass=0,fail=0;
const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b);ok?pass++:fail++;console.log((ok?'PASS':'FAIL')+' '+m+(ok?'':`  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));};

console.log('== volume parsing ==');
eq(parseVolumeMl('750 ml',null),750,'"750 ml"');
eq(parseVolumeMl('750ml',null),750,'"750ml"');
eq(parseVolumeMl('1 L',null),1000,'"1 L" -> 1000ml');
eq(parseVolumeMl('1.75L',null),1750,'"1.75L" -> 1750ml');
eq(parseVolumeMl('70cl',null),700,'"70cl" -> 700ml');
eq(parseVolumeMl('25.4 oz',null),751,'"25.4 oz" -> 751ml');
eq(parseVolumeMl('375',null),375,'bare 375 treated as ml');
// The trap: quantity="1" is a bottle count, not a volume.
eq(parseVolumeMl('1','750'),750,'quantity="1" + weight="750" -> 750ml (count, not volume)');
eq(parseVolumeMl('1',null),null,'quantity="1" with no weight -> null, not 1ml');
eq(parseVolumeMl('',''),null,'empty -> null');
eq(parseVolumeMl(null,null),null,'null -> null');

console.log('\n== empty weight by format ==');
eq(estimateEmptyWeight(750),500,'750ml -> 500g glass');
eq(estimateEmptyWeight(1000),620,'1L -> 620g');
eq(estimateEmptyWeight(50),55,'50ml miniature -> 55g');

console.log('\n== derived specs are internally consistent ==');
const s=deriveSpecs({quantity:'750 ml'});
eq(s.bottle_volume_ml,750,'volume 750');
eq(s.bottle_empty_weight_g,500,'empty 500g');
eq(s.bottle_full_weight_g,1205,'full = 500 + 750*0.94 = 1205g');
const density=(s.bottle_full_weight_g-s.bottle_empty_weight_g)/s.bottle_volume_ml;
eq(Math.abs(density-0.94)<0.01,true,`density ${density.toFixed(3)} g/ml is plausible for spirits`);
eq(s.bottle_full_weight_g>s.bottle_empty_weight_g,true,'full always exceeds empty');
eq(deriveSpecs({quantity:'1'}),null,'undeterminable product returns null rather than guessing');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
