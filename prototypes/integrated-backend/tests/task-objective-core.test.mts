import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { BackendCore } from "../src/core.mts";
import type {
  TaskObjectiveReceipt,
  TaskObjectiveDocument,
} from "../../task-product/contracts.ts";
import type { StreamEvent } from "../src/contracts.mts";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-task-core-")),
    path = join(dir, "canonical.sqlite"),
    events: StreamEvent[] = [];
  let core = new BackendCore(
    { path, provider: "fixture", contentPolicy: "synthetic-only" },
    (e) => events.push(e),
  );
  return {
    get core() {
      return core;
    },
    get owner() {
      return core as any;
    },
    events,
    async reopen() {
      await core.command("close", {});
      core = new BackendCore(
        { path, provider: "fixture", contentPolicy: "synthetic-only" },
        (e) => events.push(e),
      );
    },
    async close() {
      await core.command("close", {});
      const part = relative(resolve(tmpdir()), resolve(dir));
      assert(
        part.startsWith("aerynth-task-core-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const definition = () => ({
  objective: "Synthetic bounded objective",
  requirements: [{ id: "criterion-a", text: "Inspect the recorded source." }],
  assignees: [],
  dependencies: [],
  sources: [],
});
test("actual Core Task Objectives use canonical resources and manual provenance, preserving legacy Tasks and restart without provider work", async () => {
  const f = fixture();
  try {
    assert.deepEqual(
      (await f.core.command("taskObjectives", { name: "list", input: {} }))
        .result,
      { items: [], coverage: "complete" },
    );
    const legacy = (
      await f.core.command("desktop", {
        type: "createResource",
        kind: "task",
        title: "Synthetic legacy Task",
        workspaceId: null,
      })
    ).resources.find((r) => r.title === "Synthetic legacy Task")!;
    const note = f.owner.kernel.createNote(
      "Synthetic evidence",
      "Exact local evidence.",
    );
    const input = {
      commandId: "synthetic-task-core-create",
      title: "Synthetic objective",
      projectId: null,
      definition: {
        ...definition(),
        sources: [
          {
            resourceId: note.id,
            revision: "resource:1:content:1:conversation:0",
          },
        ],
      },
    };
    const created = (
      await f.core.command("taskObjectives", { name: "create", input })
    ).result as TaskObjectiveReceipt;
    assert.deepEqual(
      (await f.core.command("taskObjectives", { name: "create", input }))
        .result,
      created,
    );
    const read = async () =>
      (
        await f.core.command("taskObjectives", {
          name: "read",
          input: { resourceId: created.resourceId },
        })
      ).result as TaskObjectiveDocument;
    const before = await read();
    assert.equal(before.resource.kind, "task_objective");
    assert.equal(before.canEdit, true);
    assert.equal(before.sources[0].reference?.resourceId, note.id);
    const desktop = await f.core.command("desktop", { type: "snapshot" });
    assert.equal(
      desktop.resources.find((r) => r.id === created.resourceId)?.kind,
      "task_objective",
    );
    assert.equal(desktop.workspaces.length, 0);
    assert.equal(desktop.blocks.length, 0);
    assert(!f.owner.kernel.getResource(created.resourceId).note);
    assert.equal(f.owner.kernel.getResource(legacy.id).resource.id, legacy.id);
    const event = f.events.find((e) => e.type === "task-objective.created")!;
    assert.equal(event.providerId, "aerynth-native");
    assert.equal(event.resourceId, created.resourceId);
    assert.equal(event.classification, "observed");
    assert.equal(
      JSON.stringify(event).includes("Exact local evidence."),
      false,
    );
    assert.equal(
      JSON.stringify(event).includes(input.definition.objective),
      false,
    );
    assert.deepEqual(await f.core.command("providerActivity", {}), {
      codexConnections: 0,
      providerRequests: 0,
      systemMemoryReads: 0,
      scope: "process-session-native-attempts",
    });
    await f.reopen();
    assert.deepEqual(await read(), before);
    assert.equal(f.owner.kernel.getResource(legacy.id).resource.id, legacy.id);
    const allowed = f.owner.productResourceAccess;
    f.owner.productResourceAccess = () => false;
    await assert.rejects(
      read(),
      /task_resource_unavailable|task_not_authorized|task_unavailable|task_reference_unavailable/,
    );
    f.owner.productResourceAccess = allowed;
  } finally {
    await f.close();
  }
});
test("actual Core Task event delivery follows outer commit and rejects forged manual authority", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.core.command("taskObjectives", {
        name: "create",
        input: {
          commandId: "forged-task",
          title: "Synthetic",
          projectId: null,
          definition: definition(),
          actor: { authority: "manual" },
        },
      } as any),
      /task_invalid_create/,
    );
    const count = f.events.length;
    assert.throws(
      () =>
        f.owner.atomic(() => {
          f.owner
            .taskObjectiveDomain()
            .dispatch({
              name: "create",
              input: {
                commandId: "task-rollback",
                title: "Synthetic rollback",
                projectId: null,
                definition: definition(),
              },
            });
          throw Error("synthetic outer rollback");
        }),
      /synthetic outer rollback/,
    );
    assert.equal(f.events.length, count);
    assert.deepEqual(
      (await f.core.command("taskObjectives", { name: "list", input: {} }))
        .result,
      { items: [], coverage: "complete" },
    );
  } finally {
    await f.close();
  }
});
