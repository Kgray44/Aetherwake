import React,{lazy,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig,motion,useReducedMotion} from 'motion/react';
import {Activity,ArrowLeft,ArrowRight,BarChart3,Boxes,CheckCircle2,CircleX,CircleAlert,Clock3,GitPullRequest,Layers3,ListTodo,Plus,Radio,RefreshCw,ShieldCheck,Workflow} from 'lucide-react';
import {demoRecords} from './demo-data.js';
import {ExecutionFeed,TraceWaterfall} from './execution-feed.jsx';
import {useAutomaticTelemetry} from './automatic-telemetry.jsx';
import {criterionEvidenceStatus,evidenceClaimStatus} from './evidence-status.mjs';
import {GitHubFeed} from './github-feed.jsx';
import {EngineeringAnalyticsPage} from './engineering-analytics-page.jsx';
import {ProposalControls} from './proposal-controls.jsx';
import {TaskFailureInvestigation} from './failure-investigation.jsx';
import {GitHubActivityDetails,GitHubActivityList} from './github-activity-pages.jsx';
import {activityHref,parseActivityHref} from './github-activity.mjs';
import {proposalChecks} from '../intake.mjs';
import {TaskActivityLabel,TaskCapabilitySummary,TaskDependencies,TaskExplorer,TaskRows,useTaskFilters} from './task-workspace.jsx';
import {dependencyGraph,parseTaskHref,taskActivity,taskHref} from './task-workspace.mjs';
import {useTaskEngineDetail} from './use-task-engine-detail.jsx';
import {taskEngineRequest} from './task-engine-client.mjs';
import {buildEngineeringAnalytics} from './engineering-analytics.mjs';
import './styles.css';

const TaskEngineControls=lazy(()=>import('./task-engine-controls.jsx').then(module=>({default:module.TaskEngineControls})));
const TaskTokenAccounting=lazy(()=>import('./task-engine-controls.jsx').then(module=>({default:module.TaskTokenAccounting})));

const types=['visual','bug','backend','performance','security','research','documentation','feature','maintenance','integration'];
const nav=[['overview','Overview',Activity],['tasks','Task Control Center',ListTodo],['analytics','Engineering analytics',BarChart3],['pulls','Pull requests',GitPullRequest],['runs','CI runs',Workflow],['create','New task',Plus]];
const fmt=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Unavailable';
const date=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Unavailable';
const short=v=>v?String(v).slice(0,10):'Unavailable';
const split=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean);
const ease=[.22,1,.36,1];
const verification = new URLSearchParams(window.location.search).get('verification');
const verificationHeaders = verification ? {'x-observatory-verification': verification} : {};
const fade={initial:{opacity:0,y:15,filter:'blur(5px)'},animate:{opacity:1,y:0,filter:'blur(0px)'},exit:{opacity:0,y:-10,filter:'blur(3px)'}};
function Ambient(){const canvas=useRef(null),reduce=useReducedMotion();useEffect(()=>{if(reduce)return;const el=canvas.current,ctx=el.getContext('2d',{alpha:true});if(!ctx)return;let raf=0,w=0,h=0,dpr=1,last=0;const rnd=(a,b)=>a+Math.random()*(b-a);let motes=Array.from({length:42},()=>({x:Math.random(),y:Math.random(),r:rnd(.45,1.6),v:rnd(.0008,.003),phase:rnd(0,6.28)}));let sparks=[];function resize(){w=window.innerWidth;h=window.innerHeight;dpr=Math.min(1.5,window.devicePixelRatio||1);el.width=Math.floor(w*dpr);el.height=Math.floor(h*dpr);el.style.width=w+'px';el.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0)}function frame(t){if(document.hidden){raf=requestAnimationFrame(frame);return}if(t-last<33){raf=requestAnimationFrame(frame);return}const dt=Math.min(50,t-last||33);last=t;ctx.clearRect(0,0,w,h);const glow=ctx.createRadialGradient(w*.8,h*.15,0,w*.8,h*.15,Math.max(w,h)*.75);glow.addColorStop(0,'rgba(32,109,137,.065)');glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);for(const m of motes){m.y-=m.v*dt/1000;m.x+=Math.sin(t*.00011+m.phase)*.000007;if(m.y<-.02)m.y=1.02;ctx.globalAlpha=.16+.26*(.5+.5*Math.sin(t*.001+m.phase));ctx.fillStyle='#8bcdd8';ctx.beginPath();ctx.arc(m.x*w,m.y*h,m.r,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;if(Math.random()<.012&&sparks.length<5){sparks.push({x:rnd(w*.2,w*.96),y:rnd(h*.15,h*.8),vx:rnd(-.5,.45),vy:rnd(-1,-.2),life:1})}sparks=sparks.filter(s=>s.life>0);for(const s of sparks){ctx.strokeStyle='rgba(244,184,113,'+(.43*s.life)+')';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.x-s.vx*12,s.y-s.vy*12);ctx.stroke();s.x+=s.vx*dt*.05;s.y+=s.vy*dt*.05;s.life-=dt/850}raf=requestAnimationFrame(frame)}resize();raf=requestAnimationFrame(frame);window.addEventListener('resize',resize);return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize)}},[reduce]);return <><div className="atmosphere" aria-hidden="true"><div className="haze haze-a"/><div className="haze haze-b"/><div className="scan-grid"/></div><canvas ref={canvas} className="ambient-canvas" aria-hidden="true"/></>}
function Rise({children,delay=0,className='',...rest}){const reduce=useReducedMotion();return <motion.div className={className} initial={reduce?false:fade.initial} animate={fade.animate} exit={reduce?{opacity:0}:fade.exit} transition={{duration:reduce?.02:.53,delay:reduce?0:delay,ease}} {...rest}>{children}</motion.div>}
function Status({value='unavailable'}){return <span className={'status status-'+value}><span className="status-light"/>{String(value).replaceAll('_',' ')}</span>}
function Panel({title,kicker,right,children,className=''}){return <section className={'panel '+className}><div className="panel-heading"><div>{kicker&&<div className="kicker">{kicker}</div>}<h2>{title}</h2></div>{right}</div>{children}</section>}
function Empty({title='No records available',body='Create a task or connect a contract-compliant record source.'}){return <div className="empty"><Boxes size={25}/><strong>{title}</strong><p>{body}</p></div>}
function Metric({name,value,meta,Icon,index}){return <Rise className="metric" delay={index*.055}><div className="metric-top"><span>{name}</span><Icon size={17}/></div><strong>{value}</strong><small>{meta}</small><span className="metric-rule"/></Rise>}
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
    criteria: String(f.get('criteria') || '').split('\n').map(s => s.trim()).filter(Boolean),
  };
}

function TaskAdmission({checks, draft, tasks, publicIntake, publicationConfigured}) {
  const dependencies=dependencyGraph({prerequisites:{task_ids:draft.dependencies}},tasks).upstream;
  const steps = [
    ['Explicit outcome', checks.outcome, 'Enter a title (4+ characters) and objective (12+ characters).'],
    ['Task classification', checks.classification, 'Choose a primary category.'],
    ['Prerequisite contracts', checks.prerequisites, 'Optional. Use up to 100 task IDs and 100 capabilities.'],
    ['Verifiable acceptance', checks.acceptance, 'Enter a verification profile and at least one criterion (up to 50).'],
  ];
  return <Panel title="Task admission" kicker="ENFORCEMENT BOUNDARY">
    <div className="step-list" aria-live="polite">{steps.map(([label, valid, help], index) => <div className="step" key={label}>
      <span>{String(index + 1).padStart(2, '0')}</span><strong>{label}{(!valid || index === 2) && <small>{help}</small>}</strong>
      {valid ? <CheckCircle2 size={15} role="img" aria-label="Complete"/> : <CircleX className="admission-missing" size={15} role="img" aria-label="Incomplete"/>}
    </div>)}</div>
    {dependencies.length>0&&<ul className="dependency-nodes">{dependencies.map(node=><li key={node.id}><span>{node.task?.title??node.id}</span><Status value={node.status}/></li>)}</ul>}
    {draft.capabilities?.length>0&&<p className="low">Required capabilities are unverified.</p>}
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
const [githubFilters,setGitHubFilters]=useState({
  pulls:{query:'',state:'',group:'',oldest:false},
  runs:{query:'',state:'',group:'',oldest:false}
});
const page=githubView ? (githubView.id ? 'github-detail' : githubView.kind) : taskRoute ? (taskRoute.id ? 'detail' : 'tasks') : localPage;
const activeNavigation=githubView?.kind ?? (page==='detail'?'tasks':page);
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
const refreshId=useRef(0), foregroundRequest=useRef(false), submitting=useRef(false), proposalRequest=useRef(null);
const canPublish = Boolean(proposals && !proposals.verification && !demo);
const publicIntake = canPublish && draft.visibility === 'public';
const checks = proposalChecks(draft);
const refresh=async(mode=demo,{quiet=false,signal}={})=>{
  if(quiet&&foregroundRequest.current)return;
  const id=++refreshId.current;
  foregroundRequest.current=!quiet&&!mode;
  if(mode){setHasLiveFeed(false);setRecords(demoRecords());setError('');setLoading(false);return}
  if(!quiet)setLoading(true);
  try{
    const [r,engineResult]=await Promise.all([
      fetch('/api/overview',{cache:'no-store',headers:verificationHeaders,signal}),
      taskEngineRequest({op:'list'},verificationHeaders,{signal}).then(data=>({data}),error=>({error})),
    ]);
    if(!r.ok)throw Error('HTTP '+r.status);
    const j=await r.json();
    if(signal?.aborted||id!==refreshId.current)return;
    setHasLiveFeed(true);
    setRecords(Array.isArray(j.records)?j.records:[]);
    setRevision(j.revision);
    setGitHub(j.github??null);setExecution(j.execution??null);setTelemetryScope(j.telemetry_scope??null);
    setProposals(j.proposals??null);
    if(engineResult.error)setEngine(previous=>({...previous,status:'error',error:engineResult.error.message}));
    else if(Array.isArray(engineResult.data?.tasks))setEngine({status:'available',tasks:engineResult.data.tasks});
    else if(engineResult.data===null)setEngine({status:'absent',tasks:[]});
    else setEngine(previous=>({...previous,status:'error',error:'Unexpected Task registry response.'}));
    setError('');
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
const watchingTasks=Boolean(taskRoute)&&!demo;
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
},[watchingTasks]);
const automaticTelemetry=useAutomaticTelemetry({scope:!demo&&hasLiveFeed?telemetryScope:null,headers:verificationHeaders,refresh:()=>refresh(false)});
const by=type=>records.filter(r=>r.record_type===type);
const tasks=useMemo(()=>records.filter(r=>r.record_type==='task').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),[records]);
const summaries=useMemo(()=>new Map(engine.tasks.map(item=>[item.task.id,item])),[engine.tasks]);
const displayTasks=useMemo(()=>demo?tasks:tasks.map(task=>{
  const lifecycle=summaries.get(task.id)?.lifecycle;
  return lifecycle?{...task,state:lifecycle.state,contractState:task.state}:task;
}),[demo,tasks,summaries]);
const attempts=by('attempt'),evidence=by('evidence'),telemetry=by('telemetry'),contexts=by('context_snapshot'),profiles=by('verification_profile');
const related=(id,type)=>records.filter(r=>r.record_type===type&&r.task_id===id);
const total=s=>tasks.filter(t=>t.state===s).length;
const chart=useMemo(()=>Array.from({length:14},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-13+i);return tasks.filter(t=>String(t.created_at).slice(0,10)===d.toISOString().slice(0,10)).length}),[tasks]);
const durations=telemetry.flatMap(r=>r.measurements||[]).filter(m=>m.availability==='observed'&&['duration_seconds','elapsed_seconds'].includes(m.name)&&typeof m.value==='number');
const duration=durations.length?Math.round(durations.reduce((s,m)=>s+m.value,0)/60).toLocaleString()+' min':'Unavailable';
const privateControls=!demo ? {...proposals?.controls,...Object.fromEntries(engine.tasks.filter(item=>!proposals?.publication?.[item.task.id])
  .map(item=>[item.task.id,{priority:item.priority,version:item.version}]))} : {};
const activityFor=task=>taskActivity(task,related(task.id,'attempt'),execution?.events??[],demo?null:summaries.get(task.id)?.lifecycle);
const current=tasks.find(t=>t.id===taskRoute?.id);
const engineSummary=!demo&&current&&!proposals?.publication?.[current.id]?summaries.get(current.id):null;
const engineTask=useTaskEngineDetail({summary:engineSummary,headers:verificationHeaders,onRefresh:()=>refresh(false,{quiet:true})});
const canonical=engineTask.detail;
const canonicalTasks=tasks.filter(task=>summaries.has(task.id)&&!proposals?.publication?.[task.id]);
const scopedAccounting=useMemo(()=>current&&!demo?buildEngineeringAnalytics({
  records:records.filter(record=>record.id===current.id||record.task_id===current.id),
  events:(execution?.events??[]).filter(event=>event.task_id===current.id),
}).tokenAccounting:null,[current?.id,demo,records,execution]);
const select=id=>{
  window.location.hash=taskHref(id);
  setRouteHash(window.location.hash);
};
const proposalControls=current&&!demo&&Object.hasOwn(proposals?.controls??{},current.id)?proposals.controls[current.id]:null;
const navigate=id=>{
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
const title=({overview:'Engineering overview',tasks:'Task Control Center',detail:current?.title??'Task inspection',analytics:'Engineering analytics',create:'Create task',pulls:'Pull requests',runs:'CI runs','github-detail':githubView?.kind==='pulls'?'Pull request':'CI run'})[page],desc=({overview:'Systems intelligence / Engineering operations',tasks:'Create and manage private proposals. Inspect Tasks and their execution records.',detail:'Complete execution trace and acceptance evidence',analytics:'Delivery, verification, and execution observations',create:'Structured engineering task intake',pulls:'Find changes and inspect their GitHub details',runs:'Inspect workflow outcomes, jobs, and steps','github-detail':'Kgray44 / Aetherwake'})[page];
useEffect(()=>{document.title=title+' · Aetherwake Observatory'},[title]);
const githubUi={Metric,Panel,Rise,Status};
const activityGroup=kind=>demo?null:kind==='pulls'?github?.pulls:github?.ci;
return <div className="app-shell"><Ambient/><aside className="sidebar"><div className="brand"><span className="brand-logo"><Layers3 size={21} strokeWidth={1.6}/></span><div><b>AETHERWAKE</b><small>ENGINEERING SYSTEMS</small></div></div><div className="rail-caption">OPERATIONS</div><nav>{nav.map(([id,label,Icon])=><motion.button key={id} className={'nav-link '+((activeNavigation===id)?'selected':'')} onClick={()=>navigate(id)} whileHover={{x:3}} whileTap={{scale:.98}}><Icon size={17} strokeWidth={1.7}/>{label}{(activeNavigation===id)&&<motion.span className="nav-indicator" layoutId="nav-indicator" transition={{type:'spring',stiffness:350,damping:30}}/>}</motion.button>)}</nav><div className="sidebar-bottom"><div className="connect-label"><span className="live-dot"/> {proposals?'PRIVATE SITES HOST':'LOCAL CONTROL PLANE'}</div><div className="mono">{short(revision)}</div><div>CONTRACT v1.0 · PHASE E</div></div></aside><main className="main"><header className="topbar"><div><div className="overline"><span className="overline-line"/>AETHERWAKE / ENGINEERING OBSERVATORY</div><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{desc}</p></div><div className="header-actions">{demo&&<span className="demo-flag">SIMULATED DATA</span>}{page==='analytics'?<span className="connect-label"><span className="live-dot"/> Live sources</span>:<div className="mode-toggle">{['Live','Demo'].map(m=><button key={m} className={(demo===(m==='Demo'))?'on':''} onClick={()=>{const v=m==='Demo';setDemo(v);refresh(v)}}>{m}</button>)}</div>}<motion.button className="icon-button" aria-label="Refresh records" title="Refresh" whileTap={reduce?undefined:{rotate:160}} onClick={()=>refresh()}><RefreshCw size={17}/></motion.button><motion.button className="primary-button" whileHover={{y:-2}} whileTap={{scale:.97}} onClick={()=>navigate('create')}><Plus size={16}/> New task</motion.button></div></header>{!demo&&proposals?.verification&&<div className="notice"><ShieldCheck size={16}/>Isolated verification proposals</div>}{error&&<div className="notice error" role="status"><CircleAlert size={17}/>{error}</div>}{loading&&<div className="notice"><Radio size={16}/>Synchronizing engineering record feed…</div>}<motion.div key={page+(taskRoute?.id?'-'+taskRoute.id:'')+(githubView?.id?'-'+githubView.kind+'-'+githubView.id:'')+(demo?'-demo':'-live')} initial={reduce?false:{opacity:0,y:14}} animate={{opacity:1,y:0}} transition={{duration:reduce?.01:.3,ease}} className="view">
{page==='overview'&&<><div className="metrics"><Metric name="Registered tasks" value={tasks.length} meta="Canonical v1 records" Icon={Boxes} index={0}/><Metric name="Accepted" value={total('accepted')} meta="Explicit task outcomes" Icon={CheckCircle2} index={1}/><Metric name="Engine running" value={engine.status==='available'?engine.tasks.filter(item=>item.lifecycle.state==='running').length:'Unavailable'} meta="Current Task Engine state" Icon={Activity} index={2}/><Metric name="At risk" value={total('blocked')+total('failed')} meta="Blocked + failed" Icon={CircleAlert} index={3}/><Metric name="Observed time" value={duration} meta="No quota inference" Icon={Clock3} index={4}/></div><div className="wide-grid"><Rise delay={.12}><Panel title="Engineering throughput" kicker="01 / ACTIVITY SIGNAL" right={<span className="panel-meta">TASK ARRIVAL · 14D</span>}><Timeline values={chart}/><div className="chart-footer">TASKS CREATED <span>Only observed records shown</span></div></Panel></Rise><Rise delay={.19}><Panel title="Delivery integrity" kicker="02 / ACCEPTANCE" right={<ShieldCheck size={18} className="muted-icon"/>}><div className="accept-head"><strong>{tasks.length?Math.round(100*total('accepted')/tasks.length)+'%':'—'}</strong><small>ACCEPTED TASKS</small></div><div className="track"><motion.span initial={{width:0}} animate={{width:(tasks.length?100*total('accepted')/tasks.length:0)+'%'}} transition={{duration:.9,ease}}/></div><DetailLine name="Execution attempts" value={attempts.length}/><DetailLine name="Failed attempts" value={attempts.filter(a=>a.state==='failed').length}/><DetailLine name="Evidence records" value={evidence.length}/><DetailLine name="Reported passes (unverified)" value={evidence.filter(e=>e.result==='passed').length}/><DetailLine name="Pending acceptance" value={tasks.filter(t=>t.state!=='accepted').length}/></Panel></Rise></div><Rise delay={.24}><Panel title="Recent engineering work" kicker="03 / TASK FEED" right={<button className="text-button" onClick={()=>navigate('tasks')}>Open Task Control Center <ArrowRight size={15}/></button>}><TaskRows tasks={displayTasks.slice(0,9)} controls={privateControls} related={related} activityFor={activityFor} Status={Status}/></Panel></Rise>{!demo&&proposals&&<ExecutionFeed execution={execution} records={records} headers={verificationHeaders} onRefresh={()=>refresh(false)} automatic={telemetryScope?automaticTelemetry:null}/>} {!demo&&github&&<Rise><Panel title="GitHub repository activity" kicker="PUBLIC ENGINEERING SOURCES"><GitHubFeed data={github}/></Panel></Rise>}</>}
{page==='tasks'&&<Rise><TaskExplorer tasks={displayTasks} controls={privateControls} related={related} activityFor={activityFor}
  Status={Status} Panel={Panel} loading={loading} filters={filters} setFilters={setFilters} onCreate={()=>navigate('create')}/></Rise>}
{(page==='pulls'||page==='runs')&&<GitHubActivityList kind={page} group={activityGroup(page)} ui={githubUi}
  ci={{ headers:verificationHeaders, live:!demo&&Boolean(proposals), mainRevision:github?.main?.status==='available'?revision:null }}
  filters={githubFilters[page]} setFilters={next=>setGitHubFilters(previous=>({...previous,[page]:next}))}/>}
{page==='github-detail'&&<GitHubActivityDetails kind={githubView.kind} id={githubView.id} group={activityGroup(githubView.kind)}
  headers={verificationHeaders} live={!demo&&Boolean(proposals)} ui={githubUi}
  investigation={{ records, events: execution?.events ?? [], github,
    openTask: taskId => { navigate('detail'); select(taskId); } }}/>}
{page==='analytics'&&<EngineeringAnalyticsPage
  records={records} events={execution?.events} github={demo?null:github} execution={demo?null:execution}
  ready={!demo&&hasLiveFeed} ui={githubUi}/>}
{page==='detail'&&(current?<><button className="back" onClick={()=>navigate('tasks')}><ArrowLeft size={15}/> Back to Task Control Center</button>
{engineSummary&&<Rise><Panel title="Execution controls">
  {engineTask.error&&<p role="alert">{engineTask.error}</p>}
  {canonical?<Suspense fallback={<p role="status">Loading execution controls…</p>}><TaskEngineControls detail={canonical} onCommand={engineTask.command} tasks={canonicalTasks} Status={Status}/></Suspense>:!engineTask.error&&<p role="status">Loading canonical Task state…</p>}
</Panel></Rise>}
{canonical&&<Rise><Panel title="Task editor">
  <ProposalControls key={current.id} task={canonical.task} control={canonical} tasks={canonicalTasks} classes={types}
    headers={verificationHeaders} readFields={taskDraft} refresh={()=>refresh(false,{quiet:true})}
    manageable={task=>Object.hasOwn(privateControls,task.id)} engineCommand={engineTask.command}
    engineEditable={!canonical.lifecycle.executor&&['proposed','blocked'].includes(canonical.lifecycle.stored_state)}/>
</Panel></Rise>}
{proposalControls&&!engineSummary&&<Rise><Panel title="Task editor">
  <ProposalControls key={current.id}
    task={current} control={proposalControls} tasks={tasks} classes={types}
    headers={verificationHeaders} readFields={taskDraft} refresh={()=>refresh(false,{quiet:true})}
    manageable={task=>Object.hasOwn(privateControls,task.id)}/>
</Panel></Rise>}
<div className="detail-layout"><div className="detail-left"><Rise><Panel title={current.title} kicker={current.id} right={<Status value={canonical?.lifecycle.state??current.state}/>}><div className="objective">{current.objective}</div><DetailLine name="Execution activity" value={<TaskActivityLabel activity={activityFor(current)}/>}/>{!demo&&<DetailLine name="Telemetry last imported" value={execution?.events?.some(event=>event.task_id===current.id)?fmt(execution.generated_at):"No trace in current snapshot"}/>}{!demo&&proposals?.stale_revision_tasks?.includes(current.id)&&<div className="notice"><span>This proposal uses the last observed GitHub main revision. Confirm its source revision before starting work.</span></div>}{!demo&&proposals?.publication?.[current.id]==='published'&&<p><a className="proposal-link" href={githubProposalFolder.replace('/tree/','/blob/')+'/'+current.id+'.json'}>View proposal on GitHub</a></p>}{!demo&&proposals?.publication?.[current.id]==='pending'&&<div className="notice"><span>{publishError||'Saved privately. GitHub publication is pending.'}</span>{proposals.publication_configured&&<button className="quiet-button" disabled={saving} onClick={retryPublication}>Retry publication</button>}</div>}<div className="task-tags"><span>{current.classification?.primary}</span>{(current.classification?.secondary||[]).map(x=><span key={x}>{x}</span>)}</div></Panel></Rise><Rise delay={.08}><Panel title="Acceptance matrix" kicker="REQUIRED OUTCOMES" right={<span className="panel-meta">{current.acceptance?.criteria?.length||0} CRITERIA</span>}>{(current.acceptance?.criteria||[]).map(c=>{let m=related(current.id,'evidence').filter(e=>e.criterion_id===c.id);return <div className="record" key={c.id}><div className="record-title"><strong>{c.id}</strong><Status value={criterionEvidenceStatus(m,current.revision,related(current.id,'attempt'))}/></div><p>{c.description}</p><small>{m.length} reported records · not acceptance receipts</small></div>})}</Panel></Rise><Rise delay={.12}><Panel title="Execution attempts" kicker="AGENT HISTORY" right={<span className="panel-meta">{related(current.id,'attempt').length} ATTEMPTS</span>}>{related(current.id,'attempt').length?related(current.id,'attempt').map(a=><div className="record" key={a.id}><div className="record-title"><strong>Attempt {a.attempt_number}</strong><Status value={a.state}/></div><p>{[a.provider,a.model,a.branch].filter(Boolean).join(' / ')||'Provider unavailable'}</p><small>{fmt(a.started_at)} → {fmt(a.finished_at)}</small>{a.failure_diagnosis&&<p className="warn">{a.failure_diagnosis}</p>}</div>):<Empty title="No attempts recorded"/>}</Panel></Rise><Rise delay={.16}><Panel title="Evidence ledger" kicker="REVISION-PINNED RESULTS">{related(current.id,'evidence').length?related(current.id,'evidence').map(e=><div className="record" key={e.id}><div className="record-title"><strong>{e.criterion_id} / {e.kind}</strong><Status value={evidenceClaimStatus(e,related(current.id,'attempt'))}/></div><p className="mono">{e.artifact?.uri||'No artifact'}</p><small>{short(e.revision)} {e.synthetic?' · SYNTHETIC': ''}</small></div>):<Empty/>}</Panel></Rise></div><div className="detail-right"><Rise delay={.05}><Panel title="Task record">{!engineSummary&&<TaskCapabilitySummary manageable={Boolean(proposalControls)}/>}<DetailLine name="Revision" value={<code>{short(current.revision)}</code>}/><DetailLine name="Created" value={fmt(current.created_at)}/><DetailLine name="Owner decision" value={current.owner_acceptance||'Unavailable'}/><DetailLine name="Verification" value={current.acceptance?.profile_id}/><DetailLine name="Context snapshots" value={related(current.id,'context_snapshot').length}/><DetailLine name="Artifacts" value={current.artifacts?.length||0}/></Panel></Rise><Rise delay={.1}><Panel title="Dependency graph"><TaskDependencies task={canonical?.task??current} tasks={canonical?canonicalTasks:tasks} Status={Status}/></Panel></Rise><Rise delay={.14}><Panel title="Telemetry" kicker="OBSERVED / ESTIMATED / UNAVAILABLE">{related(current.id,'telemetry').length?related(current.id,'telemetry').map(r=><div className="record" key={r.id}><strong>{r.phase}</strong>{(r.measurements||[]).map((m,i)=><DetailLine key={i} name={m.name} value={(m.availability==='unavailable'?'Unavailable':m.value??'Unavailable')+' '+(m.unit||'')+' · '+m.availability}/>)}</div>):<Empty title="No telemetry recorded"/>}</Panel></Rise><Rise><Panel title="Model and token accounting"><Suspense fallback={<p role="status">Loading token accounting…</p>}><TaskTokenAccounting accounting={scopedAccounting} taskId={current.id}/></Suspense></Panel></Rise><Rise delay={.17}><Panel title="Full engineering record" kicker="RAW / CONTRACT V1"><pre className="json">{JSON.stringify({task:current,attempts:related(current.id,'attempt'),evidence:related(current.id,'evidence'),telemetry:related(current.id,'telemetry'),context_snapshots:related(current.id,'context_snapshot'),verification_profiles:profiles.filter(p=>p.profile_id===current.acceptance?.profile_id)},null,2)}</pre></Panel></Rise></div></div></>:loading?<p role="status">Loading Task…</p>:<Empty title="Task not found" body="This Task is unavailable in the current feed."/>)}
{page==='detail'&&!demo&&current&&hasLiveFeed&&<Rise><Panel title="Execution timeline">
  <TraceWaterfall events={(execution?.events??[]).filter(event=>event.task_id===current.id)} fixedTask={current.id}/>
</Panel></Rise>}
{page==='detail'&&!demo&&current&&hasLiveFeed&&
  <TaskFailureInvestigation key={current.id} task={current} records={records}
    events={execution?.events ?? []} github={github} ui={githubUi}/>}
{page==='create'&&<div className="detail-layout"><Rise><Panel title="Define engineering task" kicker="CONTROL PLANE / INTAKE"><form className="form" onSubmit={create} onChange={e=>setDraft(taskDraft(e.currentTarget))}><label>Task title <input name="title" placeholder="Vela intelligence state transitions" required minLength={4} maxLength={160}/></label><label>Tangible objective <textarea name="objective" placeholder="Define exactly what behavior must exist, with clear scope…" required minLength={12}/></label><div className="form-grid"><label>Primary category <select name="primary">{types.map(c=><option key={c}>{c}</option>)}</select></label><label>Verification profile <input name="profile_id" defaultValue="visual-gpu" required/></label></div>{engine.status==='available'&&<label>Priority <select name="priority" defaultValue="normal">{['low','normal','high','urgent'].map(priority=><option key={priority}>{priority}</option>)}</select></label>}<label>Prerequisite task IDs <input name="dependencies" placeholder="task_001, task_002"/></label><label>Required capabilities <input name="capabilities" placeholder="GPU renderer, visual test harness"/></label><label>Acceptance criteria <textarea name="criteria" required placeholder={'Transitions match approved reference\nPerformance target is met\nOwner visual approval recorded'}/></label>{canPublish&&<label>Visibility <select name="visibility" defaultValue="private"><option value="private">Private Observatory</option><option value="public">Public GitHub proposal</option></select></label>}{engine.status==='error'&&!publicIntake&&<p className="notice error" role="alert">Task engine unavailable: {engine.error}</p>}{formError&&<div className="notice error"><CircleAlert size={16}/>{formError}</div>}<div className="form-actions"><motion.button type="submit" className="primary-button" disabled={saving||(!publicIntake&&!['available','absent'].includes(engine.status))||!Object.values(checks).every(Boolean)} whileTap={{scale:.97}}><Plus size={16}/>{saving?'Saving…':publicIntake?(proposals.publication_configured?'Create and publish proposal':'Queue public proposal'):(engine.status==='available'?'Create Task':'Create proposed task')}</motion.button><button type="button" className="quiet-button" onClick={()=>navigate('tasks')}>Cancel</button></div></form></Panel></Rise><Rise delay={.08}><TaskAdmission checks={checks} tasks={tasks} draft={draft} publicIntake={publicIntake} publicationConfigured={proposals?.publication_configured}/></Rise></div>}
</motion.div><footer><span>ENGINEERING RECORDS ARE NOT AGENT INTENT · EVIDENCE IS NOT APPROVAL</span><span>CONTROL SURFACE / V1</span></footer></main></div>}
createRoot(document.getElementById('root')).render(<MotionConfig reducedMotion="user"><App/></MotionConfig>);
