import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseRegistry } from "../scripts/governance-router.mjs";
import { buildGovernanceIndex, buildContext, formatContext } from "../scripts/governance-context.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(resolve(root,"config/governance-routes.json"),"utf8"));
const registry=parseRegistry(readFileSync(resolve(root,"governance/README.md"),"utf8"));
const index=buildGovernanceIndex(config,registry);
const context=options=>buildContext({config,registry,index,...options});
const ids=result=>[...new Set(result.selected.map(s=>s.id))];
const cli=(args,cwd=root)=>spawnSync(process.execPath,[resolve(root,"scripts/governance-context.mjs"),...args],{cwd,encoding:"utf8",maxBuffer:10*1024*1024});

test("CLI and library return the same source package from repository and unrelated working directories",()=>{
 const args=["--task","Implement workspace resource identity","--path","src/workspaces/link.ts","--requirement","AW-PWR-005","--max-sections","2","--json"];
 const expected=context({task:args[1],paths:[args[3]],requiredIds:[args[5]],maxSections:2});
 for(const cwd of [root,dirname(root)]) {
  const result=cli(args,cwd);
  assert.equal(result.status,0,result.stderr);
  const parsed=JSON.parse(result.stdout);
  assert.deepEqual(parsed,expected);
  assert.equal(parsed.coverage.incompleteContext,false);
 }
});
test("CLI index and full retrieval are separate from the library index argument",()=>{
 const indexed=cli(["--index"],dirname(root));
 assert.equal(indexed.status,0,indexed.stderr);
 assert.equal(JSON.parse(indexed.stdout).documents.length,17);
 const full=cli(["--task","Codex approval handling","--full","--json"]);
 assert.equal(full.status,0,full.stderr);
 assert.ok(JSON.parse(full.stdout).selected.every(s=>s.mode==="full"));
 const narrow=cli(["--requirement","AW-CIE-008","--json"]);
 assert.equal(narrow.status,0,narrow.stderr);
 assert.deepEqual(JSON.parse(narrow.stdout).coverage.missingRequired,[]);
});
test("CLI rejects malformed optional arguments with actionable diagnostics",()=>{
 for(const [args,message] of [
  [["--task"],"--task requires a value"],
  [["--task","x","--max-sections","0"],"--max-sections must be a positive integer"],
  [["--task","x","--budget-tokens","9007199254740992"],"--budget-tokens must be a safe integer"],
  [["--requirement","AW-FAKE-999"],"Unknown or unindexed requirement ID"],
  [["--mystery"],"Unknown argument"],
 ]) {
  const result=cli(args);
  assert.equal(result.status,2,args.join(" "));
  assert.match(result.stderr,new RegExp(message));
  assert.doesNotMatch(result.stderr,/Cannot read properties of undefined/);
 }
});
test("library rejects malformed optional inputs and incomplete registries before routing",()=>{
 for(const [bad,message] of [
  [{task:null},"task must be a string"],
  [{paths:null},"paths must be an array"],
  [{paths:[null]},"paths must be an array"],
  [{requiredIds:null},"requiredIds must be an array"],
  [{maxSections:0},"maxSections must be"],
  [{budgetTokens:Infinity},"budgetTokens must be"],
  [{policies:{schemaVersion:2}},"Invalid governance coverage policy"],
 ])assert.throws(()=>context({task:"test",...bad}),new RegExp(message));
 assert.throws(()=>buildContext(),/options object/);
 assert.throws(()=>buildContext({config,registry,index:false,task:"test"}),/governance index/);
 assert.throws(()=>buildContext({config,registry:new Map(),index,task:"test"}),/Missing registry row/);
 assert.throws(()=>buildContext({config:{...config,signals:{...config.signals,"03":{terms:[]}}},registry,index,task:"test"}),/Invalid signals for 03/);
 assert.throws(()=>buildContext({config,registry,index:{...index,documents:[null]},task:"test"}),/malformed document/);
 assert.throws(()=>buildGovernanceIndex(config,new Map()),/Missing registry row/);
 assert.throws(()=>buildGovernanceIndex(config,null),/registry must be a Map/);
});
test("context source identities, hashes and authority are stable across repeated runs",()=>{
 const a=context({task:"Native Codex approval handling",paths:["src/codex/approvals.ts"]});
 const b=context({task:"Native Codex approval handling",paths:["src/codex/approvals.ts"]});
 assert.deepEqual(a,b);
 assert.ok(a.selected.every(s=>s.reason.length && s.sha256 && s.range));
 assert.ok(a.selected.filter(s=>s.id!=="00").every(s=>s.authority==="binding"));
 assert.equal(a.coverage.incompleteContext,false);
});

test("indexes all 17 published charters, stable normative IDs and verifiable ranges",()=>{
 assert.equal(index.documents.length,17);
 assert.equal(index.documents.filter(d=>d.available).length,17);
 assert.ok(index.requirements.size>1900,index.requirements.size);
 for(const doc of index.documents) {
  assert.match(doc.sha256,/^[a-f0-9]{64}$/);
  assert.ok(doc.sections.length>=3,doc.path);
  const source=readFileSync(resolve(root,doc.path),"utf8").split(/\r?\n/);
  for(const s of doc.sections) {
   assert.equal(source[s.start_line-1].startsWith("## "),true);
   assert.equal(s.text,source.slice(s.start_line-1,s.end_line).join("\n").trimEnd()+"\n");
   for(const rid of s.requirementIds) {
    const req=index.requirements.get(rid);
    assert.equal(req.path,doc.path);
    assert.ok(req.line>=s.start_line&&req.line<=s.end_line);
    assert.ok(source[req.line-1].includes(rid));
   }
  }
 }
});
test("every context includes full binding Constitution, with source hash and authority",()=>{
 const r=context({task:"Optimize GPU particle rendering",paths:["src/rendering/particles.ts"]});
 const constitution=r.selected.find(s=>s.id==="00");
 assert.equal(constitution.mode,"full");
 assert.equal(constitution.authority,"binding");
 assert.equal(constitution.text,index.documents.find(d=>d.id==="00").fullText);
 assert.ok(r.selected.filter(s=>s.id!=="00").every(s=>s.authority==="binding"));
 assert.equal(r.coverage.missingRequired.length,0);
 assert.match(formatContext(r),/Source fingerprint:/);
});
test("focused retrieval reduces exact source characters against complete routed sources",()=>{
 const r=context({task:"Optimize GPU particle rendering",paths:["src/rendering/particles.ts"],maxSections:2});
 for(const id of ["00","02","13","15"])assert.ok(ids(r).includes(id),id);
 assert.ok(!ids(r).includes("04"));
 assert.ok(r.metrics.fullRoutedCharacters>r.metrics.selectedCharacters,r.metrics);
 assert.ok(r.metrics.characterReductionPercent>=25,JSON.stringify(r.metrics));
 assert.equal(r.metrics.estimatedTokens,Math.ceil(r.metrics.selectedCharacters/4));
 assert.match(r.metrics.estimateMethod,/NOT real tokenizer/);
});
test("explicit requirement selectors never silently drop their requested requirement",()=>{
 for(const id of ["AW-CON-008","AW-LIQ-017","AW-ATW-001","AW-CIE-008","AW-TRUST-001"]){
  assert.ok(index.requirements.has(id),"missing fixture requirement "+id);
  const r=context({requiredIds:[id],maxSections:1});
  assert.deepEqual(r.coverage.missingRequired,[],id);
  assert.ok(r.coverage.found.includes(id));
  assert.ok(r.selected.some(s=>s.text.includes("**"+id+" —")),id);
 }
});
test("unknown requirement IDs fail closed",()=>{
 assert.throws(()=>context({requiredIds:["AW-FAKE-999"]}),/Unknown or unindexed/);
});
test("low-confidence section matches fall back to full charter instead of pretending completeness",()=>{
 const r=context({task:"blorp zymurgy",paths:["src/conversations/unmatched.ts"],maxSections:1});
 assert.ok(ids(r).includes("04"));
 assert.ok(r.selected.some(s=>s.id==="04"&&s.mode==="full-fallback"));
 assert.ok(r.selected.some(s=>s.id==="00"&&s.mode==="full"));
});
test("soft budgets warn, retain original rules, and never claim a hard token cap",()=>{
 const r=context({task:"Context compaction",requiredIds:["AW-CIE-008"],budgetTokens:100,maxSections:1});
 assert.equal(r.metrics.budgetExceeded,true);
 assert.ok(r.warnings.some(x=>x.includes("soft budget")));
 assert.ok(r.selected.some(s=>s.text.includes("**AW-CIE-008 —")));
});
test("explicit full option includes every routed charter in full",()=>{
 const r=context({task:"Optimize GPU particle rendering",paths:["src/rendering/particles.ts"],forceFull:true});
 assert.ok(r.selected.every(s=>s.mode==="full"));
 assert.equal(r.metrics.characterReductionPercent,0);
 assert.equal(r.metrics.selectedCharacters,r.metrics.fullRoutedCharacters);
});
test("full-size baseline accounts for all one-hop normative references",()=>{
 const options={task:"Optimize GPU particle rendering",paths:["src/rendering/particles.ts"]};
 const scoped=context({...options,maxSections:2});
 const full=context({...options,forceFull:true});
 assert.equal(scoped.metrics.fullRoutedCharacters,full.metrics.selectedCharacters);
 assert.equal(full.metrics.characterReductionPercent,0);
 assert.ok(full.dependencies.every(d=>d.text.length>0));
});
test("Fluid Intelligence engine work includes the source-owned charters, not only Constitution 00",()=>{
 for(const [task,required] of [
  ["Implement ARIE resource governor and adaptive worker scheduling",["05","10","13","15"]],
  ["Analyze AEP optimizer experiments and learning policy promotion",["08","10","13","15"]],
  ["Build AI-native Fluid Intelligence mission executive",["05","06","08","14","15"]],
  ["Create Adaptive Intelligence Workspace decision observatory",["03","09","14","15"]]
 ]){
  const r=context({task});
  for(const id of required) assert.ok(ids(r).includes(id),task+" should include charter "+id);
  assert.equal(r.coverage.missingRequired.length,0);
 }
});
test("sensitive actions include the ratified binding Trust charter",()=>{
 const r=context({task:"Overwrite server configuration",paths:["src/workspaces/file-browser.ts"]});
 assert.ok(ids(r).includes("14"));
 assert.ok(r.selected.filter(s=>s.id==="14").every(s=>s.authority==="binding"));
});
test("normative references can expand into one-hop traceable requirements",()=>{
 const copy={...index,requirements:new Map(index.requirements)};
 const base=copy.requirements.get("AW-LIQ-001");
 assert.ok(base);
 copy.requirements.set("AW-LIQ-001",{...base,text:base.text+" See AW-CIE-008 for integrity."});
 const r=buildContext({config,registry,index:copy,task:"Animate shaders",requiredIds:["AW-LIQ-001"],maxSections:1});
 assert.ok(r.dependencies.some(x=>x.id==="AW-CIE-008"));
 const d=r.dependencies.find(x=>x.id==="AW-CIE-008");
 assert.ok(d.line>0&&d.text.includes("AW-CIE-008"));
});
test("indexing never changes canonical files or status registry",()=>{
 const before=readFileSync(resolve(root,"governance/README.md"),"utf8");
 const second=buildGovernanceIndex(config,registry);
 assert.equal(second.requirements.size,index.requirements.size);
 assert.equal(readFileSync(resolve(root,"governance/README.md"),"utf8"),before);
});

test("unpinned section selection recognizes motion, branch, and CIE concepts",()=>{
 const cases=[
  {task:"Atmospheric Motion particles filaments fields and depth",path:"src/motion/particles.ts",id:"02",heading:"Atmospheric Motion: particles"},
  {task:"Connected Branches independent history connected knowledge",path:"src/conversations/sharing.ts",id:"04",heading:"Connected Branches: independent history"},
  {task:"Adaptive temporal decay and importance protection",path:"src/context/decay.ts",id:"08",heading:"Adaptive temporal decay"}
 ];
 for(const c of cases){
  const r=context({task:c.task,paths:[c.path],maxSections:2});
  const matched=r.selected.some(s=>s.id===c.id&&s.mode==="section"&&s.title.includes(c.heading));
  assert.ok(matched,c.task+" selected "+JSON.stringify(r.selected.filter(s=>s.id===c.id).map(s=>s.title)));
 }
});

test("GENERAL INVARIANT: every normative requirement of every routed charter is retained, regardless of query words",()=>{
 for(const task of [
  {task:"Stabilize many moving luminous components",paths:["src/motion/animation.ts"]},
  {task:"Restore chronology from diverged discussion histories",paths:["src/conversations/history.ts"]},
  {task:"Implement reliable cache and reduce repeated model input",paths:["src/context/assembler.ts"]},
  {task:"Guard delegated writes between autonomous workers",paths:["src/agents/worker.ts"]},
  {task:"Retain exact accounting for text generation usage",paths:["src/profiler/report.ts"]}
 ]) {
  const r=context(task);
  const covered=new Set([
   ...r.selected.flatMap(s=>s.mode==="section"?s.requirements??[]:index.documents.find(d=>d.id===s.id)?.sections.flatMap(t=>t.requirementIds)??[]),
   ...r.normative.map(x=>x.id),
   ...r.dependencies.map(x=>x.id)
  ]);
  for(const charter of new Set(r.selected.map(x=>x.id))) {
   const all=[...index.requirements.values()].filter(x=>x.charter===charter);
   for(const req of all)assert.ok(covered.has(req.id),task.task+" missing "+req.id);
  }
 }
});
test("wording-agnostic scope closure selects cross-cutting safety charters by domain",()=>{
 const variants=[
  {task:"A child worker must not gain extra access through delegation",paths:["src/agents/worker.ts"],needed:["05","14","15"]},
  {task:"Create a glowing background that remains light on the graphics processor",paths:["src/motion/particle-field.ts"],needed:["02","13","15"]},
  {task:"Let two forks exchange later findings",paths:["src/conversations/forks.ts"],needed:["04","08","14","15"]},
  {task:"Speed up old-message summarization",paths:["src/context/history.ts"],needed:["08","14","15"]}
 ];
 for(const c of variants){
  const r=context(c);
  const chosen=new Set(r.selected.map(x=>x.id));
  for(const id of c.needed)assert.ok(chosen.has(id),c.task+": "+id);
 }
});

test("unrecognized future requests cannot silently claim sufficient charter scope",()=>{
 const r=context({task:"Find out whether the thing from that discussion is still relevant"});
 assert.equal(r.scopeNeedsReview,true);
 assert.ok(r.warnings.some(x=>x.includes("No primary subsystem")));
 assert.equal(r.coverage.incompleteContext,true);
 const riskOnly=context({task:"Write something mysterious"});
 assert.equal(riskOnly.scopeNeedsReview,true);
 const trust=context({task:"Review security policy",paths:["src/security/check.ts"]});
 assert.equal(trust.scopeNeedsReview,false);
});
test("source-linked requirement envelope is preserved in text as well as JSON",()=>{
 const r=context({task:"Make shader animation smooth",paths:["src/motion/shader.ts"]});
 const text=formatContext(r);
 assert.ok(r.normative.length>0);
 const first=r.normative[0];
 assert.ok(text.includes(first.id));
 assert.ok(text.includes(first.path+":"+first.line));
 assert.ok(text.includes(first.text));
});

test("property check: every charter retains all owned requirements under unrecognized wording",()=>{
 for(const doc of index.documents.filter(d=>d.available&&d.id!=="00")){
  const r=context({task:"Amend a technical detail with unusual wording",paths:[doc.path],maxSections:1});
  const available=new Set([
   ...r.selected.flatMap(entry=>entry.mode==="section"?entry.requirements??[]:index.documents.find(d=>d.id===entry.id)?.sections.flatMap(x=>x.requirementIds)??[]),
   ...r.normative.map(x=>x.id),...r.dependencies.map(x=>x.id)
  ]);
  const all=[...index.requirements.values()].filter(x=>x.charter===doc.id);
  assert.ok(r.selected.some(x=>x.id===doc.id),"missing charter "+doc.id);
  for(const requirement of all)assert.ok(available.has(requirement.id),doc.id+" missing "+requirement.id);
  assert.ok(r.selected.filter(x=>x.id===doc.id).every(x=>x.authority===doc.authority));
 }
});
