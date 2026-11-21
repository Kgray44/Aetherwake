/** Use the owner's installed Sites plugin through Codex. No model turn or browser session is needed. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { relative } from 'node:path';
import { parseDevelopmentNote } from '../../agent-system/observatory/development-notes.mjs';

const server = 'codex_apps';
const telemetryTool = 'aetherwake_engineering_observatory.sync_task_telemetry';
const timeoutMs = 8000;
const startupTimeoutMs = 180_000;

export function openObservatoryConnector({ signal, cwd = process.cwd(), tool = telemetryTool, executable = 'codex',
  spawnProcess = spawn } = {}) {
  const env = { ...process.env };
  delete env.AADS_TASK_WORKER_KEY;
  const child = spawnProcess(executable, ['app-server','--listen','stdio://',
    '-c','sandbox_workspace_write.network_access=false','-c','sandbox_workspace_write.writable_roots=[]',
    '-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true',
  ], {
    cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  const threadListeners = new Map();
  let sequence = 0;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', close);
    for (const finish of pending.values()) finish({ error: true });
    pending.clear();
    for (const listener of threadListeners.values()) listener('disconnected',{});
    threadListeners.clear();
    lines.close();
    child.stdin.destroy();
    child.kill();
  }
  child.on('error', close);
  child.on('exit', close);
  child.stdin.on('error', close);
  signal?.addEventListener('abort', close, { once: true });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      const complete = pending.get(message.id);
      if (complete) complete(message);
      else if (message.id !== undefined && message.method) {
        send({id:message.id,error:{code:-32601,message:'External actions and approvals are unavailable'}});
      } else threadListeners.get(message.params?.threadId)?.(message.method,message.params);
    } catch { close(); }
  });
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  function rpc(method, params, timeout = timeoutMs) {
    return new Promise((resolve, reject) => {
      if (closed || signal?.aborted) { reject(Error('Codex connector is unavailable')); return; }
      const id = ++sequence;
      const deadline = setTimeout(close, timeout);
      pending.set(id, response => {
        pending.delete(id);
        clearTimeout(deadline);
        if (response.error) reject(Error('Codex connector request failed: ' + method));
        else resolve(response.result);
      });
      send({ id, method, params });
    });
  }
  const initialized = (async () => {
    await rpc('initialize', { clientInfo: { name: 'aads_telemetry', title: 'AADS Telemetry', version: '1.0.0' } }, startupTimeoutMs);
    send({ method: 'initialized' });
  })();
  initialized.catch(() => {});
  let opening;
  async function openToolThread() {
    await initialized;
    const started = await rpc('thread/start', { cwd, ephemeral: true }, startupTimeoutMs);
    if (typeof started?.thread?.id !== 'string') throw Error('Codex connector session unavailable');
    return started.thread.id;
  }
  const identifier = value => typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
  async function runWorkspaceTurn({cwd:workspace,prompt,resumeSessionId,signal:runSignal,onSession,
    onDevelopmentNote,onTurnStarted,onTurnFinished,onUsageSnapshot}) {
    runSignal.throwIfAborted();
    await initialized;
    const settings={cwd:workspace,sandbox:'workspace-write',approvalPolicy:'never'};
    const started=await rpc(resumeSessionId?'thread/resume':'thread/start',
      resumeSessionId?{...settings,threadId:resumeSessionId}:{...settings,ephemeral:false},startupTimeoutMs);
    const id=started?.thread?.id;
    if (!identifier(id)||(resumeSessionId&&id!==resumeSessionId)||started.thread.ephemeral===true||started.sandbox?.type!=='workspaceWrite'||started.sandbox.networkAccess!==false||
        !started.sandbox.writableRoots?.every(root=>relative(workspace,root)==='')) {
      throw Error('App Server workspace policy was not confirmed');
    }
    const identity=identifier(started.model)&&identifier(started.modelProvider)
      ? {model:started.model,provider:started.modelProvider,source:'codex_app_server_thread_start'} : undefined;
    await onSession(id,identity);
    runSignal.throwIfAborted();
    let turnId, usage, finish, usageWrite, publishedUsage;
    const earlyTurns = new Map();
    let lastSampleAt = -Infinity, samples = 0;
    let noteWrites=Promise.resolve();
    async function publishUsage(total) {
      try {
        await onUsageSnapshot(total,{sessionId:id,occurredAt:new Date().toISOString()});
        publishedUsage=total;
      } catch { /* Telemetry delivery cannot decide the execution result. */ }
    }
    function observeUsage(params) {
      if (params.turnId!==turnId) return;
      const total=params.tokenUsage?.total;
      if (!Number.isSafeInteger(total?.totalTokens)||total.totalTokens<0||
          total.totalTokens<(usage?.totalTokens??0)) return;
      const changed=total.totalTokens!==usage?.totalTokens;
      usage=total;
      const now=performance.now();
      if (!onUsageSnapshot||!changed||usageWrite||samples>=16||now-lastSampleAt<15_000) return;
      lastSampleAt=now;
      samples++;
      usageWrite=publishUsage(total).finally(()=>{usageWrite=undefined;});
    }
    const completion=new Promise(resolve=>{finish=resolve;});
    const abort=()=>{
      if (turnId) {
        void rpc('turn/interrupt',{threadId:id,turnId}).then(
          () => finish('interrupted'), () => finish('disconnected')
        );
      }
    };
    threadListeners.set(id,(method,params)=>{
      const usageUpdate=method==='thread/tokenUsage/updated'&&!resumeSessionId;
      const completionUpdate=method==='turn/completed';
      if (usageUpdate||completionUpdate) {
        const noticeId=usageUpdate?params.turnId:params.turn?.id;
        if (!identifier(noticeId)) return;
        if (!turnId) {
          if (!earlyTurns.has(noticeId)&&earlyTurns.size>=32) return;
          const early=earlyTurns.get(noticeId)??{};
          if (usageUpdate) {
            const value=params.tokenUsage?.total?.totalTokens;
            if (Number.isSafeInteger(value)&&value>=(early.usage?.tokenUsage.total.totalTokens??0)) early.usage=params;
          } else early.status=params.turn.status;
          earlyTurns.set(noticeId,early);
        } else if (noticeId===turnId) {
          if (usageUpdate) observeUsage(params);
          else finish(params.turn.status);
        }
      }
      if (onDevelopmentNote&&method==='item/completed'&&params.item?.type==='agentMessage'&&
          turnId&&params.turnId===turnId&&typeof params.item.id==='string') {
        const note=parseDevelopmentNote(params.item.text);
        if (note) {
          const observedAt=new Date().toISOString();
          const itemId=params.item.id;
          noteWrites=noteWrites.then(()=>onDevelopmentNote(itemId,note,observedAt)).catch(()=>{});
        }
      }
      if (method==='disconnected') finish('disconnected');
    });
    runSignal.addEventListener('abort',abort,{once:true});
    try {
      runSignal.throwIfAborted();
      const turn=await rpc('turn/start',{threadId:id,input:[{type:'text',text:prompt}]},startupTimeoutMs);
      turnId=turn.turn.id;
      if (!identifier(turnId)) throw Error('App Server turn identity was not confirmed');
      const early=earlyTurns.get(turnId);
      earlyTurns.clear();
      if (early?.usage) observeUsage(early.usage);
      if (early?.status) finish(early.status);
      await onTurnStarted?.();
      if (runSignal.aborted) abort();
      const status=await completion;
      await onTurnFinished?.(status);
      await noteWrites;
      await usageWrite;
      // Preserve the last observed lower bound on unsuccessful fresh turns even
      // when the regular progress cadence suppressed their final notice.
      if (status!=='completed'&&onUsageSnapshot&&usage&&JSON.stringify(usage)!==JSON.stringify(publishedUsage)) {
        await publishUsage(usage);
      }
      return {status,usage,sessionId:id};
    } finally {
      runSignal.removeEventListener('abort',abort);
      threadListeners.delete(id);
    }
  }
  return {
    close,
    runWorkspaceTurn,
    async call(args, toolName = tool, {signal:requestSignal} = {}) {
      requestSignal?.throwIfAborted();
      const threadId = await (opening ??= openToolThread());
      requestSignal?.throwIfAborted();
      const result = await rpc('mcpServer/tool/call', { threadId, server, tool:toolName, arguments:args });
      requestSignal?.throwIfAborted();
      let value;
      try { value = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text); }
      catch { throw Error('Observatory returned an unreadable response'); }
      if (result.isError || value.error || (value.status !== undefined && (value.status < 200 || value.status >= 300))) {
        const error = Error('Observatory declined the request');
        error.status = value.status;
        if (value.error==='Task graph changed. Reload or replay the same operation ID.') error.code='task_version_conflict';
        if (value.error==='Attempt lease is stale or invalid') error.code='lease_rejected';
        throw error;
      }
      return value;
    },
  };
}
