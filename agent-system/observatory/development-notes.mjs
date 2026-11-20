const categories = new Set(['finding','warning','follow_up','decision']);
export const notesCategory = category => ({finding:'Finding',warning:'Warning',follow_up:'Follow-up',decision:'Decision'})[category];
const unsafe = /[\x00-\x1f\x7f]|(?:https?:\/\/|file:\/\/|[a-z]:[\\/]|\\\\|(?:^|\s)\/[\w.-]+\/)|(?:\b(?:password|api[_ -]?key|secret|token)\s*[:=])|\b[A-Za-z0-9_-]{36,}\b/i;

export function validDevelopmentNote(note) {
  return Boolean(note&&Object.keys(note).length===2&&categories.has(note.category)&&
    typeof note.text==='string'&&note.text.trim()===note.text&&note.text.length>0&&note.text.length<=160&&!unsafe.test(note.text));
}

export function parseDevelopmentNote(text) {
  if (typeof text!=='string'||text.length>200) return null;
  const match=/^Development note \[(finding|warning|follow_up|decision)\]: (.+)$/.exec(text.trim());
  if (!match) return null;
  const note={category:match[1],text:match[2]};
  return validDevelopmentNote(note)?note:null;
}

export function taskDevelopmentNotes(taskId,events,attempts) {
  const byId=new Map(attempts.map(attempt=>[attempt.id,attempt]));
  return events.filter(event=>{
    const attempt=byId.get(event.attempt_id);
    return event.task_id===taskId&&event.kind==='development_note'&&attempt&&attempt.revision===event.revision&&
      attempt.session_id===event.session_id&&validDevelopmentNote(event.development_note);
  }).sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||a.event_id.localeCompare(b.event_id));
}

export function developmentNoteBytes(notes) {
  const encoder=new TextEncoder();
  return notes.reduce((total,event)=>total+encoder.encode(event.development_note.text).byteLength,0);
}
