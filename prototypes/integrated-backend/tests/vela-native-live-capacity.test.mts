import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { BackendCore } from "../src/core.mts";
import type { ProviderPort } from "../src/contracts.mts";

/** Evaluate only the helper's known string-concatenation grammar, never require/execute the GUI helper. */
function livePayload(projectId: string, chatId: string, noteId: string) {
  const helper = readFileSync(
      new URL("../../vela-core/test/native-live.cjs", import.meta.url),
      "utf8",
    ),
    token = "syntest1";
  const names = {
    project: "Synthetic Vela live project " + token,
    origin: "Synthetic Vela source workspace " + token,
    chat: "Synthetic Vela source chat " + token,
    note: "Synthetic Vela source note " + token,
    target: "Synthetic Vela planned workspace " + token,
  };
  for (const [key, prefix] of Object.entries({
    project: "Synthetic Vela live project ",
    origin: "Synthetic Vela source workspace ",
    chat: "Synthetic Vela source chat ",
    note: "Synthetic Vela source note ",
    target: "Synthetic Vela planned workspace ",
  }))
    assert(helper.includes(key + ":'" + prefix + "'+token"));
  assert(
    helper.includes(
      "const sourceChat='Synthetic local source message '+token+'.'",
    ),
  );
  assert(
    helper.includes(
      "sourceNote='# Synthetic live Vela source\\n\\nSelected note marker '+token+'.'",
    ),
  );
  const line = helper
    .split(/\r?\n/)
    .find((value) =>
      value
        .trim()
        .startsWith(
          "const intent='Propose exactly one workspaceFromResources action",
        ),
    );
  assert(line);
  const expression = line.trim().slice("const intent=".length, -1),
    pieces = expression.match(
      /'[^'\\]*'|JSON\.stringify\(names\.(?:target|project)\)|(?:project|localChat|localNote)\.id/g,
    );
  assert(pieces);
  assert.equal(
    pieces.join("+"),
    expression.replace(/\s*\+\s*/g, "+"),
    "A changed helper expression must be audited before it can qualify this fixture",
  );
  const values: Record<string, string> = {
    "JSON.stringify(names.target)": JSON.stringify(names.target),
    "JSON.stringify(names.project)": JSON.stringify(names.project),
    "project.id": projectId,
    "localChat.id": chatId,
    "localNote.id": noteId,
  };
  const intent = pieces
    .map((piece) =>
      piece.startsWith("'") ? piece.slice(1, -1) : values[piece],
    )
    .join("");
  return {
    names,
    intent,
    sourceChat: "Synthetic local source message " + token + ".",
    sourceNote:
      "# Synthetic live Vela source\n\nSelected note marker " + token + ".",
  };
}

for (const authenticated of [false, true])
  test(`exact native-live ${authenticated ? 29 : 28}-capability complete catalog fits with full source/context and no provider or preview writes`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "aerynth-vela-live-budget-")),
      file = join(dir, "canonical.sqlite");
    let core: BackendCore | undefined,
      connections = 0;
    try {
      core = new BackendCore({
        path: file,
        privateRoot: dir,
        cwd: dir,
        provider: "codex",
        contentPolicy: "local-private",
        velaCatalogDiscovery: false,
        velaHistoryContext: false,
      });
      const internal = core as any,
        db = internal.db as DatabaseSync,
        port = internal.port as ProviderPort;
      port.connect = async () => {
        connections++;
        throw new Error(
          "Capacity fixture must never connect/authenticate/contact a provider",
        );
      };
      const names = livePayload("", "", "").names;
      let desktop = await core.command("desktop", {
        type: "createProject",
        title: names.project,
      });
      const project = desktop.projects.find(
        (value) => value.title === names.project,
      )!;
      desktop = await core.command("desktop", {
        type: "createWorkspace",
        title: names.origin,
        projectId: project.id,
      });
      const workspaceId = desktop.activeWorkspaceId!;
      let created = await core.command("library", {
        name: "createBlock",
        input: {
          commandId: "budget-create-chat",
          workspaceId,
          expectedLayoutVersion: desktop.layoutVersion!,
          kind: "conversation",
          title: names.chat,
          provider: "local",
        },
      });
      const chatId = (created.result as { resourceId: string }).resourceId,
        payload = livePayload(project.id, chatId, "");
      await core.command("conversation", {
        name: "send",
        input: {
          resourceId: chatId,
          content: payload.sourceChat,
          expectedRevision: 1,
          commandId: "budget-local-source",
        },
      });
      desktop = await core.command("desktop", { type: "snapshot" });
      created = await core.command("library", {
        name: "createBlock",
        input: {
          commandId: "budget-create-note",
          workspaceId,
          expectedLayoutVersion: desktop.layoutVersion!,
          kind: "note",
          title: names.note,
        },
      });
      const noteId = (created.result as { resourceId: string }).resourceId,
        exact = livePayload(project.id, chatId, noteId);
      await core.command("notes", {
        name: "saveNoteDraft",
        input: {
          resourceId: noteId,
          expectedDraftVersion: 0,
          baseResourceVersion: 1,
          content: exact.sourceNote,
        },
      });
      await core.command("notes", {
        name: "commitNote",
        input: {
          resourceId: noteId,
          expectedResourceVersion: 1,
          expectedDraftVersion: 1,
          content: exact.sourceNote,
        },
      });
      await core.command("vela", { name: "open", input: {} });
      // Explicit synthetic capability observation, not an authentication claim or native/provider probe.
      if (authenticated)
        internal.capabilityCache.observe({
          providerId: "codex-app-server",
          mock: false,
          authentication: "available",
          models: [],
          catalogOnly: true,
          nativeFork: false,
          chatgptHistory: false,
        });
      const changes = db.prepare("SELECT total_changes() AS count").get()!
          .count,
        stored = String(
          db.prepare("SELECT json FROM integration_state WHERE id=1").get()!
            .json,
        ),
        velaStored = String(
          db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
        );
      const preview = await core.command("velaRequestPreview", {
          intent: exact.intent,
          resourceIds: [chatId, noteId],
        }),
        review = await core.command("velaNativeReview", {
          previewId: preview.id,
          signature: preview.signature,
        }),
        data = JSON.parse(review.prompt.split("\n").at(-1)!);
      assert.equal(Buffer.byteLength(exact.intent), 669);
      assert.equal(Buffer.byteLength(exact.sourceChat), 40);
      assert.equal(Buffer.byteLength(exact.sourceNote), 60);
      assert.equal(data.capabilities.length, authenticated ? 29 : 28);
      assert.equal(data.schemaAvailability, "complete-approved-catalog");
      assert(!data.capabilityDiscovery);
      assert(!data.context.history);
      assert(!review.history);
      assert.deepEqual(data.context, review.context);
      assert.deepEqual(review.context, preview.context);
      assert.equal(
        review.context.included.find((ref) => ref.id === noteId)!.content,
        exact.sourceNote,
      );
      const chatContent = review.context.included.find(
        (ref) => ref.id === chatId,
      )!.content;
      assert.equal(
        JSON.parse(chatContent).messages[0].content,
        exact.sourceChat,
      );
      assert.equal(Buffer.byteLength(chatContent), 209);
      assert.equal(review.context.contentBytes, 269);
      assert.equal(review.context.discovered.length, 4);
      assert.equal(review.context.included.length, 2);
      assert(
        review.context.discovered.some(
          (ref) => ref.id === project.id && ref.kind === "project",
        ),
      );
      assert(
        review.context.discovered.some(
          (ref) => ref.id === workspaceId && ref.kind === "workspace",
        ),
      );
      assert(Buffer.byteLength(review.prompt) <= 16384);
      assert.equal(
        db.prepare("SELECT total_changes() AS count").get()!.count,
        changes,
      );
      const previews = internal.velaPreviews.size;
      await assert.rejects(
        core.command("velaRequestPreview", {
          intent: exact.intent + " Synthetic overcapacity padding ".repeat(250),
          resourceIds: [chatId, noteId],
        }),
        /planning_prompt_capacity_exceeded/,
      );
      assert.equal(
        db.prepare("SELECT total_changes() AS count").get()!.count,
        changes,
      );
      assert.equal(internal.velaPreviews.size, previews);
      assert.equal(internal.velaGrants.size, 0);
      assert.equal(
        String(
          db.prepare("SELECT json FROM integration_state WHERE id=1").get()!
            .json,
        ),
        stored,
      );
      assert.equal(
        String(
          db.prepare("SELECT json FROM vela_state WHERE id=1").get()!.json,
        ),
        velaStored,
      );
      assert.equal(connections, 0);
      assert.deepEqual((await core.command("snapshot", {})).executions, {});
      t.diagnostic(
        JSON.stringify({
          evidence:
            "synthetic-actual-Core-SQLite-native-live-payload-no-provider",
          capabilities: data.capabilities.length,
          intentBytes: Buffer.byteLength(exact.intent),
          sourceChatBytes: 40,
          sourceNoteBytes: 60,
          contextBytes: Buffer.byteLength(JSON.stringify(review.context)),
          promptBytes: Buffer.byteLength(review.prompt),
          ceiling: 16384,
          headroom: 16384 - Buffer.byteLength(review.prompt),
          history: false,
          discovery: false,
          providerConnections: connections,
          sqliteChangesDuringBothPreviews: 0,
          assumptions:
            "8-character native helper token, UUID resource/project/workspace IDs, one local chat message, one committed note, initial layout version; real UI revision digits can vary",
        }),
      );
    } finally {
      if (core) await core.command("close", {});
      const part = relative(resolve(tmpdir()), resolve(dir));
      assert(
        part.startsWith("aerynth-vela-live-budget-") &&
          !part.startsWith("..") &&
          !isAbsolute(part),
      );
      rmSync(resolve(dir), { recursive: true, force: true });
    }
  });
