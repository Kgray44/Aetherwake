import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const DOCUMENT_ASSETS=Object.freeze({preload:'vela-document-text-preload.cjs',worker:'vela-document-text-worker.js',pdf:'vela-document-pdf.worker.js',receipt:'vela-document-text.sources.json'});
export async function buildDocumentExtraction(root){
  const repo=path.resolve(root,'../../..'),library=path.join(repo,'prototypes/block-library'),outputs={},inputs={};
  const sourceFiles=['prototypes/visual-experience/cinematic-v3/src/document-text-preload.ts','prototypes/visual-experience/cinematic-v3/src/document-text-worker.ts','prototypes/block-library/media-docx-parser.ts','prototypes/block-library/media-pdf.ts','prototypes/block-library/media-policy.ts','prototypes/application-contract/media.ts'];
  const preload=await build({absWorkingDir:repo,entryPoints:[path.join(root,'src/document-text-preload.ts')],bundle:true,write:false,format:'cjs',platform:'browser',target:'chrome144',external:['electron'],metafile:true,legalComments:'eof'});
  const pdfWrapper=path.join(library,'media-pdf.ts');
  const worker=await build({absWorkingDir:repo,entryPoints:[path.join(root,'src/document-text-worker.ts')],bundle:true,write:false,format:'esm',platform:'browser',target:'chrome144',metafile:true,legalComments:'eof',external:['node:*','@napi-rs/canvas'],plugins:[{name:'fixed-local-document-pdf-worker',setup(api){api.onLoad({filter:/media-pdf\.ts$/},async({path:input})=>{if(path.resolve(input)!==pdfWrapper)throw Error('document_pdf_source_invalid');const original=await readFile(input,'utf8'),from="new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href";if(original.split(from).length!==2)throw Error('document_pdf_worker_source_changed');return {loader:'ts',contents:original.replace(from,"new URL('./vela-document-pdf.worker.js', import.meta.url).href")};});}}]});
  if(preload.outputFiles.length!==1||worker.outputFiles.length!==1||preload.outputFiles[0].contents.length>65536||worker.outputFiles[0].contents.length>8*1024*1024)throw Error('document_build_capacity');
  outputs[DOCUMENT_ASSETS.preload]=preload.outputFiles[0].contents;outputs[DOCUMENT_ASSETS.worker]=worker.outputFiles[0].contents;
  const vendorInputs={};for(const name of Object.keys({...preload.metafile.inputs,...worker.metafile.inputs}).sort()){
    const file=path.resolve(repo,name),relative=path.relative(repo,file).split(path.sep).join('/');if(sourceFiles.includes(relative))inputs[relative]=hash(await readFile(file));
    else if(relative.startsWith('prototypes/block-library/node_modules/')&&!relative.split('/').includes('..')&&/\.(?:js|mjs|json)$/u.test(relative))vendorInputs[relative]=hash(await readFile(file));else throw Error('document_build_unreviewed_input:'+relative);
  }
  if(Object.keys(inputs).sort().join('|')!==sourceFiles.sort().join('|')||Object.keys(vendorInputs).length>512)throw Error('document_build_source_missing');
  const pdfSource='prototypes/block-library/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',pdf=await readFile(path.join(repo,pdfSource));if(pdf.length>8*1024*1024)throw Error('document_pdf_worker_capacity');outputs[DOCUMENT_ASSETS.pdf]=pdf;vendorInputs[pdfSource]=hash(pdf);
  const lock='prototypes/block-library/package-lock.json',dependencyLock=hash(await readFile(path.join(repo,lock))),licenses={};
  for(const dependency of ['mammoth','fflate','pdfjs-dist']){const base=path.join(library,'node_modules',dependency),pkg=JSON.parse(await readFile(path.join(base,'package.json'),'utf8'));let license;for(const name of ['LICENSE','LICENSE.md','LICENSE.txt'])try{license=await readFile(path.join(base,name),'utf8');break;}catch{}if(!license||license.length>65536)throw Error('document_dependency_license_missing');licenses[dependency]={version:pkg.version,license:pkg.license,text:license};}
  const metadata={contract:'aerynth.private-document-text-build@1',assets:Object.fromEntries(Object.entries(outputs).map(([name,bytes])=>[name,hash(bytes)])),inputs,vendorInputs,dependencyLock:{source:lock,sha256:dependencyLock},licenses};
  const receipt=JSON.stringify(metadata)+'\n';if(Buffer.byteLength(receipt)>512*1024)throw Error('document_receipt_capacity');outputs[DOCUMENT_ASSETS.receipt]=Buffer.from(receipt);return {outputs,metadata};
}
export function documentExtraction(){let root;return {name:'aerynth-private-document-extraction',apply:'build',configResolved(config){root=config.root;},async generateBundle(){const {outputs}=await buildDocumentExtraction(root);for(const [fileName,source] of Object.entries(outputs))this.emitFile({type:'asset',fileName,source});}};}
