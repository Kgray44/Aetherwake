#!/usr/bin/env node
/**
 * Reproducible, source-character benchmark and task-routing fixtures.
 * The optional comparison measures local assembly only. Provider usage, cost,
 * and agent quality require separate evidence.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "./governance-router.mjs";
import { buildGovernanceIndex, buildContext, formatContext, formatCompactContext } from "./governance-context.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(resolve(root,"config/governance-routes.json"),"utf8"));
const registry=parseRegistry(readFileSync(resolve(root,"governance/README.md"),"utf8"));
const index=buildGovernanceIndex(config,registry);
const fixtures=[
 {task:"Optimize GPU particle rendering",paths:["src/rendering/particles.ts"],expected:["00","02","13","15"],requiredIds:["AW-LIQ-017"]},
 {task:"Implement contextual command selection",paths:["src/interaction/selection.ts"],expected:["00","01","03","14","15"],requiredIds:["AW-CON-014"]},
 {task:"Implement chat connected branch sharing",paths:["src/conversations/branches.ts"],expected:["00","04","15"],requiredIds:["AW-CIE-008"]},
 {task:"Implement CIE context compaction",paths:["src/context/compaction.ts"],expected:["00","08","15"],requiredIds:["AW-CIE-008"]},
 {task:"Implement quick capture notes",paths:["src/notes/quick.ts"],expected:["00","07","15"],requiredIds:["AW-CON-010"]},
 {task:"Implement agent orchestration",paths:["src/agents/dispatcher.ts"],expected:["00","05","15"],requiredIds:["AW-ATW-001"]},
 {task:"Implement AI token usage profiler",paths:["src/profiler/usage.ts"],expected:["00","10","15"],requiredIds:["AW-CON-009"]}
];
const data=[];
for(const f of fixtures){
 const r=buildContext({config,registry,index,...f,maxSections:2});
 const markdownBytes=Buffer.byteLength(formatContext(r));
 const compactMarkdownBytes=Buffer.byteLength(formatCompactContext(r));
 const actual=new Set(r.selected.map(s=>s.id));
 const missing=f.expected.filter(id=>!actual.has(id));
 assert.deepEqual(missing,[],"Routing coverage for "+f.task);
 assert.deepEqual(r.coverage.missingRequired,[],"Explicit requirements for "+f.task);
 assert.ok(!r.metrics.budgetExceeded);
 data.push({task:f.task,expectedDomains:f.expected,selectedDomains:[...actual],selectedSections:r.selected.filter(x=>x.mode==="section").map(x=>({charter:x.id,title:x.title,lines:x.range})),fullFallbacks:r.selected.filter(x=>x.mode==="full-fallback").map(x=>x.id),requiredIds:f.requiredIds,fullRoutedCharacters:r.metrics.fullRoutedCharacters,selectedCharacters:r.metrics.selectedCharacters,estimatedTokenProxy:r.metrics.estimatedTokens,reductionPercent:r.metrics.characterReductionPercent,missingDomains:missing,markdownBytes,compactMarkdownBytes});
}
const summary={
 benchmark:"source-character context selection, not model token usage or task quality",
 fixtures:data.length,requirementsIndexed:index.requirements.size,
 meanReductionPercent:Number((data.reduce((sum,x)=>sum+x.reductionPercent,0)/data.length).toFixed(2)),
 totalFullCharacters:data.reduce((s,x)=>s+x.fullRoutedCharacters,0),
 totalSelectedCharacters:data.reduce((s,x)=>s+x.selectedCharacters,0),
 markdownBytes:data.reduce((sum,x)=>sum+x.markdownBytes,0),
 compactMarkdownBytes:data.reduce((sum,x)=>sum+x.compactMarkdownBytes,0),
 passed:true,results:data
};
assert.ok(summary.totalSelectedCharacters<summary.totalFullCharacters,"Scoped selection must reduce source characters overall");
assert.ok(summary.compactMarkdownBytes<summary.markdownBytes,"Compact display must reduce serialized Markdown bytes overall");

if(process.argv.includes("--compare-assembly")) {
 const batches=40,warmup=8;
 const samples={standard:[],optimized:[]};
 const payload=createHash("sha256");
 for(const f of fixtures) {
  const options={config,registry,index,...f,maxSections:2};
  const baseline=JSON.stringify(buildContext(options));
  assert.equal(JSON.stringify(buildContext({...options,fastAssembly:true})),baseline,f.task);
  payload.update(baseline+"\n");
 }
 for(let batch=0;batch<batches+warmup;batch++) {
  for(const variant of batch%2 ? ["optimized","standard"] : ["standard","optimized"]) {
   const start=performance.now();
   for(const f of fixtures) buildContext({config,registry,index,...f,maxSections:2,fastAssembly:variant==="optimized"});
   if(batch>=warmup) samples[variant].push(performance.now()-start);
  }
 }
 const distribution=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {p50:sorted[Math.ceil(0.50*sorted.length)-1],p95:sorted[Math.ceil(0.95*sorted.length)-1]};
 };
 summary.assemblyComparison={scope:"local assembly for a seven-fixture batch on the same live index",
  node:process.version,platform:process.platform,batches,warmup,payloadSha256:payload.digest("hex"),
  standardMs:distribution(samples.standard),optimizedMs:distribution(samples.optimized)};
}
console.log(JSON.stringify(summary,null,2));
