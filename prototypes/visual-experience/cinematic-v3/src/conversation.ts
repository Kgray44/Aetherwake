import { reviewConversation } from "./workloads.ts";
export type LocalMessage = { id: string; text: string; at: string };
const key = "aerynth-cinematic-v3-local-messages-v1";
export function validateMessages(value: unknown): LocalMessage[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  let size = 0;
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !item ||
      typeof item.id !== "string" ||
      ids.has(item.id) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      typeof item.at !== "string" ||
      !Number.isFinite(Date.parse(item.at))
    )
      return null;
    ids.add(item.id);
    size += item.text.length;
  }
  return size <= 200000 ? value : null;
}

/** A real local message list; no fabricated model replies or backend activity. */
export function installConversation(
  working: HTMLElement,
  editor: HTMLTextAreaElement,
  notify: (text: string) => void,
  involveVela: () => void,
  openRelated: () => void,
) {
  working.classList.add("conversation-content");
  const history = document.createElement("div");
  history.className = "message-stream";
  history.setAttribute("role", "log");
  history.setAttribute(
    "aria-label",
    "Conversation messages. Opening exchange is scripted.",
  );
  history.tabIndex = 0;
  const append = (id: string, author: string, text: string) => {
    const message = document.createElement("section");
    message.className = "message";
    message.dataset.message = id;
    const heading = document.createElement("h3");
    heading.textContent = author;
    const body = document.createElement("p");
    body.textContent = text;
    message.append(heading, body);
    history.append(message);
  };
  for (const [id, author, text] of reviewConversation) append(id, author, text);
  let messages: LocalMessage[] = [];
  let historyWritable = true;
  try {
    const restored = validateMessages(
      JSON.parse(localStorage.getItem(key) || "[]"),
    );
    if (restored) messages = restored;
    else historyWritable = false;
  } catch {
    historyWritable = false;
  }
  if (!historyWritable)
    notify(
      "Local message history could not be read. The stored record is preserved; your draft remains editable.",
    );
  for (const message of messages)
    append(message.id, "YOU · LOCAL MESSAGE", message.text);
  const actions = document.createElement("div");
  actions.className = "conversation-actions";
  const related = document.createElement("button");
  related.textContent = "Open material lens ↗";
  related.addEventListener("click", openRelated);
  const vela = document.createElement("button");
  vela.textContent = "Involve Vela ↗";
  vela.addEventListener("click", involveVela);
  actions.append(related, vela);
  const label = editor.closest("label")!;
  label.classList.add("composer");
  label.firstChild!.textContent =
    "Compose locally · Ctrl+Enter to keep a message";
  editor.placeholder = "Continue the thought…";
  const keep = document.createElement("button");
  keep.className = "keep-message";
  keep.textContent = "Keep local message ↗";
  const submit = () => {
    if (!historyWritable) {
      notify(
        "Local history is unavailable. Your draft is retained without overwriting the stored record.",
      );
      return;
    }
    const text = editor.value.trim();
    if (!text) {
      notify("Write a message first.");
      editor.focus();
      return;
    }
    const next = [
      ...messages,
      {
        id: `local-${Date.now()}-${messages.length}`,
        text,
        at: new Date().toISOString(),
      },
    ];
    if (!validateMessages(next)) {
      notify("Local message history is full. Your draft is retained.");
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      notify("Local storage unavailable. Your draft is retained.");
      return;
    }
    messages = next;
    append(next.at(-1)!.id, "YOU · LOCAL MESSAGE", text);
    editor.value = "";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    history.scrollTop = history.scrollHeight;
    notify("Message kept locally. No model request was sent.");
    editor.focus();
  };
  keep.addEventListener("click", submit);
  editor.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  working.insertBefore(actions, label);
  working.insertBefore(history, label);
  label.after(keep);
}
