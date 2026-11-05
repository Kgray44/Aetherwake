import type { BlockConfiguration, BlockLibraryHostPort } from "./contracts.ts";
import { validateConfiguration } from "./registry.ts";

/** Updates the existing presentation in place; editors and canonical resources are never remounted. */
export function applyBlockConfiguration(
  root: HTMLElement,
  value: BlockConfiguration,
) {
  const configuration = validateConfiguration(value);
  root.style.setProperty(
    "--aw-block-text-scale",
    String(configuration.textScale),
  );
  root.dataset.awContentMode = configuration.contentMode;
  for (const editor of root.querySelectorAll<HTMLTextAreaElement>("textarea"))
    editor.rows =
      configuration.contentMode === "compact"
        ? 3
        : configuration.contentMode === "reading"
          ? 10
          : 5;
}

/** Mount in the host's existing contextual block inspector. The host retains geometry/focus controls. */
export function mountBlockConfiguration(
  root: HTMLElement,
  port: BlockLibraryHostPort,
  placementId: string,
  onSaved: (configuration: BlockConfiguration) => void,
) {
  const form = document.createElement("form"),
    status = document.createElement("p"),
    mode = document.createElement("select"),
    scale = document.createElement("select"),
    save = document.createElement("button");
  form.className = "aw-library__configuration";
  form.setAttribute("aria-label", "Block presentation settings");
  status.setAttribute("role", "status");
  const field = (text: string, input: HTMLElement) => {
    const label = document.createElement("label");
    label.textContent = text;
    label.className = "aw-library__field";
    label.append(input);
    return label;
  };
  for (const value of ["auto", "compact", "reading"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    mode.append(option);
  }
  for (const value of [0.75, 1, 1.25, 1.5, 2]) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = Math.round(value * 100) + "%";
    scale.append(option);
  }
  save.textContent = "Save block presentation";
  save.type = "submit";
  save.disabled = true;
  form.append(
    field("Text scale", scale),
    field("Content presentation", mode),
    save,
    status,
  );
  root.append(form);
  let version = 0,
    disposed = false,
    pending = false;
  let retainedConfiguration: BlockConfiguration | null = null;
  status.textContent = "Loading presentation preferences…";
  if (!port.getBlockSettings || !port.configureBlock) {
    status.textContent =
      "This host has not connected block presentation settings.";
    return {
      dispose() {
        disposed = true;
        form.remove();
      },
    };
  }
  const load = async () => {
    const settings = await port.getBlockSettings!(placementId);
    if (disposed) return;
    version = settings.version;
    retainedConfiguration = settings.configuration;
    mode.value = settings.configuration.contentMode;
    scale.value = String(settings.configuration.textScale);
    save.disabled = false;
    status.textContent =
      "Settings apply to this placement. Other views keep their preferences.";
  };
  void load().catch((error) => {
    if (!disposed)
      status.textContent =
        error instanceof Error
          ? error.message
          : "Presentation settings are unavailable.";
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    if (pending || disposed) return;
    pending = true;
    save.disabled = true;
    const configuration: BlockConfiguration = {
      ...retainedConfiguration,
      schemaVersion: 1,
      textScale: Number(scale.value),
      contentMode: mode.value as BlockConfiguration["contentMode"],
    };
    status.textContent = "Saving…";
    void port.configureBlock!({
      placementId,
      expectedVersion: version,
      configuration,
    })
      .then((result) => {
        if (disposed) return;
        version = result.version;
        retainedConfiguration = result.configuration;
        status.textContent = "Presentation saved.";
        onSaved(result.configuration);
      })
      .catch((error) => {
        if (!disposed)
          status.textContent =
            error instanceof Error
              ? error.message
              : "Presentation could not be saved. Reopen settings to read its current version.";
      })
      .finally(() => {
        pending = false;
        if (!disposed) save.disabled = false;
      });
  };
  return {
    dispose() {
      disposed = true;
      form.remove();
    },
  };
}
