/** Synthetic fixture adapter only. Production consumes DesktopService projections. */
import { WorkspaceKernel } from '../../workspace-kernel/kernel.mts';
import type { Destination, Snapshot, ViewState } from '../types.ts';

export class SyntheticService {
  kernel: WorkspaceKernel;
  constructor(path:string) {
    this.kernel=WorkspaceKernel.open(path);
    this.kernel.withTransaction(db=>db.exec("CREATE TABLE IF NOT EXISTS constellation_demo_state(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS constellation_demo_shapes(block_id TEXT PRIMARY KEY REFERENCES blocks(id),shape TEXT NOT NULL);"));
  }
  seed() {
    const count=this.kernel.withTransaction(db=>(db.prepare('SELECT count(*) AS n FROM projects').get() as any).n);
    if(count)return;
    this.kernel.withTransaction(db=>{
      const names=[['A World for Two','Development','Planning'],['Voyagewright','Engineering','Review'],['Airbrush Disc System','Calibration','Hardware']];
      for(const [pi,nameset] of names.entries()){
        const [title,...workspaces]=nameset,p=this.kernel.createProject(title);
        let previous:string|null=null;
        for(const [wi,name] of workspaces.entries()){
          const w=this.kernel.createWorkspace(name,p.id);
          for(let ri=0;ri<3;ri++){
            const r=this.kernel.createNote(`${name} ${['Notebook','Checklist','Decisions'][ri]}`,`Synthetic ${title} / ${name}.\nEditable fixture ${ri+1}. No private project content.`,p.id);
            const b=this.kernel.attachBlock(w.id,r.id,{x:50+ri*330+wi*20,y:160+(ri%2)*155+pi*12,width:300-ri*20,height:215+ri*10,z:ri});
            db.prepare('INSERT INTO constellation_demo_shapes VALUES(?,?)').run(b.id,['rounded','rectangle','circle'][(ri+wi)%3]);
            if(previous)this.kernel.relate(previous,r.id,'references','user');previous=r.id;
          }
        }
      }
    });
    const w=this.snapshot().workspaces.find(w=>w.title==='Development')!;
    this.navigate({kind:'workspace',workspaceId:w.id});
  }
  snapshot(): Snapshot & { resources: any[];blocks:any[];navigation:Destination } {
    return this.kernel.withTransaction(db=>{
      const projects=db.prepare("SELECT id,title FROM projects WHERE state='active'").all() as any[];
      const workspaces=db.prepare("SELECT id,project_id,title FROM workspaces WHERE state='active'").all() as any[];
      const resources=db.prepare("SELECT r.id,r.title,r.kind,r.version,n.content FROM resources r LEFT JOIN notes n ON n.resource_id=r.id WHERE r.state='active'").all() as any[];
      const blocks=db.prepare('SELECT b.*,s.shape FROM blocks b LEFT JOIN constellation_demo_shapes s ON s.block_id=b.id').all() as any[];
      const relationships=db.prepare('SELECT * FROM relationships').all() as any[];
      const saved=db.prepare("SELECT value FROM constellation_demo_state WHERE key='navigation'").get() as any;
      const navigation:Destination=saved?JSON.parse(saved.value):{kind:'constellation',projectId:null};
      return {projects,workspaces,resources,blocks,relationships,navigation,activeWorkspaceId:navigation.kind==='workspace'?navigation.workspaceId:null};
    });
  }
  navigate(target:Destination) {
    const s=this.snapshot();
    if(target.kind==='workspace'&&!s.workspaces.some(w=>w.id===target.workspaceId)||target.kind==='constellation'&&target.projectId!==null&&!s.projects.some(p=>p.id===target.projectId))throw new Error('Destination unavailable');
    this.kernel.withTransaction(db=>db.prepare("INSERT INTO constellation_demo_state VALUES('navigation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(target)));
    return this.snapshot();
  }
  load():unknown {return this.kernel.withTransaction(db=>{const r=db.prepare("SELECT value FROM constellation_demo_state WHERE key='view'").get() as any;return r?JSON.parse(r.value):null;});}
  save(state:ViewState) {
    const value=JSON.stringify(state);
    if(state.schema!=='aerynth.constellation@1'||value.length>2_000_000)throw new Error('Invalid view state');
    this.kernel.withTransaction(db=>db.prepare("INSERT INTO constellation_demo_state VALUES('view',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value));
  }
  content(id:string,value:string,version:number) {if(value.length>100_000)throw new Error('Note too large');this.kernel.updateNote(id,value,version);return this.snapshot();}
  close(){this.kernel.close();}
}
