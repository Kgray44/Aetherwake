import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { BackendCore } from "../src/core.mts";
import type {
  ProviderPort,
  VelaBackendState,
  VelaOperation,
} from "../src/contracts.mts";
import type {
  AttentionMode,
  AttentionPreferences,
  VelaPlan,
} from "../../vela-core/src/contracts.ts";
import {
  CAPABILITIES,
  validateAction,
} from "../../vela-core/src/capabilities.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "aerynth-vela-attention-")),
    path = join(dir, "canonical.sqlite");
  let connections = 0;
  const open = () => {
    const core = new BackendCore({
      path,
      privateRoot: dir,
      cwd: dir,
      provider: "codex",
      contentPolicy: "local-private",
    });
    (core as unknown as { port: ProviderPort }).port.connect = async () => {
      connections++;
      throw new Error("Attention mode cannot connect a provider");
    };
    return core;
  };
  let core = open();
  const vela = (name: VelaOperation["name"], input: unknown = {}) =>
      core.command("vela", { name, input } as VelaOperation),
    state = () => vela("state") as Promise<VelaBackendState>;
  const prepare = async (mode: AttentionMode, version?: number) =>
    vela("native", {
      intent: "Synthetic explicit attention mode " + mode,
      action: {
        type: "setAttentionMode",
        mode,
        expectedVersion: version ?? (await state()).preferences.version,
      },
    }) as Promise<VelaPlan>;
  return {
    get core() {
      return core;
    },
    vela,
    state,
    prepare,
    connections: () => connections,
    db: () => (core as any).db as DatabaseSync,
    async apply(mode: AttentionMode) {
      const plan = await prepare(mode),
        applied = (await vela("apply", plan.id)) as VelaPlan;
      assert.equal(applied.state, "applied");
      return applied;
    },
    async reopen() {
      await core.command("close", {});
      core = open();
    },
    async close() {
      await core.command("close", {});
      const part = relative(resolve(tmpdir()), resolve(dir));
      assert(
        part.startsWith("aerynth-vela-attention-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(resolve(dir), { recursive: true, force: true });
    },
  };
}
const authority = (preferences: AttentionPreferences) => {
  const {
    mode: _m,
    version: _v,
    source: _s,
    updatedAt: _t,
    ...rest
  } = preferences;
  return rest;
};

test("all modes use canonical attention preferences only, with persistent idempotent native receipts and no monitoring/delegation grant", async () => {
  const f = fixture();
  try {
    const before = (await f.state()).preferences,
      first = await f.apply("quiet");
    for (const mode of [
      "focused",
      "normal",
      "collaborative",
      "proactive",
    ] as const) {
      await f.apply(mode);
      assert.deepEqual(
        authority((await f.state()).preferences),
        authority(before),
      );
    }
    const current = await f.state(),
      version = current.preferences.version;
    assert.equal(version, before.version + 5);
    assert.equal(current.preferences.mode, "proactive");
    assert.equal(current.preferences.source, "explicit");
    assert.equal(current.preferences.monitoringEnabled, false);
    assert.equal(current.preferences.delegationEnabled, false);
    assert.equal(current.preferences.learning, "disabled");
    assert.equal(
      (f.core as any).vela.ingestAttention({
        id: "synthetic-ungranted-event",
        type: "task.changed",
        source: "synthetic-app",
        occurredAt: new Date().toISOString(),
        subject: null,
        severity: "critical",
        classification: "observed",
        summary: "Synthetic observable event",
        correlationId: "synthetic-event",
      }),
      null,
    );
    assert.equal(((await f.vela("apply", first.id)) as VelaPlan).id, first.id);
    assert.equal((await f.state()).preferences.version, version);
    const receipts = current.receipts.filter(
      (item) => item.planId === first.id,
    );
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].source, "vela");
    assert.equal(receipts[0].providerId, null);
    assert.equal(receipts[0].taskVerified, false);
    const conversationId = current.conversation!.resourceId;
    await f.reopen();
    const restored = await f.state();
    assert.deepEqual(restored.preferences, current.preferences);
    assert.equal(restored.conversation!.resourceId, conversationId);
    await f.vela("apply", first.id);
    assert.equal((await f.state()).preferences.version, version);
    assert.equal(
      (await f.state()).receipts.filter((item) => item.planId === first.id)
        .length,
      1,
    );
    assert.equal(f.connections(), 0);
    assert.deepEqual((await f.core.command("snapshot", {})).executions, {});
  } finally {
    await f.close();
  }
});

test("mode changes retain configured attention authority and follow the existing quiet/focused event policy", async () => {
  const f = fixture();
  try {
    // Explicit synthetic setup of the already-existing preferences API, never an action-created monitoring grant.
    await f.vela("preferences", {
      expectedVersion: 1,
      patch: {
        monitoringEnabled: true,
        delegationEnabled: false,
        allowedEventTypes: ["synthetic.attention"],
        minimumSeverity: "critical",
        maxInterruptionsPerHour: 1,
      },
    });
    const baseline = (await f.state()).preferences;
    const emit = (id: string) =>
      (f.core as any).vela.ingestAttention({
        id,
        type: "synthetic.attention",
        source: "synthetic-canonical-event",
        occurredAt: new Date().toISOString(),
        subject: null,
        severity: "critical",
        classification: "observed",
        summary: "Synthetic existing authorized event",
        correlationId: id,
      });
    await f.apply("quiet");
    assert.equal(emit("synthetic-quiet").disposition, "silent");
    await f.apply("focused");
    assert.equal(emit("synthetic-focused").disposition, "digest");
    await f.apply("normal");
    assert.equal(emit("synthetic-normal").disposition, "interrupt");
    await f.apply("proactive");
    assert.equal(emit("synthetic-budget").disposition, "digest");
    assert.deepEqual(
      authority((await f.state()).preferences),
      authority(baseline),
    );
    assert(
      (await f.state()).attention.every(
        (item) => item.reviewedAt === null && item.dismissedAt === null,
      ),
    );
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("current version metadata is read-only and pinned in the available catalog; stale, revoked or absent adapters cannot guess authority", async () => {
  const f = fixture();
  try {
    const core = f.core as any,
      service = core.vela,
      host = core.velaHost,
      originals = {
        atomic: core.atomic,
        save: core.save,
        snapshot: core.graph.snapshot,
        state: service.state,
      };
    const changes = f.db().prepare("SELECT total_changes() AS count").get()!
        .count,
      forbidden = () => {
        throw new Error("Metadata cannot snapshot/save/read full Vela state");
      };
    core.atomic = forbidden;
    core.save = forbidden;
    core.graph.snapshot = forbidden;
    service.state = forbidden;
    try {
      assert.equal(service.attentionPreferenceVersion(), 1);
      const descriptor = core
        .velaCapabilities(CAPABILITIES)
        .find((value: any) => value.id === "setAttentionMode");
      assert.deepEqual(descriptor.schema.properties.expectedVersion, {
        type: "integer",
        const: 1,
      });
      assert.equal(
        f.db().prepare("SELECT total_changes() AS count").get()!.count,
        changes,
      );
    } finally {
      core.atomic = originals.atomic;
      core.save = originals.save;
      core.graph.snapshot = originals.snapshot;
      service.state = originals.state;
    }
    const reviewed = await f.core.command("velaRequestPreview", {
        intent: "Synthetic prospective attention change",
        resourceIds: [],
      }),
      native = await f.core.command("velaNativeReview", {
        previewId: reviewed.id,
        signature: reviewed.signature,
      }),
      plan = await f.prepare("quiet");
    await f.vela("preferences", {
      expectedVersion: 1,
      patch: { maxInterruptionsPerHour: 2 },
    });
    await assert.rejects(f.vela("apply", plan.id), /stale_preference_version/);
    await assert.rejects(
      f.core.command("authorizeVelaRequest", {
        previewId: reviewed.id,
        signature: reviewed.signature,
        reviewDigest: native.reviewDigest,
      }),
      /stale_capability_catalog/,
    );
    const fresh = await f.prepare("quiet"),
      read = host.canReadAttentionPreferences;
    host.canReadAttentionPreferences = () => false;
    assert.equal(service.attentionPreferenceVersion(), null);
    assert.equal(
      (await f.state()).nativeCapabilities.setAttentionMode.available,
      false,
    );
    assert(
      !(await f.state()).capabilities.some(
        (item) => item.id === "setAttentionMode",
      ),
    );
    await assert.rejects(
      f.vela("apply", fresh.id),
      /attention_preferences_unavailable/,
    );
    host.canReadAttentionPreferences = undefined;
    assert.equal(service.attentionPreferenceVersion(), null);
    host.canReadAttentionPreferences = read;
    const context = core.velaContext.bind(core);
    core.velaContext = () => ({
      ...context(),
      principalId: "synthetic-foreign-principal",
    });
    assert.equal(service.attentionPreferenceVersion(), null);
    await assert.rejects(f.vela("apply", fresh.id), /stale_policy_version/);
    core.velaContext = context;
    const persisted = String(
      f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
    );
    f.db()
      .prepare(
        "UPDATE vela_state SET json=json_set(json,'$.preferences.version',999) WHERE id=1",
      )
      .run();
    assert.equal(
      service.attentionPreferenceVersion(),
      null,
      "An independently changed canonical version cannot expose a stale service version",
    );
    f.db().prepare("UPDATE vela_state SET json=? WHERE id=1").run(persisted);
    const scalarVersion = service.data.preferences.version;
    service.data.preferences.version = Number.MAX_SAFE_INTEGER;
    assert.equal(
      service.attentionPreferenceVersion(),
      null,
      "An overflowing next preference version is unavailable",
    );
    service.data.preferences.version = scalarVersion;
    await f.vela("cancel", fresh.requestId);
    await assert.rejects(
      f.vela("apply", fresh.id),
      /review_authorization_required/,
    );
    await assert.rejects(
      f.vela("attentionPreferenceVersion" as any),
      /unsupported_vela_command/,
    );
    for (const bad of [
      {
        type: "setAttentionMode",
        mode: "proactive",
        expectedVersion: 2,
        monitoringEnabled: true,
      },
      {
        type: "setAttentionMode",
        mode: "quiet",
        expectedVersion: 2,
        authorizationRef: "forged",
      },
      {
        type: "setAttentionMode",
        mode: "proactive",
        expectedVersion: 2,
        patch: { delegationEnabled: true },
      },
      {
        type: "setAttentionMode",
        mode: { toString: () => "quiet" },
        expectedVersion: 2,
      },
    ])
      assert.throws(() => validateAction(bad), /unsupported_or_invalid_action/);
    assert.equal((await f.state()).preferences.mode, "normal");
    assert.equal(f.connections(), 0);
  } finally {
    await f.close();
  }
});

test("a throw AFTER the real preference write restores SQLite/service/request/plan/receipt references and permits only a fresh explicit retry", async () => {
  const f = fixture();
  try {
    const before = (await f.state()).preferences,
      plan = await f.prepare("quiet"),
      core = f.core as any,
      native = core.velaNative,
      dispatch = native.dispatch;
    let observedWrite = false;
    native.dispatch = (input: any) => {
      const result = dispatch(input);
      if (input.action.type === "setAttentionMode") {
        observedWrite = true;
        assert.equal(
          core.vela.attentionPreferenceVersion(),
          before.version + 1,
        );
        assert.equal(
          JSON.parse(
            String(
              f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!
                .json,
            ),
          ).preferences.mode,
          "quiet",
        );
        throw new Error(
          "Synthetic failure after actual canonical attention write",
        );
      }
      return result;
    };
    const failed = (await f.vela("apply", plan.id)) as VelaPlan;
    native.dispatch = dispatch;
    assert(observedWrite);
    assert.equal(failed.state, "unknown");
    const retained = await f.state(),
      receipt = retained.receipts.find((item) => item.planId === plan.id)!;
    assert.deepEqual(retained.preferences, before);
    assert.equal(core.vela.attentionPreferenceVersion(), before.version);
    assert.deepEqual(
      JSON.parse(
        String(
          f.db().prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
        ),
      ).preferences,
      before,
    );
    assert.equal(
      retained.plans.find((item) => item.id === plan.id)!.state,
      "unknown",
    );
    assert.equal(
      retained.requests.find((item) => item.id === plan.requestId)!.state,
      "unknown",
    );
    assert.equal(receipt.state, "unknown");
    assert.equal(receipt.taskVerified, false);
    assert(retained.conversation!.messages.at(-1)!.content.includes("unknown"));
    await assert.rejects(
      f.vela("apply", plan.id),
      /review_authorization_required/,
    );
    const retry = await f.apply("quiet");
    assert.notEqual(retry.id, plan.id);
    assert.equal((await f.state()).preferences.version, before.version + 1);
    await f.reopen();
    const restored = await f.state();
    assert.equal(restored.preferences.mode, "quiet");
    assert.equal(restored.preferences.version, before.version + 1);
    assert.equal(
      restored.receipts.filter((item) => item.planId === plan.id).length,
      1,
    );
    assert.equal(
      restored.receipts.find((item) => item.planId === plan.id)!.state,
      "unknown",
    );
    assert.equal(f.connections(), 0);
    assert.deepEqual((await f.core.command("snapshot", {})).executions, {});
  } finally {
    await f.close();
  }
});
