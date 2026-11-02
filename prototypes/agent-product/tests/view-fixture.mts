import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { WorkspaceKernel } from "../../workspace-kernel/kernel.mts";
import { DesktopState } from "../../integrated-backend/src/desktop.mts";
import { blockDocument } from "../../block-library/tests/component-dom.mts";
import { MotionCoordinator } from "../../visual-experience/cinematic-v3/src/motion.ts";
import { AgentLibraryService, agentTemplates } from "../service.mts";
import type {
  AgentHostPort,
  AgentLibraryClientPort,
  AgentProfileData,
  CanonicalAgentResource,
} from "../contracts.ts";
import { mountAgentLibrary } from "../view.ts";

export const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const owned = new Set<ReturnType<typeof canonicalFixture>>();
export function cleanup() {
  for (const item of [...owned]) item.close();
}
/** Real canonical SQLite + host metadata doubles, no browser/native/provider. */
export function canonicalFixture() {
  const directory = mkdtempSync(
      join(tmpdir(), "aerynth-agent-view-synthetic-"),
    ),
    file = join(directory, "canonical.sqlite");
  let kernel = WorkspaceKernel.open(file),
    db!: DatabaseSync;
  kernel.withTransaction((value) => {
    db = value;
  });
  new DesktopState(kernel, db);
  let service!: AgentLibraryService,
    allow = true;
  const metadata = (id: string): CanonicalAgentResource | null => {
    const r = db
      .prepare(
        "SELECT r.* FROM resources r JOIN desktop_resources d ON r.id=d.resource_id WHERE r.id=? AND d.kind='agent'",
      )
      .get(id);
    return r
      ? {
          id,
          kind: "agent",
          title: String(r.title),
          projectId: r.project_id as string | null,
          version: Number(r.version),
          state: r.state as "active" | "archived",
        }
      : null;
  };
  const catalog = () => ({
    revision: "synthetic-cached-catalog-1",
    providers: [
      {
        id: "codex-app-server",
        state: "available" as const,
        models: [{ id: "synthetic-model", reasoningEfforts: ["medium"] }],
        capabilities: ["synthetic-read"],
      },
    ],
  });
  const host: AgentHostPort = {
    identity: () => ({
      principalId: "synthetic-owner",
      policyVersion: "synthetic-policy-1",
    }),
    authorize: () => ({
      decision: allow ? "allow" : "deny",
      policyVersion: "synthetic-policy-1",
      authorizationRef: "synthetic-proof",
    }),
    resource: metadata,
    project: (id) => {
      const p = db
        .prepare("SELECT version,state FROM projects WHERE id=?")
        .get(id);
      return p
        ? {
            id,
            version: Number(p.version),
            state: p.state as "active" | "archived",
          }
        : null;
    },
    createResource: (input) => {
      const r = kernel.createGenericResource(input.title, input.projectId, {
        correlationId: input.commandId,
      });
      db.prepare(
        "INSERT INTO desktop_resources(resource_id,kind) VALUES(?,'agent')",
      ).run(r.id);
      return metadata(r.id)!;
    },
    renameResource: (input) => {
      kernel.renameResource(input.id, input.title, input.expectedVersion, {
        correlationId: input.commandId,
      });
      return metadata(input.id)!;
    },
    touchResource: (input) => {
      kernel.touchGenericResource(input.id, input.expectedVersion, {
        correlationId: input.commandId,
      });
      return metadata(input.id)!;
    },
    archiveResource: (input) => {
      kernel.setResourceArchived(
        input.id,
        input.archived,
        input.expectedVersion,
        { correlationId: input.commandId },
      );
      return metadata(input.id)!;
    },
    configurationLayers: () => ({
      policyVersion: "synthetic-policy-1",
      layers: [
        {
          scope: "global",
          id: null,
          version: "synthetic-global-1",
          settings: {
            providerId: "codex-app-server",
            modelId: "synthetic-model",
            reasoningEffort: "medium",
            additionalInstructions: "Synthetic user adjunct",
            requiredCapabilities: [],
          },
        },
      ],
    }),
    providerCatalog: catalog,
    task: () => null,
    execution: () => null,
  };
  const initialize = () => {
    service = new AgentLibraryService({
      db,
      transaction: (work) => kernel.withTransaction(work),
      readTransaction: (work) => kernel.withTransaction(work),
      host,
    });
  };
  initialize();
  const client: AgentLibraryClientPort = {
    list: async (input) => service.list(input),
    inspect: async (id) => service.inspect(id),
    create: async (input) => service.create(input),
    update: async (input) => service.update(input),
    archive: async (input) => service.archive(input),
    effective: async (ref, project) => service.effective(ref, project),
    templates: async () => agentTemplates(),
    projects: async () =>
      db
        .prepare("SELECT id,title,version FROM projects WHERE state='active'")
        .all() as any,
    catalog: async () => catalog(),
  };
  const fixture = {
    get kernel() {
      return kernel;
    },
    get db() {
      return db;
    },
    get service() {
      return service;
    },
    client,
    allow(value: boolean) {
      allow = value;
    },
    create(
      title: string,
      profile: AgentProfileData = agentTemplates()[0]!.profile,
      projectId: string | null = null,
    ) {
      return service.create({
        commandId: "seed-" + title,
        title,
        profile,
        projectId,
      });
    },
    restart() {
      kernel.close();
      kernel = WorkspaceKernel.open(file);
      kernel.withTransaction((value) => {
        db = value;
      });
      new DesktopState(kernel, db);
      initialize();
    },
    close() {
      if (!owned.delete(fixture)) return;
      kernel.close();
      const target = resolve(directory);
      if (
        dirname(target) !== resolve(tmpdir()) ||
        !basename(target).startsWith("aerynth-agent-view-synthetic-")
      )
        throw Error("owned_temp_boundary");
      rmSync(target, { recursive: true, force: true });
    },
  };
  owned.add(fixture);
  return fixture;
}
export function viewFixture(
  canonical: ReturnType<typeof canonicalFixture>,
  overrides: Partial<AgentLibraryClientPort> = {},
) {
  const dom = blockDocument(),
    create = dom.doc.createElement;
  dom.doc.createElement = (tag: string) => {
    const node = create(tag);
    node.style.setProperty = (name: string, value: string) => {
      node.style[name] = value;
    };
    if (tag === "select") {
      let selected: string | undefined;
      Object.defineProperty(node, "value", {
        configurable: true,
        get: () =>
          selected === undefined ? (node.options[0]?.value ?? "") : selected,
        set(value: string) {
          selected = node.options.some((option: any) => option.value === value)
            ? value
            : "";
        },
      });
    }
    return node;
  };
  const coordinator = new MotionCoordinator();
  coordinator.add("unrelated-parent", {
    x: 1,
    y: 2,
    w: 3,
    h: 4,
    lift: 0,
    yaw: 0,
    opacity: 1,
  });
  let wakes = 0,
    commands = 0;
  const motion = {
    get reduced() {
      return coordinator.reduced;
    },
    add: coordinator.add.bind(coordinator),
    target: coordinator.target.bind(coordinator),
    pose: coordinator.pose.bind(coordinator),
    remove(key: string) {
      coordinator.bodies.delete(key);
    },
    wake() {
      wakes++;
    },
  };
  const controller = mountAgentLibrary(dom.root as unknown as HTMLElement, {
    client: { ...canonical.client, ...overrides },
    motion,
    commandId: () => "synthetic-ui-command-" + ++commands,
  });
  const root = dom.root.querySelector(".agent-library"),
    action = (name: string) => root.querySelector(`[data-action="${name}"]`);
  return {
    ...dom,
    root,
    action,
    controller,
    coordinator,
    get wakes() {
      return wakes;
    },
    input(name: string, value: string, event = "input") {
      const node = action(name);
      node.value = value;
      node.fire(event);
      return node;
    },
    click(name: string) {
      const node = action(name);
      if (!node || node.disabled)
        throw Error("CPU control unavailable: " + name);
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement)
        if (ancestor.hidden || ancestor.inert)
          throw Error("CPU control unavailable: " + name);
      node.fire("click");
    },
    select(id: string) {
      root
        .querySelector(`[data-resource-id="${id}"]`)
        .querySelector("button")
        .fire("click");
    },
    submit() {
      root.querySelector("form").fire("submit");
    },
    frame(seconds = 0.04) {
      coordinator.step(seconds);
      controller.frame();
    },
  };
}
