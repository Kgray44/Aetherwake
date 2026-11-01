import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseRegistry,validateRouter,routeGovernance } from "../scripts/governance-router.mjs";

const root=resolve(import.meta.dirname??new URL("..",import.meta.url).pathname,"..");
const config=JSON.parse(readFileSync(resolve(root,"config/governance-routes.json"),"utf8"));
const registry=parseRegistry(readFileSync(resolve(root,"governance/README.md"),"utf8"));
const exists=p=>existsSync(resolve(root,p));
const ids=r=>[...r.binding,...r.advisory,...r.unavailable].map(x=>x.id);

test("registry validates with 17 known authority statuses",()=>{
 const check=validateRouter(config,registry,exists);
 assert.deepEqual(check.errors,[]);
 assert.equal(registry.size,17);
});
test("constitution is always binding, drafts are advisory, missing planned charter is not loaded",()=>{
 const r=routeGovernance(config,registry,"Implement contextual command selection",[],exists);
 assert.deepEqual(r.binding.map(x=>x.id),["00"]);
 assert.ok(r.advisory.some(x=>x.id==="03"));
 assert.ok(r.advisory.some(x=>x.id==="14"));
 assert.ok(r.advisory.some(x=>x.id==="15"));
 assert.ok(r.unavailable.some(x=>x.id==="01"));
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
