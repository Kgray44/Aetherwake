import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '../../connected-conversations/src/graph.ts';
import type { PersonalContextHost } from '../../personal-context/src/contracts.ts';

interface CanonicalSources {
  db: DatabaseSync;
  projectAccess(id: string): boolean;
  conversationAccess(id: string, messageId?: string): boolean;
  readOwnMessage(conversationId: string, messageId: string): Message | null;
}

/** Read proofs from the workspace kernel and conversation owner within the
 * caller's canonical transaction. No private message body leaves this reader. */
export function createPersonalMemorySourceReader(sources: CanonicalSources): Required<Pick<PersonalContextHost, 'resolveScope' | 'resolveConversationSource'>> {
  const project = sources.db.prepare("SELECT version FROM projects WHERE id=? AND state='active'");
  const conversation = sources.db.prepare("SELECT version,project_id FROM resources WHERE id=? AND kind='conversation' AND state='active'");
  function currentConversation(id: string) {
    const row = conversation.get(id);
    if (!row || !sources.conversationAccess(id)) return null;
    const projectId = row.project_id === null ? null : String(row.project_id);
    if (projectId !== null && (!project.get(projectId) || !sources.projectAccess(projectId))) return null;
    return { version: String(row.version), projectId };
  }
  return {
    resolveScope(scope) {
      if (scope.kind === 'project') {
        const row = project.get(scope.id);
        return row && sources.projectAccess(scope.id) ? { scope, version: String(row.version) } : null;
      }
      if (scope.kind === 'conversation') {
        const current = currentConversation(scope.id);
        return current ? { scope, version: current.version } : null;
      }
      return { scope, version: '1' };
    },
    resolveConversationSource({ conversationId, messageId }) {
      const current = currentConversation(conversationId);
      if (!current || !sources.conversationAccess(conversationId, messageId)) return null;
      const message = sources.readOwnMessage(conversationId, messageId);
      if (!message || message.id !== messageId || message.role !== 'user' ||
        message.provenance !== 'user' || message.sensitivity === 'restricted') return null;
      return {
        conversationId, messageId, projectId: current.projectId, version: String(message.sequence),
        contentDigest: createHash('sha256').update(message.content).digest('hex'),
        role: message.role, sensitive: message.sensitivity === 'sensitive',
      };
    },
  };
}
