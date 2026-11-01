import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SyntheticService } from './service.mts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const data=process.env.CONSTELLATION_DATA??resolve(dirname(fileURLToPath(import.meta.url)),'../.local-data');mkdirSync(data,{recursive:true});
const service=new SyntheticService(resolve(data,'synthetic.sqlite'));service.seed();
const port=Number(process.env.CONSTELLATION_PORT??4319),origin=`http://127.0.0.1:${port}`;
const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
  if(req.url==='/api'){
    if(req.method!=='POST'||req.headers['x-constellation-demo']!=='1'||req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
    try{
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_100_000)throw Error('Request too large');}
      const {type,payload:p}=JSON.parse(raw);let result:unknown=null;
      if(type==='snapshot')result=service.snapshot();else if(type==='navigate'){
        if(!p||!(p.kind==='workspace'&&typeof p.workspaceId==='string'||p.kind==='constellation'&&(p.projectId===null||typeof p.projectId==='string')))throw Error('Invalid destination');result=service.navigate(p);
      }else if(type==='load')result=service.load();else if(type==='save')service.save(p);else if(type==='content'){
        if(!p||typeof p.id!=='string'||typeof p.content!=='string'||!Number.isInteger(p.version))throw Error('Invalid content');result=service.content(p.id,p.content,p.version);
      }else if(type==='move'){
        const b=service.snapshot().blocks.find(b=>b.id===p?.blockId);if(!b)throw Error('Block unavailable');const w=service.kernel.openWorkspace(b.workspace_id);service.kernel.saveLayout(b.workspace_id,'freeform',w.layout.viewport,[{blockId:b.id,expectedVersion:b.version,placement:{x:b.x+20,y:b.y,width:b.width,height:b.height,z:b.z}}],w.layout.version);result=service.snapshot();
      }else throw Error('Unknown fixture command');
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
    }catch{res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Fixture command failed. Refresh and retry.'}));}return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  try{const name=decodeURIComponent(new URL(req.url??'/',origin).pathname);const path=resolve(root,name==='/'?'index.html':`.${name}`);if(!path.startsWith(root+sep))throw Error('Invalid path');res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(path)]??'application/octet-stream'}).end(readFileSync(path));}catch{res.writeHead(404).end('Build the synthetic fixture first.');}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`Synthetic Constellation fixture: ${origin}\n`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{service.close();process.exit(0);}));
