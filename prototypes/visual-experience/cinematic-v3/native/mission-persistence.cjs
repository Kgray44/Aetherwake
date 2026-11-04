const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const sourceDigest = source => digest({ hashes: source.hashes, buildAssets: source.buildAssets });
const LIVE = '--missions-persistence-live-only', REOPEN = '--missions-persistence-reopen-only';
function readJSON(file, maxBytes) {
  const info = fs.lstatSync(file); assert(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maxBytes, 'persistence_evidence_size_or_identity');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
/** Only a completed owned synthetic phase may reopen. This is not a general existing-profile exception. */
function assertMissionPersistenceReopen({ profile, argv, source, localAppData = process.env.LOCALAPPDATA }) {
  assert(argv.includes('--integration-vela-missions') && argv.includes(LIVE) && argv.includes(REOPEN) && argv.includes('--bootstrap-vela-api'), 'persistence_reopen_flags_required');
  assert(!argv.some(flag => /^--missions-(?!persistence-live-only$|persistence-reopen-only$)/u.test(flag)) && !argv.includes('--verify-restore'), 'one_persistence_journey_required');
  assert(path.isAbsolute(profile) && /^review-vela-missions-\d+$/u.test(path.basename(profile)) && localAppData &&
    path.resolve(path.dirname(profile)).toLowerCase() === path.resolve(localAppData, 'Aerynth').toLowerCase(), 'owned_persistence_parent_required');
  assert.equal(argv.filter(flag => flag.startsWith('--profile=')).length, 1, 'one_persistence_profile_required');
  assert.equal(path.resolve(argv.find(flag => flag.startsWith('--profile=')).slice(10)).toLowerCase(), path.resolve(profile).toLowerCase(), 'same_persistence_profile_required');
  assert(fs.lstatSync(profile).isDirectory() && !fs.lstatSync(profile).isSymbolicLink() && fs.realpathSync(profile).toLowerCase() === path.resolve(profile).toLowerCase(), 'canonical_persistence_profile_required');
  assert(!fs.existsSync(path.join(profile, 'mission-reopen-evidence')), 'persistence_reopen_already_attempted');
  const root = path.join(profile, 'mission-evidence'); assert(!fs.lstatSync(root).isSymbolicLink(), 'canonical_persistence_evidence_required');
  const receipt = readJSON(path.join(root, 'journey.json'), 1048576), checkpoint = readJSON(path.join(root, 'persistence-checkpoint.json'), 16384);
  assert(receipt.contract === 'aerynth.vela-missions-integration@1' && receipt.passed === true && receipt.nativeCloseConfirmed === true &&
    !receipt.slotFailure && !receipt.errors.length && !receipt.startupErrors.length && receipt.persistence?.phase === 'seed', 'passed_persistence_seed_required');
  assert(checkpoint.contract === 'aerynth.vela-persistence-checkpoint@1' && checkpoint.profile === path.basename(profile) &&
    checkpoint.sourceDigest === sourceDigest(source) && checkpoint.sourceDigest === sourceDigest(receipt.source) &&
    digest(checkpoint) === digest(receipt.persistence.checkpoint) && checkpoint.apiCalls === 1 && checkpoint.agedNativeTurns >= 15 &&
    checkpoint.agedNativeTurns <= 25 && checkpoint.canonicalMessageCount > 12 &&
    ['conversationId','requestId','userMessageId','answerMessageId'].every(key => typeof checkpoint[key] === 'string' && checkpoint[key].length > 0) &&
    ['userContentDigest','answerContentDigest','provenanceDigest'].every(key=>/^[a-f0-9]{64}$/u.test(checkpoint[key])), 'bound_persistence_checkpoint_required');
  return checkpoint;
}
async function run({ argv, root, source, receipt, rpc, js, click, fill, wait, capture, operation, slot }) {
  assert(argv.includes(LIVE) && argv.includes('--bootstrap-vela-api'), 'explicit_persistence_api_authorization_required');
  assert(!argv.some(flag => /^--missions-(?!persistence-live-only$|persistence-reopen-only$)/u.test(flag)), 'one_persistence_journey_required');
  // Main admitted the reopen before creating this phase's exclusive evidence directory.
  const reopen = argv.includes(REOPEN), checkpoint = reopen ? readJSON(path.join(root,'mission-evidence','persistence-checkpoint.json'),16384) : null;
  if(checkpoint)assert(checkpoint.sourceDigest===sourceDigest(source)&&checkpoint.profile===path.basename(root),'bound_persistence_checkpoint_required');
  const SURFACE = '#vela-assistant-surface[data-surface-id="vela"]', composer = SURFACE + ' textarea[aria-label="Message Vela"]', quote = JSON.stringify,
    vela = () => rpc('vela', { name: 'state', input: {} }), usageBefore = await rpc('velaApiUsageStatus', {});
  assert.equal(usageBefore.enabled, true); assert.equal(usageBefore.usedToday, reopen ? 1 : 0, 'exact_persistence_call_budget_required');
  receipt.profileContent = 'Synthetic Aurora server-port decision and native arithmetic aging turns only; exactly one dedicated API request per desktop session.';
  receipt.persistence = { phase: reopen ? 'recall' : 'seed', nativeTurns: [] };
  const ask = async (intent, api) => {
    const prior = new Set((await vela()).requests.map(request => request.id));
    if (!await js(`document.querySelector(${quote(composer)})?.getClientRects().length>0`)) await click('#vela');
    await fill(composer, intent); await click(SURFACE + ' button[aria-label="Send to Vela"]');
    const result = await operation(async () => {
      const end = performance.now() + Math.min(api ? 28000 : 4000, slot.workRemaining());
      while (performance.now() < end) {
        slot.check(); const state = await vela(), request = state.requests.find(item => !prior.has(item.id) && item.intent === intent);
        if (request && ['responded','completed','failed','unknown','invalid-plan','provider-unavailable'].includes(request.state)) return { state, request };
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      throw Error('persistence_turn_deadline');
    }, 'persistence_turn_deadline');
    assert.equal(result.request.state, 'responded', result.request.errorCode ?? result.request.state);
    assert.equal(result.request.providerId, api ? 'openai-api-vela' : null, 'persistence_unexpected_provider');
    const answer = result.state.conversation.messages.find(message => message.id === result.request.response?.messageId);
    assert(answer?.role === 'assistant');if(api)assert(answer.providerId==='openai-api-vela'&&answer.classification==='reported'&&answer.providerContribution?.executionId&&result.request.provenance?.digest,'canonical_persistence_provider_proof_required');
    await wait('Actual canonical persistence response is visible', () => js(`(()=>{const node=document.querySelector(${quote(SURFACE+' .vela-manifestation')}),body=node?.querySelector('.vela-manifestation-content');return node?.dataset.currentMessageId===${quote(answer.id)}&&body&&!body.hidden&&body.getClientRects().length;})()`));
    assert.equal(require('electron').BrowserWindow.getAllWindows().length, 1, 'persistence_extra_review_window');
    return { ...result, answer };
  };
  if (!reopen) {
    const first = await ask('Remember this synthetic Aurora project decision: the server port is 25581. Reply only: Noted.', true);
    const user = first.state.conversation.messages.find(message => message.id === first.request.inputMessageId); assert(user?.content.includes('25581'));
    for (let i = 0; i < 18; i++) { const turn = await ask('What is '+(200+i)+' + 1?', false);
      assert.equal(turn.request.local?.capabilityId, 'local.calculator'); receipt.persistence.nativeTurns.push(turn.request.id); }
    const state = await vela(), before = await rpc('providerActivity', {}), usage = await rpc('velaApiUsageStatus', {});
    assert.equal(before.providerRequests, 1); assert.equal(before.codexConnections, 0); assert.equal(usage.usedToday, 1);
    const marker = { contract: 'aerynth.vela-persistence-checkpoint@1', profile: path.basename(root), sourceDigest: sourceDigest(source),
      conversationId: state.conversation.resourceId, requestId: first.request.id, userMessageId: user.id, answerMessageId: first.answer.id,
      userContentDigest: digest(user.content),answerContentDigest:digest(first.answer.content),provenanceDigest:first.request.provenance.digest,
      canonicalMessageCount: state.conversation.messages.length, agedNativeTurns: 18, apiCalls: 1 };
    assert(state.conversation.messages.findIndex(message => message.id === user.id) < state.conversation.messages.length - 12);
    await capture('00-persistence-aged-native-conversation');
    fs.writeFileSync(path.join(root, 'mission-evidence', 'persistence-checkpoint.json'), JSON.stringify(marker, null, 2), { flag: 'wx' });
    receipt.persistence.checkpoint = marker; receipt.providerActivity = { after: before };
  } else {
    const restored = await vela(); assert.equal(restored.conversation.resourceId, checkpoint.conversationId);
    const user = restored.conversation.messages.find(message => message.id === checkpoint.userMessageId);
    assert(user && digest(user.content) === checkpoint.userContentDigest);assert(restored.conversation.messages.some(message=>message.id===checkpoint.answerMessageId&&digest(message.content)===checkpoint.answerContentDigest));
    assert.equal(restored.requests.find(request=>request.id===checkpoint.requestId)?.provenance?.digest,checkpoint.provenanceDigest);
    const recalled = await ask('What server port did we decide earlier for the Aurora project? Reply with only the port number.', true), history = recalled.request.history;
    assert.equal(recalled.answer.content.trim(), '25581', 'exact_earlier_decision_not_recalled');
    assert(history && history.messages.length <= 4 && Buffer.byteLength(JSON.stringify(history)) <= 4096, 'bounded_persistence_egress_required');
    assert(history.messages.some(message => message.id === checkpoint.userMessageId && digest(message.content) === checkpoint.userContentDigest));
    assert(history.messages.some(message => message.id === checkpoint.answerMessageId));
    assert.equal(history.retrieval?.method, 'lexical-canonical-exchanges'); assert.equal(history.retrieval?.resolution, 'matched');
    assert(!history.messages.some(message => /^What is 2\d\d \+ 1\?$/u.test(message.content)), 'unrelated_native_turns_sent');
    assert.equal(recalled.state.conversation.resourceId, checkpoint.conversationId);
    const activity = await rpc('providerActivity', {}), usage = await rpc('velaApiUsageStatus', {});
    assert.equal(activity.providerRequests, 1); assert.equal(activity.codexConnections, 0); assert.equal(usage.usedToday, 2);
    await capture('00-persistence-recalled-earlier-decision');
    receipt.persistence = { ...receipt.persistence, checkpoint, recallRequestId: recalled.request.id, answerMessageId: recalled.answer.id,
      answer: recalled.answer.content, sourceMessageIds: history.messages.map(message => message.id), historyBytes: Buffer.byteLength(JSON.stringify(history)),
      sourceProvenancePreserved: true, canonicalConversationPreserved: true, usageTotal: 2, historyRetrieval: history.retrieval };
    receipt.providerActivity = { after: activity };
  }
}
module.exports = { assertMissionPersistenceReopen, sourceDigest, digest, run, LIVE, REOPEN };
