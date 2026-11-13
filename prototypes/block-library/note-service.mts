import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type {
  CanonicalNoteHost,
  NoteDocument,
  NoteDraft,
  SaveNoteDraft,
  CommitNote,
  CaptureConversationReply,
  ReplyNoteHost,
  ReplyNoteReceipt,
} from "./note-contracts.ts";
import { check, identifier, text, version } from "./model.ts";
const content = (value: unknown): string => {
  check(
    typeof value === "string" && Buffer.byteLength(value) <= 100000,
    "note_content_too_large",
  );
  return value;
};
const revision = (value: unknown): number => {
  check(
    Number.isSafeInteger(value) && Number(value) >= 0,
    "invalid_draft_version",
  );
  return Number(value);
};
const fields = (input: unknown, keys: string[]) =>
  check(
    input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).every((k) => keys.includes(k)),
    "invalid_note_command",
  );

/** Unsaved recovery text only. Canonical note content and versions remain in the existing note service. */
export class NoteExperienceService {
  private db: DatabaseSync;
  private host: CanonicalNoteHost<DatabaseSync>;
  constructor(db: DatabaseSync, host: CanonicalNoteHost<DatabaseSync>) {
    this.db = db;
    this.host = host;
    check(host.db === db, "canonical_connection_required");
    host.atomic(() =>
      db.exec(
        "CREATE TABLE IF NOT EXISTS block_note_drafts(resource_id TEXT PRIMARY KEY,version INTEGER NOT NULL,base_version INTEGER NOT NULL,content TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE IF NOT EXISTS block_note_draft_revisions(resource_id TEXT PRIMARY KEY,version INTEGER NOT NULL);INSERT OR IGNORE INTO block_note_draft_revisions SELECT resource_id,version FROM block_note_drafts;",
      ),
    );
  }
  /** Explicit copy. The note owns its editable text after capture. */
  captureConversationReply(input: CaptureConversationReply, host: ReplyNoteHost): ReplyNoteReceipt {
    fields(input, ["resourceId", "messageId", "commandId"]);
    const resourceId = identifier(input.resourceId), messageId = identifier(input.messageId);
    const commandId = identifier(input.commandId);
    check(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/.test(commandId), "invalid_command_id");
    return this.host.atomic(() => {
      const reply = host.resolveReply(resourceId, messageId);
      check(reply?.resourceId === resourceId && reply.messageId === messageId, "source_unavailable");
      check(Number.isSafeInteger(reply.sequence) && reply.sequence >= 1, "source_unavailable");
      const body = content(reply.content);
      check(body.trim(), "empty_conversation_reply");
      const digest = createHash("sha256").update(body).digest("hex");
      const source = { resourceId, messageId, sequence: reply.sequence, digest };
      this.db.exec(`CREATE TABLE IF NOT EXISTS note_reply_captures (
        command_id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL UNIQUE REFERENCES resources(id) ON DELETE CASCADE,
        source_resource_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        source_sequence INTEGER NOT NULL,
        source_digest TEXT NOT NULL
      ) STRICT`);
      const prior = this.db.prepare("SELECT * FROM note_reply_captures WHERE command_id=?").get(commandId);
      if (prior) {
        check(prior.source_resource_id === resourceId && prior.source_message_id === messageId &&
          prior.source_sequence === reply.sequence && prior.source_digest === digest, "reply_capture_command_conflict");
        const noteId = String(prior.note_id);
        this.resource(noteId);
        return { noteId, source };
      }
      const noteId = identifier(host.createNote({ title: "Saved chat reply", content: body, projectId: reply.projectId }));
      const saved = this.resource(noteId);
      check(saved.kind === "note" && saved.content === body && saved.project_id === reply.projectId, "reply_note_creation_unconfirmed");
      this.db.prepare(`INSERT INTO note_reply_captures
        (command_id, note_id, source_resource_id, source_message_id, source_sequence, source_digest)
        VALUES (?,?,?,?,?,?)`).run(commandId, noteId, resourceId, messageId, reply.sequence, digest);
      return { noteId, source };
    });
  }
  private resource(id: string) {
    const item = this.host.readResource(identifier(id));
    check(
      item?.authorized &&
        item.resource.available !== false &&
        item.resource.visible !== false &&
        item.resource.state !== "archived",
      "note_unavailable",
    );
    check(
      ["note", "research", "reference", "task", "task_group"].includes(
        item.resource.kind,
      ),
      "note_kind_required",
    );
    return item.resource;
  }
  private draft(id: string): NoteDraft | null {
    const row = this.db
      .prepare("SELECT * FROM block_note_drafts WHERE resource_id=?")
      .get(id);
    return row
      ? {
          version: Number(row.version),
          baseResourceVersion: Number(row.base_version),
          content: String(row.content),
          updatedAt: String(row.updated_at),
        }
      : null;
  }
  private draftRevision(resourceId: string): number {
    return Number(
      this.db
        .prepare(
          "SELECT version FROM block_note_draft_revisions WHERE resource_id=?",
        )
        .get(resourceId)?.version ?? 0,
    );
  }
  private advance(resourceId: string): number {
    const previous = this.draftRevision(resourceId);
    if (previous === 0)
      check(
        Number(
          this.db
            .prepare("SELECT count(*) AS n FROM block_note_draft_revisions")
            .get()!.n,
        ) < 8192,
        "note_draft_capacity_reached",
      );
    const next = previous + 1;
    check(Number.isSafeInteger(next), "note_draft_version_exhausted");
    this.db
      .prepare(
        "INSERT INTO block_note_draft_revisions VALUES(?,?) ON CONFLICT(resource_id) DO UPDATE SET version=excluded.version",
      )
      .run(resourceId, next);
    return next;
  }
  readNote(resourceId: string): NoteDocument {
    const r = this.resource(resourceId),
      draft = this.draft(resourceId);
    return {
      resource: {
        id: r.id,
        kind: r.kind,
        title: r.title,
        version: r.version,
        content: r.content,
        project_id: r.project_id,
      },
      draft,
      draftRevision: this.draftRevision(resourceId),
      conflict: !!draft && draft.baseResourceVersion !== r.version,
      canRename: !!this.host.renameNote,
    };
  }
  saveNoteDraft(input: SaveNoteDraft): NoteDraft {
    fields(input, [
      "resourceId",
      "expectedDraftVersion",
      "baseResourceVersion",
      "content",
    ]);
    const value = content(input.content);
    revision(input.expectedDraftVersion);
    version(input.baseResourceVersion);
    return this.host.atomic(() => {
      const r = this.resource(input.resourceId),
        old = this.draft(r.id);
      check(
        this.draftRevision(r.id) === input.expectedDraftVersion,
        "note_draft_conflict",
      );
      check(input.baseResourceVersion <= r.version, "invalid_draft_base");
      // Preserve stale-base drafts for explicit conflict recovery; saving a draft never overwrites canonical text.
      if (!old)
        check(
          Number(
            this.db
              .prepare("SELECT count(*) AS n FROM block_note_drafts")
              .get()!.n,
          ) < 8192,
          "note_draft_capacity_reached",
        );
      const bytes = Number(
        this.db
          .prepare(
            "SELECT coalesce(sum(length(cast(content AS BLOB))),0) AS n FROM block_note_drafts WHERE resource_id<>?",
          )
          .get(r.id)!.n,
      );
      check(
        bytes + Buffer.byteLength(value) <= 33554432,
        "note_draft_storage_capacity_reached",
      );
      const result = {
        version: this.advance(r.id),
        baseResourceVersion: input.baseResourceVersion,
        content: value,
        updatedAt: new Date().toISOString(),
      };
      this.db
        .prepare(
          "INSERT INTO block_note_drafts VALUES(?,?,?,?,?) ON CONFLICT(resource_id) DO UPDATE SET version=excluded.version,base_version=excluded.base_version,content=excluded.content,updated_at=excluded.updated_at",
        )
        .run(
          r.id,
          result.version,
          result.baseResourceVersion,
          result.content,
          result.updatedAt,
        );
      return result;
    });
  }
  commitNote(input: CommitNote): NoteDocument {
    fields(input, [
      "resourceId",
      "expectedResourceVersion",
      "expectedDraftVersion",
      "content",
    ]);
    const value = content(input.content);
    version(input.expectedResourceVersion);
    revision(input.expectedDraftVersion);
    return this.host.atomic(() => {
      const r = this.resource(input.resourceId),
        draft = this.draft(r.id);
      check(
        r.version === input.expectedResourceVersion,
        "note_version_conflict",
      );
      check(
        this.draftRevision(r.id) === input.expectedDraftVersion,
        "note_draft_conflict",
      );
      check(!draft || draft.content === value, "note_draft_content_changed");
      const result: unknown = this.host.updateNote({
        resourceId: r.id,
        expectedVersion: r.version,
        content: value,
      });
      check(!(result instanceof Promise), "synchronous_host_required");
      this.db
        .prepare("DELETE FROM block_note_drafts WHERE resource_id=?")
        .run(r.id);
      this.advance(r.id);
      return this.readNote(r.id);
    });
  }
  discardNoteDraft(input: {
    resourceId: string;
    expectedDraftVersion: number;
  }): NoteDocument {
    fields(input, ["resourceId", "expectedDraftVersion"]);
    revision(input.expectedDraftVersion);
    return this.host.atomic(() => {
      const r = this.resource(input.resourceId);
      check(
        this.draftRevision(r.id) === input.expectedDraftVersion,
        "note_draft_conflict",
      );
      this.db
        .prepare("DELETE FROM block_note_drafts WHERE resource_id=?")
        .run(r.id);
      this.advance(r.id);
      return this.readNote(r.id);
    });
  }
  renameNote(input: {
    resourceId: string;
    expectedResourceVersion: number;
    title: string;
  }): NoteDocument {
    fields(input, ["resourceId", "expectedResourceVersion", "title"]);
    const title = text(input.title);
    version(input.expectedResourceVersion);
    return this.host.atomic(() => {
      const r = this.resource(input.resourceId);
      check(
        r.version === input.expectedResourceVersion,
        "note_version_conflict",
      );
      check(this.host.renameNote, "note_rename_unavailable");
      const result: unknown = this.host.renameNote({
        resourceId: r.id,
        expectedVersion: r.version,
        title,
      });
      check(!(result instanceof Promise), "synchronous_host_required");
      return this.readNote(r.id);
    });
  }
}
