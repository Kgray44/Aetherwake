import assert from "node:assert/strict";
import { Backend } from "../src/service.mts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
const mode = process.argv[2];
const root = mkdtempSync(join(tmpdir(), "aerynth-native-close-runner-"));
let available = 0,
  seals = 0,
  opens = 0,
  release!: (value: boolean) => void,
  entered!: () => void;
const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  }),
  events: unknown[] = [];
const backend = new Backend(
  {
    path: join(root, mode === "fail" ? "fail-first.sqlite" : "success.sqlite"),
    contentPolicy: "synthetic-only",
    provider: "fixture",
  },
  {
    secrets: {
      available: async () => {
        available++;
        if (mode === "terminate") {
          entered();
          return new Promise<boolean>((resolve) => {
            release = resolve;
          });
        }
        return true;
      },
      seal: async (value) => {
        seals++;
        return Buffer.from("synthetic:" + value);
      },
      open: async (bytes) => {
        opens++;
        return Buffer.from(bytes).toString().slice(10);
      },
    },
  },
);
backend.subscribe((event) => events.push(event));
try {
  if (mode === "terminate") {
    const close = assert.rejects(backend.close(), /backend_disconnected/);
    await waiting;
    await backend.terminate();
    await close;
    release(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(events, []);
  } else {
    if (mode === "fail") {
      await assert.rejects(backend.close(), /fixture_close_denied/);
      const state = (await backend.call("snapshot", {})) as unknown as {
        available: boolean;
        attempts: number;
      };
      assert.equal(state.available, true);
      assert.equal(state.attempts, 1);
    }
    await Promise.all([backend.close(), backend.close()]);
    await backend.close();
    assert.equal(seals, 1);
    assert.equal(opens, 1);
    assert.equal(events.length, 1);
    assert.equal(
      (events[0] as { payload: { attempts: number } }).payload.attempts,
      mode === "fail" ? 2 : 1,
    );
    await assert.rejects(backend.call("snapshot", {}), /backend_disconnected/);
  }
  assert.ok(!JSON.stringify(events).includes("SYNTHETIC_PRIVATE"));
  process.stdout.write(
    JSON.stringify({ ok: true, mode, available, seals, opens }),
  );
} catch (error) {
  await backend.terminate();
  process.stdout.write(
    JSON.stringify({
      ok: false,
      code:
        error instanceof Error && "code" in error
          ? error.code
          : "fixture_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  const target = resolve(root);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep));
  rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 10,
  });
}
