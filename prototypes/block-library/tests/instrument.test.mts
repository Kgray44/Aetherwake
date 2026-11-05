import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTERED_BLOCKS } from '../registry.ts';
import { instrumentDescriptor, instrumentMode, projectInstrumentMode, semanticTarget } from '../instrument.ts';
import { MotionCoordinator } from '../../visual-experience/cinematic-v3/src/motion.ts';

test('every registered block projects its actual capabilities and resource bindings without granting availability', () => {
  for (const definition of REGISTERED_BLOCKS) {
    const descriptor = instrumentDescriptor(definition.kind);
    assert.equal(descriptor.kind, definition.kind);
    assert.equal(descriptor.capabilities, definition.controls);
    assert.equal(descriptor.minSize, definition.minimumSize);
    assert.equal(descriptor.bindableResourceKinds, definition.compatibleResourceKinds);
    assert.equal(descriptor.availability.state, 'unknown');
    assert.ok(descriptor.intents.length);
    assert.deepEqual(descriptor.supportedModes, ['glance', 'interaction', 'immersion']);
  }
  assert.equal(instrumentDescriptor('timeline').creation, 'reference-only');
});

test('presentation changes retain canonical identity, revision, selection and evidence classification', () => {
  const projection = { placementId: 'placement', resourceId: 'timer', sourceRevision: 17, mode: 'interaction' as const, semanticState: 'paused', dataClass: 'observed' as const, focusRef: 'timer-2' };
  for (const mode of ['glance', 'interaction', 'immersion'] as const) {
    assert.deepEqual(projectInstrumentMode(projection, mode), { ...projection, mode });
  }
  assert.equal(projection.mode, 'interaction');
  assert.equal(instrumentMode('overview', true), 'glance');
  assert.equal(instrumentMode('working', false), 'interaction');
  assert.equal(instrumentMode('working', true), 'immersion');
});

test('semantic targets borrow the real coordinator, preserve interruption and settle without an independent scheduler', () => {
  const coordinator = new MotionCoordinator();
  const initial = { x: 0, y: 0, w: 10, h: 10, lift: 0, yaw: 0, opacity: 1 };
  coordinator.add('view', initial);
  let wakes = 0;
  const port = { get reduced() { return coordinator.reduced; }, add: coordinator.add.bind(coordinator), target: coordinator.target.bind(coordinator), pose: coordinator.pose.bind(coordinator), remove: (key: string) => { coordinator.bodies.delete(key); }, wake() { wakes++; } };
  semanticTarget(port, 'view', 'unfurl', { x: 100, w: 200, h: 100 });
  coordinator.step(.02);
  const displayed = coordinator.pose('view');
  const velocity = coordinator.bodies.get('view')!.channels.x.velocity;
  semanticTarget(port, 'view', 'collapse', { x: -20, w: 10, h: 10 });
  assert.deepEqual(coordinator.pose('view'), displayed);
  assert.equal(coordinator.bodies.get('view')!.channels.x.velocity, velocity);
  assert.equal(coordinator.receipts.at(-1)?.status, 'retargeted');
  coordinator.reduced = true;
  semanticTarget(port, 'view', 'settle', initial);
  assert.deepEqual(coordinator.pose('view'), initial);
  assert.equal(wakes, 3);
  assert.throws(() => semanticTarget(port, 'view', 'morph', { x: NaN }), /Invalid/);
});
