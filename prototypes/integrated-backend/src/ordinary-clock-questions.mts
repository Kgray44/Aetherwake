/** Recognize complete device clock questions shared by ordinary chat and Vela. */
export function matchOrdinaryClockQuestion(intent: unknown): 'local.time' | 'local.date' | null {
  if (typeof intent !== 'string' || intent.length > 16000) return null;
  const normalized = intent.normalize('NFKC').trim().toLowerCase().replaceAll('’', "'").replace(/\s+/gu, ' ').replace(/^vela[,:]?\s+/u, '').replace(/[?!.]+$/u, '').trim();
  for (const capability of ordinaryClockQuestions) if ((capability.phrases as readonly string[]).includes(normalized)) return capability.id;
  return null;
}
const ordinaryClockQuestions = [
  { id: 'local.time', phrases: ['what time is it', 'what time is it now', 'what time is it right now', 'what time is it on my computer', 'what is the time', 'what is the time right now', "what's the time", 'what is the current time', "what's the current time", 'what is the local time', "what's the local time", 'what is my local time', 'what is the current local time', "what's the current local time", 'can you tell me the time', 'tell me the time', 'tell me the current time', 'current time', 'local time', 'time'] },
  { id: 'local.date', phrases: ["what is today's date", "what's today's date", 'what is the date', "what's the date", 'what date is it', 'what is the date today', "what's the date today", 'what day is it', 'what day is it today', "today's date", 'current date', 'date'] },
] as const;
