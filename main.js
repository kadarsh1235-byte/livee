const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const store = require('./src/store');
const auth = require('./src/auth');
const yt = require('./src/youtube');
const live = require('./src/live');
const { listDevices } = require('./src/streamer');

const DEFAULT_EMAIL = 'kadarsh7991.2@gmail.com';
let win;

const emit = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 980, minHeight: 640,
    title: 'Pro Editz Live Studio',
    backgroundColor: '#12141C',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => {
  await live.stop(() => {});
  app.quit();
});

handle('app:state', async () => {
  const oauth = store.get('oauth', {});
  const signedIn = auth.isSignedIn();
  let channel = null;
  if (signedIn) { try { channel = await yt.getMyChannel(); } catch {} }
  return {
    configured: !!(oauth.clientId && oauth.clientSecret),
    oauth: { clientId: oauth.clientId || '', email: oauth.email || DEFAULT_EMAIL },
    signedIn, channel, settings: store.get('ui', null), platform: process.platform, live: live.isLive(),
  };
});

handle('setup:save', ({ clientId, clientSecret, email }) => {
  const old = store.get('oauth', {});
  store.set('oauth', { clientId: clientId.trim(), clientSecret: (clientSecret || '').trim() || old.clientSecret || '', email: (email || '').trim() });
});

handle('auth:signIn', async () => {
  await auth.signIn(store.get('oauth', {}).email || DEFAULT_EMAIL);
  const channel = await yt.getMyChannel();
  if (!channel) throw new Error('This Google account has no YouTube channel yet.');
  return channel;
});
handle('auth:signOut', () => auth.signOut());

handle('dialog:pick', async (kind) => {
  const filters = {
    video: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv'] }],
    audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
    image: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }],
  }[kind.replace('Multi', '')];
  const r = await dialog.showOpenDialog(win, { properties: kind.endsWith('Multi') ? ['openFile', 'multiSelections'] : ['openFile'], filters });
  return r.canceled ? [] : r.filePaths;
});

handle('devices:list', listDevices);
handle('ui:save', (cfg) => store.set('ui', cfg));
handle('live:start', (cfg) => live.start(cfg, emit));
handle('live:stop', () => live.stop(emit));
handle('chat:send', (text) => live.sendChat(text));
handle('link:open', (url) => { if (/^https:\/\/(www\.)?youtube\.com\//.test(url)) shell.openExternal(url); });
