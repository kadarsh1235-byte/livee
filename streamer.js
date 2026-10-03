// Builds and runs the FFmpeg pipeline: screen or video file + looping music + mics, out to YouTube RTMP.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ffmpegPath = require('ffmpeg-static');
ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

const ENCODERS = {
  x264: ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high'],
  nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'cbr', '-profile:v', 'high'],
  amf: ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-rc', 'cbr'],
  qsv: ['-c:v', 'h264_qsv', '-preset', 'veryfast'],
  videotoolbox: ['-c:v', 'h264_videotoolbox', '-realtime', '1'],
};
const POS = {
  tl: '24:24',
  tr: 'main_w-overlay_w-24:24',
  bl: '24:main_h-overlay_h-24',
  br: 'main_w-overlay_w-24:main_h-overlay_h-24',
};
const vol = (v) => (Math.max(0, Math.min(200, Number(v))) / 100).toFixed(2);
const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function screenInput(cfg, fps) {
  if (process.platform === 'win32') {
    const target = cfg.video.windowTitle ? `title=${cfg.video.windowTitle}` : 'desktop';
    return ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1', '-i', target];
  }
  if (process.platform === 'darwin') {
    return ['-f', 'avfoundation', '-framerate', String(fps), '-capture_cursor', '1', '-i', `${cfg.video.screenIndex || 1}:none`];
  }
  return ['-f', 'x11grab', '-framerate', String(fps), '-i', process.env.DISPLAY || ':0.0'];
}

function audioDeviceInput(dev) {
  const q = ['-thread_queue_size', '1024'];
  if (process.platform === 'win32') return [...q, '-f', 'dshow', '-i', `audio=${dev}`];
  if (process.platform === 'darwin') return [...q, '-f', 'avfoundation', '-i', `none:${dev}`];
  return [...q, '-f', 'pulse', '-i', dev];
}

function buildArgs(cfg, url) {
  const [W, H] = cfg.out.res.split('x').map(Number);
  const fps = Number(cfg.out.fps);
  const br = Number(cfg.out.bitrate);
  const v = cfg.video;
  const args = ['-hide_banner', '-loglevel', 'warning', '-progress', 'pipe:1', '-nostats'];
  const fc = [];
  const aLabels = [];
  let n = 0;

  // Picture
  if (v.mode === 'file') args.push('-re', '-stream_loop', v.loop ? '-1' : '0', '-i', v.file);
  else args.push(...screenInput(cfg, fps));
  const vIdx = n++;

  let wmIdx = null;
  if (cfg.watermark?.file) { args.push('-i', cfg.watermark.file); wmIdx = n++; }

  const norm = (i, volume, label) =>
    fc.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol(volume)}[${label}]`);

  // Background music (looped forever, optional shuffle)
  const m = cfg.music;
  if (m.enabled && m.files?.length) {
    const files = m.shuffle ? shuffle(m.files) : m.files;
    if (files.length === 1) {
      args.push('-re', '-stream_loop', '-1', '-i', files[0]);
    } else {
      const list = path.join(os.tmpdir(), 'proeditz-music.txt');
      fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
      args.push('-re', '-stream_loop', '-1', '-f', 'concat', '-safe', '0', '-i', list);
    }
    const i = n++;
    norm(i, m.volume, `a${i}`);
    aLabels.push(`[a${i}]`);
  }

  // The video file's own sound
  if (v.mode === 'file' && v.hasAudio && v.useOwnSound) {
    norm(vIdx, v.ownVolume, 'avid');
    aLabels.push('[avid]');
  }

  // Game / system sound and microphone
  for (const [key, label] of [['system', 'asys'], ['mic', 'amic']]) {
    const d = cfg[key];
    if (d?.device) {
      args.push(...audioDeviceInput(d.device));
      const i = n++;
      norm(i, d.volume, label);
      aLabels.push(`[${label}]`);
    }
  }

  // Picture filters
  let vf = `[${vIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps},setsar=1`;
  if (wmIdx !== null) {
    fc.unshift(
      `${vf}[vb]`,
      `[${wmIdx}:v]scale=-2:${Math.round(H * 0.12)}[wm]`,
      `[vb][wm]overlay=${POS[cfg.watermark.position] || POS.tr}[vout]`
    );
  } else {
    fc.unshift(`${vf}[vout]`);
  }

  // Audio mix
  let aOut;
  if (aLabels.length === 0) {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    aOut = `${n++}:a`;
  } else if (aLabels.length === 1) {
    aOut = aLabels[0];
  } else {
    fc.push(`${aLabels.join('')}amix=inputs=${aLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95[aout]`);
    aOut = '[aout]';
  }

  args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', aOut);
  args.push(
    ...(ENCODERS[cfg.out.encoder] || ENCODERS.x264),
    '-b:v', `${br}k`, '-maxrate', `${br}k`, '-bufsize', `${br * 2}k`,
    '-g', String(fps * 2), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'
  );
  if (v.mode === 'file' && !v.loop) {
    // Music loops forever, so stop the stream when the single video ends.
    if (v.duration) args.push('-t', v.duration.toFixed(2));
    else args.push('-shortest');
  }
  args.push('-f', 'flv', url);
  return args;
}

class Streamer {
  constructor({ onStats, onLog, onExit }) {
    Object.assign(this, { onStats, onLog, onExit, proc: null, stopping: false, tail: [] });
  }

  start(cfg, url) {
    this.proc = spawn(ffmpegPath, buildArgs(cfg, url), { windowsHide: true });
    let buf = '';
    const s = {};
    this.proc.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) {
        const i = l.indexOf('=');
        if (i < 0) continue;
        s[l.slice(0, i)] = l.slice(i + 1).trim();
        if (l.startsWith('progress=')) {
          this.onStats({ fps: s.fps, bitrate: s.bitrate, speed: s.speed, time: (s.out_time || '').split('.')[0], dropped: s.drop_frames });
        }
      }
    });
    this.proc.stderr.on('data', (d) => {
      const t = d.toString().trim();
      if (!t) return;
      this.tail = [...this.tail, t].slice(-12);
      this.onLog(t);
    });
    this.proc.on('error', (e) => { this.proc = null; this.onExit(1, e.message); });
    this.proc.on('exit', (code) => { this.proc = null; this.onExit(code, this.tail.join('\n')); });
  }

  stop() {
    return new Promise((resolve) => {
      const p = this.proc;
      if (!p) return resolve();
      this.stopping = true;
      const t = setTimeout(() => p.kill('SIGKILL'), 4000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      try { p.stdin.write('q'); } catch { p.kill(); }
    });
  }
}

function run(args, ms = 8000) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    const t = setTimeout(() => p.kill(), ms);
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => resolve(err));
    p.on('exit', () => { clearTimeout(t); resolve(err); });
  });
}

async function probe(file) {
  const err = await run(['-hide_banner', '-i', file]);
  const d = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    hasAudio: /Stream #\d+:\d+.*Audio:/.test(err),
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
  };
}

async function listDevices() {
  const out = { audio: [], video: [] };
  if (process.platform === 'win32') {
    const err = await run(['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    let mode = null;
    for (const line of err.split(/\r?\n/)) {
      if (/DirectShow video devices/i.test(line)) { mode = 'video'; continue; }
      if (/DirectShow audio devices/i.test(line)) { mode = 'audio'; continue; }
      if (/Alternative name/i.test(line)) continue;
      const typed = line.match(/"([^"]+)"\s+\((video|audio)/);
      if (typed) { out[typed[2]].push({ value: typed[1], label: typed[1] }); continue; }
      const old = line.match(/\]\s+"([^"]+)"\s*$/);
      if (old && mode) out[mode].push({ value: old[1], label: old[1] });
    }
  } else if (process.platform === 'darwin') {
    const err = await run(['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
    let mode = null;
    for (const line of err.split(/\r?\n/)) {
      if (/AVFoundation video devices/i.test(line)) { mode = 'video'; continue; }
      if (/AVFoundation audio devices/i.test(line)) { mode = 'audio'; continue; }
      const mt = line.match(/\]\s+\[(\d+)\]\s+(.+)$/);
      if (mt && mode) out[mode].push({ value: mt[1], label: `${mt[1]}: ${mt[2]}` });
    }
  } else {
    out.audio.push({ value: 'default', label: 'Default (PulseAudio)' });
  }
  return out;
}

module.exports = { Streamer, buildArgs, probe, listDevices };
