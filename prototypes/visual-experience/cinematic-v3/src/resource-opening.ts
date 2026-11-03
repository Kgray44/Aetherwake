import type {
  ResourceOpeningInput,
  ResourceOpeningResult,
} from "../../../application-contract/resource-opening.ts";

/** Navigation intent only. Canonical availability and content come from the host.
 * Superseded reads cannot replace a newer view; no resource or placement is stored. */
export function createResourceOpener(options: {
  resolve(input: ResourceOpeningInput): Promise<ResourceOpeningResult>;
  present(
    result: Extract<ResourceOpeningResult, { status: "ready" }>,
    input: ResourceOpeningInput,
    current: () => boolean,
  ): Promise<void>;
  unavailable(
    result: Exclude<ResourceOpeningResult, { status: "ready" }>,
  ): void;
}) {
  let intent = 0;
  return {
    cancel() {
      intent++;
    },
    async open(input: ResourceOpeningInput) {
      const revision = ++intent;
      const current = () => revision === intent;
      try {
        const result = await options.resolve(input);
        if (!current()) return { status: "superseded" } as const;
        if (result.status === "ready")
          await options.present(result, input, current);
        else options.unavailable(result);
        if (current()) return result;
      } catch (error) {
        if (current()) throw error;
      }
      return { status: "superseded" } as const;
    },
  };
}
