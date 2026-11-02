import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeChatGPTFidelityDescriptor, NATIVE_CHATGPT_AIM_IDS } from '../src/native-chatgpt-fidelity.ts';

test('machine-readable report has the exact 13 independent human aims in order', () => {
  const report=createNativeChatGPTFidelityDescriptor();
  assert.equal(report.id,'openai.native-chatgpt-account-fidelity');
  assert.equal(report.schemaVersion,1);
  assert.equal(report.providerId,'chatgpt');
  assert.deepEqual(report.aims.map(aim=>aim.id),NATIVE_CHATGPT_AIM_IDS);
  assert.deepEqual(report.aims.map(aim=>aim.label),['Same-account auth','Existing chat discovery','Existing chat continuation','NEW chat creation','Web/desktop sync','Existing ChatGPT Projects','Custom instructions','Account memories','Personalization settings','Model selection','Usage entitlements','ChatGPT vs Codex identity','CROSS-provider handoffs']);
  assert.equal(new Set(report.aims.map(aim=>aim.id)).size,13);
  assert.equal(report.nativeAccountFidelity,'not-established');
});

test('Unsupported always names SIWC and keeps other native interfaces explicitly Unverified', () => {
  const excluded=createNativeChatGPTFidelityDescriptor().aims.filter(aim=>aim.status==='Unsupported');
  assert.deepEqual(excluded.map(aim=>aim.id),['existing-chat-discovery','existing-chat-continuation','custom-instructions','account-memories','personalization-settings']);
  for(const aim of excluded){
    assert.equal(aim.interfaceName,'Sign in with ChatGPT (identity and ChatGPT plan usage)');
    assert.match(aim.statusScope,/SIWC/);
    assert.deepEqual(aim.otherNativeInterfaces,{status:'Unverified',reasonCode:'public_interface_not_established'});
    assert.ok(aim.evidence.some(source=>source.observation==='explicit-exclusion'));
  }
});

test('documented identity and plan eligibility do not claim app availability or account verification', () => {
  const report=createNativeChatGPTFidelityDescriptor();
  assert.equal(report.aims.find(aim=>aim.id==='same-account-auth')!.status,'RequiresAdditionalAuthorization');
  assert.equal(report.aims.find(aim=>aim.id==='usage-entitlements')!.status,'RequiresAdditionalAuthorization');
  assert.equal(report.aims.find(aim=>aim.id==='model-selection')!.status,'Unverified');
  assert.equal(report.review.runtimeAccountVerification,'not-performed');
  assert.match(report.statusDefinitions.Supported,/not runtime authorization or app availability/);
  assert.match(report.statusDefinitions.RequiresAdditionalAuthorization,/does not make the app available or authorized/);
  assert.match(report.statusDefinitions.Unverified,/absence is not proof/);
  assert.match(report.statusDefinitions.Unsupported,/named interface/);
});

test('eligible inference and local navigation remain outside the 13 native-account aims', () => {
  const report=createNativeChatGPTFidelityDescriptor();
  assert.deepEqual(report.relatedCapabilities.map(item=>item.id),['eligible-plan-responses-inference','local-codex-navigation']);
  assert.equal(report.relatedCapabilities[0].implementation,'on-hold');
  assert.equal(report.relatedCapabilities[1].implementation,'source-tested-host-unwired');
  for(const item of report.relatedCapabilities){
    assert.equal(item.satisfiesNativeAccountFidelity,false);
    assert.ok(!report.aims.some(aim=>String(aim.id)===item.id));
  }
  for(const id of ['new-chat-creation','web-desktop-sync','existing-chatgpt-projects','cross-provider-handoffs'])assert.equal(report.aims.find(aim=>aim.id===id)!.status,'Unverified');
});

test('every assessment supplies exact interface, scope, stable reason and official evidence; JSON is renderer-safe', () => {
  const report=createNativeChatGPTFidelityDescriptor();
  for(const aim of report.aims){
    assert.ok(aim.interfaceName&&aim.statusScope&&aim.reasonCode&&aim.reason);
    assert.ok(Object.hasOwn(report.statusDefinitions,aim.status));
    assert.ok(aim.evidence.length);
    for(const evidence of aim.evidence){
      const url=new URL(evidence.url);
      assert.equal(url.protocol,'https:');
      assert.ok(['developers.openai.com','learn.chatgpt.com'].includes(url.hostname)||(url.hostname==='github.com'&&url.pathname.startsWith('/openai/codex/')));
      assert.equal(url.username,'');assert.equal(url.password,'');
      assert.ok(evidence.section&&evidence.observation);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(report)),report);
  assert.equal('available' in report,false,'provider runtime booleans remain owned by providers()');
  assert.equal('models' in report,false,'documentation never fabricates an account catalog');
});

test('reports are independent projections with no shared mutable evidence or status state', () => {
  const changed=createNativeChatGPTFidelityDescriptor() as unknown as {aims:{id:string;status:string;evidence:{url:string}[];otherNativeInterfaces?:{status:string}}[]};
  changed.aims[0].status='Supported';changed.aims[0].evidence[0].url='https://example.test';
  changed.aims.find(aim=>aim.id==='existing-chat-discovery')!.otherNativeInterfaces!.status='Supported';
  const fresh=createNativeChatGPTFidelityDescriptor();
  assert.equal(fresh.aims[0].status,'RequiresAdditionalAuthorization');
  assert.equal(fresh.aims[0].evidence[0].url,'https://developers.openai.com/siwc/quickstart');
  assert.equal(fresh.aims.find(aim=>aim.id==='existing-chat-discovery')!.otherNativeInterfaces!.status,'Unverified');
  assert.ok(Object.isFrozen(NATIVE_CHATGPT_AIM_IDS));
});
