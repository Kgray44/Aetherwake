import type { MediaImportPort, MediaReadPort } from "../../../application-contract/media.ts";
import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";

export function createMediaClient(options: {
  command(name: string, input: unknown): Promise<unknown>;
  apply(snapshot: DesktopSnapshot): void;
}): MediaReadPort & MediaImportPort {
  const invoke = <T>(name: string, input: unknown): Promise<T> =>
    options.command("media", { name, input }) as Promise<T>;
  return {
    async chooseMediaForAdd(input) {
      const reply = await invoke<(NonNullable<Awaited<ReturnType<MediaImportPort["chooseMediaForAdd"]>>> & { desktop: DesktopSnapshot }) | null>(
        "chooseMediaForAdd", input,
      );
      if (!reply) return null;
      options.apply(reply.desktop);
      return { resource: reply.resource, ...(reply.placementId ? { placementId: reply.placementId } : {}) };
    },
    describe: (input) => invoke("describe", input),
    readBytes: (input) => invoke("readBytes", input),
    acquirePlayback: (input) => invoke("acquirePlayback", input),
    releasePlayback: (input) => invoke("releasePlayback", input),
    openExternal: (input) => invoke("openExternal", input),
  };
}
