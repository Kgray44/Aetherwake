import type { EventEnvelope } from '../../codex-bridge/src/adapter.ts';
import { ensure, type StreamEvent } from './contracts.mts';

const maxOutputBytes = 65536;
const maxPendingEvents = 512;
type CompletedMessage = { id: string; text: string; phase: 'commentary' | 'final_answer' | null };
type Output = { kind: 'delta'; id: string | null; text: string; recorded: StreamEvent }
  | { kind: 'completed'; message: CompletedMessage };

function completedMessage(value: unknown): CompletedMessage | undefined {
  if (!value || typeof value !== 'object') return;
  const { type, id, text, phase } = value as Record<string, unknown>;
  if (type !== 'agentMessage' || typeof id !== 'string' || !id || typeof text !== 'string') return;
  if (phase != null && phase !== 'commentary' && phase !== 'final_answer') return;
  return { id, text, phase: phase ?? null };
}

/** Text for one native turn. Early stdout events remain private until turn/start binds the turn. */
export class CodexTurnOutput {
  private turnId: string | null = null;
  private pending: { turnId: string; output: Output }[] = [];
  private pendingBytes = 0;
  private deltaBytes = 0;
  private completedBytes = 0;
  private readonly deltas: { id: string | null; text: string }[] = [];
  private readonly completed = new Map<string, CompletedMessage>();
  private readonly threadId: string;
  private readonly presentDelta: (text: string, recorded: StreamEvent) => void;

  constructor(threadId: string, presentDelta: (text: string, recorded: StreamEvent) => void) {
    this.threadId = threadId;
    this.presentDelta = presentDelta;
  }

  ingest(event: EventEnvelope, recorded: StreamEvent) {
    const turnId = event.providerTurnId;
    if (event.providerThreadId !== this.threadId || !turnId || (this.turnId && turnId !== this.turnId)) return;
    let output: Output;
    if (event.method === 'item/agentMessage/delta' && typeof event.payload.delta === 'string' && event.payload.delta.length) {
      const itemId = event.payload.itemId;
      output = { kind: 'delta', id: typeof itemId === 'string' ? itemId : null, text: event.payload.delta, recorded };
    } else if (event.method === 'item/completed') {
      const message = completedMessage(event.payload.item);
      if (!message) return;
      output = { kind: 'completed', message };
    } else return;

    if (this.turnId) {
      this.accept(output);
      return;
    }
    this.pendingBytes += Buffer.byteLength(output.kind === 'delta' ? output.text : output.message.text);
    ensure(this.pending.length < maxPendingEvents && this.pendingBytes <= 2 * maxOutputBytes, 'provider_early_output_too_large');
    this.pending.push({ turnId, output });
  }

  bind(turnId: string) {
    this.turnId = turnId;
    const pending = this.pending;
    this.pending = [];
    for (const event of pending) if (event.turnId === turnId) this.accept(event.output);
  }

  finish(terminal: EventEnvelope): string {
    const turn = terminal.payload.turn as { items?: unknown } | undefined;
    if (Array.isArray(turn?.items)) {
      for (const item of turn.items) {
        const message = completedMessage(item);
        if (message) this.saveCompleted(message);
      }
    }

    const messages = [...this.completed.values()];
    const final = messages.filter(message => message.phase === 'final_answer');
    const unphased = messages.filter(message => message.phase === null);
    const authoritative = final.length ? final : unphased;
    if (authoritative.length) {
      const text = authoritative.map(message => message.text).join('\n\n');
      ensure(Buffer.byteLength(text) <= maxOutputBytes, 'provider_output_too_large');
      return text;
    }
    // Older providers can stream the final without sending a completed item.
    // Drop deltas attributed to known commentary, and fail closed for
    // unattributed legacy deltas when any commentary is known.
    return this.deltas.filter(delta => delta.id === null ? !messages.length : !this.completed.has(delta.id))
      .map(delta => delta.text).join('');
  }

  private accept(output: Output) {
    if (output.kind === 'completed') {
      this.saveCompleted(output.message);
      return;
    }
    this.deltaBytes += Buffer.byteLength(output.text);
    ensure(this.deltaBytes <= maxOutputBytes, 'provider_output_too_large');
    this.deltas.push({ id: output.id, text: output.text });
    this.presentDelta(output.text, output.recorded);
  }

  private saveCompleted(message: CompletedMessage) {
    const previous = this.completed.get(message.id);
    this.completedBytes += Buffer.byteLength(message.text) - Buffer.byteLength(previous?.text ?? '');
    ensure((previous || this.completed.size < maxPendingEvents) && this.completedBytes <= maxOutputBytes, 'provider_output_too_large');
    this.completed.set(message.id, message);
  }
}
