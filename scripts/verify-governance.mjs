#!/usr/bin/env node
/**
 * Aetherwake governance structural integrity check.
 * Zero dependencies; validates local links, charter namespaces and requirement ownership.
 * Semantic conflicts and charter acceptance still require human review.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, extname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRegistry } from "./governance-router.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const governanceDir = join(root, "governance");
const registry = parseRegistry(readFileSync(join(governanceDir, "README.md"), "utf8"));
const owners = {
  "00":"CON", "01":"EXP", "02":"LIQ", "03":"PWR", "04":"CHAT",
  "05":"ATW", "06":"VELA", "07":"NKT", "08":"CIE", "09":"OBS",
  "10":"AEP", "11":"TIME", "12":"CEX", "13":"PLT",
  "14":"TRUST", "15":"QVA", "16":"ENG"
};
const errors = [];
const files = [
  "README.md", "AGENTS.md", "governance/README.md",
  "docs/engineering/GOVERNANCE-ROUTER.md",
  ...readdirSync(governanceDir).filter(f=>/^\d{2}-.*\.md$/.test(f)).map(f=>"governance/"+f),
  ...readdirSync(join(root,"docs/vision")).filter(f=>extname(f)===".md").map(f=>"docs/vision/"+f)
];
const definitions = new Map();
let linksChecked = 0;
for(const rel of files) {
  const file = join(root,rel);
  const markdown = readFileSync(file,"utf8");
  for(const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const url = match[1].trim().split("#")[0].split("?")[0];
    if(!url || /^(?:https?:|mailto:|data:|javascript:)/i.test(url)) continue;
    const target=resolve(dirname(file),decodeURIComponent(url));
    if(target!==root&&!target.startsWith(root+sep)) {
      errors.push(rel+": local link escapes repository: "+url);continue;
    }
    linksChecked++;
    if(!existsSync(target)) errors.push(rel+": broken local link "+url);
  }
  const id=rel.match(/^governance\/(\d{2})-/)?.[1];
  if(!id) continue;
  const row=registry.get(id);
  if(!row) {errors.push(rel+": missing charter registry row");continue;}
  if(row.status==="planned") errors.push(rel+": file exists but registry still marks it planned");
  if(!/^\| Status \|/.test(markdown.split("\n").find(x=>x.startsWith("| Status |"))??""))
    errors.push(rel+": no charter status metadata row");
  if(row.status==="advisory"&&!/\b(?:pending|awaiting|subject to).*\b(?:owner|acceptance)|\bowner.acceptance\b/i.test(markdown.slice(0,1800)))
    errors.push(rel+": charter is advisory but opening status lacks owner-acceptance caveat");
  let own=0;
  for(const [lineNo,line] of markdown.split("\n").entries()) {
    const match=line.match(/^\s*\*\*(AW-([A-Z]+)-\d{3})\s+—\s+/);
    if(!match) continue;
    const rid=match[1];
    if(match[2]!==owners[id]) errors.push(rel+":"+String(lineNo+1)+": unexpected requirement namespace "+rid);
    if(definitions.has(rid)) errors.push(rel+":"+String(lineNo+1)+": duplicate requirement "+rid+" (already in "+definitions.get(rid)+")");
    else definitions.set(rid,rel+":"+String(lineNo+1));
    own++;
  }
  if(own===0) errors.push(rel+": no normative requirements found");
}
for(const [id,row] of registry) {
  const file=readdirSync(governanceDir).find(f=>f.startsWith(id+"-")&&f.endsWith(".md"));
  if(row.status!=="planned"&&!file) errors.push("Registered charter "+id+" is missing");
}
if(errors.length) {console.error(errors.join("\n"));process.exitCode=1;}
else console.log(JSON.stringify({valid:true,documents:files.length,localLinks:linksChecked,normativeRequirements:definitions.size,registryEntries:registry.size},null,2));
