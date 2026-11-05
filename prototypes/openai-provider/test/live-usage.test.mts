import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLiveUsage } from '../live-usage.mts';
test('reported voice duration credits initialization once and never includes backend billing', () => {
  const result = estimateLiveUsage({dispatched:true,usage:{seconds:90,source:'provider-reported',final:true}},100);
  assert.equal(result.reportedSeconds,90); assert.equal(result.estimatedSeconds,90);
  assert.equal(result.estimatedUSD,.075); assert.equal(result.billedUSD,null); assert.equal(result.backendUsageIncluded,false);
  assert.equal(result.basis,'provider-duration');
});
test('unknown delivery exposes potential initialization separately without manufacturing reported seconds or billed spend', () => {
  const result = estimateLiveUsage({dispatched:true,usage:{seconds:null,source:'unavailable',final:false}});
  assert.equal(result.reportedSeconds,null); assert.equal(result.estimatedUSD,null); assert.equal(result.billedUSD,null);
  assert.equal(result.potentialInitializationUSD,.0125); assert.equal(result.basis,'initialization-exposure-only');
  assert.equal(estimateLiveUsage({dispatched:false,usage:{seconds:null,source:'unavailable',final:false}},50).estimatedUSD,0);
});
test('local estimates remain explicitly distinct from final provider usage and reject malformed measurements', () => {
  const result=estimateLiveUsage({dispatched:true,usage:{seconds:null,source:'unavailable',final:false}},20);
  assert.equal(result.reportedSeconds,null);assert.equal(result.estimatedSeconds,20);assert.equal(result.basis,'local-elapsed-estimate');
  assert.throws(()=>estimateLiveUsage({dispatched:true,usage:{seconds:NaN,source:'provider-reported',final:true}}),/live_usage_estimate_invalid/);
  assert.throws(()=>estimateLiveUsage({dispatched:true,usage:{seconds:null,source:'unavailable',final:true}}),/live_usage_estimate_invalid/);
});
