const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'settings.json');
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cache = {}; }
  return cache;
}
function save() { fs.writeFileSync(file(), JSON.stringify(cache, null, 2)); }

function get(key, fallback) {
  const v = load()[key];
  return v === undefined ? fallback : v;
}
function set(key, value) { load()[key] = value; save(); }

function setSecret(key, value) {
  const s = load();
  if (value == null) delete s[key];
  else if (safeStorage.isEncryptionAvailable()) s[key] = 'enc:' + safeStorage.encryptString(value).toString('base64');
  else s[key] = 'raw:' + value;
  save();
}
function getSecret(key) {
  const v = load()[key];
  if (!v) return null;
  if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
  return v.slice(4);
}

module.exports = { get, set, getSecret, setSecret };
