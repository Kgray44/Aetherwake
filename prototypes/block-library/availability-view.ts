import { REGISTERED_BLOCKS } from "./registry.ts";

export type UnavailableBlock = {
  code:
    | "missing-type"
    | "missing-resource"
    | "unsupported-version"
    | "binding-changed";
  title: string;
  message: string;
};
/** Definition support is separate from resource existence, grants and provider availability. */
export function unavailableBlock(input: {
  kind: unknown;
  settingsError?: unknown;
  missingResource?: boolean;
}): UnavailableBlock | null {
  if (input.missingResource)
    return {
      code: "missing-resource",
      title: "Referenced resource unavailable",
      message:
        "This placement cannot open its referenced item. Its saved reference and geometry are retained.",
    };
  if (!REGISTERED_BLOCKS.some((definition) => definition.kind === input.kind))
    return {
      code: "missing-type",
      title: "Block type unavailable",
      message:
        "This build has no registered view for the saved block type. Its canonical resource, placement and saved data are retained.",
    };
  const error = input.settingsError as
    | { code?: unknown; message?: unknown }
    | undefined;
  const codes = [
    error?.code,
    error?.message,
    typeof input.settingsError === "string" ? input.settingsError : undefined,
  ];
  if (codes.includes("unsupported_block_manifest_version"))
    return {
      code: "unsupported-version",
      title: "Saved block version unavailable",
      message:
        "This build cannot interpret the saved block manifest version. Its resource, placement, settings and recovery text are retained.",
    };
  if (codes.includes("block_binding_changed"))
    return {
      code: "binding-changed",
      title: "Saved block binding needs recovery",
      message:
        "The saved block metadata does not match its current canonical reference. Its data is retained; no substitute resource has been created.",
    };
  return null;
}

type Entry = {
  content: HTMLElement;
  wasInert: boolean;
  notice: HTMLElement;
  title: HTMLElement;
  message: HTMLElement;
  identity: HTMLElement;
  retry: HTMLButtonElement;
  code: UnavailableBlock["code"];
};
const entries = new WeakMap<HTMLElement, Entry>();

/** Keeps the original editor subtree, value, selection and draft owner intact.
 * Only presentation is suspended. Retry is a host-owned read, never a migration. */
export function showUnavailableBlock(
  article: HTMLElement,
  reason: UnavailableBlock | null,
  options: {
    kind: unknown;
    referenceId: string;
    preview: string;
    subtitle: string;
    retry?(): void;
  },
): boolean {
  let entry = entries.get(article);
  if (!reason) {
    if (!entry) return false;
    entry.content.inert = entry.wasInert;
    entry.notice.remove();
    entries.delete(article);
    delete article.dataset.blockAvailability;
    const preview = article.querySelector(".folio-preview"),
      subtitle = article.querySelector(".folio-subtitle");
    if (preview) preview.textContent = options.preview;
    if (subtitle) subtitle.textContent = options.subtitle;
    return true;
  }
  const changed = !entry || entry.code !== reason.code;
  if (!entry) {
    const content = article.querySelector<HTMLElement>(".working-content"),
      inner = article.querySelector(".folio-inner");
    if (!content || !inner) return false;
    const notice = document.createElement("section"),
      title = document.createElement("h3"),
      message = document.createElement("p"),
      identity = document.createElement("small"),
      retry = document.createElement("button");
    notice.className = "aw-block-unavailable";
    notice.setAttribute("role", "status");
    notice.setAttribute("data-no-card-drag", "");
    retry.type = "button";
    retry.textContent = "Retry saved block information";
    notice.append(title, message, identity, retry);
    const actions = inner.querySelector(".folio-actions");
    inner.insertBefore(
      notice,
      actions?.parentElement === inner ? actions : null,
    );
    entry = {
      content,
      wasInert: content.inert,
      notice,
      title,
      message,
      identity,
      retry,
      code: reason.code,
    };
    entries.set(article, entry);
  }
  entry.code = reason.code;
  entry.content.inert = true;
  entry.title.textContent = reason.title;
  entry.message.textContent = reason.message;
  entry.identity.textContent =
    (typeof options.kind === "string" ? options.kind : "Unknown type") +
    " · " +
    options.referenceId;
  entry.retry.hidden =
    !options.retry ||
    reason.code === "missing-type" ||
    reason.code === "missing-resource";
  entry.retry.disabled = false;
  const button = entry.retry;
  button.onclick = () => {
    button.disabled = true;
    try {
      options.retry?.();
    } catch {
      button.disabled = false;
    }
  };
  article.dataset.blockAvailability = "unavailable";
  const preview = article.querySelector(".folio-preview"),
    subtitle = article.querySelector(".folio-subtitle");
  if (preview) preview.textContent = reason.title;
  if (subtitle)
    subtitle.textContent =
      "Saved data retained · " + options.referenceId.slice(0, 8);
  return changed;
}
