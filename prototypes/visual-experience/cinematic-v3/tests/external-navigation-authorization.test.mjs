import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const {
  createCitationNavigationGrant,
  createExternalNavigationActivation,
  isExternalNavigationActivationInput,
} = createRequire(import.meta.url)(
  "../native/external-navigation-authorization.cjs",
);

test("only direct mouse and keyboard activation inputs qualify", () => {
  assert.equal(isExternalNavigationActivationInput({ type: "mouseDown", button: "left" }), true);
  assert.equal(isExternalNavigationActivationInput({ type: "keyDown", key: "Enter" }), true);
  assert.equal(isExternalNavigationActivationInput({ type: "keyDown", key: " " }), true);
  assert.equal(isExternalNavigationActivationInput({ type: "keyDown", code: "Space" }), true);
  assert.equal(isExternalNavigationActivationInput({ type: "mouseDown", button: "right" }), false);
  assert.equal(isExternalNavigationActivationInput({ type: "keyDown", key: "Enter", isAutoRepeat: true }), false);
  assert.equal(isExternalNavigationActivationInput({ type: "keyDown", key: "A" }), false);
});

test("main-process activation is fresh, one-use, active-owner bound, and revocable", () => {
  let active = true;
  let now = 100;
  const authorization = createExternalNavigationActivation({
    ownerIsActive: () => active,
    now: () => now,
    lifetimeMs: 10,
  });
  assert.equal(authorization.consume(), false);
  authorization.observeInput();
  assert.equal(authorization.consume(), true);
  assert.equal(authorization.consume(), false);
  authorization.observeInput();
  active = false;
  assert.equal(authorization.consume(), false);
  active = true;
  authorization.observeInput();
  now = 111;
  assert.equal(authorization.consume(), false);
  now = 200;
  authorization.observeInput();
  authorization.revoke();
  assert.equal(authorization.consume(), false);
});

test("citation grants bind exact canonical destination state and reject replay", () => {
  let active = true;
  let now = 100;
  const binding = {
    resourceId: "conversation",
    messageId: "message",
    index: 0,
    urlDigest: "a".repeat(64),
  };
  const grant = createCitationNavigationGrant(binding, {
    ownerIsActive: () => active,
    now: () => now,
    lifetimeMs: 10,
  });
  assert.equal(grant.consume({ ...binding, urlDigest: "b".repeat(64) }), false);
  assert.equal(grant.consume(binding), false);

  const accepted = createCitationNavigationGrant(binding, {
    ownerIsActive: () => active,
    now: () => now,
    lifetimeMs: 10,
  });
  assert.equal(accepted.consume(binding), true);
  assert.equal(accepted.consume(binding), false);

  const inactive = createCitationNavigationGrant(binding, {
    ownerIsActive: () => active,
    now: () => now,
    lifetimeMs: 10,
  });
  active = false;
  assert.equal(inactive.consume(binding), false);

  active = true;
  const expired = createCitationNavigationGrant(binding, {
    ownerIsActive: () => active,
    now: () => now,
    lifetimeMs: 10,
  });
  now = 111;
  assert.equal(expired.consume(binding), false);
});
