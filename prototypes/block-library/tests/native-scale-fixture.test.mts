import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { BackendCore } from "../../integrated-backend/src/core.mts";
import { footprint, intersects } from '../../workspace-engine/collisions.mts';
import {
  prepareNativeScale,
  scaleState,
  SCALE_COUNTS,
} from "../prepare-native-scale.mts";
import type { BlockInstanceSettings } from "../contracts.ts";
const require = createRequire(import.meta.url);
const {
  options,
  sameState,
} = require("../../visual-experience/cinematic-v3/native/integration-block-scale.cjs");

test("native scale entry requires one supported count, a bounded sample and an explicit deadline", () => {
  for (const count of SCALE_COUNTS)
    assert.deepEqual(
      options([`--block-count=${count}`, "--verification-deadline-ms=30000"]),
      { count, sampleMs: 750, restore: false },
    );
  for (const count of ["", "00", "-1", "2", "51", "100000", "1.5", "NaN"])
    assert.throws(() =>
      options([`--block-count=${count}`, "--verification-deadline-ms=30000"]),
    );
  assert.throws(() => options(["--block-count=50"]));
  assert.throws(() =>
    options([
      "--block-count=50",
      "--sample-ms=10001",
      "--verification-deadline-ms=30000",
    ]),
  );
  assert.throws(() =>
    options(["--block-count=50", "--verification-deadline-ms=30001"]),
  );
});

test("offline native-scale profiles use actual canonical identities and restore all six required mixed-resource counts", async (t) => {
  for (const count of SCALE_COUNTS) {
    await t.test(String(count), async () => {
      const profile = join(
        tmpdir(),
        "aerynth-native-block-scale-test-" + randomUUID(),
      );
      const seed = await prepareNativeScale(profile, count);
      const core = new BackendCore({
        path: join(profile, "aerynth.sqlite"),
        privateRoot: profile,
        cwd: process.cwd(),
        provider: "codex",
        contentPolicy: "local-private",
        retention: { maxEvents: 10000 },
      });
      try {
        const actual = await core.command("desktop", { type: "snapshot" });
        assert.equal(actual.blocks.length, count);
        assert.ok(actual.presence && actual.organization);
        for (const block of actual.blocks) {
          const box = footprint({ ...block, locked: block.locked ?? false });
          assert.equal(intersects(box, actual.presence, actual.organization.gap), false, 'Restored scale cards must clear Vela');
        }
        assert.equal(actual.resources.length, count);
        assert.deepEqual(scaleState(actual), seed.expected);
        sameState(seed.expected, actual);
        if (count) {
          const primary = actual.blocks.find(
            (block) => block.id === seed.primaryBlockId,
          )!;
          assert.ok(primary);
          const note = actual.resources.find(
            (resource) => resource.id === primary.resource_id,
          )!;
          assert.equal(note.kind, "note");
          assert.ok(note.content.startsWith("# Synthetic note\n"));
          assert.ok(note.content.length > 7000);
          assert.equal(
            (
              (
                await core.command("library", {
                  name: "getBlockSettings",
                  input: primary.id,
                })
              ).result as BlockInstanceSettings
            ).configuration.textScale,
            1.5,
          );
        }
        if (count >= 10)
          assert.equal(
            new Set(actual.resources.map((resource) => resource.kind)).size,
            7,
          );
        assert.equal(
          Object.keys((await core.command("snapshot", {})).executions).length,
          0,
        );
        for (const [blockId, configuration] of Object.entries(
          seed.configurations,
        ))
          assert.deepEqual(
            (
              await core.command("library", {
                name: "getBlockSettings",
                input: blockId,
              })
            ).result,
            configuration,
          );
      } finally {
        await core.command("close", {});
      }
      const path = join(profile, "aerynth.sqlite"),
        before = createHash("sha256").update(readFileSync(path)).digest("hex");
      await assert.rejects(
        prepareNativeScale(profile, count),
        /Profile must not exist/,
      );
      assert.equal(
        createHash("sha256").update(readFileSync(path)).digest("hex"),
        before,
      );
      // Synthetic evidence remains private and available for the native owner.
      console.log(
        JSON.stringify({
          preparedCount: count,
          nativeRun: false,
          canonicalRestartPassed: true,
          profile,
        }),
      );
    });
  }
  const rejected = join(
    tmpdir(),
    "aerynth-native-block-scale-rejected-" + randomUUID(),
  );
  await assert.rejects(prepareNativeScale(rejected, 51));
  assert.equal(existsSync(rejected), false);
});
