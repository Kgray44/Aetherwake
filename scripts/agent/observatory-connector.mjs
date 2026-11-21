/** Use the owner's installed Sites plugin through Codex. No model turn or browser session is needed. */
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import { parseDevelopmentNote } from '../../agent-system/observatory/development-notes.mjs';
import { appServerTurnProfile } from './provider-events.mjs';

const server = 'codex_apps';
const telemetryTool = 'aetherwake_engineering_observatory.sync_task_telemetry';
const timeoutMs = 8000;
const startupTimeoutMs = 180_000;
const localOnlyFlags = ['--disable','apps','--disable','plugins','--disable','remote_plugin','-c','web_search="disabled"'];
const localMcpName = /^[A-Za-z0-9_-]{1,64}$/;
const runFile = promisify(execFile);

const disconnected = () => Object.assign(Error('Codex connector is unavailable'), {code:'connector_disconnected'});

async function untilAborted(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once:true});
  });
  try { return await Promise.race([promise,cancelled]); }
  finally { signal.removeEventListener('abort',abort); }
}

function connectorEnvironment() {
  const env = { ...process.env };
  delete env.AADS_TASK_WORKER_KEY;
  delete env.AADS_INTEGRATION_PUSH_TOKEN;
  return env;
}

export async function openLocalRepairConnector({ cwd, executable, signal, spawnProcess } = {}) {
  let serverNames;
  try {
    const {stdout}=await runFile(executable,[...localOnlyFlags,'mcp','list','--json'],{
      cwd,signal,env:connectorEnvironment(),windowsHide:true,timeout:5000,maxBuffer:65536,
    });
    const configured=JSON.parse(stdout);
    if (!Array.isArray(configured) || configured.length>64 ||
        configured.some(server=>typeof server?.name!=='string'||!localMcpName.test(server.name))) throw Error();
    serverNames=[...new Set(configured.map(server=>server.name))];
  } catch { throw Error('Local-only repair could not confirm the configured MCP server names'); }
  return openObservatoryConnector({cwd,executable,signal,spawnProcess,localOnly:true,disabledMcpServers:serverNames});
}

export function openObservatoryConnector({ signal, cwd = process.cwd(), tool = telemetryTool, executable = 'codex',
  spawnProcess = spawn, localOnly = false, disabledMcpServers = [] } = {}) {
  const env = connectorEnvironment();
  const child = spawnProcess(executable, ['app-server','--listen','stdio://',
    '-c','sandbox_workspace_write.network_access=false','-c','sandbox_workspace_write.writable_roots=[]',
    '-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true',
    ...(localOnly ? [...localOnlyFlags,...disabledMcpServers.flatMap(name=>{
      if (typeof name!=='string'||!localMcpName.test(name)) throw Error('Invalid local MCP server name');
      return ['-c','mcp_servers.'+name+'.enabled=false'];
    })] : []),
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
    for (const finish of pending.values()) finish(null,disconnected());
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
  function rpc(method, params, timeout = timeoutMs, requestSignal) {
    return new Promise((resolve, reject) => {
      if (closed || signal?.aborted) { reject(disconnected()); return; }
      requestSignal?.throwIfAborted();
      const id = ++sequence;
      const abort = () => finish(null,requestSignal.reason);
      const deadline = setTimeout(() => {
        if (method === 'mcpServer/tool/call') {
          // A lost tool reply is ambiguous and confined to this RPC. Other
          // attempts still need this initialized transport to renew their leases.
          finish(null,Object.assign(Error('Observatory tool reply timed out'),{code:'connector_tool_timeout'}));
        } else close();
      }, timeout);
      function finish(response, error) {
        pending.delete(id);
        clearTimeout(deadline);
        requestSignal?.removeEventListener('abort',abort);
        if (error) reject(error);
        else if (response.error) reject(Error('Codex connector request failed: ' + method));
        else resolve(response.result);
      }
      pending.set(id,finish);
      requestSignal?.addEventListener('abort',abort,{once:true});
      send({ id, method, params });
    });
  }
  const initialized = (async () => {
    await rpc('initialize', { clientInfo: { name: 'aads_telemetry', title: 'AADS Telemetry', version: '1.0.0' } }, startupTimeoutMs);
    send({ method: 'initialized' });
  })();
  initialized.catch(() => {});
  let opening;
  function ready() {
    if (closed || signal?.aborted) return Promise.reject(disconnected());
    return opening ??= openToolThread().catch(error => {
      // An unusable tool thread must be reopened with a new transport.
      close();
      throw Object.assign(disconnected(),{cause:error});
    });
  }
  async function openToolThread() {
    await initialized;
    const started = await rpc('thread/start', { cwd, ephemeral: true }, startupTimeoutMs);
    if (typeof started?.thread?.id !== 'string') throw Error('Codex connector session unavailable');
    return started.thread.id;
  }
  const identifier = value => typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
  async function runWorkspaceTurn({cwd:workspace,prompt,resumeSessionId,signal:runSignal,onSession,
    onDevelopmentNote,onTurnStarted,onTurnAccepted,onTurnFinished,onUsageSnapshot,onUsageBudget,
    captureFreshThreadUsage = !resumeSessionId}) {
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
    if (localOnly) {
      const inventory = await rpc('mcpServerStatus/list', { threadId:id, limit:64 }, timeoutMs);
      const disabled = server => server?.runtimeStatus==='disabled' && server.tools &&
        typeof server.tools==='object' && !Array.isArray(server.tools) && Object.keys(server.tools).length===0 &&
        Array.isArray(server.resources) && server.resources.length===0 &&
        Array.isArray(server.resourceTemplates) && server.resourceTemplates.length===0;
      if (!Array.isArray(inventory?.data) || !inventory.data.every(disabled) || inventory.nextCursor) {
        throw Error('Local-only repair requires every MCP server to be explicitly disabled');
      }
    }
    const identity=identifier(started.model)&&identifier(started.modelProvider)
      ? {model:started.model,provider:started.modelProvider,source:'codex_app_server_thread_start'} : undefined;
    await onSession(id,identity);
    runSignal.throwIfAborted();
    let turnId, usage, finish, usageWrite, publishedUsage;
    const earlyTurns = new Map();
    const promptBytes = Buffer.byteLength(prompt);
    const createProfile = () => appServerTurnProfile(Boolean(resumeSessionId), promptBytes);
    let profile, limitedStart = false;
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
      if (changed) onUsageBudget?.(total);
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
      const usageUpdate=method==='thread/tokenUsage/updated';
      const completionUpdate=method==='turn/completed';
      const toolUpdate=method==='item/completed'&&['commandExecution','mcpToolCall'].includes(params.item?.type);
      if (usageUpdate||completionUpdate||toolUpdate) {
        const noticeTurn=completionUpdate?params.turn?.id:params.turnId;
        if (!identifier(noticeTurn)) return;
        if (!turnId) {
          if (!earlyTurns.has(noticeTurn)&&earlyTurns.size>=32) { limitedStart=true; return; }
          const early=earlyTurns.get(noticeTurn)??{profile:createProfile()};
          if (usageUpdate) {
            early.profile.observeUsage(params.tokenUsage);
            const value=params.tokenUsage?.total?.totalTokens;
            if (captureFreshThreadUsage&&Number.isSafeInteger(value)&&value>=(early.usage?.tokenUsage.total.totalTokens??0)) early.usage=params;
          } else if (toolUpdate) early.profile.observeTool(params.item);
          else early.status=params.turn.status;
          earlyTurns.set(noticeTurn,early);
        } else if (noticeTurn===turnId) {
          if (usageUpdate) {
            profile.observeUsage(params.tokenUsage);
            if (captureFreshThreadUsage) observeUsage(params);
          } else if (toolUpdate) profile.observeTool(params.item);
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
      profile=early?.profile??createProfile();
      if (early?.usage) observeUsage(early.usage);
      if (early?.status) finish(early.status);
      await onTurnAccepted?.(turnId);
      await onTurnStarted?.(turnId);
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
      return {status,usage,sessionId:id,turnId,profile:profile.measurements(status==='completed',limitedStart)};
    } finally {
      runSignal.removeEventListener('abort',abort);
      threadListeners.delete(id);
    }
  }
  return {
    close,
    processId:child.pid,
    async ready(requestSignal) {
      requestSignal?.throwIfAborted();
      return untilAborted(ready(),requestSignal);
    },
    runWorkspaceTurn,
    async readThreadTurns(threadId, cursor = null) {
      if (!identifier(threadId)) throw Error('Invalid Codex thread identity');
      await initialized;
      return rpc('thread/turns/list', {threadId,cursor,limit:20,sortDirection:'desc',itemsView:'notLoaded'});
    },
    async readThreadTurnItems(threadId, turnId) {
      if (!identifier(threadId) || !identifier(turnId)) throw Error('Invalid Codex turn identity');
      await initialized;
      return rpc('thread/items/list', {threadId,turnId,limit:50,sortDirection:'asc'});
    },
    async call(args, toolName = tool, {signal:requestSignal} = {}) {
      requestSignal?.throwIfAborted();
      const threadId = await untilAborted(ready(),requestSignal);
      const result = await rpc('mcpServer/tool/call', { threadId, server, tool:toolName, arguments:args },timeoutMs,requestSignal);
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
