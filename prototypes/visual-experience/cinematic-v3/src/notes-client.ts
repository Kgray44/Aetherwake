import type { NoteExperiencePort } from "../../../block-library/note-contracts.ts";
import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";

export function createNotesClient(options: {
  command(name: string, input: unknown): Promise<unknown>;
  apply(snapshot: DesktopSnapshot): void;
}): NoteExperiencePort {
  const invoke = async <T>(name: string, input: unknown): Promise<T> => {
    const response = (await options.command("notes", { name, input })) as {
      result: T;
      desktop?: DesktopSnapshot;
    };
    if (response.desktop) options.apply(response.desktop);
    return response.result;
  };
  return {
    readNote: (input) => invoke("readNote", input),
    saveNoteDraft: (input) => invoke("saveNoteDraft", input),
    commitNote: (input) => invoke("commitNote", input),
    discardNoteDraft: (input) => invoke("discardNoteDraft", input),
    renameNote: (input) => invoke("renameNote", input),
  };
}
