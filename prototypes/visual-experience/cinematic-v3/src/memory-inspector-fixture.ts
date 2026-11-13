import { mountMemoryInspectorNavigation } from "./memory-inspector-navigation.ts";

const root = document.querySelector<HTMLElement>("#saved-memories");
const host = window.aerynthHost;
if (!root || !host?.command) throw Error("memory_fixture_renderer_unavailable");
mountMemoryInspectorNavigation(root, host.command);
