import test from "node:test";
import assert from "node:assert/strict";
import { renderNoteReading, mountNoteExperience, sourceLinks } from "../note-view.ts";
import { NoteSession } from "../note-session.ts";
import type { NoteExperiencePort, NoteDocument } from "../note-contracts.ts";
import { blockDocument } from "./component-dom.mts";
import { until } from "../../conversation-product/test/component-dom.mts";

test("heading levels form native keyboard disclosures with document hierarchy and preface intact", t => {
  const dom = blockDocument(); t.after(dom.install());
  renderNoteReading(dom.root, "Preface\n# Main\nBody\n## Child\nChild body\n### Detail\nDetail body\n# Next\nEnd");
  const sections = dom.root.querySelectorAll(".aw-note-section");
  assert.equal(sections.length, 4);
  assert.equal(dom.root.children[0].textContent, "Preface");
  assert.equal(sections[1].parentElement, sections[0].querySelector(".aw-note-section-body"));
  assert.equal(sections[2].parentElement, sections[1].querySelector(".aw-note-section-body"));
  assert.equal(sections[3].parentElement, dom.root);
  assert.ok(sections.every(s => s.tagName === "DETAILS" && s.open && s.firstChild.tagName === "SUMMARY"));
  assert.equal(sections[1].firstChild.querySelector("h2").textContent, "Child");
  assert.equal(sections[2].firstChild.querySelector("h3").textContent, "Detail");
});

test("disclosure persists across mounted reading rerenders, including duplicate headings and nested collapse", t => {
  const dom = blockDocument(); t.after(dom.install());
  const text = "# Main\n## Repeated\nFirst\n## Repeated\nSecond\n# Other\nTail";
  renderNoteReading(dom.root, text);
  let sections = dom.root.querySelectorAll(".aw-note-section");
  sections[0].open = false; sections[2].open = false;
  renderNoteReading(dom.root, text + "\nNew body");
  sections = dom.root.querySelectorAll(".aw-note-section");
  assert.deepEqual(sections.map(s => s.open), [false, true, false, true]);
  assert.match(sections[3].textContent, /New body/);
});

test("code fences, safe literal HTML, resource references and bounded preview retain existing semantics", t => {
  const dom = blockDocument(); t.after(dom.install());
  renderNoteReading(dom.root, '# Source\n[Resource](aerynth://resource/fixture)\nhttps://example.org/source\n<script>unsafe()</script>\n```md\n## Not a heading\n<script>code</script>\n```\n## Actual\n> Evidence\n- One');
  assert.equal(dom.root.querySelectorAll(".aw-note-section").length, 2);
  assert.equal(dom.root.querySelector("code").textContent, "## Not a heading\n<script>code</script>\n");
  assert.equal(dom.root.querySelector("script"), null);
  assert.equal(dom.root.querySelector("a"), null, "Links remain safe text; explicit source tools own opening");
  assert.match(dom.root.textContent, /aerynth:\/\/resource\/fixture/);
  assert.deepEqual(sourceLinks('javascript:alert(1) https://example.org/source'), ['https://example.org/source']);
  renderNoteReading(dom.root, "# Bounded\n" + Array.from({ length: 1510 }, (_, i) => "line-" + i).join("\n"));
  assert.match(dom.root.textContent, /Reading preview is limited to 1,500 lines/);
  assert.doesNotMatch(dom.root.textContent, /line-1500/);
});

test("read/edit toggles retain the canonical textarea, selection and authoring text with collapsed sections", async t => {
  const dom = blockDocument(), restore = dom.install();
  dom.doc.addEventListener = () => {}; dom.doc.removeEventListener = () => {};
  const content = '# Fixture\r\nBody\r\n## Child\r\nChild text';
  const resource = { id: 'fixture-note', kind: 'note', title: 'Fixture', version: 1, content, project_id: null };
  const doc: NoteDocument = { resource, draft: null, draftRevision: 0, conflict: false, canRename: false };
  const forbidden = async () => { throw new Error('Disclosure must not mutate canonical content'); };
  const port: NoteExperiencePort = { readNote: async () => structuredClone(doc), saveNoteDraft: forbidden, commitNote: forbidden, discardNoteDraft: forbidden };
  const session = new NoteSession(resource.id, port, resource); await until(() => session.snapshot().phase !== 'loading');
  const editor = dom.doc.createElement('textarea'); dom.root.append(editor);
  const view = mountNoteExperience(dom.root, editor, session, port, { kind: 'note', initialMode: 'read' });
  t.after(() => { view.dispose(); restore(); });
  editor.setSelectionRange(2, 7); dom.root.querySelector('.aw-note-section').open = false;
  const mode = () => dom.root.querySelectorAll('button').find((b: any) => ['Read', 'Edit'].includes(b.textContent));
  mode().onclick(); assert.equal(editor.hidden, false); assert.equal(dom.root.querySelector('textarea'), editor);
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [2, 7]); assert.equal(editor.value, content);
  mode().onclick(); assert.equal(dom.root.querySelector('.aw-note-section').open, false);
  assert.equal(editor.value, content); assert.equal(session.snapshot().content, content);
});
