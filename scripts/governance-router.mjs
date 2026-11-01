#!/usr/bin/env node
/**
 * Aetherwake deterministic governance router. Standard-library only.
 * Outputs pointers and authority status, never loads charter contents.
 * Governance status is parsed from governance/README.md, not duplicated here.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function normalize(value) { return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "); }
function parseRegistry(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const c = line.trim().split("|").slice(1, -1).map(x => x.trim());
    if (c.length < 3 || !/^\d{2}$/.test(c[0])) continue;
    if (rows.has(c[0])) throw new Error(`Duplicate governance registry ID ${c[0]}`);
    const raw = c[2].replace(/[*_`]/g, "");
    const s = normalize(raw);
    let status = "unknown";
    if (s.includes("pending") || s.includes("draft") || s.includes("published")) status = "advisory";
    else if (/\b(established|approved|ratified|accepted)\b/.test(s)) status = "binding";
    else if (s.includes("planned")) status = "planned";
    const link = c[1].match(/\]\(([^)]+)\)/);
    rows.set(c[0], {status, label:raw, link:link?.[1] ?? null});
  }
  return rows;
}
function validateRouter(config, registry, exists) {
  const errors=[], warnings=[], expected=Array.from({length:17},(_,i)=>String(i).padStart(2,"0"));
  if(config.schema_version!==1) errors.push("Unsupported routing schema version");
  if(JSON.stringify(config.always)!==JSON.stringify(["00"])) errors.push("The Constitution (00) must be the sole unconditional charter");
  for(const id of expected) {
    const file=config.charters?.[id], row=registry.get(id);
    if(!file || !/^governance\/[0-9]{2}-[A-Z0-9-]+\.md$/.test(file) || file.slice(11,13)!==id) errors.push(`Invalid mapping for charter ${id}`);
    if(!row) {errors.push(`Missing registry row for ${id}`);continue;}
    if(row.status==="unknown") errors.push(`Unknown governance authority status for ${id}: ${row.label}`);
    if(row.link && file && `governance/${row.link.replace(/^\.\//,"")}`!==file) errors.push(`Registry link conflicts with mapping for ${id}`);
    if(file && row.status!=="planned" && !exists(file)) errors.push(`Registered charter file is missing: ${file}`);
    if(file && row.status==="planned" && exists(file)) warnings.push(`Charter ${id} exists but registry still marks it Planned; not binding`);
  }
  for(const id of Object.keys(config.charters??{})) if(!expected.includes(id)) errors.push(`Unexpected charter ID ${id}`);
  for(const id of Object.keys(config.signals??{})) {
    if(!expected.includes(id) || id==="00") errors.push(`Unexpected signals ID ${id}`);
    const s=config.signals[id];
    if(!Array.isArray(s.terms) || !Array.isArray(s.path_prefixes)) errors.push(`Invalid signals for ${id}`);
  }
  return {errors,warnings};
}
function routeGovernance(config, registry, task, paths, exists) {
  if(!String(task??"").trim() && (!paths || !paths.length)) throw new Error("Provide a task description or one or more paths");
  const selected=new Map([["00",["constitutional baseline"]]]);
  const normalizedTask=` ${normalize(task)} `;
  const normalizedPaths=(paths??[]).map(p=>String(p).replace(/\\/g,"/").replace(/^\.\//,""));
  for(const [id, signals] of Object.entries(config.signals)) {
    const why=[];
    for(const term of signals.terms) {
      const word=normalize(term);
      if(word && normalizedTask.includes(` ${word} `)) why.push(`task mentions "${term}"`);
    }
    for(const prefix of signals.path_prefixes) {
      if(normalizedPaths.some(p=>p===prefix.replace(/\/$/,"") || p.startsWith(prefix))) why.push(`affected path under ${prefix}`);
    }
    if(why.length) selected.set(id,why.slice(0,4));
  }
  const binding=[], advisory=[], unavailable=[], warnings=[];
  for(const id of [...selected.keys()].sort()) {
    const file=config.charters[id], item=registry.get(id), present=exists(file);
    const entry={id,path:file,authority:item?.status??"unknown",reason:selected.get(id)};
    if(!item || item.status==="unknown") {unavailable.push({...entry,reason:[...entry.reason,"unrecognized registry authority"]}); warnings.push(`Charter ${id} needs manual authority review`);}
    else if(item.status==="planned") unavailable.push({...entry,reason:[...entry.reason,"planned and not approved"]});
    else if(!present) {unavailable.push({...entry,reason:[...entry.reason,"file not present"]}); warnings.push(`Referenced ${item.status} charter ${id} is missing`);}
    else if(item.status==="binding") binding.push(entry);
    else advisory.push({...entry,reason:[...entry.reason,"published but not owner-accepted"]});
  }
  return {task,paths:normalizedPaths,binding,advisory,unavailable,warnings};
}

export { normalize, parseRegistry, validateRouter, routeGovernance };

function formatReport(r) {
  const lines = ["TASK: " + (r.task || "(paths only)")];
  if (r.paths.length) lines.push("AFFECTED PATHS: " + r.paths.join(", "));
  for (const [title, items] of [["BINDING GOVERNANCE",r.binding],["ADVISORY DRAFTS — NOT YET RATIFIED",r.advisory],["PLANNED / UNAVAILABLE — DO NOT ASSUME AUTHORITY",r.unavailable]]) {
    lines.push("",title+":");
    if (!items.length) lines.push("  (none)");
    for (const x of items) lines.push("  "+x.id+"  "+x.path+"\n       "+x.reason.join("; "));
  }
  if (r.warnings.length) lines.push("","WARNINGS:",...r.warnings.map(x=>"  "+x));
  lines.push("","Load only binding documents and relevant advisory references; record any unavailable governance gaps.");
  return lines.join("\n");
}
function main(args) {
  const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
  const cfg=JSON.parse(readFileSync(resolve(root,"config/governance-routes.json"),"utf8"));
  const reg=parseRegistry(readFileSync(resolve(root,"governance/README.md"),"utf8"));
  const exists=p=>existsSync(resolve(root,p));
  const check=validateRouter(cfg,reg,exists);
  const validate=args.includes("--validate");
  if(args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/governance-router.mjs --task \"TASK DESCRIPTION\" [--path src/area/file.ts ...] [--json] [--validate]\n--validate checks registry, paths, and charter statuses.");
    return;
  }
  if(check.errors.length) {
    console.error("Governance registry validation failed:\n"+check.errors.map(e=>"  - "+e).join("\n"));
    process.exitCode=2;return;
  }
  if(validate) {
    console.log(JSON.stringify({valid:true,registry_entries:reg.size,warnings:check.warnings},null,2));return;
  }
  let task="",paths=[];
  for(let i=0;i<args.length;i++){
    if(args[i]==="--task") {if(!args[i+1]) throw new Error("--task requires text");task=args[++i];}
    else if(args[i]==="--path") {if(!args[i+1]) throw new Error("--path requires a path");paths.push(args[++i]);}
    else if(args[i]!=="--json") throw new Error("Unknown argument: "+args[i]);
  }
  const report=routeGovernance(cfg,reg,task,paths,exists);
  console.log(args.includes("--json")?JSON.stringify(report,null,2):formatReport(report));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {main(process.argv.slice(2));} catch(e){console.error("Governance router error: "+e.message);process.exitCode=2;}
}
