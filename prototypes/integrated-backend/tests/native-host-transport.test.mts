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
test("actual desktop-host three-argument and opt-in processes suppress mixed/malformed native envelopes before RPC/events", { timeout: 100_000 }, async () => {
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
      child.once("close", () => resolve()),
    );
    const replies: unknown[] = [],
      lines = createInterface({ input: child.stdout });
    let bytes = 0,
      diagnostics = 0;
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk.length;
      if (diagnostics > 65536) {
        fail(Error("desktop_fixture_diagnostic_limit"));
        child.kill();
      }
    });
    const waiting = new Map<number, {
      reply(value: Record<string, unknown>): void;
      fail(error: Error): void;
    }>();
    let failure: Error | undefined;
    const fail = (error: Error) => {
      failure ??= error;
      for (const pending of waiting.values()) pending.fail(failure);
      waiting.clear();
    };
    child.on("error", () => fail(Error("desktop_fixture_spawn_failed")));
    child.stdin.on("error", () => fail(Error("desktop_fixture_stdin_failed")));
    child.once("close", (code, signal) => fail(Error(`desktop_fixture_exited:${code ?? signal}`)));
    lines.on("line", (line) => {
      bytes += Buffer.byteLength(line);
      if (bytes > 1024 * 1024) {
        fail(Error("desktop_fixture_output_limit"));
        child.kill();
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
        assert.equal(isNativeHostEnvelope(message), false);
      } catch (error) {
        fail(error as Error);
        return;
      }
      replies.push(message);
      if (typeof message.id === "number") {
        waiting.get(message.id)?.reply(message);
        waiting.delete(message.id);
      }
    });
    const call = (id: number, command: string, input: object, timeoutMs = 5000) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        if (failure) { reject(failure); return; }
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(Error(`desktop_fixture_timeout:${native ? "native" : "legacy"}:${command}:${id}`));
        }, timeoutMs);
        waiting.set(id, {
          reply(result) { clearTimeout(timer); resolve(result); },
          fail(error) { clearTimeout(timer); reject(error); },
        });
        child.stdin.write(JSON.stringify({ id, command, input }) + "\n");
      });
    const deadline = setTimeout(() => child.kill(), 45_000);
    try {
      // Metrics are answered by the parent immediately. A successful snapshot
      // is the readiness barrier for the actual worker and its SQLite startup.
      assert.ok((await call(0, "snapshot", {}, 30_000)).result);
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
      await call(3, "close", {});
      await exit;
      assert.equal(child.exitCode, 0);
      assert.equal(failure?.message, "desktop_fixture_exited:0");
      assert.ok(
        !replies.some(
          (value) =>
            (value as { id?: number }).id === 999 ||
            (value as { id?: number }).id === 998,
        ),
      );
      assert.ok(!JSON.stringify(replies).includes(marker));
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
