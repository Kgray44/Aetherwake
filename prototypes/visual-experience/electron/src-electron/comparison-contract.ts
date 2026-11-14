export const BLOCK_IDS = [
  "overview",
  "conversation",
  "activity",
  "projects",
  "notes",
  "timeline",
  "metrics",
  "files",
  "agents",
  "tasks",
  "signal",
  "calendar",
] as const;
export type BlockId = (typeof BLOCK_IDS)[number];
export type VelaFixtureState =
  | "idle"
  | "working"
  | "attention required"
  | "unavailable";
export type GraphicsQuality = "cinematic" | "balanced" | "efficient";
export type AtmosphereCadence = "fixed60" | "native";

export type RendererCommand =
  | { op: "state" | "reset" | "frameStop" }
  | { op: "frameStart"; scenario: string; refreshHz: number }
  | { op: "scrollChat" | "selectMessage"; index: number }
  | { op: "appendMessages" | "appendEvents"; count: number }
  | { op: "burstEvents" }
  | { op: "swapBlocks"; first: BlockId; second: BlockId }
  | { op: "nudgeBlock"; block: BlockId; delta: -1 | 1 }
  | { op: "expandBlock" | "collapseBlock"; block: BlockId }
  | { op: "setVela"; state: VelaFixtureState }
  | { op: "setQuality"; quality: GraphicsQuality }
  | { op: "setAtmosphereCadence"; cadence: AtmosphereCadence }
  | { op: "setReduced"; reduced: boolean };

export type NativeCommand =
  | {
      op: "status" | "hideWindow" | "minimizeWindow" | "restoreWindow" | "quit";
    }
  | { op: "openWindow" | "closeWindow"; block: BlockId }
  | { op: "focusWindow"; target: "main" | BlockId }
  | {
      op: "setWindowBounds";
      target: "main" | BlockId;
      width: number;
      height: number;
    };

export type ControlCommand = RendererCommand | NativeCommand;
export interface ControlRequest {
  id: string;
  command: ControlCommand;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isBlock = (value: unknown): value is BlockId =>
  typeof value === "string" && (BLOCK_IDS as readonly string[]).includes(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max;

export function validateControlRequest(value: unknown): ControlRequest {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id) ||
    !isRecord(value.command)
  )
    throw new Error("Invalid comparison request envelope");
  const c = value.command;
  switch (c.op) {
    case "state":
    case "reset":
    case "frameStop":
    case "burstEvents":
    case "status":
    case "hideWindow":
    case "minimizeWindow":
    case "restoreWindow":
    case "quit":
      break;
    case "frameStart":
      if (
        typeof c.scenario !== "string" ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(c.scenario) ||
        typeof c.refreshHz !== "number" ||
        !Number.isFinite(c.refreshHz) ||
        c.refreshHz < 30 ||
        c.refreshHz > 360
      )
        throw new Error("Invalid frame capture arguments");
      break;
    case "scrollChat":
    case "selectMessage":
      if (!integer(c.index, 0, 99999)) throw new Error("Invalid message index");
      break;
    case "appendMessages":
    case "appendEvents":
      if (!integer(c.count, 1, 60))
        throw new Error("Append count must be 1-60");
      break;
    case "swapBlocks":
      if (!isBlock(c.first) || !isBlock(c.second) || c.first === c.second)
        throw new Error("Invalid block swap");
      break;
    case "nudgeBlock":
      if (!isBlock(c.block) || (c.delta !== -1 && c.delta !== 1))
        throw new Error("Invalid block nudge");
      break;
    case "expandBlock":
    case "collapseBlock":
    case "openWindow":
    case "closeWindow":
      if (!isBlock(c.block)) throw new Error("Invalid block ID");
      break;
    case "setVela":
      if (
        !["idle", "working", "attention required", "unavailable"].includes(
          String(c.state),
        )
      )
        throw new Error("Invalid Vela state");
      break;
    case "setQuality":
      if (!["cinematic", "balanced", "efficient"].includes(String(c.quality)))
        throw new Error("Invalid graphics quality");
      break;
    case "setAtmosphereCadence":
      if (c.cadence !== "fixed60" && c.cadence !== "native")
        throw new Error("Invalid atmosphere cadence");
      break;
    case "setReduced":
      if (typeof c.reduced !== "boolean")
        throw new Error("Invalid reduced-motion value");
      break;
    case "focusWindow":
      if (c.target !== "main" && !isBlock(c.target))
        throw new Error("Invalid focus target");
      break;
    case "setWindowBounds":
      if (
        (c.target !== "main" && !isBlock(c.target)) ||
        !integer(c.width, 380, 2200) ||
        !integer(c.height, 380, 1400)
      )
        throw new Error("Invalid window bounds");
      break;
    default:
      throw new Error("Unsupported comparison command");
  }
  return value as unknown as ControlRequest;
}

export function isRendererCommand(
  command: ControlCommand,
): command is RendererCommand {
  return ![
    "status",
    "hideWindow",
    "minimizeWindow",
    "restoreWindow",
    "quit",
    "openWindow",
    "closeWindow",
    "focusWindow",
    "setWindowBounds",
  ].includes(command.op);
}
