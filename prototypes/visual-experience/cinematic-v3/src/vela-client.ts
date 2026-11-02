import type {
  VelaClient,
  VelaState,
} from "../../../vela-core/src/contracts.ts";

/** Browser transport only. Native main owns provider consent; backend owns identity and state. */
export function createVelaClient(options: {
  command(name: string, input: unknown): Promise<unknown>;
  changed(name: string, result: unknown): Promise<void>;
  observed(state: VelaState): void;
}): VelaClient {
  const invoke = async <T>(name: string, input: unknown): Promise<T> => {
    const result = await options.command("vela", { name, input });
    if (name === "state" || name === "open")
      options.observed(result as VelaState);
    if (
      [
        "native",
        "request",
        "apply",
        "review",
        "preferences",
        "reviewAttention",
        "adaptationPolicy",
        "explicitPreference",
        "reviewPreference",
        "resetPreferences",
      ].includes(name)
    )
      await options.changed(name, result);
    return result as T;
  };
  return {
    state: () => invoke("state", {}),
    open: () => invoke("open", {}),
    search: (input) => invoke("search", input),
    request: (input) => invoke("request", input),
    native: (input) => invoke("native", input),
    review: (input) => invoke("review", input),
    apply: (input) => invoke("apply", input),
    cancel: (input) => invoke("cancel", input),
    preferences: (input) => invoke("preferences", input),
    reviewAttention: (input) => invoke("reviewAttention", input),
    adaptationPolicy: (input) => invoke("adaptationPolicy", input),
    explicitPreference: (input) => invoke("explicitPreference", input),
    reviewPreference: (input) => invoke("reviewPreference", input),
    resetPreferences: (input) => invoke("resetPreferences", input),
  };
}
