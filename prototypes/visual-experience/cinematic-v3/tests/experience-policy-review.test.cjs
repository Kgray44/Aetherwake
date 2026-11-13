const assert = require("node:assert/strict");
const test = require("node:test");
const { experiencePolicyReview } = require("../native/experience-policy-review.cjs");

const scope = { workspaceId: "work", projectId: "project" };
const input = { ...scope, experimentId: "trial", policyVersion: 2 };

test("rollback requires a live trusted gesture, exact review, confirmation and write admission", async () => {
  let trusted = false, gesture = false, response = 1, allow = true, loseFocus = false;
  let current = { scope, experimentId: "trial", version: 2 };
  const writes = [];
  const review = experiencePolicyReview({
    trusted: () => trusted,
    hasGesture: () => gesture,
    show: async options => {
      assert.equal(options.defaultId, options.cancelId);
      if (loseFocus) trusted = false;
      return { response };
    },
    canWrite: () => allow,
    call: async (name, request) => {
      assert.equal(name, "aepExperimentNative");
      if (request.name === "inspect-policy") return current;
      writes.push(request);
      return { scope, version: 3, experimentId: null };
    },
  });
  await assert.rejects(review({}, input), /gesture_required/);
  trusted = true;
  await assert.rejects(review({}, input), /gesture_required/);
  gesture = true;
  await assert.rejects(review({}, { ...input, projectId: "foreign" }), /review_changed/);
  assert.equal(await review({}, input), "cancelled");
  response = 0;
  allow = false;
  await assert.rejects(review({}, input), /write_unavailable/);
  allow = loseFocus = true;
  await assert.rejects(review({}, input), /write_unavailable/);
  trusted = true;
  loseFocus = false;
  current = { ...current, version: 3 };
  await assert.rejects(review({}, input), /review_changed/);
  assert.deepEqual(writes, []);
  current = { ...current, version: 2 };
  assert.equal(await review({}, input), "restored");
  assert.deepEqual(writes, [{ name: "rollback-reviewed", ...input }]);
});
