const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {
  taskGroupChecklistReady,
  waitForTaskGroupChecklist,
} = require("./integrated-native.cjs");

const canonical = [
  { id: "task-a", status: "open" },
  { id: "task-b", status: "done" },
];
const expected = canonical.map((m) => ({
  id: m.id,
  checked: m.status === "done",
}));

// These are isolated browser-read tests, not an executed native UI receipt.
function fixture() {
  let mounted = false,
    visible = true,
    inert = false,
    rows = [];
  const root = {
    getClientRects: () => (visible ? [{}] : []),
    closest: () => (inert ? {} : null),
    querySelectorAll: (selector) => {
      assert.equal(selector, "[data-task-id]");
      return rows;
    },
  };
  const context = {
    CSS: { escape: (id) => id },
    document: {
      querySelector: (selector) => {
        assert.equal(
          selector,
          '[data-block="canonical-block"] .aw-task-group[aria-label="Manual task group"]',
        );
        return mounted ? root : null;
      },
    },
  };
  const setRows = (members) => {
    rows = members.map((member) => {
      const input = Object.freeze({
        checked: member.checked,
        disabled: member.disabled ?? false,
        getClientRects: () => (member.visible === false ? [] : [{}]),
        closest: () => (member.inert ? {} : null),
        getAttribute: () => member.label ?? "Mark " + member.id + " done",
      });
      return Object.freeze({
        dataset: Object.freeze({ taskId: member.id }),
        querySelector: (selector) => {
          assert.equal(selector, 'input[type="checkbox"]');
          return member.missing ? null : input;
        },
      });
    });
  };
  const evaluate = (expression) => vm.runInNewContext(expression, context);
  return {
    evaluate,
    ready: (members = expected) =>
      evaluate(
        "(" +
          taskGroupChecklistReady.toString() +
          ")('canonical-block'," +
          JSON.stringify(members) +
          ")",
      ),
    mount: () => {
      mounted = true;
    },
    visibility: (value) => {
      visible = value;
    },
    inert: (value) => {
      inert = value;
    },
    setRows,
  };
}

test("expanded/empty task-group hosts remain unready until the real keyed checkboxes paint", () => {
  const f = fixture();
  assert.equal(f.ready(), false);
  f.mount();
  assert.equal(f.ready(), false, "mounted host is not painted membership");
  f.setRows(expected.slice(0, 1));
  assert.equal(f.ready(), false, "partial async membership is not accepted");
  f.setRows(expected.toReversed());
  assert.equal(
    f.ready(),
    true,
    "readiness uses identity rather than DOM row order",
  );
});

test("substituted, duplicate, extra and incorrectly checked tasks never satisfy canonical readiness", () => {
  const f = fixture();
  f.mount();
  for (const rows of [
    [expected[0], { ...expected[1], id: "another-task" }],
    [expected[0], expected[0]],
    [...expected, { id: "extra-task", checked: false }],
    [expected[0], { ...expected[1], checked: false }],
  ]) {
    f.setRows(rows);
    assert.equal(f.ready(), false);
  }
  assert.equal(f.ready([]), false);
  assert.equal(f.ready([expected[0], expected[0]]), false);
  assert.equal(f.ready([{ id: "task-a", checked: "false" }]), false);
  assert.equal(f.ready(Array(65).fill(expected[0])), false);
});

test("hidden, inert, disabled, missing and inaccessible status controls stay unready", () => {
  const f = fixture();
  f.mount();
  f.setRows(expected);
  f.visibility(false);
  assert.equal(f.ready(), false);
  f.visibility(true);
  f.inert(true);
  assert.equal(f.ready(), false);
  f.inert(false);
  for (const change of [
    { visible: false },
    { inert: true },
    { disabled: true },
    { missing: true },
    { label: "Task" },
  ]) {
    f.setRows([expected[0], { ...expected[1], ...change }]);
    assert.equal(f.ready(), false);
  }
});

test("the actual wait expression is bounded and rechecks genuine readiness without editing canonical state", async () => {
  const f = fixture(),
    before = structuredClone(canonical);
  let checks = 0;
  await waitForTaskGroupChecklist(
    async (expression, timeout) => {
      assert.equal(timeout, 5000);
      assert.equal(f.evaluate(expression), false);
      checks++;
      f.mount();
      assert.equal(f.evaluate(expression), false);
      checks++;
      f.setRows(expected);
      assert.equal(f.evaluate(expression), true);
      checks++;
    },
    "canonical-block",
    canonical,
  );
  assert.equal(checks, 3);
  assert.deepEqual(canonical, before);
});

test("deadline, owner loss, operator abort and persistent bad membership propagate from the guarded driver", async () => {
  for (const reason of [
    "native_expanded_deadline",
    "native_verification_focus_lost",
    "native_expanded_operator_escape",
    "Timed out checklist readiness",
  ]) {
    await assert.rejects(
      waitForTaskGroupChecklist(
        async () => {
          throw Error(reason);
        },
        "canonical-block",
        canonical,
      ),
      new RegExp(reason),
    );
  }
});
