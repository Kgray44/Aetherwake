/** Minimal CPU-only event/DOM adapter. It does not implement browser layout, GPU, clipboard or native consent. */
export function componentDocument() {
  const doc: any = {activeElement:null};
  class Element {
    tagName: string; ownerDocument: any; parentElement: any = null; children: any[] = []; dataset: Record<string,string> = {}; attrs = new Map<string,string>();
    listeners = new Map<string,((event:any)=>void)[]>(); className = ''; style: Record<string,string> = {}; value = ''; hidden = false; disabled = false; checked = false; open = false;
    scrollTop = 0; scrollHeight = 1000; clientHeight = 300; selectionStart = 0; selectionEnd = 0; private textValue = '';
    constructor(tag:string) {this.tagName=tag.toUpperCase();this.ownerDocument=doc;}
    get parentNode(){return this.parentElement;} get firstChild():any{return this.children[0]??(this.textValue?{parentElement:this,textContent:this.textValue}:null);}
    get classList(){const self=this;return {add(...names:string[]){self.className=[...new Set([...self.className.split(' ').filter(Boolean),...names])].join(' ');},remove(name:string){self.className=self.className.split(' ').filter(n=>n!==name).join(' ');},toggle(name:string){const has=self.className.split(' ').includes(name);if(has)this.remove(name);else this.add(name);return !has;}};}
    get textContent():string{return this.textValue+this.children.map(node=>node.textContent).join('');} set textContent(value:string){this.textValue=String(value);for(const child of this.children)child.parentElement=null;this.children=[];}
    get text(){return this.textContent;} get options(){return this.children.filter(node=>node.tagName==='OPTION');}
    append(...nodes:any[]){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}
    replaceChildren(...nodes:any[]){for(const node of this.children)node.parentElement=null;this.children=[];this.textValue='';this.append(...nodes);}
    insertBefore(node:any,next:any){node.remove();node.parentElement=this;const i=this.children.indexOf(next);this.children.splice(i<0?this.children.length:i,0,node);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter((node:any)=>node!==this);this.parentElement=null;}
    contains(node:any):boolean{return node===this||node?.parentElement===this||this.children.some(child=>child.contains(node));}
    setAttribute(name:string,value:string){this.attrs.set(name,value);} getAttribute(name:string){return this.attrs.get(name)??null;} removeAttribute(name:string){this.attrs.delete(name);}
    addEventListener(name:string,listener:(event:any)=>void){this.listeners.set(name,[...this.listeners.get(name)??[],listener]);}
    matches(selector:string){const tag=selector.match(/^[a-z]+/i)?.[0],classes=[...selector.matchAll(/\.([\w-]+)/g)].map(m=>m[1]),attr=selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/);return (!tag||this.tagName===tag.toUpperCase())&&classes.every(cls=>this.className.split(' ').includes(cls))&&(!attr||(attr[1]==='open'?this.open:attr[1].startsWith('data-')?this.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,s)=>s.toUpperCase())]===attr[2]:this.attrs.has(attr[1])&&(attr[2]===undefined||this.attrs.get(attr[1])===attr[2])));}
    querySelectorAll(selector:string):any[]{return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    querySelector(selector:string):any{return this.querySelectorAll(selector)[0]??null;} closest(selector:string):any{return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
    focus(){doc.activeElement=this;} setSelectionRange(start:number,end:number){this.selectionStart=start;this.selectionEnd=end;} scrollIntoView(){}
    requestSubmit(){return this.fire('submit');}
    fire(type:string,extra:Record<string,unknown>={}){const event={type,target:this,key:'',shiftKey:false,isComposing:false,altKey:false,ctrlKey:false,metaKey:false,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};for(let node:any=this;node;node=node.parentElement){for(const listener of node.listeners.get(type)??[])listener(event);if(event.stopped)break;}return event;}
  }
  doc.createElement=(tag:string)=>new Element(tag);doc.createTextNode=(text:string)=>{const node=new Element('#text');node.textContent=text;return node;};
  doc.createRange=()=>({content:null as any,end:0,selectNodeContents(node:any){this.content=node;},setEnd(_node:any,end:number){this.end=end;},toString(){return this.content.textContent.slice(0,this.end);}});
  let selection: any = null;
  return {doc,root:doc.createElement('main'),window:{getSelection:()=>selection},select:(next:any)=>{selection=next;},install(){const old={document:globalThis.document,window:globalThis.window,CSS:globalThis.CSS};Object.assign(globalThis,{document:doc,window:this.window,CSS:{escape:(value:string)=>value}});return ()=>{for(const [key,value]of Object.entries(old)){if(value===undefined)delete (globalThis as any)[key];else (globalThis as any)[key]=value;}};}};
}
export const named=(scope:any,text:string,tag='button'):any=>scope.querySelectorAll(tag).find((node:any)=>node.textContent===text);
export async function until(check:()=>boolean){for(let i=0;i<100&&!check();i++)await new Promise(resolve=>setImmediate(resolve));if(!check())throw new Error('Component wait timed out');}
