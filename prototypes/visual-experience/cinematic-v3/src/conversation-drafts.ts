import {
  ConversationDraftSession,
  flushConversationDraftSessions,
} from "../../../conversation-product/src/draft-session.ts";
import type { ConversationProductPort } from "../../../conversation-product/src/contracts.ts";

/** Shares one draft session across placements of the same canonical conversation. */
export function createConversationDrafts(options: {
  port: ConversationProductPort;
  available(resourceId: string): boolean;
  changed(resourceId: string): void;
}) {
  const sessions = new Map<string, ConversationDraftSession>();
  return {
    get(resourceId: string) {
      const existing = sessions.get(resourceId);
      if (existing) return existing;
      if (!options.available(resourceId))
        throw new Error("conversation_unavailable");
      const session = new ConversationDraftSession({
        resourceId,
        port: options.port,
        onChange: () => options.changed(resourceId),
      });
      sessions.set(resourceId, session);
      return session;
    },
    flush: () => flushConversationDraftSessions(() => sessions.values()),
    isClean: () =>
      [...sessions.values()].every(
        (session) => session.snapshot().phase === "clean",
      ),
    hasPendingEdits() {
      for (const session of sessions.values()) {
        const { phase, editRevision } = session.snapshot();
        if (
          phase === "dirty" ||
          phase === "saving" ||
          phase === "conflict" ||
          (phase === "error" && editRevision > 0)
        )
          return true;
      }
      return false;
    },
    reload(report: (error: unknown) => void) {
      for (const session of sessions.values())
        void session.reload().catch(report);
    },
    async recoverStorage(report: (error: unknown) => void) {
      for (const session of sessions.values()) {
        if (session.snapshot().error !== "storage_reserve_admission_denied")
          continue;
        // Reload first so an intervening save is surfaced as a conflict.
        try {
          await session.reload();
          if (session.snapshot().phase === "dirty") await session.flush();
        } catch (error) {
          report(error);
        }
      }
    },
  };
}
