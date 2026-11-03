import type { DesktopSnapshot } from "../../../application-contract/contracts.ts";
import type { ChecklistPort } from "../../../application-contract/checklist.ts";
import type { AgentLibraryClientPort } from "../../../agent-product/contracts.ts";
import type { TimelinePort } from "../../../timeline-product/contracts.ts";
import type { TaskObjectivePort } from "../../../task-product/contracts.ts";
import type { TaskReferenceTargetsPort } from "../../../application-contract/task-targets.ts";

/** Transport only. Canonical policy, transactions and identities remain native. */
export function createProductClients(options: {
  command(name: string, input: unknown): Promise<unknown>;
  apply(snapshot: DesktopSnapshot): void;
}): {
  agents: AgentLibraryClientPort;
  checklists: ChecklistPort;
  timelines: TimelinePort;
  taskObjectives: TaskObjectivePort & TaskReferenceTargetsPort;
} {
  async function invoke<T>(
    family: string,
    name: string,
    input: unknown,
  ): Promise<T> {
    const response = (await options.command(family, { name, input })) as {
      result: T;
      desktop?: DesktopSnapshot;
    };
    if (response.desktop) options.apply(response.desktop);
    return response.result;
  }
  return {
    taskObjectives: {
      targets: (input) => invoke("taskObjectives", "targets", input),
      create: (input) => invoke("taskObjectives", "create", input),
      read: (resourceId) => invoke("taskObjectives", "read", { resourceId }),
      mutate: (input) => invoke("taskObjectives", "mutate", input),
      history: (input) => invoke("taskObjectives", "history", input),
      list: (input = {}) => invoke("taskObjectives", "list", input),
    },
    timelines: {
      create: (input) => invoke("timelines", "create", input),
      read: (resourceId) => invoke("timelines", "read", { resourceId }),
      save: (input) => invoke("timelines", "save", input),
      query: (input) => invoke("timelines", "query", input),
    },
    agents: {
      ensureStarters: () => invoke("agents", "ensureStarters", {}),
      list: (input) => invoke("agents", "list", input),
      inspect: (resourceId) => invoke("agents", "inspect", { resourceId }),
      create: (input) => invoke("agents", "create", input),
      update: (input) => invoke("agents", "update", input),
      archive: (input) => invoke("agents", "archive", input),
      effective: (agent, projectId) =>
        invoke("agents", "effective", {
          agent,
          ...(projectId !== undefined ? { projectId } : {}),
        }),
      templates: () => invoke("agents", "templates", {}),
      projects: async () =>
        (
          await invoke<{
            items: { id: string; title: string; version: number }[];
          }>("agents", "projects", {})
        ).items,
      catalog: () => invoke("agents", "catalog", {}),
    },
    checklists: {
      create: (input) => invoke("checklists", "create", input),
      read: (resourceId) => invoke("checklists", "read", { resourceId }),
      mutate: (input) => invoke("checklists", "mutate", input),
    },
  };
}
