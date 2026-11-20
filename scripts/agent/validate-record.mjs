/** Dependency-free validator for the exact vocabulary used by foundation v1.
 * Unknown schema keywords fail closed; this is not a general JSON Schema engine. */
import {readFileSync} from 'node:fs';
import {canonical} from './evidence-trust.mjs';
const schema=JSON.parse(readFileSync(new URL('../../agent-system/contracts/v1.schema.json',import.meta.url),'utf8'));
const traceSchema=JSON.parse(readFileSync(new URL('../../agent-system/contracts/trace-v1.schema.json',import.meta.url),'utf8'));
const supported=new Set(['$schema','$defs','$ref','title','description','type','const','enum','oneOf','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','format','minimum','maximum']);
function validate(value,s,path='$',depth=0) {
  if(depth>40) return [path+': depth exceeded'];
  const errors=[];
  for(const key of Object.keys(s)) if(!supported.has(key)) errors.push(path+': unsupported schema keyword '+key);
  if(s.$ref){const match=/^#\/\$defs\/([^/]+)$/.exec(s.$ref);if(!match||!schema.$defs[match[1]])return [...errors,path+': invalid schema ref'];return [...errors,...validate(value,schema.$defs[match[1]],path,depth+1)];}
  if(s.oneOf&&s.oneOf.filter(x=>validate(value,x,path,depth+1).length===0).length!==1) errors.push(path+': oneOf mismatch');
  const types={object:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),array:Array.isArray,string:x=>typeof x==='string',number:x=>typeof x==='number'&&Number.isFinite(x),integer:Number.isInteger,boolean:x=>typeof x==='boolean',null:x=>x===null};
  if(s.type) {
    const alternatives=Array.isArray(s.type)?s.type:[s.type];
    if(!alternatives.length||alternatives.some(type=>typeof type!=='string'||!Object.hasOwn(types,type))) return [...errors,path+': unsupported schema type'];
    if(!alternatives.some(type=>types[type](value))) return [...errors,path+': expected '+alternatives.join(' or ')];
  }
  if(Object.hasOwn(s,'const')&&canonical(value)!==canonical(s.const))errors.push(path+': const mismatch');
  if(s.enum&&!s.enum.some(x=>canonical(x)===canonical(value)))errors.push(path+': enum mismatch');
  if(typeof value==='string') {
    if(s.minLength&&[...value].length<s.minLength)errors.push(path+': too short');
    if(s.maxLength!==undefined&&[...value].length>s.maxLength)errors.push(path+': too long');
    if(s.pattern&&!new RegExp(s.pattern).test(value))errors.push(path+': pattern mismatch');
    if(s.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))))errors.push(path+': invalid date-time');
    if(s.format&&s.format!=='date-time')errors.push(path+': unsupported format');
  }
  if(typeof value==='number'&&s.minimum!==undefined&&value<s.minimum)errors.push(path+': below minimum');
  if(typeof value==='number'&&s.maximum!==undefined&&value>s.maximum)errors.push(path+': above maximum');
  if(Array.isArray(value)) {
    if(s.minItems&&value.length<s.minItems)errors.push(path+': too few items');
    if(s.maxItems!==undefined&&value.length>s.maxItems)errors.push(path+': too many items');
    if(s.uniqueItems&&new Set(value.map(canonical)).size!==value.length)errors.push(path+': duplicate items');
    if(s.items)value.forEach((v,i)=>errors.push(...validate(v,s.items,path+'['+i+']',depth+1)));
  }
  if(value&&typeof value==='object'&&!Array.isArray(value)) {
    for(const k of s.required??[])if(!Object.hasOwn(value,k))errors.push(path+': missing '+k);
    for(const [k,v] of Object.entries(value))if(s.properties?.[k])errors.push(...validate(v,s.properties[k],path+'.'+k,depth+1));else if(s.additionalProperties===false)errors.push(path+': unknown '+k);
  }
  return errors;
}
export const validateRecord=record=>validate(record,schema);
export const validateTraceEvent=event=>validate(event,traceSchema);
