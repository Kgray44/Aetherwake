import type {
  BlockLibraryHostPort,
  WorkspaceTemplatePort,
} from "../../../block-library/contracts.ts";
import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";

/** Transport adapter for Universal Block System's released views. Native services own all behavior. */
export function createLibraryClient(options: {
  command(name: string, input: unknown): Promise<unknown>;
  apply(snapshot: DesktopSnapshot): void;
}): BlockLibraryHostPort & WorkspaceTemplatePort {
  const invoke = async <T>(name: string, input: unknown = {}): Promise<T> => {
    const response = (await options.command("library", { name, input })) as {
      result: T;
      desktop?: DesktopSnapshot;
    };
    if (response.desktop) options.apply(response.desktop);
    return response.result;
  };
  return {
    capabilities: () => invoke("capabilities"),
    preferences: () => invoke("preferences"),
    setFavorite: (input) => invoke("setFavorite", input),
    getBlockSettings: (input) => invoke("getBlockSettings", input),
    configureBlock: (input) => invoke("configureBlock", input),
    findResources: (input) => invoke("findResources", input),
    attachBlock: (input) => invoke("attachBlock", input),
    createBlock: (input) => invoke("createBlock", input),
    listTemplates: (input) => invoke("listTemplates", input),
    getTemplate: (input) => invoke("getTemplate", input),
    saveTemplate: (input) => invoke("saveTemplate", input),
    renameTemplate: (input) => invoke("renameTemplate", input),
    archiveTemplate: (input) => invoke("archiveTemplate", input),
    previewTemplate: (input) => invoke("previewTemplate", input),
    applyTemplate: (input) => invoke("applyTemplate", input),
    requestVelaTemplate: (input) => invoke("requestVelaTemplate", input),
  };
}
