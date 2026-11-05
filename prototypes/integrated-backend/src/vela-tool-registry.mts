import type {VelaToolCatalog,VelaToolDescriptor} from '../../application-contract/vela-tools.ts';
import {capabilityCatalogDigest} from '../../vela-core/src/capability-catalog.mts';
import {ensure} from './contracts.mts';
import type {VelaToolOwner} from './vela-tool-workflows.mts';
/** Adapts source owner descriptors, never model-supplied tools or a second permission registry. */
export const toolDescriptor=(descriptor:Omit<VelaToolDescriptor,'schemaDigest'>):VelaToolDescriptor=>({...structuredClone(descriptor),schemaDigest:capabilityCatalogDigest(descriptor.schema)});
export function derivedToolCatalog(scopeDigest:string,owners:VelaToolOwner[],discovery:VelaToolCatalog['discovery']='complete'):VelaToolCatalog {
  ensure(owners.length>0&&owners.length<=128&&new Set(owners.map(o=>o.descriptor.id)).size===owners.length,'invalid_vela_tool_catalog');
  const descriptors=owners.map(o=>structuredClone(o.descriptor)).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const base={contract:'aerynth.vela.tools@1' as const,scopeDigest,discovery,descriptors};return {...base,digest:capabilityCatalogDigest(base)};
}
export const exactToolArguments=(value:unknown,keys:string[]):Record<string,any>=>{ensure(!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'invalid_vela_tool_arguments');return value as Record<string,any>;};
