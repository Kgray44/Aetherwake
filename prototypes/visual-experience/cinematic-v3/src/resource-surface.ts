import type { Resource } from "../../../application-contract/contracts.ts";
import type {
  ContextualSurfaceRequest,
  SurfaceAnchor,
} from "./contextual-surfaces.ts";

export interface DirectResourceView {
  update(resource: Resource): void;
  setActive(active: boolean): void;
  flush(): Promise<void>;
  dispose(): void;
  frame?(): void;
  reflow?(): void;
  refresh?(): Promise<void>;
  hasUnsavedChanges?(): boolean;
}

export function supportsDocumentQuestion(resource: Resource): boolean {
  return resource.kind === "file" && resource.media?.source === "file" &&
    ["pdf", "docx", "text"].includes(resource.media.format);
}

/** Retains the actual focused editor DOM across closes. Only view state lives
 * here: content, drafts and mutations stay with the canonical component ports. */
export function createResourceSurface(options: {
  surfaces: {
    open(request: ContextualSurfaceRequest): HTMLElement;
    close(id: string): void;
  };
  mount(root: HTMLElement, resource: Resource): DirectResourceView;
  anchor(): SurfaceAnchor;
  failed(error: unknown): void;
  placeNote?(resource: Resource): (() => Promise<void>) | undefined;
  askAboutDocument?(resource: Resource): void;
}) {
  const entries = new Map<
    string,
    {
      resourceId: string;
      kind: Resource["kind"];
      root: HTMLElement;
      view: DirectResourceView;
      authorized: boolean;
      active: boolean;
      request: ContextualSurfaceRequest;
      updatePlacement?: (resource: Resource) => void;
      updateDocumentAction?: (resource: Resource) => void;
      width?: number;
      height?: number;
    }
  >();
  let selected: string | null = null;

  function release(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.authorized = false;
    entry.view.setActive(false);
    entry.view.dispose();
    entry.root.replaceChildren();
    entries.delete(id);
    if (selected === id) {
      selected = null;
      options.surfaces.close("canonical-resource");
    }
  }

  return {
    show(resource: Resource, anchor?: SurfaceAnchor) {
      if (
        resource.available === false ||
        resource.visible === false ||
        resource.state === "archived"
      )
        throw Error("resource_unavailable");
      let entry = entries.get(resource.id);
      if (entry && entry.kind !== resource.kind) {
        release(resource.id);
        entry = undefined;
      }
      if (!entry) {
        const root = document.createElement("section");
        root.className = "application-direct-resource";
        root.dataset.resourceId = resource.id;
        const placementEnabled = resource.kind === "note" && options.placeNote;
        const documentAction = resource.kind === "file" && options.askAboutDocument;
        const editor = placementEnabled || documentAction ? document.createElement("div") : root;
        if (editor !== root) root.append(editor);
        const view = options.mount(editor, resource);
        let updateDocumentAction: ((resource: Resource) => void) | undefined;
        if (documentAction) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "aw-document-question";
          button.textContent = "Ask Vela about this file";
          button.dataset.aerynthMotionControl = "true";
          let current = resource;
          updateDocumentAction = (next) => {
            current = next;
            button.hidden = !supportsDocumentQuestion(next);
          };
          button.addEventListener("click", () => {
            const entry = entries.get(resource.id);
            if (!entry?.authorized || entry.updateDocumentAction !== updateDocumentAction || !entry.active || button.hidden) return;
            try {
              documentAction(current);
            } catch (error) {
              options.failed(error);
            }
          });
          updateDocumentAction(resource);
          root.prepend(button);
        }
        let updatePlacement: ((resource: Resource) => void) | undefined;
        if (resource.kind === "note" && options.placeNote) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "aw-note-placement";
          button.textContent = "Add note to this workspace";
          button.dataset.aerynthMotionControl = "true";
          let current = resource;
          let pending = false;
          const refresh = () => {
            button.hidden = !options.placeNote?.(current);
            button.disabled = pending;
          };
          updatePlacement = (next) => {
            current = next;
            refresh();
          };
          button.addEventListener("click", async () => {
            const entry = entries.get(resource.id);
            if (!entry?.authorized || !entry.active || pending) return;
            const place = options.placeNote?.(current);
            if (!place) return;
            pending = true;
            refresh();
            try {
              await place();
            } catch (error) {
              options.failed(error);
            } finally {
              pending = false;
              refresh();
            }
          });
          root.prepend(button);
          refresh();
        }
        const created = {
          resourceId: resource.id,
          kind: resource.kind,
          root,
          view,
          updatePlacement,
          updateDocumentAction,
          active: false,
          authorized: true,
          request: undefined as unknown as ContextualSurfaceRequest,
        };
        created.request = {
          id: "canonical-resource",
          anchor: options.anchor(),
          content: root,
          label: resource.title,
          minSize: { width: 360, height: 300 },
          maxSize: { width: 900, height: 740 },
          placement: "left",
          preferredSize: {
            width: resource.kind === "stream" ? 780 : 600,
            height: 600,
          },
          beforeClose: async () => {
            if (!created.authorized) return true;
            try {
              await created.view.flush();
              return true;
            } catch (error) {
              options.failed(error);
              return false;
            }
          },
          onClose: () => {
            created.active = false;
            created.view.setActive(false);
            if (selected === resource.id) selected = null;
          },
        };
        entries.set(resource.id, created);
        entry = created;
      }
      const previous = selected && entries.get(selected);
      if (previous && previous !== entry) {
        previous.active = false;
        previous.view.setActive(false);
      }
      entry.view.update(resource);
      entry.updatePlacement?.(resource);
      entry.updateDocumentAction?.(resource);
      entry.request.label = resource.title;
      if (anchor) entry.request.anchor = anchor;
      // The existing surface manager moves this same content node and reverses
      // its Motion Coordinator transition when reopened during dismissal.
      options.surfaces.open(entry.request);
      entry.active = true;
      entry.view.setActive(true);
      selected = resource.id;
      entries.delete(resource.id);
      entries.set(resource.id, entry);
      // Clean hidden editors are bounded; callers flush before switching.
      if (entries.size > 8) {
        const oldest = [...entries.values()].find(
          (value) => !value.active && !value.view.hasUnsavedChanges?.(),
        );
        if (oldest) release(oldest.resourceId);
      }
    },
    reconcile(resources: readonly Resource[]) {
      const current = new Map(
        resources.map((resource) => [resource.id, resource]),
      );
      for (const [id, entry] of entries) {
        const resource = current.get(id);
        if (
          !resource ||
          resource.visible === false ||
          resource.available === false ||
          resource.state === "archived"
        )
          release(id);
        else {
          entry.view.update(resource);
          entry.updatePlacement?.(resource);
          entry.updateDocumentAction?.(resource);
        }
      }
    },
    unavailable(resourceId: string) {
      release(resourceId);
    },
    frame() {
      for (const entry of entries.values()) {
        if (!entry.active || !entry.authorized) continue;
        const width = entry.root.clientWidth,
          height = entry.root.clientHeight;
        if (width !== entry.width || height !== entry.height) {
          entry.width = width;
          entry.height = height;
          entry.view.reflow?.();
        }
        entry.view.frame?.();
      }
    },
    async refresh(resourceId?: string) {
      await Promise.all(
        [...entries.values()]
          .filter(
            (entry) =>
              entry.active &&
              entry.authorized &&
              (!resourceId || entry.resourceId === resourceId),
          )
          .map((entry) => entry.view.refresh?.()),
      );
    },
    async flush() {
      for (const entry of entries.values())
        if (entry.authorized) await entry.view.flush();
    },
    dispose() {
      for (const id of [...entries.keys()]) release(id);
    },
  };
}
