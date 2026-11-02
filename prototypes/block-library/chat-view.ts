import {
  mountConversationChat,
  type ConversationChatOptions,
  type ConversationExecutionPort,
  type ConversationExecutionObservation,
} from "../conversation-product/src/chat.ts";

/** The shared chat component, placed inside a workspace block. Pausing releases
 * the host's execution observer without replacing the transcript or composer. */
export function mountBlockChat(
  root: HTMLElement,
  options: ConversationChatOptions & {
    active?: boolean;
    openHistory(): void;
    failed(error: unknown): void;
  },
) {
  let active = options.active ?? true,
    disposed = false,
    listener: ((value: ConversationExecutionObservation) => void) | undefined,
    unsubscribe: (() => void) | undefined;
  const observe = () => {
    if (active && !disposed && !unsubscribe && listener && options.execution)
      unsubscribe = options.execution.observe(options.resourceId, (value) => {
        if (active && !disposed) listener?.(value);
      });
  };
  const execution: ConversationExecutionPort | undefined = options.execution
    ? {
        observe(_id, next) {
          listener = next;
          observe();
          return () => {
            unsubscribe?.();
            unsubscribe = undefined;
            listener = undefined;
          };
        },
        cancel: (id) => options.execution!.cancel(id),
      }
    : undefined;
  root.replaceChildren();
  const history = document.createElement("button");
  history.type = "button";
  history.className = "aw-chat-history";
  history.textContent = "History";
  history.title = "History, search and branches";
  history.setAttribute("aria-label", "History, search and branches");
  history.dataset.noCardDrag = "true";
  history.onclick = options.openHistory;
  const header = root
    .closest(".folio")
    ?.querySelector(".folio-top .folio-actions");
  (header ?? root).append(history);
  const chat = mountConversationChat(root, {
    ...options,
    execution,
    layoutHost: root.closest<HTMLElement>(".folio") ?? options.layoutHost,
  });
  void chat.ready.catch(options.failed);
  return {
    ready: chat.ready,
    frame: chat.frame,
    refresh: chat.refresh,
    whenSubmissionSettled: chat.whenSubmissionSettled,
    setPresentation: chat.setPresentation,
    setActive(value: boolean) {
      if (active === value || disposed) return;
      active = value;
      if (!active) {
        unsubscribe?.();
        unsubscribe = undefined;
      } else {
        observe();
        void chat.refresh({ latest: true }).catch(options.failed);
      }
    },
    flush: chat.flush,
    async dispose() {
      if (disposed) return;
      active = false;
      unsubscribe?.();
      unsubscribe = undefined;
      await chat.dispose();
      disposed = true;
      history.remove();
    },
  };
}
