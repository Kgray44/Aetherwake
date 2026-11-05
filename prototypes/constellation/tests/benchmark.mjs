import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { ConstellationController } from "../controller.ts";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
const s = {
  projects: [],
  workspaces: [],
  resources: [],
  blocks: [],
  relationships: [],
  activeWorkspaceId: null,
};
for (let p = 0; p < 50; p++) {
  s.projects.push({ id: `p${p}`, title: `Project ${p}` });
  for (let w = 0; w < 10; w++) {
    s.workspaces.push({
      id: `w${p}-${w}`,
      project_id: `p${p}`,
      title: `Workspace ${w}`,
    });
    for (let r = 0; r < 20; r++) {
      const id = `r${p}-${w}-${r}`;
      s.resources.push({ id, title: id, kind: "note" });
      s.blocks.push({
        id: `b${id}`,
        workspace_id: `w${p}-${w}`,
        resource_id: id,
        x: r * 20,
        y: 0,
        width: 100,
        height: 100,
        z: r,
      });
    }
  }
}
for (let i = 0; i < 30000; i++)
  s.relationships.push({
    id: `e${i}`,
    source_id: s.resources[i % 10000].id,
    target_id: s.resources[(i + 1) % 10000].id,
    kind: "references",
    provenance: "user",
  });
const percentile = (a, p) =>
  a.toSorted((a, b) => a - b)[Math.min(a.length - 1, Math.floor(a.length * p))];
const projectMs = [],
  frameMs = [],
  searchMs = [];
let maxProxies = 0;
for (let i = 0; i < 30; i++) {
  const motion = new MotionCoordinator();
  let at = performance.now();
  const c = new ConstellationController({
    snapshot: s,
    motion,
    navigate: async () => {},
  });
  projectMs.push(performance.now() - at);
  at = performance.now();
  c.search("r49");
  searchMs.push(performance.now() - at);
  at = performance.now();
  for (let j = 0; j < 120; j++) {
    c.pan(1, 0);
    motion.step(1 / 60);
    maxProxies = Math.max(maxProxies, c.visible(1920, 1080).length);
  }
  frameMs.push((performance.now() - at) / 120);
  c.dispose();
}
const stats = (a) => ({
  medianMs: percentile(a, 0.5),
  p95Ms: percentile(a, 0.95),
  p99Ms: percentile(a, 0.99),
});
const result = {
  schema: 1,
  scenario:
    "Synthetic 50 projects, 500 workspaces, 10000 resources, 30000 relationships",
  iterations: 30,
  runtime: process.version,
  projection: stats(projectMs),
  search: stats(searchMs),
  cameraAndCullingPerStep: stats(frameMs),
  maxProxies,
  method:
    "Node perf_hooks; CPU projection/search/camera+culling only. These are not presented frame times, GPU timings, power measurements or a host comparison.",
};
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../evidence/cpu-benchmark.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
