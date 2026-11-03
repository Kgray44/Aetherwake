import type {
  BlockLibraryHostPort,
  BlockKind,
  BlockCategory,
  CreatedBlock,
  LibraryCapabilities,
  TemplateMountOptions,
  WorkspaceTemplatePort,
  WorkspaceTemplate,
  TemplateApplyInput,
  CaptureChoices,
  VelaTemplatePlan,
  LibraryPreferences,
  BlockConfiguration,
  TemplatePlacementRole,
  SubjectCaptureChoices,
  BlockInstanceKind,
  SubjectBlockKind,
  CreatedSubjectBlock,
  SubjectTargets,
  LibraryRecommendationContext,
  ResourceDiscoveryInput,
} from "./contracts.ts";
import {
  searchBlocks,
  blockDefinition,
  blockAvailability,
  blockCapabilities,
  searchBlockCatalog,
  catalogDefinition,
  isSubjectBlockKind,
  subjectBlockKind,
  BUILTIN_BLOCKS,
  REGISTERED_BLOCKS,
  recommendBlocks,
} from "./registry.ts";
import { captureWorkspaceTemplate } from "./model.ts";
import { blockPreview } from "./preview.ts";
import type { Geometry } from '../workspace-engine/contracts.mts';
import { mountLibraryDrop, type LibraryDropOptions } from './placement-drop.ts';

const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
const button = (text: string, run: () => void) => {
  const element = node("button", "aw-library__button", text);
  element.type = "button";
  element.onclick = run;
  return element;
};
const field = (label: string, input: HTMLElement) => {
  const element = node("label", "aw-library__field", label);
  element.append(input);
  return element;
};
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.replaceAll("_", " ")
    : "The host could not complete this operation.";
const commandId = () => "library:" + crypto.randomUUID();
const placementLabel = (
  template: WorkspaceTemplate,
  placement: TemplatePlacementRole,
) =>
  placement.resourceKey !== undefined
    ? (template.body.resources.find(
        (role) => role.key === placement.resourceKey,
      )?.label ?? "Unavailable resource role")
    : placement.subjectBinding.mode === "project-context"
      ? placement.subjectBinding.view === "project"
        ? "Current project overview"
        : "Current project resources"
      : placement.subjectBinding.subject.kind === "project"
        ? "Project overview"
        : placement.subjectBinding.subject.kind === "collection"
          ? "Resource Explorer — Collection"
          : "Resource Explorer — Resources";
const kindTitle = (kind: BlockInstanceKind) => REGISTERED_BLOCKS.find(definition => definition.kind === kind)?.title ?? 'Unavailable block';
const placementKind = (template: WorkspaceTemplate, placement: TemplatePlacementRole): BlockInstanceKind | undefined =>
  placement.resourceKey !== undefined
    ? template.body.resources.find(role => role.key === placement.resourceKey)?.source.kind
    : placement.subjectBinding.mode === 'project-context'
      ? placement.subjectBinding.view === 'project' ? 'project_overview' : 'resource_browser'
      : subjectBlockKind(placement.subjectBinding.subject);
function shell(root: HTMLElement, title: string, onClose: () => void, showHeader = true) {
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const panel = node("section", "aw-library");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", title);
  const header = node("header", "aw-library__header"),
    heading = node("h2", "", title),
    close = button("Close", onClose);
  header.append(heading, close);
  const status = node("p", "aw-library__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const body = node("div", "aw-library__body");
  if (showHeader) panel.append(header);
  panel.append(status, body);
  root.append(panel);
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };
  panel.addEventListener("keydown", escape);
  let disposed = false;
  return {
    panel,
    body,
    status,
    get disposed() {
      return disposed;
    },
    dispose() {
      disposed = true;
      panel.removeEventListener("keydown", escape);
      panel.remove();
      previousFocus?.focus();
    },
  };
}

/** Contextual Add surface only. Created blocks open the parent's existing canonical controls. */
export function mountBlockLibrary(
  root: HTMLElement,
  port: BlockLibraryHostPort,
  options: {
    workspaceId: string;
    expectedLayoutVersion: number | (() => number);
    /** Read fresh usable world bounds for this exact workspace when submitting. */
    bounds?(): Geometry | undefined;
    onCreated(result: CreatedBlock, origin?: 'drop'): void | Promise<void>;
    onSubjectCreated?(result: CreatedSubjectBlock, origin?: 'drop'): void | Promise<void>;
    drop?: LibraryDropOptions;
    showHeader?: boolean;
    context?(): LibraryRecommendationContext | null;
    onClose(): void;
  },
) {
  const ui = shell(root, "Block Library", options.onClose, options.showHeader),
    search = node("input"),
    category = node("select"),
    discovery = node("select"),
    toolbar = node("details", "aw-library__filters"),
    filterFields = node("div", "aw-library__toolbar"),
    columns = node("div", "aw-library__columns"),
    list = node("div", "aw-library__list"),
    detail = node("div", "aw-library__detail");
  search.type = "search";
  search.maxLength = 500;
  ui.panel.className += ' aw-library--blocks';
  search.placeholder = "Find a block…";
  search.setAttribute("aria-label", "Search blocks");
  for (const [value, label] of [
    ["", "All categories"],
    ["conversation", "Conversation"],
    ["knowledge", "Knowledge"],
    ["planning", "Planning"],
    ['intelligence', 'Intelligence'],
    ["observability", "Observability"],
    ["organization", "Organization"],
  ]) {
    const option = node("option", "", label);
    option.value = value;
    category.append(option);
  }
  for (const [value, label] of [
    ["all", "All blocks"],
    ["favorites", "Favorites"],
    ["recent", "Recently used"],
    ["recommended", "Recommended for this workspace"],
    ["compatible", "Available here"],
  ]) {
    const option = node("option", "", label);
    option.value = value;
    discovery.append(option);
  }
  category.setAttribute("aria-label", "Block category");
  discovery.setAttribute("aria-label", "Block discovery");
  filterFields.append(category, discovery);
  toolbar.append(node('summary', '', 'Browse filters'), filterFields);
  columns.append(list, detail);
  ui.body.append(search, toolbar, columns);
  let capabilities: LibraryCapabilities | null = null,
    preferences: LibraryPreferences | null = null,
    selected: BlockInstanceKind = "conversation",
    pending = false,
    detailSequence = 0;
  const placementBounds = () => {
    const bounds = options.bounds?.();
    return bounds ? { bounds } : {};
  };
  const revision = () =>
    typeof options.expectedLayoutVersion === "function"
      ? options.expectedLayoutVersion()
      : options.expectedLayoutVersion;
  const drop = options.drop && mountLibraryDrop(ui.panel, options.drop, revision, error => {
    if (!ui.disposed) ui.status.textContent = errorText(error);
  });
  type DropPoint = { x: number; y: number };
  const atDrop = <T extends { width: number; height: number }>(size: T, point?: DropPoint) =>
    point ? { ...size, x: point.x - size.width / 2, y: point.y - size.height / 2 } : size;
  if (drop) ui.body.insertBefore(node('p', 'aw-library__grab-hint', 'Drag a ready block onto the workspace, or choose one to configure.'), columns);
  const pendingButtons = new Map<HTMLButtonElement, boolean>();
  const commandButtonState = (button: HTMLButtonElement, disabled: boolean) => {
    if (pending) pendingButtons.set(button, disabled);
    button.disabled = pending || disabled;
  };
  async function performResult<T>(
    work: () => Promise<T>,
    created: (result: T) => void | Promise<void>,
  ) {
    if (pending) return;
    pending = true;
    let saved = false;
    ui.panel.setAttribute("aria-busy", "true");
    ui.status.textContent = "Saving workspace placement…";
    detail
      .querySelectorAll<HTMLButtonElement>(
        "button[type=submit], [data-attach-resource]",
      )
      .forEach((b) => commandButtonState(b, b.disabled));
    try {
      const result = await work();
      saved = true;
      if (ui.disposed) return;
      ui.status.textContent = "Block saved.";
      try {
        await created(result);
      } catch (error) {
        if (!ui.disposed)
          ui.status.textContent =
            "Block saved. Could not open it: " + errorText(error);
      }
      if (ui.disposed) return;
      if (port.preferences) {
        try {
          preferences = await port.preferences();
        } catch {
          if (!ui.disposed)
            ui.status.textContent += " Recent items could not be refreshed.";
        }
      }
    } catch (error) {
      if (!ui.disposed) {
        ui.status.textContent = errorText(error);
      }
    } finally {
      pending = false;
      ui.panel.removeAttribute("aria-busy");
      if (!ui.disposed) {
        if (saved) {
          renderList();
          showDetail();
        } else {
          // A rejected command must retain the actual form, input selection and
          // presentation choices. A second Add uses the current layout fence.
          for (const [button, disabled] of pendingButtons)
            if (button.isConnected) button.disabled = disabled;
        }
      }
      pendingButtons.clear();
    }
  }
  const perform = (work: () => Promise<CreatedBlock>, point?: DropPoint) =>
    performResult(work, result => options.onCreated(result, point ? 'drop' : undefined));
  const showDetail = () => {
    const generation = ++detailSequence;
    detail.replaceChildren();
    if (!capabilities) return;
    if (isSubjectBlockKind(selected)) {
      showSubjectDetail(selected, generation);
      return;
    }
    const definition = blockDefinition(selected),
      available = blockAvailability(selected, capabilities),
      title = node("input");
    title.value = definition.title;
    title.maxLength = 120;
    title.required = true;
    const heading = node("h3", "", definition.title),
      description = node("p", "", definition.description),
      controls = node("ul"),
      kind = selected;
    for (const capability of blockCapabilities(kind, capabilities))
      controls.append(
        node(
          "li",
          "",
          capability.id.replaceAll("-", " ") +
            " · " +
            capability.availability.state +
            (capability.availability.reason
              ? " — " + capability.availability.reason
              : ""),
        ),
      );
    const favorite = button(
      preferences?.favorites.includes(kind) ? "★ Favorited" : "☆ Favorite",
      () => {
        if (!port.setFavorite || !preferences || pending) return;
        const before = preferences;
        favorite.disabled = true;
        void port
          .setFavorite({
            kind,
            favorite: !before.favorites.includes(kind),
            expectedVersion: before.version,
          })
          .then((value) => {
            preferences = value;
            if (!ui.disposed) {
              renderList();
              showDetail();
            }
          })
          .catch(async (error) => {
            if (ui.disposed) return;
            ui.status.textContent = errorText(error);
            if (port.preferences)
              try {
                preferences = await port.preferences();
              } catch {}
            if (!ui.disposed) showDetail();
          });
      },
    );
    favorite.disabled = !preferences || !port.setFavorite || pending;
    const form = node("form"),
      provider = node("select");
    const automatic = capabilities.providers.automatic;
    if (automatic?.state !== 'available') {
      const choose = node('option', '', 'Choose a conversation type');
      choose.value = '__choose'; choose.disabled = true; choose.selected = true; provider.append(choose);
    }
    const later = node(
      "option",
      "",
      "Automatic ordinary chat" + (automatic?.state === 'available' ? '' : ' — ' + (automatic?.reason ?? automatic?.state ?? 'unknown')),
    );
    later.value = "";
    later.disabled = automatic?.state !== 'available';
    provider.append(later);
    if (selected === "conversation")
      for (const name of ["local", "codex"] as const) {
        const state = capabilities.providers[name];
        const option = node(
          "option",
          "",
          (name === 'local' ? 'Local — manual conversation' : 'Codex') + " — " + (state?.reason ?? state?.state ?? "unknown"),
        );
        option.value = name;
        option.disabled = state?.state !== "available";
        provider.append(option);
      }
    provider.value = automatic?.state === 'available' ? '' : '__choose';
    const providerAvailable = () => kind !== 'conversation' || (provider.value === '' ? automatic?.state === 'available'
      : ['local', 'codex'].includes(provider.value) && capabilities?.providers[provider.value as 'local' | 'codex']?.state === 'available');
    const create = node(
      "button",
      "aw-library__button",
      "Add New " + definition.title,
    );
    create.type = "submit";
    commandButtonState(create, available.state !== "available" || !providerAvailable());
    provider.onchange = () => commandButtonState(create, available.state !== 'available' || !providerAvailable());
    const settings = node("details"),
      settingsHeading = node("summary", "", "Configure presentation"),
      shape = node("select"),
      width = node("input"),
      height = node("input"),
      scale = node("select"),
      mode = node("select");
    for (const value of definition.supportedShapes) {
      const option = node("option", "", value);
      option.value = value;
      shape.append(option);
    }
    shape.value = definition.defaultPresentation.shape;
    for (const [input, value, min] of [
      [
        width,
        definition.defaultPresentation.width,
        definition.minimumSize.width,
      ],
      [
        height,
        definition.defaultPresentation.height,
        definition.minimumSize.height,
      ],
    ] as const) {
      input.type = "number";
      input.min = String(min);
      input.max = "4096";
      input.value = String(value);
      input.required = true;
    }
    for (const value of [0.75, 1, 1.25, 1.5, 2]) {
      const option = node("option", "", Math.round(value * 100) + "%");
      option.value = String(value);
      scale.append(option);
    }
    scale.value = "1";
    for (const value of ["auto", "compact", "reading"]) {
      const option = node("option", "", value);
      option.value = value;
      mode.append(option);
    }
    settings.append(
      settingsHeading,
      field("Shape", shape),
      field("Width", width),
      field("Height", height),
    );
    // Older native hosts can still add geometry without promising unsupported preference persistence.
    if (port.configureBlock)
      settings.append(
        field("Text scale", scale),
        field("Content presentation", mode),
      );
    const placement = () => ({
      shape: shape.value as typeof definition.defaultPresentation.shape,
      width: Number(width.value),
      height: Number(height.value),
    });
    const configuration = (): BlockConfiguration => ({
      schemaVersion: 1,
      textScale: Number(scale.value),
      contentMode: mode.value as BlockConfiguration["contentMode"],
    });
    form.append(field("Title", title));
    if (selected === "conversation")
      form.append(field("Conversation backend", provider));
    form.append(create);
    if (available.state !== "available")
      form.append(
        node(
          "p",
          "aw-library__limitation",
          available.reason ?? "Unavailable: " + available.state,
        ),
      );
    form.append(settings);
    const createBlock = (point?: DropPoint) => {
      if (create.disabled || !form.reportValidity()) return;
      if (!providerAvailable()) { ui.status.textContent = 'Choose an available conversation type.'; return; }
      void perform(() =>
        port.createBlock({
          commandId: commandId(),
          workspaceId: options.workspaceId,
          expectedLayoutVersion: revision(),
          kind,
          title: title.value,
          presentation: atDrop(placement(), point),
          ...placementBounds(),
          ...(port.configureBlock ? { configuration: configuration() } : {}),
          ...(kind === "conversation" && provider.value
            ? { provider: provider.value as "local" | "codex" }
            : {}),
        }), point,
      );
    };
    form.onsubmit = event => { event.preventDefault(); createBlock(); };
    if (!definition.creation && kind !== 'file' && kind !== 'link') {
      drop?.bind(create, { label: definition.title, place: createBlock });
    }
    const attach = node("details"),
      attachHeading = node("summary", "", "Attach Existing"),
      resourceSearch = node("input"),
      scopeFilters = node("details", "aw-library__scope-filters"),
      projectScope = node("select"),
      collectionScope = node("select"),
      scopeStatus = node("p", "aw-library__hint"),
      resourceList = node("div", "aw-library__resources"),
      more = button("Load more resources", () => {
        void loadResources(true);
      });
    resourceSearch.type = "search";
    resourceSearch.placeholder = "Search compatible resources";
    resourceSearch.setAttribute(
      "aria-label",
      "Search existing " + definition.title + " resources",
    );
    more.hidden = true;
    projectScope.setAttribute(
      "aria-label",
      "Filter compatible resources by project",
    );
    collectionScope.setAttribute(
      "aria-label",
      "Filter compatible resources by collection",
    );
    for (const [value, title] of [
      ["compatible", "All compatible resources"],
      ["workspace-project", "Workspace project only"],
      ["unassigned", "Unassigned resources only"],
    ]) {
      const option = node("option", "", title);
      option.value = value;
      projectScope.append(option);
    }
    projectScope.value = "compatible";
    projectScope.disabled =
      capabilities?.discoveryFilters?.project?.state !== "available";
    const allCollections = node("option", "", "All resources");
    allCollections.value = "";
    collectionScope.append(allCollections);
    collectionScope.value = "";
    collectionScope.disabled = true;
    scopeStatus.setAttribute("role", "status");
    scopeFilters.append(
      node("summary", "", "Filter resources"),
      field("Project", projectScope),
      field("Collection", collectionScope),
      scopeStatus,
    );
    let scopeTargetsLoading = false,
      scopeTargetsLoaded = false;
    const loadScopeTargets = async () => {
      if (scopeTargetsLoaded || scopeTargetsLoading) return;
      if (
        !port.subjectTargets ||
        capabilities?.discoveryFilters?.collection?.state !== "available"
      ) {
        scopeStatus.textContent =
          "Collection filtering is unavailable in this host. Compatible search remains available.";
        return;
      }
      scopeTargetsLoading = true;
      scopeStatus.textContent = "Loading accessible collections…";
      try {
        const targets = await port.subjectTargets(options.workspaceId);
        if (ui.disposed || generation !== detailSequence) return;
        for (const collection of targets.collections) {
          const option = node("option", "", collection.title);
          option.value = collection.id;
          collectionScope.append(option);
        }
        collectionScope.disabled = false;
        scopeTargetsLoaded = true;
        scopeStatus.textContent = targets.truncated
          ? "The collection list is bounded; additional collections may be omitted."
          : "Filters narrow the resources compatible with this workspace.";
      } catch {
        if (!ui.disposed && generation === detailSequence)
          scopeStatus.textContent =
            "Could not load collections. Reopen these filters to retry; compatible search remains available.";
      } finally {
        scopeTargetsLoading = false;
      }
    };
    scopeFilters.ontoggle = () => {
      if (scopeFilters.open) void loadScopeTargets();
    };
    let cursor: string | null = null,
      querySequence = 0;
    const queried = node("p", "aw-library__hint");
    async function loadResources(append = false) {
      if (!port.findResources || !port.attachBlock) return;
      const request = ++querySequence;
      queried.textContent = "Finding authorized resources…";
      if (!append) {
        resourceList.replaceChildren();
        cursor = null;
        more.hidden = true;
      }
      try {
        const page = await port.findResources({
          workspaceId: options.workspaceId,
          kind,
          query: resourceSearch.value,
          ...(projectScope.value !== "compatible"
            ? {
                projectScope:
                  projectScope.value as ResourceDiscoveryInput["projectScope"],
              }
            : {}),
          ...(collectionScope.value
            ? { collectionId: collectionScope.value }
            : {}),
          ...(append && cursor ? { afterId: cursor } : {}),
        });
        if (
          ui.disposed ||
          generation !== detailSequence ||
          request !== querySequence
        )
          return;
        if (!append) resourceList.replaceChildren();
        cursor = page.nextCursor;
        more.hidden = !cursor;
        queried.textContent =
          "Resources from this project and unassigned resources. Attachment preserves content and identity.";
        if (!page.resources.length && !append)
          resourceList.append(
            node("p", "", "No compatible resources on this page."),
          );
        for (const resource of page.resources) {
          const row = node("div", "aw-library__resource-row"),
            label = node("div", "", resource.title);
          label.append(node("small", "", kindTitle(resource.kind)));
          const placeResource = (point?: DropPoint) => {
            void perform(() =>
              port.attachBlock!({
                commandId: commandId(),
                workspaceId: options.workspaceId,
                expectedLayoutVersion: revision(),
                kind,
                resourceId: resource.id,
                expectedResourceVersion: resource.version,
                presentation: atDrop(placement(), point),
                ...placementBounds(),
                ...(port.configureBlock
                  ? { configuration: configuration() }
                  : {}),
              }), point,
            );
          };
          const action = button("Attach " + resource.title, () => placeResource());
          drop?.bind(action, { label: resource.title, place: placeResource });
          action.dataset.attachResource = resource.id;
          commandButtonState(action, available.state !== "available");
          row.append(label, action);
          resourceList.append(row);
        }
      } catch (error) {
        if (
          !ui.disposed &&
          generation === detailSequence &&
          request === querySequence
        ) {
          resourceList.replaceChildren();
          cursor = null;
          more.hidden = true;
          queried.textContent = errorText(error);
        }
      }
    }
    attach.append(attachHeading);
    if (port.findResources && port.attachBlock) {
      attach.append(resourceSearch, scopeFilters, queried, resourceList, more);
      attach.ontoggle = () => {
        if (attach.open) void loadResources();
      };
      resourceSearch.oninput = () => {
        void loadResources();
      };
      projectScope.onchange = collectionScope.onchange = () => {
        void loadResources();
      };
    } else
      attach.append(
        node(
          "p",
          "aw-library__limitation",
          "This native host has not connected resource attachment to the library.",
        ),
      );
    const notes = node('details', 'aw-library__capabilities');
    notes.append(node('summary', '', 'Preview and capabilities'), blockPreview(kind), node('p', 'aw-library__hint', definition.preview), controls);
    const detailHeader = node('header', 'aw-library__detail-heading');
    detailHeader.append(heading, favorite);
    detail.append(detailHeader, description, form, attach, notes);
    if (definition.creation === 'reference-only') {
      form.onsubmit = event => { event.preventDefault(); };
      create.disabled = true; form.remove(); attach.open = true;
      attachHeading.textContent = kind === 'agent' ? 'Choose a saved agent' : kind === 'task_objective' ? 'Choose a saved task objective' : 'Choose a saved timeline';
      detail.insertBefore(node('p', 'aw-library__hint', kind === 'agent'
        ? 'Create and configure agent profiles in the Agent Library, then attach the same saved agent here.'
        : kind === 'task_objective' ? 'Create a Task Objective independently, then attach the same objective with its requirements and review history here.'
        : 'Create and configure a Timeline independently, then attach the same saved time view here.'), attach);
      attach.append(settings);
      if (port.findResources && port.attachBlock) void loadResources();
    }
  };
  function showSubjectDetail(kind: SubjectBlockKind, generation: number) {
    const definition = catalogDefinition(kind),
      available = blockAvailability(kind, capabilities!),
      form = node("form"),
      target = node("select"),
      query = node("input"),
      resourceKind = node("select"),
      width = node("input"),
      height = node("input"),
      shape = node("select"),
      status = node("p", "aw-library__hint"),
      create = node("button", "aw-library__button", "Add view");
    let targets: SubjectTargets | null = null;
    create.type = "submit";
    create.disabled = true;
    target.required = true;
    query.type = "search";
    query.maxLength = 500;
    query.setAttribute("aria-label", "Saved resource query");
    const favorite = button(
      preferences?.favorites.includes(kind) ? "★ Favorited" : "☆ Favorite",
      () => {
        if (!port.setFavorite || !preferences || pending) return;
        favorite.disabled = true;
        void port
          .setFavorite({
            kind,
            favorite: !preferences.favorites.includes(kind),
            expectedVersion: preferences.version,
          })
          .then((value) => {
            preferences = value;
            if (!ui.disposed) {
              renderList();
              showDetail();
            }
          })
          .catch((error) => {
            if (!ui.disposed) ui.status.textContent = errorText(error);
          });
      },
    );
    favorite.disabled = !port.setFavorite || !preferences || pending;
    for (const definition of BUILTIN_BLOCKS) {
      const option = node("option", "", definition.title);
      option.value = definition.kind;
      resourceKind.append(option);
    }
    const all = node("option", "", "All resource kinds");
    all.value = "";
    resourceKind.prepend(all);
    resourceKind.value = "";
    for (const value of definition.supportedShapes) {
      const option = node("option", "", value);
      option.value = value;
      shape.append(option);
    }
    shape.value = definition.defaultPresentation.shape;
    for (const [input, value, min] of [
      [width, definition.defaultPresentation.width, 128],
      [height, definition.defaultPresentation.height, 96],
    ] as const) {
      input.type = "number";
      input.value = String(value);
      input.min = String(min);
      input.max = "4096";
      input.required = true;
    }
    const settings = node("details"),
      summary = node("summary", "", "Configure presentation");
    settings.append(
      summary,
      field("Shape", shape),
      field("Width", width),
      field("Height", height),
    );
    const controls = node("ul");
    for (const capability of definition.controls)
      controls.append(node("li", "", capability));
    form.append(
      field(
        kind === "collection_browser" ? "Collection" : "Project scope",
        target,
      ),
    );
    if (kind === "resource_browser")
      form.append(
        field("Search within resource titles and IDs", query),
        field("Resource kind", resourceKind),
      );
    form.append(create, settings, status);
    const notes = node('details', 'aw-library__capabilities');
    notes.append(node('summary', '', 'Preview and capabilities'), blockPreview(kind), controls);
    const detailHeader = node('header', 'aw-library__detail-heading');
    detailHeader.append(node('h3', '', definition.title), favorite);
    detail.append(detailHeader, node('p', '', definition.description), form, notes);
    const connected =
      !!port.subjectTargets &&
      !!port.createSubjectBlock &&
      !!options.onSubjectCreated;
    if (!connected) {
      status.textContent =
        "This native host has not connected subject views to the library.";
      return;
    }
    status.textContent = "Reading authorized local subjects…";
    void port.subjectTargets!(options.workspaceId)
      .then((value) => {
        if (ui.disposed || generation !== detailSequence) return;
        targets = value;
        target.replaceChildren();
        const placeholder = node(
          "option",
          "",
          "Choose a " +
            (kind === "collection_browser" ? "collection" : "project"),
        );
        placeholder.value = "";
        placeholder.disabled = true;
        target.append(placeholder);
        if (kind === "resource_browser" && value.globalQueryAllowed) {
          const option = node(
            "option",
            "",
            "All authorized projects and unassigned resources",
          );
          option.value = "*";
          target.append(option);
        }
        const rows =
          kind === "collection_browser" ? value.collections : value.projects;
        for (const item of rows) {
          const option = node(
            "option",
            "",
            item.title + " · " + item.id.slice(0, 8),
          );
          option.value = item.id;
          target.append(option);
        }
        target.value =
          kind !== "collection_browser" &&
          value.projects.some((project) => project.id === value.projectId)
            ? value.projectId!
            : kind === "resource_browser" && value.globalQueryAllowed
              ? "*"
              : "";
        const ready = () => {
          commandButtonState(
            create,
            available.state !== "available" || !target.value,
          );
        };
        target.onchange = ready;
        ready();
        status.textContent =
          available.state !== "available"
            ? (available.reason ?? "Subject view is " + available.state)
            : value.truncated
              ? "The first authorized subjects are listed; the native catalog page is bounded."
              : "Canonical local data only. Each read and placement is checked again by the trusted host.";
      })
      .catch((error) => {
        if (!ui.disposed && generation === detailSequence)
          status.textContent = errorText(error);
      });
    const createSubject = (point?: DropPoint) => {
      if (
        create.disabled ||
        !targets ||
        !port.createSubjectBlock ||
        !options.onSubjectCreated ||
        !form.reportValidity()
      )
        return;
      const subject =
        kind === "project_overview"
          ? { kind: "project" as const, projectId: target.value }
          : kind === "collection_browser"
            ? { kind: "collection" as const, collectionId: target.value }
            : {
                kind: "resource-query" as const,
                projectId: target.value === "*" ? null : target.value || null,
                query: query.value,
                ...(resourceKind.value ? { kinds: [resourceKind.value] } : {}),
              };
      void performResult(
        () =>
          port.createSubjectBlock!({
            commandId: commandId(),
            workspaceId: options.workspaceId,
            expectedLayoutVersion: revision(),
            kind,
            subject,
            ...placementBounds(),
            presentation: atDrop({
              shape: shape.value as typeof definition.defaultPresentation.shape,
              width: Number(width.value),
              height: Number(height.value),
            }, point),
          }),
        result => options.onSubjectCreated!(result, point ? 'drop' : undefined),
      );
    };
    form.onsubmit = event => { event.preventDefault(); createSubject(); };
    drop?.bind(create, { label: definition.title, place: createSubject });
  }
  const renderList = () => {
    if (!capabilities) return;
    list.replaceChildren();
    const results = searchBlockCatalog(
      search.value,
      capabilities,
      (category.value || undefined) as BlockCategory | undefined,
    );
    const recommendations = recommendBlocks(
        options.context?.() ?? null,
        capabilities,
      ),
      reasons = new Map(
        recommendations.map((item) => [item.kind, item.reason]),
      );
    const filtered = results.filter((d) =>
      discovery.value === "favorites"
        ? preferences?.favorites.includes(d.kind)
        : discovery.value === "recent"
          ? preferences?.recent.includes(d.kind)
          : discovery.value === "recommended"
            ? reasons.has(d.kind)
            : discovery.value === "compatible"
              ? d.availability.state === "available"
              : true,
    );
    if (discovery.value === "recommended")
      list.append(
        node(
          "p",
          "aw-library__hint",
          "Based on this workspace’s project and block types. Only available types are suggested.",
        ),
      );
    if (discovery.value === "recent")
      filtered.sort(
        (a, b) =>
          (preferences?.recent.indexOf(a.kind) ?? 0) -
          (preferences?.recent.indexOf(b.kind) ?? 0),
      );
    if (!filtered.length)
      list.append(
        node(
          "p",
          "",
          discovery.value === "recommended"
            ? "No available recommendations match the current workspace metadata and filters."
            : "No matching block types.",
        ),
      );
    const groups = new Map<string, HTMLElement>();
    const groupFor = (category: BlockCategory) => {
      const recent = discovery.value === 'recent';
      const key = recent ? 'recent' : category;
      const existing = groups.get(key);
      if (existing) return existing;
      const group = node('section', 'aw-library__group');
      group.dataset.category = key;
      group.append(node('h4', '', recent ? 'Recently used' : category[0].toUpperCase() + category.slice(1)));
      groups.set(key, group);
      list.append(group);
      return group;
    };
    for (const definition of filtered) {
      const item = button(
        (preferences?.favorites.includes(definition.kind) ? "★ " : "") +
          definition.title +
          (definition.availability.state === "available"
            ? ""
            : " · " + definition.availability.state),
        () => {
          if (pending) return;
          selected = definition.kind;
          renderList();
          showDetail();
        },
      );
      item.setAttribute("aria-pressed", String(definition.kind === selected));
      item.dataset.blockKind = definition.kind;
      item.dataset.blockType = definition.id;
      if (discovery.value === "recommended")
        item.append(
          node(
            "small",
            "aw-library__hint",
            "Suggested because: " + reasons.get(definition.kind),
          ),
        );
      const { kind } = definition;
      if (!isSubjectBlockKind(kind) && kind !== 'file' && kind !== 'link' &&
          definition.availability.state === 'available' && !blockDefinition(kind).creation &&
          (kind !== 'conversation' || capabilities.providers.automatic?.state === 'available')) {
        const { width, height, shape } = blockDefinition(kind).defaultPresentation;
        drop?.bind(item, { label: definition.title, place: point => {
          void perform(() => port.createBlock({
            commandId: commandId(), workspaceId: options.workspaceId, expectedLayoutVersion: revision(),
            kind, title: definition.title, presentation: atDrop({ width, height, shape }, point), ...placementBounds(),
          }), point);
        } });
      }
      groupFor(catalogDefinition(kind).category).append(item);
    }
  };
  search.oninput = renderList;
  category.onchange = renderList;
  discovery.onchange = renderList;
  ui.status.textContent = "Reading host capabilities…";
  void Promise.all([
    port.capabilities(),
    port.preferences?.() ?? Promise.resolve(null),
  ])
    .then(([value, prefs]) => {
      if (ui.disposed) return;
      capabilities = value;
      preferences = prefs;
      ui.status.textContent = "";
      renderList();
      showDetail();
      search.focus();
    })
    .catch((error) => {
      if (!ui.disposed) ui.status.textContent = errorText(error);
    });
  return {
    frame: () => drop?.frame(),
    dispose() { drop?.dispose(); ui.dispose(); },
    refreshCapabilities: async () => {
      const value = await port.capabilities();
      if (!ui.disposed) {
        capabilities = value;
        renderList();
        showDetail();
      }
    },
  };
}

export function mountWorkspaceTemplates(
  root: HTMLElement,
  port: WorkspaceTemplatePort,
  options: TemplateMountOptions,
) {
  const ui = shell(root, "New Workspace", options.onClose),
    toolbar = node("div", "aw-library__toolbar"),
    search = node("input"),
    archived = node("input"),
    columns = node("div", "aw-library__columns"),
    list = node("div", "aw-library__list"),
    detail = node("div", "aw-library__detail");
  search.type = "search";
  search.placeholder = "Search workspace templates";
  search.setAttribute("aria-label", "Search workspace templates");
  archived.type = "checkbox";
  const saveCurrent = button("Save current workspace as template", () =>
      showSaveCurrent(),
    ),
    ask = button("Ask Vela", () => showVela());
  saveCurrent.disabled = !options.currentWorkspace;
  toolbar.append(saveCurrent, ask, field("Include archived", archived));
  columns.append(list, detail);
  ui.body.append(search, toolbar, columns);
  let pending = false,
    sequence = 0,
    capabilities: LibraryCapabilities | null = null;
  async function run<T>(
    message: string,
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    if (pending) return;
    pending = true;
    ui.panel.setAttribute("aria-busy", "true");
    ui.status.textContent = message;
    try {
      const result = await operation();
      if (!ui.disposed) {
        ui.status.textContent = "";
        return result;
      }
    } catch (error) {
      if (!ui.disposed) ui.status.textContent = errorText(error);
    } finally {
      pending = false;
      ui.panel.removeAttribute("aria-busy");
    }
  }
  async function refresh() {
    const request = ++sequence;
    try {
      const templates = await port.listTemplates({
        query: search.value,
        includeArchived: archived.checked,
      });
      if (ui.disposed || request !== sequence) return;
      list.replaceChildren();
      if (!templates.length) list.append(node("p", "", "No templates found."));
      for (const template of templates) {
        const item = button(
          template.name +
            " · " +
            template.mode +
            " · " +
            template.placementCount +
            " blocks" +
            (template.state === "archived" ? " · archived" : ""),
          () => {
            void run("Loading template…", () =>
              port.getTemplate(template.id),
            ).then((value) => {
              if (value) showTemplate(value);
            });
          },
        );
        item.dataset.templateId = template.id;
        list.append(item);
      }
    } catch (error) {
      if (!ui.disposed) ui.status.textContent = errorText(error);
    }
  }
  function previewLayout(template: WorkspaceTemplate) {
    const diagram = node("div", "aw-library__layout");
    diagram.setAttribute("aria-label", "Template layout preview");
    const placements = template.body.placements;
    const minX = Math.min(0, ...placements.map((p) => p.presentation.x)),
      minY = Math.min(0, ...placements.map((p) => p.presentation.y));
    const width = Math.max(
        1,
        ...placements.map(
          (p) => p.presentation.x + p.presentation.width - minX,
        ),
      ),
      height = Math.max(
        1,
        ...placements.map(
          (p) => p.presentation.y + p.presentation.height - minY,
        ),
      );
    for (const placement of placements) {
      const tile = node(
        "span",
        "aw-library__layout-block",
        placementLabel(template, placement),
      );
      const kind = placementKind(template, placement);
      if (kind) {
        tile.dataset.blockKind = kind;
        tile.prepend(node('small', 'aw-library__layout-kind', kindTitle(kind)));
      }
      const p = placement.presentation;
      tile.style.left = ((p.x - minX) / width) * 100 + "%";
      tile.style.top = ((p.y - minY) / height) * 100 + "%";
      tile.style.width = (p.width / width) * 100 + "%";
      tile.style.height = (p.height / height) * 100 + "%";
      tile.style.borderRadius =
        p.shape === "circle" ? "50%" : p.shape === "pill" ? "999px" : p.shape === "rectangle" ? "0" : "8px";
      tile.title = placementLabel(template, placement) + " · " + p.shape;
      diagram.append(tile);
    }
    return diagram;
  }
  function showTemplate(template: WorkspaceTemplate) {
    detail.replaceChildren(
      node("h3", "", template.name),
      node("p", "", template.description),
      previewLayout(template),
      node(
        "p",
        "aw-library__hint",
        "Your saved layout. Fluid and Structured arrange cards automatically; Vela keeps her own position.",
      ),
    );
    const roles = node('ul', 'aw-library__bindings');
    for (const role of template.body.resources) {
      const item = node('li');
      item.append(node('strong', '', role.label), node('small', '', kindTitle(role.source.kind) + ' · ' + (role.source.mode === 'new' ? 'Start empty' : 'Reuse existing')));
      roles.append(item);
    }
    for (const placement of template.body.placements) if (placement.subjectBinding) {
      const item = node('li');
      item.append(node('strong', '', placementLabel(template, placement)), node('small', '', placement.subjectBinding.mode === 'project-context' ? "Use this workspace’s project" : 'Reuse the saved view'));
      roles.append(item);
    }
    detail.append(roles);
    const form = node("form"),
      name = node("input");
    name.value = template.name === "Blank" ? "New workspace" : template.name;
    name.maxLength = 120;
    name.required = true;
    const preview = button("Check template", () => {
        void inspect();
      }),
      apply = node("button", "aw-library__button", "Create workspace");
    apply.type = "submit";
    apply.disabled = template.state !== "active";
    const summary = node("p", "aw-library__hint");
    let checked: TemplateApplyInput | null = null;
    const input = (): TemplateApplyInput => ({
      commandId: commandId(),
      templateId: template.id,
      expectedVersion: template.version,
      title: name.value,
      projectId: options.projectId,
      ...(options.expectedProjectVersion === undefined
        ? {}
        : { expectedProjectVersion: options.expectedProjectVersion }),
    });
    async function inspect() {
      const candidate = input();
      const result = await run("Checking current access and versions…", () =>
        port.previewTemplate(candidate),
      );
      if (result) {
        checked = candidate;
        summary.textContent =
          result.newResourceCount +
          " new resources, " +
          result.referenceCount +
          " references, " +
          result.placementCount +
          " placements in a new " +
          result.body.organization.mode +
          " workspace.";
      }
    }
    name.oninput = () => {
      checked = null;
      summary.textContent = "";
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      void (async () => {
        if (!checked) await inspect();
        if (!checked || ui.disposed) return;
        const result = await run("Creating workspace atomically…", () =>
          port.applyTemplate(checked!),
        );
        if (result) {
          ui.status.textContent = "Workspace saved.";
          await options.onApplied(result);
        }
      })().catch((error) => {
        if (!ui.disposed) ui.status.textContent = errorText(error);
      });
    };
    form.append(field("Workspace name", name), preview, apply, summary);
    detail.append(form);
    const duplicate = button("Duplicate template", () => {
      void run("Duplicating reusable layout…", () =>
        port.saveTemplate({
          name: template.name.slice(0, 110) + " copy",
          description: template.description,
          tags: template.tags,
          body: template.body,
        }),
      ).then((value) => {
        if (value) {
          showTemplate(value);
          void refresh();
        }
      });
    });
    detail.append(duplicate);
    if (template.source !== "preset") {
      const edit = button("Edit template", () => showEditTemplate(template));
      edit.disabled = template.state !== "active";
      const update = button("Update from current workspace", () =>
        showSaveCurrent(template),
      );
      update.disabled =
        template.state !== "active" || !options.currentWorkspace;
      const archive = button(
        template.state === "active"
          ? "Remove from personal library"
          : "Restore template",
        () => {
          void run("Updating template…", () =>
            port.archiveTemplate({
              id: template.id,
              expectedVersion: template.version,
              archived: template.state === "active",
            }),
          ).then((value) => {
            if (value) {
              showTemplate(value);
              void refresh();
            }
          });
        },
      );
      detail.append(
        edit,
        update,
        archive,
        node(
          "p",
          "aw-library__hint",
          "Removing a template archives its definition. Workspaces already created from it retain their resources and arrangements.",
        ),
      );
    }
    if (template.provenance)
      detail.append(
        node(
          "p",
          "aw-library__hint",
          "Vela plan from " +
            template.provenance.providerId +
            (template.provenance.model
              ? " · " + template.provenance.model
              : ""),
        ),
      );
  }
  function showEditTemplate(template: WorkspaceTemplate) {
    detail.replaceChildren(
      node("h3", "", "Edit " + template.name),
      node(
        "p",
        "aw-library__hint",
        "These changes update the reusable template only. Existing workspaces keep their current layout.",
      ),
    );
    const form = node("form"),
      name = node("input"),
      description = node("textarea"),
      tags = node("input"),
      mode = node("select"),
      body = structuredClone(template.body);
    name.value = template.name;
    name.maxLength = 120;
    name.required = true;
    description.value = template.description;
    description.maxLength = 500;
    tags.value = template.tags.join(", ");
    tags.maxLength = 500;
    for (const value of ["fluid", "freeform", "structured"]) {
      const option = node("option", "", value);
      option.value = value;
      mode.append(option);
    }
    mode.value = body.organization.mode;
    form.append(
      field("Template name", name),
      field("Description", description),
      field("Categories / tags (comma separated)", tags),
      field("Organization mode", mode),
    );
    for (const placement of body.placements) {
      const group = node("details"),
        summary = node("summary", "", placementLabel(template, placement)),
        shape = node("select");
      group.append(summary);
      for (const value of blockDefinition(
        placement.resourceKey !== undefined
          ? body.resources.find((r) => r.key === placement.resourceKey)!.source
              .kind
          : "reference",
      ).supportedShapes) {
        const option = node("option", "", value);
        option.value = value;
        shape.append(option);
      }
      shape.value = placement.presentation.shape;
      shape.onchange = () => {
        placement.presentation.shape =
          shape.value as typeof placement.presentation.shape;
      };
      group.append(field("Shape", shape));
      for (const property of ["x", "y", "width", "height"] as const) {
        const value = node("input");
        value.type = "number";
        value.value = String(placement.presentation[property]);
        value.min =
          property === "width"
            ? "128"
            : property === "height"
              ? "96"
              : "-1000000";
        value.max =
          property === "width" || property === "height" ? "4096" : "1000000";
        value.required = true;
        value.oninput = () => {
          placement.presentation[property] = Number(value.value);
        };
        group.append(field(property, value));
      }
      form.append(group);
    }
    const save = node("button", "aw-library__button", "Save template changes");
    save.type = "submit";
    form.append(
      save,
      button("Cancel editing", () => showTemplate(template)),
    );
    form.onsubmit = (event) => {
      event.preventDefault();
      body.organization.mode = mode.value as typeof body.organization.mode;
      void run("Saving versioned template…", () =>
        port.saveTemplate({
          id: template.id,
          expectedVersion: template.version,
          name: name.value,
          description: description.value,
          tags: tags.value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          body,
        }),
      ).then((value) => {
        if (value) {
          showTemplate(value);
          void refresh();
        }
      });
    };
    detail.append(form);
  }
  function showSaveCurrent(target?: WorkspaceTemplate) {
    const snapshot = options.currentWorkspace?.();
    if (!snapshot?.activeWorkspaceId) {
      ui.status.textContent = "Open a workspace before saving its layout.";
      return;
    }
    detail.replaceChildren(
      node("h3", "", "Save reusable workspace"),
      node(
        "p",
        "",
        "Choose how each resource is reused. New resources start empty; note text, conversation history, provider sessions and execution are never copied.",
      ),
    );
    const form = node("form"),
      name = node("input"),
      description = node("textarea"),
      tags = node("input"),
      choices: CaptureChoices = {},
      subjectChoices: SubjectCaptureChoices = {};
    name.required = true;
    name.maxLength = 120;
    name.value =
      target?.name ??
      (snapshot.workspaces.find((w) => w.id === snapshot.activeWorkspaceId)
        ?.title ?? "Workspace") + " template";
    description.maxLength = 500;
    description.value = target?.description ?? "";
    tags.value = target?.tags.join(", ") ?? "";
    tags.maxLength = 500;
    form.append(
      field("Template name", name),
      field("Description", description),
      field("Categories / tags (comma separated)", tags),
    );
    for (const id of new Set(
      snapshot.blocks.flatMap((b) => (b.resource_id ? [b.resource_id] : [])),
    )) {
      const resource = snapshot.resources.find((r) => r.id === id);
      if (!resource) continue;
      const select = node("select");
      select.required = true;
      for (const [value, label] of [
        ["", "Choose resource binding"],
        ["reference", "Reuse existing resource (same ID)"],
        ["new", "Create empty new resource"],
      ]) {
        const option = node("option", "", label);
        option.value = value;
        select.append(option);
      }
      select.onchange = () => {
        if (select.value) choices[id] = select.value as "new" | "reference";
        else delete choices[id];
      };
      if (resource.kind === 'checklist') {
        const fresh = select.querySelector<HTMLOptionElement>('option[value="new"]');
        if (fresh) { fresh.disabled = true; fresh.textContent = 'Copying checklist contents is unavailable'; }
        form.append(node('p', 'aw-library__hint', 'Reuse this checklist to keep its saved items, groups and linked sources. Checklist contents are not copied.'));
      }
      if (resource.kind === 'agent') {
        const fresh = select.querySelector<HTMLOptionElement>('option[value="new"]');
        if (fresh) { fresh.disabled = true; fresh.textContent = 'Create profiles in the Agent Library'; }
        form.append(node('p', 'aw-library__hint', 'Reuse the saved agent profile. Workspace templates do not copy agents or their assignment history.'));
      }
      if (resource.kind === 'timeline') {
        const fresh = select.querySelector<HTMLOptionElement>('option[value="new"]');
        if (fresh) { fresh.disabled = true; fresh.textContent = 'Reuse a configured Timeline'; }
        form.append(node('p', 'aw-library__hint', 'Reuse the saved Timeline to retain its scope, filters and selection. Timeline settings are not copied.'));
      }
      if (resource.kind === 'task_objective') {
        const fresh = select.querySelector<HTMLOptionElement>('option[value="new"]');
        if (fresh) { fresh.disabled = true; fresh.textContent = 'Reuse the saved Task Objective'; }
        form.append(node('p', 'aw-library__hint', 'Reuse this objective to retain its requirements, evidence and review history. A workspace template does not copy objectives or execute work.'));
      }
      form.append(field(resource.title + " · " + resource.kind, select));
    }
    for (const placement of snapshot.blocks) {
      if (
        placement.resource_id ||
        placement.workspace_id !== snapshot.activeWorkspaceId
      )
        continue;
      const subject = placement.subject!,
        select = node("select");
      select.required = true;
      for (const [value, label] of [
        ["", "Choose subject binding"],
        ["reference", "Reference the same canonical " + subject.kind],
        ...(subject.kind === "project" ||
        (subject.kind === "resource-query" && !subject.collectionId)
          ? [["project-context", "Bind to the new workspace project"]]
          : []),
      ]) {
        const option = node("option", "", label);
        option.value = value;
        select.append(option);
      }
      select.onchange = () => {
        if (select.value)
          subjectChoices[placement.id] = select.value as
            | "reference"
            | "project-context";
        else delete subjectChoices[placement.id];
      };
      form.append(field(JSON.stringify(subject), select));
    }
    const submit = node(
      "button",
      "aw-library__button",
      target ? "Update template from workspace" : "Save template",
    );
    submit.type = "submit";
    form.append(submit);
    form.onsubmit = (event) => {
      event.preventDefault();
      let body;
      try {
        body = captureWorkspaceTemplate(
          snapshot,
          choices,
          options.currentConfigurations?.(),
          subjectChoices,
        );
      } catch (error) {
        ui.status.textContent = errorText(error);
        return;
      }
      void run("Saving reusable layout…", () =>
        port.saveTemplate({
          ...(target ? { id: target.id, expectedVersion: target.version } : {}),
          name: name.value,
          description: description.value,
          tags: tags.value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          body,
        }),
      ).then((value) => {
        if (value) {
          showTemplate(value);
          void refresh();
        }
      });
    };
    detail.append(form);
  }
  function showVela() {
    detail.replaceChildren(
      node("h3", "", "Ask Vela to construct a workspace"),
      node(
        "p",
        "",
        "Describe the work you want to do. Vela returns a proposal for review; resources are created only when you apply it.",
      ),
    );
    const form = node("form"),
      prompt = node("textarea");
    prompt.required = true;
    prompt.maxLength = 5000;
    const submit = node("button", "aw-library__button", "Request proposal");
    submit.type = "submit";
    submit.disabled = capabilities?.velaPlanning.state !== "available";
    form.append(field("Workspace purpose", prompt), submit);
    if (submit.disabled)
      form.append(
        node(
          "p",
          "aw-library__limitation",
          capabilities?.velaPlanning.reason ??
            "Vela planning is unavailable. Use Blank, a preset or a saved template.",
        ),
      );
    form.onsubmit = (event) => {
      event.preventDefault();
      void run("Waiting for Vela’s proposal…", () =>
        port.requestVelaTemplate({
          requestId: commandId(),
          prompt: prompt.value,
          projectId: options.projectId,
        }),
      ).then((plan) => {
        if (plan) showVelaPlan(plan);
      });
    };
    detail.append(form);
  }
  function showVelaPlan(plan: VelaTemplatePlan) {
    detail.replaceChildren(
      node("h3", "", plan.name),
      node("p", "", plan.description),
      node(
        "p",
        "aw-library__hint",
        "Proposal from " +
          plan.provenance.providerId +
          ". Review and save before applying.",
      ),
    );
    const roles = node("ul");
    for (const role of plan.body.resources)
      roles.append(
        node(
          "li",
          "",
          role.label + " · " + role.source.kind + " · " + role.source.mode,
        ),
      );
    detail.append(roles);
    const name = node("input");
    name.value = plan.name;
    name.maxLength = 120;
    name.required = true;
    const save = button("Save proposal as template", () => {
      void run("Saving Vela proposal…", () =>
        port.saveTemplate({ ...plan, name: name.value, source: "vela" }),
      ).then((value) => {
        if (value) {
          showTemplate(value);
          void refresh();
        }
      });
    });
    detail.append(field("Template name", name), save);
  }
  search.oninput = () => {
    void refresh();
  };
  archived.onchange = () => {
    void refresh();
  };
  void port
    .capabilities()
    .then((value) => {
      if (!ui.disposed) capabilities = value;
    })
    .catch((error) => {
      if (!ui.disposed) ui.status.textContent = errorText(error);
    });
  void refresh();
  search.focus();
  return { dispose: ui.dispose, refresh };
}
