import type { Resource } from "../application-contract/contracts.ts";
import type {
  BlockInstanceKind,
  BrowseResourcesPage,
  ProjectOverview,
} from "./contracts.ts";
import { sourceLinks } from "./source-links.ts";
import type { ChecklistDocument } from '../application-contract/checklist.ts';
import type { AgentBlockProjection } from './agent-view.ts';
import type { TimelineDocument } from '../timeline-product/contracts.ts';
import { timelineItemTime, timelineItemTitle, type TimelinePresentationWindow } from './timeline-presentation.ts';
import type { TaskObjectiveDocument } from '../task-product/contracts.ts';
import type { ClockTimerDocument } from '../timer-product/contracts.ts';
import { validateMediaMetadata, canonicalMediaUrl } from './media-policy.ts';

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
    | 'ledger'
    | 'agent'
    | 'chronology'
    | 'objective'
    | 'clock'
    | "timeline"
    | "project"
    | "table"
    | "collection"
    | "research"
    | "reference"
    | 'file'
    | 'link';
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
  timeline: 'Timeline',
  task_objective: 'Task Tracker',
  clock_timer: 'Clock & Timer',
  agent: 'Agent',
  conversation: "Conversation",
  note: "Note",
  task: "Manual Task",
  task_group: "Manual Task Group",
  checklist: 'Checklist',
  stream: "Activity",
  project_overview: "Project",
  resource_browser: "Resource Explorer",
  collection_browser: "Resource Explorer",
  research: "Research Notebook",
  reference: "Reference",
  file: 'File',
  link: 'Link',
} satisfies Record<BlockInstanceKind, string>;

/** Read-only projections of canonical data. Empty and unavailable are explicit;
 * no sample messages, activity, progress, source retrieval or metrics are invented. */
export function blockIdentity(input: {
  kind: BlockInstanceKind;
  resource?: Resource;
  content?: string;
  subject?: SubjectIdentity;
  events?: IdentityEvent[];
  checklist?: ChecklistDocument;
  agent?: AgentBlockProjection;
  timeline?: { document: TimelineDocument | null; window: TimelinePresentationWindow | null };
  taskObjective?: TaskObjectiveDocument | null;
  clockTimer?: ClockTimerDocument | null;
  disconnected?: boolean;
}): BlockIdentityModel {
  const { kind, resource } = input;
  const layouts = {
    timeline: 'chronology',
    task_objective: 'objective',
    clock_timer: 'clock',
    agent: 'agent',
    conversation: resource?.provider === "codex" ? "execution" : "chat",
    note: "document",
    task: "task",
    task_group: "checklist",
    checklist: 'ledger',
    stream: "timeline",
    project_overview: "project",
    resource_browser: "table",
    collection_browser: "collection",
    research: "research",
    reference: "reference",
    file: 'file',
    link: 'link',
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
  if (kind === 'file' || kind === 'link') {
    try {
      if (!resource?.media) throw new Error('Media source information is unavailable.');
      const metadata = validateMediaMetadata(resource.media);
      if (metadata.source !== kind) throw new Error('Media source type is unavailable.');
      model.label = ({ pdf: 'PDF', docx: 'Document', video: 'Video', image: 'Image', text: 'Text file', binary: 'File', web: 'Web link', youtube: 'YouTube' })[metadata.format];
      model.heading = metadata.name;
      if (metadata.source === 'file') {
        model.subtitle = metadata.mime || 'Original file';
        model.paragraphs = [metadata.byteLength.toLocaleString() + ' bytes', metadata.format === 'binary' ? 'Open the original in its external application.' : 'Open the original content in its reader.'];
      } else {
        model.subtitle = canonicalMediaUrl(metadata.url).hostname;
        model.paragraphs = [metadata.url, metadata.format === 'youtube' ? 'Playback requires an explicit action and native capability.' : 'Open the canonical source in your browser.'];
      }
    } catch {
      model.phase = 'unavailable'; model.subtitle = 'Source information unavailable'; model.empty = 'The canonical resource is retained. Reconnect its native source access.';
    }
    return model;
  }
  if (kind === "conversation") {
    const codex = resource?.provider === "codex";
    const ordinaryAI = !codex && !!resource?.providerId && resource.providerId !== 'local';
    model.layout = codex ? "execution" : "chat";
    model.label = codex ? "Codex" : ordinaryAI ? 'AI conversation' : "Local chat";
    model.subtitle = codex
      ? resource?.execution
        ? "Turn " + resource.execution.state
        : "Codex conversation"
      : ordinaryAI ? 'Ordinary conversation' : "Messages saved locally";
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
      "Manual task · " + (resource?.taskPriority ?? "priority not set");
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
  } else if (kind === 'clock_timer') {
    const clock = input.clockTimer;
    if (!clock || clock.resource.id !== resource?.id) {
      model.phase = input.clockTimer === null ? 'unavailable' : 'loading';
      model.subtitle = model.phase === 'loading' ? 'Loading clock & timers…' : 'Clock & timers unavailable';
      model.empty = 'Open this resource to inspect its saved timers and clocks.';
    } else {
      model.heading = clock.resource.title;
      model.subtitle = clock.timers.filter(timer => timer.state === 'running').length + ' running · ' + clock.timers.length + ' saved timers';
      model.rows = clock.timers.slice(0, 3).map(timer => ({ id: timer.id, title: timer.name,
        detail: (timer.due ? 'Awaiting host confirmation' : timer.state[0].toUpperCase() + timer.state.slice(1)) +
          (timer.timing.wallRecovery ? ' · wall-time recovery' : '') }));
      model.metrics = [{ label: 'Stopwatch', value: clock.stopwatch.state }, { label: 'World clocks', value: String(clock.worldClocks.length) }];
      model.empty = 'Add a named timer, use the stopwatch, or show a world clock.';
    }
  } else if (kind === 'task_objective') {
    const objective = input.taskObjective;
    if (!objective || objective.resource.id !== resource?.id) {
      model.phase = input.taskObjective === null ? 'unavailable' : 'loading'; model.subtitle = model.phase === 'loading' ? 'Loading objective…' : 'Objective unavailable';
      model.empty = 'Open this Task Tracker to inspect its authorized objective and manual decisions.';
    } else {
      model.heading = objective.resource.title;
      model.subtitle = 'Objective ' + objective.disposition + ' · manual verification ' + objective.verification + ' · acceptance ' + objective.acceptance.state;
      model.paragraphs = [excerpt(objective.definition.objective, 240)];
      model.rows = objective.definition.requirements.slice(0, 3).map(item => ({ id: item.id, title: item.text, detail: 'Requirement · definition version ' + objective.definitionVersion }));
      model.metrics = [{ label: 'Requirements', value: String(objective.definition.requirements.length) }, { label: 'Execution references', value: String(objective.attempts.length) }];
      model.empty = 'No separate requirements recorded. Outcome review still requires evidence.';
    }
  } else if (kind === 'timeline') {
    const projection = input.timeline, timeline = projection?.document, window = projection?.window;
    if (!timeline || !window || timeline.resource.id !== resource?.id || window.resourceId !== resource?.id || window.resourceVersion !== timeline.resource.version || window.viewDigest !== timeline.viewDigest) {
      model.phase = projection && !timeline ? 'unavailable' : 'loading'; model.subtitle = model.phase === 'loading' ? 'Loading saved timeline…' : 'Timeline unavailable';
      model.empty = 'Open the saved timeline to inspect its authorized retained events.';
    } else {
      model.heading = timeline.resource.title;
      const basis = window.timeAxis === 'reportedAt' ? 'Loaded reported events' : 'Loaded captures';
      model.subtitle = window.source.state === 'unavailable' ? 'Retained source unavailable' : basis + (window.gaps.length ? ' · evidence gaps' : '');
      if (window.sourceCoverage) model.subtitle += ' · ' + window.sourceCoverage.status + ' source coverage';
      model.metrics = [{ label: 'Loaded events', value: String(window.items.length) }];
      model.rows = window.items.slice(-4).reverse().map(item => ({
        id: String(item.event.cursor) + ':' + item.event.eventId,
        title: timelineItemTitle(item),
        detail: item.evidenceClass + ' · ' + (item.externalEvidence?.source.label ?? item.event.providerId),
        time: timelineItemTime(item, window.timeAxis),
      }));
      model.empty = window.source.state === 'unavailable' ? 'The retained event source is unavailable.' : 'No authorized captures in the loaded time window.';
    }
  } else if (kind === 'agent') {
    const agent = input.agent;
    if (!agent || agent.phase !== 'ready' || agent.profile.resource.id !== resource?.id) {
      model.phase = agent?.phase === 'unavailable' ? 'unavailable' : 'loading';
      model.subtitle = model.phase === 'loading' ? 'Loading saved agent…' : 'Agent unavailable';
      model.empty = 'Open the Agent Library to inspect this saved profile.';
    } else {
      model.heading = agent.profile.resource.title;
      model.subtitle = agent.configuration ? ({ supported: 'Configuration compatible · saved profile', 'needs-setup': 'Needs setup · saved profile', unsupported: 'Unsupported configuration', unknown: 'Configuration unknown' } as const)[agent.configuration.configurationState] : 'Saved profile · configuration unavailable';
      model.paragraphs = [excerpt(agent.profile.profile.purpose, 220)];
      model.empty = agent.profile.profile.specialties.slice(0, 3).join(' · ');
    }
  } else if (kind === 'checklist') {
    const checklist = input.checklist;
    if (!checklist || checklist.resource.id !== resource?.id) {
      model.phase = 'loading';
      model.subtitle = 'Loading checklist…';
      model.empty = 'Open this checklist to read its saved items.';
    } else {
      const checked = checklist.entries.filter(entry => entry.checked).length;
      model.subtitle = `${checked} of ${checklist.entries.length} checked · ${checklist.syncPolicy}`;
      model.rows = checklist.entries.slice(0, 4).map(entry => ({
        id: entry.id, title: (entry.checked ? '✓ ' : '○ ') + entry.text,
        detail: [entry.priority === 'normal' ? '' : entry.priority, entry.dueDate ? 'Due ' + entry.dueDate : '',
          entry.checked ? (entry.completion?.basis === 'user-approved' ? 'User-approved update' : 'Checked manually') : '',
          checklist.groups.find(group => group.id === entry.groupId)?.title ?? ''].filter(Boolean).join(' · '),
      }));
      model.empty = 'Add your first item. No provider is required.';
    }
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
          ? "Collection membership"
          : "Resources in this saved scope";
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
