import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry,validateRouter,routeGovernance } from "../scripts/governance-router.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const config=JSON.parse(readFileSync(resolve(root,"config/governance-routes.json"),"utf8"));
const registry=parseRegistry(readFileSync(resolve(root,"governance/README.md"),"utf8"));
const exists=p=>existsSync(resolve(root,p));
const ids=r=>[...r.binding,...r.advisory,...r.unavailable].map(x=>x.id);

test("registry validates with 17 known authority statuses",()=>{
 const check=validateRouter(config,registry,exists);
 assert.deepEqual(check.errors,[]);
 assert.equal(registry.size,17);
});
test("constitution is binding and published charters remain advisory until owner acceptance",()=>{
 const r=routeGovernance(config,registry,"Implement contextual command selection",[],exists);
 assert.deepEqual(r.binding.map(x=>x.id),["00"]);
 assert.ok(r.advisory.some(x=>x.id==="03"));
 assert.ok(r.advisory.some(x=>x.id==="14"));
 assert.ok(r.advisory.some(x=>x.id==="15"));
 assert.ok(r.advisory.some(x=>x.id==="01"));
 assert.ok(!r.unavailable.some(x=>x.id==="01"));
 assert.ok(!ids(r).includes("04"));
});
test("motion work selects motion, platform and verification without chat charter",()=>{
 const r=routeGovernance(config,registry,"Optimize particle rendering",["src/rendering/particles.ts"],exists);
 for(const id of ["00","02","13","15"]) assert.ok(ids(r).includes(id),id);
 assert.ok(!ids(r).includes("04"));
});
test("compaction work routes context intelligence without unrelated motion",()=>{
 const r=routeGovernance(config,registry,"Refactor context compaction",[],exists);
 for(const id of ["00","08","15"]) assert.ok(ids(r).includes(id),id);
 assert.ok(!ids(r).includes("02"));
});
test("plain question does not indiscriminately load charters",()=>{
 const r=routeGovernance(config,registry,"Summarize project history",[],exists);
 assert.deepEqual(ids(r),["00"]);
});
test("path-only routing works",()=>{
 const r=routeGovernance(config,registry,"",["src/notes/quick-capture.ts"],exists);
 assert.ok(ids(r).includes("07"));
 assert.ok(ids(r).includes("15"));
});
test("unratified charter cannot be promoted by file existence",()=>{
 const fake=new Map(registry);
 fake.set("03",{status:"advisory",label:"Published — pending owner acceptance"});
 const r=routeGovernance(config,fake,"workspace",[],()=>true);
 assert.ok(r.advisory.some(x=>x.id==="03"));
 assert.ok(!r.binding.some(x=>x.id==="03"));
});
test("duplicate or unknown authority fails validation",()=>{
 assert.throws(()=>parseRegistry("| 00 | A | Established |\n| 00 | B | Planned |"),/Duplicate/);
 const fake=new Map(registry); fake.set("03",{status:"unknown",label:"???"});
 assert.ok(validateRouter(config,fake,exists).errors.length>0);
});
test("missing published charter causes setup validation error",()=>{
 const check=validateRouter(config,registry,p=>p!=="governance/03-PROJECTS-WORKSPACES-AND-RESOURCES.md"&&exists(p));
 assert.ok(check.errors.some(e=>e.includes("03-PROJECTS")));
});

// Regression guards: publication does not imply ratification, and governance-file edits
// must never fall through to "constitution only" because the task text is generic.
test("published charters stay advisory until explicitly accepted",()=>{
 for(const id of ["01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16"]){
  const r=routeGovernance(config,registry,"", [config.charters[id]],exists);
  assert.ok(r.advisory.some(x=>x.id===id),id);
  assert.ok(!r.binding.some(x=>x.id===id),id);
 }
});
test("direct edits to charter paths route the edited charter even without matching keywords",()=>{
 const r=routeGovernance(config,registry,"Correct a typo",["governance/02-LIQUID-INTELLIGENCE-AND-MOTION.md"],exists);
 assert.ok(ids(r).includes("02"));
 assert.deepEqual(r.binding.map(x=>x.id),["00"]);
});
test("newly published agent charter 05 routes advisory, never silently ratified",()=>{
 const r=routeGovernance(config,registry,"Agent orchestration workflow",["src/agents/dispatcher.ts"],exists);
 assert.ok(r.advisory.some(x=>x.id==="05"));
 assert.ok(!r.binding.some(x=>x.id==="05"));
});
test("direct charter 05 edits route to its published advisory source",()=>{
 const r=routeGovernance(config,registry,"",["governance/05-AGENTS-TASKS-AND-WORKFLOWS.md"],exists);
 assert.ok(r.advisory.some(x=>x.id==="05"));
});
test("incomplete routing coverage and malformed signals fail validation",()=>{
 const partial={...config,signals:{...config.signals}};
 delete partial.signals["14"];
 assert.ok(validateRouter(partial,registry,exists).errors.some(x=>x.includes("Missing routing signals for 14")));
 const malformed={...config,signals:{...config.signals,"01":{terms:[""],path_prefixes:["src/ui"]}}};
 assert.ok(validateRouter(malformed,registry,exists).errors.some(x=>x.includes("Malformed routing terms")));
});
test("a published charter without a registry link fails validation",()=>{
 const r=new Map(registry);r.set("01",{status:"advisory",label:"Published, pending owner acceptance",link:null});
 assert.ok(validateRouter(config,r,exists).errors.some(x=>x.includes("lacks a registry link")));
});

test("plural everyday task descriptions route to the intended domains",()=>{
 for(const [task,id] of [["Organize chats into folders","04"],["Arrange workspaces and blocks","03"],["Delegate several agents to tasks","05"],["Collect notes","07"],["Display token counts","10"]]){
  assert.ok(ids(routeGovernance(config,registry,task,[],exists)).includes(id),task);
 }
});

test("cross-mode Chat and Codex engineering loads conversation, provider and billing governance",()=>{
 const task="Implement a cross mode branch from Chat to Codex and back with api billing guard";
 const r=routeGovernance(config,registry,task,["src/conversations/mode-switch.ts","src/backends/chat-adapter.ts"],exists);
 for(const id of ["00","04","10","12"]) assert.ok(ids(r).includes(id),id);
 assert.ok(!ids(r).includes("02"),"motion charter must not be loaded for backend routing");
});
test("mode branch handoff does not imply entitlement or authority upgrades",()=>{
 const r=routeGovernance(config,registry,"Branch into Codex from chat mode using a chatgpt account and plan allowance",[],exists);
 for(const id of ["00","04","10","12"]) assert.ok(ids(r).includes(id),id);
 assert.ok(r.advisory.some(x=>x.id==="04"),"conversation governance remains advisory until accepted");
});
