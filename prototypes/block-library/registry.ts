import type { BlockDefinition, BlockKind, LibraryCapabilities, Availability, CreateBlockInput, Presentation } from './contracts.ts';
import { presentation } from '../workspace-engine/geometry.mts';

const define = (kind: BlockKind, title: string, category: BlockDefinition['category'], description: string, controls: string[], preview: string, providerRequirement: BlockDefinition['providerRequirement'] = 'canonical-local'): BlockDefinition => ({
  kind, title, category, description, controls, preview, providerRequirement,
  keywords: [kind, title, category, ...controls], defaultPresentation: presentation({ shape: kind === 'note' ? 'folio' : 'rounded', width: 400, height: 280 }),
});
/** Every entry maps to an implemented canonical desktop kind. This is not a future feature catalog. */
export const BUILTIN_BLOCKS: readonly BlockDefinition[] = Object.freeze([
  define('conversation', 'Conversation', 'conversation', 'A canonical conversation with its existing messages, composer and provider controls.', ['Read messages', 'Send through connected provider', 'Open conversation'], 'An empty conversation. Sending requires an available provider; no response is simulated.', 'conversation-provider'),
  define('note', 'Note', 'knowledge', 'A persistent note using the canonical editor.', ['Edit text', 'Open note', 'Reference in another workspace'], 'A blank editable note. The same resource remains editable from each placement.'),
  define('research', 'Research', 'knowledge', 'A research note for sources, findings and unresolved questions.', ['Edit research', 'Link resources', 'Open note'], 'A blank research note. It does not perform an automatic investigation.'),
  define('task', 'Task', 'planning', 'A persistent task with canonical open and done controls.', ['Edit task', 'Set open or done', 'Open task'], 'An open task. Status records your change; it does not claim verified agent execution.'),
  define('task_group', 'Task group', 'planning', 'A collection of canonical task references, with membership managed by the host.', ['Manage task members', 'Inspect member status', 'Open task'], 'An empty group. Adding a task references the existing task identity.'),
  define('reference', 'Reference', 'knowledge', 'An editable local reference note for links and source descriptions.', ['Edit reference', 'Link resources', 'Open note'], 'A blank reference. External content is not fetched or embedded automatically.'),
  define('stream', 'Intelligence Stream', 'observability', 'A view of the native host’s recorded intelligence events.', ['Inspect recorded events', 'Inspect event provenance'], 'Recorded events only. An empty or disconnected stream is shown truthfully.', 'recorded-events'),
]);
export const blockDefinition = (kind: BlockKind): BlockDefinition => {
  const found = BUILTIN_BLOCKS.find(item => item.kind === kind);
  if (!found) throw new Error('unsupported_block_kind');
  return found;
};
export const blockAvailability = (kind: BlockKind, capabilities: LibraryCapabilities): Availability => capabilities.kinds[kind] ?? { state: 'unknown', reason: 'The host has not advertised this block capability.' };
export function searchBlocks(query: string, capabilities: LibraryCapabilities, category?: BlockDefinition['category'], includeUnavailable = true): (BlockDefinition & { availability: Availability })[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 16);
  return BUILTIN_BLOCKS.filter(item => (!category || item.category === category) && terms.every(term => (item.title + ' ' + item.description + ' ' + item.keywords.join(' ')).toLocaleLowerCase().includes(term)))
    .map(item => ({ ...item, availability: blockAvailability(item.kind, capabilities) })).filter(item => includeUnavailable || item.availability.state === 'available');
}
export function assertBlockAvailable(kind: BlockKind, capabilities: LibraryCapabilities, provider?: 'local' | 'codex'): void {
  blockDefinition(kind);
  const state = blockAvailability(kind, capabilities);
  if (state.state !== 'available') throw new Error('block_unavailable: ' + (state.reason ?? state.state));
  if (provider !== undefined) {
    if (kind !== 'conversation') throw new Error('provider_only_for_conversation');
    if (!['local', 'codex'].includes(provider)) throw new Error('unsupported_provider');
    const available = capabilities.providers[provider];
    if (available?.state !== 'available') throw new Error('provider_unavailable: ' + (available?.reason ?? available?.state ?? 'unknown'));
  }
}
export function validateCreateBlock(input: CreateBlockInput, capabilities: LibraryCapabilities): CreateBlockInput & { presentation: Presentation } {
  if (!input || typeof input !== 'object' || Object.keys(input).some(k => !['commandId','workspaceId','expectedLayoutVersion','kind','title','provider','presentation'].includes(k))) throw new Error('invalid_create_block');
  if (typeof input.commandId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/.test(input.commandId) || typeof input.workspaceId !== 'string' || !input.workspaceId || input.workspaceId.length > 200 || !Number.isInteger(input.expectedLayoutVersion) || input.expectedLayoutVersion < 1) throw new Error('invalid_create_block');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new Error('invalid_title');
  assertBlockAvailable(input.kind, capabilities, input.provider);
  return { ...input, title: input.title.trim(), presentation: presentation(input.presentation ?? {}, blockDefinition(input.kind).defaultPresentation) };
}
