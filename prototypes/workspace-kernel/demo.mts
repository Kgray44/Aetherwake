import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceKernel } from './kernel.mts';

const directory = mkdtempSync(join(tmpdir(), 'aetherwake-kernel-demo-'));
const path = join(directory, 'demo.sqlite');
try {
  let kernel = WorkspaceKernel.open(path);
  const project = kernel.createProject('Demo project');
  const first = kernel.createWorkspace('Research', project.id);
  const second = kernel.createWorkspace('Review', project.id);
  const note = kernel.createNote('Design note', 'Synthetic demo content', project.id);
  const chat = kernel.createConversationRef('Conversation reference', project.id);
  const blockA = kernel.attachBlock(first.id, note.id, { x: 0, y: 0, width: 320, height: 240, z: 0 });
  kernel.attachBlock(second.id, note.id, { x: 20, y: 20, width: 400, height: 250, z: 0 });
  kernel.attachBlock(first.id, chat.id, { x: 340, y: 0, width: 320, height: 240, z: 1 });
  const edge = kernel.relate(note.id, chat.id, 'discussed-in');
  kernel.saveLayout(first.id, 'freeform', { zoom: 1.2 }, [{ blockId: blockA.id, expectedVersion: 1, placement: { x: 10, y: 15, width: 320, height: 240, z: 0 } }], 1);
  kernel.close();

  kernel = WorkspaceKernel.openExisting(path);
  assert.equal(kernel.getResource(note.id).note.content, 'Synthetic demo content');
  assert.equal(kernel.openWorkspace(first.id).blocks.find(b => b.id === blockA.id).x, 10);
  assert.equal(kernel.openWorkspace(second.id).blocks[0].resource_id, note.id);
  assert.equal(kernel.listRelationships(note.id)[0].id, edge.id);
  assert.equal(kernel.openWorkspace(first.id).layout.viewport.zoom, 1.2);
  kernel.assertIntegrity();
  console.log(JSON.stringify({ result: 'PASS', schemaVersion: kernel.schemaVersion(), projectId: project.id, workspaceIds: [first.id, second.id], resourceIds: [note.id, chat.id], relationshipId: edge.id, persistedLayout: true }));
  kernel.close();
} finally {
  rmSync(directory, { recursive: true, force: true });
}
