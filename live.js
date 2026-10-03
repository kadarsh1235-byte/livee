// Orchestrates a full live session: YouTube broadcast + FFmpeg + chat polling.
const yt = require('./youtube');
const { Streamer, probe } = require('./streamer');

let st = null;
const isLive = () => !!st;
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

function friendly(e) {
  if (e.reason === 'liveStreamingNotEnabled')
    return new Error("Live streaming isn't enabled on this channel yet. Turn it on at youtube.com/features (needs phone verification, up to 24 hours).");
  if (e.reason === 'quotaExceeded' || e.reason === 'rateLimitExceeded')
    return new Error('Your YouTube API daily quota is used up. It resets at midnight Pacific time.');
  if (e.reason === 'insufficientPermissions' || e.status === 403)
    return new Error(e.message + ' Sign out and sign in again, and accept every permission.');
  return e;
}

async function start(cfg, emit) {
  if (st) throw new Error('A stream is already running.');
  st = { stopping: false };
  const cur = st;
  const status = (phase, text, extra = {}) => emit('live:status', { phase, text, ...extra });

  try {
    status('creating', 'Creating your YouTube broadcast…');
    if (cfg.video.mode === 'file') Object.assign(cfg.video, await probe(cfg.video.file));
    const d = cfg.details;

    const b = await yt.createBroadcast(d);
    cur.broadcastId = b.id;
    cur.liveChatId = b.snippet?.liveChatId;
    const s = await yt.createStream(d.title);
    await yt.bind(b.id, s.id);
    cur.streamId = s.id;

    yt.updateVideo(b.id, d).catch((e) => emit('log', 'Category and tags not set: ' + e.message));
    if (cfg.thumbnail) yt.setThumbnail(b.id, cfg.thumbnail).catch((e) => emit('log', 'Thumbnail not set: ' + e.message));

    const ing = s.cdn.ingestionInfo;
    const url = `${ing.ingestionAddress}/${ing.streamName}`;

    status('starting', 'Starting the encoder…');
    cur.streamer = new Streamer({
      onStats: (s2) => emit('live:stats', s2),
      onLog: (t) => emit('log', t),
      onExit: (code, tail) => {
        if (cur.stopping || st !== cur) return;
        stop(emit, { phase: 'error', text: 'The encoder stopped. ' + (tail || '').split('\n').slice(-3).join(' ') });
      },
    });
    cur.streamer.start(cfg, url);

    status('waiting', 'Waiting for YouTube to receive your video…', { url: watchUrl(b.id) });
    monitor(cur, emit, status);
    pollChat(cur, emit);
  } catch (e) {
    await abort(cur);
    throw friendly(e);
  }
}

function monitor(cur, emit, status) {
  let tries = 0;
  const tick = async () => {
    if (st !== cur || cur.stopping) return;
    try {
      if ((await yt.getStreamStatus(cur.streamId)) === 'active') {
        const lc = await yt.getBroadcastStatus(cur.broadcastId);
        if (lc === 'live') return status('live', 'You are live.', { url: watchUrl(cur.broadcastId) });
        if (lc === 'ready' || lc === 'testing') {
          try { await yt.transition(cur.broadcastId, 'live'); }
          catch (e) { if (e.reason !== 'redundantTransition') emit('log', 'Go-live step: ' + e.message); }
        } else if (lc === 'complete' || lc === 'revoked') {
          return status('error', 'YouTube ended this broadcast.');
        }
      }
      if (++tries > 60) return status('error', 'YouTube did not receive video after 4 minutes. Check the log below.');
    } catch (e) { emit('log', 'Status check: ' + e.message); }
    if (st === cur) cur.statusTimer = setTimeout(tick, 4000);
  };
  cur.statusTimer = setTimeout(tick, 4000);
}

function pollChat(cur, emit) {
  if (!cur.liveChatId) return;
  let pageToken;
  const tick = async () => {
    if (st !== cur || cur.stopping) return;
    let wait = 10000;
    try {
      const r = await yt.listChat(cur.liveChatId, pageToken);
      pageToken = r.nextPageToken;
      wait = Math.max(10000, r.pollingIntervalMillis || 10000); // keeps API quota low
      const msgs = (r.items || [])
        .filter((i) => i.snippet?.type === 'textMessageEvent')
        .map((i) => ({
          id: i.id,
          author: i.authorDetails.displayName,
          text: i.snippet.displayMessage,
          owner: i.authorDetails.isChatOwner,
          mod: i.authorDetails.isChatModerator,
        }));
      if (msgs.length) emit('chat:messages', msgs);
    } catch (e) {
      if (e.reason === 'liveChatEnded') return;
      wait = 15000;
    }
    if (st === cur) cur.chatTimer = setTimeout(tick, wait);
  };
  cur.chatTimer = setTimeout(tick, 8000);
}

async function abort(cur) {
  cur.stopping = true;
  clearTimeout(cur.statusTimer);
  clearTimeout(cur.chatTimer);
  await cur.streamer?.stop();
  if (cur.broadcastId) await yt.deleteBroadcast(cur.broadcastId).catch(() => {});
  if (st === cur) st = null;
}

async function stop(emit, final) {
  const cur = st;
  if (!cur) return;
  cur.stopping = true;
  if (!final) emit('live:status', { phase: 'ending', text: 'Ending your stream…' });
  clearTimeout(cur.statusTimer);
  clearTimeout(cur.chatTimer);
  await cur.streamer?.stop();
  if (cur.broadcastId) { try { await yt.transition(cur.broadcastId, 'complete'); } catch {} }
  const liveChatId = cur.liveChatId;
  st = null;
  emit('live:status', final || { phase: 'idle', text: 'Stream ended. The replay is on your channel.' });
  return liveChatId;
}

async function sendChat(text) {
  if (!st?.liveChatId) throw new Error('Chat opens once you are live.');
  await yt.sendChat(st.liveChatId, text);
}

module.exports = { start, stop, isLive, sendChat };
