import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {componentDocument} from './component-dom.mts';
import {pickerMotion} from './picker-motion.mts';
import {conversationDisclosures} from '../src/picker.ts';

const fixture=()=>{const dom=componentDocument(),restore=dom.install(),m=pickerMotion();dom.root.className='cp-manager';const details=dom.doc.createElement('details'),summary=dom.doc.createElement('summary'),form=dom.doc.createElement('form'),input=dom.doc.createElement('input');summary.textContent='New chat';input.value='Exact unfinished 🧭 title';form.append(input);details.append(summary,form);dom.root.append(details);const controller=conversationDisclosures(dom.root,{motion:m.motion,viewId:'disclosure:test'});controller.sync();return {dom,restore,m,details,summary,form,input,controller,body:details.querySelector('.cp-motion-disclosure-body'),content:details.querySelector('.cp-motion-disclosure-content')};};

test('native open semantics are immediate while measured reveal and close/reopen reversal use only shared MC samples and the same form',()=>{
 const f=fixture();try{assert.equal(f.body.hidden,true);assert.equal(f.body.inert,true);f.details.open=true;f.details.fire('toggle');assert.equal(f.summary.getAttribute('aria-expanded'),'true');assert.equal(f.body.hidden,false);assert.equal(f.body.inert,false);f.controller.frame();assert.equal(f.body.style.height,'0px');f.m.step(.5);f.controller.frame();assert.equal(f.body.style.height,'150px');f.input.focus();f.input.setSelectionRange(2,7);f.details.open=false;f.details.fire('toggle');assert.equal(f.summary.getAttribute('aria-expanded'),'false');assert.equal(f.body.inert,true);assert.equal(f.body.hidden,false);f.controller.frame();assert.equal(f.body.style.height,'150px','Closing stays painted until MC advances');f.m.step(.5);f.controller.frame();assert.equal(f.body.style.height,'75px');f.details.open=true;f.details.fire('toggle');f.m.step();f.controller.frame();assert.equal(f.body.style.height,'300px');assert.equal(f.body.inert,false);assert.equal(f.details.querySelector('form')===f.form,true);assert.equal(f.details.querySelector('input')===f.input,true);assert.equal(f.dom.doc.activeElement===f.input,true);assert.deepEqual([f.input.selectionStart,f.input.selectionEnd],[2,7]);assert.equal(f.input.value,'Exact unfinished 🧭 title');f.details.open=false;f.details.fire('toggle');f.m.step();f.controller.frame();assert.equal(f.body.hidden,true);}
 finally{f.controller.dispose();assert.equal(f.m.poses.size,0);f.restore();}
});

test('native programmatic state and removed nodes reconcile without synthetic toggle or stale motion ownership',()=>{
 const f=fixture();try{let toggles=0;f.details.addEventListener('toggle',()=>toggles++);f.details.open=true;f.controller.frame();assert.equal(toggles,0);assert.equal(f.summary.getAttribute('aria-expanded'),'true');const extra=f.dom.doc.createElement('button');extra.textContent='Actual added action';f.details.append(extra);f.controller.frame();assert.equal(f.content.contains(extra),true);assert.equal(f.details.querySelectorAll('.cp-motion-disclosure-body').length,1);f.details.remove();f.controller.frame();assert.equal(f.m.poses.size,0);assert.equal(f.details.querySelector('.cp-motion-disclosure-body'),null);assert.equal(f.details.children[0]===f.summary,true);assert.equal(f.details.children[1]===f.form,true);assert.equal(f.details.children[2]===extra,true);f.details.fire('toggle');assert.equal(f.m.poses.size,0);}
 finally{f.controller.dispose();f.restore();}
});

test('menus are bounded to current host space while nested collection children remain measured flow; zero-size content makes no invented height',()=>{
 const f=fixture();try{f.details.className='cp-new-chat';f.dom.root.clientHeight=500;f.summary.clientHeight=40;f.content.clientHeight=1000;f.details.open=true;f.controller.frame();const target=[...f.m.targets.values()][0];assert.equal(target.h,360);assert.equal(f.details.dataset.cpDisclosureLayout,'menu');assert.equal(f.content.style['--cp-disclosure-cap'],'360px');f.details.className='cp-tree-group';f.controller.frame();assert.equal([...f.m.targets.values()][0].h,1000);assert.equal(f.details.dataset.cpDisclosureLayout,'flow');f.content.clientHeight=f.content.scrollHeight=0;f.controller.frame();assert.equal([...f.m.targets.values()][0].h,0);assert.equal(f.summary.getAttribute('aria-expanded'),'true');}
 finally{f.controller.dispose();f.restore();}
});

test('nested disclosure ownership is distinct from a mounted chat and reduced motion honors the host immediate samples',()=>{
 const dom=componentDocument(),restore=dom.install(),m=pickerMotion(true);let manager,chat;try{dom.root.className='cp-manager';const details=dom.doc.createElement('details'),summary=dom.doc.createElement('summary'),child=dom.doc.createElement('section'),inside=dom.doc.createElement('details'),insideSummary=dom.doc.createElement('summary');details.append(summary);child.className='cp-chat';inside.append(insideSummary);child.append(inside);dom.root.append(details,child);manager=conversationDisclosures(dom.root,{motion:m.motion,viewId:'manager'});chat=conversationDisclosures(child,{motion:m.motion,viewId:'chat'});manager.frame();assert.equal(m.poses.size,1);chat.frame();assert.equal(m.poses.size,2);details.open=true;manager.frame();assert.equal(details.querySelector('.cp-motion-disclosure-body').style.opacity,'1');details.open=false;manager.frame();assert.equal(details.querySelector('.cp-motion-disclosure-body').hidden,true);manager.dispose();assert.equal(m.poses.size,1);chat.dispose();assert.equal(m.poses.size,0);}
 finally{manager?.dispose();chat?.dispose();restore();}
});

test('idle disclosure samples do not rewrite layout, and CSS keeps the native closed content paintable without a transition clock',()=>{
 const f=fixture();try{f.details.open=true;f.controller.frame();f.m.step();f.controller.frame();let writes=0;f.body.style=new Proxy(f.body.style,{set(target,key,value){writes++;target[key]=value;return true;}});const before=f.m.causes.length;f.controller.frame();f.controller.frame();assert.equal(writes,0);assert.equal(f.m.causes.length,before);const css=readFileSync(new URL('../src/picker.css',import.meta.url),'utf8');assert(css.includes('::details-content{content-visibility:visible}'));assert(!/\b(?:transition|animation)\s*:/.test(css));}
 finally{f.controller.dispose();f.restore();}
});

test('an older DOM without state-preserving move does not reparent an already active editor subtree',()=>{
 const dom=componentDocument(),restore=dom.install(),m=pickerMotion();let controller;try{const details=dom.doc.createElement('details'),summary=dom.doc.createElement('summary'),input=dom.doc.createElement('input');details.append(summary,input);dom.root.append(details);input.value='Exact composing text';input.focus();input.setSelectionRange(3,8);controller=conversationDisclosures(dom.root,{motion:m.motion,viewId:'disclosure:old-host'});controller.frame();assert.equal(input.parentElement===details,true);assert.equal(details.querySelector('.cp-motion-disclosure-body'),null);assert.equal(m.poses.size,0);assert.equal(dom.doc.activeElement===input,true);assert.deepEqual([input.selectionStart,input.selectionEnd],[3,8]);summary.focus();controller.frame();assert.equal(details.querySelector('.cp-motion-disclosure-body').contains(input),true);assert.equal(input.value,'Exact composing text');}
 finally{controller?.dispose();restore();}
});
