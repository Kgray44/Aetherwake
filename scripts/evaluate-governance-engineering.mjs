#!/usr/bin/env node
/**
 * Governance retrieval engineering sufficiency evaluation.
 * Independently curated requirement gold IDs are used only by the EVALUATOR.
 * No fixture's requirements are passed to buildContext() as hints.
 * This measures anchored rule recall, NOT execution quality from an AI model.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { parseRegistry } from "./governance-router.mjs";
import { buildGovernanceIndex, buildContext } from "./governance-context.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const load=p=>JSON.parse(readFileSync(resolve(root,p),"utf8"));
const config=load("config/governance-routes.json");
const registry=parseRegistry(readFileSync(resolve(root,"governance/README.md"),"utf8"));
const fixtures=load("tests/fixtures/engineering-context-cases.json");
const index=buildGovernanceIndex(config,registry);
const args=process.argv.slice(2);
const strict=args.includes("--strict");
if(args.some(a=>!["--strict","--json"].includes(a))){console.error("Usage: node scripts/evaluate-governance-engineering.mjs [--strict] [--json]");process.exit(2);}
const reports=[];
for(const f of fixtures.cases){
 for(const id of [...f.essential,...f.critical])if(!index.requirements.has(id))throw Error(f.id+" has invalid gold requirement "+id);
 // DO NOT pass gold IDs or expected domains into retrieval.
 const started=process.hrtime.bigint();
 const context=buildContext({config,registry,index,task:f.task,paths:f.paths,maxSections:2});
 const compactLatencyMs=Number(process.hrtime.bigint()-started)/1e6;
 const full=buildContext({config,registry,index,task:f.task,paths:f.paths,forceFull:true});
 const again=buildContext({config,registry,index,task:f.task,paths:f.paths,maxSections:2});
 const deterministic=JSON.stringify(context)===JSON.stringify(again);
 assert.ok(deterministic,f.id+" changed between repeated retrievals");
 const covered=new Set(context.selected.flatMap(s=>
  s.mode==="section"?s.requirements:index.documents.find(d=>d.id===s.id)?.sections.flatMap(t=>t.requirementIds)??[]
 ).concat(context.normative.map(x=>x.id),context.dependencies.map(x=>x.id)));
 const essential=[...new Set(f.essential)],critical=[...new Set(f.critical)];
 const misses=essential.filter(id=>!covered.has(id));
 const missedCritical=critical.filter(id=>!covered.has(id));
 const selectedCharters=[...new Set(context.selected.map(x=>x.id))];
 const expectedDomains=f.expectedDomains??[];
 const missingDomains=expectedDomains.filter(id=>!selectedCharters.includes(id));
 const criticalOnlyInNormative=critical.filter(id=>context.normative.some(x=>x.id===id));
 const duplicateRanges=context.selected.filter((s,i)=>context.selected.findIndex(t=>t.path===s.path&&t.range[0]===s.range[0]&&t.range[1]===s.range[1])!==i);
 reports.push({
  scenario:f.id,category:f.category,task:f.task,sourceReview:f.sourceReview??null,selectedCharters,expectedDomains,missingDomains,
  retrievedSectionTitles:context.selected.filter(x=>x.mode==="section").map(x=>x.id+":"+x.title),
  essentialTotal:essential.length,essentialFound:essential.length-misses.length,
  essentialRecall:Math.round(10000*(essential.length-misses.length)/essential.length)/100,
  missedRequirements:misses,criticalMisses:missedCritical,
  originalCharacters:context.metrics.fullRoutedCharacters,
  assembledCharacters:context.metrics.selectedCharacters,
  fullContextCharacters:full.metrics.selectedCharacters,
  compactLatencyMs:Number(compactLatencyMs.toFixed(3)),
  deterministic,duplicateSourceRanges:duplicateRanges.length,
  criticalOnlyInNormative,explanatorySectionsPartial:context.coverage.explanatorySectionsPartial,
  incompleteContext:context.coverage.incompleteContext,
  reductionPercent:context.metrics.characterReductionPercent,
  fullFallbacks:context.selected.filter(x=>x.mode==="full-fallback").map(x=>x.id)
 });
}
const totalGold=reports.reduce((s,r)=>s+r.essentialTotal,0),found=reports.reduce((s,r)=>s+r.essentialFound,0);
const criticalMisses=reports.flatMap(r=>r.criticalMisses.map(id=>r.scenario+":"+id));
const domainMisses=reports.flatMap(r=>r.missingDomains.map(id=>r.scenario+":"+id));
const report={
 kind:"offline human-curated engineering-context retrieval evaluation",
 indexRequirementCount:index.requirements.size,fixtureCount:reports.length,
 estimator:"ceil(assembled source characters / 4); rough proxy only, not a model tokenizer or billing value",
 totalFullCharacters:reports.reduce((s,r)=>s+r.fullContextCharacters,0),
 totalCompactCharacters:reports.reduce((s,r)=>s+r.assembledCharacters,0),
 estimatedFullTokenProxy:Math.ceil(reports.reduce((s,r)=>s+r.fullContextCharacters,0)/4),
 estimatedCompactTokenProxy:Math.ceil(reports.reduce((s,r)=>s+r.assembledCharacters,0)/4),
 requirementRecallPercent:Math.round(10000*found/totalGold)/100,
 totalGoldRequirements:totalGold,foundGoldRequirements:found,
 criticalMisses,domainMisses,passedSafetyGate:found===totalGold&&criticalMisses.length===0&&domainMisses.length===0&&reports.every(r=>!r.incompleteContext&&r.duplicateSourceRanges===0),
 coverageGateMeaning:"passedSafetyGate means labeled domain and requirement coverage only; it is not an engineering decision or model-execution pass",
 disclaimer:"This checks independently reviewed rule IDs and expected domains against compact and full source packages. It does not test whether an engineer makes correct decisions; normative lines may lack explanatory context, so inspect criticalOnlyInNormative and expand sections when needed.",
 cases:reports
};
console.log(JSON.stringify(report,null,2));
if(strict&&!report.passedSafetyGate)process.exitCode=1;
