import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SEED = 20261101;
export function random(seed = SEED) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
const topics = [
  "Harbor migration",
  "Glass material study",
  "Orion workspace",
  "Motion coordinator",
  "Vela presence",
  "Context indexing",
  "Display handoff",
  "Telemetry review",
];
const bodies = [
  "The new layout keeps the source visible while the detail surface opens.",
  "I traced the interaction to its resource identity and recorded the result.",
  "Can we keep this conversation readable while activity arrives?",
  "The transition should settle without delaying the next input.",
  "This is a synthetic fixture for rendering and interaction testing.",
  "Please review the evidence before deciding on the desktop foundation.",
];
export function createFixture() {
  const next = random();
  const base = Date.UTC(2026, 10, 1, 8, 0, 0);
  const messages = Array.from({ length: 2000 }, (_, i) => ({
    id: `message-${String(i + 1).padStart(4, "0")}`,
    author: i % 5 === 0 ? "You" : "Vela · fixture",
    topic: topics[Math.floor(next() * topics.length)],
    time: new Date(base + i * 74000).toISOString(),
    text: bodies[Math.floor(next() * bodies.length)],
  }));
  const kinds = [
    "Observed fixture",
    "Agent report fixture",
    "Attention fixture",
    "System fixture",
  ];
  const events = Array.from({ length: 1000 }, (_, i) => ({
    id: `event-${String(i + 1).padStart(4, "0")}`,
    kind: kinds[Math.floor(next() * kinds.length)],
    time: new Date(base + i * 41000).toISOString(),
    text: `${topics[Math.floor(next() * topics.length)]} · synthetic event ${i + 1}`,
  }));
  return { seed: SEED, synthetic: true, messages, events };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const destination = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/fixture.json",
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(createFixture()));
  console.log(
    `Wrote deterministic fixture: 2000 messages, 1000 events, seed ${SEED}`,
  );
}
