import type { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import type {
  CanonicalTemplateHost, VelaTemplatePlanner, WorkspaceTemplate, TemplateSummary, SaveTemplateInput,
  TemplateApplyInput, AppliedTemplate, TemplatePreview, CreateBlockInput, CreatedBlock, VelaTemplateRequest, VelaTemplatePlan,
} from './contracts.ts';
import { TEMPLATE_LIMITS, check, text, version, identifier, validateDraft, predefinedTemplates } from './model.ts';
import { assertBlockAvailable, validateCreateBlock, BUILTIN_BLOCKS } from './registry.ts';

/** Extension metadata only; the injected host owns all resources, placements, events and execution. */
export class TemplateService {
  private db: DatabaseSync;
  private host: CanonicalTemplateHost<DatabaseSync>;
  private planner?: VelaTemplatePlanner;
  constructor(db: DatabaseSync, host: CanonicalTemplateHost<DatabaseSync>, planner?: VelaTemplatePlanner) {
    check(host.db === db, 'canonical_connection_required');
    this.db = db; this.host = host; this.planner = planner;
    host.atomic(() => {
      db.exec('CREATE TABLE IF NOT EXISTS block_library_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS workspace_templates(id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version>0),state TEXT NOT NULL CHECK(state IN (\'active\',\'archived\')),source TEXT NOT NULL,name TEXT NOT NULL,json TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS block_library_receipts(command_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,json TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS block_library_events(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL,type TEXT NOT NULL,occurred_at TEXT NOT NULL);');
      const schema = db.prepare('SELECT version FROM block_library_schema WHERE id=1').get();
      if (!schema) db.prepare('INSERT INTO block_library_schema VALUES(1,1)').run();
      else check(schema.version === 1, 'unsupported_library_schema');
      for (const preset of predefinedTemplates()) {
        if (db.prepare('SELECT 1 FROM workspace_templates WHERE id=?').get(preset.id)) continue;
        const now = new Date().toISOString();
        this.write({ ...preset, version:1,state:'active',source:'preset',createdAt:now,updatedAt:now });
      }
    });
  }
  capabilities() { return structuredClone(this.host.capabilities()); }
  private event(subjectId: string, type: string) {
    check(Number(this.db.prepare('SELECT count(*) AS n FROM block_library_events').get()!.n) < 8192, 'library_event_capacity_reached');
    this.db.prepare('INSERT INTO block_library_events VALUES(?,?,?,?)').run(randomUUID(), subjectId, type, new Date().toISOString());
  }
  private write(template: WorkspaceTemplate) {
    this.db.prepare('INSERT INTO workspace_templates VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,state=excluded.state,source=excluded.source,name=excluded.name,json=excluded.json')
      .run(template.id,template.version,template.state,template.source,template.name,JSON.stringify(template));
  }
  getTemplate(id: string): WorkspaceTemplate {
    const row = this.db.prepare('SELECT json FROM workspace_templates WHERE id=?').get(identifier(id));
    check(row, 'template_not_found');
    const template = JSON.parse(String(row.json)) as WorkspaceTemplate;
    validateDraft(template); version(template.version);
    check(['active','archived'].includes(template.state) && ['saved','preset','vela'].includes(template.source), 'corrupt_template_metadata');
    return template;
  }
  listTemplates(input: {query?: string; includeArchived?: boolean} = {}): TemplateSummary[] {
    check(typeof (input.query ?? '') === 'string' && (input.query?.length ?? 0) <= 500, 'invalid_template_query');
    const terms = (input.query ?? '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).slice(0,16);
    return this.db.prepare('SELECT id FROM workspace_templates ORDER BY CASE source WHEN \'preset\' THEN 0 ELSE 1 END,name,id').all()
      .map(row => this.getTemplate(String(row.id))).filter(t => (input.includeArchived || t.state === 'active') && terms.every(term => (t.name+' '+t.description+' '+t.tags.join(' ')).toLocaleLowerCase().includes(term)))
      .map(({body,...metadata}) => ({...metadata,resourceCount:body.resources.length,placementCount:body.placements.length,mode:body.organization.mode}));
  }
  saveTemplate(input: SaveTemplateInput): WorkspaceTemplate {
    check(input && typeof input === 'object' && Object.keys(input).every(k => ['name','description','tags','body','id','expectedVersion','source','provenance'].includes(k)), 'invalid_save_template');
    const draft = validateDraft(input);
    check(input.source === undefined || input.source === 'saved' || input.source === 'vela', 'invalid_template_source');
    let provenance: WorkspaceTemplate['provenance'];
    if (input.provenance) {
      check(input.source === 'vela' && Object.keys(input.provenance).every(k => ['requestId','providerId','model'].includes(k)), 'invalid_template_provenance');
      provenance = {requestId:identifier(input.provenance.requestId),providerId:text(input.provenance.providerId,200),...(input.provenance.model ? {model:text(input.provenance.model,200)} : {})};
    }
    check(input.source !== 'vela' || provenance, 'vela_provenance_required');
    return this.host.atomic(() => {
      const previous = input.id ? this.getTemplate(input.id) : null;
      if (previous) { check(previous.source !== 'preset', 'preset_read_only'); check(previous.version === version(input.expectedVersion), 'template_version_conflict'); check(previous.state === 'active', 'template_archived'); }
      else { check(input.expectedVersion === undefined, 'invalid_version'); check(Number(this.db.prepare('SELECT count(*) AS n FROM workspace_templates').get()!.n) < TEMPLATE_LIMITS.templates, 'template_capacity_reached'); }
      const now = new Date().toISOString();
      const template: WorkspaceTemplate = { ...draft,id:previous?.id ?? randomUUID(),version:(previous?.version ?? 0)+1,state:'active',source:input.source ?? previous?.source ?? 'saved',createdAt:previous?.createdAt ?? now,updatedAt:now,...(provenance ? {provenance} : previous?.provenance ? {provenance:previous.provenance} : {}) };
      this.write(template); this.event(template.id,previous ? 'template.updated' : 'template.saved'); return template;
    });
  }
  renameTemplate(input: {id: string; expectedVersion: number; name: string}): WorkspaceTemplate {
    const name = text(input.name);
    return this.changeMetadata(input.id,input.expectedVersion,t => ({...t,name}),'template.renamed');
  }
  archiveTemplate(input: {id: string; expectedVersion: number; archived: boolean}): WorkspaceTemplate {
    check(typeof input.archived === 'boolean', 'invalid_archive_state');
    return this.changeMetadata(input.id,input.expectedVersion,t => ({...t,state:input.archived ? 'archived' : 'active'}),'template.archive_changed');
  }
  private changeMetadata(id: string, expectedVersion: number, fn: (t: WorkspaceTemplate) => WorkspaceTemplate, event: string) {
    return this.host.atomic(() => {
      const previous = this.getTemplate(id); check(previous.source !== 'preset', 'preset_read_only'); check(previous.version === version(expectedVersion), 'template_version_conflict');
      const result = {...fn(previous),version:previous.version+1,updatedAt:new Date().toISOString()}; this.write(result); this.event(id,event); return result;
    });
  }
  private validateApply(input: TemplateApplyInput): TemplatePreview {
    check(input && typeof input === 'object' && Object.keys(input).every(k => ['commandId','templateId','expectedVersion','title','projectId','expectedProjectVersion'].includes(k)), 'invalid_template_apply');
    this.commandId(input.commandId); const title = text(input.title), template = this.getTemplate(input.templateId);
    check(template.state === 'active', 'template_archived'); check(template.version === version(input.expectedVersion), 'template_version_conflict');
    if (input.projectId !== null) {
      const project = this.host.readProject(identifier(input.projectId));
      check(project && project.authorized && project.state === 'active', 'project_unavailable');
      check(project.version === version(input.expectedProjectVersion), 'project_version_conflict');
    } else check(input.expectedProjectVersion === undefined, 'unexpected_project_version');
    const capabilities = this.host.capabilities();
    for (const role of template.body.resources) {
      if (role.source.mode === 'new') assertBlockAvailable(role.source.kind,capabilities,role.source.provider);
      else {
        const resource = this.host.readResource(role.source.resourceId);
        check(resource && resource.authorized && resource.state === 'active', 'reference_unavailable');
        check(resource.kind === role.source.kind, 'reference_kind_changed');
        check(resource.projectId === null || resource.projectId === input.projectId, 'cross_project_reference');
        check(resource.version === role.source.expectedVersion, 'reference_version_conflict');
        assertBlockAvailable(resource.kind,capabilities);
      }
    }
    return {templateId:template.id,version:template.version,title,projectId:input.projectId,newResourceCount:template.body.resources.filter(r=>r.source.mode==='new').length,referenceCount:template.body.resources.filter(r=>r.source.mode==='reference').length,placementCount:template.body.placements.length,
      resources:template.body.resources.map(r=>({key:r.key,label:r.label,kind:r.source.kind,mode:r.source.mode,...(r.source.mode==='reference'?{resourceId:r.source.resourceId}:{})})),body:template.body};
  }
  /** No writes and no provider call. Apply repeats all checks inside the canonical transaction. */
  previewTemplate(input: TemplateApplyInput): TemplatePreview { return this.validateApply(input); }
  private commandId(id: string) { check(typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,198}$/.test(id), 'invalid_command_id'); }
  private once<T>(id: string, input: unknown, work: () => T): T {
    this.commandId(id); const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const receipt = this.db.prepare('SELECT fingerprint,json FROM block_library_receipts WHERE command_id=?').get(id);
    if (receipt) { check(receipt.fingerprint === fingerprint, 'idempotency_conflict'); return JSON.parse(String(receipt.json)); }
    check(Number(this.db.prepare('SELECT count(*) AS n FROM block_library_receipts').get()!.n) < TEMPLATE_LIMITS.receipts, 'receipt_capacity_reached');
    const result = work();
    check(!(result instanceof Promise), 'synchronous_host_required');
    this.db.prepare('INSERT INTO block_library_receipts VALUES(?,?,?)').run(id,fingerprint,JSON.stringify(result)); return result;
  }
  createBlock(input: CreateBlockInput): CreatedBlock {
    return this.host.atomic(() => this.once(input.commandId,{operation:'createBlock',input},() => {
      const command = validateCreateBlock(input,this.host.capabilities()), workspace = this.host.readWorkspace(command.workspaceId);
      check(workspace && workspace.authorized && workspace.state === 'active', 'workspace_unavailable');
      check(workspace.layoutVersion === command.expectedLayoutVersion, 'layout_version_conflict');
      if (workspace.projectId !== null) { const p = this.host.readProject(workspace.projectId); check(p && p.authorized && p.state === 'active', 'project_unavailable'); }
      const resource = this.host.createResource({kind:command.kind,title:command.title,provider:command.provider,projectId:workspace.projectId});
      const placement = this.host.placeResource({workspaceId:workspace.id,resourceId:resource.id,presentation:command.presentation});
      this.event(resource.id,'block.created');
      return {resourceId:resource.id,placementId:placement.id,workspaceId:workspace.id};
    }));
  }
  applyTemplate(input: TemplateApplyInput): AppliedTemplate {
    return this.host.atomic(() => this.once(input.commandId,{operation:'applyTemplate',input},() => {
      const preview = this.validateApply(input), body = preview.body;
      const workspace = this.host.createWorkspace({title:preview.title,projectId:preview.projectId,organization:body.organization,viewport:body.viewport});
      const resourceIds: Record<string,string> = {}, placementIds: Record<string,string> = {};
      for (const role of body.resources) resourceIds[role.key] = role.source.mode === 'reference' ? role.source.resourceId : this.host.createResource({kind:role.source.kind,title:role.source.title,provider:role.source.provider,projectId:preview.projectId}).id;
      for (const role of body.placements) placementIds[role.key] = this.host.placeResource({workspaceId:workspace.id,resourceId:resourceIds[role.resourceKey],presentation:role.presentation}).id;
      for (const group of body.groups) this.host.setTaskGroupMembers({groupId:resourceIds[group.groupKey],taskIds:group.taskKeys.map(k=>resourceIds[k])});
      this.host.setOrganization({workspaceId:workspace.id,organization:{mode:body.organization.mode,gap:body.organization.gap,structured:{...body.organization.structured,order:body.placements.map(p=>placementIds[p.key]),spans:Object.fromEntries(body.placements.filter(p=>p.span).map(p=>[placementIds[p.key],p.span!]))}},viewport:body.viewport});
      this.event(workspace.id,'template.applied');
      return {workspaceId:workspace.id,resourceIds,placementIds,templateId:preview.templateId,templateVersion:preview.version};
    }));
  }
  async requestVelaTemplate(input: VelaTemplateRequest): Promise<VelaTemplatePlan> {
    check(input && typeof input === 'object' && Object.keys(input).every(k => ['requestId','prompt','projectId'].includes(k)), 'invalid_vela_request');
    this.commandId(input.requestId); const prompt = text(input.prompt,5000);
    const capabilities = this.host.capabilities();
    check(capabilities.velaPlanning.state === 'available' && this.planner, 'vela_planning_unavailable');
    if (input.projectId !== null) { const p = this.host.readProject(identifier(input.projectId)); check(p && p.authorized && p.state === 'active', 'project_unavailable'); }
    const result = await this.planner.plan({...input,prompt,supportedKinds:BUILTIN_BLOCKS.filter(b=>capabilities.kinds[b.kind]?.state==='available').map(b=>b.kind)});
    check(result?.provenance?.requestId === input.requestId, 'vela_request_mismatch');
    const draft = validateDraft(result);
    const provenance = {requestId:input.requestId,providerId:text(result.provenance.providerId,200),...(result.provenance.model?{model:text(result.provenance.model,200)}:{})};
    // A real plan is still a proposal. It never creates a workspace until the user applies it.
    return {...draft,provenance};
  }
}
