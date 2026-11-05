import type {
  ConversationExecution,
  ConversationExecutionObservation,
  ConversationExecutionPort,
} from "../../../conversation-product/src/chat.ts";

type Host = {
  command(
    name: "conversationActivity" | "interrupt" | "reconcileConversationTurn",
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
    ...(item.recoveryAvailable === true ? { recoveryAvailable: true as const } : {}),
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
  const availability = new Map<string, boolean>();
  const signatures = new Map<string, string>();
  const forceSnapshot = new Set<string>();
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
      availability.get(delta.resourceId) !== true ||
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
    const scopes = new Map(watchers);
    reading = (async () => {
      try {
        const ids = [...scopes.keys()];
        const results: {
          resources: { resourceId: string; available: boolean }[];
          executions: ConversationExecution[];
          preview: {
            resourceId: string;
            executionId: string;
            providerId: string;
            cursor: number;
            text: string;
            classification: string;
          } | null;
        }[] = [];
        for (let offset = 0; offset < ids.length; offset += 64) {
          const requested = ids.slice(offset, offset + 64);
          const value = (await host.command("conversationActivity", {
            resourceIds: requested,
          })) as any;
          const invalid = () => {
            throw new Error("Invalid scoped conversation activity");
          };
          if (
            value?.contract !== "aerynth.conversation-activity@1" ||
            !Array.isArray(value.resources) ||
            !Array.isArray(value.executions) ||
            value.resources.length !== requested.length ||
            value.executions.length > requested.length
          )
            invalid();
          const resources = value.resources as {
            resourceId: string;
            available: boolean;
          }[];
          if (
            new Set(resources.map((item) => item?.resourceId)).size !==
              requested.length ||
            resources.some(
              (item) =>
                !requested.includes(item?.resourceId) ||
                typeof item?.available !== "boolean",
            )
          )
            invalid();
          const executions = value.executions.map(
            publicExecution,
          ) as (ConversationExecution | null)[];
          if (
            executions.some(
              (item) =>
                !item ||
                !resources.some(
                  (resource) =>
                    resource.resourceId === item.resourceId &&
                    resource.available,
                ),
            ) ||
            new Set(executions.map((item) => item?.resourceId)).size !==
              executions.length
          )
            invalid();
          const preview = value.preview;
          if (
            preview !== null &&
            (!preview ||
              !text(preview.resourceId) ||
              !text(preview.executionId) ||
              !text(preview.providerId) ||
              !Number.isSafeInteger(preview.cursor) ||
              preview.cursor < 0 ||
              typeof preview.text !== "string" ||
              new TextEncoder().encode(preview.text).byteLength > 65536 ||
              !["reported", "simulated"].includes(preview.classification) ||
              !executions.some(
                (item) =>
                  item !== null &&
                  item.id === preview.executionId &&
                  item.resourceId === preview.resourceId &&
                  item.providerId === preview.providerId &&
                  active(item),
              ))
          )
            invalid();
          results.push({
            resources,
            executions: executions as ConversationExecution[],
            preview,
          });
        }
        if (
          stopped ||
          !watchers.size ||
          epoch !== connectionEpoch ||
          !host.visible()
        )
          return;
        connection(true);
        for (const result of results)
          for (const resource of result.resources) {
            const id = resource.resourceId;
            if (watchers.get(id) !== scopes.get(id)) continue;
            availability.set(id, resource.available);
            const next = result.executions.find(
              (item) => item.resourceId === id,
            );
            if (next) latest.set(id, next);
            else latest.delete(id);
            const preview =
              result.preview?.resourceId === id &&
              result.preview.classification === "reported"
                ? result.preview
                : null;
            const signature = JSON.stringify({
              available: resource.available,
              execution: next,
              preview,
            });
            if (signature !== signatures.get(id) || forceSnapshot.has(id)) {
              signatures.set(id, signature);
              forceSnapshot.delete(id);
              notify(id, {
                resourceAvailable: resource.available,
                connection: "available",
                ...(next ? { execution: next } : {}),
                ...(preview
                  ? {
                      preview: {
                        executionId: preview.executionId,
                        cursor: preview.cursor,
                        text: preview.text,
                      },
                    }
                  : {}),
              });
            }
          }
        for (const delta of pending.splice(0))
          if (watchers.get(delta.resourceId) === scopes.get(delta.resourceId))
            deliver(delta);
        pendingBytes = 0;
      } catch (error) {
        if (!stopped && watchers.size && epoch === connectionEpoch) {
          connection(false);
          availability.clear();
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
      availability.clear();
      return;
    }
    if (!watchers.has(event.resourceId) || !host.visible()) return;
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
    connectionEpoch++;
    stopEvents?.();
    stopTimer?.();
    stopEvents = stopTimer = undefined;
    latest.clear();
    availability.clear();
    signatures.clear();
    forceSnapshot.clear();
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
      forceSnapshot.add(resourceId);
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
      if (connected === false)
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
          availability.delete(resourceId);
          signatures.delete(resourceId);
          forceSnapshot.delete(resourceId);
        }
        stopIdle();
      };
    },
    async recoverTurn(resourceId, executionId) {
      const turn = latest.get(resourceId);
      if (!watchers.has(resourceId) || turn?.id !== executionId ||
          turn.state !== "unknown" || !turn.recoveryAvailable)
        throw new Error("No observed Codex turn to check");
      const result = (await host.command("reconcileConversationTurn", { resourceId, executionId })) as
        { state: "unchanged" | "provider_completed" | "failed" | "interrupted" };
      await refresh();
      return result;
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
