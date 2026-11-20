import React,{useLayoutEffect,useRef} from 'react';

export function StickySectionAside({as:Element='div',className='',children,...props}) {
  const ref=useRef(null);
  useLayoutEffect(()=>{
    const node=ref.current;
    const update=()=>{
      // Long rails scroll to their bottom before sticking, keeping one page scrollbar.
      const top=Math.min(16,window.innerHeight-node.offsetHeight-16);
      node.style.setProperty('--section-aside-top',top+'px');
    };
    const observer=new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize',update);
    update();
    return ()=>{
      observer.disconnect();
      window.removeEventListener('resize',update);
    };
  },[]);
  return <Element className={'section-aside '+className} ref={ref} {...props}>{children}</Element>;
}