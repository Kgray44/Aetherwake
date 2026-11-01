#!/usr/bin/env node
/**
 * Reproducible, source-character benchmark and task-routing fixtures.
 * Results are NOT actual API/model tokens, costs, latency, or agent-quality scores.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "./governance-router.mjs";
import { buildGovernanceIndex, buildContext } from "./governance-context.mjs";
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
 {task:"Implement agent orchestration",paths:["src/agents/dispatcher.ts"],expected:["00","05","15"],requiredIds:["AW-AGT-001"]},
 {task:"Implement AI token usage profiler",paths:["src/profiler/usage.ts"],expected:["00","10","15"],requiredIds:["AW-CON-009"]}
];
const data=[];
for(const f of fixtures){
 const r=buildContext({config,registry,index,...f,maxSections:2});
 const actual=new Set(r.selected.map(s=>s.id));
 const missing=f.expected.filter(id=>!actual.has(id));
 assert.deepEqual(missing,[],"Routing coverage for "+f.task);
 assert.deepEqual(r.coverage.missingRequired,[],"Explicit requirements for "+f.task);
 assert.ok(!r.metrics.budgetExceeded);
 data.push({task:f.task,expectedDomains:f.expected,selectedDomains:[...actual],requiredIds:f.requiredIds,fullRoutedCharacters:r.metrics.fullRoutedCharacters,selectedCharacters:r.metrics.selectedCharacters,estimatedTokenProxy:r.metrics.estimatedTokens,reductionPercent:r.metrics.characterReductionPercent,missingDomains:missing});
}
const summary={
 benchmark:"source-character context selection, not model token usage or task quality",
 fixtures:data.length,requirementsIndexed:index.requirements.size,
 meanReductionPercent:Number((data.reduce((sum,x)=>sum+x.reductionPercent,0)/data.length).toFixed(2)),
 totalFullCharacters:data.reduce((s,x)=>s+x.fullRoutedCharacters,0),
 totalSelectedCharacters:data.reduce((s,x)=>s+x.selectedCharacters,0),
 passed:true,results:data
};
assert.ok(summary.totalSelectedCharacters<summary.totalFullCharacters,"Scoped selection must reduce source characters overall");
console.log(JSON.stringify(summary,null,2));
