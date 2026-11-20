import React from 'react';
import { taskActivityHref } from './github-activity.mjs';

const lines = value => String(value??'').split('\n').map(item=>item.trim()).filter(Boolean);
const refText = ({kind,uri,revision}, includeKind) => [includeKind?kind:'',uri,revision].filter(Boolean).join(' | ');

export function readTaskScope(form) {
  const requirements=lines(form.get('requirements')).map(line=>{
    const [kind,uri,revision,...extra]=line.split('|').map(part=>part.trim());
    return {kind:extra.length?'':kind,uri,...(revision?{revision}:{})};
  });
  const inputs=lines(form.get('input_artifacts')).map(line=>{
    const [uri,revision,...extra]=line.split('|').map(part=>part.trim());
    return {kind:'artifact',uri:extra.length?'':uri,...(revision?{revision}:{})};
  });
  return {requirements:[...requirements,...inputs],deliverables:lines(form.get('deliverables'))};
}

export function TaskScopeFields({task,checks}) {
  const requirements=task?.requirements??[];
  return <fieldset className="task-scope-fields">
    <legend>Inputs and planned deliverables</legend>
    <label>Requirements
      <textarea name="requirements" aria-invalid={checks?.inputs===false||undefined}
        defaultValue={requirements.filter(ref=>ref.kind!=='artifact').map(ref=>refText(ref,true)).join('\n')}
        placeholder="document | https://… | optional revision"/>
      <small>One per line using kind | URI | optional revision.</small>
    </label>
    <label>Input artifacts
      <textarea name="input_artifacts" aria-invalid={checks?.inputs===false||undefined}
        defaultValue={requirements.filter(ref=>ref.kind==='artifact').map(ref=>refText(ref,false)).join('\n')}
        placeholder="https://… | optional revision"/>
      <small>One artifact reference per line. A reference does not transfer access.</small>
    </label>
    <label>Planned deliverables
      <textarea name="deliverables" aria-invalid={checks?.deliverables===false||undefined}
        defaultValue={(task?.deliverables??[]).join('\n')} placeholder="An implementation PR with verification results"/>
      <small>One outcome per line. Up to 30, with 500 characters each.</small>
    </label>
  </fieldset>;
}

function safeHttps(uri) {
  try {
    const target=new URL(uri);
    return target.protocol==='https:'&&!target.username&&!target.password?target.href:null;
  } catch { return null; }
}

export function TaskScopeSummary({task}) {
  const requirements=task.requirements??[];
  const deliverables=task.deliverables??[];
  if (!requirements.length&&!deliverables.length) return null;
  return <div className="task-scope-summary">
    {requirements.length>0&&<section><h3>Requirements and inputs</h3><ul>{requirements.map((ref,index)=>{
      const internal=taskActivityHref(ref.uri);
      const url=internal??safeHttps(ref.uri);
      return <li key={index}><small>{ref.kind.replaceAll('_',' ')}</small>
        {url?<a href={url} target={internal?undefined:'_blank'} rel={internal?undefined:'noreferrer'}>{ref.uri}</a>:<span>{ref.uri}</span>}
        {ref.revision&&<code>{ref.revision}</code>}</li>;
    })}</ul></section>}
    {deliverables.length>0&&<section><h3>Planned deliverables</h3><ul>{deliverables.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}
  </div>;
}