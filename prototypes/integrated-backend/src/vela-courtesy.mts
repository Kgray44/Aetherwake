/** Whole utterances only: a courtesy never supplies authority for another action. */
export function pureCourtesyReply(intent: unknown): string | null {
  if (typeof intent !== 'string' || intent.length > 160) return null;
  const phrase = intent.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
  const addressed = phrase.replace(/^vela[,! ]+\s*/u, '').replace(/[, ]+vela(?=[.!]*$)/u, '');
  if (/^(?:(?:awesome|great|perfect|wonderful)[,!. ]+)?(?:thanks(?: very much| a lot)?|thank you(?: very much| so much)?|many thanks)[.!]*$/u.test(addressed))
    return 'You’re welcome.';
  if (/^(?:hi|hello|hey|good morning|good afternoon|good evening)[.!]*$/u.test(addressed))
    return 'Hello.';
  return null;
}
