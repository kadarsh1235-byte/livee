// Google OAuth for desktop apps: loopback redirect + PKCE.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const store = require('./store');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let access = null;
let expiresAt = 0;

async function tokenRequest(params) {
  const { clientId, clientSecret } = store.get('oauth', {});
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Google sign-in failed.');
  return j;
}

function remember(t) {
  access = t.access_token;
  expiresAt = Date.now() + (t.expires_in - 60) * 1000;
  if (t.refresh_token) store.setSecret('refresh', t.refresh_token);
}

function signIn(loginHint) {
  return new Promise((resolve, reject) => {
    const { clientId, clientSecret } = store.get('oauth', {});
    if (!clientId || !clientSecret) return reject(new Error('Add your Google client ID and secret in Setup first.'));

    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let redirect = '';

    const timer = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out. Try again.')); }, 5 * 60 * 1000);

    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<body style="font-family:system-ui;background:#12141C;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><h2>${err ? 'Sign-in failed' : 'Signed in to Pro Editz Live Studio. You can close this tab.'}</h2></body>`);
      server.close();
      clearTimeout(timer);
      if (err || !code || u.searchParams.get('state') !== state) return reject(new Error(err || 'Sign-in was cancelled.'));
      try {
        remember(await tokenRequest({ code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }));
        resolve();
      } catch (e) { reject(e); }
    });

    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${server.address().port}/callback`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state,
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      shell.openExternal(url.toString());
    });
  });
}

async function getAccessToken() {
  if (access && Date.now() < expiresAt) return access;
  const refresh = store.getSecret('refresh');
  if (!refresh) throw new Error('Not signed in. Sign in with Google first.');
  remember(await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }));
  return access;
}

function signOut() { access = null; expiresAt = 0; store.setSecret('refresh', null); }
const isSignedIn = () => !!store.getSecret('refresh');

module.exports = { signIn, signOut, getAccessToken, isSignedIn };
