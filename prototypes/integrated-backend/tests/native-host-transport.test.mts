import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Backend } from "../src/service.mts";
import {
  createNativeHostServer,
  isNativeHostEnvelope,
} from "../src/native-host.mts";
const marker = "SYNTHETIC_PRIVATE_HOP_MARKER";
function temporary() {
  const root = mkdtempSync(join(tmpdir(), "aerynth-native-host-synthetic-"));
  return {
    root,
    path: join(root, "canonical.sqlite"),
    remove() {
      const target = resolve(root),
        base = resolve(tmpdir());
      assert.ok(target.startsWith(base + sep));
      try {
        assert.ok(
          statSync(join(root, "canonical.sqlite")).size < 8 * 1024 * 1024,
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        )
          throw error;
      }
      rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 10,
      });
    },
  };
}
test("real worker port private roundtrip is intercepted before fixture/public messages", async () => {
  const worker = new Worker(
    new URL("./native-host-worker.fixture.mts", import.meta.url),
  );
  const normal: unknown[] = [],
    server = createNativeHostServer(
      {
        secrets: {
          available: async () => true,
          seal: async (value) => Buffer.from("synthetic:" + value),
          open: async (value) => Buffer.from(value).toString().slice(10),
        },
      },
      (message) => worker.postMessage(message),
    );
  try {
    const result = await new Promise<{ available: boolean; matches: boolean }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(Error("fixture_timeout")), 3000);
        worker.on("message", (value) => {
          if (server.handle(value)) return;
          normal.push(value);
          if (value.fixtureResult) {
            clearTimeout(timer);
            resolve(value.fixtureResult);
          }
        });
        worker.once("error", reject);
        worker.postMessage({ fixture: "exercise" });
      },
    );
    assert.equal(result.available, true);
    assert.equal(result.matches, true);
    assert.ok(!JSON.stringify(normal).includes(marker));
  } finally {
    server.close();
    await worker.terminate();
  }
});
test("actual Backend worker supports native injection without serializing functions; legacy source path remains usable", async () => {
  for (const native of [false, true]) {
    const temp = temporary();
    let calls = 0;
    const backend = new Backend(
      { path: temp.path, provider: "fixture", contentPolicy: "synthetic-only" },
      native
        ? {
            secrets: {
              available: async () => {
                calls++;
                return false;
              },
              seal: async () => {
                throw Error(marker);
              },
              open: async () => {
                throw Error(marker);
              },
            },
          }
        : undefined,
    );
    const events: unknown[] = [];
    backend.subscribe((value) => events.push(value));
    try {
      const snapshot = await backend.call("snapshot", {});
      assert.equal(snapshot.schemaVersion, 1);
      assert.ok(!JSON.stringify(snapshot).includes(marker));
      assert.ok(!JSON.stringify(events).includes(marker));
      assert.equal(calls, 0);
    } finally {
      await backend.close();
      temp.remove();
    }
  }
});
test("actual desktop-host three-argument and opt-in processes suppress mixed/malformed native envelopes before RPC/events", async () => {
  for (const native of [false, true]) {
    const temp = temporary(),
      args = [
        fileURLToPath(new URL("../src/desktop-host.mts", import.meta.url)),
        temp.path,
        temp.root,
        temp.root,
        ...(native ? ["--native-secrets"] : []),
      ],
      child = spawn(process.execPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    const exit = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    const replies: unknown[] = [],
      lines = createInterface({ input: child.stdout });
    let bytes = 0,
      diagnostics = 0;
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk.length;
      if (diagnostics > 65536) child.kill();
    });
    const waiting = new Map<number, (value: Record<string, unknown>) => void>();
    lines.on("line", (line) => {
      bytes += Buffer.byteLength(line);
      if (bytes > 1024 * 1024) {
        child.kill();
        return;
      }
      const message = JSON.parse(line);
      assert.equal(isNativeHostEnvelope(message), false);
      replies.push(message);
      if (typeof message.id === "number") {
        waiting.get(message.id)?.(message);
        waiting.delete(message.id);
      }
    });
    const call = (id: number, command: string, input: object) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(Error("desktop_fixture_timeout"));
        }, 5000);
        waiting.set(id, (result) => {
          clearTimeout(timer);
          resolve(result);
        });
        child.stdin.write(JSON.stringify({ id, command, input }) + "\n");
      });
    const deadline = setTimeout(() => child.kill(), 8000);
    try {
      const metric = await call(1, "metrics", {});
      assert.ok(metric.result);
      child.stdin.write(
        JSON.stringify({
          nativeHost: null,
          event: { private: marker },
          id: 999,
          result: { token: marker },
        }) + "\n",
      );
      child.stdin.write(
        JSON.stringify({
          nativeHost: { version: 99 },
          id: 998,
          command: "metrics",
          input: { private: marker },
        }) + "\n",
      );
      const snapshot = await call(2, "snapshot", {});
      assert.ok(snapshot.result);
      assert.ok(
        !replies.some(
          (value) =>
            (value as { id?: number }).id === 999 ||
            (value as { id?: number }).id === 998,
        ),
      );
      assert.ok(!JSON.stringify(replies).includes(marker));
      await call(3, "close", {});
      await exit;
    } finally {
      clearTimeout(deadline);
      child.stdin.end();
      if (child.exitCode === null) child.kill();
      await exit;
      lines.close();
      temp.remove();
    }
  }
});
