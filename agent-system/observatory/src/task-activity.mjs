import { activityId, taskActivityHref } from './github-activity.mjs';

const labels = {
  branch:'Branch', commit:'Commit', pull_request:'Pull request', review:'Review',
  ci_run:'CI run', test:'Test', artifact:'Artifact', investigation:'Investigation',
  deployment:'Deployment', executor_session:'Executor session',
};

function safeActivityUrl(uri) {
  try {
    const url = new URL(uri);
    return url.protocol==='https:' && !url.username && !url.password && !url.search ? url.href : null;
  } catch { return null; }
}

export function taskLinkedHref(uri) {
  return taskActivityHref(uri) ?? safeActivityUrl(uri);
}

export function linkedCodexSessionId(uri) {
  return /^https:\/\/chatgpt\.com\/c\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i.exec(uri)?.[1].toLowerCase();
}

function sessionKey(uri) {
  const id = linkedCodexSessionId(uri);
  return id ? 'codex:'+id : uri;
}

function linkedReferences(task, canonical, audits, evidence) {
  const refs=new Map();
  const add=link=>{
    const url=safeActivityUrl(link?.uri);
    if (!url||!Object.hasOwn(labels,link.kind)) return;
    const operationKey=link.kind==='executor_session' ? sessionKey(url)
      : link.kind==='pull_request' ? taskActivityHref(url)??url : url;
    const key=JSON.stringify([link.kind,operationKey]);
    const row=refs.get(key)??{id:key,kind:link.kind,label:labels[link.kind],url,revisions:new Set()};
    if (link.revision) row.revisions.add(link.revision);
    refs.set(key,row);
  };
  const addEvidence=link=>{
    const route=taskActivityHref(link?.uri);
    const kind=route?.startsWith('#pull-requests/')?'pull_request':route?.startsWith('#ci-runs/')?'ci_run':'artifact';
    add({...link,kind});
  };
  for (const link of canonical?.lifecycle?.links??[]) add(link);
  for (const link of canonical?.lifecycle?.evidence??[]) addEvidence(link);
  for (const record of evidence) {
    if (record.task_id===task.id) addEvidence({...record.artifact,revision:record.revision});
  }
  for (const receipt of audits) {
    if (receipt.target_id&&receipt.target_id!==task.id) continue;
    add(receipt.reference);
    for (const item of receipt.evidence??[]) addEvidence(item);
  }
  return [...refs.values()].map(ref=>({...ref,revisions:[...ref.revisions].sort()}));
}

function githubEvents(references, github) {
  const links=(kind,id)=>references.filter(ref=>ref.kind===(kind==='pulls'?'pull_request':'ci_run')&&
    taskActivityHref(ref.url)==='#'+(kind==='pulls'?'pull-requests':'ci-runs')+'/'+id);
  const events=[];
  for (const pull of github?.pulls?.items??[]) {
    const id=activityId('pulls',pull);
    if (id==null||!links('pulls',id).length) continue;
    for (const [event,at] of [['opened',pull.created_at],['merged',pull.merged_at]]) {
      if (!Number.isFinite(Date.parse(at))) continue;
      events.push({id:'github:pull:'+id+':'+event,type:'Engineering',at,title:'Pull request #'+id+' '+event,
        activityType:'pull_request',outcome:event,description:pull.title,href:pull.url,
        details:[['Source','GitHub pull request snapshot'],['Association','Explicit Task link'],
          ...github.pulls.observed_at?[['Snapshot observed',github.pulls.observed_at]]:[]]});
    }
  }
  for (const run of github?.ci?.items??[]) {
    const id=activityId('runs',run);
    const matching=links('runs',id).some(ref=>new URL(ref.url).pathname.replace(/\/$/,'').endsWith('/runs/'+id)&&
      (!ref.revisions.length||ref.revisions.includes(run.revision)));
    if (id==null||!matching||!Number.isFinite(Date.parse(run.created_at))) continue;
    events.push({id:'github:ci:'+id+':created',type:'Engineering',at:run.created_at,title:'CI run created',
      activityType:'ci_run',outcome:run.conclusion??run.status,description:run.workflow??run.title,
      href:run.url,details:[['Source','GitHub workflow snapshot'],['Association','Explicit Task link'],
        ...run.revision?[['Run revision',run.revision]]:[],
        ...run.updated_at?[['Last GitHub update',run.updated_at]]:[],
        ...github.ci.observed_at?[['Snapshot observed',github.ci.observed_at]]:[]]});
  }
  return events;
}

export function taskEngineeringActivity({task,canonical,attempts=[],audits=[],evidence=[],github}) {
  const authoritative=canonical?.task?.id===task.id?canonical:null;
  const references=linkedReferences(task,authoritative,audits,evidence);
  const operations=references.filter(ref=>!['executor_session','artifact','branch'].includes(ref.kind));
  const sessions=new Set(references.filter(ref=>ref.kind==='executor_session').map(ref=>sessionKey(ref.url)));
  for (const attempt of authoritative?.attempts??[]) {
    if (attempt.session_id) sessions.add((attempt.executor??'codex')+':'+attempt.session_id.toLowerCase());
  }
  const formalIds=new Set((authoritative?.attempts??[]).map(attempt=>attempt.id));
  const verification=evidence.filter(record=>record.task_id===task.id);
  return {
    references, events:githubEvents(references,github),
    counts:[
      ['Formal Task Engine attempts',authoritative?formalIds.size:null],
      ['Other reported attempts',new Set(attempts.filter(a=>a.task_id===task.id&&!formalIds.has(a.id)).map(a=>a.id)).size],
      ['Known executor sessions',sessions.size],
      ['Linked engineering operations',operations.length],
      ['Linked commits',operations.filter(ref=>ref.kind==='commit').length],
      ['Linked pull requests',operations.filter(ref=>ref.kind==='pull_request').length],
      ['Reported verification records',new Set(verification.map(record=>record.id)).size],
      ['Reported benchmarks',new Set(verification.filter(record=>record.kind==='benchmark').map(record=>record.id)).size],
    ],
    coverage:'Activity counts reflect explicit links and available records. Categories can overlap. Work outside these sources and its resource use may be unknown.',
  };
}
