import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
import { taskReportDefinition } from './task-report.mjs';

pdfMake.addVirtualFileSystem(fonts);
self.onmessage = ({data})=>{
  try {
    const definition=taskReportDefinition(data);
    const bookmarks=[];
    definition.pageBreakBefore=node=>{
      const page=node.pageNumbers?.[0];
      if (node.style==='section'&&typeof node.text==='string'&&Number.isInteger(page)&&page>0) {
        bookmarks.push({title:node.text,page:page-1});
      }
      return false;
    };
    const document=pdfMake.createPdf(definition).getStream({bufferPages:true});
    for (const {title,page} of bookmarks) {
      document.switchToPage(page);
      document.outline.addItem(title);
    }
    const chunks=[];
    let length=0;
    document.on('data',chunk=>{
      chunks.push(chunk);
      length+=chunk.length;
    });
    document.once('error',error=>self.postMessage({error:error.message}));
    document.once('end',()=>{
      const bytes=new Uint8Array(length);
      let offset=0;
      for (const chunk of chunks) {
        bytes.set(chunk,offset);
        offset+=chunk.length;
      }
      self.postMessage({bytes},[bytes.buffer]);
    });
    document.end();
  } catch(error) {
    self.postMessage({error:error.message});
  }
};
