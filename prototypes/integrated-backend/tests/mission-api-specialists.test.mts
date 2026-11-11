import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { BackendCore } from '../src/core.mts';
import type { NativeHostServices } from '../src/native-host.mts';
import type { MissionPlanningOffer, MissionPreview, MissionProjection } from '../src/mission-contracts.mts';

const marker = 'SYNTHETIC_ONLY_API_SPECIALIST_KEY';
const objective = 'Research reproducible event loop experiments with two independent specialists';
const observations = ['Compare identical workloads after a measured warmup.', 'Independent controls are required before attributing a cause.'];
function response(model: string, content = JSON.stringify({ observations }), output?: unknown[]) {
  const id = 'synthetic-' + randomUUID();
  return new Response([
    { type: 'response.created', response: { id, status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: content },
    { type: 'response.completed', response: { id, model, status: 'completed', usage: { input_tokens: 30, output_tokens: 20, total_tokens: 50 },
      output: output ?? [{ type: 'message', id: 'msg-' + id, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content, annotations: [] }] }] } },
  ].map(item => 'data: ' + JSON.stringify(item) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
function fixture() {
  const base = resolve(tmpdir()), dir = mkdtempSync(join(base, 'aerynth-api-specialists-')), path = join(dir, 'canonical.sqlite');
  const key = randomBytes(32), requests: any[] = [], releases: (() => void)[] = [];
  let hold = true;
  let reply = (body: any): Response | Promise<Response> => response(body.model);
  const native: NativeHostServices = { secrets: {
    available: async () => true,
    seal: async text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    open: async bytes => { const data = Buffer.from(bytes), cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0,12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12,-16)), cipher.final()]).toString(); },
  } };
  const api = { fetch: (async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }] });
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + marker);
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (hold) await new Promise<void>(done => releases.push(done));
    return reply(body);
  }) as typeof fetch };
  const create = () => new BackendCore({ path, provider: 'fixture', contentPolicy: 'synthetic-only' }, () => {}, native, undefined, api);
  let core = create();
  return { get core() { return core; }, requests,
    reply(next: typeof reply) { reply = next; },
    async ready() { await core.command('velaApiConfigure', { credential: { configurationId: 'vela-primary', apiKey: marker }, expectedVersion: null }); await core.command('velaApiUsageAuthorize', { expectedVersion: 1, enabled: true }); await core.command('desktop', { type: 'createWorkspace', title: 'Synthetic specialist scope', projectId: null }); },
    async preview(text = objective) { return await core.command('missions', { name: 'preview', input: { objective: text } }) as MissionPreview; },
    async start(preview: MissionPreview) { return await core.command('missionStartReviewed', { objective: preview.plan.objective, fingerprint: preview.fingerprint, requestId: preview.proposalId ?? randomUUID(), ...(preview.proposalId ? { proposalId: preview.proposalId } : {}) }) as MissionProjection; },
    release() { hold = false; releases.splice(0).forEach(done => done()); },
    async reopen() { await core.command('close', {}); core = create(); },
    async close() { hold = false; releases.splice(0).forEach(done => done()); await core.command('close', {}).catch(() => {}); const part = relative(base, resolve(dir)); assert.ok(part.startsWith('aerynth-api-specialists-') && !part.startsWith('..') && !isAbsolute(part)); rmSync(dir, { recursive: true, force: true }); },
  };
}
async function until<T>(read: () => Promise<T> | T, accept: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 400; i++) { const value = await read(); if (accept(value)) return value; await new Promise(done => setTimeout(done, 5)); }
  throw Error('synthetic condition did not settle');
}
const settled = (f: ReturnType<typeof fixture>, id: string) => until(async () => await f.core.command('missions', { name: 'read', input: { id } }) as MissionProjection,
  value => !value.tasks.some(task => task.state === 'running' || task.state === 'cancelling') && !['queued', 'running'].includes(value.outcome));

test('actual Core preserves safe unknown stream diagnostics in both specialist evidence and durable API receipts across reopen',async()=>{
 const f=fixture();try{await f.ready();f.release();f.reply(()=>new Response('data: '+JSON.stringify({type:'response.created',response:{id:'resp-synthetic-unknown-'+randomUUID(),status:'in_progress'}})+'\n\ndata: {malformed\n\n',{headers:{'Content-Type':'text/event-stream','x-request-id':'req_synthetic_specialist'}}));
  const mission=await f.start(await f.preview()),done=await settled(f,mission.id);assert.equal(done.outcome,'uncertain');assert.equal(done.profile.usageReports,0);assert.equal(done.profile.reportedTotalTokens,null);
  for(const task of done.tasks.filter(task=>task.specialist)){const evidence=task.attempts[0].evidence!;assert.equal(task.state,'uncertain');assert.deepEqual(evidence.value,{status:'unknown',errorCode:'invalid_stream_json',httpDiagnostic:{contract:'aerynth.turn-http-diagnostic@1',httpStatus:200,contentType:'event-stream',hasBody:true,serverRequestId:'req_synthetic_specialist',bodyShape:'unavailable',remoteCode:null}});const receipt=(f.core as any).velaApiRuntime.receiptsForRequest(task.attempts[0].id)[0];assert.equal(receipt.errorCode,'invalid_stream_json');assert.equal(receipt.httpDiagnostic.httpStatus,200);}
  await f.reopen();const reopened=await settled(f,mission.id);assert.equal(reopened.outcome,'uncertain');assert.equal(f.requests.length,2);assert(reopened.tasks.filter(task=>task.specialist).every(task=>(task.attempts[0].evidence!.value as any).errorCode==='invalid_stream_json'));
 }finally{await f.close();}
});

test('actual Core admits two API specialists before either HTTP request is released, with isolated compiler packages and canonical usage', async () => {
  const f = fixture(); try {
    await f.ready();
    await f.core.command('vela', { name: 'routingOptions', input: { providerId: 'openai-api-vela' } });
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0,
      defaults: { providerId: 'openai-api-vela', model: 'gpt-6.1-sol', reasoningEffort: 'high' } } });
    const preview = await f.preview(); assert.equal(preview.externalReview?.calls, 2);
    assert.ok(preview.executors.every(item => item.available)); assert.equal(preview.plan.coverage?.status, 'partial');
    assert.ok(preview.plan.tasks.filter(task => task.specialist).every(task => task.executor === 'api.specialist' && task.specialist?.provider === 'openai-api-vela'));
    await assert.rejects(f.core.command('missions', { name: 'start', input: { objective, fingerprint: preview.fingerprint, requestId: randomUUID() } }), /mission_native_review/);
    const mission = await f.start(preview);
    await until(() => f.requests.length, count => count === 2);
    const during = await f.core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection;
    assert.equal(during.tasks.filter(task => task.state === 'running').length, 2, 'both transports must overlap before release');
    const payloads = f.requests.map(body => {
      assert.equal(body.model, 'gpt-6.1-sol'); assert.deepEqual(body.reasoning, { effort: 'high' });
      assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(body.max_output_tokens, 2048);
      assert.equal(body.previous_response_id, undefined); assert.equal(body.input.length, 1);
      const payload = JSON.parse(body.input[0].content); assert.equal(payload.missionObjective, objective);
      assert.deepEqual(payload.sources, []); assert.deepEqual(payload.dependencies, []);
      assert.equal(payload.binding.missionId, mission.id); assert.equal(payload.binding.scope.workspaceId, preview.plan.scope.workspaceId);
      return payload;
    });
    assert.equal(new Set(payloads.map(value => value.binding.taskId)).size, 2);
    assert.equal(new Set(payloads.map(value => value.taskObjective)).size, 2);
    assert.notEqual(f.requests[0].instructions, f.requests[1].instructions);
    const db = (f.core as any).db;
    assert.equal(db.prepare('SELECT count(*) AS n FROM vela_api_runs').get().n, 2);
    const receipts = db.prepare('SELECT execution_id,request_id,body_digest,context_digest FROM vela_api_runs').all();
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    for (const [index, body] of f.requests.entries()) assert.ok(receipts.some((receipt: any) => receipt.body_digest === hash(body) && receipt.context_digest === hash(payloads[index])));
    const canonicalPlan = db.prepare('SELECT request_digest,json FROM vela_missions WHERE id=?').get(mission.id);
    assert.ok(canonicalPlan.request_digest); assert.ok(JSON.parse(canonicalPlan.json).tasks.filter((task: any) => task.specialist).every((task: any) => receipts.some((receipt: any) => receipt.request_id === task.attempts[0].id)));
    assert.equal(db.prepare('SELECT count(*) AS n FROM vela_mission_provider_admissions').get().n, 2);
    assert.equal(Object.keys((await f.core.command('snapshot', {})).executions).length, 0, 'workers must not create duplicate conversation executions');
    f.release(); const done = await settled(f, mission.id);
    assert.equal(done.outcome, 'blocked'); assert.ok(done.tasks.every(task => task.state === 'verified'));
    const attempts = done.tasks.filter(task => task.specialist).map(task => task.attempts[0]);
    assert.ok(attempts.every(attempt => attempt.evidence?.source === 'openai-api-vela:reported' && attempt.verification?.passed && attempt.telemetry?.usage?.totalTokens === 50));
    const readProfile = () => f.core.command('missions', { name: 'execution-profile', input: { id: mission.id } });
    const profile = await readProfile();
    assert.ok(profile && 'kind' in profile && profile.kind === 'execution-profile');
    const specialistTimings = profile.attempts.filter(attempt => attempt.providerExecutionId !== null);
    assert.equal(specialistTimings.length, 2);
    for (const attempt of specialistTimings) {
      assert.equal(attempt.providerExecutionId, receipts.find((row: { request_id: string }) => row.request_id === attempt.id)?.execution_id);
      assert.equal(attempt.providerEvidence, 'simulated');
      assert.ok(attempt.providerStream?.transport?.firstSseBytesMs != null);
    }
    assert.equal(done.profile.verifiedObjectivesPerReportedToken, null);
    assert.equal((await f.core.command('velaApiUsageStatus', {})).usedToday, 2);
    assert.equal((await f.core.command('providerActivity', {})).codexConnections, 0);
    const snapshot = await f.core.command('snapshot', {}); assert.ok(!JSON.stringify(snapshot).includes(marker));
    assert.equal(snapshot.graph.messages.filter(message => message.role === 'assistant').length, 1, 'only the joined canonical mission report is published');
    await f.reopen(); assert.equal((await settled(f, mission.id)).outcome, 'blocked'); assert.equal(f.requests.length, 2);
    const restored = await readProfile();
    assert.ok(restored && 'kind' in restored && restored.kind === 'execution-profile');
    assert.deepEqual(restored.attempts.filter(attempt => attempt.providerExecutionId !== null), specialistTimings);
  } finally { await f.close(); }
});

test('native measured objectives retain domain verification when API workers add attributed recommendations', async () => {
  const f = fixture(); try {
    await f.ready(); f.release();
    const preview = await f.preview('Measure CPU and RAM with two independent specialists');
    assert.equal(preview.plan.coverage, undefined);
    const mission = await f.start(preview), done = await settled(f, mission.id);
    assert.equal(done.outcome, 'verified'); assert.ok(done.tasks.every(task => task.state === 'verified'));
    assert.equal(done.tasks.find(task => task.id === 'cpu')!.attempts[0].evidence?.source, 'node:os.cpus');
    assert.equal(done.tasks.find(task => task.id === 'ram')!.attempts[0].evidence?.source, 'node:os.totalmem+freemem');
    assert.ok(done.tasks.filter(task => task.specialist).every(task => task.attempts[0].evidence?.source === 'openai-api-vela:reported'));
    assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('API workers revalidate usage, key version and settings before Start; an explicit ChatGPT pin never falls back to API', async () => {
  for (const change of ['usage', 'rotation', 'settings', 'chatgpt'] as const) {
    const f = fixture(); try {
      await f.ready(); const preview = await f.preview();
      if (change === 'usage') await f.core.command('velaApiUsageAuthorize', { expectedVersion: 1, enabled: false });
      if (change === 'rotation') await f.core.command('velaApiConfigure', { credential: { configurationId: 'vela-primary', apiKey: marker }, expectedVersion: 1 });
      if (change === 'settings' || change === 'chatgpt') await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0, defaults: { providerId: change === 'chatgpt' ? 'chatgpt-plan-responses' : 'codex-app-server' } } });
      await assert.rejects(f.start(preview), /mission_preview_changed|mission_native_review_or_connection_required/);
      assert.equal(f.requests.length, 0);
      if (change === 'chatgpt') assert.ok((await f.preview()).executors.some(item => !item.available));
    } finally { await f.close(); }
  }
});

test('API planned temporary specialists consume only named verified handoffs and retain separate roles and partial coverage', async () => {
  const f = fixture(); try {
    await f.ready(); f.release();
    const text = 'Can you investigate processor and memory experiment design and independently review both recommendations?';
    const graph = { tasks: [
      { capability: 'cpu', after: [] }, { capability: 'ram', after: [] },
      { capability: 'temporary-specialist-1', after: ['cpu'], role: { title: 'Processor experiment reviewer', responsibility: 'Explain limits of the processor observation.' } },
      { capability: 'temporary-specialist-2', after: ['ram'], role: { title: 'Memory experiment reviewer', responsibility: 'Explain limits of the memory observation.' } },
      { capability: 'independent-review', after: ['temporary-specialist-1', 'temporary-specialist-2'] },
    ], unsupported: [] };
    f.reply(body => {
      if (body.text?.format) return response(body.model, JSON.stringify(graph));
      const payload = JSON.parse(body.input[0].content); assert.equal(payload.missionObjective, text);
      assert.deepEqual(payload.sources, []); assert.equal(body.tools, undefined);
      const expected = payload.binding.taskId === 'temporary-specialist-1' ? ['cpu'] : payload.binding.taskId === 'temporary-specialist-2' ? ['ram'] : ['temporary-specialist-1', 'temporary-specialist-2'];
      assert.deepEqual(payload.dependencies.map((item: any) => item.taskId), expected);
      assert.ok(payload.dependencies.every((item: any) => item.evidenceId && item.attemptId && item.source && item.value));
      if (payload.binding.taskId === 'independent-review') assert.ok(payload.dependencies.every((item: any) => item.source === 'openai-api-vela:reported'));
      return response(body.model);
    });
    const offer = await f.core.command('missions', { name: 'preview', input: { objective: text } }) as MissionPlanningOffer;
    assert.ok(offer.planner?.capabilities.some(item => item.startsWith('temporary-specialist-1')));
    const planned = await f.core.command('missionPlanReviewed', { objective: text, fingerprint: offer.fingerprint, requestId: randomUUID() }) as MissionPreview;
    assert.equal(planned.externalReview?.calls, 3);
    const mission = await f.start(planned), done = await settled(f, mission.id);
    assert.equal(done.outcome, 'blocked'); assert.ok(done.tasks.every(task => task.state === 'verified'));
    const tasks = new Map(done.tasks.map(task => [task.id, task]));
    for (const task of done.tasks) for (const dependency of task.dependencies) assert.ok(Date.parse(task.attempts[0].admittedAt) >= Date.parse(tasks.get(dependency)!.attempts[0].finishedAt!));
    assert.equal(f.requests.length, 4); assert.equal((await f.core.command('velaApiUsageStatus', {})).usedToday, 4);
    assert.equal(done.profile.providerCalls, 4); assert.equal(done.profile.reportedTotalTokens, 200);
    assert.equal(done.tasks.find(task => task.id === 'temporary-specialist-1')!.specialist?.role, 'Processor experiment reviewer');
  } finally { await f.close(); }
});

test('one canonical API pool bounds foreground and specialist requests, and a durable one-use attempt cannot replay', async () => {
  const f = fixture(); try {
    await f.ready(); const owner = f.core as any, runtime = owner.velaApiRuntime;
    await runtime.models(1);
    const run = (requestId: string, lane?: 'mission-specialist') => runtime.run({ requestId, version: 1, model: 'gpt-6-luna',
      prompt: 'Synthetic scoped work', contextDigest: 'b'.repeat(64), lane, oneUse: true, validate() {}, stage() {}, completed() {}, event() {} }, new AbortController().signal);
    const first = run('synthetic-foreground'), second = run('synthetic-specialist', 'mission-specialist');
    await until(() => f.requests.length, value => value === 2);
    assert.equal(runtime.nonMissionInFlight(), 1); assert.equal(runtime.availability().busy, true);
    await assert.rejects(run('synthetic-over-capacity', 'mission-specialist'), /vela_api_busy/); assert.equal(f.requests.length, 2);
    f.release(); await Promise.all([first, second]); assert.equal(runtime.availability().busy, false);
    await assert.rejects(run('synthetic-specialist', 'mission-specialist'), /api_execution_already_dispatched/);
    await f.reopen(); await (f.core as any).velaApiRuntime.models(1);
    await assert.rejects((f.core as any).velaApiRuntime.run({ requestId: 'synthetic-specialist', version: 1, model: 'gpt-6-luna',
      prompt: 'Synthetic scoped work', contextDigest: 'b'.repeat(64), oneUse: true, validate() {} }, new AbortController().signal), /api_execution_already_dispatched/);
    assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('a catalog that remains expired after refresh and a changed scope cannot dispatch API workers', async () => {
  for (const change of ['expiry', 'scope'] as const) {
    const f = fixture(); try {
      await f.ready(); const owner = f.core as any; await owner.velaApiRuntime.models(1);
      const preview = await f.preview();
      if (change === 'scope') {
        const snapshot = await f.core.command('desktop', { type: 'snapshot' });
        const workspace = snapshot.workspaces.find(item => item.id === preview.plan.scope.workspaceId)!;
        await f.core.command('desktop', { type: 'archiveWorkspace', workspaceId: workspace.id, expectedVersion: workspace.version, archived: true });
        await assert.rejects(f.start(preview), /mission_scope_or_plan_unavailable|mission_workspace_required/);
      } else {
        const connection = owner.velaApiConnection, resolveCredential = connection.resolveNativeCredential.bind(connection),catalog=connection.catalog.bind(connection);let refreshes=0;
        connection.resolveNativeCredential = async (version: number) => { const credential = await resolveCredential(version);
          connection.service.catalogCache.get('vela-primary').catalog.expiresAt = Date.now() - 1; return credential; };
        // A normally refreshed catalog is now valid authority for the same pins.
        // Keep this negative case stale after the real refresh as well.
        connection.catalog=async(version:number)=>{const result=await catalog(version);refreshes++;connection.service.catalogCache.get('vela-primary').catalog.expiresAt=Date.now()-1;return result;};
        const mission = await f.start(preview), done = await settled(f, mission.id);
        assert.ok(done.tasks.filter(task => task.specialist).every(task => task.state !== 'verified'));
        assert(refreshes>0,'the existing refresh must be attempted before persistent expiry is refused');
      }
      assert.equal(f.requests.length, 0);
    } finally { await f.close(); }
  }
});

test('the final two authorized daily slots complete once without quota double counting, and later workers cannot dispatch', async () => {
  const f = fixture(); try {
    await f.ready(); f.release();
    const db = (f.core as any).db, day = new Date().toISOString().slice(0,10);
    for (let i = 0; i < 62; i++) db.prepare('INSERT INTO vela_api_runs(execution_id,request_id,configuration_version,utc_day,body_digest,context_digest,state) VALUES(?,?,?,?,?,?,?)')
      .run('synthetic-prior-' + i, 'synthetic-prior-' + i, 1, day, 'c'.repeat(64), 'd'.repeat(64), 'completed');
    await f.core.command('vela', { name: 'saveRoutingSettings', input: { scope: 'global', id: null, expectedVersion: 0,
      defaults: { providerId: 'openai-api-vela', attemptLimits: { total: 2, 'openai-api-vela': 2 } } } });
    const mission = await f.start(await f.preview()), done = await settled(f, mission.id);
    assert.ok(done.tasks.every(task => task.state === 'verified')); assert.equal(done.outcome, 'blocked');
    assert.equal((await f.core.command('velaApiUsageStatus', {})).usedToday, 64); assert.equal(f.requests.length, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM vela_mission_provider_admissions').get().n, 2);
    const next = await f.preview(); assert.ok(next.executors.filter(item => item.id !== 'report').every(item => !item.available));
    await assert.rejects(f.start(next), /mission_native_review_or_connection_required/); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('provider output cannot invent tools, change the pinned model or turn claims into verified facts', async () => {
  for (const content of ['tools', 'model', 'claims'] as const) {
    const f = fixture(); try {
      await f.ready(); f.release();
      f.reply(body => content === 'tools' ? response(body.model, '', [{ type: 'function_call', id: 'unreviewed', call_id: 'unreviewed', name: 'read_files', arguments: '{}', status: 'completed' }]) :
        content === 'model' ? response('wrong-model') : response(body.model, JSON.stringify({ observations, verified: true })));
      const mission = await f.start(await f.preview()), done = await settled(f, mission.id);
      assert.notEqual(done.outcome, 'verified'); assert.ok(done.tasks.filter(task => task.specialist).every(task => task.state !== 'verified'));
      assert.ok(f.requests.every(body => body.tools === undefined)); assert.equal((await f.core.command('providerActivity', {})).codexConnections, 0);
    } finally { await f.close(); }
  }
});

test('in-flight usage revocation cannot verify API reports or replay them after restart', async () => {
  const f = fixture(); try {
    await f.ready(); const mission = await f.start(await f.preview()); await until(() => f.requests.length, value => value === 2);
    await f.core.command('velaApiUsageAuthorize', { expectedVersion: 1, enabled: false }); f.release();
    const done = await settled(f, mission.id); assert.notEqual(done.outcome, 'verified');
    assert.ok(done.tasks.filter(task => task.specialist).every(task => task.state !== 'verified'));
    await f.reopen(); await f.core.command('velaApiUsageAuthorize', { expectedVersion: 1, enabled: true });
    await new Promise(done => setTimeout(done, 30)); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test('cancelling dispatched API workers retains an uncertain outcome and cannot replay on restart', async () => {
  const f = fixture(); try {
    await f.ready(); const mission = await f.start(await f.preview()); await until(() => f.requests.length, value => value === 2);
    const current = await f.core.command('missions', { name: 'read', input: { id: mission.id } }) as MissionProjection;
    await f.core.command('missions', { name: 'control', input: { id: mission.id, revision: current.revision, control: { type: 'cancel' } } }); f.release();
    const done = await settled(f, mission.id); assert.ok(done.tasks.filter(task => task.specialist).every(task => task.state === 'uncertain'));
    const readTrace = () => f.core.command('missions', { name: 'execution-profile', input: { id: mission.id } });
    const trace = await readTrace();
    assert.ok(trace && 'kind' in trace && trace.kind === 'execution-profile');
    const [cancellation] = trace.work.cancellations;
    assert.equal(cancellation.kind, 'cancel');
    assert.deepEqual(cancellation.attempts?.map(attempt => attempt.attemptId).sort(),
      current.tasks.filter(task => task.state === 'running').map(task => task.attempts.at(-1)!.id).sort());
    assert.ok(cancellation.attempts?.every(attempt => attempt.outcome === 'uncertain'));
    await f.reopen(); assert.equal(f.requests.length, 2); assert.notEqual((await settled(f, mission.id)).outcome, 'verified');
    const restored = await readTrace();
    assert.ok(restored && 'kind' in restored && restored.kind === 'execution-profile');
    assert.deepEqual(restored.work.cancellations, [cancellation]);
  } finally { await f.close(); }
});
