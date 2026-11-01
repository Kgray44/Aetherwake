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
 const context=buildContext({config,registry,index,task:f.task,paths:f.paths,maxSections:2});
 const covered=new Set(context.selected.flatMap(s=>
  s.mode==="section"?s.requirements:index.documents.find(d=>d.id===s.id)?.sections.flatMap(t=>t.requirementIds)??[]
 ).concat(context.dependencies.map(x=>x.id)));
 const essential=[...new Set(f.essential)],critical=[...new Set(f.critical)];
 const misses=essential.filter(id=>!covered.has(id));
 const missedCritical=critical.filter(id=>!covered.has(id));
 reports.push({
  scenario:f.id,category:f.category,task:f.task,selectedCharters:[...new Set(context.selected.map(x=>x.id))],
  retrievedSectionTitles:context.selected.filter(x=>x.mode==="section").map(x=>x.id+":"+x.title),
  essentialTotal:essential.length,essentialFound:essential.length-misses.length,
  essentialRecall:Math.round(10000*(essential.length-misses.length)/essential.length)/100,
  missedRequirements:misses,criticalMisses:missedCritical,
  originalCharacters:context.metrics.fullRoutedCharacters,
  assembledCharacters:context.metrics.selectedCharacters,
  reductionPercent:context.metrics.characterReductionPercent,
  fullFallbacks:context.selected.filter(x=>x.mode==="full-fallback").map(x=>x.id)
 });
}
const totalGold=reports.reduce((s,r)=>s+r.essentialTotal,0),found=reports.reduce((s,r)=>s+r.essentialFound,0);
const criticalMisses=reports.flatMap(r=>r.criticalMisses.map(id=>r.scenario+":"+id));
const report={
 kind:"offline human-curated engineering-context retrieval evaluation",
 indexRequirementCount:index.requirements.size,fixtureCount:reports.length,
 requirementRecallPercent:Math.round(10000*found/totalGold)/100,
 totalGoldRequirements:totalGold,foundGoldRequirements:found,
 criticalMisses,passedSafetyGate:found===totalGold&&criticalMisses.length===0,
 disclaimer:"Not a model execution evaluation. This verifies selected governance contains independently labeled rules; actual code quality/agent behavior needs separate full-context versus scoped-context A/B tasks.",
 cases:reports
};
console.log(JSON.stringify(report,null,2));
if(strict&&!report.passedSafetyGate)process.exitCode=1;
