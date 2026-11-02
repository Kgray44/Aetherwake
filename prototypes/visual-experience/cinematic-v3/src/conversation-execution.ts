import type {
  ConversationExecution,
  ConversationExecutionObservation,
  ConversationExecutionPort,
} from "../../../conversation-product/src/chat.ts";

type Host = {
  command(
    name: "executionStatus" | "interrupt",
    input: Record<string, unknown>,
  ): Promise<unknown>;
  onEvent(listener: (event: unknown) => void): () => void;
  visible(): boolean;
  onError?(error: unknown): void;
  schedule?(tick: () => void, intervalMs: number): () => void;
};
const active = (execution: ConversationExecution) =>
  ["dispatching", "running"].includes(execution.state);
const states = [
  "dispatching",
  "running",
  "provider_completed",
  "failed",
  "interrupted",
  "unknown",
];
const text = (value: unknown, max = 256): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const timestamp = (value: unknown): value is string =>
  text(value, 64) && Number.isFinite(Date.parse(value));
function publicExecution(value: unknown): ConversationExecution | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    !text(item.id) ||
    !text(item.resourceId) ||
    !text(item.providerId) ||
    !text(item.commandId) ||
    !states.includes(String(item.state)) ||
    !timestamp(item.startedAt) ||
    !(item.endedAt === null || timestamp(item.endedAt)) ||
    item.taskVerified !== false ||
    !(item.errorCode === undefined || text(item.errorCode, 512))
  )
    return null;
  return {
    id: item.id,
    resourceId: item.resourceId,
    providerId: item.providerId,
    commandId: item.commandId,
    state: item.state as ConversationExecution["state"],
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    taskVerified: false,
    ...(item.errorCode ? { errorCode: item.errorCode as string } : {}),
  };
}
type Delta = {
  resourceId: string;
  executionId: string;
  providerId: string;
  eventId: string;
  cursor: number;
  text: string;
};

/** Observing actual native execution never starts a provider or writes canonical
 * data. Explicit Stop remains a separate native command; there is no second store. */
export function createConversationExecutionPort(
  host: Host,
): ConversationExecutionPort & { dispose(): void } {
  const watchers = new Map<
    string,
    Set<(value: ConversationExecutionObservation) => void>
  >();
  const latest = new Map<string, ConversationExecution>();
  const pending: Delta[] = [];
  const seen = new Set<string>();
  let pendingBytes = 0,
    connected: boolean | undefined,
    stopped = false;
  let stopEvents: (() => void) | undefined, stopTimer: (() => void) | undefined;
  let reading: Promise<void> | undefined,
    readAgain = false,
    connectionEpoch = 0;
  const notify = (id: string, value: ConversationExecutionObservation) => {
    for (const listener of watchers.get(id) ?? []) listener(value);
  };
  const connection = (available: boolean) => {
    if (connected === available) return;
    connected = available;
    for (const id of watchers.keys())
      notify(id, { connection: available ? "available" : "unavailable" });
  };
  function deliver(delta: Delta) {
    const execution = latest.get(delta.resourceId);
    if (
      !execution ||
      execution.id !== delta.executionId ||
      execution.providerId !== delta.providerId
    )
      return false;
    const key = delta.executionId + ":" + delta.eventId;
    if (seen.has(key)) return true;
    seen.add(key);
    if (seen.size > 4096) seen.delete(seen.values().next().value!);
    notify(delta.resourceId, {
      execution,
      connection: "available",
      delta: { eventId: delta.eventId, cursor: delta.cursor, text: delta.text },
    });
    return true;
  }
  async function refresh() {
    if (stopped || !watchers.size || !host.visible()) return;
    if (reading) {
      readAgain = true;
      return reading;
    }
    const epoch = connectionEpoch;
    reading = (async () => {
      try {
        const result = await host.command("executionStatus", {});
        if (stopped || !watchers.size || epoch !== connectionEpoch) return;
        if (!Array.isArray(result))
          throw new Error("Invalid native execution status");
        const rows = result
          .map(publicExecution)
          .filter((item): item is ConversationExecution => !!item);
        connection(true);
        for (const id of watchers.keys()) {
          const next = rows
            .filter((row) => row.resourceId === id)
            .reverse()
            .sort(
              (a, b) =>
                Number(active(b)) - Number(active(a)) ||
                b.startedAt.localeCompare(a.startedAt),
            )[0];
          if (!next) {
            latest.delete(id);
            continue;
          }
          const previous = latest.get(id);
          latest.set(id, next);
          if (JSON.stringify(previous) !== JSON.stringify(next))
            notify(id, { execution: next, connection: "available" });
        }
        for (const delta of pending.splice(0)) deliver(delta);
        pendingBytes = 0;
      } catch (error) {
        if (!stopped && watchers.size && epoch === connectionEpoch) {
          connection(false);
          host.onError?.(error);
        }
      }
    })().finally(() => {
      reading = undefined;
      if (readAgain) {
        readAgain = false;
        void refresh();
      }
    });
    return reading;
  }
  function observeEvent(raw: unknown) {
    if (stopped || !raw || typeof raw !== "object") return;
    const event = raw as Record<string, any>;
    if (event.type === "backend/disconnected") {
      connectionEpoch++;
      connection(false);
      return;
    }
    if (!watchers.has(event.resourceId)) return;
    if (
      event.type === "item/agentMessage/delta" &&
      event.payload?.redacted === true &&
      typeof event.payload.delta === "string" &&
      ["reported", "observed"].includes(event.classification) &&
      text(event.executionId) &&
      text(event.providerId) &&
      text(event.eventId) &&
      Number.isSafeInteger(event.cursor) &&
      event.cursor > 0
    ) {
      const delta: Delta = {
        resourceId: event.resourceId,
        executionId: event.executionId,
        providerId: event.providerId,
        eventId: event.eventId,
        cursor: event.cursor,
        text: event.payload.delta,
      };
      if (deliver(delta)) return;
      const bytes = new TextEncoder().encode(delta.text).byteLength;
      if (pending.length >= 256 || pendingBytes + bytes > 65536) {
        pending.length = 0;
        pendingBytes = 0;
        host.onError?.(
          new Error(
            "Live output preview capacity reached; canonical history remains available",
          ),
        );
      } else {
        pending.push(delta);
        pendingBytes += bytes;
      }
      void refresh();
    } else if (
      !latest.has(event.resourceId) ||
      /^(execution|turn|thread|stream)\//.test(String(event.type))
    )
      void refresh();
  }
  function stopIdle() {
    if (watchers.size) return;
    stopEvents?.();
    stopTimer?.();
    stopEvents = stopTimer = undefined;
    latest.clear();
    pending.length = 0;
    pendingBytes = 0;
    seen.clear();
    connected = undefined;
  }
  return {
    observe(resourceId, listener) {
      if (stopped || !text(resourceId))
        throw new Error("Conversation observation unavailable");
      const listeners = watchers.get(resourceId) ?? new Set();
      watchers.set(resourceId, listeners);
      listeners.add(listener);
      if (!stopEvents) {
        stopEvents = host.onEvent(observeEvent);
        stopTimer = (
          host.schedule ??
          ((tick, intervalMs) => {
            const timer = setInterval(tick, intervalMs);
            return () => clearInterval(timer);
          })
        )(() => {
          void refresh();
        }, 1000);
      }
      const execution = latest.get(resourceId);
      if (execution)
        listener({
          execution,
          ...(connected === undefined
            ? {}
            : { connection: connected ? "available" : "unavailable" }),
        });
      else if (connected !== undefined)
        listener({ connection: connected ? "available" : "unavailable" });
      void refresh();
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        listeners.delete(listener);
        if (!listeners.size) {
          watchers.delete(resourceId);
          latest.delete(resourceId);
        }
        stopIdle();
      };
    },
    async cancel(executionId) {
      await refresh();
      if (
        ![...latest.values()].some(
          (value) =>
            value.id === executionId &&
            active(value) &&
            watchers.has(value.resourceId),
        )
      )
        throw new Error("No observed active conversation turn to stop");
      const result = await host.command("interrupt", { executionId });
      await refresh();
      return result;
    },
    dispose() {
      stopped = true;
      watchers.clear();
      stopIdle();
    },
  };
}
