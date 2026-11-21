import React,{lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig,motion,useReducedMotion} from 'motion/react';
import {Activity,ArrowLeft,ArrowRight,BarChart3,Boxes,CheckCircle2,CircleX,CircleAlert,Clock3,GitPullRequest,Layers3,ListTodo,Plus,Radio,RefreshCw,ShieldCheck,Workflow} from 'lucide-react';
import {demoRecords} from './demo-data.js';
import {observedTaskTraceCoverage} from './trace-timeline.mjs';
import {ExecutionFeed,TraceWaterfall} from './execution-feed.jsx';
import {TaskExecutionTiming} from './task-execution-timing.jsx';
import {useAutomaticTelemetry} from './automatic-telemetry.jsx';
import {ownerReviewByCriterion} from './evidence-status.mjs';
import {GitHubFeed} from './github-feed.jsx';
import {ProposalControls} from './proposal-controls.jsx';
import {activityHref,parseActivityHref} from './github-activity.mjs';
import {IntegrationTaskStatus,MergeWorkspace,useIntegrationRuns} from './merge-workspace.jsx';
import {proposalChecks} from '../intake.mjs';
import {PrerequisiteChecks,RawTaskRecord,TaskAcceptanceMatrix,TaskActivityLabel,TaskAttemptHistory,TaskEvidenceLedger,TaskCapabilitySummary,TaskDependencies,TaskExplorer,TaskRows,defaultTaskFilters,useTaskFilters} from './task-workspace.jsx';
import {dependencyGraph,parseTaskHref,overviewTaskResults,taskActivity,taskHref,workspaceActivity} from './task-workspace.mjs';
import {useTaskEngineDetail} from './use-task-engine-detail.jsx';
import {codexThreadHref,hasLiveTaskWork,taskEngineRequest,taskNextAction,workerDispatchStatus} from './task-engine-client.mjs';
import { taskExecutionStatus } from './task-timeline.mjs';
import { developmentNoteBytes, notesCategory, taskDevelopmentNotes } from '../development-notes.mjs';
import {useCardMotion} from './card-motion.jsx';
import {TaskTimeline} from './task-timeline.jsx';
import {StickySectionAside} from './sticky-section-aside.jsx';
import {useOpenAIPricing} from './use-openai-pricing.jsx';
import {TaskReportExport} from './task-report-export.jsx';
import {mergeTaskAttempts} from './task-attempts.mjs';
import {readTaskScope,TaskScopeFields,TaskScopeSummary} from './task-scope.jsx';
import './styles.css';

const loadTaskControls=()=>import('./task-engine-controls.jsx');
const TaskEngineControls=lazy(()=>loadTaskControls().then(module=>({default:module.TaskEngineControls})));
const TaskDeliveryEvidence=lazy(()=>import('./task-engine-controls.jsx').then(module=>({default:module.TaskDeliveryEvidence})));
const loadTaskTelemetry=()=>import('./task-telemetry.jsx');
const TaskTelemetry=lazy(()=>loadTaskTelemetry().then(module=>({default:module.TaskTelemetry})));

const EngineeringAnalyticsPage=lazy(()=>import('./engineering-analytics-page.jsx').then(m=>({default:m.EngineeringAnalyticsPage})));
const TaskFailureInvestigation=lazy(()=>import('./failure-investigation.jsx').then(m=>({default:m.TaskFailureInvestigation})));
const GitHubActivityDetails=lazy(()=>import('./github-activity-pages.jsx').then(m=>({default:m.GitHubActivityDetails})));
const GitHubActivityList=lazy(()=>import('./github-activity-pages.jsx').then(m=>({default:m.GitHubActivityList})));

const types=['visual','bug','backend','performance','security','research','documentation','feature','maintenance','integration'];
const nav=[['overview','Overview',Activity],['tasks','Task Control Center',ListTodo],['merge','Merge Workspace',GitPullRequest],['analytics','Engineering analytics',BarChart3],['pulls','Pull requests',GitPullRequest],['runs','CI runs',Workflow],['create','New task',Plus]];
const fmt=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Unavailable';
const date=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Unavailable';
const short=v=>v?String(v).slice(0,10):'Unavailable';
const split=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
const ease=[.22,1,.36,1];
const verification = new URLSearchParams(window.location.search).get('verification');
const verificationHeaders = verification ? {'x-observatory-verification': verification} : {};
const fade={initial:{opacity:0,y:15,filter:'blur(5px)'},animate:{opacity:1,y:0,filter:'blur(0px)'},exit:{opacity:0,y:-10,filter:'blur(3px)'}};
function Ambient(){const canvas=useRef(null),reduce=useReducedMotion();useEffect(()=>{if(reduce)return;const el=canvas.current,ctx=el.getContext('2d',{alpha:true});if(!ctx)return;let raf=0,w=0,h=0,dpr=1,last=0;const rnd=(a,b)=>a+Math.random()*(b-a);let motes=Array.from({length:42},()=>({x:Math.random(),y:Math.random(),r:rnd(.45,1.6),v:rnd(.0008,.003),phase:rnd(0,6.28)}));let sparks=[];function resize(){w=window.innerWidth;h=window.innerHeight;dpr=Math.min(1.5,window.devicePixelRatio||1);el.width=Math.floor(w*dpr);el.height=Math.floor(h*dpr);el.style.width=w+'px';el.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0)}function frame(t){if(document.hidden){raf=requestAnimationFrame(frame);return}if(t-last<33){raf=requestAnimationFrame(frame);return}const dt=Math.min(50,t-last||33);last=t;ctx.clearRect(0,0,w,h);const glow=ctx.createRadialGradient(w*.8,h*.15,0,w*.8,h*.15,Math.max(w,h)*.75);glow.addColorStop(0,'rgba(32,109,137,.065)');glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);for(const m of motes){m.y-=m.v*dt/1000;m.x+=Math.sin(t*.00011+m.phase)*.000007;if(m.y<-.02)m.y=1.02;ctx.globalAlpha=.16+.26*(.5+.5*Math.sin(t*.001+m.phase));ctx.fillStyle='#8bcdd8';ctx.beginPath();ctx.arc(m.x*w,m.y*h,m.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;if(Math.random()<.012&&sparks.length<5){sparks.push({x:rnd(w*.2,w*.96),y:rnd(h*.15,h*.8),vx:rnd(-.5,.45),vy:rnd(-1,-.2),life:1})}sparks=sparks.filter(s=>s.life>0);for(const s of sparks){ctx.strokeStyle='rgba(244,184,113,'+(.43*s.life)+')';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x-s.vx*12,s.y-s.vy*12);ctx.stroke();s.x+=s.vx*dt*.05;s.y+=s.vy*dt*.05;s.life-=dt/850}raf=requestAnimationFrame(frame)}resize();raf=requestAnimationFrame(frame);window.addEventListener('resize',resize);return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize)}},[reduce]);return <><div className="atmosphere" aria-hidden="true"><div className="haze haze-a"/><div className="haze haze-b"/><div className="scan-grid"/></div><canvas ref={canvas} className="ambient-canvas" aria-hidden="true"/></>}
function Rise({as,children,delay=0,className='',...rest}){const reduce=useReducedMotion();const Surface=as==='a'?motion.a:motion.div;return <Surface className={className} initial={reduce?false:fade.initial} animate={fade.animate} exit={reduce?{opacity:0}:fade.exit} transition={{duration:reduce?.02:.53,delay:reduce?0:delay,ease}} {...rest}>{children}</Surface>}
function Status({value='unavailable'}){return <span className={'status status-'+value}><span className="status-light"/>{String(value).replaceAll('_',' ')}</span>}
function Panel({title,kicker,right,children,className='',id}){return <section id={id} className={'panel '+className}><div className="panel-heading"><div>{kicker&&<div className="kicker">{kicker}</div>}<h2 tabIndex={id?-1:undefined}>{title}</h2></div>{right}</div>{children}</section>}
function Empty({title='No records available',body='Create a task or connect a contract-compliant record source.'}){return <div className="empty"><Boxes size={25}/><strong>{title}</strong><p>{body}</p></div>}
function Metric({name,value,meta,Icon,index,href,onClick}){
  const interaction=useCardMotion(Boolean(href));
  return <Rise as={href?'a':undefined} href={href} className={'metric'+(href?' metric-link':'')} delay={index*.055} onClick={onClick} {...interaction}><div className="metric-top"><span>{name}</span><Icon size={17} aria-hidden="true"/></div><strong>{value}</strong><small>{meta}</small><span className="metric-rule"/></Rise>}
function Timeline({values}){const max=Math.max(1,...values);const coords=values.map((v,i)=>[i/(Math.max(1,values.length-1))*720,138-v/max*115]);const line=coords.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' ');return <div className="timeline-chart"><svg viewBox="0 0 720 155" preserveAspectRatio="none" role="img" aria-label="Engineering tasks created over the last fourteen days"><defs><linearGradient id="graph-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#74d2e6" stopOpacity=".24"/><stop offset="1" stopColor="#74d2e6" stopOpacity="0"/></linearGradient></defs>{[30,65,100,138].map(y=><line key={y} x1="0" x2="720" y1={y} y2={y} stroke="rgba(255,255,255,.07)"/>)}<path d={line+' L720 155 L0 155Z'} fill="url(#graph-fill)"/><motion.path d={line} fill="none" stroke="#84dfea" strokeWidth="2.7" vectorEffect="non-scaling-stroke" initial={{pathLength:0}} animate={{pathLength:1}} transition={{duration:1.3,ease}}/>{coords.map(([x,y],i)=><circle key={i} cx={x} cy={y} r={values[i]?3:1.5} fill="#b4ecf3" opacity={values[i]?1:.2}/>)}</svg></div>}
function DetailLine({name,value}){return <div className="detail-line"><span>{name}</span><strong>{value??'Unavailable'}</strong></div>}
const initialDraft = { primary: 'visual', profile_id: 'visual-gpu', visibility: 'private' };
const githubProposalFolder = 'https://github.com/Kgray44/Aetherwake/tree/observatory-proposed-tasks/Proposed%20Tasks';

function taskDraft(form) {
  const f = new FormData(form);
  return {
    title: f.get('title'), objective: f.get('objective'), primary: f.get('primary'), profile_id: f.get('profile_id'),
    visibility: f.get('visibility') || 'private', priority: f.get('priority') || 'normal',
    dependencies: split(f.get('dependencies')), capabilities: split(f.get('capabilities')),
    ...(f.has('merged_dependencies')?{merged_dependencies:split(f.get('merged_dependencies'))}:{}),
    ...readTaskScope(f),
    criteria: String(f.get('criteria') || '').split('\n').map(s => s.trim()).filter(Boolean),
  };
}

function TaskAdmission({checks,draft,tasks,summaries,publicIntake,publicationConfigured}) {
  const graph=dependencyGraph({prerequisites:{task_ids:draft.dependencies,capabilities:draft.capabilities,
    merged_task_ids:draft.merged_dependencies}},tasks,{summaries});
  const steps = [
    ['Explicit outcome', checks.outcome, 'Enter a title (4+ characters) and objective (12 to 100,000 characters).'],
    ['Task classification', checks.classification, 'Choose a primary category.'],
    ['Prerequisite contracts', checks.prerequisites, 'Optional. Use up to 100 task IDs and 100 capabilities.'],
    ['Requirements and inputs', checks.inputs, 'Use a supported kind and a URI, with an optional revision.'],
    ['Planned deliverables', checks.deliverables, 'Enter up to 30 planned outcomes of 500 characters each.'],
    ['Verifiable acceptance', checks.acceptance, 'Enter a verification profile and at least one criterion (up to 50).'],
  ];
  return <Panel title="Task admission" kicker="ENFORCEMENT BOUNDARY">
    <div className="step-list" aria-live="polite">{steps.map(([label, valid, help], index) => <div className="step" key={label}>
      <span>{String(index + 1).padStart(2, '0')}</span><strong>{label}{(!valid || index === 2) && <small>{help}</small>}</strong>
      {valid ? <CheckCircle2 size={15} role="img" aria-label="Complete"/> : <CircleX className="admission-missing" size={15} role="img" aria-label="Incomplete"/>}
    </div>)}</div>
    <PrerequisiteChecks graph={graph} Status={Status}/>
    <div className="hint"><ShieldCheck size={18}/><div>{publicIntake
      ? <>Proposal text is for the public <a href={githubProposalFolder}>Proposed Tasks</a> folder. Submit only information suitable for public GitHub.{!publicationConfigured && ' GitHub publishing is currently unconfigured. This proposal will be queued for an explicit retry after setup.'}</>
      : 'Private proposals stay in the current workspace.'} Human approval and execution are separate.</div></div>
  </Panel>;
}

function App(){const reduce=useReducedMotion(),[records,setRecords]=useState([]),[demo,setDemo]=useState(false),[localPage,setPage]=useState('overview'),[revision,setRevision]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[formError,setFormError]=useState(''),[saving,setSaving]=useState(false);
const [filters,setFilters]=useTaskFilters();
const heading=useRef(null);
const [execution,setExecution]=useState(null);
const [telemetryScope,setTelemetryScope]=useState(null);
const [hasLiveFeed,setHasLiveFeed]=useState(false);
const [routeHash,setRouteHash]=useState(()=>window.location.hash);
const githubView=parseActivityHref(routeHash);
const taskRoute=parseTaskHref(routeHash);
const mergeRoute=/^#merge(?:\?(.*))?$/.exec(routeHash);
const [githubFilters,setGitHubFilters]=useState({
  pulls:{query:'',state:'',group:'',oldest:false},
  runs:{query:'',state:'',group:'',oldest:false}
});
const page=mergeRoute ? 'merge' : githubView ? (githubView.id ? 'github-detail' : githubView.kind) : taskRoute ? (taskRoute.id ? 'detail' : 'tasks') : localPage;
const onTaskDetail=page==='detail';
const activeNavigation=githubView?.kind ?? (onTaskDetail?'tasks':page);
useEffect(()=>{
  const sync=()=>setRouteHash(window.location.hash);
  window.addEventListener('hashchange',sync);
  window.addEventListener('popstate',sync);
  return ()=>{
    window.removeEventListener('hashchange',sync);
    window.removeEventListener('popstate',sync);
  };
},[]);
useEffect(()=>{
  if(githubView||taskRoute) window.scrollTo(0,0);
  if(taskRoute) heading.current?.focus({preventScroll:true});
},[routeHash]);
const [engine,setEngine]=useState({status:'checking',tasks:[]});
const [github,setGitHub]=useState(null),[proposals,setProposals]=useState(null);
const [draft,setDraft]=useState(initialDraft),[publishError,setPublishError]=useState('');
const refreshId=useRef(0), engineRequest=useRef(null), foregroundRequest=useRef(false), submitting=useRef(false), proposalRequest=useRef(null);
const canPublish = Boolean(proposals && !proposals.verification && !demo);
const publicIntake = canPublish && draft.visibility === 'public';
const checks = proposalChecks(draft);
const refreshEngine=useCallback(signal=>{
  const previous=engineRequest.current;
  if(previous&&!previous.signal?.aborted)return previous.request;
  const read={signal};
  read.request=taskEngineRequest({op:'list',include_archived:true},verificationHeaders,{signal}).then(data=>{
    if(signal?.aborted||engineRequest.current!==read)return;
    if(Array.isArray(data?.tasks))setEngine({status:'available',tasks:data.tasks,workerAccess:data.executor_access?.codex,workerDispatch:data.worker_dispatch});
    else if(data===null)setEngine({status:'absent',tasks:[]});
    else setEngine(previous=>({...previous,status:'error',error:'Unexpected Task registry response.'}));
  }).catch(error=>{
    if(!signal?.aborted&&engineRequest.current===read)setEngine(previous=>({...previous,status:'error',error:error.message}));
  }).finally(()=>{
    if(engineRequest.current===read)engineRequest.current=null;
  });
  engineRequest.current=read;
  return read.request;
},[]);
const refresh=async(mode=demo,{quiet=false,signal}={})=>{
  if(quiet&&foregroundRequest.current)return;
  const cacheOnly=quiet&&onTaskDetail;
  const id=++refreshId.current;
  foregroundRequest.current=!quiet&&!mode;
  if(mode){setHasLiveFeed(false);setRecords(demoRecords());setError('');setLoading(false);return}
  if(!quiet)setLoading(true);
  try{
    void refreshEngine(signal);
    const loadFeed=async path=>{
      const response=await fetch(path,{cache:'no-store',headers:verificationHeaders,signal});
      if(!response.ok)throw Error('HTTP '+response.status);
      return response.json();
    };
    const showFeed=j=>{
      if(signal?.aborted||id!==refreshId.current)return false;
      setHasLiveFeed(true);
      setRecords(Array.isArray(j.records)?j.records:[]);
      setRevision(j.revision);
      setDeployedRevision(j.deployed_revision??null);
      setGitHub(j.github??null);setExecution(j.execution??null);setTelemetryScope(j.telemetry_scope??null);
      setProposals(j.proposals??null);
      setError('');
      return true;
    };
    const feed=await loadFeed(quiet&&!cacheOnly?'/api/overview':'/api/overview?prefer=cached');
    if(showFeed(feed)&&feed.github_refresh_pending&&!cacheOnly){
      foregroundRequest.current=false;
      setLoading(false);
      try { showFeed(await loadFeed('/api/overview')); }
      catch { /* Keep the loaded Task workspace and the cached GitHub status. */ }
    }
  }catch(e){
    if(!signal?.aborted&&id===refreshId.current){
      if(!quiet){setHasLiveFeed(false);setRecords([]);setGitHub(null);setProposals(null);setRevision(null);}
      setError((quiet?'Refresh failed. Showing last loaded records: ':'Live record feed unavailable: ')+e.message);
    }
  }finally{
    if(!quiet&&id===refreshId.current){foregroundRequest.current=false;setLoading(false);}
  }
};
useEffect(()=>{refresh(false)},[]);
useEffect(()=>{
  if(page==='detail') void Promise.all([loadTaskControls(),loadTaskTelemetry()]).catch(()=>{});
},[page]);
const [legacyHistory,setLegacyHistory]=useState(null);
const [deployedRevision,setDeployedRevision]=useState(null);
const watchingTasks=(Boolean(taskRoute)||page==='overview'||page==='merge')&&!demo;
const watchingExecution=watchingTasks&&engine.status==='available'&&(Boolean(engine.workerDispatch)||hasLiveTaskWork(engine.tasks));
useEffect(()=>{
  if(!watchingExecution)return;
  const controller=new AbortController();
  const tick=()=>{
    if(!document.hidden&&!foregroundRequest.current)void refreshEngine(controller.signal);
  };
  const timer=window.setInterval(tick,5_000);
  return ()=>{
    controller.abort();
    window.clearInterval(timer);
  };
},[watchingExecution,refreshEngine]);
useEffect(()=>{
  if(!watchingTasks)return;
  const controller=new AbortController();
  let pending=false;
  const update=async()=>{
    if(document.hidden||pending)return;
    pending=true;
    try{await refresh(false,{quiet:true,signal:controller.signal});}
    finally{pending=false;}
  };
  const timer=window.setInterval(update,30_000);
  document.addEventListener('visibilitychange',update);
  return ()=>{
    controller.abort();
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange',update);
  };
},[watchingTasks,onTaskDetail]);
const automaticTelemetry=useAutomaticTelemetry({scope:!demo&&hasLiveFeed?telemetryScope:null,headers:verificationHeaders,refresh:()=>refresh(false)});
const by=type=>records.filter(r=>r.record_type===type);
const usingEngineRegistry=!demo&&!hasLiveFeed&&engine.status==='available';
const tasks=useMemo(()=>{
  const source=usingEngineRegistry?engine.tasks.map(item=>item.task):records.filter(record=>record.record_type==='task');
  return source.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
},[usingEngineRegistry,engine.tasks,records]);
const summaries=useMemo(()=>new Map(engine.tasks.map(item=>[item.task.id,item])),[engine.tasks]);
const displayTasks=useMemo(()=>demo?tasks:tasks.map(task=>{
  const lifecycle=summaries.get(task.id)?.lifecycle;
  return lifecycle?{...task,state:lifecycle.state,contractState:task.state}:task;
}),[demo,tasks,summaries]);
const attempts=by('attempt'),evidence=by('evidence'),profiles=by('verification_profile');
const related=(id,type)=>records.filter(r=>r.record_type===type&&r.task_id===id);
const activity=useMemo(()=>workspaceActivity(tasks,attempts,demo?new Map():summaries),[tasks,records,summaries,demo]);
const work=activity.counts;
const resetMetricFilters=event=>{
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey)setFilters(defaultTaskFilters);
};
const chart=useMemo(()=>Array.from({length:14},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-13+i);return tasks.filter(t=>String(t.created_at).slice(0,10)===d.toISOString().slice(0,10)).length}),[tasks]);
const traceCoverage=useMemo(()=>page==='overview'&&!demo
  ? observedTaskTraceCoverage(tasks,records.filter(record=>record.record_type==='attempt'),execution?.events??[]):null,
  [page,demo,tasks,records,execution?.events]);
const overviewResults=useMemo(()=>page==='overview'&&!demo
  ? overviewTaskResults(tasks,records.filter(record=>record.record_type==='attempt'),execution?.events??[],summaries):null,
  [page,demo,tasks,records,execution?.events,summaries]);
const observedTime=traceCoverage?.coveredMs==null?'Unavailable'
  :(traceCoverage.coveredMs/1000).toLocaleString(undefined,{maximumFractionDigits:2})+' s';
const privateControls=!demo&&hasLiveFeed ? {...proposals?.controls,...Object.fromEntries(engine.tasks.filter(item=>proposals?.publication?.[item.task.id]!=='pending')
  .map(item=>[item.task.id,{priority:item.priority,version:item.version,source:proposals?.publication?.[item.task.id]==='published'?'published':'private'}]))} : {};
const workerAccess=!demo&&engine.status==='available'&&['configured','not_configured'].includes(engine.workerAccess)?engine.workerAccess:undefined;
const activityFor=task=>taskActivity(task,related(task.id,'attempt'),execution?.events??[],demo?null:summaries.get(task.id)?.lifecycle,workerAccess);
const current=tasks.find(t=>t.id===taskRoute?.id);
const integrationRuns=useIntegrationRuns(verificationHeaders,!demo&&Boolean(current&&hasLiveFeed),current?.id);
const publication=current?proposals?.publication?.[current.id]:null;
const engineSummary=!demo&&current&&publication!=='pending'?summaries.get(current.id):null;
const dependencyRevision=JSON.stringify((engineSummary?.task.prerequisites.task_ids??[]).map(id=>{
  const summary=summaries.get(id);
  return [id,summary?.lifecycle.stored_state,summary?.task.owner_acceptance];
}));
const engineTask=useTaskEngineDetail({summary:engineSummary,dependencyRevision,workerDispatch:engine.workerDispatch,
  headers:verificationHeaders,onRefresh:()=>refresh(false,{quiet:true})});
const canonical=engineTask.detail;
const reviewedCriteria=current?ownerReviewByCriterion(canonical?.task??current,canonical):new Map();
const detailState=canonical?.lifecycle.state??summaries.get(current?.id)?.lifecycle.state??current?.state;
const taskEvents=demo||!current?[]:(execution?.events??[]).filter(event=>event.task_id===current.id);
const taskAudits=canonical?.events??(legacyHistory?.taskId===current?.id?legacyHistory?.receipts:[])??[];
const taskTelemetrySource=demo||!current?null:execution?.sources?.find(source=>source.task_id===current.id);
const conversation = canonical?.attempts.findLast(attempt=>codexThreadHref(attempt));
const taskAttempts=current?mergeTaskAttempts(current.id,related(current.id,'attempt'),canonical?.attempts??[]):[];
const {pricing,loadingPrice}=useOpenAIPricing([...taskAttempts,...integrationRuns.runs.flatMap(run=>run.source_repairs ?? [])],
  page==='detail'&&!demo,verificationHeaders);
const developmentNotes=current?taskDevelopmentNotes(current.id,taskEvents,taskAttempts):[];
const dispatchStatus=workerDispatchStatus(engine.workerDispatch,workerAccess);
const nextAction=taskNextAction(canonical,workerAccess,engine.workerDispatch);
const executionStatus=canonical?taskExecutionStatus({taskId:canonical.task.id,state:detailState,
  attempt:canonical.attempts.at(-1),events:taskEvents,audits:taskAudits}):null;
const statusBanner=executionStatus??nextAction;
const statusSection=nextAction?.section??'task-attempts';
const canonicalTasks=tasks.filter(task=>summaries.has(task.id)&&proposals?.publication?.[task.id]!=='pending');
const publishedIntake=publication==='published'&&!canonical?.lifecycle.executor;
const select=id=>{
  window.location.hash=taskHref(id);
  setRouteHash(window.location.hash);
};
const proposalControls=current&&!demo&&Object.hasOwn(proposals?.controls??{},current.id)?proposals.controls[current.id]:null;
const navigate=id=>{
  if(id==='merge'){
    window.location.hash='#merge';
    return;
  }
  if(id==='pulls'||id==='runs'){
    window.location.hash=activityHref(id);
    return;
  }
  if(id==='tasks'){
    setFormError('');setPublishError('');
    setPage('overview');
    window.location.hash=taskHref();
    setRouteHash(window.location.hash);
    return;
  }
  if(routeHash){
    window.history.pushState(null,'',window.location.pathname+window.location.search);
    setRouteHash('');
  }
  setPage(id);setFormError('');setPublishError('');
  if(id==='analytics'&&demo){setDemo(false);refresh(false)}
  if(id==='create'){setDraft(initialDraft);proposalRequest.current=null}
};
const create=async e=>{
  e.preventDefault();
  if(submitting.current)return;
  if(demo){setFormError('Switch to Live mode to create a task. Demo records are never written.');return}
  const { visibility, ...payload }=taskDraft(e.currentTarget);
  const publish=canPublish && visibility==='public';
  if(!Object.values(proposalChecks(payload)).every(Boolean)){setFormError('Complete the admission checks before submitting.');return}
  const useEngine=!publish&&engine.status==='available';
  if(!publish&&!['available','absent'].includes(engine.status)){setFormError('Task intake is unavailable while the source is being checked.');return}
  const body=JSON.stringify(payload);
  if(proposalRequest.current?.body!==body||proposalRequest.current?.publish!==publish||proposalRequest.current?.useEngine!==useEngine) {
    proposalRequest.current={body,publish,useEngine,id:crypto.randomUUID()};
  }
  submitting.current=true;setSaving(true);setFormError('');
  const headers={'content-type':'application/json',...verificationHeaders,'x-observatory-request-id':proposalRequest.current.id};
  if(publish)headers['x-observatory-publish']='github';
  try{
    let j;
    if(useEngine){
      j=await taskEngineRequest({op:'register',operation_id:proposalRequest.current.id,fields:payload},verificationHeaders);
    }else{
      const r=await fetch('/api/tasks',{method:'POST',headers,body});
      j=await r.json();
      if(!r.ok)throw Error(j.error||'Task creation failed');
    }
    if(!j.task?.id)throw Error('Task creation receipt could not be verified. Refresh and check the Task feed.');
    proposalRequest.current=null;
    setPublishError(j.github?.reason||'');
    await refresh(false);
    setRecords(previous=>previous.some(task=>task.id===j.task.id)?previous:[...previous,j.task]);
    select(j.task.id);
  }catch(err){setFormError(err.message)}finally{submitting.current=false;setSaving(false)}
};
const retryPublication=async()=>{
  if(!current||saving)return;
  setSaving(true);setPublishError('');
  try{
    const response=await fetch('/api/tasks/'+current.id+'/publish',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Could not publish proposal');
    setPublishError(data.github.reason||'');
    await refresh(false);
  }catch(err){setPublishError(err.message)}finally{setSaving(false)}
};
const title=({overview:'Engineering overview',tasks:'Task Control Center',detail:current?.title??'Task inspection',merge:'Merge Workspace',analytics:'Engineering analytics',create:'Create task',pulls:'Pull requests',runs:'CI runs','github-detail':githubView?.kind==='pulls'?'Pull request':'CI run'})[page],desc=({overview:'Systems intelligence / Engineering operations',tasks:'Create and manage private proposals. Inspect Tasks and their execution records.',detail:'Complete execution trace and acceptance evidence',merge:'Inspect pull requests, required checks, and verified merges into main',analytics:'Delivery, verification, and execution observations',create:'Structured engineering task intake',pulls:'Find changes and inspect their GitHub details',runs:'Inspect workflow outcomes, jobs, and steps','github-detail':'Kgray44 / Aetherwake'})[page];
useEffect(()=>{document.title=title+' · Aetherwake Observatory'},[title]);
const githubUi={Metric,Panel,Rise,Status};
const jumpToTaskSection=id=>{
  const panel=document.getElementById(id);
  panel?.querySelector('h2,h3')?.focus({preventScroll:true});
  panel?.scrollIntoView({block:'start',behavior:reduce?'instant':'smooth'});
};
const activityGroup=kind=>demo?null:kind==='pulls'?github?.pulls:github?.ci;
const dispatchObservation=!demo&&watchingTasks&&engine.status==='available'&&
  <div className="notice"><Radio size={16}/><span>{dispatchStatus.label}{Number.isInteger(engine.workerDispatch?.total_slots)&&
    <> · {engine.workerDispatch.active_slots} of {engine.workerDispatch.total_slots} execution slots in use</>}{dispatchStatus.at&&
    <> · Last verified worker heartbeat <time dateTime={dispatchStatus.at}>{new Date(dispatchStatus.at).toLocaleString()}</time></>}</span></div>;
return <div className="app-shell"><Ambient/><aside className="sidebar"><div className="brand"><span className="brand-logo"><Layers3 size={21} strokeWidth={1.6}/></span><div><b>AETHERWAKE</b><small>ENGINEERING SYSTEMS</small></div></div><div className="rail-caption">OPERATIONS</div><nav>{nav.map(([id,label,Icon])=><motion.button key={id} className={'nav-link '+((activeNavigation===id)?'selected':'')} onClick={()=>navigate(id)} whileHover={{x:3}} whileTap={{scale:.98}}><Icon size={17} strokeWidth={1.7}/>{label}{(activeNavigation===id)&&<motion.span className="nav-indicator" layoutId="nav-indicator" transition={{type:'spring',stiffness:350,damping:30}}/>}</motion.button>)}</nav><div className="sidebar-bottom"><div className="connect-label"><span className="live-dot"/> {proposals?'PRIVATE SITES HOST':'LOCAL CONTROL PLANE'}</div><div className="mono">{short(revision)}</div><div>CONTRACT v1.0 · PHASE E</div></div></aside><main className="main"><header className="topbar"><div><div className="overline"><span className="overline-line"/>AETHERWAKE / ENGINEERING OBSERVATORY</div><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{desc}</p></div><div className="header-actions">{demo&&<span className="demo-flag">SIMULATED DATA</span>}{page==='analytics'?<span className="connect-label"><span className="live-dot"/> Live sources</span>:<div className="mode-toggle">{['Live','Demo'].map(m=><button key={m} className={(demo===(m==='Demo'))?'on':''} onClick={()=>{const v=m==='Demo';setDemo(v);refresh(v)}}>{m}</button>)}</div>}<motion.button className="icon-button" aria-label="Refresh records" title="Refresh" whileTap={reduce?undefined:{rotate:160}} onClick={()=>refresh()}><RefreshCw size={17}/></motion.button>{page==='overview'&&<button className="quiet-button" onClick={()=>navigate('tasks')}>Browse Tasks <ArrowRight size={13}/></button>}<motion.button className="primary-button" whileHover={{y:-2}} whileTap={{scale:.97}} onClick={()=>navigate('create')}><Plus size={16}/> New task</motion.button></div></header>{!demo&&proposals?.verification&&<div className="notice"><ShieldCheck size={16}/>Isolated verification proposals</div>}{error&&<div className="notice error" role="status"><CircleAlert size={17}/>{error}</div>}{loading&&<div className="notice"><Radio size={16}/>Synchronizing engineering record feed…</div>}{watchingTasks&&engine.status==='error'&&engine.tasks.length>0&&<div className="notice" role="status"><Radio size={16}/>Task registry refresh failed. Showing the last known execution state.</div>}<motion.div key={page+(taskRoute?.id?'-'+taskRoute.id:'')+(githubView?.id?'-'+githubView.kind+'-'+githubView.id:'')+(demo?'-demo':'-live')} initial={reduce?false:{opacity:0,y:14}} animate={{opacity:1,y:0}} transition={{duration:reduce?.01:.3,ease}} className="view">
{dispatchObservation}
{page==='overview'&&<><div className="metrics"><Metric name="Registered tasks" value={tasks.length} meta={usingEngineRegistry?'Engine registry · partial view':'Canonical v1 records'} Icon={Boxes} index={0}/><Metric name="Accepted" href={taskHref(undefined,'accepted')} onClick={resetMetricFilters} value={work.accepted} meta="Explicit task outcomes" Icon={CheckCircle2} index={1}/><Metric name="Executing" href={taskHref(undefined,'active')} onClick={resetMetricFilters} value={engine.status==='available'?work.active:'Unavailable'} meta={work.reportedRunning?work.reportedRunning+' last reported running':workerAccess==='not_configured'&&!work.active?'Codex worker access unavailable':'Engine-confirmed activity'} Icon={Activity} index={2}/><Metric name="At risk" href={taskHref(undefined,'issues')} onClick={resetMetricFilters} value={work.issues} meta="Blocked + failed" Icon={CircleAlert} index={3}/><Metric name="Reported success" href={taskHref(undefined,'succeeded')} onClick={resetMetricFilters} value={work.succeeded} meta="Tasks with a reported successful attempt" Icon={Clock3} index={4}/></div><div className="wide-grid"><Rise delay={.12}><Panel title="Engineering throughput" kicker="01 / ACTIVITY SIGNAL" right={<span className="panel-meta">TASK ARRIVAL · 14D</span>}><Timeline values={chart}/><div className="chart-footer">TASKS CREATED <span>Only observed records shown</span></div></Panel></Rise><StickySectionAside><Rise delay={.19}><Panel title="Delivery integrity" kicker="02 / ACCEPTANCE" right={<ShieldCheck size={18} className="muted-icon"/>}><div className="accept-head"><strong>{tasks.length?Math.round(100*work.accepted/tasks.length)+'%':'—'}</strong><small>ACCEPTED TASKS</small></div><div className="track"><motion.span initial={{width:0}} animate={{width:(tasks.length?100*work.accepted/tasks.length:0)+'%'}} transition={{duration:.9,ease}}/></div><DetailLine name="Execution attempts" value={attempts.length}/><DetailLine name="Awaiting owner review" value={<a className="text-button" aria-label={work.review+' Tasks awaiting owner review'} href={taskHref(undefined,'review')} onClick={resetMetricFilters}>{work.review}</a>}/><DetailLine name="Queued, scheduled, or paused" value={<a className="text-button" aria-label={work.waiting+' queued, scheduled, or paused Tasks'} href={taskHref(undefined,'waiting')} onClick={resetMetricFilters}>{work.waiting}</a>}/><DetailLine name="Tasks with no linked execution" value={work.unlinked}/><DetailLine name="Observed trace time" value={observedTime}/>
{traceCoverage?.spans>0&&<DetailLine name="Trace timing coverage"
  value={traceCoverage.tasks+' '+(traceCoverage.tasks===1?'Task':'Tasks')+' · '+traceCoverage.spans+' '+(traceCoverage.spans===1?'span':'spans')}/>}
<DetailLine name="Failed attempts" value={attempts.filter(a=>a.state==='failed').length}/><DetailLine name="Imported evidence records" value={evidence.length}/><DetailLine name="Reported passes (unverified)" value={evidence.filter(e=>e.result==='passed').length}/><DetailLine name="Tasks without acceptance" value={tasks.length-work.accepted}/></Panel></Rise></StickySectionAside></div><Rise delay={.24}><Panel title="Recent engineering work" kicker="03 / TASK FEED" right={<button className="text-button" onClick={()=>navigate('tasks')}>Open Task Control Center <ArrowRight size={15}/></button>}><TaskRows tasks={displayTasks.filter(task=>task.state!=='archived').slice(0,9)} controls={privateControls} related={related} activityFor={activityFor} Status={Status} overviewResults={overviewResults}/></Panel></Rise>{!demo&&proposals&&<ExecutionFeed execution={execution} records={records} headers={verificationHeaders} onRefresh={()=>refresh(false)} automatic={telemetryScope?automaticTelemetry:null}/>} {!demo&&github&&<Rise><Panel title="GitHub repository activity" kicker="PUBLIC ENGINEERING SOURCES"><GitHubFeed data={github}/></Panel></Rise>}</>}
{page==='tasks'&&<Rise><TaskExplorer tasks={displayTasks} work={taskRoute?.work??'all'} workActivity={activity} controls={privateControls} related={related} activityFor={activityFor}
  Status={Status} Panel={Panel} loading={loading} filters={filters} setFilters={setFilters} onCreate={()=>navigate('create')}/></Rise>}
{(page==='pulls'||page==='runs')&&<Suspense fallback={<p role="status">Loading repository activity…</p>}><GitHubActivityList kind={page} group={activityGroup(page)} ui={githubUi}
  ci={{ headers:verificationHeaders, live:!demo&&Boolean(proposals), mainRevision:github?.main?.status==='available'?revision:null }}
  filters={githubFilters[page]} setFilters={next=>setGitHubFilters(previous=>({...previous,[page]:next}))}/></Suspense>}
{page==='github-detail'&&<Suspense fallback={<p role="status">Loading GitHub details…</p>}><GitHubActivityDetails kind={githubView.kind} id={githubView.id} group={activityGroup(githubView.kind)}
  headers={verificationHeaders} live={!demo&&Boolean(proposals)} ui={githubUi}
  investigation={{ records, events: execution?.events ?? [], github,
    openTask: taskId => { navigate('detail'); select(taskId); } }}/></Suspense>}
{page==='merge'&&<MergeWorkspace headers={verificationHeaders} demo={demo}
  initialTask={new URLSearchParams(mergeRoute?.[1]).get('task')}
  pulls={github?.pulls?.items?.filter(pr=>pr.state==='open')??[]}
  acceptedTasks={tasks.filter(task=>task.owner_acceptance==='accepted')}/>}
{page==='analytics'&&<Suspense fallback={<p role="status">Loading engineering analytics…</p>}><EngineeringAnalyticsPage
  records={records} events={execution?.events} github={demo?null:github} execution={demo?null:execution}
  ready={!demo&&hasLiveFeed} ui={githubUi} headers={verificationHeaders}/></Suspense>}
{page==='detail'&&(current?<><div className="task-detail-toolbar"><button className="back" onClick={()=>navigate('tasks')}><ArrowLeft size={15}/> Back to Task Control Center</button>
{conversation&&<a className="primary-button" href={codexThreadHref(conversation)}>Open in Codex</a>}
<TaskReportExport key={current.id} disabled={!demo&&(loadingPrice||!hasLiveFeed||Boolean(engineSummary&&!canonical)||Boolean(proposalControls&&legacyHistory?.taskId!==current.id))}
  snapshot={{task:canonical?.task??current,canonical,attempts:taskAttempts,pricing,workerAccess,records,events:taskEvents,audits:taskAudits,github:demo?null:github,telemetrySource:taskTelemetrySource,integrationRuns:integrationRuns.runs,
    coverage:demo?'Simulated demonstration data. Times use UTC.':legacyHistory?.taskId===current.id&&legacyHistory?.unavailable?'Legacy proposal audit history could not be read. The report includes the remaining linked records. Times use UTC.':undefined}}/></div>
<nav className="task-section-nav" aria-label="Jump to Task section">
  {engineSummary&&<button className="quiet-button" disabled={!hasLiveFeed} onClick={()=>jumpToTaskSection('task-controls')}>Execution controls</button>}
  <button className="quiet-button" onClick={()=>jumpToTaskSection('task-timeline')}>Timeline</button>
  <button className="quiet-button" onClick={()=>jumpToTaskSection('task-development-notes')}>Development notes</button>
  {(proposalControls||canonical&&hasLiveFeed&&!publishedIntake)&&<button className="quiet-button" onClick={()=>jumpToTaskSection('task-editor')}>Task editor</button>}
  <button className="quiet-button" onClick={()=>jumpToTaskSection('task-attempts')}>Attempts</button>
  <button className="quiet-button" onClick={()=>jumpToTaskSection('task-evidence')}>Evidence</button>
  <button className="quiet-button" onClick={()=>jumpToTaskSection('task-telemetry')}>Telemetry</button>
</nav>
{detailState==='completed'&&<div className="task-completion" role="status"><CheckCircle2 size={24} aria-hidden="true"/><div><strong>Implementation complete</strong><small>Owner accepted the verified result.</small></div></div>}
{!demo&&(canonical?.task??current).owner_acceptance==='accepted'&&
  <IntegrationTaskStatus {...integrationRuns} taskId={current.id} attemptId={canonical?.attempts.at(-1)?.id}/>}
{statusBanner&&<div className={'task-completion task-execution-banner '+(statusBanner.tone??'neutral')} role="status">
  {statusBanner.tone==='error'?<CircleAlert size={24} aria-hidden="true"/>:<Activity size={24} aria-hidden="true"/>}
  <div><strong>{statusBanner.title}</strong>{statusBanner.description&&<small>{statusBanner.description}</small>}
    {statusBanner.at&&<small><time dateTime={statusBanner.at}>{fmt(statusBanner.at)}</time></small>}
    {executionStatus&&nextAction&&<small>{nextAction.description}</small>}</div>
  <button className="quiet-button" onClick={()=>jumpToTaskSection(statusSection)}>{
    ({'task-evidence':'View evidence','task-attempts':'View attempts','task-controls':'View controls'})[statusSection]}</button>
</div>}
{detailState==='archived'&&<p className="notice" role="status">Task archived{(canonical?.task??current).owner_acceptance==='accepted'?' · Owner accepted the final result.':''}</p>}
{engineSummary&&hasLiveFeed&&<Rise><Panel id="task-controls" title="Execution controls">
  {engineTask.error&&<p role="alert">{engineTask.error}</p>}
  {canonical?<Suspense fallback={<p role="status">Loading execution controls…</p>}><TaskEngineControls detail={canonical} workerAccess={workerAccess} workerDispatch={canonical.worker_dispatch??engine.workerDispatch} publishedIntake={publishedIntake} onCommand={engineTask.command} tasks={canonicalTasks} Status={Status}/></Suspense>:!engineTask.error&&<p role="status">Loading canonical Task state…</p>}
</Panel></Rise>}
<Rise><Panel id="task-timeline" title="Task Timeline"><TaskTimeline key={current.id} task={canonical?.task??current} canonical={canonical} github={demo?null:github} telemetrySource={taskTelemetrySource} attempts={taskAttempts} events={taskEvents} audits={taskAudits}
  executorAttempt={canonical?.attempts.at(-1)} executorState={canonical?.lifecycle.state}
  evidence={related(current.id,'evidence')} records={records} onOpenAttempt={id=>jumpToTaskSection('task-attempt-'+id)}/></Panel></Rise>
<Rise><Panel id="task-development-notes" title="Development Notes"
  right={developmentNotes.length>0&&<small className="panel-meta" title="The provider includes these messages in turn-level usage. Separate note token counts are unavailable.">
    {developmentNotes.length} notes · {developmentNoteBytes(developmentNotes)} text bytes
  </small>}>
  {developmentNotes.length?<ul className="task-development-notes">{developmentNotes.map(note=><li key={note.event_id}>
    <strong>{notesCategory(note.development_note.category)}</strong><span>{note.development_note.text}</span>
    <time dateTime={note.occurred_at}>{fmt(note.occurred_at)}</time>
  </li>)}</ul>:<p className="muted">No notes recorded.</p>}
</Panel></Rise>
{canonical&&hasLiveFeed&&!publishedIntake&&<Rise><Panel id="task-editor" title="Task editor">
  <ProposalControls key={current.id} task={canonical.task} control={canonical} tasks={canonicalTasks} summaries={summaries} Status={Status} classes={types}
    headers={verificationHeaders} readFields={taskDraft} refresh={()=>refresh(false,{quiet:true})}
    manageable={task=>Object.hasOwn(privateControls,task.id)} engineCommand={engineTask.command}
    engineEditable={canonical.lifecycle.can_edit_spec ?? (!canonical.lifecycle.executor&&['proposed','blocked'].includes(canonical.lifecycle.stored_state))}/>
</Panel></Rise>}
{proposalControls&&!engineSummary&&<Rise><Panel id="task-editor" title="Task editor">
  <ProposalControls key={current.id}
    task={current} control={proposalControls} tasks={tasks} Status={Status} classes={types}
    headers={verificationHeaders} readFields={taskDraft} refresh={()=>refresh(false,{quiet:true})}
    onHistory={setLegacyHistory} manageable={task=>Object.hasOwn(privateControls,task.id)}/>
</Panel></Rise>}
<div className="detail-layout"><div className="detail-left"><Rise><Panel title={current.title} kicker={current.id} right={<Status value={canonical?.lifecycle.recovered_candidate&&canonical.lifecycle.state==='verifying'?'candidate_recovered':canonical?.lifecycle.state??current.state}/>}><div className="objective">{(canonical?.task??current).objective}</div><TaskScopeSummary task={canonical?.task??current}/><DetailLine name="Execution activity" value={<TaskActivityLabel activity={activityFor(current)}/>}/>{!demo&&<DetailLine name="Telemetry last imported" value={execution?.events?.some(event=>event.task_id===current.id)?fmt(execution.generated_at):"No trace in current snapshot"}/>}{!demo&&proposals?.stale_revision_tasks?.includes(current.id)&&<div className="notice"><span>This proposal uses the last observed GitHub main revision. Confirm its source revision before starting work.</span></div>}{!demo&&proposals?.publication?.[current.id]==='published'&&<p><a className="proposal-link" href={githubProposalFolder.replace('/tree/','/blob/')+'/'+current.id+'.json'}>View proposal on GitHub</a></p>}{!demo&&proposals?.publication?.[current.id]==='pending'&&<div className="notice"><span>{publishError||'Saved privately. GitHub publication is pending.'}</span>{proposals.publication_configured&&<button className="quiet-button" disabled={saving} onClick={retryPublication}>Retry publication</button>}</div>}<div className="task-tags"><span>{current.classification?.primary}</span>{(current.classification?.secondary||[]).map(x=><span key={x}>{x}</span>)}</div></Panel></Rise><Rise delay={.08}><Panel title="Acceptance matrix" kicker="REQUIRED OUTCOMES" right={<span className="panel-meta">{current.acceptance?.criteria?.length||0} CRITERIA</span>}><TaskAcceptanceMatrix task={canonical?.task??current} canonical={canonical} evidence={related(current.id,'evidence')}
  attempts={taskAttempts} reviewed={reviewedCriteria} Status={Status}/></Panel></Rise><Rise><Panel id="task-attempts" title="Execution attempts"><TaskAttemptHistory key={current.id} attempts={taskAttempts} events={taskEvents} audits={taskAudits} evidence={related(current.id,'evidence')} Status={Status}/></Panel></Rise><Rise><Panel id="task-evidence" title="Evidence ledger"><TaskEvidenceLedger task={canonical?.task??current} evidence={related(current.id,'evidence')} attempts={taskAttempts} reviewed={[...reviewedCriteria.values()]} events={taskEvents} telemetrySource={taskTelemetrySource} Status={Status}/></Panel></Rise></div><StickySectionAside className="detail-right"><Rise delay={.05}><Panel title="Task record">{!engineSummary&&<TaskCapabilitySummary manageable={Boolean(proposalControls)}/>}<DetailLine name="Revision" value={<code>{short(current.revision)}</code>}/><DetailLine name="Created" value={fmt(current.created_at)}/><DetailLine name="Owner decision" value={(canonical?.task??current).owner_acceptance||'Unavailable'}/><DetailLine name="Verification" value={current.acceptance?.profile_id}/><DetailLine name="Context snapshots" value={related(current.id,'context_snapshot').length}/><DetailLine name="Artifacts" value={current.artifacts?.length||0}/></Panel></Rise><Rise delay={.1}><Panel title="Dependency graph"><TaskDependencies task={canonical?.task??current} tasks={tasks} lifecycle={canonical?.lifecycle} summaries={engineSummary?summaries:undefined} Status={Status}/></Panel></Rise></StickySectionAside></div></>:loading?<p role="status">Loading Task…</p>:<Empty title="Task not found" body="This Task is unavailable in the current feed."/>)}
{page==='detail'&&current&&<Rise><Panel id="task-telemetry" title="Telemetry"><Suspense fallback={<p role="status">Loading Task telemetry…</p>}>
  <TaskTelemetry key={current.id} task={canonical?.task??current} canonical={canonical} attempts={taskAttempts} telemetry={related(current.id,'telemetry')}
    events={taskEvents} records={demo?null:records} telemetrySource={taskTelemetrySource} pricing={pricing}/>
</Suspense></Panel></Rise>}
{page==='detail'&&!demo&&current&&hasLiveFeed&&<Rise><Panel title="Execution timing">
  <TaskExecutionTiming key={current.id} task={canonical?.task??current} canonical={canonical} attempts={taskAttempts}
    events={taskEvents} audits={taskAudits} evidence={related(current.id,'evidence')} github={github} telemetrySource={taskTelemetrySource}
    onOpenAttempt={id=>jumpToTaskSection('task-attempt-'+id)}/>
  <details><summary>Raw execution trace</summary><TraceWaterfall events={taskEvents} fixedTask={current.id}/></details>
</Panel></Rise>}
{page==='detail'&&!demo&&current&&hasLiveFeed&&
  <Suspense fallback={<p role="status">Loading failure investigation…</p>}><TaskFailureInvestigation key={current.id} task={current} records={records}
    events={execution?.events ?? []} github={github} ui={githubUi}/></Suspense>}
{page==='detail'&&canonical&&<Rise><Panel title="Execution and delivery"><Suspense fallback={<p role="status">Loading delivery records…</p>}>
  <TaskDeliveryEvidence task={canonical.task} lifecycle={canonical.lifecycle}/>
</Suspense></Panel></Rise>}
{page==='detail'&&current&&<Rise delay={.17}><Panel title="Full engineering record"><RawTaskRecord key={current.id} records={{task:current,attempts:related(current.id,'attempt'),evidence:related(current.id,'evidence'),telemetry:related(current.id,'telemetry'),context_snapshots:related(current.id,'context_snapshot'),verification_profiles:profiles.filter(p=>p.profile_id===current.acceptance?.profile_id)}}/></Panel></Rise>}
{page==='create'&&<div className="detail-layout"><Rise><Panel title="Define engineering task" kicker="CONTROL PLANE / INTAKE"><form className="form" onSubmit={create} onChange={e=>setDraft(taskDraft(e.currentTarget))}><label>Task title <input name="title" placeholder="Vela intelligence state transitions" required minLength={4} maxLength={160}/></label><label>Tangible objective <textarea name="objective" placeholder="Define exactly what behavior must exist, with clear scope…" required/></label><div className="form-grid"><label>Primary category <select name="primary">{types.map(c=><option key={c}>{c}</option>)}</select></label><label>Verification profile <input name="profile_id" defaultValue="visual-gpu" required/></label></div>{engine.status==='available'&&<label>Priority <select name="priority" defaultValue="normal">{['low','normal','high','urgent'].map(priority=><option key={priority}>{priority}</option>)}</select></label>}<label>Prerequisite task IDs <input name="dependencies" placeholder="task_001, task_002"/></label><label>Prerequisites that must merge into main <input name="merged_dependencies"/><small>Use Task IDs from the prerequisite list above.</small></label><label>Required capabilities <input name="capabilities" placeholder="GPU renderer, visual test harness"/></label><TaskScopeFields checks={checks}/><label>Acceptance criteria <textarea name="criteria" required placeholder={'Transitions match approved reference\nPerformance target is met\nOwner visual approval recorded'}/></label>{canPublish&&<label>Visibility <select name="visibility" defaultValue="private"><option value="private">Private Observatory</option><option value="public">Public GitHub proposal</option></select></label>}{engine.status==='error'&&!publicIntake&&<p className="notice error" role="alert">Task engine unavailable: {engine.error}</p>}{formError&&<div className="notice error"><CircleAlert size={16}/>{formError}</div>}<div className="form-actions"><motion.button type="submit" className="primary-button" disabled={saving||(!publicIntake&&!['available','absent'].includes(engine.status))||!Object.values(checks).every(Boolean)} whileTap={{scale:.97}}><Plus size={16}/>{saving?'Saving…':publicIntake?(proposals.publication_configured?'Create and publish proposal':'Queue public proposal'):(engine.status==='available'?'Create Task':'Create proposed task')}</motion.button><button type="button" className="quiet-button" onClick={()=>navigate('tasks')}>Cancel</button></div></form></Panel></Rise><StickySectionAside><Rise delay={.08}><TaskAdmission checks={checks} tasks={tasks} summaries={engine.status==='available'?summaries:undefined} draft={draft} publicIntake={publicIntake} publicationConfigured={proposals?.publication_configured}/></Rise></StickySectionAside></div>}
</motion.div><footer><span>ENGINEERING RECORDS ARE NOT AGENT INTENT · EVIDENCE IS NOT APPROVAL</span><span>{deployedRevision?'BUILD '+short(deployedRevision)+' · ':''}CONTROL SURFACE / V1</span></footer></main></div>}
createRoot(document.getElementById('root')).render(<MotionConfig reducedMotion="user"><App/></MotionConfig>);
