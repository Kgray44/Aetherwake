import { activityId,githubItemHref,parseActivityHref,taskActivityHref } from './github-activity.mjs';

const labels = {
  branch:'Branch', commit:'Commit', pull_request:'Pull request', review:'Review',
  ci_run:'CI run', test:'Test', artifact:'Artifact', investigation:'Investigation',
  deployment:'Deployment', executor_session:'Executor session',
};
const verificationKinds = new Set(['verification','test','benchmark','deployment_validation']);

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

function githubEvents(references, github, snapshots) {
  const links = new Map();
  for (const ref of references) {
    const route = taskActivityHref(ref.url);
    if (!route) continue;
    const list = links.get(route)??[];
    list.push(ref);
    links.set(route,list);
  }
  const events = new Map();
  const mergeCommits = new Map();
  const pullCommits = new Map();
  const add = (id,at,fields) => {
    if (Number.isFinite(Date.parse(at))) events.set(id,{id,at,type:'Engineering',...fields});
  };
  const byKey = new Map(snapshots.map(snapshot=>[snapshot.cache_key,snapshot]));
  const listById = (kind,items) => new Map((items??[]).map(item=>[activityId(kind,item),item]));
  const pulls = listById('pulls',github?.pulls?.items);
  const runs = listById('runs',github?.ci?.items);
  for (const [route,refs] of links) {
    const parsed = parseActivityHref(route);
    if (!parsed?.id) continue;
    const {id,kind} = parsed;
    const detail = byKey.get(kind+':'+id);
    const href = githubItemHref(kind,id);
    const explicit = ['Association','Explicit Task link'];
    if (kind==='pulls' && refs.some(ref=>ref.kind==='pull_request'||ref.kind==='review')) {
      const pull = pulls.get(id);
      if (!pull && !detail) continue;
      const prefix = 'github:pull:'+id+':';
      const source = pull?github?.pulls?.observed_at:detail?.observed_at;
      const commitCoverage = !detail?.commits_status ? 'Unavailable until PR details are observed' : detail.commits_status;
      const common = {activityType:'pull_request',href,description:pull?.title??detail?.title,
        details:[['Source','GitHub pull request snapshot'],explicit,...(source?[['Snapshot observed',source]]:[]),
          ['Commit list coverage',commitCoverage]]};
      const opened = pull?.created_at??detail?.created_at;
      const merged = pull?.merged_at??detail?.merged_at;
      const closed = !merged&&detail?.state==='closed'?detail.closed_at:null;
      const latest = [pull?.updated_at,detail?.updated_at].filter(Boolean).sort().at(-1);
      const linkedPull = refs.some(ref=>ref.kind==='pull_request');
      const mergeSha = detail?.merge_commit_sha;
      const confirmedMerge = linkedPull&&detail?.number===id&&Number.isFinite(Date.parse(detail.merged_at))&&
        (!pull?.merged_at||Date.parse(pull.merged_at)===Date.parse(detail.merged_at))&&
        /^[a-f0-9]{40}$/.test(mergeSha??'');
      const mergeUrl = confirmedMerge?'https://github.com/Kgray44/Aetherwake/commit/'+mergeSha:null;
      if (mergeUrl&&!mergeCommits.has(mergeSha)) {
        mergeCommits.set(mergeSha,{id:'merge-commit:'+mergeSha,kind:'commit',label:'Merge commit',
          url:mergeUrl,revisions:[mergeSha],provenance:'GitHub merge of linked pull request #'+id});
      }
      if (linkedPull) add(prefix+'opened',opened,{...common,title:'Pull request #'+id+' opened',outcome:'opened'});
      if (linkedPull) add(prefix+'merged',merged,{...common,title:'Pull request #'+id+' merged',outcome:'merged',
        mergeCommitHref:mergeUrl,
        details:[...common.details,...(mergeUrl?[['Merge commit',mergeUrl]]:[])]});
      if (linkedPull) add(prefix+'closed',closed,{...common,title:'Pull request #'+id+' closed',outcome:'closed'});
      if (linkedPull && latest && ![opened,merged,closed].some(at=>Date.parse(at)===Date.parse(latest))) {
        add(prefix+'latest-update',latest,{...common,title:'Pull request #'+id+' last update',outcome:'updated'});
      }
      if (linkedPull && detail?.number===id && /^[a-f0-9]{40}$/.test(detail.commit_head??'') &&
          Number.isFinite(Date.parse(detail.commits_observed_at)) &&
          ['available','partial','stale'].includes(detail.commits_status)) {
        for (const {revision,committed_at:committedAt} of detail.commit_items??[]) {
          if (!/^[a-f0-9]{40}$/.test(revision??'')) continue;
          const url = 'https://github.com/Kgray44/Aetherwake/commit/'+revision;
          const provenance = 'GitHub commit list of linked pull request #'+id;
          if (!pullCommits.has(revision)) {
            pullCommits.set(revision,{id:'pull-commit:'+revision,kind:'commit',label:'PR commit',url,
              revisions:[revision],provenance,source_status:detail.commits_status});
          }
          const eventId = 'github:commit:'+revision;
          const association = ['Association',provenance];
          const observation = ['Commit list observed',detail.commits_observed_at+' · '+detail.commits_status+' · PR head '+detail.commit_head];
          if (events.has(eventId)) {
            events.get(eventId).details.push(association,observation);
            continue;
          }
          add(eventId,committedAt,{activityType:'commit',title:'Commit '+revision.slice(0,10),href:url,
            details:[['Revision',revision],['Clock','Git commit committer time'],association,observation]});
        }
      }
      for (const review of detail?.reviews??[]) {
        if (!linkedPull&&!refs.some(ref=>ref.kind==='review'&&new URL(ref.url).hash==='#pullrequestreview-'+review.id)) continue;
        add(prefix+'review:'+review.id,review.submitted_at,{activityType:'review',
          title:'Review submitted on pull request #'+id,outcome:review.state,href,
          details:[['Source','Cached GitHub review'],explicit,['Review ID',String(review.id)],
            ...(detail.reviews_observed_at?[['Reviews observed',detail.reviews_observed_at]]:[]),
            ...(detail.reviews_status?[['Review collection',detail.reviews_status]]:[])]});
      }
      continue;
    }
    if (kind!=='runs') continue;
    const run = runs.get(id);
    const matching = (item,ref) => item && ref.kind==='ci_run' && (!ref.revisions.length||ref.revisions.includes(item.revision));
    const suffix = ref => new URL(ref.url).pathname.toLowerCase().replace(/\/$/,'').split('/runs/'+id)[1];
    const rootLink = item => refs.some(ref=>matching(item,ref)&&suffix(ref)==='');
    const attemptLink = item => refs.some(ref=>matching(item,ref)&&suffix(ref)==='/attempts/'+item.attempt);
    const common = (item,source) => ({
      activityType:'ci_run',href,description:item.workflow??item.title,
      details:[['Source','GitHub workflow snapshot'],explicit,['Run revision',item.revision],
        ...(source?[['Snapshot observed',source]]:[])],
    });
    const visibleRun = rootLink(run)?run:rootLink(detail)?detail:null;
    if (visibleRun) add('github:ci:'+id+':created',visibleRun.created_at,{...common(visibleRun,
      visibleRun===run?github?.ci?.observed_at:detail?.observed_at),title:'CI run created',
      outcome:visibleRun.conclusion??visibleRun.status??visibleRun.run_status});
    if (rootLink(detail)||attemptLink(detail)) {
      add('github:ci:'+id+':attempt:'+detail.attempt+':started',detail.started_at,{...common(detail,detail.observed_at),
        title:'CI attempt '+detail.attempt+' started',outcome:detail.conclusion??detail.run_status});
    }
    for (const job of detail?.jobs??[]) {
      if (!rootLink(detail)&&!attemptLink(detail)&&!refs.some(ref=>matching(detail,ref)&&suffix(ref)==='/job/'+job.id)) continue;
      add('github:ci:'+id+':job:'+job.id+':finished',job.completed_at,{...common(detail,detail.jobs_observed_at),
        title:'CI job finished',description:job.name,outcome:job.conclusion??job.status,href:href+'/job/'+job.id,
        details:[...common(detail,detail.jobs_observed_at).details,['Job ID',String(job.id)],
          ['Run attempt',String(detail.attempt)],...(detail.jobs_stale?[['Job collection','stale']]:[])]});
    }
  }
  for (const [id,run] of runs) {
    if (!id||!run.revision||events.has('github:ci:'+id+':created')) continue;
    const pullNumber = run.pull_requests?.find(number=>links.get('#pull-requests/'+number)
      ?.some(ref=>ref.kind==='pull_request'&&ref.revisions.includes(run.revision)));
    if (pullNumber==null) continue;
    add('github:ci:'+id+':created',run.created_at,{activityType:'ci_run',title:'CI run created',
      outcome:run.conclusion??run.status,description:run.workflow??run.title,href:githubItemHref('runs',id),
      details:[['Source','GitHub workflow snapshot'],['Association','GitHub-linked pull request #'+pullNumber+' at the Task-linked revision'],
        ['Run revision',run.revision],...(github?.ci?.observed_at?[['Snapshot observed',github.ci.observed_at]]:[])]});
  }
  return {events:[...events.values()],commits:[...mergeCommits.values(),
    ...[...pullCommits].filter(([revision])=>!mergeCommits.has(revision)).map(([,item])=>item)]};
}

function reportedEvents(task, events, attempts, telemetrySource) {
  const attemptById = new Map(attempts.filter(attempt=>attempt.task_id===task.id).map(attempt=>[attempt.id,attempt]));
  const source = telemetrySource?.task_id===task.id ? telemetrySource : null;
  return events.flatMap(event=>{
    if (event.kind!=='engineering_activity'||event.task_id!==task.id||event.repository!==task.repository||
        !event.activity||!Number.isFinite(Date.parse(event.occurred_at))) return [];
    const {kind,outcome,operation_id,artifact_digest} = event.activity;
    const attempt = attemptById.get(event.attempt_id);
    const linkedAttempt = attempt?.revision===event.revision ? attempt : null;
    const receivedAt = Object.hasOwn(source?.event_receipts??{},event.event_id)?source.event_receipts[event.event_id]:null;
    return [{id:'activity:'+event.event_id,type:'Engineering',activityType:kind,outcome,at:event.occurred_at,journalReceipt:receivedAt,
      title:'Reported '+kind.replaceAll('_',' ')+' · '+outcome,sourceLabel:'Imported engineering activity',
      operationId:operation_id,sessionId:event.session_id,attemptId:linkedAttempt?.id,
      executor:linkedAttempt?.executor??linkedAttempt?.provider??event.activity.source,
      details:[['Source',event.activity.source],['Provenance','Reported by the source journal'],['Operation',operation_id],
        ['Revision',event.revision],['Observatory first received',receivedAt??'Unavailable'],
        ...(event.session_id?[['Executor session',event.session_id]]:[]),
        ...(linkedAttempt?[['Attempt',linkedAttempt.id]]:event.attempt_id?[['Attempt association','Revision or identity unconfirmed']]:[]),
        ...(artifact_digest?[['Reported artifact SHA-256',artifact_digest]]:[]),
        ...(receivedAt&&Date.parse(receivedAt)<Date.parse(event.occurred_at)?[['Clock discrepancy','Source occurrence is later than the Observatory receipt.']]:[])]}];
  });
}

export function taskEngineeringActivity({task,canonical,attempts=[],audits=[],evidence=[],events=[],github,telemetrySource}) {
  const authoritative=canonical?.task?.id===task.id?canonical:null;
  const explicitReferences=linkedReferences(task,authoritative,audits,evidence);
  const githubActivity=githubEvents(explicitReferences,github,authoritative?.engineering_snapshots??[]);
  const explicitCommits=new Set(explicitReferences.filter(ref=>ref.kind==='commit').map(ref=>ref.url.toLowerCase().replace(/\/$/,'')));
  const references=[...explicitReferences,...githubActivity.commits.filter(ref=>!explicitCommits.has(ref.url.toLowerCase()))];
  const operations=references.filter(ref=>!['executor_session','artifact','branch'].includes(ref.kind));
  const sessions=new Set(references.filter(ref=>ref.kind==='executor_session').map(ref=>sessionKey(ref.url)));
  for (const attempt of authoritative?.attempts??[]) {
    if (attempt.session_id) sessions.add((attempt.executor??'codex')+':'+attempt.session_id.toLowerCase());
  }
  const formalIds=new Set((authoritative?.attempts??[]).map(attempt=>attempt.id));
  const verification=evidence.filter(record=>record.task_id===task.id);
  const reported=reportedEvents(task,events,attempts,telemetrySource);
  const verificationReports=[...new Map(reported
    .filter(item=>verificationKinds.has(item.activityType)&&item.outcome!=='started').map(item=>[item.id,item])).values()]
    .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id));
  const reportedOperations=kind=>new Set(reported.filter(event=>!kind||event.activityType===kind).map(event=>event.operationId)).size;
  const engineeringEvents=[...githubActivity.events,...reported];
  return {
    references, events:engineeringEvents, verificationReports,
    counts:[
      ['Formal Task Engine attempts',authoritative?formalIds.size:null],
      ['Other reported attempts',new Set(attempts.filter(a=>a.task_id===task.id&&!formalIds.has(a.id)).map(a=>a.id)).size],
      ['Known executor sessions',sessions.size],
      ['Linked engineering operations',operations.length],
      ['Dated engineering events',engineeringEvents.length],
      ['Reported external operations',reportedOperations()],
      ['Reported external sessions',new Set(reported.map(event=>event.sessionId).filter(Boolean)).size],
      ['Linked commits',operations.filter(ref=>ref.kind==='commit').length],
      ['Linked pull requests',operations.filter(ref=>ref.kind==='pull_request').length],
      ['Criterion evidence records',new Set(verification.map(record=>record.id)).size],
      ['Benchmark evidence records',new Set(verification.filter(record=>record.kind==='benchmark').map(record=>record.id)).size],
      ['Reported verification operations',reportedOperations('verification')],
      ['Reported benchmark operations',reportedOperations('benchmark')],
    ],
    coverage:'Activity counts reflect explicit links and available records. Dated events can include GitHub-linked CI at the Task-linked revision. Categories can overlap and coverage may be partial.',
  };
}
