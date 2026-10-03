const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = ['app:state', 'setup:save', 'auth:signIn', 'auth:signOut', 'dialog:pick', 'devices:list', 'ui:save', 'live:start', 'live:stop', 'chat:send', 'link:open'];
const EVENTS = ['live:status', 'live:stats', 'chat:messages', 'log'];

contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...a) => (INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('Blocked channel'))),
  on: (ch, fn) => {
    if (!EVENTS.includes(ch)) return () => {};
    const l = (_e, d) => fn(d);
    ipcRenderer.on(ch, l);
    return () => ipcRenderer.removeListener(ch, l);
  },
});
