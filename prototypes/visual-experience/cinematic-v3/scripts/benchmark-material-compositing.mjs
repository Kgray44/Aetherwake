import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MaterialCompositor } from "../src/material-compositing.ts";
const quantile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ];
const report = {
  kind: "CPU-only derived silhouette compositor measurement",
  at: new Date().toISOString(),
  node: process.version,
  sourceHashes: Object.fromEntries(
    ["material-compositing.ts", "surface-contour.ts"].map((name) => [
      name,
      createHash("sha256")
        .update(readFileSync(new URL("../src/" + name, import.meta.url)))
        .digest("hex"),
    ]),
  ),
  cases: [],
  limits: [
    "Node CPU time excludes browser style/paint, GPU execution, native input and monitor presentation.",
    "Scratch capacity is observed reusable typed buffers, not a universal JavaScript allocation-free claim.",
    "Different overlap angles can grow the pool to a new high-water mark; this is not prolonged leak qualification.",
  ],
};
for (const count of [3, 10, 25, 50])
  for (const workload of [
    "unchanged",
    "moving-front",
    "resizing-front",
    "moving-all",
  ]) {
    const compositor = new MaterialCompositor();
    const poses = Array.from({ length: count }, (_, i) => ({
      id: "block-" + String(i).padStart(2, "0"),
      x: 100 + (i % 5) * 100,
      y: 180 + Math.floor(i / 5) * 55,
      w: 300,
      h: 210,
      lift: 0,
      yaw: 0,
      rotation: 0,
      opacity: 1,
      zIndex: i,
      shape: i % 4 === 0 ? "lens" : "rounded",
    }));
    const times = [];
    let pathCharacters = 0;
    const frame = (step) => {
      const target = poses.at(-1),
        phase = step / 20;
      if (workload === "moving-front") target.x = 350 + Math.sin(phase) * 300;
      if (workload === "resizing-front") {
        target.w = 300 + Math.sin(phase) * 150;
        target.h = 210 + Math.cos(phase) * 90;
      }
      if (workload === "moving-all")
        for (let i = 0; i < poses.length; i++) {
          poses[i].x = 100 + (i % 5) * 100 + Math.sin(phase + i) * 15;
          poses[i].rotation = Math.sin(phase * 0.3 + i) * 8;
        }
      return compositor.update(poses);
    };
    for (let i = 0; i < 45; i++) frame(i);
    const capacityBefore = compositor.diagnostics().scratchPolygons;
    for (let i = 45; i < 225; i++) {
      const start = performance.now(),
        rows = frame(i);
      times.push(performance.now() - start);
      pathCharacters += rows.reduce((sum, row) => sum + row.clipPath.length, 0);
    }
    report.cases.push({
      count,
      workload,
      samples: times.length,
      p50Ms: quantile(times, 0.5),
      p95Ms: quantile(times, 0.95),
      maxMs: Math.max(...times),
      meanPathCharacters: pathCharacters / times.length,
      scratchBefore: capacityBefore,
      scratchAfter: compositor.diagnostics().scratchPolygons,
      recomputations: compositor.recomputations,
    });
  }
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
