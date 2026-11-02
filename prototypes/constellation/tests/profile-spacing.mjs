// CPU-only diagnostic. This does not measure native presentation or GPU timing.
import { performance } from "node:perf_hooks";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { ConstellationController } from "../controller.ts";
import { SpatialNavigator } from "../spatial.ts";
import { ConstellationScene } from "../renderer3d.ts";
const percentile = (a, p) =>
  a.toSorted((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
for (const [projectCount, count] of [
  [1, 50],
  [3, 250],
  [10, 2000],
  [10, 10000],
  [1, 10000],
]) {
  const snapshot = {
    projects: Array.from({ length: projectCount }, (_, i) => ({
      id: `p${i}`,
      title: `Synthetic ${i}`,
    })),
    workspaces: Array.from({ length: projectCount * 2 }, (_, i) => ({
      id: `w${i}`,
      project_id: `p${i % projectCount}`,
      title: `Workspace ${i}`,
    })),
    resources: Array.from({ length: count }, (_, i) => ({
      id: `r${i}`,
      kind: "note",
      title: `Resource ${i}`,
    })),
    blocks: Array.from({ length: count }, (_, i) => ({
      id: `b${i}`,
      resource_id: `r${i}`,
      workspace_id: `w${i % (projectCount * 2)}`,
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      z: i,
    })),
    relationships: [],
    activeWorkspaceId: null,
    navigation: { kind: "constellation", projectId: "p0" },
  };
  const started = performance.now(),
    motion = new MotionCoordinator(),
    c = new ConstellationController({
      snapshot,
      motion,
      navigate: async () => {},
    }),
    projectMs = performance.now() - started,
    layoutStarted = performance.now(),
    n = new SpatialNavigator(c, () => {}),
    layoutMs = performance.now() - layoutStarted;
  c.spatial = n;
  c.setPolicy({ reduced: true });
  const layer = new ConstellationScene(c, n, () => ({})),
    first = performance.now();
  layer.update(1920, 1080);
  const firstSceneMs = performance.now() - first,
    frames = [],
    pose = n.camera;
  for (let i = 0; i < 40; i++) {
    n.target({ ...pose, yaw: pose.yaw + i * 0.015 });
    const start = performance.now();
    layer.update(1920, 1080);
    frames.push(performance.now() - start);
  }
  const refresh = performance.now();
  c.update(snapshot);
  const refreshMs = performance.now() - refresh;
  console.log(
    JSON.stringify({
      meaning: "CPU source diagnostic only",
      projectCount,
      count,
      projectMs,
      layoutMs,
      firstSceneMs,
      refreshMs,
      updateMs: {
        p50: percentile(frames, 0.5),
        p95: percentile(frames, 0.95),
        p99: percentile(frames, 0.99),
      },
      renderedBodies: layer.objects.size,
      overlapCulled: layer.diagnostics.overlapCulled,
    }),
  );
  layer.dispose();
  c.dispose();
}
