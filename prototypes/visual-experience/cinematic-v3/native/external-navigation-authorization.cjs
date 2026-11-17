const { createHash } = require("node:crypto");

const ACTIVATION_LIFETIME_MS = 1_000;
const CITATION_GRANT_LIFETIME_MS = 5_000;

function isExternalNavigationActivationInput(input) {
  return !!input &&
    (input.type === "mouseDown" && input.button === "left" ||
      input.type === "keyDown" &&
        input.isAutoRepeat !== true &&
        (input.key === "Enter" ||
          input.code === "Enter" ||
          input.key === " " ||
          input.code === "Space"));
}

function createExternalNavigationActivation({
  ownerIsActive,
  now = () => performance.now(),
  lifetimeMs = ACTIVATION_LIFETIME_MS,
}) {
  if (typeof ownerIsActive !== "function")
    throw Error("invalid_external_navigation_owner");
  let expiresAt = -Infinity;
  return Object.freeze({
    observeInput() {
      expiresAt = ownerIsActive() ? now() + lifetimeMs : -Infinity;
    },
    consume() {
      const observedExpiry = expiresAt;
      expiresAt = -Infinity;
      return observedExpiry >= now() && ownerIsActive();
    },
    revoke() {
      expiresAt = -Infinity;
    },
  });
}

function citationBindingDigest(binding) {
  if (
    !binding ||
    typeof binding !== "object" ||
    Array.isArray(binding) ||
    Object.keys(binding).length !== 4 ||
    typeof binding.resourceId !== "string" ||
    typeof binding.messageId !== "string" ||
    !Number.isSafeInteger(binding.index) ||
    binding.index < 0 ||
    binding.index >= 32 ||
    typeof binding.urlDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(binding.urlDigest)
  )
    throw Error("invalid_citation_navigation_binding");
  return createHash("sha256")
    .update(JSON.stringify([
      binding.resourceId,
      binding.messageId,
      binding.index,
      binding.urlDigest,
    ]))
    .digest("hex");
}

function createCitationNavigationGrant(
  binding,
  {
    ownerIsActive,
    now = () => performance.now(),
    lifetimeMs = CITATION_GRANT_LIFETIME_MS,
  },
) {
  if (typeof ownerIsActive !== "function")
    throw Error("invalid_external_navigation_owner");
  const expectedDigest = citationBindingDigest(binding);
  const expiresAt = now() + lifetimeMs;
  let consumed = false;
  return Object.freeze({
    consume(candidate) {
      if (consumed) return false;
      consumed = true;
      let candidateDigest;
      try {
        candidateDigest = citationBindingDigest(candidate);
      } catch {
        return false;
      }
      return now() <= expiresAt &&
        ownerIsActive() &&
        candidateDigest === expectedDigest;
    },
  });
}

module.exports = {
  createCitationNavigationGrant,
  createExternalNavigationActivation,
  isExternalNavigationActivationInput,
};
