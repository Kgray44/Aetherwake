import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createNativeHostServer } from "../src/native-host.mts";
const loader = new URL("./native-close-loader.fixture.mjs", import.meta.url)
  .href;
for (const mode of ["success", "fail", "terminate"])
  test(
    "real Backend/worker keeps crypto through graceful ack, invalidates forced loss: " +
      mode,
    () => {
      const text = execFileSync(
        process.execPath,
        [
          "--import",
          loader,
          fileURLToPath(
            new URL("./native-close-runner.fixture.mts", import.meta.url),
          ),
          mode,
        ],
        {
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 65536,
          windowsHide: true,
          env: { ...process.env, NODE_OPTIONS: "" },
        },
      );
      const result = JSON.parse(text);
      assert.equal(result.ok, true);
      if (mode !== "terminate") {
        assert.equal(result.seals, 1);
        assert.equal(result.opens, 1);
      }
      assert.ok(!text.includes("SYNTHETIC_PRIVATE"));
    },
  );
for (const mode of ["success", "fail", "eof"])
  test(
    "real desktop-host coalesces command/line close and retains failed graceful channel: " +
      mode,
    async () => {
      const root = mkdtempSync(
          join(tmpdir(), "aerynth-native-close-synthetic-"),
        ),
        path = join(
          root,
          mode === "fail" ? "fail-first.sqlite" : "success.sqlite",
        ),
        child = spawn(
          process.execPath,
          [
            "--import",
            loader,
            fileURLToPath(new URL("../src/desktop-host.mts", import.meta.url)),
            path,
            root,
            root,
            ...(mode === "eof" ? [] : ["--native-secrets"]),
          ],
          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: { ...process.env, NODE_OPTIONS: "" },
          },
        );
      const normal: unknown[] = [],
        pending = new Map<number, (value: any) => void>();
      let seals = 0,
        opens = 0,
        bytes = 0;
      const server = createNativeHostServer(
        {
          secrets: {
            available: async () => true,
            seal: async (text) => {
              seals++;
              return Buffer.from("synthetic:" + text);
            },
            open: async (value) => {
              opens++;
              return Buffer.from(value).toString().slice(10);
            },
          },
        },
        (message) => child.stdin.write(JSON.stringify(message) + "\n"),
      );
      const lines = createInterface({ input: child.stdout }),
        exited = new Promise<number | null>((resolve) =>
          child.once("exit", resolve),
        );
      const deadline = setTimeout(() => child.kill(), 5000);
      child.stderr.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 65536) child.kill();
      });
      lines.on("line", (line) => {
        const value = JSON.parse(line);
        if (server.handle(value)) return;
        normal.push(value);
        pending.get(value.id)?.(value);
        pending.delete(value.id);
      });
      const call = (id: number, command: string) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("fixture_timeout")),
            2000,
          );
          pending.set(id, (value) => {
            clearTimeout(timer);
            resolve(value);
          });
          child.stdin.write(JSON.stringify({ id, command, input: {} }) + "\n");
        });
      try {
        assert.ok((await call(1, "metrics")).result);
        if (mode === "eof") {
          child.stdin.end();
          assert.equal(await exited, 0);
        } else {
          if (mode === "fail") {
            assert.equal(
              (await call(2, "close")).error,
              "fixture_close_denied",
            );
            assert.equal((await call(3, "snapshot")).result.available, true);
          }
          assert.equal((await call(4, "close")).result, null);
          assert.equal(await exited, 0);
          assert.equal(seals, 1);
          assert.equal(opens, 1);
        }
        const settled = normal.filter(
          (value) =>
            (value as { event?: { type: string } }).event?.type ===
            "fixture/closed",
        );
        assert.equal(settled.length, 1);
        assert.equal(
          (settled[0] as { event: { payload: { attempts: number } } }).event
            .payload.attempts,
          mode === "fail" ? 2 : 1,
        );
        assert.ok(!JSON.stringify(normal).includes("SYNTHETIC_PRIVATE"));
      } finally {
        clearTimeout(deadline);
        server.close();
        child.stdin.end();
        if (child.exitCode === null) child.kill();
        await exited;
        lines.close();
        const target = resolve(root);
        assert.ok(target.startsWith(resolve(tmpdir()) + sep));
        rmSync(target, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 10,
        });
      }
    },
  );
