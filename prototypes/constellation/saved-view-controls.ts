import type { ConstellationController } from "./controller.ts";

/** Explicit camera views in one compact, on-demand surface. */
export function savedViewControls(
  root: HTMLElement,
  c: ConstellationController,
  dirty: () => void,
) {
  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
  ) => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  const dialog = element("dialog");
  dialog.className = "aw-graph-dialog aw-saved-views";
  root.append(dialog);
  let opener: HTMLElement | null = null,
    mode = "",
    editingId: string | undefined,
    signature = "",
    generation = 0,
    status = element("p");
  dialog.addEventListener("close", () => {
    generation++;
    if (opener?.isConnected && opener.getClientRects().length) opener.focus();
    else
      root
        .querySelector<HTMLElement>(".aw-spatial-field:not([hidden])")
        ?.focus();
    dirty();
  });
  function button(text: string, action: () => unknown) {
    const b = element("button", text);
    b.type = "button";
    b.onclick = async () => {
      if (b.disabled) return;
      const current = generation;
      b.disabled = true;
      try {
        await action();
      } catch (error) {
        if (dialog.open && current === generation)
          status.textContent =
            error instanceof Error
              ? error.message
              : "The view could not be changed.";
      } finally {
        b.disabled = false;
      }
    };
    return b;
  }
  function show(title: string) {
    if (!dialog.open) opener = document.activeElement as HTMLElement;
    generation++;
    const close = button("×", () => dialog.close());
    close.className = "aw-quiet-control";
    close.setAttribute("aria-label", "Close saved views");
    status = element("p");
    status.setAttribute("role", "status");
    dialog.replaceChildren(close, element("h2", title));
    dialog.setAttribute("aria-label", title);
    if (!dialog.open) dialog.showModal();
    dirty();
  }
  function nameForm(id?: string) {
    const view = id ? c.state.savedViews.find((v) => v.id === id) : undefined;
    if (id && !view) throw Error("Saved view is unavailable.");
    mode = "name";
    editingId = id;
    show(view ? "Rename view" : "Save current view");
    const form = element("form"),
      label = element("label", "View name"),
      name = element("input"),
      save = element("button", view ? "Rename view" : "Save view");
    name.name = "viewName";
    name.required = true;
    name.maxLength = 64;
    name.value = view?.name ?? "";
    name.autocomplete = "off";
    label.append(name);
    save.type = "submit";
    form.append(label, save, status);
    dialog.append(form);
    let submitting = false;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (submitting || !form.reportValidity()) return;
      const current = generation;
      submitting = save.disabled = true;
      try {
        if (id) await c.renameView(id, name.value);
        else await c.saveView(name.value);
        if (dialog.open && current === generation) {
          if (id) open();
          else dialog.close();
        }
      } catch (error) {
        if (dialog.open && current === generation)
          status.textContent =
            error instanceof Error
              ? error.message
              : "The view could not be saved.";
      } finally {
        submitting = save.disabled = false;
      }
      dirty();
    };
    name.focus();
    name.select();
  }
  function open(preferred?: string) {
    mode = "list";
    editingId = undefined;
    signature = JSON.stringify(c.state.savedViews);
    show("Saved views");
    if (!c.state.savedViews.length) {
      dialog.append(
        element("p", "Keep a viewpoint to return to later."),
        button("Save current view", () => nameForm()),
      );
    } else {
      const current = generation,
        label = element("label", "Choose a view"),
        select = element("select"),
        actions = element("div"),
        scope = element("p");
      actions.className = "aw-saved-view-actions";
      select.name = "viewId";
      for (const view of c.state.savedViews) {
        const option = element("option", view.name);
        option.value = view.id;
        select.append(option);
      }
      if (preferred && c.state.savedViews.some((v) => v.id === preferred))
        select.value = preferred;
      const describe = () => {
        const view = c.state.savedViews.find((v) => v.id === select.value),
          l = view?.location;
        scope.textContent =
          l?.kind === "universe"
            ? "Universe"
            : l
              ? (c.nodes.get(
                  l.kind === "project"
                    ? "project:" + l.projectId
                    : "workspace:" + l.workspaceId,
                )?.title ?? "Unavailable view")
              : "Unavailable view";
      };
      select.onchange = describe;
      describe();
      label.append(select);
      actions.append(
        button("Open view", async () => {
          await c.returnView(select.value);
          if (dialog.open && current === generation) dialog.close();
        }),
        button("Rename", () => nameForm(select.value)),
        button("Remove view", () => c.removeView(select.value)),
      );
      dialog.append(label, scope, actions);
      select.focus();
    }
    dialog.append(status);
  }
  const unsubscribe = c.subscribe(() => {
    if (
      dialog.open &&
      editingId &&
      !c.state.savedViews.some((view) => view.id === editingId)
    ) {
      editingId = undefined;
      mode = "unavailable";
      show("Saved view unavailable");
      dialog.append(element("p", "This view is no longer available."), status);
      dialog.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    if (
      dialog.open &&
      mode === "list" &&
      signature !== JSON.stringify(c.state.savedViews)
    )
      open(dialog.querySelector<HTMLSelectElement>("select")?.value);
  });
  return {
    save: () => nameForm(),
    open,
    dispose() {
      unsubscribe();
      dialog.remove();
    },
  };
}
