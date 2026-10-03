const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = window.api;

async function call(ch, ...a) {
  const r = await api.invoke(ch, ...a);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const DEFAULTS = {
  details: { title: 'Pro Editz NEW | Live', description: 'Live on Pro Editz NEW. Like, subscribe and turn on notifications!', tags: 'Pro Editz NEW, live, gaming', privacy: 'public', category: '20', latency: 'low' },
  video: { mode: 'screen', loop: true, windowTitle: '', screenIndex: 1, useOwnSound: true, ownVolume: 80 },
  out: { res: '1920x1080', fps: '30', bitrate: 6000, encoder: 'x264' },
  music: { enabled: true, volume: 25, shuffle: false },
  system: { device: '', volume: 100 },
  mic: { device: '', volume: 100 },
  watermark: { position: 'tr' },
};
const S = { music: [], videoFile: '', watermark: '', thumbnail: '', platform: '', phase: 'idle', url: '', liveSince: 0, savedDevices: {} };

const getP = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setP = (o, p, v) => { const ks = p.split('.'); const l = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[l] = v; };
const base = (p) => p.split(/[\\/]/).pop();
const fileUrl = (p) => encodeURI('file:///' + p.replace(/\\/g, '/').replace(/^\//, ''));

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
}

/* ---------- settings <-> form ---------- */
function collect() {
  const cfg = structuredClone(DEFAULTS);
  $$('[data-key]').forEach((el) => {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
    else if (el.type === 'number' || el.type === 'range') v = Number(el.value);
    else v = el.value;
    setP(cfg, el.dataset.key, v);
  });
  cfg.video.file = S.videoFile;
  cfg.music.files = S.music;
  cfg.watermark.file = S.watermark;
  cfg.thumbnail = S.thumbnail;
  return cfg;
}

function apply(cfg) {
  $$('[data-key]').forEach((el) => {
    const v = getP(cfg, el.dataset.key);
    if (v === undefined) return;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === String(v);
    else el.value = v;
  });
  S.videoFile = cfg.video?.file || '';
  S.music = cfg.music?.files || [];
  S.watermark = cfg.watermark?.file || '';
  S.thumbnail = cfg.thumbnail || '';
  S.savedDevices = { system: cfg.system?.device || '', mic: cfg.mic?.device || '' };
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => call('ui:save', collect()).catch(() => {}), 400);
}

function refreshView() {
  const mode = $('[name=mode]:checked').value;
  $('#grpScreen').hidden = mode !== 'screen';
  $('#grpFile').hidden = mode !== 'file';
  $('#videoName').textContent = S.videoFile ? base(S.videoFile) : 'No video chosen';
  $('#wmName').textContent = S.watermark ? base(S.watermark) : 'No logo';
  $('#clearWm').hidden = !S.watermark;
  $('#thumbName').textContent = S.thumbnail ? base(S.thumbnail) : 'No thumbnail chosen';
  $('#thumbPrev').hidden = !S.thumbnail;
  if (S.thumbnail) $('#thumbPrev').src = fileUrl(S.thumbnail);
  $('#clearMusic').hidden = !S.music.length;
  const ul = $('#musicList');
  ul.replaceChildren(...S.music.map((f, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.textContent = base(f);
    const rm = document.createElement('button'); rm.textContent = '✕'; rm.title = 'Remove'; rm.setAttribute('aria-label', 'Remove ' + base(f));
    rm.onclick = () => { S.music.splice(i, 1); refreshView(); persist(); };
    li.append(name, rm);
    return li;
  }));
  $$('input[type=range]').forEach((r) => { const o = r.parentElement.querySelector('output'); if (o) o.textContent = r.value + '%'; });
}

/* ---------- devices ---------- */
function fillSelect(sel, items, saved) {
  sel.replaceChildren(new Option('None', ''), ...items.map((d) => new Option(d.label, d.value)));
  sel.value = items.some((d) => d.value === saved) ? saved : '';
}
async function loadDevices() {
  try {
    const d = await call('devices:list');
    fillSelect($('#selSystem'), d.audio, S.savedDevices.system);
    fillSelect($('#selMic'), d.audio, S.savedDevices.mic);
    if (S.platform === 'darwin' && d.video.length) $('#sysHint').textContent = 'Screens and cameras: ' + d.video.map((v) => v.label).join(', ');
  } catch (e) { toast('Could not list devices: ' + e.message, true); }
}

/* ---------- account ---------- */
function showAccount(channel) {
  $('#chan').hidden = !channel;
  if (channel) { $('#chanName').textContent = channel.title; if (channel.avatar) $('#chanImg').src = channel.avatar; }
  $('#btnAuth').textContent = channel ? 'Sign out' : 'Sign in with Google';
  $('#btnAuth').className = channel ? 'ghost' : 'solid';
  S.signedIn = !!channel;
}

$('#btnAuth').onclick = async () => {
  const btn = $('#btnAuth'); btn.disabled = true;
  try {
    if (S.signedIn) { await call('auth:signOut'); showAccount(null); return; }
    btn.textContent = 'Waiting for Google…';
    showAccount(await call('auth:signIn'));
    toast('Signed in');
  } catch (e) { showAccount(null); toast(e.message, true); }
  finally { btn.disabled = false; }
};

/* ---------- setup dialog ---------- */
$('#btnSetup').onclick = () => $('#setup').showModal();
$('#setCancel').onclick = () => $('#setup').close();
$('#setupForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await call('setup:save', { clientId: $('#setId').value, clientSecret: $('#setSecret').value, email: $('#setEmail').value });
    $('#setup').close(); $('#setSecret').value = ''; S.configured = true; toast('Saved. Now sign in with Google.');
  } catch (err) { toast(err.message, true); }
};

/* ---------- file pickers ---------- */
const pick = async (kind) => (await call('dialog:pick', kind));
$('#pickVideo').onclick = async () => { const [f] = await pick('video'); if (f) { S.videoFile = f; refreshView(); persist(); } };
$('#pickWm').onclick = async () => { const [f] = await pick('image'); if (f) { S.watermark = f; refreshView(); persist(); } };
$('#clearWm').onclick = () => { S.watermark = ''; refreshView(); persist(); };
$('#pickThumb').onclick = async () => { const [f] = await pick('image'); if (f) { S.thumbnail = f; refreshView(); persist(); } };
$('#addMusic').onclick = async () => { const f = await pick('audioMulti'); if (f.length) { S.music.push(...f); refreshView(); persist(); } };
$('#clearMusic').onclick = () => { S.music = []; refreshView(); persist(); };
$('#refreshDev').onclick = loadDevices;

document.addEventListener('input', (e) => { if (e.target.dataset?.key) { refreshView(); persist(); } });
document.addEventListener('change', (e) => { if (e.target.dataset?.key) { refreshView(); persist(); } });

/* ---------- go live ---------- */
const PHASE_LABEL = { idle: 'Off air', creating: 'Getting ready', starting: 'Getting ready', waiting: 'Connecting', live: 'On air', ending: 'Ending', error: 'Problem' };
const hms = (s) => [s / 3600, (s / 60) % 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');

function setPhase(phase, text, url) {
  S.phase = phase;
  $('#deck').dataset.phase = phase;
  $('#phaseText').textContent = PHASE_LABEL[phase] || phase;
  if (text) $('#statusText').textContent = text;
  if (url) S.url = url;
  const running = ['creating', 'starting', 'waiting', 'live', 'ending'].includes(phase);
  const btn = $('#btnLive');
  btn.textContent = phase === 'ending' ? 'Ending…' : running ? 'End stream' : 'Go live';
  btn.disabled = phase === 'ending' || phase === 'creating' || phase === 'starting';
  $('#linkRow').hidden = !(running && S.url);
  $('#chatInput').disabled = $('#chatSend').disabled = phase !== 'live';
  if (phase === 'live' && !S.liveSince) S.liveSince = Date.now();
  if (!running) { S.liveSince = 0; if (phase === 'idle' || phase === 'error') $('#timer').textContent = '00:00:00'; }
}

setInterval(() => { if (S.liveSince) $('#timer').textContent = hms((Date.now() - S.liveSince) / 1000); }, 500);

$('#btnLive').onclick = async () => {
  if (S.phase !== 'idle' && S.phase !== 'error') {
    if (confirm('End your live stream now?')) await call('live:stop').catch((e) => toast(e.message, true));
    return;
  }
  if (!S.configured) { $('#setup').showModal(); return toast('Finish Setup first.', true); }
  if (!S.signedIn) return toast('Sign in with Google first.', true);
  const cfg = collect();
  if (!cfg.details.title.trim()) return toast('Add a stream title.', true);
  if (cfg.video.mode === 'file' && !cfg.video.file) return toast('Choose a video file to stream.', true);
  if (cfg.music.enabled && !cfg.music.files.length) cfg.music.enabled = false;
  $('#chatList').replaceChildren();
  $('#logBox').textContent = '';
  S.url = '';
  setPhase('creating', 'Creating your YouTube broadcast…');
  try { await call('live:start', cfg); }
  catch (e) { setPhase('error', e.message); }
};

$('#btnOpen').onclick = () => call('link:open', S.url).catch(() => {});
$('#btnCopy').onclick = async () => { await navigator.clipboard.writeText(S.url); toast('Link copied'); };

api.on('live:status', (d) => setPhase(d.phase, d.text, d.url));
api.on('live:stats', (s) => {
  $('#stFps').textContent = s.fps || '-';
  $('#stBr').textContent = s.bitrate && s.bitrate !== 'N/A' ? s.bitrate.replace('kbits/s', ' kbps') : '-';
  $('#stSpeed').textContent = s.speed || '-';
  $('#stDrop').textContent = s.dropped || '0';
});
api.on('log', (t) => { const b = $('#logBox'); b.textContent = (b.textContent + t + '\n').slice(-6000); b.scrollTop = b.scrollHeight; });

/* ---------- chat ---------- */
api.on('chat:messages', (msgs) => {
  const ul = $('#chatList');
  ul.querySelector('.empty')?.remove();
  for (const m of msgs) {
    const li = document.createElement('li');
    if (m.owner) li.className = 'owner'; else if (m.mod) li.className = 'mod';
    const b = document.createElement('b'); b.textContent = m.author;
    li.append(b, document.createTextNode(m.text));
    ul.append(li);
  }
  while (ul.children.length > 200) ul.firstChild.remove();
  ul.scrollTop = ul.scrollHeight;
});
async function sendChat() {
  const v = $('#chatInput').value.trim();
  if (!v) return;
  try { await call('chat:send', v); $('#chatInput').value = ''; } catch (e) { toast(e.message, true); }
}
$('#chatSend').onclick = sendChat;
$('#chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };

/* ---------- start ---------- */
(async function init() {
  const st = await call('app:state');
  S.platform = st.platform; S.configured = st.configured;
  document.body.dataset.platform = st.platform;
  $('#setId').value = st.oauth.clientId; $('#setEmail').value = st.oauth.email;
  apply(st.settings ? { ...structuredClone(DEFAULTS), ...st.settings } : structuredClone(DEFAULTS));
  $('#sysHint').textContent = st.platform === 'win32'
    ? 'To capture game sound, enable "Stereo Mix" in Windows Sound settings, or install VB-Cable and pick it here.'
    : st.platform === 'darwin' ? 'To capture game sound on Mac, install BlackHole and pick it here.' : '';
  refreshView();
  showAccount(st.channel);
  await loadDevices();
  if (st.signedIn && !st.channel) toast('Could not reach YouTube. Check your internet and sign in again.', true);
  if (!st.configured) $('#setup').showModal();
})();
