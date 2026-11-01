#!/usr/bin/env node
/**
 * Governance Context Router V2.
 *
 * Deterministic, zero-dependency retrieval of scoped governance sections and
 * explicitly addressed requirements. Source files remain authoritative.
 *
 * This is an implementable precursor to Aerynth's future CIE, not a semantic
 * search model or a proof of complete coverage.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { normalize, parseRegistry, validateRouter, routeGovernance } from "./governance-router.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(ROOT,path),"utf8");
const digest=value=>createHash("sha256").update(value).digest("hex");
const STOP=new Set(["with","that","this","from","into","what","when","where","have","will","would","should","could","about","than","then","your","their","which","does","only","using","some","most","there","they","while","also","need","make","work","task","tasks","implement","build","update","create","change","file","files","source","project"]);
const terms=text=>[...new Set(normalize(text).split(" ").filter(x=>x.length>2&&!STOP.has(x)))];
const estimate=characters=>Math.ceil(characters/4); // Explicit character-based proxy, NOT tokenizer metering.
const DEFAULT_POLICIES=JSON.parse(read("config/governance-context-policies.json"));

export function buildGovernanceIndex(config,registry,readFile=read,exists=p=>existsSync(resolve(ROOT,p))) {
  const check=validateRouter(config,registry,exists);
  if(check.errors.length) throw new Error("Governance invalid: "+check.errors.join("; "));
  const documents=[], requirements=new Map();
  for(const [id,path] of Object.entries(config.charters).sort((a,b)=>a[0].localeCompare(b[0]))) {
    const reg=registry.get(id);
    if(reg.status==="planned" || !exists(path)) {documents.push({id,path,authority:reg.status,available:false,sections:[],sha256:null});continue;}
    const content=readFile(path);
    const lines=content.split(/\r?\n/),sections=[];
    const headings=[];
    for(let i=0;i<lines.length;i++) {
      const m=lines[i].match(/^##\s+(.+?)\s*$/);
      if(m) headings.push({line:i,title:m[1]});
    }
    if(!headings.length) throw new Error("No level-2 sections in "+path);
    for(let h=0;h<headings.length;h++) {
      const start=headings[h].line,end=h+1<headings.length?headings[h+1].line:lines.length;
      const raw=lines.slice(start,end).join("\n").trimEnd()+"\n";
      const ids=[];
      for(let j=start;j<end;j++) {
        const m=lines[j].match(/^\s*\*\*(AW-[A-Z]+-\d{3})\s+—\s+/);
        if(!m) continue;
        if(requirements.has(m[1])) throw new Error("Duplicate normative requirement "+m[1]);
        const requirement={id:m[1],charter:id,path,line:j+1,text:lines[j].trim(),section:h+1,authority:reg.status};
        requirements.set(m[1],requirement);
        ids.push(m[1]);
      }
      sections.push({ordinal:h+1,title:headings[h].title,path,start_line:start+1,end_line:end,sha256:digest(raw),text:raw,requirementIds:ids});
    }
    documents.push({id,path,authority:reg.status,available:true,sha256:digest(content),fullText:content,sections,sourceChars:content.length});
  }
  return {documents,requirements,registry};
}

function relevance(section,query) {
  const q=terms(query);if(!q.length)return 0;
  const heading=normalize(section.title),body=normalize(section.text);
  let score=0;
  for(const token of q) {
    const root=token.replace(/(ing|ed|es|s)$/,"");
    const matches=text=>text.includes(" "+token+" ") || (root.length>3 && text.includes(" "+root));
    if(matches(" "+heading+" "))score+=12;
    if(matches(" "+body+" "))score+=2;
  }
  if(section.requirementIds.some(id=>query.includes(id)))score+=500;
  return score;
}

function hasMutationScope(text,paths) {
  return /\b(delete|remove|overwrite|publish|upload|deploy|transfer|move|write|mutate|revoke|credentials|secrets|permissions|authorization)\b/i.test(text+" "+paths.join(" "));
}
function unique(arr) {return [...new Set(arr)];}

/**
 * Full Constitution is the default safety baseline. Charters are loaded by
 * bounded relevant section, or fully when relevance is indeterminate.
 * Explicit requirement IDs are always included with their original text.
 * Direct citation of another requirement in an extracted normative line
 * produces a bounded 1-hop dependency. No requirement is silently deleted.
 */
export function buildContext({config,registry,index,task="",paths=[],requiredIds=[],maxSections=2,budgetTokens=null,forceFull=false,policies=DEFAULT_POLICIES}) {
  if(!task.trim()&&!paths.length&&!requiredIds.length)throw new Error("Provide --task, --path, or --requirement");
  const exists=path=>index.documents.some(x=>x.path===path&&x.available);
  // Validate manual IDs before routing; avoid a partial "successful" package.
  for(const id of requiredIds)if(!index.requirements.has(id))throw new Error("Unknown or unindexed requirement ID: "+id);
  const route=routeGovernance(config,registry,task||requiredIds.join(" "),paths,exists);
  const byDoc=new Map(index.documents.map(d=>[d.id,d]));
  const chosen=new Map();
  for(const item of [...route.binding,...route.advisory])chosen.set(item.id,{document:byDoc.get(item.id),reason:item.reason});
  // Add explicit requirement owner, even when lexical routing missed it.
  for(const id of requiredIds) {
    const req=index.requirements.get(id),doc=byDoc.get(req.charter);
    if(!chosen.has(doc.id))chosen.set(doc.id,{document:doc,reason:["explicit requirement "+id]});
  }
  if(hasMutationScope(task,paths) && byDoc.get("14")?.available && !chosen.has("14")) {
    chosen.set("14",{document:byDoc.get("14"),reason:["cross-cutting trust/authorization risk"]});
  }
  if(!chosen.has("00"))chosen.set("00",{document:byDoc.get("00"),reason:["constitutional baseline"]});
  // Conservative task-class policies catch cross-domain invariants missed by
  // pure lexical top-N section ranking. They do NOT reference evaluation gold
  // requirements, and the original charters retain their authority.
  if(policies.schemaVersion!==1 || !Array.isArray(policies.facets))throw new Error("Invalid governance coverage policies");
  const forcedSections=new Map(),matchedFacets=[],warningsBeforeSelection=[];
  const normalizedQuery=" "+normalize(task)+" ";
  for(const facet of policies.facets) {
    if(!Array.isArray(facet.any) || !facet.sections || typeof facet.id!=="string")throw new Error("Malformed coverage facet");
    const matched=facet.any.some(phrase=>normalizedQuery.includes(" "+normalize(phrase)+" "));
    if(!matched)continue;
    matchedFacets.push(facet.id);
    for(const [docId,fragments] of Object.entries(facet.sections)) {
      const doc=byDoc.get(docId);
      if(!doc?.available) {warningsBeforeSelection.push("Risk facet "+facet.id+" references unavailable charter "+docId);continue;}
      if(!chosen.has(docId))chosen.set(docId,{document:doc,reason:["coverage facet "+facet.id]});
      else chosen.get(docId).reason.push("coverage facet "+facet.id);
      if(!forcedSections.has(docId))forcedSections.set(docId,new Set());
      for(const fragment of fragments) {
        const matches=doc.sections.filter(s=>normalize(s.title).includes(normalize(fragment)));
        if(matches.length!==1)throw new Error("Coverage facet "+facet.id+" unresolved/ambiguous heading "+docId+":"+fragment);
        forcedSections.get(docId).add(matches[0].ordinal);
      }
    }
  }
  const selected=[], dependencies=[], warnings=[...route.warnings,...warningsBeforeSelection], missing=[...route.unavailable];
  for(const [id,entry] of [...chosen].sort((a,b)=>a[0].localeCompare(b[0]))) {
    const doc=entry.document;
    if(!doc?.available){missing.push({id,path:doc?.path,reason:["source unavailable"]});continue;}
    if(id==="00"||forceFull) {
      selected.push({id,path:doc.path,authority:doc.authority,reason:entry.reason,mode:"full",sections:doc.sections.map(x=>x.ordinal),range:[1,doc.fullText.split(/\r?\n/).length],sha256:doc.sha256,text:doc.fullText});
      continue;
    }
    const pinned=new Set([...(forcedSections.get(id)??[]),...requiredIds.filter(rid=>index.requirements.get(rid)?.charter===id).map(rid=>index.requirements.get(rid).section)]);
    // Source paths select the charter; only task language ranks its sections.
    // Path category names otherwise create spurious low-confidence matches.
    const scored=doc.sections.map(s=>({section:s,score:relevance(s,task)}))
      .sort((a,b)=>b.score-a.score||a.section.ordinal-b.section.ordinal);
    const positive=scored.filter(x=>x.score>0);
    // Fallback to full charter if no section can be responsibly selected.
    if(!positive.length && !pinned.size){
      selected.push({id,path:doc.path,authority:doc.authority,reason:[...entry.reason,"no reliable section match: full-document fallback"],mode:"full-fallback",sections:doc.sections.map(x=>x.ordinal),range:[1,doc.fullText.split(/\r?\n/).length],sha256:doc.sha256,text:doc.fullText});
      warnings.push("Charter "+id+" needed full-document fallback; task relevance was not established.");
      continue;
    }
    const ordinals=new Set(pinned);
    for(const x of positive) {
      if(ordinals.size>=Math.max(maxSections,pinned.size))break;
      ordinals.add(x.section.ordinal);
    }
    const subset=doc.sections.filter(x=>ordinals.has(x.ordinal));
    for(const s of subset)selected.push({id,path:doc.path,authority:doc.authority,reason:entry.reason,mode:"section",sections:[s.ordinal],title:s.title,range:[s.start_line,s.end_line],sha256:s.sha256,text:s.text,requirements:s.requirementIds});
  }
  // One-hop normative dependencies. Parse references only in selected normative
  // lines, not introduction prose, metadata lists, or arbitrary hyperlinks.
  const selectedReqIds=new Set();
  for(const x of selected)for(const req of index.requirements.values()) {
    if(req.charter===x.id&&(x.mode!=="section"||x.sections.includes(req.section)))selectedReqIds.add(req.id);
  }
  const referenced=new Set();
  for(const id of selectedReqIds) {
    const req=index.requirements.get(id);
    for(const match of req.text.matchAll(/\bAW-[A-Z]+-\d{3}\b/g)) {
      if(match[0]!==id&&!selectedReqIds.has(match[0]))referenced.add(match[0]);
    }
  }
  // No silent truncation: record overflow as unresolved instead of pretending
  // requirements were covered. 24 cross-references is a bounded guardrail.
  const MAX_DEPENDENCIES=24;
  for(const id of [...referenced].sort()) {
    const req=index.requirements.get(id);
    if(!req){warnings.push("Unresolved referenced requirement "+id);continue;}
    if(dependencies.length>=MAX_DEPENDENCIES){warnings.push("Dependency expansion limit reached: "+id+" not included");continue;}
    dependencies.push({id:req.id,path:req.path,authority:req.authority,line:req.line,reason:"referenced by selected normative requirement",text:req.text});
  }
  const chars=selected.reduce((s,x)=>s+x.text.length,0)+dependencies.reduce((s,x)=>s+x.text.length,0);
  const baselineChars=unique(selected.map(x=>x.path)).reduce((s,path)=>s+(index.documents.find(d=>d.path===path)?.sourceChars||0),0);
  const budgetExceeded=budgetTokens!==null&&estimate(chars)>budgetTokens;
  if(budgetExceeded)warnings.push("Estimated context exceeds soft budget; no authoritative requirement silently discarded.");
  return {
    schemaVersion:2,task,paths,source:"versioned repository Markdown",
    indexFingerprint:digest(index.documents.map(d=>d.id+":"+d.sha256+":"+d.authority).join("|")),coveragePolicyFingerprint:digest(JSON.stringify(policies)),matchedFacets,
    constitutionalBaseline:"complete",authorityPolicy:"binding constitution, advisory unratified charters",
    route,selected,dependencies,missing,warnings,
    metrics:{selectedCharacters:chars,estimatedTokens:estimate(chars),estimateMethod:"ceil(characters/4), NOT real tokenizer output",fullRoutedCharacters:baselineChars,characterReductionPercent:baselineChars?Math.round(10000*(1-chars/baselineChars))/100:0,budgetTokens,budgetExceeded},
    coverage:{requested:requiredIds,found:requiredIds.filter(id=>selectedReqIds.has(id)||dependencies.some(d=>d.id===id)),missingRequired:requiredIds.filter(id=>!selectedReqIds.has(id)&&!dependencies.some(d=>d.id===id))}
  };
}

export function formatContext(result) {
  let out=["# Governance Context Router V2","Task: "+(result.task||"(requirement/path request)"),"Authority: Constitution binding; other charters retain the registry's published status.","Estimated tokens (not actual): "+result.metrics.estimatedTokens,"Source fingerprint: "+result.indexFingerprint,""];
  for(const s of result.selected){
    out.push("## SOURCE: "+s.path+" | "+s.mode+" | "+s.authority+" | lines "+s.range.join("-")+" | sha256 "+s.sha256);
    out.push("Reason: "+s.reason.join("; "),"",s.text,"");
  }
  if(result.dependencies.length){
    out.push("## REFERENCED NORMATIVE DEPENDENCIES");
    for(const d of result.dependencies)out.push("### "+d.id+" | "+d.path+":"+d.line+" | "+d.authority,d.text,"");
  }
  if(result.missing.length)out.push("## UNAVAILABLE CHARTERS",...result.missing.map(x=>x.id+" "+x.path));
  if(result.warnings.length)out.push("## WARNINGS",...result.warnings);
  out.push("The excerpts are scoped context, not a replacement for the canonical governing files. Expand source sections when scope or ambiguity requires it.");
  return out.join("\n");
}

function parseCli(argv) {
  const args={task:"",paths:[],requiredIds:[],maxSections:2,budgetTokens:null,forceFull:false,json:false,index:false};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==="--task"||a==="--path"||a==="--requirement"||a==="--max-sections"||a==="--budget-tokens"){
      if(!argv[i+1]||argv[i+1].startsWith("--"))throw new Error(a+" requires a value");
      const v=argv[++i];
      if(a==="--task")args.task=v;
      else if(a==="--path")args.paths.push(v);
      else if(a==="--requirement")args.requiredIds.push(v);
      else if(a==="--max-sections"||a==="--budget-tokens"){
        if(!/^[1-9]\d*$/.test(v))throw new Error(a+" must be a positive integer");
        args[a==="--max-sections"?"maxSections":"budgetTokens"]=Number(v);
      }
    }else if(a==="--full")args.forceFull=true;
    else if(a==="--json")args.json=true;
    else if(a==="--index")args.index=true;
    else if(a==="--help"||a==="-h")args.help=true;
    else throw new Error("Unknown argument: "+a);
  }
  return args;
}
function run(argv) {
  const a=parseCli(argv);
  if(a.help){console.log("Usage: node scripts/governance-context.mjs --task \"DESCRIPTION\" [--path FILE ...] [--requirement AW-ID ...] [--max-sections N] [--budget-tokens N] [--full] [--json] [--index]\nDefault: full Constitution, selected complete charter sections, one-hop normative ID dependencies. --full loads entire routed documents. --index emits the live source index.");return;}
  const config=JSON.parse(read("config/governance-routes.json")),registry=parseRegistry(read("governance/README.md"));
  const index=buildGovernanceIndex(config,registry);
  if(a.index){
    const docs=index.documents.map(d=>({id:d.id,path:d.path,authority:d.authority,sha256:d.sha256,sections:d.sections.map(s=>({ordinal:s.ordinal,title:s.title,lines:[s.start_line,s.end_line],sha256:s.sha256,requirements:s.requirementIds}))}));
    console.log(JSON.stringify({schemaVersion:2,documents:docs,requirementCount:index.requirements.size},null,2));return;
  }
  const result=buildContext({config,registry,index,...a});
  console.log(a.json?JSON.stringify(result,null,2):formatContext(result));
  if(result.coverage.missingRequired.length)process.exitCode=3;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{run(process.argv.slice(2));}catch(e){console.error("Governance V2 error: "+e.message);process.exitCode=2;}
}
