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
import { NoteSession } from "../note-session.ts";
import type { NoteExperiencePort } from "../note-contracts.ts";

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

function sessionPort(f: ReturnType<typeof fixture>): NoteExperiencePort {
  return {
    readNote: async (id) => f.service.readNote(id),
    saveNoteDraft: async (input) => f.service.saveNoteDraft(input),
    commitNote: async (input) => f.service.commitNote(input),
    discardNoteDraft: async (input) => f.service.discardNoteDraft(input),
  };
}

test("editor recovers the durable draft and commits through the same canonical note service", async (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote(
    "Synthetic recovered editor",
    "Synthetic base",
  );
  const first = new NoteSession(note.id, sessionPort(f), {
    version: 1,
    content: "Synthetic base",
  });
  await first.edit("Synthetic durable typing");
  assert.equal(f.kernel.getResource(note.id).note.content, "Synthetic base");
  const restored = new NoteSession(note.id, sessionPort(f), {
    version: 1,
    content: "Synthetic base",
  });
  await restored.persist();
  assert.equal(restored.snapshot().phase, "recovered");
  assert.equal(restored.snapshot().content, "Synthetic durable typing");
  await restored.flush();
  assert.equal(
    f.kernel.getResource(note.id).note.content,
    "Synthetic durable typing",
  );
  assert.equal(f.service.readNote(note.id).draft, null);
});

test("typing during an in-flight canonical save is serialized without dropping the later text", async (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote(
      "Synthetic delayed editor",
      "Synthetic base",
    ),
    port = sessionPort(f);
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve)),
    started = new Promise<void>((resolve) => (entered = resolve));
  let calls = 0;
  const session = new NoteSession(
    note.id,
    {
      ...port,
      commitNote: async (input) => {
        const doc = f.service.commitNote(input);
        if (++calls === 1) {
          entered();
          await blocked;
        }
        return doc;
      },
    },
    { version: 1, content: "Synthetic base" },
  );
  await session.edit("Synthetic first");
  const saving = session.flush();
  await started;
  const later = session.edit("Synthetic second typed during save");
  release();
  await Promise.all([saving, later]);
  assert.equal(
    f.kernel.getResource(note.id).note.content,
    "Synthetic second typed during save",
  );
  assert.equal(f.kernel.getResource(note.id).resource.version, 3);
  assert.equal(session.snapshot().dirty, false);
});

test("a stale editor preserves local and canonical text until an explicit overwrite decision", async (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote("Synthetic stale editor", "Synthetic base"),
    session = new NoteSession(note.id, sessionPort(f), {
      version: 1,
      content: "Synthetic base",
    });
  await session.edit("Synthetic local work");
  f.host.updateNote({
    resourceId: note.id,
    expectedVersion: 1,
    content: "Synthetic external revision",
  });
  await assert.rejects(session.flush(), /note_version_conflict/);
  assert.equal(session.snapshot().phase, "conflict");
  assert.equal(session.snapshot().content, "Synthetic local work");
  assert.equal(
    session.snapshot().document?.resource.content,
    "Synthetic external revision",
  );
  await assert.rejects(
    session.edit("Synthetic retained conflict edit"),
    /note_revision_conflict/,
  );
  assert.equal(
    f.service.readNote(note.id).draft?.content,
    "Synthetic local work",
  );
  await session.keepLocal();
  assert.equal(
    f.kernel.getResource(note.id).note.content,
    "Synthetic retained conflict edit",
  );
  assert.equal(session.snapshot().phase, "saved");
});

test("competing draft writers cannot silently replace each other; explicit discard uses a fresh fence", async (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote(
      "Synthetic competing editor",
      "Synthetic base",
    ),
    session = new NoteSession(note.id, sessionPort(f), {
      version: 1,
      content: "Synthetic base",
    });
  await session.edit("Synthetic local draft");
  f.service.saveNoteDraft({
    resourceId: note.id,
    expectedDraftVersion: 1,
    baseResourceVersion: 1,
    content: "Synthetic other draft",
  });
  await assert.rejects(
    session.edit("Synthetic next local draft"),
    /note_draft_conflict/,
  );
  assert.equal(session.snapshot().content, "Synthetic next local draft");
  assert.equal(
    f.service.readNote(note.id).draft?.content,
    "Synthetic other draft",
  );
  await session.useSaved();
  assert.equal(session.snapshot().content, "Synthetic base");
  assert.equal(f.service.readNote(note.id).draft, null);
  assert.equal(f.kernel.getResource(note.id).resource.version, 1);
});

test("failed canonical save leaves a durable draft and can be retried after storage recovery", async (t) => {
  const f = fixture();
  t.after(() => f.kernel.close());
  const note = f.kernel.createNote("Synthetic failed editor", "Synthetic base"),
    session = new NoteSession(note.id, sessionPort(f), {
      version: 1,
      content: "Synthetic base",
    });
  await session.edit("Synthetic recoverable work");
  f.fail(true);
  await assert.rejects(session.flush(), /synthetic_note_save_failure/);
  assert.equal(
    f.service.readNote(note.id).draft?.content,
    "Synthetic recoverable work",
  );
  assert.equal(f.kernel.getResource(note.id).note.content, "Synthetic base");
  f.fail(false);
  await session.flush();
  assert.equal(
    f.kernel.getResource(note.id).note.content,
    "Synthetic recoverable work",
  );
});
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
