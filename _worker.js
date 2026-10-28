/*
 * SIWES-DD as a Cloudflare Worker (100% Cloudflare, no other host needed).
 *
 * The old SIWES portal still runs on its original server, but its DNS record
 * was deleted. This Worker reaches the portal's real IP over TLS, speaks HTTP
 * with the portal's own name in the Host header, logs in with each student's
 * own credentials and returns that student's documents. Nothing is stored.
 *
 * Pages:  /          the form
 *         /diag      one-click check that the portal is reachable
 *         /api/list  POST {identity, password}
 *         /api/doc   POST {identity, password, path}
 */
import { connect } from 'cloudflare:sockets';

const IP = '162.0.232.194';
const HOST = 'siwes.myunical.online';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const MAX_BYTES = 40 * 1024 * 1024;

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Download your UNICAL SIWES documents.">
  <meta name="theme-color" content="#f3f1ec">
  <title>SIWES-DD</title>
  <style>
    :root {
      color-scheme: light;
      --paper: #f3f1ec;
      --surface: #fbfaf7;
      --ink: #1c1a17;
      --muted: #686259;
      --line: #d8d2c7;
      --line-strong: #8f887d;
      --wash: #e8e3da;
      --serif: ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
      --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --radius: 2px;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html { background: var(--paper); -webkit-text-size-adjust: 100%; }
    body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 1rem; line-height: 1.6; -webkit-font-smoothing: antialiased; }
    ::selection { background: var(--ink); color: var(--paper); }
    h1, h2 { margin: 0; font-family: var(--serif); font-weight: 500; line-height: 1.1; letter-spacing: -0.02em; }
    p { margin: 0; }
    button, input { font: inherit; color: inherit; }
    button { cursor: pointer; }
    .wrap { width: 100%; max-width: 640px; margin: 0 auto; padding-right: clamp(1rem, 5vw, 2rem); padding-left: clamp(1rem, 5vw, 2rem); }
    .site-header { padding: clamp(2.5rem, 6vw, 4rem) 0 clamp(2rem, 4.5vw, 3rem); border-top: 3px solid var(--ink); border-bottom: 1px solid var(--line); }
    .site-header h1 { font-size: clamp(2.15rem, 5.5vw, 3rem); }
    .tagline { max-width: 50ch; margin-top: 1rem; color: var(--muted); font-size: 1rem; }
    .section { padding: clamp(2.25rem, 5vw, 3.5rem) 0; border-bottom: 1px solid var(--line); }
    .section h2 { font-size: clamp(1.5rem, 4vw, 1.9rem); }
    .note { max-width: 60ch; margin-top: 0.55rem; color: var(--muted); font-size: 0.95rem; }
    form { margin-top: 1.65rem; }
    .field { margin-bottom: 14px; }
    .field-label { display: block; margin-bottom: 5px; color: var(--muted); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; }
    input { width: 100%; height: max(44px, 2.75rem); padding: 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius); background-color: var(--surface); color: var(--ink); font-size: 1rem; transition: border-color 0.15s ease, background-color 0.15s ease; }
    input:hover { border-color: var(--muted); }
    input:focus { outline: 2px solid var(--ink); outline-offset: 1px; border-color: var(--ink); background-color: #ffffff; }
    .pwd-wrap { position: relative; }
    .pwd-wrap input { padding-right: 46px; }
    .eye { position: absolute; top: 50%; right: 4px; transform: translateY(-50%); display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: var(--radius); background: transparent; color: var(--muted); }
    .eye:hover { color: var(--ink); background: var(--surface); }
    .eye:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
    .eye svg { width: 18px; height: 18px; }
    [hidden] { display: none !important; }
    .button-row { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 1.35rem; }
    .btn { min-height: max(44px, 2.75rem); padding: 0 18px; border: 1px solid var(--line-strong); border-radius: var(--radius); background: transparent; color: var(--ink); font-size: 0.92rem; font-weight: 500; appearance: none; transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease; }
    .btn:hover { border-color: var(--ink); background: var(--surface); }
    .btn-primary { border-color: var(--ink); background: var(--ink); color: var(--paper); }
    .btn-primary:hover { border-color: #35322d; background: #35322d; }
    .btn:disabled { opacity: 0.55; cursor: wait; }
    .btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .message { margin-top: 0.9rem; font-size: 0.9rem; line-height: 1.5; }
    .message:empty { margin-top: 0; }
    .message.error { padding: 0.65rem 0.8rem; border-left: 2px solid var(--ink); background: var(--wash); }
    .result { margin-top: 1.25rem; }
    .result[hidden] { display: none; }
    .doc-list { margin: 0.4rem 0 0; padding: 0; list-style: none; }
    .doc-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.3rem 1rem; align-items: center; padding: 0.8rem 0; border-bottom: 1px solid var(--line); }
    .doc-list li:first-child { border-top: 1px solid var(--line); }
    .doc-name { font-size: 0.95rem; }
    .doc-size { grid-column: 1; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.8rem; }
    .doc-list .btn { grid-column: 2; grid-row: 1 / span 2; align-self: center; min-height: 2.4rem; padding: 0 14px; font-size: 0.85rem; }
    @media (max-width: 640px) { .btn { width: 100%; } .doc-list .btn { width: 100%; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="wrap">
      <h1>SIWES-DD</h1>
      <p class="tagline">Your UNICAL SIWES documents. Use the same email or phone and password as the SIWES portal.</p>
    </div>
  </header>
  <main class="wrap">
    <section class="section" aria-labelledby="docs-title">
      <h2 id="docs-title">Your documents</h2>
      <p class="note">Log in to see your files, then download the ones you need.</p>
      <form id="f">
        <div class="field">
          <label class="field-label" for="identity">Email or phone number</label>
          <input id="identity" autocomplete="username" required>
        </div>
        <div class="field">
          <label class="field-label" for="password">Password or matric no.</label>
          <div class="pwd-wrap">
            <input id="password" type="password" autocomplete="current-password" required>
            <button type="button" class="eye" id="togglePwd" aria-label="Show password" aria-pressed="false">
              <svg id="eyeShow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>
              <svg id="eyeHide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="M4 4l16 16"/><path d="M10.6 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.1 3.9M6.1 6.1A16.6 16.6 0 0 0 2 12s3.5 7 10 7c1.5 0 2.9-.3 4.1-.9"/><path d="M9.9 9.9a2.9 2.9 0 0 0 4.2 4.2"/></svg>
            </button>
          </div>
        </div>
        <div class="button-row">
          <button type="submit" id="go" class="btn btn-primary">See my documents</button>
        </div>
      </form>
      <p id="message" class="message" role="status" aria-live="polite"></p>
      <div class="result" id="result" hidden>
        <ul class="doc-list" id="doc-list"></ul>
      </div>
    </section>
  </main>
  <footer class="site-footer" style="padding: 1.35rem 0 2.25rem; border-top: 1px solid var(--line-strong); text-align: center;">
    <p style="color: var(--muted); font-size: 0.8rem;">by <a href="https://euptron.pages.dev" style="color: var(--ink); text-underline-offset: 2px;">euptron</a></p>
  </footer>
<script>
  const $ = id => document.getElementById(id);
  const msg = $('message');
  function say(text, isError) { msg.textContent = text; msg.classList.toggle('error', Boolean(isError)); }
  function body(extra) { return JSON.stringify(Object.assign({ identity: $('identity').value.trim(), password: $('password').value }, extra || {})); }
  function prettyName(name) { return name.replace(/_/g, ' ').replace(/\\.(html|pdf)$/i, ''); }
  $('togglePwd').addEventListener('click', () => {
    var input = $('password');
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('eyeShow').hidden = show;
    $('eyeHide').hidden = !show;
    var btn = $('togglePwd');
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  $('f').addEventListener('submit', async ev => {
    ev.preventDefault();
    say('');
    $('result').hidden = true;
    const btn = $('go');
    btn.disabled = true;
    btn.textContent = 'One moment';
    try {
      const r = await fetch('/api/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body() });
      const t = await r.text();
      let j = {};
      try { j = JSON.parse(t); } catch (err) { j = { ok: false, error: 'Service problem (status ' + r.status + '). Wait a moment and try again.' }; }
      if (!j.ok) throw new Error(j.error || 'Could not reach the portal. Try again.');
      say('Files found');
      $('doc-list').innerHTML = j.documents.map(d =>
        '<li data-path="' + d.path + '" data-file="' + d.file + '">' +
        '<span class="doc-name">' + prettyName(d.name) + '</span>' +
        '<span class="doc-size">' + (d.size > 1048576 ? (d.size / 1048576).toFixed(1) + ' MB' : Math.round(d.size / 1024) + ' KB') + '</span>' +
        '<button type="button" class="btn doc-dl">Download</button>' +
        '</li>'
      ).join('');
      $('result').hidden = false;
    } catch (e) {
      say(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'See my documents';
    }
  });
  $('doc-list').addEventListener('click', async ev => {
    const btn = ev.target.closest('.doc-dl');
    if (!btn) return;
    const li = btn.closest('li');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving';
    try {
      const r = await fetch('/api/doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body({ path: li.dataset.path }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Download problem (status ' + r.status + '). Try again.'); }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = li.dataset.file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say('Saved ' + prettyName(li.dataset.file) + '. Check your Downloads folder.');
    } catch (e) {
      say(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
</script>
</body>
</html>`;

function enc(s) { return new TextEncoder().encode(s); }

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function buildRequest(method, path, { body = null, cookie = null } = {}) {
  let req = method + ' ' + path + ' HTTP/1.0\r\nHost: ' + HOST + '\r\nUser-Agent: ' + UA + '\r\n';
  if (cookie) req += 'Cookie: ' + cookie + '\r\n';
  if (body !== null) {
    req += 'Content-Type: application/x-www-form-urlencoded\r\nContent-Length: ' + enc(body).length + '\r\n';
  }
  req += 'Connection: close\r\n\r\n';
  if (body !== null) req += body;
  return req;
}

async function openSocket() {
  const socket = connect(IP + ':443', { secureTransport: 'on' });
  await withTimeout(socket.opened, 25000, 'Could not connect to the portal in time.');
  return socket;
}

// one full request-response over a fresh TLS socket
async function portal(method, path, opts = {}) {
  const socket = await openSocket();
  const w = socket.writable.getWriter();
  await w.write(enc(buildRequest(method, path, opts)));
  w.releaseLock();

  const reader = socket.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await withTimeout(reader.read(), 45000, 'The portal did not respond in time. Try again.');
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_BYTES) { try { reader.releaseLock(); } catch (_) {} try { await socket.close(); } catch (_) {} throw new Error('That file is too large.'); }
  }
  try { reader.releaseLock(); } catch (_) {}
  try { await socket.close(); } catch (_) {}

  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }

  // headers are ASCII; a latin1 scan is byte-safe for finding the blank line
  const headText = new TextDecoder('latin1').decode(buf.subarray(0, Math.min(total, 65536)));
  const sep = headText.indexOf('\r\n\r\n');
  if (sep < 0) throw new Error('The portal sent a broken response. Try again.');
  const head = headText.slice(0, sep).split('\r\n');
  const status = parseInt((head[0] || '').split(' ')[1], 10) || 0;
  const lines = head.slice(1);
  const headers = {};
  const cookies = [];
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (name === 'set-cookie') cookies.push(value.split(';')[0].trim());
    else headers[name] = value;
  }
  return {
    status,
    headers,
    cookies,
    headerLen: sep + 4,
    buf,
    body: buf.subarray(sep + 4),
    text: new TextDecoder('utf-8').decode(buf.subarray(sep + 4)),
  };
}

async function login(identity, password) {
  const body = 'email_or_phone=' + encodeURIComponent(identity) +
               '&password=' + encodeURIComponent(password) + '&login=Login';
  const res = await portal('POST', '/student/login.php', { body });
  const cookie = res.cookies.join('; ');
  if (!cookie) throw new Error('Wrong email or phone, or wrong password. Check and try again.');
  const dash = await portal('GET', '/student/dashboard.php', { cookie });
  if (dash.status !== 200 || !dash.text.includes('siwes_onboarding')) {
    throw new Error('Wrong email or phone, or wrong password. Check and try again.');
  }
  return { cookie, dash };
}

// the letter page loads its logo and signature from the portal; copy them
// into the file itself so it prints fine once saved on a phone or PC
async function inlineLetterImages(html, cookie) {
  const srcs = [...html.matchAll(/src="(\.\.\/[^"]+|\/[^"]+)"/g)].map(m => m[1]);
  for (const s of [...new Set(srcs)]) {
    try {
      const imgPath = s.startsWith('/') ? s : '/' + s.replace(/^(\.\.\/)+/g, '');
      const img = await portal('GET', imgPath, { cookie });
      if (img.status === 200) {
        const type = imgPath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        html = html.split(s).join('data:' + type + ';base64,' + btoaBytes(img.body));
      }
    } catch (_) { /* a missing picture does not block the rest */ }
  }
  return html;
}

function btoaBytes(bytes) {
  let bin = '';
  const step = 32768;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

const FORMS = [
  { name: 'SIWES Form', file: 'SIWES-FORM.pdf' },
  { name: 'SCAF Form',  file: 'SCAF-FORM.pdf' },
  { name: 'ITF Form',   file: 'ITF-FORM.pdf' },
];

async function collectDocuments(cookie, dash) {
  const docs = [];

  const letter = await portal('GET', '/siwes_onboarding/introduction.php', { cookie });
  if (letter.status === 200) {
    docs.push({ name: 'Letter of Introduction', file: 'Letter_of_Introduction.html', path: '/siwes_onboarding/introduction.php', size: letter.body.length });
  }

  for (const f of FORMS) {
    const res = await portal('GET', '/siwes_onboarding/unical_pdf_resources/' + f.file, { cookie });
    if (res.status === 200 && res.body[0] === 0x25 && res.body[1] === 0x50 && res.body[2] === 0x44 && res.body[3] === 0x46) {
      docs.push({ name: f.name, file: f.file, path: '/siwes_onboarding/unical_pdf_resources/' + f.file, size: res.body.length });
    }
  }

  // any other PDF listed on the onboarding page, with its real path
  const onb = await portal('GET', '/siwes_onboarding/index.php', { cookie });
  const links = [...new Set((onb.text.match(/href='([^']+)'/g) || [])
    .map(h => h.slice(6, -1))
    .filter(h => h.toLowerCase().endsWith('.pdf'))
    .map(h => '/siwes_onboarding/' + h.replace(/^\.\//, '')))];
  for (const p of links) {
    if (docs.some(d => d.path === p)) continue;
    try {
      const res = await portal('GET', p, { cookie });
      if (res.status === 200 && res.body[0] === 0x25 && res.body[1] === 0x50 && res.body[2] === 0x44 && res.body[3] === 0x46) {
        docs.push({ name: p.split('/').pop().replace(/\.pdf$/i, '').replace(/-/g, ' '), file: p.split('/').pop(), path: p, size: res.body.length });
      }
    } catch (_) { /* skip broken extras */ }
  }

  docs.push({ name: 'Payment Receipt', file: 'Payment_Receipt.html', path: '/student/dashboard.php', size: dash.body.length });
  return docs;
}

// best-effort rate limit: 30 requests per IP per 15 minutes
const hits = new Map();
function tooMany(ip) {
  const now = Date.now(), windowMs = 15 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
}
function clientIp(req) {
  return (req.headers.get('cf-connecting-ip') || '').trim() || '?';
}

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

async function handleList(req) {
  if (tooMany(clientIp(req))) return new Response(JSON.stringify({ ok: false, error: 'Too many tries. Wait 15 minutes.' }), { status: 429, headers: jsonHeaders });
  const { identity = '', password = '' } = await req.json().catch(() => ({}));
  try {
    const { cookie, dash } = await login(String(identity).trim(), String(password));
    const documents = await collectDocuments(cookie, dash);
    if (documents.length <= 1) {
      return new Response(JSON.stringify({ ok: false, error: 'Logged in, but the portal has no documents for you yet. Contact the SIWES office.' }), { status: 502, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ ok: true, documents }), { headers: jsonHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 401, headers: jsonHeaders });
  }
}

function looksLikeFileOk(res, isPdf) {
  if (res.status !== 200) return false;
  if (!isPdf) return true;
  return res.body[0] === 0x25 && res.body[1] === 0x50 && res.body[2] === 0x44 && res.body[3] === 0x46;
}

async function handleDoc(req) {
  if (tooMany(clientIp(req))) return new Response(JSON.stringify({ error: 'Too many tries. Wait 15 minutes.' }), { status: 429, headers: jsonHeaders });
  const { identity = '', password = '', path: filePath = '' } = await req.json().catch(() => ({}));

  const okPath = /^\/siwes_onboarding\/[A-Za-z0-9._\-/]+$/.test(filePath) || filePath === '/student/dashboard.php';
  if (!okPath || filePath.includes('..')) {
    return new Response(JSON.stringify({ error: 'Unknown file.' }), { status: 400, headers: jsonHeaders });
  }

  try {
    const { cookie } = await login(String(identity).trim(), String(password));
    let data, filename, type;

    if (filePath === '/student/dashboard.php') {
      const dash = await portal('GET', filePath, { cookie });
      if (!looksLikeFileOk(dash, false)) throw new Error('Could not load your receipt. Try again.');
      data = dash.body;
      filename = 'Payment_Receipt.html';
      type = 'text/html; charset=utf-8';
    } else if (filePath.endsWith('introduction.php')) {
      const letter = await portal('GET', filePath, { cookie });
      if (!looksLikeFileOk(letter, false)) throw new Error('Could not load your letter. Try again.');
      const html = await inlineLetterImages(letter.text, cookie);
      data = enc(html);
      filename = 'Letter_of_Introduction.html';
      type = 'text/html; charset=utf-8';
    } else {
      const file = await portal('GET', filePath, { cookie });
      if (!looksLikeFileOk(file, filePath.endsWith('.pdf'))) throw new Error('Could not load that file. Try again.');
      data = file.body;
      filename = filePath.split('/').pop();
      type = filePath.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
    }

    return new Response(data, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': 'attachment; filename="' + filename + '"',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 401, headers: jsonHeaders });
  }
}

// one-click check after deploying: proves the portal is reachable from Workers
async function handleDiag() {
  const out = { steps: [] };
  const step = (name, ok, detail) => out.steps.push({ name, ok, detail: String(detail).slice(0, 300) });

  try {
    const socket = await openSocket();
    step('connect and TLS handshake to the portal server', true, 'connected to ' + IP + ':443');
    const w = socket.writable.getWriter();
    await w.write(enc(buildRequest('GET', '/')));
    w.releaseLock();
    const res = await portal2(socket);
    step('HTTP request with the portal name', true, 'status ' + res.status);
    const isPortal = res.text.includes('SIWES') || res.text.includes('siwes');
    step('portal content check', isPortal, isPortal ? 'the real portal answered' : 'unexpected page came back');
    try { await socket.close(); } catch (_) {}
    out.ok = isPortal;
  } catch (e) {
    step('connect and TLS handshake to the portal server', false, e.message);
    step('HTTP request with the portal name', false, 'not reached');
    step('portal content check', false, 'not reached');
    out.ok = false;
    out.hint = 'If the TLS step fails, this Worker cannot reach the portal from Cloudflare. Use the Node helper in the site folder instead (Hugging Face or Render).';
  }
  return new Response(JSON.stringify(out, null, 2), { headers: jsonHeaders });
}

// read a full response from an already-open socket (used by diag)
async function portal2(socket) {
  const reader = socket.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await withTimeout(reader.read(), 30000, 'The portal did not respond in time.');
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_BYTES) break;
  }
  try { reader.releaseLock(); } catch (_) {}
  try { await socket.close(); } catch (_) {}
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  const headText = new TextDecoder('latin1').decode(buf.subarray(0, Math.min(total, 65536)));
  const sep = headText.indexOf('\r\n\r\n');
  const head = (sep >= 0 ? headText.slice(0, sep) : headText).split('\r\n');
  const status = parseInt((head[0] || '').split(' ')[1], 10) || 0;
  return { status, text: new TextDecoder('utf-8').decode(buf.subarray(sep >= 0 ? sep + 4 : 0)) };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
      return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (path === '/diag') return handleDiag();
    if (path === '/api/list' && request.method === 'POST') return handleList(request);
    if (path === '/api/doc' && request.method === 'POST') return handleDoc(request);
    if (path === '/healthz') return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });

    return new Response('Not found', { status: 404 });
  },
};
