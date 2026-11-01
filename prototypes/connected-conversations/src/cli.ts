import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConversationGraph, type Kind } from './graph.ts';
import { mockAdapters } from './adapters.ts';

const args = process.argv.slice(2);
const command = args.shift() ?? 'help';
const fileOption = args.indexOf('--file');
const file = resolve(fileOption >= 0 ? args.splice(fileOption, 2)[1] : 'connected-conversations.json');
const adapters = mockAdapters();
function load(): ConversationGraph {
  return existsSync(file) ? ConversationGraph.importJson(readFileSync(file, 'utf8'), adapters) :
    new ConversationGraph(adapters);
}
function save(graph: ConversationGraph): void {
  writeFileSync(file, graph.exportJson() + '\n', { encoding: 'utf8', flag: 'w' });
}
function help(): void {
  console.log('node src/cli.ts <command> [args] [--file graph.json]');
  console.log('commands: demo | new <ordinary|codex> <provider> <title> | say <conversation> <role> <text>');
  console.log('branch <source-conversation> <source-message> <ordinary|codex> <provider> <title> [included-message,...]');
  console.log('run-mock <conversation> <prompt> | graph | show <conversation> | handoff <handoff> | unavailable <message>');
  console.log('Providers: mock-ordinary, mock-codex. All responses are deterministic MOCK output.');
}
function demo(): ConversationGraph {
  const graph = new ConversationGraph(adapters);
  const idea = graph.createChat('ordinary', 'mock-ordinary', 'App concept');
  const first = graph.addMessage(idea.id, 'user', 'I want a calm app for planning neighborhood gardens.');
  graph.addMessage(idea.id, 'assistant', 'What should neighbors be able to share?', { provenance: 'mock_adapter' });
  const constraint = graph.addMessage(idea.id, 'user', 'Keep garden locations private until a neighbor opts in.', { constraint: true });
  const build = graph.branch({
    sourceConversationId: idea.id, sourceMessageId: constraint.id,
    targetKind: 'codex', targetProviderId: 'mock-codex', title: 'Build garden idea',
    includeMessageIds: [first.id, constraint.id], key: 'demo-build'
  });
  const result = graph.runMock(build.conversation.id, 'Build a local prototype for the garden idea.');
  const artifact = graph.addArtifact(build.conversation.id, result.id, 'Mock build plan', 'mock://garden/build-plan');
  const discuss = graph.branch({
    sourceConversationId: build.conversation.id, sourceMessageId: result.id,
    targetKind: 'ordinary', targetProviderId: 'mock-ordinary', title: 'Discuss build result',
    includeMessageIds: [constraint.id, result.id], artifactIds: [artifact.id], key: 'demo-discuss'
  });
  graph.runMock(discuss.conversation.id, 'Review the mock build plan and plan changes.');
  console.log(JSON.stringify({
    label: 'DETERMINISTIC MOCK DEMONSTRATION — no external AI or execution',
    ordinary: idea.id, codex: build.conversation.id, returnChat: discuss.conversation.id,
    buildHandoff: build.handoff.id, returnHandoff: discuss.handoff.id,
    originalOwnMessages: graph.snapshot().conversations.find(c => c.id === idea.id)?.ownMessageIds,
    graphFile: file
  }, null, 2));
  return graph;
}
try {
  if (command === 'help') help();
  else if (command === 'demo') save(demo());
  else {
    const graph = load();
    if (command === 'new') {
      const [kind, provider, ...title] = args;
      console.log(JSON.stringify(graph.createChat(kind as Kind, provider, title.join(' ')), null, 2));
      save(graph);
    } else if (command === 'say') {
      const [id, role, ...content] = args;
      console.log(JSON.stringify(graph.addMessage(id, role as 'user' | 'assistant', content.join(' ')), null, 2));
      save(graph);
    } else if (command === 'branch') {
      const [sourceConversationId, sourceMessageId, targetKind, targetProviderId, title, includes] = args;
      console.log(JSON.stringify(graph.branch({
        sourceConversationId, sourceMessageId, targetKind: targetKind as Kind, targetProviderId,
        title, includeMessageIds: includes ? includes.split(',') : undefined
      }), null, 2));
      save(graph);
    } else if (command === 'run-mock') {
      const [id, ...prompt] = args;
      console.log(JSON.stringify(graph.runMock(id, prompt.join(' ')), null, 2));
      save(graph);
    } else if (command === 'unavailable') {
      graph.markUnavailable(args[0]);
      save(graph);
      console.log('Source marked unavailable for future handoffs.');
    } else if (command === 'show') {
      console.log(JSON.stringify(graph.visibleMessages(args[0]), null, 2));
    } else if (command === 'handoff') {
      console.log(JSON.stringify(graph.inspectHandoff(args[0]), null, 2));
    } else if (command === 'graph') {
      const data = graph.snapshot();
      console.log(JSON.stringify({
        providers: data.providers, conversations: data.conversations,
        edges: data.edges, artifacts: data.artifacts,
        handoffs: data.handoffs.map(h => ({
          id: h.id, targetConversationId: h.targetConversationId,
          state: h.state, staleMessageIds: graph.inspectHandoff(h.id).staleMessageIds,
          included: h.items.map(i => i.sourceMessageId), excluded: h.excludedMessageIds
        }))
      }, null, 2));
    } else help();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
