const path=require('path');
require.cache[path.join(__dirname,'..','lib','firebase.js')]={id:'fb',filename:'x',loaded:true,exports:{db:{},bucket:{}}};
const src=require('fs').readFileSync(path.join(__dirname,'..','lib','scripts','dedupe_catalog.js'),'utf8');
const score=new Function('return '+src.match(/function score\([\s\S]*?\n\}/)[0])();
const mergeInto=new Function('return '+src.match(/function mergeInto\([\s\S]*?\n\}/)[0])();

let pass=0,fail=0;
const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b);ok?pass++:fail++;console.log((ok?'PASS':'FAIL')+' '+m+(ok?'':`  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));};

const doc=(id,data)=>({id,data});

console.log('== which duplicate survives ==');
// A measured bottle must always beat an estimated one: someone physically
// weighed it, and that is expensive to reproduce.
const measured=doc('a',{bottle_full_weight_g:1250,bottle_empty_weight_g:505,bottle_volume_ml:750,specs_estimated:false});
const estimated=doc('b',{bottle_full_weight_g:1205,bottle_empty_weight_g:500,bottle_volume_ml:750,specs_estimated:true,pour_price:12,image_url:'x',cost_per_bottle:25});
eq(score(measured)>score(estimated),true,'measured specs outrank an estimate even with fewer other fields');

// Between two estimates, the richer record wins.
const rich=doc('c',{bottle_volume_ml:750,cost_per_bottle:25,pour_price:12,image_url:'x',category:'y',brand:'z'});
const sparse=doc('d',{bottle_volume_ml:750});
eq(score(rich)>score(sparse),true,'richer record wins between two estimates');

// Hand-entered beats bulk-imported at equal richness.
eq(score(doc('e',{source:'manual'}))>score(doc('f',{source:'import'})),true,'manual entry outranks bulk import');

console.log('\n== merging fields ==');
// The winner keeps its own values; gaps are filled from losers.
const winner={name:'Vodka',cost_per_bottle:25,pour_price:null,image_url:''};
const losers=[{name:'Vodka OLD',cost_per_bottle:99,pour_price:12,image_url:'http://img'}];
const merged=mergeInto(winner,losers);
eq(merged.cost_per_bottle,25,'winner cost preserved, NOT overwritten by loser');
eq(merged.name,'Vodka','winner name preserved');
eq(merged.pour_price,12,'null gap filled from loser');
eq(merged.image_url,'http://img','empty-string gap filled from loser');

// A zero is a real value, not a gap.
eq(mergeInto({par_level:0},[{par_level:6}]).par_level,0,'zero treated as a set value, not a gap');

// First loser with a value wins; later ones do not clobber it.
eq(mergeInto({brand:null},[{brand:'First'},{brand:'Second'}]).brand,'First','first loser with a value wins');

// Nothing invented when no one has the field.
eq(mergeInto({name:'X'},[{}]).description,undefined,'absent everywhere stays absent');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
