import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "../scripts/governance-router.mjs";
import { buildGovernanceIndex, buildContext, formatContext } from "../scripts/governance-context.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(resolve(root,"config/governance-routes.json"),"utf8"));
const registry=parseRegistry(readFileSync(resolve(root,"governance/README.md"),"utf8"));
const index=buildGovernanceIndex(config,registry);
const context=options=>buildContext({config,registry,index,...options});
const ids=result=>[...new Set(result.selected.map(s=>s.id))];

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
 assert.ok(r.selected.filter(s=>s.id!=="00").every(s=>s.authority==="advisory"));
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
});
test("sensitive actions add the Trust charter without increasing its authority",()=>{
 const r=context({task:"Overwrite server configuration",paths:["src/workspaces/file-browser.ts"]});
 assert.ok(ids(r).includes("14"));
 assert.ok(r.selected.filter(s=>s.id==="14").every(s=>s.authority==="advisory"));
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
