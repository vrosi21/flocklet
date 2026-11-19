// The only bridge between the sandboxed overlay page and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentdeck', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  ready: () => ipcRenderer.send('ui:ready'),
  resize: (height, stops) => ipcRenderer.send('ui:resize', Number(height) || 0,
    { bar: Number(stops && stops.bar) || 0, full: Number(stops && stops.full) || 0, dockW: Number(stops && stops.dockW) || 0 }),
  drag: (edge, phase, dx, dy) => ipcRenderer.send('ui:drag', String(edge), String(phase), Number(dx) || 0, Number(dy) || 0),
  jump: (hostId) => ipcRenderer.send('ui:jump', hostId),
  hideCard: (id) => ipcRenderer.send('ui:hideCard', id),
  decide: (requestId, action) => ipcRenderer.send('ui:decide', requestId, action),
  set: (patch) => ipcRenderer.send('ui:set', patch),
  dockMenu: () => ipcRenderer.send('ui:dockMenu'),
  checkUpdates: () => ipcRenderer.send('ui:checkUpdates'),
  fold: (key, folded) => ipcRenderer.send('ui:fold', String(key), folded === true),
  hide: () => ipcRenderer.send('ui:hide'),
  refreshUsage: () => ipcRenderer.send('ui:refreshUsage'),
  pin: (key, on) => ipcRenderer.send('ui:pin', key, on),
  group: (op) => ipcRenderer.send('ui:group', op),
  quiet: (key, on) => ipcRenderer.send('ui:quiet', key, on),
  pet: (key, kind) => ipcRenderer.send('ui:pet', key, kind),
  petMenu: (op, key, value) => ipcRenderer.send('ui:petMenu', String(op), key == null ? null : String(key), value),
});
