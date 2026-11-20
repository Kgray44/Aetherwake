import pdfMake from 'pdfmake/build/pdfmake.js';
import fonts from 'pdfmake/build/vfs_fonts.js';
import { taskReportDefinition } from './task-report.mjs';

pdfMake.addVirtualFileSystem(fonts);
self.onmessage = ({data})=>{
  try {
    pdfMake.createPdf(taskReportDefinition(data)).getBuffer(buffer=>{
      const bytes=Uint8Array.from(buffer);
      self.postMessage({bytes},[bytes.buffer]);
    });
  } catch(error) {
    self.postMessage({error:error.message});
  }
};