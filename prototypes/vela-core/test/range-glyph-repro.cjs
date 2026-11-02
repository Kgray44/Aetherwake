/* Explicit SYNTHETIC hidden Chromium layout repro. Root may evaluate expression()
 * in its owned test browser. Requiring this file never creates a window or runs it.
 */
const {measureTextLines}=require('./native-review-ui.cjs')._offline;
function repro(document,measure) {
  const iframe=document.createElement('iframe');iframe.setAttribute('aria-hidden','true');iframe.style.cssText='position:fixed;left:-10000px;top:0;width:500px;height:500px;border:0;pointer-events:none';document.body.append(iframe);
  try {
    const doc=iframe.contentDocument;doc.open();doc.write('<!doctype html><style>body{margin:0;font:16px/1.6 monospace}p{margin:0;width:99px;white-space:pre-wrap;overflow-wrap:anywhere}.word{white-space:pre;overflow-wrap:normal}</style><p id="wrap"></p><p id="word" class="word"></p>');doc.close();
    const p=doc.querySelector('#wrap');p.textContent='alpha beta gamma delta epsilon zeta';const word=doc.querySelector('#word');word.textContent='SYNTHETIC_OVERSIZED_REAL_WORD';
    const raw=doc.createRange();raw.selectNodeContents(p);const legacy=[...raw.getClientRects()].map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height})),bounds=p.getBoundingClientRect(),glyphs=measure(doc,p),wide=measure(doc,word),outside=r=>r.left<bounds.left-1.5||r.right>bounds.right+1.5;
    return {contract:'aerynth.synthetic-hidden-chromium-range-repro@1',assistantOrNativeQualification:false,sourceText:p.textContent,paragraph:{left:bounds.left,right:bounds.right,width:bounds.width},legacyFragments:legacy,glyphLines:glyphs.lines,legacyWrappingAdvanceOutside:legacy.some(outside),nonWhitespaceGlyphsInside:glyphs.lines.every(r=>!outside(r)),oversizedRealWordStillOutside:wide.lines.some(outside)};
  } finally {iframe.remove();}
}
exports.expression=()=>`(${repro.toString()})(document,(${measureTextLines.toString()}))`;
