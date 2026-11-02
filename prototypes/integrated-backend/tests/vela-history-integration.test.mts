import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BackendCore } from "../src/core.mts";
import type {
  ProviderPort,
  VelaBackendState,
  VelaOperation,
} from "../src/contracts.mts";
import type { VelaRequest } from "../../vela-core/src/contracts.ts";
import { planningDigest } from "../../vela-core/src/codex-planning-adapter.mts";

/** Actual Core/SQLite with an explicit local stdio protocol double. No Codex/account/model connection. */
function fixture(history = true, mode = "answer-catalog") {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-frozen-history-")),
    path = join(dir, "canonical.sqlite");
  const options = {
    path,
    provider: "codex" as const,
    contentPolicy: "synthetic-only" as const,
    codexExecutable: process.execPath,
    codexArgs: [
      fileURLToPath(
        new URL("../../codex-bridge/tests/catalog-server.mjs", import.meta.url),
      ),
      mode,
    ],
    velaCatalogDiscovery: true,
    velaHistoryContext: history,
  };
  let core = new BackendCore(options),
    closed = false;
  const vela = (name: VelaOperation["name"], input: unknown = {}) =>
      core.command("vela", { name, input } as VelaOperation),
    state = () => vela("state") as Promise<VelaBackendState>;
  const review = async (
    intent = "Synthetic frozen history question",
    resourceIds: string[] = [],
  ) => {
    await core.command("capabilities", {});
    const preview = await core.command("velaRequestPreview", {
        intent,
        resourceIds,
      }),
      native = await core.command("velaNativeReview", {
        previewId: preview.id,
        signature: preview.signature,
      });
    return { preview, native };
  };
  const approve = async (value: Awaited<ReturnType<typeof review>>) => {
    const grant = await core.command("authorizeVelaRequest", {
      previewId: value.preview.id,
      signature: value.preview.signature,
      reviewDigest: value.native.reviewDigest,
    });
    return {
      intent: value.preview.intent,
      resourceIds: value.preview.resourceIds,
      authorizeProvider: true,
      previewId: value.preview.id,
      grantId: grant.grantId,
    };
  };
  return {
    get core() {
      return core;
    },
    path,
    options,
    vela,
    state,
    review,
    approve,
    db: () => (core as unknown as { db: DatabaseSync }).db,
    async ask(intent: string, resourceIds: string[] = []) {
      const value = await review(intent, resourceIds),
        input = await approve(value),
        request = (await vela("request", input)) as VelaRequest;
      assert.equal(request.state, "responded", request.errorCode);
      return { ...value, input, request };
    },
    async reopen(edit?: (db: DatabaseSync) => void) {
      await core.command("close", {});
      closed = true;
      if (edit) {
        const db = new DatabaseSync(path);
        try {
          edit(db);
        } finally {
          db.close();
        }
      }
      core = new BackendCore(options);
      closed = false;
    },
    async close() {
      if (!closed) await core.command("close", {});
      const target = resolve(dir),
        part = relative(resolve(tmpdir()), target);
      assert(
        part.startsWith("aerynth-frozen-history-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(target, { recursive: true, force: true });
    },
  };
}
test("private native review binds exact semantic egress and canonical whole-pair history across a real Core SQLite restart", async () => {
  const f = fixture();
  try {
    const projectState = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic metadata audit project",
      }),
      projectId = projectState.projects[0].id;
    const workspaceState = await f.core.command("desktop", {
        type: "createWorkspace",
        title: "Synthetic metadata audit workspace",
        projectId,
      }),
      workspaceId = workspaceState.activeWorkspaceId!;
    const noteState = await f.core.command("desktop", {
        type: "createResource",
        kind: "note",
        title: "Synthetic metadata audit note",
        workspaceId,
      }),
      note = noteState.resources.find((item) => item.kind === "note")!;
    await f.core.command("desktop", {
      type: "content",
      resourceId: note.id,
      expectedVersion: note.version,
      content: "SYNTHETIC_SOURCE_BODY_NOT_FOR_METADATA",
    });
    // Keep the body sentinel beyond the native planning conversation's legitimate 120-character title projection.
    const first = await f.review(
      "Synthetic metadata audit request ".repeat(5) +
        "SYNTHETIC_HISTORY_BODY_NOT_FOR_METADATA",
      [note.id],
    );
    assert.equal(
      (await f.state()).conversation,
      null,
      "Read-only review never creates Vela",
    );
    await assert.rejects(
      f.core.command("authorizeVelaRequest", {
        previewId: first.preview.id,
        signature: first.preview.signature,
      }),
      /vela_native_review_required/,
    );
    await assert.rejects(
      f.core.command("authorizeVelaRequest", {
        previewId: first.preview.id,
        signature: first.preview.signature,
        reviewDigest: "forged",
      }),
      /vela_native_review_required/,
    );
    const initial = (await f.vela(
      "request",
      await f.approve(first),
    )) as VelaRequest;
    assert.equal(initial.state, "responded", initial.errorCode);
    const before = (await f.state()).conversation!,
      selected = await f.review(
        "Synthetic follow-up about the previous answer",
      );
    assert.equal(selected.preview.history?.messageCount, 2);
    assert(!Object.hasOwn(selected.preview.context, "history"));
    assert(!Object.hasOwn(selected.preview, "prompt"));
    assert(!Object.hasOwn(selected.preview, "historyFence"));
    assert.deepEqual(
      selected.native.history!.messages.map((item) => item.id),
      before.messages.map((item) => item.id),
    );
    assert.deepEqual(
      selected.native.history!.messages.map((item) => item.content),
      before.messages.map((item) => item.content),
    );
    assert(
      !JSON.stringify(selected.native.historyOmissions).includes("requestId"),
    );
    const anyCore = f.core as any,
      read = anyCore.readVelaCatalog.bind(anyCore);
    let bodyReads = 0,
      guardedReads = 0,
      acceptedMetadata = false,
      violationStack: string | undefined;
    const markers = [
      "SYNTHETIC_HISTORY_BODY_NOT_FOR_METADATA",
      "SYNTHETIC_SOURCE_BODY_NOT_FOR_METADATA",
    ];
    const containsBody = (
      value: unknown,
      seen = new Set<unknown>(),
    ): boolean => {
      if (typeof value === "string")
        return markers.some((marker) => value.includes(marker));
      if (!value || typeof value !== "object" || seen.has(value)) return false;
      seen.add(value);
      return Object.values(value).some((item) => containsBody(item, seen));
    };
    anyCore.readVelaCatalog = async (requestId: string, call: unknown) => {
      const entry = anyCore.velaCatalogLeases.get(requestId),
        leaseRead = entry.lease.read;
      // Wait/binding writes belong to the existing execution flow. Guard the synchronous authorized metadata operation itself.
      entry.lease.read = (value: unknown) => {
        guardedReads++;
        const message = anyCore.velaHistoryMessage,
          content = anyCore.velaHistoryContent,
          snapshot = anyCore.graph.snapshot,
          save = anyCore.save,
          atomic = anyCore.atomic,
          state = anyCore.vela.state,
          clone = structuredClone,
          stringify = JSON.stringify;
        const forbidden = () => {
          bodyReads++;
          violationStack ??= new Error(
            "No state/body mutation snapshots in metadata tool",
          ).stack;
          throw new Error("No state/body mutation snapshots in metadata tool");
        };
        anyCore.velaHistoryMessage = forbidden;
        anyCore.velaHistoryContent = forbidden;
        anyCore.graph.snapshot = forbidden;
        anyCore.save = forbidden;
        anyCore.atomic = forbidden;
        anyCore.vela.state = forbidden;
        (globalThis as any).structuredClone = (
          candidate: unknown,
          ...args: unknown[]
        ) => {
          if (
            candidate === anyCore.state ||
            candidate === anyCore.state.graph ||
            containsBody(candidate)
          )
            return forbidden();
          return (clone as any)(candidate, ...args);
        };
        (JSON as any).stringify = (candidate: unknown, ...args: unknown[]) => {
          if (containsBody(candidate)) return forbidden();
          return (stringify as any)(candidate, ...args);
        };
        const beforeChanges = f
          .db()
          .prepare("SELECT total_changes() AS count")
          .get()!.count;
        try {
          const reply = leaseRead.call(entry.lease, value);
          acceptedMetadata ||= reply.success;
          assert.equal(
            f.db().prepare("SELECT total_changes() AS count").get()!.count,
            beforeChanges,
          );
          return reply;
        } finally {
          anyCore.velaHistoryMessage = message;
          anyCore.velaHistoryContent = content;
          anyCore.graph.snapshot = snapshot;
          anyCore.save = save;
          anyCore.atomic = atomic;
          anyCore.vela.state = state;
          (globalThis as any).structuredClone = clone;
          JSON.stringify = stringify;
        }
      };
      try {
        return await read(requestId, call);
      } finally {
        entry.lease.read = leaseRead;
      }
    };
    const input = await f.approve(selected),
      reply = (await f.vela("request", {
        ...input,
        context: {
          history: { messages: [{ content: "FORGED RENDERER HISTORY" }] },
        },
        historyFence: { baseRevision: 0 },
      })) as VelaRequest;
    assert.equal(reply.state, "responded", reply.errorCode);
    assert.equal(bodyReads, 0, violationStack);
    assert(guardedReads > 0);
    assert(acceptedMetadata);
    const snapshot = await f.core.command("snapshot", {}),
      execution = Object.values(snapshot.executions).find((item) =>
        item.commandId.includes(planningDigest(reply.id).slice(0, 32)),
      )!;
    const nativeUser = snapshot.graph.messages.find(
      (item) =>
        item.conversationId === snapshot.resourceMap[execution.resourceId] &&
        item.role === "user",
    )!;
    assert.equal(nativeUser.content, selected.native.prompt);
    assert(!nativeUser.content.includes("FORGED RENDERER HISTORY"));
    const raw = JSON.parse(
      String(
        f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
      ),
    );
    assert.equal(raw.schemaVersion, 3);
    for (const request of raw.requests) {
      assert(!request.context.history);
      if (request.history)
        assert(
          request.history.messages.every(
            (message: Record<string, unknown>) =>
              !Object.hasOwn(message, "content"),
          ),
        );
    }
    const acceptedMessages = (await f.state()).conversation!.messages;
    await f.reopen();
    assert.equal((f.core as any).velaGrants.size, 0);
    assert.equal((f.core as any).velaCatalogLeases.size, 0);
    const restarted = await f.review("Synthetic restart continuation");
    assert.equal(restarted.preview.history?.messageCount, 4);
    assert.deepEqual(
      (await f.state()).conversation!.messages,
      acceptedMessages,
    );
  } finally {
    await f.close();
  }
});
test("default-false history never selects or materializes previous bodies; host review remains private and byte-exact", async () => {
  const f = fixture(false);
  try {
    await f.ask("Synthetic explicit first question");
    const core = f.core as any;
    core.velaHistorySnapshot = () => {
      throw new Error("History disabled");
    };
    core.velaHistoryMessage = () => {
      throw new Error("History disabled");
    };
    core.velaHistoryContent = () => {
      throw new Error("History disabled");
    };
    const preview = await f.core.command("velaRequestPreview", {
      intent: "Synthetic default-off follow-up",
      resourceIds: [],
    });
    assert.equal(preview.history, undefined);
    assert(!preview.context.history);
    await assert.rejects(
      f.vela("nativeReview" as VelaOperation["name"], {
        previewId: preview.id,
        signature: preview.signature,
      }),
      /unsupported_vela_command/,
    );
    await assert.rejects(
      f.core.command("velaNativeReview", {
        previewId: preview.id,
        signature: "foreign",
      }),
      /approval_scope_mismatch/,
    );
  } finally {
    await f.close();
  }
});
test("an extra canonical append or changed source invalidates a frozen window instead of silently selecting replacements", async () => {
  const f = fixture();
  try {
    await f.ask("Synthetic history seed");
    const selected = await f.review("Synthetic stale window"),
      id = (await f.state()).conversation!.resourceId;
    await f.core.command("addMessage", {
      resourceId: id,
      role: "user",
      content: "Synthetic concurrent canonical append",
      expectedRevision: (await f.state()).conversation!.revision,
    });
    await assert.rejects(f.approve(selected), /stale-history-revision/);
  } finally {
    await f.close();
  }
  const g = fixture();
  try {
    await g.ask("Synthetic history seed for dispatch fence");
    const selected = await g.review(
        "Synthetic request with exactly one permitted append",
      ),
      input = await g.approve(selected),
      core = g.core as any,
      bridge = core.frozenVelaProviderContext.bind(core);
    core.frozenVelaProviderContext = (id: string) => {
      const value = bridge(id);
      return {
        ...value,
        onAcceptedAppend: (append: unknown) => {
          value.onAcceptedAppend(append);
          core.velaHost.appendMessage(core.state.vela.conversationId, {
            role: "user",
            content: "Synthetic unauthorized extra append",
            source: "user",
            classification: "observed",
          });
        },
      };
    };
    const request = (await g.vela("request", input)) as VelaRequest;
    assert.equal(request.state, "failed");
    assert.equal(
      Object.values((await g.core.command("snapshot", {})).executions).length,
      1,
      "No new synthetic provider turn crosses the stale append fence",
    );
  } finally {
    await g.close();
  }
  const h = fixture();
  try {
    const created = await h.core.command("desktop", {
        type: "createResource",
        kind: "note",
        title: "Synthetic transitive history source",
        workspaceId: null,
      }),
      note = created.resources.find((item) => item.kind === "note")!;
    const saved = await h.core.command("desktop", {
      type: "content",
      resourceId: note.id,
      expectedVersion: note.version,
      content: "Synthetic source detail that remains canonical.",
    });
    await h.ask("Synthetic answer derived from this source", [note.id]);
    const reviewed = await h.review(
      "Synthetic follow-up without reselecting the note",
    );
    assert.equal(reviewed.native.history?.messages.length, 2);
    const current = saved.resources.find((item) => item.id === note.id)!;
    await h.core.command("desktop", {
      type: "content",
      resourceId: note.id,
      expectedVersion: current.version,
      content: "Synthetic source changed after native review",
    });
    await assert.rejects(h.approve(reviewed), /upstream-changed/);
    const updated = await h.review(
      "Synthetic new follow-up after source change",
    );
    assert.equal(updated.native.history, undefined);
    assert(
      updated.native.historyOmissions.some(
        (item) => item.reason === "upstream-changed",
      ),
    );
  } finally {
    await h.close();
  }
});
test("foreign navigation history is omitted before any historical body reader and never becomes known-null provenance", async () => {
  const f = fixture();
  try {
    const a = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic history scope A",
      }),
      projectA = a.projects[0];
    await f.core.command("desktop", {
      type: "createWorkspace",
      title: "Synthetic A workspace",
      projectId: projectA.id,
    });
    await f.ask("SYNTHETIC_PRIVATE_SCOPE_A_QUESTION");
    const b = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic history scope B",
      }),
      projectB = b.projects.find((item) => item.id !== projectA.id)!;
    await f.core.command("desktop", {
      type: "navigate",
      target: { kind: "constellation", projectId: projectB.id },
    });
    let bodies = 0;
    (f.core as any).velaHistoryMessage = () => {
      bodies++;
      throw new Error("Foreign history body must not be materialized");
    };
    const reviewed = await f.review("Synthetic B request");
    assert.equal(reviewed.native.history, undefined);
    assert.equal(bodies, 0);
    assert(
      !reviewed.native.prompt.includes("SYNTHETIC_PRIVATE_SCOPE_A_QUESTION"),
    );
    assert(
      reviewed.native.historyOmissions.some(
        (item) => item.reason === "scope-mismatch",
      ),
    );
  } finally {
    await f.close();
  }
});
test("foreign inherited conversation sources deny content preflight before body size or over-budget disclosure", async () => {
  const f = fixture();
  try {
    const a = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic inherited scope A",
      }),
      projectA = a.projects[0].id,
      b = await f.core.command("desktop", {
        type: "createProject",
        title: "Synthetic inherited scope B",
      }),
      projectB = b.projects.find((item) => item.id !== projectA)!.id,
      parent = await f.core.command("createConversation", {
        title: "Synthetic foreign parent",
        providerId: "local",
        commandId: "history-parent",
      }),
      origin = await f.core.command("addMessage", {
        resourceId: parent.resourceId,
        role: "user",
        content: "Synthetic foreign inherited body",
        expectedRevision: 1,
      });
    await f.core.command("conversation", {
      name: "organize",
      input: {
        type: "associateProject",
        resourceId: parent.resourceId,
        projectId: projectB,
        expectedVersion: 1,
      },
    });
    const child = await f.core.command("branch", {
      resourceId: parent.resourceId,
      messageId: origin.id,
      includeMessageIds: [origin.id],
      providerId: "local",
      title: "Synthetic scoped child",
      commandId: "history-child",
      tokenBudget: 8192,
    });
    await f.core.command("conversation", {
      name: "organize",
      input: {
        type: "associateProject",
        resourceId: child.conversation.resourceId,
        projectId: projectA,
        expectedVersion: 1,
      },
    });
    await f.core.command("desktop", {
      type: "createWorkspace",
      title: "Synthetic inherited A workspace",
      projectId: projectA,
    });
    const core = f.core as any,
      scope = core.velaHost.scope(),
      ref = core.velaHost.resolve(
        { id: child.conversation.resourceId, kind: "resource" },
        scope,
      ),
      record = core.graph.data.messages.find(
        (item: { id: string }) => item.id === origin.id,
      ),
      descriptor = Object.getOwnPropertyDescriptor(record, "content")!;
    assert(ref);
    assert(scope.resourceIds.includes(child.conversation.resourceId));
    assert(!scope.resourceIds.includes(parent.resourceId));
    let bodyReads = 0;
    Object.defineProperty(record, "content", {
      configurable: true,
      get() {
        bodyReads++;
        throw new Error("Foreign inherited body must not be examined");
      },
    });
    try {
      assert.equal(
        core.velaHistoryContent(ref, 0),
        null,
        "Denied source is not reported as an oversized authorized body",
      );
      assert.equal(core.velaHistoryContent(ref, 131072), null);
      assert.equal(bodyReads, 0);
    } finally {
      Object.defineProperty(record, "content", descriptor);
    }
    assert.equal(
      Object.values((await f.core.command("snapshot", {})).executions).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("actual Core accepts legacy Vela state1/2 and writes3 with default history off; unknown future state fails before canonical writes", async () => {
  for (const version of [1, 2]) {
    const f = fixture(false);
    try {
      const first = await f.ask("Synthetic supported legacy migration"),
        before = await f.core.command("snapshot", {}),
        messages = (await f.state()).conversation!.messages;
      await f.reopen((db) => {
        const raw = JSON.parse(
          String(
            db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
          ),
        );
        raw.schemaVersion = version;
        for (const request of raw.requests) {
          delete request.origin;
          delete request.inputMessageId;
          delete request.inputContentDigest;
          delete request.provenance;
          delete request.history;
          if (request.response) delete request.response.contentDigest;
        }
        db.prepare(
          "UPDATE vela_state SET schema_version=?,json=? WHERE id=1",
        ).run(version, JSON.stringify(raw));
      });
      assert.equal(
        f
          .db()
          .prepare("SELECT schema_version FROM vela_state WHERE id=1")
          .get()!.schema_version,
        3,
      );
      assert.deepEqual((await f.state()).conversation!.messages, messages);
      assert.deepEqual(
        (await f.core.command("snapshot", {})).resourceMap,
        before.resourceMap,
      );
      assert.equal(
        (await f.state()).requests.find((item) => item.id === first.request.id)!
          .origin,
        undefined,
      );
      assert.equal(
        Object.values((await f.core.command("snapshot", {})).executions).length,
        1,
      );
    } finally {
      await f.close();
    }
  }
  const g = fixture(false);
  try {
    await g.ask("Synthetic future-version preservation");
    const before = String(
      g.db().prepare("SELECT json FROM integration_state WHERE id=1").get()!
        .json,
    );
    await assert.rejects(
      g.reopen((db) => {
        const raw = JSON.parse(
          String(
            db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
          ),
        );
        raw.schemaVersion = 4;
        db.prepare(
          "UPDATE vela_state SET schema_version=4,json=? WHERE id=1",
        ).run(JSON.stringify(raw));
      }),
      /unsupported_vela_schema/,
    );
    const db = new DatabaseSync(g.path);
    try {
      assert.equal(
        String(
          db.prepare("SELECT json FROM integration_state WHERE id=1").get()!
            .json,
        ),
        before,
      );
      assert.equal(
        db.prepare("SELECT schema_version FROM vela_state WHERE id=1").get()!
          .schema_version,
        4,
      );
    } finally {
      db.close();
    }
  } finally {
    await g.close();
  }
  const h = fixture(false);
  try {
    await h.ask("Synthetic mismatched downgrade preservation");
    await assert.rejects(
      h.reopen((db) => {
        const raw = JSON.parse(
          String(
            db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
          ),
        );
        raw.schemaVersion = 2;
        db.prepare("UPDATE vela_state SET json=? WHERE id=1").run(
          JSON.stringify(raw),
        );
      }),
      /corrupt_vela_state/,
    );
  } finally {
    await h.close();
  }
});
