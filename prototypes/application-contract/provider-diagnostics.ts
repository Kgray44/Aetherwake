import type { TurnHttpDiagnostic } from "../openai-provider/contracts.mts";

const codes = new Set([
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
  "subscription_sharing_user_unavailable",
  "subscription_sharing_user_not_eligible",
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "invalid_client",
  "insufficient_quota",
  "rate_limit_exceeded",
  "invalid_api_key",
  "server_error",
  "invalid_prompt",
  "invalid_request_error",
  "invalid_value",
  "model_not_found",
]);
/** Copy only bodyless observations. Persisted/transport objects cannot supply
 * getters, arbitrary error text, headers or outcome authority to a public view. */
export function projectTurnHttpDiagnostic(
  value: unknown,
): TurnHttpDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const fields = [
    "contract",
    "httpStatus",
    "contentType",
    "hasBody",
    "serverRequestId",
    "bodyShape",
    "remoteCode",
  ] as const;
  const own = Object.getOwnPropertyDescriptors(value);
  if (!fields.every((key) => own[key] && "value" in own[key])) return;
  const get = (key: (typeof fields)[number]) => own[key]!.value;
  const status = get("httpStatus"),
    request = get("serverRequestId"),
    code = get("remoteCode");
  if (
    get("contract") !== "aerynth.turn-http-diagnostic@1" ||
    !(
      status === null ||
      (Number.isInteger(status) && status >= 100 && status <= 599)
    ) ||
    !["event-stream", "json", "text", "html", "other", "missing"].includes(
      get("contentType"),
    ) ||
    typeof get("hasBody") !== "boolean" ||
    !(
      request === null ||
      (typeof request === "string" &&
        /^req_[A-Za-z0-9_-]{1,128}$/.test(request))
    ) ||
    !["error", "detail", "other", "invalid-json", "unavailable"].includes(
      get("bodyShape"),
    ) ||
    !(code === null || (typeof code === "string" && codes.has(code)))
  )
    return;
  return Object.fromEntries(
    fields.map((key) => [key, get(key)]),
  ) as unknown as TurnHttpDiagnostic;
}
