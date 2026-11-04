const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const inputs=['prototypes/integrated-backend/src/native-wake-controller.mts','prototypes/integrated-backend/src/wake-audio-buffer.mts','prototypes/integrated-backend/src/wake-capture-host.mts'];
function loadWakeController(root){
 const base=path.resolve(root,'../../..'),dist=path.join(root,'dist'),asset='vela-wake-host.cjs';
 const read=file=>{if(fs.lstatSync(file).isSymbolicLink()||path.resolve(file).toLowerCase()!==fs.realpathSync(file).toLowerCase())throw Error('wake_host_source_changed');return fs.readFileSync(file);};
 const metadata=read(path.join(dist,'vela-wake-host.sources.json'));if(metadata.length>16384)throw Error('wake_host_source_changed');
 const value=JSON.parse(metadata),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 if(value?.contract!=='aerynth.private-wake-host-build@1'||value.asset!==asset||Object.keys(value).sort().join('|')!=='asset|contract|inputs|sha256'||!value.inputs||Object.keys(value.inputs).sort().join('|')!==inputs.join('|'))throw Error('wake_host_source_changed');
 const bundle=read(path.join(dist,asset));if(bundle.length>262144||value.sha256!==hash(bundle))throw Error('wake_host_source_changed');
 for(const relative of inputs)if(value.inputs[relative]!==hash(read(path.join(base,relative))))throw Error('wake_host_source_changed');
 return require(path.join(dist,asset)).createNativeWakeController;
}
module.exports={loadWakeController};
