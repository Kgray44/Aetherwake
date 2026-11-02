import type { BlockLibraryHostPort, BlockKind, BlockCategory, CreatedBlock, LibraryCapabilities, TemplateMountOptions, WorkspaceTemplatePort, WorkspaceTemplate, TemplateApplyInput, CaptureChoices, VelaTemplatePlan } from './contracts.ts';
import { searchBlocks, blockDefinition, blockAvailability } from './registry.ts';
import { captureWorkspaceTemplate } from './model.ts';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
};
const button = (text: string, run: () => void) => { const element = node('button','aw-library__button',text); element.type = 'button'; element.onclick = run; return element; };
const field = (label: string, input: HTMLElement) => { const element = node('label','aw-library__field',label); element.append(input); return element; };
const errorText = (error: unknown) => error instanceof Error ? error.message.replaceAll('_',' ') : 'The host could not complete this operation.';
const commandId = () => 'library:' + crypto.randomUUID();
function shell(root: HTMLElement, title: string, onClose: () => void) {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const panel = node('section','aw-library'); panel.setAttribute('role','region'); panel.setAttribute('aria-label',title);
  const header = node('header','aw-library__header'), heading = node('h2','',title), close = button('Close',onClose);
  header.append(heading,close); const status = node('p','aw-library__status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const body = node('div','aw-library__body'); panel.append(header,status,body); root.append(panel);
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
  panel.addEventListener('keydown',escape);
  let disposed = false;
  return {panel,body,status,get disposed(){return disposed;},dispose(){disposed=true;panel.removeEventListener('keydown',escape);panel.remove();previousFocus?.focus();}};
}

/** Contextual Add surface only. Created blocks open the parent's existing canonical controls. */
export function mountBlockLibrary(root: HTMLElement, port: BlockLibraryHostPort, options: {
  workspaceId: string; expectedLayoutVersion: number | (() => number); onCreated(result: CreatedBlock): void | Promise<void>; onClose(): void;
}) {
  const ui = shell(root,'Block Library',options.onClose), search = node('input'), category = node('select'), columns = node('div','aw-library__columns'), list = node('div','aw-library__list'), detail = node('div','aw-library__detail');
  search.type='search'; search.placeholder='Search blocks, actions or categories'; search.setAttribute('aria-label','Search blocks');
  for (const [value,label] of [['','All categories'],['conversation','Conversation'],['knowledge','Knowledge'],['planning','Planning'],['observability','Observability']]) {const option=node('option','',label);option.value=value;category.append(option);}
  category.setAttribute('aria-label','Block category'); columns.append(list,detail);ui.body.append(search,category,columns);
  let capabilities: LibraryCapabilities | null=null, selected: BlockKind='conversation', pending=false;
  const showDetail = () => {
    detail.replaceChildren(); if (!capabilities) return;
    const definition=blockDefinition(selected), available=blockAvailability(selected,capabilities), title=node('input');title.value=definition.title;title.maxLength=120;title.required=true;
    const heading=node('h3','',definition.title), description=node('p','',definition.description), preview=node('p','aw-library__preview',definition.preview), controls=node('ul');
    for (const action of definition.controls) controls.append(node('li','',action));
    const form=node('form'), provider=node('select');const later=node('option','','Choose provider later (empty conversation)');later.value='';provider.append(later);
    if (selected==='conversation') for (const name of ['local','codex'] as const) {const state=capabilities.providers[name];const option=node('option','',name+' — '+(state?.reason ?? state?.state ?? 'unknown'));option.value=name;option.disabled=state?.state!=='available';provider.append(option);}
    const create=node('button','aw-library__button','Add '+definition.title);create.type='submit';create.disabled=available.state!=='available'||pending;
    form.append(field('Title',title));if(selected==='conversation')form.append(field('Conversation backend',provider));form.append(create);
    if(available.state!=='available')form.append(node('p','aw-library__limitation',available.reason ?? 'Unavailable: '+available.state));
    form.onsubmit=event=>{event.preventDefault();if(pending||!capabilities)return;pending=true;create.disabled=true;ui.status.textContent='Saving block…';
      const kind=selected;
      void port.createBlock({commandId:commandId(),workspaceId:options.workspaceId,expectedLayoutVersion:typeof options.expectedLayoutVersion==='function'?options.expectedLayoutVersion():options.expectedLayoutVersion,kind,title:title.value,...(kind==='conversation'&&provider.value?{provider:provider.value as 'local'|'codex'}:{})})
        .then(async result=>{if(ui.disposed)return;ui.status.textContent='Block saved.';await options.onCreated(result);})
        .catch(error=>{if(!ui.disposed)ui.status.textContent=errorText(error);})
        .finally(()=>{pending=false;if(!ui.disposed)create.disabled=available.state!=='available';});};
    detail.append(heading,description,preview,node('h4','','Canonical controls'),controls,form);
  };
  const renderList=()=>{if(!capabilities)return;list.replaceChildren();const results=searchBlocks(search.value,capabilities,(category.value||undefined) as BlockCategory|undefined);
    if(!results.length)list.append(node('p','','No matching supported block types.'));
    for(const definition of results){const item=button(definition.title+(definition.availability.state==='available'?'':' · '+definition.availability.state),()=>{selected=definition.kind;renderList();showDetail();});item.setAttribute('aria-pressed',String(definition.kind===selected));list.append(item);}
  };
  search.oninput=renderList;category.onchange=renderList;ui.status.textContent='Reading host capabilities…';
  void port.capabilities().then(value=>{if(ui.disposed)return;capabilities=value;ui.status.textContent='';renderList();showDetail();search.focus();}).catch(error=>{if(!ui.disposed)ui.status.textContent=errorText(error);});
  return {dispose:ui.dispose,refreshCapabilities:async()=>{const value=await port.capabilities();if(!ui.disposed){capabilities=value;renderList();showDetail();}}};
}

export function mountWorkspaceTemplates(root: HTMLElement, port: WorkspaceTemplatePort, options: TemplateMountOptions) {
  const ui=shell(root,'New Workspace',options.onClose), toolbar=node('div','aw-library__toolbar'), search=node('input'), archived=node('input'), columns=node('div','aw-library__columns'),list=node('div','aw-library__list'),detail=node('div','aw-library__detail');
  search.type='search';search.placeholder='Search workspace templates';search.setAttribute('aria-label','Search workspace templates');archived.type='checkbox';
  const saveCurrent=button('Save current workspace as template',()=>showSaveCurrent()),ask=button('Ask Vela',()=>showVela());saveCurrent.disabled=!options.currentWorkspace;
  toolbar.append(saveCurrent,ask,field('Include archived',archived));columns.append(list,detail);ui.body.append(search,toolbar,columns);
  let pending=false, sequence=0, capabilities:LibraryCapabilities|null=null;
  async function run<T>(message:string,operation:()=>Promise<T>):Promise<T|undefined>{if(pending)return;pending=true;ui.panel.setAttribute('aria-busy','true');ui.status.textContent=message;
    try{const result=await operation();if(!ui.disposed){ui.status.textContent='';return result;}}catch(error){if(!ui.disposed)ui.status.textContent=errorText(error);}finally{pending=false;ui.panel.removeAttribute('aria-busy');}}
  async function refresh(){const request=++sequence;try{const templates=await port.listTemplates({query:search.value,includeArchived:archived.checked});if(ui.disposed||request!==sequence)return;list.replaceChildren();if(!templates.length)list.append(node('p','','No templates found.'));
    for(const template of templates){const item=button(template.name+' · '+template.mode+' · '+template.placementCount+' blocks'+(template.state==='archived'?' · archived':''),()=>{void run('Loading template…',()=>port.getTemplate(template.id)).then(value=>{if(value)showTemplate(value);});});list.append(item);}
  }catch(error){if(!ui.disposed)ui.status.textContent=errorText(error);}}
  function previewLayout(template:WorkspaceTemplate){
    const diagram=node('div','aw-library__layout');diagram.setAttribute('aria-label','Template layout preview');
    const placements=template.body.placements;
    const minX=Math.min(0,...placements.map(p=>p.presentation.x)),minY=Math.min(0,...placements.map(p=>p.presentation.y));
    const width=Math.max(1,...placements.map(p=>p.presentation.x+p.presentation.width-minX)),height=Math.max(1,...placements.map(p=>p.presentation.y+p.presentation.height-minY));
    for(const placement of placements){const role=template.body.resources.find(r=>r.key===placement.resourceKey)!;const tile=node('span','aw-library__layout-block',role.label);const p=placement.presentation;tile.style.left=((p.x-minX)/width*100)+'%';tile.style.top=((p.y-minY)/height*100)+'%';tile.style.width=(p.width/width*100)+'%';tile.style.height=(p.height/height*100)+'%';tile.style.borderRadius=p.shape==='circle'?'50%':p.shape==='pill'?'40px':'8px';tile.title=role.label+' · '+p.shape;diagram.append(tile);}
    return diagram;
  }
  function showTemplate(template:WorkspaceTemplate){
    detail.replaceChildren(node('h3','',template.name),node('p','',template.description),previewLayout(template),node('p','aw-library__hint','Template geometry is shown above. The workspace engine resolves Fluid and Structured layouts. Vela keeps its separate presence.'));
    const roles=node('ul');for(const role of template.body.resources)roles.append(node('li','',role.label+' — '+role.source.kind+' — '+(role.source.mode==='new'?'create empty new resource':'reuse resource '+role.source.resourceId)));detail.append(roles);
    const form=node('form'),name=node('input');name.value=template.name==='Blank'?'New workspace':template.name;name.maxLength=120;name.required=true;
    const preview=button('Check template',()=>{void inspect();}),apply=node('button','aw-library__button','Create workspace');apply.type='submit';apply.disabled=template.state!=='active';
    const summary=node('p','aw-library__hint');let checked:TemplateApplyInput|null=null;
    const input=():TemplateApplyInput=>({commandId:commandId(),templateId:template.id,expectedVersion:template.version,title:name.value,projectId:options.projectId,...(options.expectedProjectVersion===undefined?{}:{expectedProjectVersion:options.expectedProjectVersion})});
    async function inspect(){const candidate=input();const result=await run('Checking current access and versions…',()=>port.previewTemplate(candidate));if(result){checked=candidate;summary.textContent=result.newResourceCount+' new resources, '+result.referenceCount+' references, '+result.placementCount+' placements in a new '+result.body.organization.mode+' workspace.';}}
    name.oninput=()=>{checked=null;summary.textContent='';};
    form.onsubmit=event=>{event.preventDefault();void(async()=>{if(!checked)await inspect();if(!checked||ui.disposed)return;const result=await run('Creating workspace atomically…',()=>port.applyTemplate(checked!));if(result){ui.status.textContent='Workspace saved.';await options.onApplied(result);}})().catch(error=>{if(!ui.disposed)ui.status.textContent=errorText(error);});};
    form.append(field('Workspace name',name),preview,apply,summary);detail.append(form);
    if(template.source!=='preset'){
      const renameForm=node('form'),rename=node('input');rename.value=template.name;rename.maxLength=120;rename.required=true;const renameButton=node('button','aw-library__button','Rename template');renameButton.type='submit';renameForm.append(field('Template name',rename),renameButton);renameForm.onsubmit=event=>{event.preventDefault();void run('Renaming…',()=>port.renameTemplate({id:template.id,expectedVersion:template.version,name:rename.value})).then(value=>{if(value){showTemplate(value);void refresh();}});};
      const archive=button(template.state==='active'?'Archive template':'Restore template',()=>{void run('Updating template…',()=>port.archiveTemplate({id:template.id,expectedVersion:template.version,archived:template.state==='active'})).then(value=>{if(value){showTemplate(value);void refresh();}});});detail.append(renameForm,archive);
    }
    if(template.provenance)detail.append(node('p','aw-library__hint','Vela plan from '+template.provenance.providerId+(template.provenance.model?' · '+template.provenance.model:'')));
  }
  function showSaveCurrent(){
    const snapshot=options.currentWorkspace?.();if(!snapshot?.activeWorkspaceId){ui.status.textContent='Open a workspace before saving its layout.';return;}
    detail.replaceChildren(node('h3','','Save reusable workspace'),node('p','','Choose how each resource is reused. New resources start empty; note text, conversation history, provider sessions and execution are never copied.'));
    const form=node('form'),name=node('input'),description=node('textarea'),choices:CaptureChoices={};name.required=true;name.maxLength=120;name.value=(snapshot.workspaces.find(w=>w.id===snapshot.activeWorkspaceId)?.title??'Workspace')+' template';description.maxLength=500;
    form.append(field('Template name',name),field('Description',description));
    for(const id of new Set(snapshot.blocks.map(b=>b.resource_id))){const resource=snapshot.resources.find(r=>r.id===id);if(!resource)continue;const select=node('select');select.required=true;
      for(const [value,label] of [['','Choose resource binding'],['reference','Reuse existing resource (same ID)'],['new','Create empty new resource']]){const option=node('option','',label);option.value=value;select.append(option);}select.onchange=()=>{if(select.value)choices[id]=select.value as 'new'|'reference';else delete choices[id];};form.append(field(resource.title+' · '+resource.kind,select));}
    const submit=node('button','aw-library__button','Save template');submit.type='submit';form.append(submit);form.onsubmit=event=>{event.preventDefault();let body;try{body=captureWorkspaceTemplate(snapshot,choices);}catch(error){ui.status.textContent=errorText(error);return;}void run('Saving reusable layout…',()=>port.saveTemplate({name:name.value,description:description.value,tags:[],body})).then(value=>{if(value){showTemplate(value);void refresh();}});};detail.append(form);
  }
  function showVela(){
    detail.replaceChildren(node('h3','','Ask Vela to construct a workspace'),node('p','','Describe the work you want to do. Vela returns a proposal for review; resources are created only when you apply it.'));
    const form=node('form'),prompt=node('textarea');prompt.required=true;prompt.maxLength=5000;const submit=node('button','aw-library__button','Request proposal');submit.type='submit';submit.disabled=capabilities?.velaPlanning.state!=='available';form.append(field('Workspace purpose',prompt),submit);
    if(submit.disabled)form.append(node('p','aw-library__limitation',capabilities?.velaPlanning.reason??'Vela planning is unavailable. Use Blank, a preset or a saved template.'));
    form.onsubmit=event=>{event.preventDefault();void run('Waiting for Vela’s proposal…',()=>port.requestVelaTemplate({requestId:commandId(),prompt:prompt.value,projectId:options.projectId})).then(plan=>{if(plan)showVelaPlan(plan);});};detail.append(form);
  }
  function showVelaPlan(plan:VelaTemplatePlan){
    detail.replaceChildren(node('h3','',plan.name),node('p','',plan.description),node('p','aw-library__hint','Proposal from '+plan.provenance.providerId+'. Review and save before applying.'));
    const roles=node('ul');for(const role of plan.body.resources)roles.append(node('li','',role.label+' · '+role.source.kind+' · '+role.source.mode));detail.append(roles);
    const name=node('input');name.value=plan.name;name.maxLength=120;name.required=true;const save=button('Save proposal as template',()=>{void run('Saving Vela proposal…',()=>port.saveTemplate({...plan,name:name.value,source:'vela'})).then(value=>{if(value){showTemplate(value);void refresh();}});});detail.append(field('Template name',name),save);
  }
  search.oninput=()=>{void refresh();};archived.onchange=()=>{void refresh();};
  void port.capabilities().then(value=>{if(!ui.disposed)capabilities=value;}).catch(error=>{if(!ui.disposed)ui.status.textContent=errorText(error);});
  void refresh();search.focus();
  return {dispose:ui.dispose,refresh};
}
