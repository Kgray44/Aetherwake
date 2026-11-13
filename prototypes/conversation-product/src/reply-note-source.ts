import type { Message } from '../../connected-conversations/src/graph.ts';
import type { ReplyNoteHost } from '../../block-library/note-contracts.ts';

export interface ReplyNoteSourceOwner {
  readScope(resourceId: string, messageId: string): { graphId: string; projectId: string | null } | null;
  readOwnMessage(graphId: string, messageId: string):
    Pick<Message, 'id' | 'conversationId' | 'role' | 'sequence' | 'content' | 'sensitivity'> | null;
}

/** Called in the same owner transaction as note creation. Scope resolves before reading message text. */
export const resolveReplyNoteSource = (
  owner: ReplyNoteSourceOwner,
  resourceId: string,
  messageId: string,
): ReturnType<ReplyNoteHost['resolveReply']> => {
  const scope = owner.readScope(resourceId, messageId);
  if (!scope) return null;
  const message = owner.readOwnMessage(scope.graphId, messageId);
  if (!message || message.id !== messageId || message.conversationId !== scope.graphId ||
      message.role !== 'assistant' || message.sensitivity === 'restricted') return null;
  return { resourceId, messageId, sequence: message.sequence, content: message.content, projectId: scope.projectId };
};
