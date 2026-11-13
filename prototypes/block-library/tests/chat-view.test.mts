import test from "node:test";
import assert from "node:assert/strict";
import { mountBlockChat } from "../chat-view.ts";
import { ConversationDraftSession } from "../../conversation-product/src/draft-session.ts";
import type {
  ConversationProductPort,
  Detail,
} from "../../conversation-product/src/contracts.ts";
import type { ConversationExecutionObservation } from "../../conversation-product/src/chat.ts";
import { blockDocument, card } from "./component-dom.mts";
import { named, until } from "../../conversation-product/test/component-dom.mts";

// Synthetic port, actual shared component/session. No provider, layout or native claim.
function fixture(t: any) {
  const view = blockDocument();
  t.after(view.install());
  const calls: { name: string; input: any }[] = [];
  let draft = {
    resourceId: "chat:block",
    content: "Synthetic durable draft",
    version: 2,
    updatedAt: "2026-11-02T00:00:00Z",
  };
  const detail: Detail = {
    conversation: {
      resourceId: draft.resourceId,
      conversationId: "conversation:block",
      title: "Synthetic block",
      providerId: "local",
      revision: 1,
      version: 1,
      projectId: null,
      projectIds: [],
      state: "active",
      createdAt: draft.updatedAt,
      favorite: false,
      messageCount: 1,
      collectionIds: [],
    },
    messages: {
      items: [
        {
          id: "message:actual",
          resourceId: draft.resourceId,
          role: "user",
          content: "Actual saved text",
          createdAt: draft.updatedAt,
          provenance: "user",
          inherited: false,
          sensitivity: "internal",
        },
      ],
      offset: 0,
      limit: 50,
      total: 1,
      hasMore: false,
    },
    lineage: [],
    policy: {
      resourceId: draft.resourceId,
      revision: 1,
      mode: "independent",
      allowedSourceIds: [],
      allowCrossProject: false,
      maxSensitivity: "internal",
      categories: ["excerpt"],
    },
    shares: [],
    providers: [
      {
        id: "local",
        label: "Local recording",
        available: true,
        record: true,
        execute: false,
        nativeFork: false,
        history: "local",
        simulated: false,
        models: [],
      },
    ],
  };
  let pending: { input: any; resolve(value: any): void } | undefined;
  const port = {
    async command(name: string, input: any): Promise<any> {
      calls.push({ name, input });
      if (name === "readDraft") return { ...draft };
      if (name === "saveDraft") {
        assert.equal(input.expectedVersion, draft.version);
        draft = {
          ...draft,
          content: input.content,
          version: draft.version + 1,
        };
        return { ...draft };
      }
      if (name === "detail") return structuredClone(detail);
      if (name === "send")
        return new Promise((resolve) => {
          pending = { input, resolve };
        });
      throw new Error("Unexpected command " + name);
    },
  } as ConversationProductPort;
  return {
    view,
    calls,
    port,
    detail,
    get draft() {
      return draft;
    },
    get pending() {
      return pending;
    },
    accept() {
      assert.ok(pending);
      const message = {
        ...detail.messages.items[0],
        id: "message:accepted",
        content: pending.input.content,
      };
      detail.messages.items.push(message);
      detail.messages.total++;
      detail.conversation.messageCount++;
      detail.conversation.revision++;
      pending.resolve({ ...message, revision: detail.conversation.revision });
    },
  };
}

test("pause and resize retain the exact shared transcript/composer/caret, with one active execution observer", async (t) => {
  const f = fixture(t);
  const session = new ConversationDraftSession({
    port: f.port,
    resourceId: f.draft.resourceId,
  });
  let listeners: ((value: ConversationExecutionObservation) => void)[] = [],
    activeObservers = 0,
    histories = 0;
  const controller = mountBlockChat(f.view.root, {
    presentation: "workspace",
    port: f.port,
    resourceId: f.draft.resourceId,
    draftSession: session,
    execution: {
      observe(_id, listener) {
        listeners.push(listener);
        activeObservers++;
        return () => {
          activeObservers--;
        };
      },
      async cancel() {},
    },
    openHistory() {
      histories++;
    },
    failed(error) {
      throw error;
    },
  });
  try {
    await controller.ready;
    const input = f.view.root.querySelector("textarea"),
      message = f.view.root.querySelector(".cp-message"),
      log = f.view.root.querySelector(".cp-messages");
    input.focus();
    input.setSelectionRange(3, 9);
    log.scrollTop = 44;
    const callsBeforePose = f.calls.length;
    controller.setPresentation("focused");
    controller.setPresentation("workspace");
    assert.equal(
      f.view.root.querySelector(".cp-chat").dataset.presentation,
      "workspace",
    );
    assert.equal(
      f.calls.length,
      callsBeforePose,
      "Pose changes do not read or save canonical state",
    );
    assert.equal(f.view.doc.activeElement, input);
    assert.equal(f.view.root.querySelectorAll(".cp-chat").length, 1);
    assert.equal(activeObservers, 1);
    controller.setActive(false);
    const pausedReads = f.calls.length;
    listeners[0]({ connection: "unavailable" });
    assert.equal(activeObservers, 0);
    assert.equal(f.calls.length, pausedReads);
    assert.doesNotMatch(
      f.view.root.querySelector(".cp-chat-status").textContent,
      /Connection unavailable/,
    );
    controller.setActive(true);
    await until(() => f.calls.length > pausedReads);
    assert.equal(activeObservers, 1);
    assert.equal(f.view.root.querySelector("textarea"), input);
    assert.equal(f.view.root.querySelector(".cp-message"), message);
    assert.equal(log.scrollTop, 44);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 9]);
    f.view.root.querySelector(".aw-chat-history").onclick();
    assert.equal(histories, 1);
    assert.equal(
      f.calls.some((call) => call.name === "send"),
      false,
    );
  } finally {
    await controller.dispose();
    await session.dispose();
    assert.equal(activeObservers, 0);
  }
});

test("block History lives in existing card chrome without adding a body row or replacing the shared composer", async (t) => {
  const f = fixture(t),
    c = card(f.view);
  c.top.append(c.actions);
  const previous = globalThis.ResizeObserver,
    observed: Element[] = [];
  let disconnected = false;
  class HostObserver {
    constructor(_callback: ResizeObserverCallback) {}
    observe(target: Element) {
      observed.push(target);
    }
    disconnect() {
      disconnected = true;
    }
  }
  globalThis.ResizeObserver = HostObserver as unknown as typeof ResizeObserver;
  t.after(() => {
    if (previous === undefined) delete (globalThis as any).ResizeObserver;
    else globalThis.ResizeObserver = previous;
  });
  Object.defineProperty(c.article, "clientHeight", { value: 600 });
  Object.defineProperty(c.article, "clientWidth", { value: 380 });
  const controller = mountBlockChat(c.working, {
    port: f.port,
    resourceId: f.draft.resourceId,
    presentation: "workspace",
    openHistory() {},
    failed(error) {
      throw error;
    },
  });
  try {
    await controller.ready;
    const input = c.working.querySelector("textarea"),
      history = c.top.querySelector(".aw-chat-history");
    assert(history);
    assert.deepEqual(
      observed,
      [c.article],
      "Only the existing externally sized placement is observed",
    );
    assert.notEqual(observed[0], c.working.querySelector(".cp-chat"));
    assert.equal(c.working.querySelector(".aw-chat-history"), null);
    assert.equal(
      history.getAttribute("aria-label"),
      "History, search and branches",
    );
    input.focus();
    input.setSelectionRange(2, 7);
    controller.setPresentation("focused");
    controller.setPresentation("workspace");
    assert.equal(c.working.querySelector("textarea"), input);
    assert.equal(f.view.doc.activeElement, input);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 7]);
    assert.equal(c.top.querySelector(".aw-chat-history"), history);
    assert.equal(
      observed.length,
      1,
      "Pose changes retain one external host observer",
    );
  } finally {
    await controller.dispose();
  }
  assert.equal(c.top.querySelector(".aw-chat-history"), null);
  assert.equal(disconnected, true);
});

test("leaving an inline block does not wait for a provider RPC or dispose its canonical draft owner", async (t) => {
  const f = fixture(t),
    session = new ConversationDraftSession({
      port: f.port,
      resourceId: f.draft.resourceId,
    });
  let changed = 0;
  const controller = mountBlockChat(f.view.root, {
    port: f.port,
    resourceId: f.draft.resourceId,
    draftSession: session,
    openHistory() {},
    failed(error) {
      throw error;
    },
    onChanged() {
      changed++;
    },
  });
  try {
    await controller.ready;
    f.view.root.querySelector(".cp-composer").fire("submit");
    await until(() => !!f.pending);
    await controller.dispose();
    assert.equal(f.view.root.querySelector(".cp-chat"), null);
    assert.equal(
      f.draft.content,
      "Synthetic durable draft",
      "Draft retained while receipt is pending",
    );
    session.update("Later edits in another canonical view");
    await session.flush();
    f.accept();
    await controller.whenSubmissionSettled();
    assert.equal(
      changed,
      0,
      "A disposed view does not trigger a stale UI refresh",
    );
    assert.equal(
      f.draft.content,
      "Later edits in another canonical view",
      "Accepted earlier send cannot clear later text",
    );
    assert.equal(f.calls.filter((call) => call.name === "send").length, 1);
    session.update("Owner remains usable after block disposal");
    await session.flush();
    assert.equal(f.draft.content, "Owner remains usable after block disposal");
  } finally {
    await controller.dispose();
    await session.dispose();
  }
});

test("workspace chat can review memory from its exact user message", async (t) => {
  const f = fixture(t);
  const reviews: unknown[] = [];
  const session = new ConversationDraftSession({ port: f.port, resourceId: f.draft.resourceId });
  const controller = mountBlockChat(f.view.root, {
    presentation: "workspace",
    port: f.port,
    resourceId: f.draft.resourceId,
    draftSession: session,
    async onRememberMessage(request) { reviews.push(request); return false; },
    openHistory() {},
    failed(error) { throw error; },
  });
  try {
    await controller.ready;
    const actions = f.view.root.querySelector(".cp-message-actions");
    named(actions, "Remember message").fire("click");
    assert.deepEqual(reviews, []);
    actions.querySelector(".cp-memory-editor").fire("submit");
    await until(() => reviews.length === 1);
    assert.deepEqual(reviews, [{
      conversationId: f.draft.resourceId, messageId: "message:actual",
      text: "Actual saved text", scope: "conversation", category: "technical",
      keywords: ["actual", "saved", "text"],
    }]);
  } finally {
    await controller.dispose();
  }
});
