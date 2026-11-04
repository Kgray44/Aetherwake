import type {DatabaseSync} from 'node:sqlite';
export type WeatherPermission={purpose:'approximate-location:nws-weather';decision:'unknown'|'allow'|'deny';version:number;updatedAt:string|null;windowsSettingsUri:'ms-settings:privacy-location'};
export class WeatherPermissionStore {
 private db:DatabaseSync;private cancelled=new AbortController();
 constructor(db:DatabaseSync){this.db=db;db.exec("CREATE TABLE IF NOT EXISTS vela_weather_permission(id INTEGER PRIMARY KEY CHECK(id=1),decision TEXT NOT NULL CHECK(decision IN ('unknown','allow','deny')),version INTEGER NOT NULL,updated_at TEXT); INSERT OR IGNORE INTO vela_weather_permission VALUES(1,'unknown',1,NULL)");}
 state():WeatherPermission{const r=this.db.prepare('SELECT decision,version,updated_at FROM vela_weather_permission WHERE id=1').get()!;return {purpose:'approximate-location:nws-weather',decision:r.decision as WeatherPermission['decision'],version:Number(r.version),updatedAt:r.updated_at as string|null,windowsSettingsUri:'ms-settings:privacy-location'};}
 set(expectedVersion:number,decision:'allow'|'deny'):WeatherPermission{
  if(!Number.isSafeInteger(expectedVersion)||!['allow','deny'].includes(decision))throw Object.assign(Error('invalid_weather_permission'),{code:'invalid_weather_permission'});
  const result=this.db.prepare('UPDATE vela_weather_permission SET decision=?,version=version+1,updated_at=? WHERE id=1 AND version=?').run(decision,new Date().toISOString(),expectedVersion);
  if(result.changes!==1)throw Object.assign(Error('stale_weather_permission'),{code:'stale_weather_permission'});this.cancelled.abort();this.cancelled=new AbortController();return this.state();
 }
 grant(){const state=this.state();if(state.decision!=='allow')throw Error('weather_permission_required');return {version:state.version,signal:this.cancelled.signal,assert:()=>{const current=this.state();if(current.decision!=='allow'||current.version!==state.version)throw Error('weather_permission_revoked');}};}
 close(){this.cancelled.abort();}
}
