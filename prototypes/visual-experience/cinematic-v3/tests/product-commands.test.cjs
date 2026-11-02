const test = require("node:test");
const assert = require("node:assert/strict");
const { isProductRead, productCommand } = require("../native/product-commands.cjs");
test("canonical product families expose only explicit operations and classify writes separately", async () => {
  const seen = [],
    call = async (...args) => {
      seen.push(args);
      return { result: "ack" };
    };
  for (const [family, name] of [
    ["agents", "list"],
    ["agents", "inspect"],
    ["checklists", "read"],
  ]) {
    const input = { name, input: {} };
    assert.equal(isProductRead(family, input), true);
    assert.deepEqual(await productCommand({ family, input, call }), {
      result: "ack",
    });
    assert.deepEqual(seen.at(-1), [family, input]);
  }
  for (const [family, name] of [
    ["agents", "create"],
    ["agents", "recordAssignment"],
    ["checklists", "mutate"],
  ]) {
    const input = { name, input: {} };
    assert.equal(isProductRead(family, input), false);
    await productCommand({ family, input, call });
  }
  const before = seen.length;
  for (const [family, input] of [
    ["agents", { name: "execute", input: {} }],
    ["agents", { name: "list", input: {}, grant: "fake" }],
    ["checklists", { name: "read", input: [] }],
    ["__proto__", { name: "list", input: {} }],
  ]) {
    assert.equal(isProductRead(family, input), false);
    await assert.rejects(
      productCommand({ family, input, call }),
      /unsupported_product_command/,
    );
  }
  assert.equal(seen.length, before);
});
