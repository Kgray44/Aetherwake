import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { NoteExperienceService } from "../note-service.mts";
import type { CanonicalNoteHost } from "../note-contracts.ts";
import type { DatabaseSync } from "node:sqlite";

function fixture(path = ":memory:") {
  const kernel = WorkspaceKernel.open(path),
    db = kernel.withTransaction((db) => db),
    desktop = new DesktopState(kernel, db),
    revoked = new Set<string>();
  let fail = false;
  const host: CanonicalNoteHost<DatabaseSync> = {
    db,
    atomic: (work) => kernel.withTransaction(work),
    readResource(id) {
      const entry = kernel.getResource(id),
        r = entry.resource;
      return {
        authorized: !revoked.has(id),
        resource: {
          id: r.id,
          title: r.title,
          kind: r.kind === "note" ? "note" : "conversation",
          version: r.version,
          content: entry.note?.content ?? "",
          state: r.state,
          project_id: r.project_id,
          provider: "local",
          messages: [],
        },
      };
    },
    updateNote(input) {
      desktop.apply(
        {
          type: "content",
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          content: input.content,
        },
        () => {
          throw new Error("unexpected");
        },
      );
      if (fail) throw new Error("synthetic_note_save_failure");
    },
  };
  return {
    kernel,
    db,
    host,
    revoked,
    service: new NoteExperienceService(db, host),
    fail(value: boolean) {
      fail = value;
    },
  };
}
test("durable unsaved text and monotonic draft versions survive restart without replacing canonical note content", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "aerynth-note-draft-")),
    path = join(directory, "synthetic.sqlite");
  let f = fixture(path);
  t.after(() => {
    f.kernel.close();
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + "\\"));
    rmSync(target, { recursive: true, force: true });
  });
  const note = f.kernel.createNote(
      "Synthetic draft source",
      "Synthetic canonical text",
    ),
    draft = f.service.saveNoteDraft({
      resourceId: note.id,
      expectedDraftVersion: 0,
      baseResourceVersion: 1,
      content: "Synthetic unsaved work",
    });
  assert.equal(
    f.kernel.getResource(note.id).note.content,
    "Synthetic canonical text",
  );
  f.kernel.close();
  f = fixture(path);
  assert.deepEqual(f.service.readNote(note.id).draft, draft);
  const saved = f.service.commitNote({
    resourceId: note.id,
    expectedResourceVersion: 1,
    expectedDraftVersion: 1,
    content: draft.content,
  });
  assert.equal(saved.resource.content, "Synthetic unsaved work");
  assert.equal(saved.resource.version, 2);
  assert.equal(saved.draft, null);
  assert.equal(saved.draftRevision, 2);
  f.kernel.close();
  f = fixture(path);
  assert.equal(f.service.readNote(note.id).draftRevision, 2);
  assert.equal(f.service.readNote(note.id).resource.content, draft.content);
});
test("stale canonical content and competing editor drafts are preserved for explicit conflict recovery", (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote(
    "Synthetic conflict source",
    "Synthetic base",
  );
  f.service.saveNoteDraft({
    resourceId: note.id,
    expectedDraftVersion: 0,
    baseResourceVersion: 1,
    content: "Synthetic local text",
  });
  f.kernel.updateNote(note.id, "Synthetic other editor text", 1);
  assert.equal(f.service.readNote(note.id).conflict, true);
  assert.throws(
    () =>
      f.service.commitNote({
        resourceId: note.id,
        expectedResourceVersion: 1,
        expectedDraftVersion: 1,
        content: "Synthetic local text",
      }),
    /note_version_conflict/,
  );
  assert.equal(
    f.service.readNote(note.id).draft?.content,
    "Synthetic local text",
  );
  assert.equal(
    f.kernel.getResource(note.id).note.content,
    "Synthetic other editor text",
  );
  assert.throws(
    () =>
      f.service.saveNoteDraft({
        resourceId: note.id,
        expectedDraftVersion: 0,
        baseResourceVersion: 2,
        content: "Synthetic stale editor",
      }),
    /note_draft_conflict/,
  );
  const rebased = f.service.saveNoteDraft({
    resourceId: note.id,
    expectedDraftVersion: 1,
    baseResourceVersion: 2,
    content: "Synthetic explicitly recovered text",
  });
  const saved = f.service.commitNote({
    resourceId: note.id,
    expectedResourceVersion: 2,
    expectedDraftVersion: rebased.version,
    content: rebased.content,
  });
  assert.equal(saved.resource.content, rebased.content);
  assert.equal(saved.conflict, false);
});
test("failed canonical commit rolls back both text and draft clock; clearing a draft cannot create an ABA overwrite", (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote("Synthetic atomic source", "Synthetic base");
  f.service.saveNoteDraft({
    resourceId: note.id,
    expectedDraftVersion: 0,
    baseResourceVersion: 1,
    content: "Synthetic first draft",
  });
  f.fail(true);
  assert.throws(
    () =>
      f.service.commitNote({
        resourceId: note.id,
        expectedResourceVersion: 1,
        expectedDraftVersion: 1,
        content: "Synthetic first draft",
      }),
    /synthetic_note_save_failure/,
  );
  assert.equal(f.kernel.getResource(note.id).note.content, "Synthetic base");
  assert.equal(f.service.readNote(note.id).draftRevision, 1);
  assert.equal(
    f.service.readNote(note.id).draft?.content,
    "Synthetic first draft",
  );
  f.fail(false);
  f.service.commitNote({
    resourceId: note.id,
    expectedResourceVersion: 1,
    expectedDraftVersion: 1,
    content: "Synthetic first draft",
  });
  f.service.saveNoteDraft({
    resourceId: note.id,
    expectedDraftVersion: 2,
    baseResourceVersion: 2,
    content: "Synthetic newer draft",
  });
  assert.throws(
    () =>
      f.service.saveNoteDraft({
        resourceId: note.id,
        expectedDraftVersion: 1,
        baseResourceVersion: 1,
        content: "Synthetic old tab text",
      }),
    /note_draft_conflict/,
  );
  assert.equal(
    f.service.readNote(note.id).draft?.content,
    "Synthetic newer draft",
  );
});
test("revoked/archived notes fail closed without discarding recovery text; incompatible kinds and payloads are rejected", (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote("Synthetic private draft", "");
  f.service.saveNoteDraft({
    resourceId: note.id,
    expectedDraftVersion: 0,
    baseResourceVersion: 1,
    content: "Synthetic retained recovery text",
  });
  f.revoked.add(note.id);
  assert.throws(() => f.service.readNote(note.id), /note_unavailable/);
  f.revoked.clear();
  f.kernel.setResourceArchived(note.id, true, 1);
  assert.throws(() => f.service.readNote(note.id), /note_unavailable/);
  assert.equal(
    f.db
      .prepare("SELECT content FROM block_note_drafts WHERE resource_id=?")
      .get(note.id)?.content,
    "Synthetic retained recovery text",
  );
  const conversation = f.kernel.createConversationRef("Synthetic nonnote");
  assert.throws(
    () => f.service.readNote(conversation.id),
    /note_kind_required/,
  );
  assert.throws(
    () =>
      f.service.saveNoteDraft({
        resourceId: note.id,
        expectedDraftVersion: 1,
        baseResourceVersion: 1,
        content: "x".repeat(100001),
      }),
    /note_content_too_large/,
  );
  assert.throws(
    () =>
      f.service.renameNote({
        resourceId: conversation.id,
        expectedResourceVersion: 1,
        title: "Synthetic name",
      }),
    /note_kind_required/,
  );
});
