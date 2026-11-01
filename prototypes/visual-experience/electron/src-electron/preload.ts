import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aerynthLab", {
  detachBlock: (id: string) => ipcRenderer.invoke("lab:detach", id),
  closeDetached: () => ipcRenderer.invoke("lab:close-detached"),
  environment: () => ipcRenderer.invoke("lab:environment"),
  capture: (name: "expanded") => ipcRenderer.invoke("lab:capture", name),
  backgroundProbe: () => ipcRenderer.invoke("lab:background-probe"),
  benchmarkReport: (report: unknown) =>
    ipcRenderer.invoke("lab:benchmark-report", report),
  comparisonReady: (marker: Record<string, unknown>) =>
    ipcRenderer.invoke("lab:comparison-ready", marker),
});
