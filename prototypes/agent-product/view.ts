import type {
  ExperienceMotionPort,
  ExperiencePose,
} from "../application-contract/motion.ts";
import type {
  AgentAssignmentReference,
  AgentLibraryClientPort,
  AgentMutationReceipt,
  AgentProfile,
  AgentProfileData,
  AgentProviderCatalog,
  AgentRef,
  AgentSettings,
  AgentSummary,
  EffectiveAgentConfiguration,
} from "./contracts.ts";

export interface AgentLibraryViewOptions {
  client: AgentLibraryClientPort;
  motion: ExperienceMotionPort;
  commandId?(): string;
  onOpenResource?(resourceId: string): void | Promise<void>;
}
export interface AgentLibraryView {
  open(resourceId: string): Promise<"opened" | "draft-review" | "unavailable">;
  refresh(): Promise<void>;
  frame(): void;
  hasUnsavedChanges(): boolean;
  dispose(): void;
}
const settingKeys = [
  "providerId",
  "modelId",
  "reasoningEffort",
  "additionalInstructions",
  "requiredCapabilities",
] as const;
const settingNames: Record<keyof AgentSettings, string> = {
  providerId: "Provider",
  modelId: "Model",
  reasoningEffort: "Reasoning preference",
  additionalInstructions: "Additional instructions",
  requiredCapabilities: "Requested capabilities",
};
const neutral: ExperiencePose = {
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  lift: 0,
  yaw: 0,
  opacity: 1,
};
const blankProfile = (): AgentProfileData => ({
  purpose: "",
  specialties: [],
  settings: {
    providerId: { source: "inherit" },
    modelId: { source: "inherit" },
    reasoningEffort: { source: "inherit" },
    additionalInstructions: { source: "inherit" },
    requiredCapabilities: { source: "inherit" },
  },
});
const sameRef = (a: AgentRef, b: AgentRef) =>
  a.resourceId === b.resourceId &&
  a.profileVersion === b.profileVersion &&
  a.resourceVersion === b.resourceVersion;
let serial = 0;

/** Glass-surface content only. Canonical state/policy/persistence belongs to the
 * client. These local drafts, projections and borrowed channels own no runner. */
export function mountAgentLibrary(
  container: HTMLElement,
  options: AgentLibraryViewOptions,
): AgentLibraryView {
  const doc = container.ownerDocument,
    client = options.client,
    motion = options.motion,
    prefix = `agent-library:${++serial}:`,
    ownKeys = new Set<string>();
  let disposed = false,
    listEpoch = 0,
    detailEpoch = 0,
    effectiveEpoch = 0,
    referencesEpoch = 0,
    metadataEpoch = 0;
  let current: AgentProfile | null = null,
    archived: AgentSummary | null = null,
    effective: EffectiveAgentConfiguration | null = null;
  let selectedId: string | null = null,
    detailPending = false,
    editing = false,
    creating = false,
    dirty = false,
    stale = false,
    pending = false;
  let projects: { id: string; title: string; version: number }[] = [],
    templates: Awaited<ReturnType<AgentLibraryClientPort["templates"]>> = [],
    catalog: AgentProviderCatalog | null = null;
  let pendingNavigation: (() => void) | null = null,
    lastAttempt: {
      signature: string;
      run: () => Promise<AgentMutationReceipt>;
      operation: "save" | "archive" | "restore";
      acknowledged?: boolean;
    } | null = null;
  let editBase: AgentProfile | null = null;
  const rows = new Map<
    string,
    {
      node: HTMLElement;
      button: HTMLButtonElement;
      label: HTMLElement;
      state: HTMLElement;
      summary: AgentSummary;
      key: string;
    }
  >();
  const disclosures: {
    node: HTMLElement;
    inner: HTMLElement;
    key: string;
    open: boolean;
    height: number;
  }[] = [];
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls = "",
    value = "",
  ): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    node.className = cls;
    if (value) node.textContent = value;
    return node;
  }
  function control<T extends HTMLElement>(node: T, action: string): T {
    node.dataset.aerynthMotionControl = "true";
    node.dataset.action = action;
    return node;
  }
  function button(label: string, action: string, handler: () => void) {
    const node = control(el("button", "agent-control", label), action);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  }
  function addKey(key: string, pose: ExperiencePose) {
    ownKeys.add(key);
    motion.add(key, pose);
  }
  function disclosure(node: HTMLElement, inner: HTMLElement, name: string) {
    const entry = { node, inner, key: prefix + name, open: false, height: 0 };
    node.hidden = true;
    node.inert = true;
    node.setAttribute("aria-hidden", "true");
    addKey(entry.key, { ...neutral, h: 0, opacity: 0 });
    disclosures.push(entry);
    return entry;
  }
  function disclosureHeight(inner: HTMLElement) {
    // Reveal the complete intrinsic content. A viewport-height cap here traps
    // lower controls inside the clipping wrapper; the inspector owns scrolling.
    const height = Math.ceil(
      Math.max(inner.scrollHeight, inner.getBoundingClientRect().height),
    );
    return Number.isFinite(height) ? Math.max(1, height) : 1;
  }
  function reveal(entry: (typeof disclosures)[number], open: boolean) {
    entry.open = open;
    if (open) entry.node.hidden = false;
    entry.node.inert = !open;
    entry.node.setAttribute("aria-hidden", String(!open));
    entry.height = disclosureHeight(entry.inner);
    motion.target(
      entry.key,
      { ...neutral, h: open ? entry.height : 0, opacity: open ? 1 : 0 },
      "agent library disclosure",
    );
    motion.wake();
    frame();
  }
  const root = el("section", "agent-library"),
    header = el("header", "agent-library-heading"),
    title = el("h2", "", "Agents"),
    toolbar = el("div", "agent-library-toolbar");
  root.setAttribute("aria-label", "Agent Library");
  const search = control(el("input", "agent-search"), "search");
  search.type = "search";
  search.placeholder = "Find an agent";
  search.setAttribute("aria-label", "Find an agent");
  search.maxLength = 200;
  const scope = control(el("select", "agent-project-filter"), "project-filter");
  scope.setAttribute("aria-label", "Agent project filter");
  const archivedFilterButton = button("Archived", "toggle-archived", () => {
    archivedFilter = !archivedFilter;
    archivedFilterButton.setAttribute("aria-pressed", String(archivedFilter));
    void loadList();
  });
  archivedFilterButton.setAttribute("aria-pressed", "false");
  let archivedFilter = false;
  const create = button("New agent", "create", () =>
    navigate(() => beginCreate()),
  );
  const refreshButton = button("Refresh", "refresh", () => {
    void refresh();
  });
  header.append(title, create);
  toolbar.append(search, scope, archivedFilterButton, refreshButton);
  const status = el("p", "agent-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const retry = button("Retry previous action", "retry", () => {
    if (lastAttempt) void mutate(lastAttempt);
  });
  retry.hidden = true;
  const navigationReview = el("div", "agent-draft-review");
  navigationReview.hidden = true;
  navigationReview.append(
    el("span", "", "Keep this draft?"),
    button("Keep editing", "keep-draft", () => {
      pendingNavigation = null;
      navigationReview.hidden = true;
    }),
    button("Discard draft", "discard-draft", () => {
      const next = pendingNavigation;
      pendingNavigation = null;
      navigationReview.hidden = true;
      dirty = false;
      lastAttempt = null;
      retry.hidden = true;
      next?.();
    }),
  );
  const body = el("div", "agent-library-body"),
    list = el("div", "agent-list");
  list.setAttribute("role", "list");
  list.setAttribute("aria-label", "Agent profiles");
  const listMessage = el("p", "agent-empty", "Loading profiles…"),
    inspector = el("section", "agent-inspector");
  inspector.setAttribute("aria-label", "Agent profile");
  const inspectorHeading = el("div", "agent-inspector-heading"),
    name = el("h3", "", "Choose an agent"),
    availability = el("span", "agent-availability");
  inspectorHeading.append(name, availability);
  const purpose = el("p", "agent-purpose"),
    specialties = el("p", "agent-specialties"),
    actions = el("div", "agent-profile-actions");
  const edit = button("Edit profile", "edit", () => {
    if (current) beginEdit(current);
  });
  const archiveButton = button("Archive", "review-archive", () => {
    archiveReview.hidden = false;
  });
  const restoreButton = button("Restore profile", "restore", () => {
    if (!archived) return;
    const input = {
      commandId: commandId(),
      agent: structuredClone(archived.ref),
      archived: false,
    };
    void mutate({
      signature: JSON.stringify(input),
      operation: "restore",
      run: () => client.archive(input),
    });
  });
  const reload = button("Reload saved profile", "reload", () => {
    if (selectedId) void loadDetail(selectedId, true);
  });
  reload.hidden = true;
  const preferences = button("Preferences", "preferences-toggle", () => {
    reveal(preferencesReveal, !preferencesReveal.open);
    preferences.setAttribute("aria-expanded", String(preferencesReveal.open));
  });
  preferences.setAttribute("aria-expanded", "false");
  actions.append(edit, archiveButton, restoreButton, preferences, reload);
  const archiveReview = el("div", "agent-archive-review");
  archiveReview.hidden = true;
  archiveReview.append(
    el("span", "", "Archive this profile?"),
    button("Archive profile", "confirm-archive", () => {
      if (!current) return;
      const input = {
        commandId: commandId(),
        agent: structuredClone(current.ref),
        archived: true,
      };
      void mutate({
        signature: JSON.stringify(input),
        operation: "archive",
        run: () => client.archive(input),
      });
    }),
    button("Cancel", "cancel-archive", () => {
      archiveReview.hidden = true;
    }),
  );
  const form = el("form", "agent-editor");
  form.hidden = true;
  const titleInput = control(el("input"), "title");
  titleInput.name = "title";
  titleInput.required = true;
  titleInput.maxLength = 200;
  const purposeInput = control(el("textarea"), "purpose");
  purposeInput.name = "purpose";
  purposeInput.rows = 3;
  purposeInput.required = true;
  purposeInput.maxLength = 4096;
  const projectInput = control(el("select"), "project");
  projectInput.name = "projectId";
  const specialtiesInput = control(el("input"), "specialties");
  specialtiesInput.name = "specialties";
  specialtiesInput.maxLength = 4096;
  const field = (label: string, node: HTMLElement) => {
    const wrapper = el("label", "agent-field", label);
    wrapper.append(node);
    return wrapper;
  };
  const templateSelect = control(el("select"), "template");
  templateSelect.setAttribute("aria-label", "Agent template");
  const useTemplate = button("Use template", "use-template", () => {
    const template = templates.find((t) => t.id === templateSelect.value);
    if (!template) return;
    paintDraft(template.profile);
    if (!titleInput.value.trim()) titleInput.value = template.title;
    markDirty();
  });
  const templateTools = el("div", "agent-template-tools");
  templateTools.append(templateSelect, useTemplate);
  const save = control(
    el("button", "agent-control agent-primary", "Save profile"),
    "save",
  );
  save.type = "submit";
  const cancelEdit = button("Cancel edit", "cancel-edit", () =>
    navigate(() => {
      if (current) showProfile(current);
      else clearInspector();
    }),
  );
  const formActions = el("div", "agent-form-actions");
  formActions.append(save, cancelEdit);
  form.append(
    templateTools,
    field("Name", titleInput),
    field("Purpose", purposeInput),
    field("Project", projectInput),
    field("Specialties", specialtiesInput),
    formActions,
  );
  const preferencesBody = el("div", "agent-preferences"),
    preferencesInner = el("div", "agent-preferences-inner");
  preferencesBody.append(preferencesInner);
  const preferencesReveal = disclosure(
    preferencesBody,
    preferencesInner,
    "preferences",
  );
  const effectiveText = el("dl", "agent-effective"),
    requirementsNote = el(
      "p",
      "agent-requirements-note",
      "Requirements are not permissions. Catalog support does not start an agent.",
    );
  const settingsEditor = el("div", "agent-settings-editor");
  settingsEditor.hidden = true;
  const settingInputs = new Map<
    keyof AgentSettings,
    {
      source: HTMLSelectElement;
      value: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      origin: HTMLElement;
    }
  >();
  for (const key of settingKeys) {
    const entry = el("div", "agent-setting"),
      label = el("label", "agent-field", settingNames[key]),
      source = control(el("select"), `source-${key}`);
    for (const [value, text] of [
      ["inherit", "Inherited"],
      ["override", "Override"],
    ]) {
      const option = el("option", "", text);
      option.value = value;
      source.append(option);
    }
    const value = control(
        key === "additionalInstructions"
          ? el("textarea")
          : key === "requiredCapabilities"
            ? el("input")
            : el("select"),
        `setting-${key}`,
      ),
      origin = el("small", "agent-origin");
    if (value.tagName === "TEXTAREA") {
      (value as HTMLTextAreaElement).rows = 4;
      (value as HTMLTextAreaElement).maxLength = 16384;
    }
    value.setAttribute("aria-label", settingNames[key]);
    source.setAttribute("aria-label", settingNames[key] + " inheritance");
    label.append(source, value, origin);
    entry.append(label);
    settingsEditor.append(entry);
    settingInputs.set(key, { source, value, origin });
    source.addEventListener("change", () => {
      value.disabled = source.value === "inherit";
      if (source.value === "inherit") {
        const inherited =
            effective?.origins[key]?.scope !== "profile"
              ? effective?.settings[key]
              : undefined,
          display = Array.isArray(inherited)
            ? inherited.join(", ")
            : (inherited ?? "");
        if (value.tagName === "SELECT") configureOptions({ [key]: display });
        else value.value = display;
        origin.textContent =
          inherited === undefined
            ? "Inherited · resolves on save"
            : effective!.origins[key].scope;
      } else origin.textContent = "Profile override";
      markDirty();
    });
    value.addEventListener("input", markDirty);
    value.addEventListener("change", () => {
      if (key === "providerId" || key === "modelId") configureOptions();
      markDirty();
    });
  }
  preferencesInner.append(effectiveText, settingsEditor, requirementsNote);
  const referencesButton = button("References", "references-toggle", () => {
    reveal(referencesReveal, !referencesReveal.open);
    referencesButton.setAttribute(
      "aria-expanded",
      String(referencesReveal.open),
    );
    if (referencesReveal.open && current)
      void loadReferences(current.resource.id);
  });
  referencesButton.hidden = !client.references;
  referencesButton.setAttribute("aria-expanded", "false");
  const referencesBody = el("div", "agent-references"),
    referencesInner = el("div");
  referencesBody.append(referencesInner);
  const referencesReveal = disclosure(
    referencesBody,
    referencesInner,
    "references",
  );
  inspector.append(
    inspectorHeading,
    purpose,
    specialties,
    actions,
    archiveReview,
    form,
    preferencesBody,
    referencesButton,
    referencesBody,
  );
  const column = el("div", "agent-list-column");
  column.append(list, listMessage);
  body.append(column, inspector);
  root.append(header, toolbar, status, retry, navigationReview, body);
  container.append(root);
  function commandId() {
    return options.commandId?.() ?? crypto.randomUUID();
  }
  function message(value: string, error = false) {
    status.textContent = value;
    status.hidden = !value;
    status.dataset.state = error ? "error" : "notice";
  }
  function updateControls() {
    root.dataset.state = pending ? "saving" : stale ? "stale" : "ready";
    root.setAttribute("aria-busy", String(pending));
    save.disabled =
      pending ||
      stale ||
      (!!projectInput.value &&
        !projects.some((p) => p.id === projectInput.value));
    create.disabled = pending;
    edit.disabled = pending;
    archiveButton.disabled = pending;
    restoreButton.disabled = pending;
    for (const node of archiveReview.querySelectorAll<HTMLButtonElement>(
      "button",
    ))
      node.disabled = pending;
    retry.disabled = pending;
  }
  function markDirty() {
    if (!editing) return;
    dirty = true;
    updateControls();
  }
  for (const node of [
    titleInput,
    purposeInput,
    projectInput,
    specialtiesInput,
  ]) {
    node.addEventListener("input", markDirty);
    node.addEventListener("change", markDirty);
  }
  function navigate(action: () => void) {
    if (pending) {
      message("Wait for the current save to finish.");
      return;
    }
    if (dirty || lastAttempt) {
      pendingNavigation = action;
      navigationReview.hidden = false;
      return;
    }
    action();
  }
  function paintOptions(
    select: HTMLSelectElement,
    choices: { value: string; label: string; disabled?: boolean }[],
    selected: string,
  ) {
    const complete =
        selected && !choices.some((c) => c.value === selected)
          ? [
              ...choices,
              {
                value: selected,
                label: "Unavailable · " + selected,
                disabled: true,
              },
            ]
          : choices,
      signature = JSON.stringify(complete);
    if (select.dataset.options !== signature) {
      select.replaceChildren();
      for (const item of complete) {
        const option = el("option", "", item.label);
        option.value = item.value;
        option.disabled = item.disabled ?? false;
        select.append(option);
      }
      select.dataset.options = signature;
    }
    select.value = selected;
  }
  function projectOptions(desiredProject = projectInput.value) {
    const filtered = scope.value || "@all";
    paintOptions(
      projectInput,
      [
        { value: "", label: "Independent" },
        ...projects.map((p) => ({ value: p.id, label: p.title })),
      ],
      desiredProject,
    );
    paintOptions(
      scope,
      [
        { value: "@all", label: "All projects" },
        { value: "@independent", label: "Independent" },
        ...projects.map((p) => ({ value: p.id, label: p.title })),
      ],
      filtered,
    );
  }
  function configureOptions(
    desired: Partial<Record<keyof AgentSettings, string>> = {},
  ) {
    const providers = catalog?.providers ?? [],
      providerControl = settingInputs.get("providerId")!,
      modelControl = settingInputs.get("modelId")!,
      effortControl = settingInputs.get("reasoningEffort")!;
    const providerId = desired.providerId ?? providerControl.value.value,
      modelId = desired.modelId ?? modelControl.value.value,
      effort = desired.reasoningEffort ?? effortControl.value.value;
    paintOptions(
      providerControl.value as HTMLSelectElement,
      [
        { value: "", label: "Not configured" },
        ...providers.map((p) => ({
          value: p.id,
          label: p.id + (p.state === "available" ? "" : " · " + p.state),
        })),
      ],
      providerId,
    );
    const provider = providers.find((p) => p.id === providerId);
    paintOptions(
      modelControl.value as HTMLSelectElement,
      [
        { value: "", label: "Not configured" },
        ...(provider?.models ?? []).map((m) => ({ value: m.id, label: m.id })),
      ],
      modelId,
    );
    paintOptions(
      effortControl.value as HTMLSelectElement,
      [
        { value: "", label: "Provider default" },
        ...(
          provider?.models.find((m) => m.id === modelId)?.reasoningEfforts ?? []
        ).map((id) => ({ value: id, label: id })),
      ],
      effort,
    );
  }
  function paintDraft(data: AgentProfileData) {
    purposeInput.value = data.purpose;
    specialtiesInput.value = data.specialties.join(", ");
    const desired: Partial<Record<keyof AgentSettings, string>> = {};
    for (const key of settingKeys) {
      const input = settingInputs.get(key)!,
        setting = data.settings[key],
        value =
          setting.source === "override"
            ? setting.value
            : effective?.origins[key]?.scope !== "profile"
              ? effective?.settings[key]
              : undefined,
        display = Array.isArray(value) ? value.join(", ") : (value ?? "");
      input.source.value = setting.source;
      if (input.value.tagName === "SELECT") desired[key] = display;
      else input.value.value = display;
      input.value.disabled = setting.source === "inherit";
      input.origin.textContent =
        setting.source === "inherit"
          ? effective?.origins[key]?.scope !== "profile"
            ? (effective?.origins[key]?.scope ?? "Inherited · resolves on save")
            : "Inherited · resolves on save"
          : "Profile override";
    }
    configureOptions(desired);
  }
  function collectDraft(): AgentProfileData {
    const settings: Record<string, unknown> = {};
    for (const key of settingKeys) {
      const input = settingInputs.get(key)!;
      settings[key] =
        input.source.value === "inherit"
          ? { source: "inherit" }
          : {
              source: "override",
              value:
                key === "requiredCapabilities"
                  ? [
                      ...new Set(
                        input.value.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      ),
                    ]
                  : key === "additionalInstructions"
                    ? input.value.value
                    : input.value.value || null,
            };
    }
    return {
      purpose: purposeInput.value,
      specialties: [
        ...new Set(
          specialtiesInput.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
      settings: settings as AgentProfileData["settings"],
    };
  }
  function draftSignature() {
    return JSON.stringify({
      title: titleInput.value.trim(),
      projectId: projectInput.value || null,
      profile: collectDraft(),
    });
  }
  function clearInspector() {
    current = null;
    archived = null;
    selectedId = null;
    editBase = null;
    editing = creating = dirty = stale = false;
    root.dataset.mode = "empty";
    delete inspector.dataset.resourceId;
    inspector.setAttribute("aria-busy", "false");
    form.hidden = true;
    purpose.hidden = specialties.hidden = true;
    actions.hidden = true;
    name.textContent = "Choose an agent";
    availability.textContent = "";
    archiveReview.hidden = true;
    reload.hidden = true;
    referencesButton.hidden = true;
    ++referencesEpoch;
    referencesInner.replaceChildren();
    reveal(preferencesReveal, false);
    reveal(referencesReveal, false);
    selectRows();
    updateControls();
  }
  function showProfile(value: AgentProfile) {
    const changed = current?.resource.id !== value.resource.id;
    current = structuredClone(value);
    archived = null;
    effective = null;
    effectiveText.textContent = "";
    availability.textContent = "Checking configuration…";
    selectedId = value.resource.id;
    root.dataset.mode = "inspect";
    inspector.dataset.resourceId = value.resource.id;
    editBase = null;
    editing = creating = dirty = stale = false;
    form.hidden = true;
    purpose.hidden = specialties.hidden = false;
    purpose.textContent = value.profile.purpose;
    specialties.textContent = value.profile.specialties.join(" · ");
    name.textContent = value.resource.title;
    actions.hidden = false;
    edit.hidden = archiveButton.hidden = preferences.hidden = false;
    restoreButton.hidden = true;
    settingsEditor.hidden = true;
    effectiveText.hidden = false;
    archiveReview.hidden = true;
    reload.hidden = true;
    referencesButton.hidden = !client.references;
    if (changed) {
      ++referencesEpoch;
      referencesInner.replaceChildren();
      reveal(referencesReveal, false);
      referencesButton.setAttribute("aria-expanded", "false");
    } else if (referencesReveal.open && client.references)
      void loadReferences(value.resource.id);
    selectRows();
    updateControls();
  }
  function showArchived(value: AgentSummary) {
    clearInspector();
    archived = structuredClone(value);
    selectedId = value.resource.id;
    root.dataset.mode = "archived";
    inspector.dataset.resourceId = value.resource.id;
    name.textContent = value.resource.title;
    availability.textContent = "Archived profile";
    actions.hidden = false;
    edit.hidden = archiveButton.hidden = preferences.hidden = true;
    restoreButton.hidden = false;
    selectRows();
  }
  function beginEdit(value: AgentProfile) {
    current = structuredClone(value);
    editBase = structuredClone(value);
    editing = true;
    creating = false;
    root.dataset.mode = "edit";
    dirty = stale = false;
    form.hidden = false;
    purpose.hidden = specialties.hidden = true;
    templateTools.hidden = true;
    edit.hidden = archiveButton.hidden = true;
    titleInput.value = value.resource.title;
    projectInput.disabled = true;
    projectOptions(value.resource.projectId ?? "");
    paintDraft(value.profile);
    settingsEditor.hidden = false;
    effectiveText.hidden = true;
    reload.hidden = false;
    availability.textContent = "Editing profile";
    updateControls();
    titleInput.focus({ preventScroll: true });
  }
  function beginCreate() {
    clearInspector();
    ++detailEpoch;
    ++effectiveEpoch;
    current = null;
    archived = null;
    effective = null;
    creating = editing = true;
    root.dataset.mode = "create";
    form.hidden = false;
    actions.hidden = false;
    edit.hidden = archiveButton.hidden = restoreButton.hidden = true;
    preferences.hidden = false;
    templateTools.hidden = false;
    name.textContent = "New agent";
    availability.textContent = "";
    titleInput.value = "";
    projectInput.disabled = false;
    projectOptions(
      scope.value !== "@all" && scope.value !== "@independent"
        ? scope.value
        : "",
    );
    paintDraft(blankProfile());
    settingsEditor.hidden = false;
    effectiveText.hidden = true;
    updateControls();
    titleInput.focus({ preventScroll: true });
  }
  function selectRows() {
    for (const [id, row] of rows) {
      const selected = id === selectedId;
      row.button.setAttribute("aria-current", selected ? "true" : "false");
      motion.target(
        row.key,
        { ...neutral, w: +selected },
        "agent profile selection",
      );
    }
    motion.wake();
    frame();
  }
  async function loadEffective(value: AgentProfile) {
    const epoch = ++effectiveEpoch;
    try {
      const result = await client.effective(structuredClone(value.ref));
      if (
        disposed ||
        epoch !== effectiveEpoch ||
        selectedId !== value.resource.id ||
        editing
      )
        return;
      effective = structuredClone(result);
      availability.textContent = {
        supported: "Catalog supported",
        "needs-setup": "Needs setup",
        unsupported: "Configuration unsupported",
        unknown: "Configuration unknown",
      }[result.configurationState];
      renderEffective();
    } catch {
      if (
        !disposed &&
        epoch === effectiveEpoch &&
        selectedId === value.resource.id &&
        !editing
      ) {
        effective = null;
        availability.textContent = "Configuration unavailable";
        effectiveText.textContent = "Current configuration is unavailable.";
      }
    }
  }
  function renderEffective() {
    effectiveText.replaceChildren();
    if (!effective) return;
    for (const key of settingKeys) {
      const term = el("dt", "", settingNames[key]),
        origin = effective.origins[key],
        raw = effective.settings[key],
        value = el(
          "dd",
          "",
          (key === "additionalInstructions"
            ? raw
              ? "Additional instructions configured"
              : "None"
            : Array.isArray(raw)
              ? raw.join(", ") || "None"
              : (raw ?? "Not configured")) + ` · ${origin.scope}`,
        );
      effectiveText.append(term, value);
    }
    motion.wake();
  }
  async function loadDetail(
    id: string,
    force = false,
    allowArchivedSummary = true,
  ): Promise<boolean> {
    const epoch = ++detailEpoch;
    selectedId = id;
    selectRows();
    const summary = rows.get(id)?.summary;
    if (allowArchivedSummary && summary?.resource.state === "archived") {
      detailPending = false;
      showArchived(summary);
      return true;
    }
    detailPending = true;
    inspector.setAttribute("aria-busy", "true");
    if (current?.resource.id !== id && archived?.resource.id !== id) {
      current = null;
      archived = null;
      effective = null;
      editBase = null;
      root.dataset.mode = "loading";
      delete inspector.dataset.resourceId;
      actions.hidden = true;
      form.hidden = true;
      purpose.textContent = specialties.textContent = "";
      name.textContent = "Loading profile…";
      availability.textContent = "";
      ++referencesEpoch;
      referencesInner.replaceChildren();
      referencesButton.hidden = true;
      effectiveText.textContent = "";
    }
    try {
      const value = await client.inspect(id);
      if (disposed || epoch !== detailEpoch || selectedId !== id) return false;
      if (editing && editBase?.resource.id === id && !force) {
        if (!sameRef(value.ref, editBase.ref)) {
          stale = true;
          reload.hidden = false;
          message("Profile changed. Reload before saving this draft.");
          updateControls();
        }
        return true;
      }
      showProfile(value);
      await loadEffective(value);
      return !disposed && epoch === detailEpoch && selectedId === id;
    } catch {
      if (!disposed && epoch === detailEpoch && selectedId === id) {
        stale = true;
        reload.hidden = false;
        availability.textContent = "Profile unavailable";
        if (!editing) {
          purpose.textContent = "";
          specialties.textContent = "";
        }
        message("Profile unavailable. Your draft is retained.", true);
        updateControls();
      }
      return false;
    } finally {
      if (!disposed && epoch === detailEpoch) {
        detailPending = false;
        inspector.setAttribute("aria-busy", "false");
      }
    }
  }
  async function loadList() {
    const epoch = ++listEpoch,
      scroll = list.scrollTop,
      query = search.value,
      scopeValue = scope.value || "@all";
    list.setAttribute("aria-busy", "true");
    try {
      const result = await client.list({
        query,
        includeArchived: archivedFilter,
        ...(scopeValue === "@all"
          ? {}
          : { projectId: scopeValue === "@independent" ? null : scopeValue }),
        limit: 128,
      });
      if (disposed || epoch !== listEpoch) return;
      const active = doc.activeElement as HTMLElement | null,
        keep = new Set<string>();
      let index = 0;
      for (const summary of result.items.slice(0, 128)) {
        const id = summary.resource.id;
        keep.add(id);
        let row = rows.get(id);
        if (!row) {
          const node = el("div", "agent-row"),
            label = el("span", "agent-row-name"),
            state = el("small", "agent-row-state"),
            open = button("", "inspect", () =>
              navigate(() => {
                creating = false;
                editing = dirty = false;
                void loadDetail(id);
              }),
            ),
            key = prefix + "row:" + id;
          node.dataset.resourceId = id;
          open.setAttribute("role", "listitem");
          open.append(label, state);
          node.append(open);
          row = { node, button: open, label, state, key, summary };
          rows.set(id, row);
          addKey(key, neutral);
        }
        row.summary = structuredClone(summary);
        row.label.textContent = summary.resource.title;
        row.state.textContent =
          summary.resource.state === "archived" ? "Archived" : "";
        if (list.children[index] !== row.node)
          list.insertBefore(row.node, list.children[index] ?? null);
        index++;
      }
      for (const [id, row] of rows)
        if (!keep.has(id)) {
          row.node.remove();
          motion.remove(row.key);
          ownKeys.delete(row.key);
          rows.delete(id);
        }
      list.scrollTop = scroll;
      if (active && root.contains(active) && doc.activeElement !== active)
        active.focus({ preventScroll: true });
      listMessage.textContent = !result.items.length
        ? query
          ? "No matching profiles."
          : "Create your first agent profile."
        : result.coverage === "bounded"
          ? "Search to narrow these profiles."
          : "";
      listMessage.hidden =
        !!result.items.length && result.coverage === "complete";
      selectRows();
    } catch {
      if (!disposed && epoch === listEpoch) {
        listMessage.textContent = "Profiles unavailable. Refresh to try again.";
        listMessage.hidden = false;
      }
    } finally {
      if (!disposed && epoch === listEpoch)
        list.setAttribute("aria-busy", "false");
    }
  }
  async function loadMetadata() {
    const epoch = ++metadataEpoch,
      results = await Promise.allSettled([
        client.projects(),
        client.templates(),
        client.catalog(),
      ]);
    if (disposed || epoch !== metadataEpoch) return;
    projects =
      results[0].status === "fulfilled" ? results[0].value.slice(0, 256) : [];
    templates =
      results[1].status === "fulfilled"
        ? results[1].value
            .filter((t) => t.startsExecution === false)
            .slice(0, 32)
        : [];
    catalog = results[2].status === "fulfilled" ? results[2].value : null;
    projectOptions();
    const selected = templateSelect.value;
    paintOptions(
      templateSelect,
      [
        {
          value: "",
          label: templates.length
            ? "Choose a template"
            : "Templates unavailable",
        },
        ...templates.map((t) => ({ value: t.id, label: t.title })),
      ],
      selected,
    );
    useTemplate.disabled = !templates.length;
    if (editing) configureOptions();
    updateControls();
  }
  async function loadReferences(id: string) {
    if (!client.references) return;
    const epoch = ++referencesEpoch;
    try {
      const values = await client.references(id);
      if (disposed || epoch !== referencesEpoch || selectedId !== id) return;
      referencesInner.replaceChildren();
      if (!values.length)
        referencesInner.append(el("p", "", "No references yet."));
      for (const value of values.slice(0, 64)) renderReference(value);
      motion.wake();
    } catch {
      if (!disposed && epoch === referencesEpoch)
        referencesInner.textContent = "References unavailable.";
    }
  }
  function renderReference(value: AgentAssignmentReference) {
    const row = el("div", "agent-reference"),
      label =
        value.task.supportedTaskOrigin === "manual-compatibility"
          ? "Manual task reference"
          : "Objective reference";
    row.append(
      el("span", "", label),
      el(
        "small",
        "",
        "Reference only · profile v" + value.agent.profileVersion,
      ),
    );
    if (options.onOpenResource)
      row.append(
        button("Open task", "open-task-reference", () => {
          void options.onOpenResource?.(value.task.id);
        }),
      );
    if (value.execution)
      row.append(el("small", "", "Linked execution · " + value.execution.id));
    referencesInner.append(row);
  }
  async function mutate(attempt: NonNullable<typeof lastAttempt>) {
    if (disposed || pending) return;
    pending = true;
    ++listEpoch;
    lastAttempt = attempt;
    retry.hidden = true;
    message("Saving…");
    updateControls();
    const signature = attempt.operation === "save" ? attempt.signature : "";
    try {
      const receipt = await attempt.run();
      if (disposed) return;
      attempt.acknowledged = true;
      retry.hidden = true;
      archiveReview.hidden = true;
      if (attempt.operation === "archive") {
        lastAttempt = null;
        clearInspector();
        message("Profile archived.");
        await loadList();
      } else {
        const actual = await client.inspect(receipt.agent.resourceId);
        if (disposed) return;
        lastAttempt = null;
        if (
          editing &&
          draftSignature() !== signature &&
          attempt.operation === "save"
        ) {
          current = structuredClone(actual);
          selectedId = actual.resource.id;
          editBase = structuredClone(actual);
          creating = false;
          projectInput.disabled = true;
          templateTools.hidden = true;
          name.textContent = actual.resource.title;
          stale = !sameRef(actual.ref, receipt.agent);
          dirty = true;
          reload.hidden = false;
          message("Saved. Your newer draft is retained.");
        } else {
          showProfile(actual);
          await loadEffective(actual);
          message(
            attempt.operation === "restore"
              ? "Profile restored."
              : "Profile saved.",
          );
        }
        await loadList();
      }
    } catch (error) {
      if (disposed) return;
      const code = String(
        (error as { code?: unknown; message?: unknown })?.code ??
          (error as Error)?.message ??
          "",
      ).toLowerCase();
      if (attempt.acknowledged) {
        lastAttempt = attempt;
        retry.hidden = false;
        message(
          "Saved, but the current profile is unavailable. Retry confirmation.",
          true,
        );
      } else if (
        /conflict|not_authorized|unavailable|invalid_|capacity/.test(code)
      ) {
        lastAttempt = null;
        stale = !!editBase;
        reload.hidden = !editBase;
        message(
          /conflict/.test(code)
            ? "Profile changed. Your draft is retained; reload before saving."
            : "The profile could not be saved. Your draft is retained.",
          true,
        );
      } else {
        retry.hidden = false;
        message(
          "Save could not be confirmed. Retry the previous action before starting another.",
          true,
        );
      }
    } finally {
      if (!disposed) {
        pending = false;
        updateControls();
      }
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pending || stale) return;
    if (lastAttempt) {
      message("Retry the previous action before starting another.", true);
      return;
    }
    const data = collectDraft(),
      title = titleInput.value.trim();
    if (!title || !data.purpose.trim()) {
      message("Add a name and purpose.");
      return;
    }
    const signature = draftSignature();
    if (creating) {
      const input = {
        commandId: commandId(),
        title,
        projectId: projectInput.value || null,
        profile: data,
      };
      void mutate({
        signature,
        operation: "save",
        run: () => client.create(input),
      });
    } else if (editBase) {
      const input = {
        commandId: commandId(),
        title,
        agent: structuredClone(editBase.ref),
        profile: data,
      };
      void mutate({
        signature,
        operation: "save",
        run: () => client.update(input),
      });
    }
  });
  search.addEventListener("input", () => {
    void loadList();
  });
  scope.addEventListener("change", () => {
    void loadList();
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...rows.values()].map((r) => r.button),
      index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    if (index >= 0) {
      event.preventDefault();
      buttons[
        Math.max(
          0,
          Math.min(
            buttons.length - 1,
            index + (event.key === "ArrowDown" ? 1 : -1),
          ),
        )
      ]?.focus({ preventScroll: true });
    }
  });
  async function refresh() {
    if (disposed) return;
    await Promise.allSettled([loadMetadata(), loadList()]);
    if (!disposed && selectedId && !creating && !detailPending)
      await loadDetail(selectedId);
  }
  async function open(
    resourceId: string,
  ): Promise<"opened" | "draft-review" | "unavailable"> {
    if (
      disposed ||
      typeof resourceId !== "string" ||
      !resourceId.trim() ||
      resourceId.length > 200 ||
      /[\x00-\x1f]/.test(resourceId)
    )
      return "unavailable";
    if (pending) {
      message("Wait for the current save to finish.");
      return "draft-review";
    }
    if (dirty || lastAttempt) {
      pendingNavigation = () => {
        void open(resourceId);
      };
      navigationReview.hidden = false;
      return "draft-review";
    }
    creating = editing = false;
    // Central/direct opening always performs an authorized body read. Cached
    // archive-list restoration metadata is never proof of an opened profile.
    return (await loadDetail(resourceId, false, false))
      ? "opened"
      : "unavailable";
  }
  function frame() {
    if (disposed) return;
    for (const row of rows.values())
      row.node.style.setProperty(
        "--agent-selection",
        String(motion.pose(row.key).w),
      );
    for (const entry of disclosures) {
      const pose = motion.pose(entry.key);
      entry.node.style.height = Math.max(0, pose.h) + "px";
      entry.node.style.opacity = String(Math.max(0, Math.min(1, pose.opacity)));
      if (!entry.open && pose.h < 0.5 && pose.opacity < 0.001)
        entry.node.hidden = true;
      if (entry.open) {
        const height = disclosureHeight(entry.inner);
        if (height !== entry.height) {
          entry.height = height;
          motion.target(
            entry.key,
            { ...neutral, h: height, opacity: 1 },
            "agent library content resize",
          );
          motion.wake();
        }
      }
    }
  }
  clearInspector();
  projectOptions();
  void refresh();
  return {
    open,
    refresh,
    frame,
    hasUnsavedChanges: () => dirty || pending || !!lastAttempt,
    dispose() {
      if (disposed) return;
      disposed = true;
      ++listEpoch;
      ++detailEpoch;
      ++effectiveEpoch;
      ++referencesEpoch;
      ++metadataEpoch;
      for (const key of ownKeys) motion.remove(key);
      ownKeys.clear();
      rows.clear();
      root.remove();
    },
  };
}
