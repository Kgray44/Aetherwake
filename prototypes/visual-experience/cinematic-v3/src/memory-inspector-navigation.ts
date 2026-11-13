import type { ResourceOpeningResult } from "../../../application-contract/resource-opening.ts";
import { mountConversationChat } from "../../../conversation-product/src/chat.ts";
import type { Detail, ProductCommandMap } from "../../../conversation-product/src/contracts.ts";
import { createResourceOpener } from "./resource-opening.ts";
import { mountSavedMemoriesFixture } from "./saved-memories-mount.ts";

type FixtureCommand = (
  name: "personalMemory" | "openResource" | "conversation",
  input: unknown,
) => Promise<unknown>;

export function mountMemoryInspectorNavigation(root: HTMLElement, command: FixtureCommand) {
  const inspector = document.createElement("div");
  const transcript = document.createElement("section");
  transcript.setAttribute("aria-label", "Original conversation message");
  root.replaceChildren(inspector, transcript);
  let chat: ReturnType<typeof mountConversationChat> | undefined;

  async function clearTranscript() {
    const previous = chat;
    chat = undefined;
    transcript.replaceChildren();
    await previous?.dispose();
  }

  const opener = createResourceOpener({
    async resolve({ resourceId, selection }): Promise<ResourceOpeningResult> {
      const current = opener.capture();
      await clearTranscript();
      if (!current()) throw Error("memory_fixture_open_superseded");
      return await command("openResource", { resourceId, selection }) as ResourceOpeningResult;
    },
    async present(result, input, current) {
      const { resourceId, selection } = input;
      const messageId = selection?.messageId;
      if (!messageId || result.resourceId !== resourceId || result.resource.id !== resourceId ||
          result.presentation.kind !== "conversation" || result.presentation.mode !== "direct" ||
          result.selection?.messageId !== messageId) {
        throw Error("Original message is unavailable.");
      }

      const mounted = mountConversationChat(transcript, {
        resourceId,
        initialAroundMessageId: messageId,
        presentation: "focused",
        port: {
          async command<K extends keyof ProductCommandMap>(name: K, request: ProductCommandMap[K]["input"]) {
            if (name === "readDraft") {
              // The presenter needs a local empty draft to initialize. This fixture has no draft IPC.
              return { resourceId, content: "", version: 0, updatedAt: null } as ProductCommandMap[K]["output"];
            }
            const target = request as ProductCommandMap["detail"]["input"];
            if (name !== "detail" || !current() || target.resourceId !== resourceId ||
                target.aroundMessageId !== messageId) {
              throw Error("memory_fixture_command_denied");
            }
            const detail = await command("conversation", {
              name: "detail",
              input: { resourceId, aroundMessageId: messageId },
            }) as Detail;
            if (!current() || detail?.conversation?.resourceId !== resourceId ||
                detail.messages?.items?.length !== 1 ||
                detail.messages.items[0]?.resourceId !== resourceId ||
                detail.messages.items[0]?.id !== messageId) {
              throw Error("Original message is unavailable.");
            }
            return detail as ProductCommandMap[K]["output"];
          },
        },
      });
      chat = mounted;
      for (const selector of [".cp-composer", ".cp-paging", ".cp-chat-feedback"]) {
        transcript.querySelector(selector)?.remove();
      }

      try {
        await mounted.ready;
        if (!current()) return;
        const selected = transcript.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
        if (!selected) throw Error("Original message is unavailable.");
        selected.querySelector(".cp-message-actions")?.remove();
        selected.tabIndex = -1;
        selected.focus({ preventScroll: true });
      } catch (error) {
        if (chat === mounted) await clearTranscript();
        throw error;
      }
    },
    unavailable() {},
  });

  return mountSavedMemoriesFixture(inspector, {
    async manageMemory(input) {
      const result = await command("personalMemory", input);
      if ((input as { type?: string }).type === "revokeSource" &&
          (result as { status?: string })?.status === "applied") {
        opener.cancel();
        await clearTranscript();
      }
      return result;
    },
    openResource: opener.open,
  });
}
