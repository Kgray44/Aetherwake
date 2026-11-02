import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceKernel } from "../workspace-kernel/kernel.mts";
import type { CanonicalTemplateHost } from "./contracts.ts";
import type { CanonicalNoteHost } from "./note-contracts.ts";
import type { DesktopCommand } from "../application-contract/contracts.ts";
import { check } from "./model.ts";

export function createCanonicalNoteHost(options: {
  db: DatabaseSync;
  kernel: WorkspaceKernel;
  templateHost: CanonicalTemplateHost<DatabaseSync>;
  atomic<T>(work: () => T): T;
  applyDesktopCommand(command: DesktopCommand): void;
  renameResource?(input: {
    resourceId: string;
    expectedVersion: number;
    title: string;
  }): void;
}): CanonicalNoteHost<DatabaseSync> {
  check(
    options.templateHost.db === options.db,
    "canonical_connection_required",
  );
  options.kernel.withTransaction((db) =>
    check(db === options.db, "canonical_connection_required"),
  );
  return {
    db: options.db,
    atomic: options.atomic,
    readResource(resourceId) {
      const metadata = options.templateHost.readResource(resourceId);
      if (!metadata?.authorized || metadata.state !== "active") return null;
      const entry = options.kernel.getResource(resourceId),
        r = entry.resource;
      return {
        authorized: true,
        resource: {
          id: r.id,
          title: r.title,
          kind: metadata.kind,
          version: r.version,
          content: entry.note?.content ?? "",
          project_id: r.project_id,
          state: r.state,
          available: true,
          visible: true,
          provider: "local",
          messages: [],
        },
      };
    },
    updateNote(input) {
      options.applyDesktopCommand({
        type: "content",
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        content: input.content,
      });
    },
    ...(options.renameResource ? { renameNote: options.renameResource } : {}),
  };
}
