/** Dedicated explicit-copy bridge, never a backend/Vela/model command. Native
 * Main owns sender/gesture authority; this DTO cannot supply either grant. */
export const CLIPBOARD_CONTRACT = "aerynth.clipboard@1" as const;
export const CLIPBOARD_TEXT_MAX_BYTES = 256 * 1024;
export type ClipboardCopyRequest = { type: "copyText"; text: string };
export type ClipboardCopyResult =
  | { contract: typeof CLIPBOARD_CONTRACT; status: "copied" }
  | {
      contract: typeof CLIPBOARD_CONTRACT;
      status: "denied";
      code:
        | "clipboard_invalid_request"
        | "clipboard_unauthorized_sender"
        | "clipboard_user_gesture_required";
    }
  | {
      contract: typeof CLIPBOARD_CONTRACT;
      status: "unavailable";
      code:
        | "clipboard_unavailable"
        | "clipboard_closed"
        | "clipboard_busy"
        | "clipboard_authorization_timeout"
        | "clipboard_authorization_unavailable";
    }
  | {
      contract: typeof CLIPBOARD_CONTRACT;
      status: "unknown";
      code:
        | "clipboard_write_unconfirmed"
        | "clipboard_write_timeout"
        | "clipboard_closed_after_dispatch"
        | "clipboard_request_unconfirmed"
        | "clipboard_invalid_native_result";
    };
export interface ClipboardCopyHost {
  /** Isolated preload checks current activation synchronously; dedicated IPC. */
  copyText(text: string): Promise<unknown>;
}
export interface ClipboardClient {
  copyText(text: string): Promise<ClipboardCopyResult>;
}

export function validClipboardText(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > CLIPBOARD_TEXT_MAX_BYTES ||
    value.includes("\0")
  )
    return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return new TextEncoder().encode(value).byteLength <= CLIPBOARD_TEXT_MAX_BYTES;
}
const resultCodes = {
  denied: new Set([
    "clipboard_invalid_request",
    "clipboard_unauthorized_sender",
    "clipboard_user_gesture_required",
  ]),
  unavailable: new Set([
    "clipboard_unavailable",
    "clipboard_closed",
    "clipboard_busy",
    "clipboard_authorization_timeout",
    "clipboard_authorization_unavailable",
  ]),
  unknown: new Set([
    "clipboard_write_unconfirmed",
    "clipboard_write_timeout",
    "clipboard_closed_after_dispatch",
    "clipboard_request_unconfirmed",
    "clipboard_invalid_native_result",
  ]),
};
export function validClipboardResult(
  value: unknown,
): value is ClipboardCopyResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value),
      keys = Reflect.ownKeys(descriptors);
    if (
      !keys.every(
        (key) =>
          typeof key === "string" &&
          ["contract", "status", "code"].includes(key) &&
          "value" in descriptors[key]!,
      )
    )
      return false;
    const contract: unknown = descriptors.contract?.value,
      status: unknown = descriptors.status?.value,
      code: unknown = descriptors.code?.value;
    if (contract !== CLIPBOARD_CONTRACT) return false;
    if (status === "copied")
      return keys.length === 2 && !Object.hasOwn(descriptors, "code");
    return (
      keys.length === 3 &&
      typeof code === "string" &&
      (status === "denied" ||
        status === "unavailable" ||
        status === "unknown") &&
      resultCodes[status].has(code)
    );
  } catch {
    return false;
  }
}
/** Call only from explicit Copy handlers. No browser permission fallback, reads,
 * automatic retry, event cancellation, or keyboard interception is installed. */
export function createClipboardClient(
  host: ClipboardCopyHost | null | undefined,
): ClipboardClient {
  return {
    async copyText(text) {
      if (!validClipboardText(text))
        return {
          contract: CLIPBOARD_CONTRACT,
          status: "denied",
          code: "clipboard_invalid_request",
        };
      if (!host || typeof host.copyText !== "function")
        return {
          contract: CLIPBOARD_CONTRACT,
          status: "unavailable",
          code: "clipboard_unavailable",
        };
      let result: unknown;
      try {
        result = await host.copyText(text);
      } catch {
        return {
          contract: CLIPBOARD_CONTRACT,
          status: "unknown",
          code: "clipboard_request_unconfirmed",
        };
      }
      try {
        if (validClipboardResult(result)) return structuredClone(result);
      } catch {
        /* A malformed native result cannot establish write success. */
      }
      return {
        contract: CLIPBOARD_CONTRACT,
        status: "unknown",
        code: "clipboard_invalid_native_result",
      };
    },
  };
}
