import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountBudgetOperation } from '../lib/ops-ads-account-budget.js';
import { HttpError } from '../lib/http.js';
const store = { alias: 'synthetic', region: 'NA', sellerId: 'SYNTHETIC_SELLER', defaultMarketplace: 'US', ads: { profiles: { US: '900' } } };
function fixture() {
  const state = { profile: { profileId: 900, countryCode: 'US', currencyCode: 'USD', dailyBudget: 5, timezone: 'America/Los_Angeles', accountInfo: { type: 'seller', name: 'Synthetic', id: 'SYNTHETIC_SELLER' } }, calls: [], receipt: [{ profileId: 900, code: 'SUCCESS' }], error: null };
  const op = createAccountBudgetOperation({ client: async (alias, method, path, options) => {
    state.calls.push({ alias, method, path, ...structuredClone(options) });
    if (method === 'GET') return structuredClone(state.profile);
    if (state.error) throw state.error;
    return state.receipt;
  } });
  return { op, state, c: { op: op.id, marketplace: 'US', value: 1 } };
}
test('reads live seller identity and builds only profileId/dailyBudget', async () => {
  const { op, state, c } = fixture(); const r = await op.read(store, c);
  const checked = op.check(c, r, { budgetChangePctMax: 100 });
  const req = op.build(c, r, checked.newValue);
  assert.deepEqual(req.body, [{ profileId: 900, dailyBudget: 1 }]);
  assert.equal((await op.send(store, req)).status, 'SUBMITTED');
  assert.deepEqual(state.calls[1], { alias:'synthetic', method:'PUT', path:'/v2/profiles', body:req.body, noProfile:true, isWrite:true });
  state.profile.dailyBudget = 1; assert.equal((await op.readback(store, c, 1)).match, true);
});
test('0 cannot remove a cap; missing and zero readbacks are distinct', async () => {
 const {op,state,c}=fixture();const r=await op.read(store,c);assert.throws(()=>op.check({...c,value:0},r),/预算/);state.profile.dailyBudget=0;assert.equal((await op.read(store,c)).old,0);delete state.profile.dailyBudget;await assert.rejects(op.read(store,c),/缺失/);
});
test('rejects wrong seller, vendor, station, currency, profile and region', async () => {
  for (const patch of [{ profileId:901 }, { profileId:['900'] }, { countryCode:'CA' }, { currencyCode:'CAD' }, { accountInfo:{type:'vendor'} }, { accountInfo:{type:'seller',id:'OTHER'} }]) {
    const { op,state,c }=fixture();Object.assign(state.profile,patch);await assert.rejects(op.read(store,c), /核验/);
  }
  const { op,c }=fixture();await assert.rejects(op.read({...store,region:'EU'},c), /NA/);
});
test('rejects extra campaign/other setting fields before any request', async () => {
  const { op,state,c }=fixture();for(const k of ['campaignId','bid','budgetIncrease','profileId'])await assert.rejects(op.read(store,{...c,[k]:1}), /其他字段/);assert.equal(state.calls.length,0);
});
test('rejects unknown, invalid, subminimum, imprecise and excessive values', async () => {
  const { op,c }=fixture();const r=await op.read(store,c);
  for(const value of [null,undefined,'1',-1,NaN,Infinity,0.5,1.001,21000001])assert.throws(()=>op.check({...c,value},r), /预算|上限/);
  assert.throws(()=>op.check({...c,value:20},r,{budgetChangePctMax:50}), /安全上限/);
  assert.throws(()=>op.check({...c,value:5},r), /一致/);
});
test('strictly verifies the approved numeric budget', async () => {
 const {op,state,c}=fixture(); assert.equal((await op.readback(store,c,1)).match,false);state.profile.dailyBudget=0;assert.equal((await op.readback(store,c,0)).match,true);
});
test('malformed, missing, duplicate and wrong-profile receipts remain unknown', async () => {
 for(const receipt of [null,{},[],[{profileId:901,code:'SUCCESS'}],[{profileId:900,code:'SUCCESS'},{profileId:900,code:'SUCCESS'}],[{profileId:900}],[{profileId:900,code:'FUTURE_CODE'}]]){
 const {op,state,c}=fixture();state.receipt=receipt;const r=await op.read(store,c);assert.equal((await op.send(store,op.build(c,r,1))).status,'OUTCOME_UNKNOWN'); }
});
test('explicit rejection differs from timeout and server uncertainty; never retries', async () => {
 for(const status of [400,401,403,404,413,415,422,429,500,503]) {
 const {op,state,c}=fixture();state.error=new HttpError('synthetic',{status,sent:true});const r=await op.read(store,c);const result=await op.send(store,op.build(c,r,1));assert.equal(result.status,status<500?'FAILED':'OUTCOME_UNKNOWN');assert.equal(state.calls.filter(c=>c.method==='PUT').length,1);
 }
 const {op,state,c}=fixture();state.error=Error('lost response');const r=await op.read(store,c);assert.equal((await op.send(store,op.build(c,r,1))).status,'OUTCOME_UNKNOWN');
});
test('unresolved operations lock the same profile regardless of next amount',()=>{
 const {op}=fixture();assert.deepEqual(op.mutationIdentity({}, {profileId:'900',body:[{dailyBudget:1}]}),op.mutationIdentity({}, {profileId:'900',body:[{dailyBudget:0}]}));
});

test('successful write with stale GET stays pending, never falsely verified',async()=>{const {op,c}=fixture();const r=await op.readback(store,c,2,{ok:true});assert.equal(r.match,false);assert.equal(r.status,'AWAITING_READBACK');});
