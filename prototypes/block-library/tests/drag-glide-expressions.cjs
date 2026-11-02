const { expressions: common,preflight:commonPreflight }=require('./workspace-approach-expressions.cjs');
const { compileExpression }=require('./library-native-expressions.cjs');
const {createHash}=require('node:crypto'),q=JSON.stringify;
function observe(id,after=-1,atRest=false){
  const s=window.__aerynth.snapshot(),frame=s.dragGlideFrame,problems=[];
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const card=frame?.cards?.find(c=>c.id===id),bounds=card?.gpuProjection?.bounds,dom=card?.domRect;
  if(document.hidden||!document.hasFocus()||!s.active)problems.push('inactive');
  if(document.fonts&&document.fonts.status!=='loaded')problems.push('fonts-loading');
  if(!frame||!Number.isSafeInteger(frame.drawSequence)||frame.drawSequence<=after||!finite(frame.rendererNowMs))problems.push('no-new-atomic-draw');
  if(!card||!bounds||!dom||!card.pose||!card.target)problems.push('missing-moving-card-projection');
  const match=!!bounds&&!!dom&&['x','y','width','height'].every(k=>finite(bounds[k])&&finite(dom[k])&&Math.abs(bounds[k]-dom[k])<=0.75);
  if(!match)problems.push('scene-projection-dom-mismatch');
  if(!bounds||bounds.width<=0||bounds.height<=0||!finite(card?.pose?.opacity)||card.pose.opacity<0.995)problems.push('moving-card-not-painted');
  if(!Array.isArray(card?.gpuProjection?.matrix)||card.gpuProjection.matrix.length!==16||!card.gpuProjection.matrix.every(finite)||!Array.isArray(card.gpuProjection.corners)||card.gpuProjection.corners.length!==4||!card.gpuProjection.corners.every(p=>finite(p.x)&&finite(p.y)))problems.push('missing-independent-scene-geometry');
  const lag=card?.pose&&card?.target?Math.hypot(card.pose.x-card.target.x,card.pose.y-card.target.y):null;
  if(!finite(lag))problems.push('missing-lag');
  if(atRest){if(card?.gesture||!finite(lag)||lag>0.15||Math.abs(card.pose.lift)>0.15)problems.push('not-at-rest');}
  else {
    if(card?.gesture?.intent!=='move'||card.gesture.phase!=='active'||!card.outline)problems.push('not-active-move-outline');
    if(!finite(card?.outline?.opacity)||card.outline.opacity<0.5)problems.push('outline-not-painted');
    if(card?.outline&&card?.target&&!['x','y','width','height'].every(k=>finite(card.outline[k])&&finite(card.target[({width:'w',height:'h'})[k]??k])&&Math.abs(card.outline[k]-card.target[({width:'w',height:'h'})[k]??k])<=0.75))problems.push('outline-target-mismatch');
  }
  return {ready:!problems.length,problems,drawSequence:frame?.drawSequence??null,rendererNowMs:frame?.rendererNowMs??null,reduced:frame?.reduced??null,card,grid:frame?.grid??null,lag,match,
    meaning:'Same completed renderer submission: independent Three scene projection versus DOM; not GPU readback or OS presentation'};
}
const body=fn=>fn.toString();
const expressions={...common,
  glide:(id,after=-1,rest=false)=>`(${body(observe)})(${q(id)},${q(after)},${q(rest)})`,
  glideReady:(id,after=-1,rest=false)=>`(${expressions.glide(id,after,rest)}).ready`,
  glideConverged:id=>`(()=>{const f=${expressions.glide(id)};return f.ready&&f.lag<=0.15})()`,
};
exports.expressions=expressions;
exports.preflight=()=>{const inherited=commonPreflight(),cases=[expressions.glide('quote"\n'),expressions.glideReady('quote"\n',8,false),expressions.glideReady('quote"\n',8,true),expressions.glideConverged('quote"\n')];for(const code of cases)compileExpression(code);return {factories:4,cases:cases.length,sha256:createHash('sha256').update(inherited.sha256+cases.join('\n')).digest('hex')};};
