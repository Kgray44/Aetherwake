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
    tools = node("div", "", "aw-task-group-tools"),
    search = node("input"),
    filter = node("select"),
    list = node("ul", "", "aw-task-group-list"),
    status = node("p", "", "aw-task-group-status"),
    manage = node("button", "Manage tasks");
  section.setAttribute("aria-label", "Task group checklist");
  section.dataset.presentation = options.presentation ?? "focused";
  section.dataset.noCardDrag = "true";
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
  section.append(summary, tools, list, manage, status);
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
        row.append(checkbox, title);
        item = { row, checkbox, title };
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
