const path=require('path');
const { makeDb, Ts }=require('./fakeFirestore.js');
const FN=path.join(__dirname,'..');
process.env.SECRET_TOKEN='test-secret-for-unit-tests';

const seed={
  users:[
    {_id:'u_active',  email:'a@x.com', role:'business_admin', business:['biz1'], status:'active'},
    {_id:'u_susp',    email:'s@x.com', role:'business_admin', business:['biz1'], status:'suspended'},
    {_id:'u_admin',   email:'p@x.com', role:'admin',          business:[],       status:'active'},
    {_id:'u_other',   email:'o@x.com', role:'business_admin', business:['biz2'], status:'active'},
  ],
  businesses:[{_id:'biz1',name:'Bar One'},{_id:'biz2',name:'Bar Two'}],
  devices:[{_id:'d1',serialNumber:'SB_TEST',business:'biz1',demo:false}],
};
const db=makeDb(seed);
const fakeAdmin={firestore:Object.assign(()=>db,{FieldValue:{serverTimestamp:()=>new Date(),increment:n=>n},Timestamp:Ts,Query:class{}})};
require.cache[require.resolve('firebase-admin',{paths:[FN]})]={id:'fa',filename:'fa',loaded:true,exports:fakeAdmin};
require.cache[path.join(FN,'lib','firebase.js')]={id:'fb',filename:path.join(FN,'lib','firebase.js'),loaded:true,exports:{db,bucket:{}}};

const auth=require(path.join(FN,'lib','auth.js'));
const jwt=require(path.join(FN,'node_modules','jsonwebtoken'));

let pass=0,fail=0;
const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b);ok?pass++:fail++;console.log((ok?'PASS':'FAIL')+' '+m+(ok?'':`  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));};

const run = (mw, req) => new Promise(resolve => {
  let status=0, body=null, nexted=false;
  const res={status(s){status=s;return this;},json(d){body=d;resolve({status,body,nexted});return this;},sendStatus(s){status=s;resolve({status,body,nexted});return this;}};
  const r = mw(req,res,()=>{nexted=true;resolve({status,body,nexted});});
  if (r && r.catch) r.catch(e=>resolve({error:e}));
});

(async()=>{
console.log('== attachIdentity ==');
let req={headers:{}};
await run(auth.attachIdentity,req);
eq(!!req.user,false,'no token -> no identity (does not throw)');

req={headers:{authorization:'Bearer garbage.not.ajwt'}};
await run(auth.attachIdentity,req);
eq(!!req.user,false,'malformed token -> no identity');

req={headers:{authorization:'Bearer '+jwt.sign({typ:'user',uid:'u_active'},'WRONG-SECRET')}};
await run(auth.attachIdentity,req);
eq(!!req.user,false,'token signed with wrong secret is rejected');

req={headers:{authorization:'Bearer '+auth.signUserToken({_id:'u_active',role:'business_admin'})}};
await run(auth.attachIdentity,req);
eq(req.user?._id,'u_active','valid token resolves the user');
eq(req.user?.business?.[0]?._id,'biz1','business is populated');
eq(req.user?.password,undefined,'password never attached to the request');

req={headers:{authorization:'Bearer '+auth.signUserToken({_id:'u_susp',role:'business_admin'})}};
await run(auth.attachIdentity,req);
eq(!!req.user,false,'suspended account rejected even with a valid token');

req={headers:{authorization:'Bearer '+jwt.sign({typ:'user',uid:'u_active'},process.env.SECRET_TOKEN,{expiresIn:'-1h'})}};
await run(auth.attachIdentity,req);
eq(!!req.user,false,'expired token rejected');

// The React client sends "token <jwt>", the firmware sends "Bearer <jwt>".
req={headers:{authorization:'token '+auth.signUserToken({_id:'u_active',role:'business_admin'})}};
await run(auth.attachIdentity,req);
eq(req.user?._id,'u_active','accepts the client\'s "token <jwt>" scheme');

console.log('\n== requireAuth ==');
eq((await run(auth.requireAuth,{headers:{}})).status,401,'no identity -> 401');
eq((await run(auth.requireAuth,{user:{_id:'u_active'}})).nexted,true,'user identity passes');
eq((await run(auth.requireAuth,{device:{_id:'d1'}})).nexted,true,'device identity passes');
eq((await run(auth.requireUser,{device:{_id:'d1'}})).status,401,'requireUser rejects a device token');

console.log('\n== requireRole ==');
const asAdmin={user:{_id:'u_admin',role:'admin'}};
const asBiz={user:{_id:'u_active',role:'business_admin'}};
eq((await run(auth.requireRole('admin'),asBiz)).status,403,'business_admin blocked from admin route (403, not 401)');
eq((await run(auth.requireRole('admin'),asAdmin)).nexted,true,'admin allowed');
eq((await run(auth.requireRole('business_admin'),asAdmin)).nexted,true,'platform admin passes any role gate');
eq((await run(auth.requireRole('business_admin'),asBiz)).nexted,true,'matching role allowed');
eq((await run(auth.requireRole('admin'),{headers:{}})).status,401,'unauthenticated -> 401 not 403');

console.log('\n== requireBusinessMember ==');
const member={user:{_id:'u_active',role:'business_admin',business:[{_id:'biz1'}]},params:{id:'biz1'}};
const outsider={user:{_id:'u_other',role:'business_admin',business:[{_id:'biz2'}]},params:{id:'biz1'}};
eq((await run(auth.requireBusinessMember,member)).nexted,true,'member can access own business');
eq((await run(auth.requireBusinessMember,outsider)).status,403,'non-member blocked from another business');
eq((await run(auth.requireBusinessMember,{user:{_id:'u_admin',role:'admin'},params:{id:'biz1'}})).nexted,true,'admin can access any business');

console.log('\n== token contents ==');
const decoded=jwt.decode(auth.signUserToken({_id:'u_active',role:'business_admin',email:'a@x.com',password:'$2a$hash'}));
eq(decoded.uid,'u_active','token carries the uid');
eq(decoded.password,undefined,'token does NOT carry the password hash');
eq(decoded.email,undefined,'token does not embed mutable profile data');
eq(typeof decoded.exp,'number','token has an expiry');

const dev=jwt.decode(auth.signDeviceToken({_id:'d1',serialNumber:'SB_TEST'}));
eq(dev.typ,'device','device token typed as device');
eq(typeof dev.exp,'number','device token expires');

// A device token must not be usable as a user identity, or a stolen scale
// would grant dashboard access.
req={headers:{authorization:'Bearer '+auth.signDeviceToken({_id:'d1',serialNumber:'SB_TEST'})}};
await run(auth.attachIdentity,req);
eq(!!req.user,false,'device token does not produce a user identity');
eq(req.device?._id,'d1','device token produces a device identity');

// A password-reset token is single-purpose.
req={headers:{authorization:'Bearer '+auth.signPasswordResetToken({_id:'u_active'})}};
await run(auth.attachIdentity,req);
eq(!!req.user,false,'reset token is not a session token');
eq(req.passwordReset?._id,'u_active','reset token only populates the reset identity');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
})().catch(e=>{console.error('THREW:',e);process.exit(1);});
