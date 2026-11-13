import test from "node:test";
import assert from "node:assert/strict";
import { ConversationGraph } from "../src/graph.ts";
import { mockAdapters } from "../src/adapters.ts";

const options = {
  limit: 256,
  maxScan: 4096,
  maxBodyBytes: 131072,
  allow: () => true,
};
function fixture() {
  const graph = new ConversationGraph(mockAdapters()),
    root = graph.createChat("ordinary", "mock-ordinary", "Synthetic root");
  const a = graph.addMessage(root.id, "user", "Synthetic first"),
    b = graph.addMessage(root.id, "assistant", "é😀\n");
  const child = graph.branch({
    sourceConversationId: root.id,
    sourceMessageId: b.id,
    targetKind: "ordinary",
    targetProviderId: "mock-ordinary",
    title: "Synthetic branch",
  });
  const later = graph.addMessage(
      root.id,
      "user",
      "Synthetic outside fork cutoff",
    ),
    own = graph.addMessage(child.conversation.id, "user", "Synthetic child");
  return { graph, root, a, b, child, later, own };
}
test("bounded metadata shares canonical fork visibility/order while public messages remain isolated clones", () => {
  const f = fixture(),
    full = f.graph.visibleMessages(f.child.conversation.id),
    meta = f.graph.visibleMessageMetadata(f.child.conversation.id, options);
  assert.deepEqual(
    meta.items.map((item) => item.id),
    full.map((item) => item.id),
  );
  assert.deepEqual(
    meta.items.map((item) => item.ordinal),
    [1, 2, 3],
  );
  assert(!meta.items.some((item) => item.id === f.later.id));
  assert.equal(meta.hasMore, false);
  assert.equal(meta.limitedBy, null);
  assert.deepEqual(
    f.graph
      .visibleMessageMetadata(f.child.conversation.id, {
        ...options,
        tail: true,
        limit: 2,
      })
      .items.map((item) => item.id),
    [f.b.id, f.own.id],
  );
  assert.equal(
    f.graph.visibleMessageMetadata(f.child.conversation.id, {
      ...options,
      tail: true,
      limit: 2,
    }).hasMore,
    true,
  );
  (meta.items[0] as any).id = "Changed metadata clone";
  full[0].content = "Changed public clone";
  assert.equal(
    f.graph.visibleMessages(f.root.id)[0].content,
    "Synthetic first",
  );
  assert.equal(
    f.graph.visibleMessageMetadata(f.root.id, options).items[0].id,
    f.a.id,
  );
});
test("denied or unavailable inherited sources cannot reveal headers, ordinals, hasMore, byte counts or partial totals", () => {
  const f = fixture();
  let calls = 0;
  const denied = f.graph.visibleMessageMetadata(f.child.conversation.id, {
    ...options,
    tail: true,
    limit: 1,
    allow: (meta) => {
      calls++;
      assert(Object.isFrozen(meta));
      assert(!Object.hasOwn(meta, "content"));
      return meta.id !== f.a.id;
    },
  });
  assert.deepEqual(denied, {
    items: [],
    emittedCount: 0,
    emittedBodyBytes: 0,
    hasMore: false,
    limitedBy: "denied",
  });
  assert(calls > 0);
  f.graph.markUnavailable(f.b.id);
  assert.equal(
    f.graph.visibleMessages(f.child.conversation.id).length,
    2,
    "Revoked bodies are excluded from visible messages while lineage remains intact",
  );
  assert.deepEqual(
    f.graph.visibleMessageMetadata(f.child.conversation.id, {
      ...options,
      allow: (meta) => !meta.unavailable,
    }),
    denied,
  );
});
test("metadata never serializes/clones a message body; Unicode sizes and byte-limited windows remain explicit", () => {
  const f = fixture(),
    internal = (f.graph as any).data.messages.find(
      (message: any) => message.id === f.a.id,
    );
  internal.toJSON = () => {
    throw new Error("Body clone forbidden during metadata projection");
  };
  const meta = f.graph.visibleMessageMetadata(f.root.id, options);
  assert.equal(meta.items[1].bodyBytes, 7);
  assert(!JSON.stringify(meta).includes("content"));
  delete internal.toJSON;
  assert.equal(
    f.graph.visibleMessageMetadata(f.root.id, {
      ...options,
      offset: 1,
      limit: 1,
      maxBodyBytes: 6,
    }).limitedBy,
    "byte-limit",
  );
  assert.equal(
    f.graph.visibleMessageMetadata(f.root.id, {
      ...options,
      offset: 1,
      limit: 1,
      maxBodyBytes: 7,
    }).items[0].bodyBytes,
    7,
  );
  const zero = f.graph.visibleMessageMetadata(f.root.id, {
    ...options,
    limit: 0,
  });
  assert.equal(zero.emittedCount, 0);
  assert.equal(zero.hasMore, true);
  const none = f.graph.visibleMessageMetadata(f.root.id, {
    ...options,
    maxBodyBytes: 0,
  });
  assert.equal(none.emittedCount, 0);
  assert.equal(none.limitedBy, "byte-limit");
  assert.deepEqual(
    f.graph.visibleMessageMetadata(f.root.id, { ...options, maxScan: 0 }),
    {
      items: [],
      emittedCount: 0,
      emittedBodyBytes: 0,
      hasMore: false,
      limitedBy: "scan-limit",
    },
  );
});
test("shared recursive scan budget fails closed before a truncated prefix can become a tail window", () => {
  const f = fixture();
  let id = f.child.conversation.id;
  for (let n = 0; n < 8; n++) {
    const point = f.graph.visibleMessages(id).at(-1)!;
    id = f.graph.branch({
      sourceConversationId: id,
      sourceMessageId: point.id,
      targetKind: "ordinary",
      targetProviderId: "mock-ordinary",
      title: "Synthetic deeper branch " + n,
    }).conversation.id;
  }
  const limited = f.graph.visibleMessageMetadata(id, {
    ...options,
    tail: true,
    limit: 2,
    maxScan: 8,
  });
  assert.equal(limited.limitedBy, "scan-limit");
  assert.deepEqual(limited.items, []);
  assert.equal(limited.emittedCount, 0);
  assert.deepEqual(
    f.graph.visibleMessageMetadata(id, options).items.map((item) => item.id),
    f.graph.visibleMessages(id).map((item) => item.id),
  );
});
test("missing visible fork boundary still throws and invalid limits never produce metadata", () => {
  const f = fixture(),
    other = f.graph.createChat(
      "ordinary",
      "mock-ordinary",
      "Synthetic unrelated",
    ),
    message = f.graph.addMessage(
      other.id,
      "user",
      "Synthetic unrelated boundary",
    ),
    data = f.graph.snapshot();
  data.edges.find(
    (edge) => edge.childId === f.child.conversation.id,
  )!.sourceMessageId = message.id;
  const invalid = new ConversationGraph(mockAdapters(), data);
  assert.throws(
    () => invalid.visibleMessages(f.child.conversation.id),
    /fork point absent/,
  );
  assert.throws(
    () => invalid.visibleMessageMetadata(f.child.conversation.id, options),
    /fork point absent/,
  );
  for (const patch of [
    { limit: 257 },
    { limit: -1 },
    { maxScan: 4097 },
    { maxBodyBytes: 131073 },
    { offset: NaN },
    { maxBodyBytes: Infinity },
  ])
    assert.throws(
      () => f.graph.visibleMessageMetadata(f.root.id, { ...options, ...patch }),
      /invalid metadata limits/,
    );
  const empty = f.graph.createChat(
    "ordinary",
    "mock-ordinary",
    "Synthetic empty",
  );
  assert.deepEqual(f.graph.visibleMessageMetadata(empty.id, options), {
    items: [],
    emittedCount: 0,
    emittedBodyBytes: 0,
    hasMore: false,
    limitedBy: null,
  });
});
