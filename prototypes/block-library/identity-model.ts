import type { Resource } from "../application-contract/contracts.ts";
import type {
  BlockInstanceKind,
  BrowseResourcesPage,
  ProjectOverview,
} from "./contracts.ts";
import { sourceLinks } from "./source-links.ts";

export type SubjectIdentity =
  | { phase: "loading" | "unavailable"; message?: string }
  | { phase: "ready"; kind: "project"; overview: ProjectOverview }
  | {
      phase: "ready";
      kind: "browser";
      page: BrowseResourcesPage;
      query: string;
    };
export type IdentityEvent = {
  id: string;
  type: string;
  source: string;
  classification: string;
  receivedAt: string;
};
export type IdentityRow = {
  id: string;
  title: string;
  detail: string;
  checked?: boolean;
  target?: "resource" | "workspace" | "task";
  time?: string;
  canAttach?: boolean;
};
export type BlockIdentityModel = {
  kind: BlockInstanceKind;
  layout:
    | "chat"
    | "execution"
    | "document"
    | "task"
    | "checklist"
    | "timeline"
    | "project"
    | "table"
    | "collection"
    | "research"
    | "reference";
  label: string;
  subtitle: string;
  phase: "ready" | "loading" | "unavailable";
  heading: string;
  paragraphs: string[];
  rows: IdentityRow[];
  metrics: { label: string; value: string }[];
  links: { url: string; domain: string }[];
  empty: string;
  query?: string;
};
const excerpt = (text: string, limit = 220) =>
  Array.from(text.trim()).slice(0, limit).join("");
const document = (content: string) => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s/.test(line));
  return {
    heading: heading?.replace(/^#{1,6}\s+/, "") ?? "",
    paragraphs: lines
      .filter((line) => line !== heading && !line.startsWith("```"))
      .slice(0, 4)
      .map((line) => excerpt(line, 180)),
  };
};
const typeLabel = {
  conversation: "Conversation",
  note: "Note",
  task: "Task",
  task_group: "Task group",
  stream: "Activity",
  project_overview: "Project",
  resource_browser: "Resources",
  collection_browser: "Collection",
  research: "Research",
  reference: "Reference",
} satisfies Record<BlockInstanceKind, string>;

/** Read-only projections of canonical data. Empty and unavailable are explicit;
 * no sample messages, activity, progress, source retrieval or metrics are invented. */
export function blockIdentity(input: {
  kind: BlockInstanceKind;
  resource?: Resource;
  content?: string;
  subject?: SubjectIdentity;
  events?: IdentityEvent[];
  disconnected?: boolean;
}): BlockIdentityModel {
  const { kind, resource } = input;
  const layouts = {
    conversation: resource?.provider === "codex" ? "execution" : "chat",
    note: "document",
    task: "task",
    task_group: "checklist",
    stream: "timeline",
    project_overview: "project",
    resource_browser: "table",
    collection_browser: "collection",
    research: "research",
    reference: "reference",
  } as const;
  const model: BlockIdentityModel = {
    kind,
    layout: layouts[kind],
    label: typeLabel[kind],
    subtitle: "",
    phase: "ready",
    heading: "",
    paragraphs: [],
    rows: [],
    metrics: [],
    links: [],
    empty: "",
  };
  if (resource?.available === false || resource?.visible === false) {
    return {
      ...model,
      phase: "unavailable",
      subtitle: "Resource unavailable",
      empty: "Your content and card layout are retained.",
    };
  }
  const content = input.content ?? resource?.content ?? "";
  if (kind === "conversation") {
    const codex = resource?.provider === "codex";
    model.layout = codex ? "execution" : "chat";
    model.label = codex ? "Codex" : "Local chat";
    model.subtitle = codex
      ? resource?.execution
        ? "Turn " + resource.execution.state
        : "Codex conversation"
      : "Messages saved locally";
    model.rows = (resource?.messages ?? []).slice(-2).map((message) => ({
      id: message.id,
      title:
        message.role === "user"
          ? "You"
          : message.role === "assistant"
            ? "Assistant"
            : message.role,
      detail: excerpt(message.content, 260),
    }));
    model.empty = codex
      ? "Write a message. You will review it before sending."
      : "Start a conversation. Your draft stays with this chat.";
    if (resource?.execution)
      model.metrics = [
        {
          label: "Turn",
          value:
            resource.execution.state === "provider_completed"
              ? "Response complete"
              : resource.execution.state.replaceAll("_", " "),
        },
      ];
  } else if (kind === "task") {
    model.layout = "task";
    model.subtitle =
      "Local task · " + (resource?.taskPriority ?? "priority not set");
    model.rows = resource
      ? [
          {
            id: resource.id,
            title: resource.title,
            detail:
              resource.taskStatus === "done"
                ? "Completed locally"
                : resource.taskStatus === "open"
                  ? "Open"
                  : "Status unavailable",
            checked:
              resource.taskStatus === undefined
                ? undefined
                : resource.taskStatus === "done",
            target: "task",
          },
        ]
      : [];
    model.paragraphs = document(content).paragraphs.slice(0, 2);
    model.empty = "Add a description in task details.";
  } else if (kind === "task_group") {
    model.layout = "checklist";
    const members = resource?.taskMembers;
    model.subtitle = members
      ? `${members.filter((task) => task.status === "done").length} of ${members.length} completed locally`
      : "Task membership unavailable";
    model.rows = (members ?? []).slice(0, 4).map((task) => ({
      id: task.id,
      title: task.title,
      detail: task.status === "done" ? "Done" : "Open",
      checked: task.status === "done",
      target: "task",
    }));
    model.empty = members
      ? "Add existing tasks with Manage tasks."
      : "Open this group to read its supported membership.";
  } else if (kind === "stream") {
    model.layout = "timeline";
    model.subtitle = input.disconnected
      ? "Disconnected · retained records"
      : "Recorded application activity";
    model.rows = (input.events ?? [])
      .slice(-4)
      .reverse()
      .map((event) => ({
        id: event.id,
        title: event.type,
        detail: event.source + " · " + event.classification + " · received",
        time: event.receivedAt,
      }));
    model.empty = input.disconnected
      ? "The event connection is unavailable. Existing records are retained."
      : "No recorded events loaded in this scope.";
  } else if (
    kind === "project_overview" ||
    kind === "resource_browser" ||
    kind === "collection_browser"
  ) {
    model.layout =
      kind === "project_overview"
        ? "project"
        : kind === "resource_browser"
          ? "table"
          : "collection";
    const subject = input.subject;
    if (!subject || subject.phase !== "ready") {
      model.phase = subject?.phase ?? "loading";
      model.subtitle =
        model.phase === "loading"
          ? "Loading this view…"
          : "This view is unavailable";
      model.empty =
        subject && "message" in subject && subject.message
          ? subject.message
          : "Open this view to try again.";
    } else if (subject.kind === "project") {
      const overview = subject.overview,
        resources = Object.values(overview.resourcesByKind).reduce(
          (total, count) => total + (count ?? 0),
          0,
        );
      model.heading = overview.project.title;
      model.subtitle = "Project overview";
      model.metrics = [
        {
          label: "Workspaces",
          value:
            String(overview.workspaces.length) +
            (overview.workspaceListComplete ? "" : "+"),
        },
        {
          label: "Resources",
          value:
            String(resources) + (overview.resourceCountsComplete ? "" : "+"),
        },
        {
          label: "Open tasks",
          value:
            String(overview.tasks.open) +
            (overview.resourceCountsComplete ? "" : "+"),
        },
      ];
      model.rows = overview.workspaces.slice(0, 3).map((workspace) => ({
        id: workspace.id,
        title: workspace.title,
        detail: "Workspace",
        target: "workspace",
      }));
      model.empty = "No accessible workspaces in this project.";
    } else {
      const page = subject.page;
      model.query = subject.query;
      model.heading = page.scopeTitle ?? "";
      model.subtitle =
        kind === "collection_browser"
          ? "Items in this collection"
          : "Your resources";
      model.rows = page.resources.slice(0, 4).map((resource) => ({
        id: resource.id,
        title: resource.title,
        detail:
          resource.kind.replaceAll("_", " ") +
          (resource.placementCountComplete && resource.placementCount === 0
            ? " · Unplaced"
            : ""),
        target: "resource",
        canAttach: true,
      }));
      model.empty = page.nextCursor
        ? "No matching items on this page. Open the browser to continue."
        : "No matching resources in this scope.";
    }
  } else {
    const text = document(content);
    model.heading = text.heading;
    model.paragraphs = text.paragraphs;
    if (kind === "note") {
      model.layout = "document";
      model.subtitle = content.trim()
        ? content.trim().split(/\s+/).length + " words"
        : "A place to write";
      model.empty = "Write directly in this note.";
    } else {
      model.layout = kind === "research" ? "research" : "reference";
      model.links = sourceLinks(content)
        .slice(0, 3)
        .map((url) => ({ url, domain: new URL(url).hostname }));
      model.subtitle = model.links.length
        ? model.links.length + " links shown · not retrieved"
        : kind === "research"
          ? "Questions, findings and sources"
          : "A source and its context";
      model.empty =
        kind === "research"
          ? "Collect a question, finding or source in the research view."
          : "Add a source URL or a reference note.";
    }
  }
  return model;
}
