import type {
  VelaActiveCard,
  VelaClient,
  VelaState,
} from "../../../vela-core/src/contracts.ts";
import type { WorkspacePresentationContext } from "../../../application-contract/contracts.ts";

/** Browser transport only. Native main owns provider consent; backend owns identity and state. */
export function createVelaClient(options: {
  command(name: string, input: unknown): Promise<unknown>;
  changed(name: string, result: unknown, mayPresent?: () => boolean): Promise<void>;
  presentationFence?(): () => boolean;
  observed(state: VelaState): void;
  presentation?(): WorkspacePresentationContext | null;
  activeCard?(): VelaActiveCard | undefined;
}): VelaClient {
  const invoke = async <T>(name: string, input: unknown): Promise<T> => {
    const mayPresent =
      name === "request" || name === "apply"
        ? options.presentationFence?.()
        : undefined;
    const presentation = name === "apply" ? options.presentation?.() : null;
    const result = await options.command("vela", {
      name,
      input,
      ...(presentation ? { presentation: structuredClone(presentation) } : {}),
    });
    if (name === "state" || name === "open")
      options.observed(result as VelaState);
    if (
      [
        "native",
        "request",
        "applyFileEdit",
        "verifyFileEdit",
        "reconcileFileEdit",
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
      await options.changed(name, result, mayPresent);
    return result as T;
  };
  return {
    state: () => invoke("state", {}),
    open: () => invoke("open", {}),
    search: (input) => invoke("search", input),
    presentation: (input) => invoke("presentation", input),
    request: (input) => {
      const activeCard = options.activeCard?.();
      return invoke("request", activeCard ? { ...input, activeCard } : input);
    },
    native: (input) => invoke("native", input),
    routingOptions: (input) => invoke("routingOptions", input),
    saveRoutingSettings: (input) => invoke("saveRoutingSettings", input),
    rateRoutingResponse: (input) => invoke("rateRoutingResponse", input),
    applyFileEdit: (input) => invoke("applyFileEdit", input),
    verifyFileEdit: (input) => invoke("verifyFileEdit", input),
    reconcileFileEdit: (input) => invoke("reconcileFileEdit", input),
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
