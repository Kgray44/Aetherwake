import type { VelaMessage } from './contracts.ts';
/** Only the canonical native host can attach acceptedRequestId after a durable
 * delegation claim; provider text or a renderer DTO never supplies this proof. */
export function canonicalUserEvidence(message: Pick<VelaMessage,'classification'|'voice'|'requestId'>): boolean {
  return message.classification === 'observed' || message.classification === 'reported' && message.voice?.transcription === 'provider-reported' &&
    message.voice.completedTurn === false && message.voice.sealed === true && typeof message.requestId === 'string' && message.voice.acceptedRequestId === message.requestId;
}
