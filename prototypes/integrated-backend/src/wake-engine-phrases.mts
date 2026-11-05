/** English BPE compilation for the pinned Sherpa model. No audio, model call or training. */
export interface WakePhrase { id: string; text: string; spokenAliases?: string[] }
export const DEFAULT_WAKE_PHRASES: readonly WakePhrase[] = Object.freeze([
  {id:'hey-vela',text:'Hey Vela',spokenAliases:['Hey Vay La','Hey Vay Luh','Hey Veil A']},
]);
const check:(value:unknown)=>asserts value=(value)=>{if(!value)throw Error('wake_phrase_invalid');};
export function validateWakePhrases(input:unknown):WakePhrase[]{
  check(Array.isArray(input)&&input.length>=1&&input.length<=4);const seen=new Set<string>();
  return input.map(value=>{
    check(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['id','text','spokenAliases'].includes(key)));
    check(typeof value.id==='string'&&/^[a-z][a-z0-9-]{0,47}$/u.test(value.id)&&!seen.has(value.id));seen.add(value.id);
    const phrase=(text:unknown)=>{check(typeof text==='string'&&text.length>=2&&text.length<=64&&/^[A-Za-z]+(?:[ '][A-Za-z]+)*$/u.test(text));return text;};
    const text=phrase(value.text);check(value.spokenAliases===undefined||Array.isArray(value.spokenAliases)&&value.spokenAliases.length<=3);
    return {id:value.id,text,...(value.spokenAliases?{spokenAliases:value.spokenAliases.map(phrase)}:{})};
  });
}
type Piece={text:string;score:number;type:number};
/** Reads only the repeated SentencePiece piece records; all lengths/wire types are bounded. */
export function readEnglishBpeModel(bytes:Uint8Array):Map<string,Piece>{
  check(bytes.byteLength>0&&bytes.byteLength<=1048576);const data=Buffer.from(bytes),pieces=new Map<string,Piece>();
  const fields=(start:number,end:number,consume:(field:number,wire:number,start:number,end:number)=>void)=>{
    let offset=start;
    const integer=()=>{let value=0,multiplier=1;for(let i=0;i<5;i++){check(offset<end);const b=data[offset++];value+=(b&127)*multiplier;if(!(b&128))return value;multiplier*=128;}throw Error('wake_phrase_invalid');};
    while(offset<end){const tag=integer(),field=Math.floor(tag/8),wire=tag%8;check(field>0);let from=offset,to=offset;
      if(wire===0){integer();to=offset;}else if(wire===1){to=offset+8;offset=to;}else if(wire===2){const length=integer();from=offset;to=offset+length;offset=to;}else if(wire===5){to=offset+4;offset=to;}else throw Error('wake_phrase_invalid');
      check(to<=end);consume(field,wire,from,to);
    }
  };
  fields(0,data.length,(field,wire,start,end)=>{if(field!==1||wire!==2)return;let text='',score=0,type=1;
    fields(start,end,(key,kind,a,b)=>{if(key===1&&kind===2)text=data.toString('utf8',a,b);else if(key===2&&kind===5)score=data.readFloatLE(a);else if(key===3&&kind===0)type=data[a];});
    check(text.length>0&&text.length<=128&&Number.isFinite(score)&&!pieces.has(text));pieces.set(text,{text,score,type});
  });
  check(pieces.size>=26&&pieces.size<=10000&&pieces.has('▁'));return pieces;
}
/** Standard deterministic BPE merges, restricted to the supported English phrase alphabet. */
export function encodeEnglishWakePhrase(text:string,pieces:Map<string,Piece>):string[]{
  validateWakePhrases([{id:'validate',text}]);const symbols=[...('▁'+text.toUpperCase().replaceAll(' ','▁'))];
  while(symbols.length>1){let best=-1,score=-Infinity;for(let i=0;i<symbols.length-1;i++){const piece=pieces.get(symbols[i]+symbols[i+1]);if(piece?.type===1&&piece.score>score){best=i;score=piece.score;}}
    if(best<0)break;symbols.splice(best,2,symbols[best]+symbols[best+1]);
  }
  check(symbols.every(symbol=>pieces.get(symbol)?.type===1));return symbols;
}
export function compileWakeKeywords(phrases:WakePhrase[],bpe:Uint8Array,sensitivity:number):string{
  check(Number.isFinite(sensitivity)&&sensitivity>=0&&sensitivity<=1);const pieces=readEnglishBpeModel(bpe),threshold=Math.max(0.01,0.5-0.5*sensitivity);
  return validateWakePhrases(phrases).flatMap(phrase=>[phrase.text,...(phrase.spokenAliases??[])].map(text=>
    encodeEnglishWakePhrase(text,pieces).join(' ')+` :${(1+2*sensitivity).toFixed(3)} #${threshold.toFixed(3)} @${phrase.id}`)).join('\n')+'\n';
}
