import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

test(
  "actual desktop stdio host carries private review to Core without granting or starting a provider turn",
  { timeout: 20000 },
  async ({ signal: testSignal }) => {
    const temporaryRoot = resolve(tmpdir()),
      directory = mkdtempSync(
        join(temporaryRoot, "aerynth-native-review-wire-"),
      );
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("../src/desktop-host.mts", import.meta.url)),
        join(directory, "aerynth.sqlite"),
        directory,
        repo,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const pending = new Map<number, (error: Error | null, value?: any) => void>();
    let serial = 0,
      errorText = "",
      terminalError: Error | undefined;
    const failPending = (error: Error) => {
      terminalError ??= error;
      for (const settle of pending.values()) settle(terminalError);
    };
    child.on("error", failPending);
    child.stdin.on("error", failPending);
    child.stderr.on("data", (chunk) => {
      errorText = (errorText + String(chunk)).slice(-4000);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const reply = JSON.parse(line);
      if (typeof reply.id === "number") pending.get(reply.id)?.(null, reply);
    });
    const request = (command: string, input: unknown, startup = false) =>
      new Promise<any>((accept, reject) => {
        const id = ++serial,
          deadline = startup ? testSignal : AbortSignal.any([testSignal, AbortSignal.timeout(5000)]);
        const abort = () => pending.get(id)?.(Error(
          `desktop_host_${startup ? "startup_" : ""}timeout (${command}): ${errorText}`,
        ));
        pending.set(id, (error, value) => {
          if (!pending.delete(id)) return;
          deadline.removeEventListener("abort", abort);
          if (error) reject(error);
          else accept(value);
        });
        if (terminalError) return pending.get(id)?.(terminalError);
        if (deadline.aborted) return abort();
        deadline.addEventListener("abort", abort, { once: true });
        child.stdin.write(JSON.stringify({ id, command, input }) + "\n");
      });
    let closed = false;
    const exited = new Promise<void>((accept) =>
      child.once("close", (code, signal) => {
        closed = true;
        failPending(Error(`desktop_host_closed (${code ?? signal}): ${errorText}`));
        accept();
      }),
    );
    try {
      // A Core-backed read proves the worker is ready before the RPC deadlines begin.
      const startup = await request("snapshot", {}, true);
      assert.equal(startup.result?.schemaVersion, 1);
      const rejected = await request("velaNativeReview", {
        previewId: "unknown-preview",
        signature: "not-a-grant",
      });
      assert.equal(
        rejected.error,
        "approval_scope_mismatch",
        "the real command must reach Core rather than fail the transport allowlist",
      );
      const preview = await request("velaRequestPreview", {
        intent: "Synthetic transport-only review. No execution is authorized.",
        resourceIds: [],
      });
      assert.equal(preview.error, undefined);
      const review = await request("velaNativeReview", {
        previewId: preview.result.id,
        signature: preview.result.signature,
      });
      assert.equal(review.error, undefined);
      assert.equal(review.result.previewId, preview.result.id);
      assert.equal(review.result.signature, preview.result.signature);
      assert.equal(typeof review.result.prompt, "string");
      assert(review.result.prompt.includes("Synthetic transport-only review."));
      assert.match(review.result.reviewDigest, /^[a-f0-9]{64}$/);
      assert.equal(review.result.grantId, undefined);
      const snapshot = await request("snapshot", {});
      assert.deepEqual(snapshot.result.executions, {});
      const denied = await request("aerynthUnknownPrivateCommand", {});
      assert.equal(denied.error, "unsupported_command");
      assert.equal((await request("close", {})).error, undefined);
      await exited;
      assert.equal(child.exitCode, 0);
    } finally {
      if (!closed) {
        child.kill();
        await exited;
      }
      lines.close();
      const ownedRelative = relative(temporaryRoot, resolve(directory));
      assert(
        ownedRelative &&
          !ownedRelative.startsWith("..") &&
          !isAbsolute(ownedRelative) &&
          dirname(resolve(directory)) === temporaryRoot &&
          ownedRelative.startsWith("aerynth-native-review-wire-"),
      );
      rmSync(directory, { recursive: true });
    }
  },
);

test("the actual renderer preload still rejects private Vela review and authorization before IPC", async () => {
  let publicBridge: any;
  const ipcCalls: unknown[] = [];
  const source = readFileSync(
    new URL(
      "../../visual-experience/cinematic-v3/native/desktop-preload.cjs",
      import.meta.url,
    ),
    "utf8",
  );
  runInNewContext(source, {
    process: { argv: [] },
    require: (name: string) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (_name: string, value: unknown) => {
            publicBridge = value;
          },
        },
        ipcRenderer: {
          invoke: (...args: unknown[]) => {
            ipcCalls.push(args);
            return { ok: true, result: {} };
          },
        },
      };
    },
  });
  for (const name of [
    "velaNativeReview",
    "velaRequestPreview",
    "authorizeVelaRequest",
    "authorizeVelaDelegation",
    "missionPlanningReview",
    "missionPlanReviewed",
    "missionExecutiveReview",
    "missionExecutiveReviewed",
  ])
    await assert.rejects(publicBridge.command(name, {}), /unsupported_command/);
  assert.equal(ipcCalls.length, 0);
});
