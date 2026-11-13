import { mountSavedMemoriesFixture } from "./saved-memories-mount.ts";
import type { createResourceOpener } from "./resource-opening.ts";

const root = document.querySelector<HTMLElement>("#saved-memories");
const host = window.aerynthHost;
if (!root || !host?.command) throw Error("memory_fixture_renderer_unavailable");
const command = host.command;
mountSavedMemoriesFixture(root, {
  manageMemory: input => command("personalMemory", input),
  openResource: input => command("openResource", input) as ReturnType<ReturnType<typeof createResourceOpener>["open"]>,
});
