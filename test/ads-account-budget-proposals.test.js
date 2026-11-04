import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isolate } from './helpers.js';
const home=isolate();process.env.XANDER_ADS_HOST='https://synthetic-account-budget.invalid';process.env.XANDER_LWA_URL='https://synthetic-account-budget.invalid/token';
let budget, calls, timeout, staleReads;
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);assert.equal(u.origin,'https://synthetic-account-budget.invalid');
 const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
 if(u.pathname==='/token')return json({access_token:'SYNTHETIC',expires_in:3600});
 calls.push({method:options.method||'GET',path:u.pathname,body:options.body?JSON.parse(options.body):null});
 if(u.pathname==='/v2/profiles/900')return json({profileId:900,countryCode:'US',currencyCode:'USD',dailyBudget:staleReads ? 5 : budget,timezone:'America/Los_Angeles',accountInfo:{type:'seller',id:'SYNTHETIC',name:'Synthetic'}});
 assert.equal(u.pathname,'/v2/profiles');assert.equal(options.method,'PUT');
 if(timeout)throw Error('synthetic timeout');budget=JSON.parse(options.body)[0].dailyBudget;return json([{profileId:900,code:'SUCCESS'}]);
};
const {updateConfig}=await import('../lib/config.js');const {setSecret}=await import('../lib/secrets.js');const {setSwitch,listSwitches}=await import('../lib/switches.js');
const {prepareChange,executeChange,verifyChange,reconcileAccountBudgetRollback,loadProposal}=await import('../lib/proposals.js');
const OP='ads.sp.account.budget';
const prep=value=>prepareChange({store:'synthetic',marketplace:'US',changes:[{op:OP,value}]});
const exec=p=>executeChange({proposalId:p.proposalId,hash:p.hash,approved:true});
test.beforeEach(()=>{fs.rmSync(home,{recursive:true,force:true});fs.mkdirSync(home,{recursive:true});budget=5;calls=[];timeout=false;staleReads=false;setSecret('ads:synthetic',{clientId:'SYNTHETIC',clientSecret:'SYNTHETIC',refreshToken:'SYNTHETIC'});updateConfig(c=>{c.stores={synthetic:{region:'NA',sellerId:'SYNTHETIC',defaultMarketplace:'US',ads:{profiles:{US:'900'}}}};c.settings.approvalMode='chat';c.settings.dryRun=false;});});
test.after(()=>fs.rmSync(home,{recursive:true,force:true}));
test('new account switch defaults off and blocks even approved execution',async()=>{assert.equal(listSwitches().items.find(x=>x.id===OP).on,false);const p=await prep(1);assert.equal(p.ok,true);await assert.rejects(exec(p),/开关/);assert.equal(calls.filter(c=>c.method==='PUT').length,0);});
test('approved execution preserves full proposal hash and sends only budget once',async()=>{setSwitch(OP,true,'synthetic-test');const p=await prep(1);const r=await exec(p);assert.equal(r.status,'API_STATE_VERIFIED');assert.deepEqual(calls.filter(c=>c.method==='PUT'),[{method:'PUT',path:'/v2/profiles',body:[{profileId:900,dailyBudget:1}]}]);await assert.rejects(exec(p),/状态/);});
test('dry run sends nothing',async()=>{setSwitch(OP,true,'synthetic-test');updateConfig(c=>{c.settings.dryRun=true;});const p=await prep(1);const r=await exec(p);assert.equal(r.items[0].结果,'DRY_RUN');assert.equal(budget,5);});
test('changed source amount prevents stale execution',async()=>{setSwitch(OP,true,'synthetic-test');const p=await prep(1);budget=9;const r=await exec(p);assert.equal(r.items[0].结果,'SKIPPED_STALE');assert.equal(calls.filter(c=>c.method==='PUT').length,0);});
test('changed profile binding prevents reads/writes against another profile',async()=>{setSwitch(OP,true,'synthetic-test');const p=await prep(1);updateConfig(c=>{c.stores.synthetic.ads.profiles.US='901';});const r=await exec(p);assert.equal(r.items[0].结果,'SKIPPED_STALE');assert.equal(calls.filter(c=>c.method==='PUT').length,0);});
test('lost response blocks another mutation until original is reconciled',async()=>{setSwitch(OP,true,'synthetic-test');const p=await prep(1);timeout=true;await exec(p);assert.equal(calls.filter(c=>c.method==='PUT').length,1);const next=await prep(2);assert.equal(next.ok,false);assert.match(next.errors[0].error,/未核验/);budget=1;timeout=false;await verifyChange({proposalId:p.proposalId});assert.equal(calls.filter(c=>c.method==='PUT').length,1);});

const reconcile=(p,extra={})=>reconcileAccountBudgetRollback({proposalId:p.proposalId,hash:p.hash,confirmed:true,profileId:'900',appliedValue:1,restoredValue:5,observedAt:new Date().toISOString(),appliedEvidence:'Synthetic console observation: applied value 1',restoredEvidence:'Synthetic console refresh: original value 5 restored',...extra});
async function pendingRollback() {
 setSwitch(OP,true,'synthetic-test');const p=await prep(1);staleReads=true;assert.equal((await exec(p)).status,'AWAITING_READBACK');budget=5;staleReads=false;return p;
}
test('external console rollback closes only the local record, preserves hash, unblocks next proposal and never writes',async()=>{
 const p=await pendingRollback();const original=loadProposal(p.proposalId);const before=calls.filter(c=>c.method==='PUT').length;
 assert.equal((await prep(2)).ok,false);const r=await reconcile(p);assert.equal(r.status,'EXTERNALLY_RECONCILED');assert.match(r.items[0].说明,/本地核验收尾/);
 const saved=loadProposal(p.proposalId);assert.equal(saved.hash,original.hash);assert.deepEqual(saved.items[0].request,original.items[0].request);assert.equal(saved.items[0].new,1);assert.equal(saved.items[0].externalReconciliation.apiCurrentValue,5);
 assert.equal((await prep(2)).ok,true);assert.equal(calls.filter(c=>c.method==='PUT').length,before);
 await assert.rejects(exec(p),/状态/);assert.equal((await verifyChange({proposalId:p.proposalId})).status,'EXTERNALLY_RECONCILED');
 assert.equal((await reconcile(p)).status,'EXTERNALLY_RECONCILED');assert.equal(calls.filter(c=>c.method==='PUT').length,before);
});
test('external reconciliation rejects missing confirmation, wrong hash/profile, arbitrary values and empty evidence',async()=>{
 const p=await pendingRollback();for(const extra of [{confirmed:false},{hash:'wrong'},{profileId:'901'},{appliedValue:2},{restoredValue:4},{appliedEvidence:''},{restoredEvidence:'  '}])await assert.rejects(reconcile(p,extra));
 assert.equal(loadProposal(p.proposalId).status,'AWAITING_READBACK');assert.equal((await prep(2)).ok,false);
});
test('external reconciliation refuses stale/future observations and current value disagreement',async()=>{
 const p=await pendingRollback();for(const observedAt of ['bad',new Date(Date.now()-360000).toISOString(),new Date(Date.now()+60000).toISOString()])await assert.rejects(reconcile(p,{observedAt}));
 budget=6;await assert.rejects(reconcile(p),/当前接口值/);assert.equal(loadProposal(p.proposalId).status,'AWAITING_READBACK');
});
test('external reconciliation never unlocks unknown writes or a changed account',async()=>{
 setSwitch(OP,true,'synthetic-test');const p=await prep(1);timeout=true;await exec(p);timeout=false;budget=5;
 await assert.rejects(reconcile(p),/结果未知/);assert.equal((await prep(2)).ok,false);
});
test('external reconciliation rejects changed profile binding',async()=>{
 const p=await pendingRollback();updateConfig(c=>{c.stores.synthetic.ads.profiles.US='901';});await assert.rejects(reconcile(p),/profile/);
});
test('external reconciliation rejects dry-run and already API-verified proposals',async()=>{
 setSwitch(OP,true,'synthetic-test');updateConfig(c=>{c.settings.dryRun=true;});const p=await prep(1);await exec(p);await assert.rejects(reconcile(p),/真实执行/);
 updateConfig(c=>{c.settings.dryRun=false;});const q=await prep(2);await exec(q);await assert.rejects(reconcile(q,{appliedValue:2}),/仅成功受理/);
});
