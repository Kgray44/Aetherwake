import type {TurnHttpDiagnostic} from '../../openai-provider/contracts.mts';
import {knownRemoteCode} from '../../openai-provider/common.mts';

/** Native receipt metadata only. Unknown strings are never diagnostics authority. */
const localCodes=new Set([
  'api_process_interrupted','provider_failed','provider_incomplete','provider_timeout','provider_transport_unavailable','cancellation_unconfirmed','operation_aborted',
  'invalid_stream_response','invalid_stream_json','invalid_stream_event','invalid_created_response','invalid_text_delta','stream_event_type_mismatch','stream_terminal_unobserved',
  'response_identity_mismatch','response_terminal_mismatch','event_capacity_exceeded','stream_capacity_exceeded','output_capacity_exceeded','response_capacity_exceeded','response_body_unavailable','invalid_json_response',
  'unsupported_provider_output','api_terminal_items_mismatch','api_response_identity_unobserved','invalid_api_response_item','api_json_capacity_exceeded','invalid_api_json',
  'api_response_item_changed_identity','api_response_item_changed_function_call','api_response_item_changed_message_content','api_response_item_changed_message_status','api_response_item_changed_reasoning_summary','api_response_item_changed_reasoning_encrypted',
  'unreviewed_api_function','invalid_api_function_arguments','invalid_api_function_stream','api_function_stream_mismatch','api_function_capacity_exceeded','duplicate_api_tool_call',
  'api_tool_call_binding_mismatch','api_continuation_changed','api_tool_schema_changed','credential_boundary_mismatch','credential_expired','invalid_native_header','provider_identity_mismatch','model_catalog_stale_or_unauthorized','max_output_tokens',
]);
const own=(value:unknown,key:string):unknown=>value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
export interface ApiRunDiagnostics {errorCode?:string;httpDiagnostic?:Readonly<TurnHttpDiagnostic>}
export function apiRunDiagnostics(value:unknown):ApiRunDiagnostics{
 const raw=own(value,'errorCode'),errorCode=typeof raw==='string'?(localCodes.has(raw)||knownRemoteCode(raw)!=='provider_failed'?raw:'provider_failed'):undefined;
 const diagnostic=own(value,'httpDiagnostic');let httpDiagnostic:Readonly<TurnHttpDiagnostic>|undefined;
 if(own(diagnostic,'contract')==='aerynth.turn-http-diagnostic@1'){
  const status=own(diagnostic,'httpStatus'),contentType=own(diagnostic,'contentType'),hasBody=own(diagnostic,'hasBody'),request=own(diagnostic,'serverRequestId'),shape=own(diagnostic,'bodyShape'),remote=own(diagnostic,'remoteCode');
  if((status===null||Number.isInteger(status)&&Number(status)>=100&&Number(status)<=599)&&typeof contentType==='string'&&['event-stream','json','text','html','other','missing'].includes(contentType)&&typeof hasBody==='boolean'&&typeof shape==='string'&&['error','detail','other','invalid-json','unavailable'].includes(shape)){
   httpDiagnostic=Object.freeze({contract:'aerynth.turn-http-diagnostic@1',httpStatus:status as number|null,contentType:contentType as TurnHttpDiagnostic['contentType'],hasBody,serverRequestId:typeof request==='string'&&/^req_[A-Za-z0-9_-]{1,128}$/u.test(request)?request:null,bodyShape:shape as TurnHttpDiagnostic['bodyShape'],remoteCode:typeof remote==='string'&&knownRemoteCode(remote)!=='provider_failed'?remote:null});
  }
 }
 return {...(errorCode?{errorCode}:{}),...(httpDiagnostic?{httpDiagnostic}:{})};
}
