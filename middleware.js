// Pampa Meats — auth gate for the dashboard + data feed.
// Per-partner login (Users table, self-set passwords) + master DASH_PASS fallback.
// Session = signed 'pm_session' cookie. Public: /api/order-create, /api/daily-digest,
// and the /api/login + /api/setup handlers below. If DASH_PASS is unset, deny by default.

const BASE = 'app1muH8br0JSsvOa';
const USERS = 'tblcwjfmxGhzCDd0g';
const AT = 'https://api.airtable.com/v0/';
const enc = new TextEncoder();

export const config = {
  matcher: ['/dashboard', '/dashboard/(.*)', '/api/(.*)']
};

function toHex(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) {
    const h = b[i].toString(16);
    s += h.length < 2 ? '0' + h : h;
  }
  return s;
}
function fromHex(h) {
  let s = '';
  for (let i = 0; i + 1 < h.length; i += 2) {
    s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  }
  return s;
}
async function hmacHex(msg, key) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return toHex(sig);
}
async function pbkdf2Hex(pw, saltHex) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(saltHex), iterations: 100000, hash: 'SHA-256' }, base, 256);
  return toHex(bits);
}
function randHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return toHex(a);
}
async function makeSession(email, key) {
  const exp = Date.now() + 604800000;
  const payload = email + '|' + exp;
  const sig = await hmacHex(payload, key);
  return toHex(enc.encode(payload)) + '.' + sig;
}
async function validSession(token, key) {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const payload = fromHex(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  const bar = payload.lastIndexOf('|');
  if (bar < 0) return false;
  const exp = parseInt(payload.slice(bar + 1), 10);
  if (!exp || Date.now() > exp) return false;
  const expected = await hmacHex(payload, key);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const parts = c.split(';');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.indexOf(name + '=') === 0) return p.slice(name.length + 1);
  }
  return '';
}
function jsonRes(obj, session) {
  const h = { 'Content-Type': 'application/json' };
  if (session) h['Set-Cookie'] = 'pm_session=' + session + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800';
  return new Response(JSON.stringify(obj), { status: 200, headers: h });
}
async function findUser(atoken, email) {
  const formula = "LOWER({Email})='" + email.toLowerCase().split("'").join('') + "'";
  const url = AT + BASE + '/' + USERS + '?maxRecords=1&filterByFormula=' + encodeURIComponent(formula);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + atoken } });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.records && j.records[0]) || null;
}

async function handlePayLink(req) {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return jsonRes({ ok: false, reason: 'stripe_not_configured' });
  let b = {};
  try { b = await req.json(); } catch (e) {}
  const oid = String(b.oid || '');
  const amount = Math.round(Number(b.amount || 0) * 100);
  const label = String(b.label || 'Pampa Meats order').slice(0, 120);
  if (!amount || amount < 50) return jsonRes({ ok: false, reason: 'bad_amount' });
  const origin = new URL(req.url).origin;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', origin + '/dashboard/weigh?paid=1');
  form.set('cancel_url', origin + '/dashboard/weigh?canceled=1');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][product_data][name]', label);
  form.set('line_items[0][price_data][unit_amount]', String(amount));
  form.set('line_items[0][quantity]', '1');
  if (oid) { form.set('metadata[oid]', oid); form.set('payment_intent_data[metadata][oid]', oid); }
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sk, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    const j = await r.json();
    if (!r.ok) return jsonRes({ ok: false, reason: 'stripe_error', detail: (j.error && j.error.message) || null });
    return jsonRes({ ok: true, url: j.url, id: j.id });
  } catch (e) {
    return jsonRes({ ok: false, reason: String(e) });
  }
}

export default async function middleware(req) {
  const pathname = new URL(req.url).pathname;
  const key = process.env.DASH_PASS;
  const atoken = process.env.AIRTABLE_TOKEN;

  if (pathname === '/api/order-create' || pathname === '/api/daily-digest') return;

  if (pathname === '/api/login' && req.method === 'POST') {
    let b = {};
    try { b = await req.json(); } catch (e) {}
    const email = String(b.email || '').trim().toLowerCase();
    const pw = String(b.password || '');
    if (!email || !pw) return jsonRes({ ok: false, reason: 'missing' });
    if (key && pw === key) return jsonRes({ ok: true, name: 'Master', role: 'Owner' }, await makeSession(email, key));
    const u = await findUser(atoken, email);
    if (!u) return jsonRes({ ok: false, reason: 'bad' });
    const f = u.fields || {};
    if (!f.Active) return jsonRes({ ok: false, reason: 'inactive' });
    if (f.NeedsSetup || !f.PassHash) return jsonRes({ ok: false, reason: 'needs_setup' });
    const stored = String(f.PassHash);
    const ci = stored.indexOf(':');
    const test = await pbkdf2Hex(pw, stored.slice(0, ci));
    if (test !== stored.slice(ci + 1)) return jsonRes({ ok: false, reason: 'bad' });
    return jsonRes({ ok: true, name: f.Name || '', role: f.Role || 'Partner' }, await makeSession(email, key));
  }

  if (pathname === '/api/setup' && req.method === 'POST') {
    let b = {};
    try { b = await req.json(); } catch (e) {}
    const email = String(b.email || '').trim().toLowerCase();
    const tok = String(b.token || '').trim();
    const pw = String(b.password || '');
    if (!email || !tok || pw.length < 6) return jsonRes({ ok: false, reason: 'bad_input' });
    const u = await findUser(atoken, email);
    if (!u) return jsonRes({ ok: false, reason: 'not_found' });
    const f = u.fields || {};
    if (!f.Active) return jsonRes({ ok: false, reason: 'inactive' });
    if (!f.SetupToken || f.SetupToken !== tok) return jsonRes({ ok: false, reason: 'bad_token' });
    const salt = randHex(16);
    const dk = await pbkdf2Hex(pw, salt);
    const pr = await fetch(AT + BASE + '/' + USERS + '/' + u.id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { PassHash: salt + ':' + dk, NeedsSetup: false, SetupToken: '' } }) });
    if (!pr.ok) return jsonRes({ ok: false, reason: 'save_failed' });
    return jsonRes({ ok: true, name: f.Name || '', role: f.Role || 'Partner' }, await makeSession(email, key));
  }

  let authed = !!(key && await validSession(getCookie(req, 'pm_session'), key));

  const auth = req.headers.get('authorization') || '';
  if (key && auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      if (decoded.slice(decoded.indexOf(':') + 1) === key) authed = true;
    } catch (e) {}
  }

  if (authed) {
    if (pathname === '/api/pay-link' && req.method === 'POST') return handlePayLink(req);
    return;
  }

  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return Response.redirect(new URL('/login', req.url), 302);
}
