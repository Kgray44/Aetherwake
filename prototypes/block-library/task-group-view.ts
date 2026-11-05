import type { Resource } from "../application-contract/contracts.ts";

type Member = NonNullable<Resource["taskMembers"]>[number];
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
};

/** A view of canonical membership. Status changes go back through the host's
 * current-version command; this view never owns task content or completion. */
export function mountTaskGroupExperience(
  root: HTMLElement,
  options: {
    members: readonly Member[];
    active?: boolean;
    presentation?: "workspace" | "focused";
    setStatus(input: {
      resourceId: string;
      status: "open" | "done";
    }): Promise<void>;
    manageMembers(): void | Promise<void>;
    openTask?(resourceId: string): void;
  },
) {
  const section = node("section", "", "aw-task-group"),
    summary = node("p", "", "aw-task-group-summary"),
    completion = node("meter", "", "aw-task-group-completion"),
    segments = node('div', '', 'aw-task-group-segments'),
    manualNote = node('p', 'Manual completion · checkmarks record your task changes, not verified execution.', 'aw-task-group-manual-note'),
    tools = node("div", "", "aw-task-group-tools"),
    search = node("input"),
    filter = node("select"),
    list = node("ul", "", "aw-task-group-list"),
    status = node("p", "", "aw-task-group-status"),
    manage = node("button", "Manage tasks");
  section.setAttribute("aria-label", "Manual task group");
  section.dataset.presentation = options.presentation ?? "focused";
  section.dataset.noCardDrag = "true";
  completion.min = 0;
  completion.setAttribute("aria-label", "Completed tasks in this group");
  search.type = "search";
  search.maxLength = 500;
  search.placeholder = "Find a task";
  search.setAttribute("aria-label", "Find a task in this group");
  filter.setAttribute("aria-label", "Show task status");
  for (const [value, label] of [
    ["all", "All tasks"],
    ["open", "Open"],
    ["done", "Done"],
  ]) {
    const option = node("option", label);
    option.value = value;
    filter.append(option);
  }
  filter.value = "all";
  manage.type = "button";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  tools.append(search, filter);
  segments.setAttribute('aria-hidden', 'true');
  section.append(summary, completion, segments, manualNote, tools, list, manage, status);
  root.append(section);
  let latest = options.members,
    active = options.active ?? true,
    disposed = false,
    managing = false;
  const pending = new Set<string>(),
    rows = new Map<
      string,
      {
        row: HTMLLIElement;
        checkbox: HTMLInputElement;
        title: HTMLElement;
        state: HTMLElement;
      }
    >();
  const current = (id: string) => latest.find((member) => member.id === id);
  const fail = (error: unknown) => {
    if (!disposed && active)
      status.textContent =
        error instanceof Error
          ? error.message.replaceAll("_", " ")
          : "The task could not be updated.";
  };
  manage.onclick = () => {
    if (disposed || !active || managing) return;
    managing = true;
    manage.disabled = true;
    void Promise.resolve()
      .then(() => options.manageMembers())
      .catch(fail)
      .finally(() => {
        managing = false;
        if (!disposed) manage.disabled = false;
      });
  };
  function paint() {
    if (disposed || !active) return;
    const query = search.value.trim().toLocaleLowerCase(),
      shown = latest.filter(
        (member) =>
          (filter.value === "all" || member.status === filter.value) &&
          (!query ||
            (member.title + " " + member.id)
              .toLocaleLowerCase()
              .includes(query)),
      ),
      ids = new Set(shown.map((member) => member.id));
    summary.textContent =
      latest.filter((member) => member.status === "done").length +
      " of " +
      latest.length +
      " done";
    const completed = latest.filter((member) => member.status === "done").length;
    completion.hidden = latest.length === 0;
    completion.max = Math.max(1, latest.length);
    completion.value = completed;
    completion.setAttribute("aria-valuetext", `${completed} of ${latest.length} completed locally`);
    const count = Math.min(32, latest.length);
    segments.hidden = count === 0; segments.style.gridTemplateColumns = `repeat(${Math.max(1, count)}, minmax(0, 1fr))`;
    while (segments.children.length > count) segments.children[segments.children.length - 1].remove();
    for (let index = 0; index < count; index++) {
      const members = latest.slice(Math.floor(index * latest.length / count), Math.floor((index + 1) * latest.length / count));
      const done = members.filter(member => member.status === 'done').length;
      const segment = segments.children[index] as HTMLElement | undefined ?? node('span');
      segment.dataset.status = done === members.length ? 'done' : done ? 'mixed' : 'open';
      segment.style.background = `linear-gradient(90deg,#b3cfca ${done / members.length * 100}%,#acc3d70a ${done / members.length * 100}%)`;
      segment.title = `${done} of ${members.length} manual tasks done`;
      if (!segment.parentElement) segments.append(segment);
    }
    for (const [id, item] of rows)
      if (!ids.has(id)) {
        item.row.remove();
        rows.delete(id);
      }
    list.querySelector(".aw-task-group-empty")?.remove();
    shown.forEach((member, index) => {
      let item = rows.get(member.id);
      if (!item) {
        const row = node("li"),
          checkbox = node("input"),
          title = options.openTask ? node("button") : node("span");
        checkbox.type = "checkbox";
        row.dataset.taskId = member.id;
        title.className = "aw-task-group-title";
        if (options.openTask) {
          (title as HTMLButtonElement).type = "button";
          title.onclick = () => {
            if (active && !disposed && current(member.id))
              options.openTask!(member.id);
          };
        }
        checkbox.onchange = () => {
          const task = current(member.id);
          if (!active || disposed || !task || pending.has(member.id)) return;
          const next = checkbox.checked ? "done" : "open";
          checkbox.checked = task.status === "done";
          pending.add(member.id);
          checkbox.disabled = true;
          status.textContent = "Saving task status…";
          void Promise.resolve()
            .then(() =>
              options.setStatus({ resourceId: member.id, status: next }),
            )
            .then(() => {
              if (!disposed && active)
                status.textContent =
                  current(member.id)?.status === next
                    ? "Task updated."
                    : "Waiting for the saved task status.";
            })
            .catch(fail)
            .finally(() => {
              pending.delete(member.id);
              if (!disposed) paint();
            });
        };
        const state = node('small', '', 'aw-task-group-item-state');
        row.append(checkbox, title, state);
        item = { row, checkbox, title, state };
        rows.set(member.id, item);
      }
      item.title.textContent = member.title;
      item.checkbox.checked = member.status === "done";
      item.checkbox.disabled = pending.has(member.id);
      item.checkbox.setAttribute(
        "aria-label",
        "Mark " + member.title + (member.status === "done" ? " open" : " done"),
      );
      item.row.dataset.status = member.status;
      item.state.textContent = member.status === 'done' ? 'Manual · done' : 'Manual · open';
      const at = list.children[index];
      if (at !== item.row) list.insertBefore(item.row, at ?? null);
    });
    if (!shown.length)
      list.append(
        node(
          "li",
          latest.length ? "No matching tasks." : "Add existing tasks to begin.",
          "aw-task-group-empty",
        ),
      );
  }
  search.oninput = paint;
  filter.onchange = paint;
  paint();
  return {
    update(members: readonly Member[]) {
      latest = members;
      paint();
    },
    setPresentation(value: "workspace" | "focused") {
      section.dataset.presentation = value;
    },
    setActive(value: boolean) {
      active = value;
      if (active) paint();
    },
    dispose() {
      disposed = true;
      section.remove();
      rows.clear();
    },
  };
}
