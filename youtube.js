const fs = require('fs');
const path = require('path');
const { getAccessToken } = require('./auth');

const BASE = 'https://www.googleapis.com/youtube/v3';

async function call(p, { method = 'GET', query = {}, body } = {}) {
  const url = new URL(BASE + p);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + (await getAccessToken()), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const j = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const e = new Error(j.error?.message || `YouTube API error ${r.status}`);
    e.reason = j.error?.errors?.[0]?.reason;
    e.status = r.status;
    throw e;
  }
  return j;
}

async function getMyChannel() {
  const j = await call('/channels', { query: { part: 'snippet', mine: 'true' } });
  const c = j.items?.[0];
  if (!c) return null;
  return { id: c.id, title: c.snippet.title, avatar: c.snippet.thumbnails?.default?.url };
}

const createBroadcast = (d) =>
  call('/liveBroadcasts', {
    method: 'POST',
    query: { part: 'snippet,contentDetails,status' },
    body: {
      snippet: {
        title: d.title.slice(0, 100),
        description: d.description,
        scheduledStartTime: new Date(Date.now() + 10000).toISOString(),
      },
      status: { privacyStatus: d.privacy, selfDeclaredMadeForKids: false },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: true,
        enableDvr: d.latency !== 'ultraLow',
        enableEmbed: true,
        latencyPreference: d.latency,
        monitorStream: { enableMonitorStream: false },
      },
    },
  });

const createStream = (title) =>
  call('/liveStreams', {
    method: 'POST',
    query: { part: 'snippet,cdn,contentDetails,status' },
    body: {
      snippet: { title: title.slice(0, 100) },
      cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' },
      contentDetails: { isReusable: false },
    },
  });

const bind = (id, streamId) =>
  call('/liveBroadcasts/bind', { method: 'POST', query: { id, streamId, part: 'id,contentDetails' } });

const transition = (id, status) =>
  call('/liveBroadcasts/transition', { method: 'POST', query: { id, broadcastStatus: status, part: 'status' } });

const getStreamStatus = async (id) =>
  (await call('/liveStreams', { query: { part: 'status', id } })).items?.[0]?.status?.streamStatus;

const getBroadcastStatus = async (id) =>
  (await call('/liveBroadcasts', { query: { part: 'status', id } })).items?.[0]?.status?.lifeCycleStatus;

const deleteBroadcast = (id) => call('/liveBroadcasts', { method: 'DELETE', query: { id } });

const updateVideo = (id, d) =>
  call('/videos', {
    method: 'PUT',
    query: { part: 'snippet' },
    body: {
      id,
      snippet: {
        title: d.title.slice(0, 100),
        description: d.description,
        categoryId: d.category,
        tags: (d.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      },
    },
  });

async function setThumbnail(videoId, file) {
  const type = path.extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await getAccessToken()), 'Content-Type': type },
    body: fs.readFileSync(file),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || 'Thumbnail upload failed');
}

const listChat = (liveChatId, pageToken) =>
  call('/liveChat/messages', { query: { liveChatId, part: 'snippet,authorDetails', pageToken } });

const sendChat = (liveChatId, text) =>
  call('/liveChat/messages', {
    method: 'POST',
    query: { part: 'snippet' },
    body: { snippet: { liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text.slice(0, 200) } } },
  });

module.exports = {
  getMyChannel, createBroadcast, createStream, bind, transition, getStreamStatus,
  getBroadcastStatus, deleteBroadcast, updateVideo, setThumbnail, listChat, sendChat,
};
