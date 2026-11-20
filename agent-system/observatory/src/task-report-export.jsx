import React, {useRef,useState} from 'react';
import {Download,FileDown} from 'lucide-react';

function createPdf(snapshot) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./task-report.worker.mjs',import.meta.url),{type:'module'});
    const finish=(callback,value)=>{
      worker.terminate();
      callback(value);
    };
    worker.onmessage=({data})=>data.error
      ? finish(reject,new Error(data.error)) : finish(resolve,new Blob([data.bytes],{type:'application/pdf'}));
    worker.onerror=event=>finish(reject,new Error(event.message||'The PDF renderer could not start.'));
    try { worker.postMessage(snapshot); }
    catch(error) { finish(reject,error); }
  });
}

function download(blob,filename) {
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30_000);
}

export function TaskReportExport({snapshot, disabled}) {
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const pending=useRef(false);

  async function save({chooseDestination}) {
    if (pending.current) return;
    pending.current=true;
    setBusy(true);
    setStatus('');
    const filename=snapshot.task.id+'-report.pdf';
    try {
      let handle;
      if (chooseDestination && typeof window.showSaveFilePicker==='function') {
        try {
          handle=await window.showSaveFilePicker({
            suggestedName:filename, types:[{description:'PDF document',accept:{'application/pdf':['.pdf']}}],
          });
        } catch(error) {
          if (error.name==='AbortError') {
            setStatus('Save As closed. Use Download PDF to save through your browser.');
            return;
          }
          if (error.name!=='SecurityError') throw error;
        }
      }
      const pdf=await createPdf({...snapshot,generatedAt:new Date().toISOString()});
      if (handle) {
        const stream=await handle.createWritable();
        try { await stream.write(pdf); await stream.close(); }
        catch(error) { await stream.abort().catch(()=>{}); throw error; }
      } else {
        download(pdf,filename);
      }
      setStatus(handle?'Task report saved.':'Task report download started.');
    } catch(error) {
      setStatus('Could not export Task report. '+error.message);
    } finally {
      pending.current=false;
      setBusy(false);
    }
  }

  return <div className="task-report-export"><button type="button" className="quiet-button" onClick={()=>save({chooseDestination:true})}
    title="Export the full Task report and choose a destination" disabled={disabled||busy}>
    <FileDown size={16} aria-hidden="true"/> {busy?'Exporting…':'Export PDF'}
  </button><button type="button" className="quiet-button" onClick={()=>save({chooseDestination:false})}
    title="Download the Task report through your browser" aria-label="Download PDF" disabled={disabled||busy}>
    <Download size={16} aria-hidden="true"/>
  </button><span aria-live="polite">{status}</span></div>;
}