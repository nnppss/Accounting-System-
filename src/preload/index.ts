import { contextBridge, ipcRenderer } from 'electron'

/** The single, typed bridge the renderer is allowed to use. */
const api = {
  ping: (msg: string): Promise<{ ok: boolean; stored: string; at: string }> =>
    ipcRenderer.invoke('ping', msg)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
