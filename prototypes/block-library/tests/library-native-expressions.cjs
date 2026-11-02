const { Script } = require('node:vm');
const { createHash } = require('node:crypto');
const q = JSON.stringify;
const app = 'window.__aerynth.application()';
const buttonQuery = (label, prefix) => `[...root.querySelectorAll('button')].find(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),t=e.textContent.trim();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!e.disabled&&${prefix ? `t.startsWith(${q(label)})` : `t===${q(label)}`}})`;
const pathFor = (scope, query) => `(()=>{const root=document.querySelector(${q(scope)});if(!root)return null;const e=(${query});if(!e||!root.contains(e))return null;const parts=[];for(let n=e;n!==root;n=n.parentElement){if(!n?.parentElement)return null;parts.unshift(n.tagName.toLowerCase()+':nth-child('+([...n.parentElement.children].indexOf(n)+1)+')')}return ${q(scope)}+(parts.length?' > '+parts.join(' > '):'')})()`;

/** Every renderer expression used by the A/C verifier is constructed here.
 * Selectors, labels and values are data encoded with JSON, never quote layers. */
const expressions = {
  ready: () => `!!${app}?.navigation`,
  host: (command, input = {}) => `window.aerynthHost.command(${q(command)},${q(input)})`,
  buttonPath: (scope, label, prefix = false) => pathFor(scope, buttonQuery(label, prefix)),
  buttonExists: (scope, label, prefix = false) => `(()=>{const root=document.querySelector(${q(scope)});return !!root&&!!(${buttonQuery(label, prefix)})})()`,
  fieldPath: (scope, label) => pathFor(scope, `[...root.querySelectorAll('label')].find(e=>e.firstChild?.textContent?.trim()===${q(label)})?.querySelector('input,select,textarea')`),
  summaryPath: (scope, label) => pathFor(scope, `[...root.querySelectorAll('summary')].find(e=>e.textContent.trim()===${q(label)})`),
  optionIndex: (selector, value) => `(()=>{const e=document.querySelector(${q(selector)});return e?[...e.options].findIndex(o=>o.value===${q(value)}&&!o.disabled):-1})()`,
  valueIs: (selector, value) => `document.querySelector(${q(selector)})?.value===${q(value)}`,
  point: selector => `(()=>{const e=document.querySelector(${q(selector)}),r=e?.getBoundingClientRect();if(!r?.width||!r.height)return null;const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),h=document.elementFromPoint(x,y);return h&&(e===h||e.contains(h))?{x,y}:null})()`,
  surfacePoint: (selector, card) => `(()=>{const e=document.querySelector(${q(selector)}),c=document.querySelector(${q(card)}),r=e?.getBoundingClientRect();if(!c||!e||!c.contains(e)||e.closest('[inert]')||!r?.width||!r.height||getComputedStyle(e).visibility==='hidden')return null;const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),h=document.elementFromPoint(x,y);return h&&h.closest('[data-block]')===c&&!h.closest('input,textarea,select,button,a,[contenteditable=true],[role=log],pre,[data-no-card-drag]')?{x,y}:null})()`,
  targetDiagnostics: selector => `(()=>{const e=${selector ? `document.querySelector(${q(selector)})` : `null`},r=e?.getBoundingClientRect(),describe=n=>n?{tag:n.tagName,id:n.id,className:typeof n.className==='string'?n.className:'',blockId:n.closest('[data-block]')?.dataset.block,ariaLabel:n.getAttribute('aria-label')?.slice(0,160)}:null,rect=n=>{const r=n?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null},ancestors=[];for(let n=e;n&&ancestors.length<6;n=n.parentElement){const s=getComputedStyle(n);ancestors.push({element:describe(n),rect:rect(n),display:s.display,visibility:s.visibility,pointerEvents:s.pointerEvents,overflow:s.overflow,clipPath:s.clipPath,inert:n.inert})}const center=r?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null;return {selector:${q(selector)},target:describe(e),rect:rect(e),center,hit:center?describe(document.elementFromPoint(center.x,center.y)):null,ancestors,viewport:{width:innerWidth,height:innerHeight},cards:[...document.querySelectorAll('.folio[data-block]')].slice(0,16).map(n=>({element:describe(n),rect:rect(n),composition:n.dataset.blockComposition,expanded:n.classList.contains('expanded')}))}})()`,
  graphics: () => `(()=>{const s=window.__aerynth.snapshot();return {failed:s.graphicsFailed,contextLost:s.gpu?.contextLost,errorCount:s.metrics.errors.length,errors:s.metrics.errors.slice(0,20).map(e=>String(e).slice(0,1000)),draws:s.metrics.draws}})()`,
  failureContext: () => `({activeWorkspaceId:${app}?.activeWorkspaceId,libraryStatus:document.querySelector('.aw-library__status')?.textContent?.slice(0,1000),commandStatus:document.querySelector('#command-error')?.textContent?.slice(0,1000)})`,
  drawsAfter: count => `window.__aerynth.snapshot().metrics.draws>${q(count)}`,
  exists: selector => `!!document.querySelector(${q(selector)})`,
  absent: selector => `!document.querySelector(${q(selector)})`,
  enabled: selector => `!!document.querySelector(${q(selector)})&&!document.querySelector(${q(selector)}).disabled`,
  activeWorkspace: id => `${app}.navigation.kind==='workspace'&&${app}.activeWorkspaceId===${q(id)}`,
  textMetrics: selector => `(()=>{const e=document.querySelector(${q(selector)});return {scale:parseFloat(getComputedStyle(e).getPropertyValue('--aw-block-text-scale'))||1,font:parseFloat(getComputedStyle(e.querySelector('textarea')).fontSize)}})()`,
  fontSize: selector => `parseFloat(getComputedStyle(document.querySelector(${q(selector)})).fontSize)`,
  fontCloseTo: (selector, value) => `Math.abs(parseFloat(getComputedStyle(document.querySelector(${q(selector)})).fontSize)-${q(value)})<.1`,
  settingScale: (id, value) => `window.aerynthHost.command('library',${q({ name: 'getBlockSettings', input: id })}).then(r=>r.result.configuration.textScale===${q(value)})`,
  projectNamed: title => `${app}.projects.some(p=>p.title===${q(title)})`,
  workspaceNamed: title => `!document.querySelector('.aw-library')&&${app}.workspaces.some(w=>w.title===${q(title)})`,
  organizationIs: mode => `${app}.organization.mode===${q(mode)}`,
  taskStatusIs: (id, status) => `${app}.resources.find(r=>r.id===${q(id)})?.taskStatus===${q(status)}`,
  conversationHasUser: (id, message) => `window.aerynthHost.command('conversation',${q({ name: 'detail', input: { resourceId: id, limit: 50 } })}).then(r=>r.messages.total===1&&r.messages.items[0].role==='user'&&r.messages.items[0].content===${q(message)})`,
  resourceTextIs: (id, text) => `${app}.resources.find(r=>r.id===${q(id)})?.content===${q(text)}`,
  noteAndEditorText: (selector, id, text) => `document.querySelector(${q(selector)})?.value===${q(text)}&&${app}.resources.find(r=>r.id===${q(id)})?.content===${q(text)}`,
  blockAbsent: (key, id) => `!${app}.blocks.some(b=>b[${q(key)}]===${q(id)})`,
  layoutAfter: revision => `${app}.layoutVersion>${q(revision)}`,
  templateNamed: name => `window.aerynthHost.command('library',${q({ name: 'listTemplates', input: { query: name } })}).then(r=>r.result.some(t=>t.name===${q(name)}))`,
  previewTiles: () => `document.querySelector('.aw-library__layout')?.children.length`,
  emptyBackground: () => `(()=>{for(let y=150;y<innerHeight-80;y+=45)for(let x=45;x<innerWidth-40;x+=55){const e=document.elementFromPoint(x,y);if(e&&['world','stage','app'].includes(e.id))return{x,y}}return null})()`,
  wheelContext: point => `(()=>{const a=document.activeElement,blocked=!!document.querySelector('.aw-contextual-surface, dialog[open], .floating-dialog:not([hidden]), .folio.dragging'),editing=!!a?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'),point=${q(point)},hit=point?document.elementFromPoint(point.x,point.y):null,background=!!hit&&['world','stage','app'].includes(hit.id),application=${app};return {ready:application.navigation.kind==='workspace'&&background&&!blocked&&!editing&&!document.hidden&&document.hasFocus(),navigation:application.navigation,viewport:application.viewport,blocked,editing,hidden:document.hidden,focused:document.hasFocus(),activeElement:a?{tag:a.tagName,id:a.id,className:typeof a.className==='string'?a.className:''}:null,point,hit:hit?{tag:hit.tagName,id:hit.id,className:typeof hit.className==='string'?hit.className:''}:null,surfaces:[...document.querySelectorAll('.aw-contextual-surface,dialog[open],.floating-dialog:not([hidden])')].slice(0,8).map(n=>({tag:n.tagName,id:n.id,className:n.className,ariaLabel:n.getAttribute('aria-label')}))}})()`,
  dpi: () => 'devicePixelRatio',
  navigationIs: kind => `${app}.navigation.kind===${q(kind)}`,
  containsText: (selector, text) => `document.querySelector(${q(selector)}).textContent.includes(${q(text)})`,
  draftIs: (id, text) => `window.aerynthHost.command('conversation',${q({ name: 'readDraft', input: { resourceId: id } })}).then(r=>r.content===${q(text)})`,
};
exports.expressions = Object.freeze(expressions);
exports.compileExpression = source => {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 65536) throw Error('bounded_renderer_expression_required');
  new Script(source, { filename: 'native-library-expression.js' });
  // Match the driver's guarded expression/return context as well as direct JS.
  new Script(`(()=>{try{return (${source})}catch{return false}})()`, { filename: 'native-library-wait-expression.js' });
  return source;
};
exports.preflight = () => {
  const selector = '.aw-library input[aria-label="Search workspace templates"]', label = 'Synthetic "quoted" \'label\'\nwith ] ) /* characters', id = 'synthetic-id-"quote\'\n', scope = '.aw-library__detail > form';
  const inputs = {
    ready: [[]], host: [['library', { name: 'getTemplate', input: id }], ['conversation', { name: 'readDraft', input: { resourceId: id } }], ['executionStatus', {}]],
    buttonPath: [[scope, label, false], [scope, label, true]], buttonExists: [[scope, label, false], [scope, label, true]],
    fieldPath: [[scope, label]], summaryPath: [[scope, label]], optionIndex: [[selector, label]], valueIs: [[selector, label]], point: [[selector]],
    surfacePoint: [[selector, '[data-block="synthetic"]']], targetDiagnostics: [[selector]],
    graphics: [[]], failureContext: [[]], drawsAfter: [[17]], exists: [[selector], ['.aw-library input[aria-label="Search blocks"]']], absent: [[selector]], enabled: [[selector]], activeWorkspace: [[id]],
    textMetrics: [[selector]], fontSize: [[selector]], fontCloseTo: [[selector, 24]], settingScale: [[id, 1.5]], projectNamed: [[label]], workspaceNamed: [[label]], organizationIs: [['freeform']], taskStatusIs: [[id, 'done']],
    conversationHasUser: [[id, label]], resourceTextIs: [[id, label]], noteAndEditorText: [[selector, id, label]], blockAbsent: [['id', id], ['resource_id', id]], layoutAfter: [[23]], templateNamed: [[label]],
    previewTiles: [[]], emptyBackground: [[]], wheelContext: [[{ x: 45, y: 220 }]], dpi: [[]], navigationIs: [['constellation']], containsText: [[selector, label]], draftIs: [[id, label]],
  };
  const names = Object.keys(expressions).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(inputs).sort())) throw Error('uncovered_renderer_expression_factory');
  const compiled = [];
  for (const name of names) for (const args of inputs[name]) {
    const source = expressions[name](...args); exports.compileExpression(source); compiled.push([name, source]);
  }
  return { factories: names.length, cases: compiled.length, names, sha256: createHash('sha256').update(JSON.stringify(compiled)).digest('hex') };
};
