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
  form.set('success_url', origin + '/api/pay-done?session_id={CHECKOUT_SESSION_ID}');
  form.set('cancel_url', origin + '/order');
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

async function markPaidFromSession(s, atoken) {
  if (!s || s.payment_status !== 'paid') return;
  const oid = (s.metadata && s.metadata.oid) || '';
  const amount = (s.amount_total || 0) / 100;
  const pi = (typeof s.payment_intent === 'string') ? s.payment_intent : ((s.payment_intent && s.payment_intent.id) || '');
  if (!oid || !atoken) return;
  await fetch(AT + BASE + '/tbli7bDbuXmjnp02M/' + oid, { method: 'PATCH', headers: { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { 'Amount Paid': amount, 'Status': 'Paid', 'Stripe PI': pi, 'Stripe Status': 'Captured', 'Payment Method': 'Credit card' }, typecast: true }) });
}

async function handlePayDone(req) {
  const sk = process.env.STRIPE_SECRET_KEY;
  const atoken = process.env.AIRTABLE_TOKEN;
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment received</title></head><body style="margin:0;background:#0A0A0A;color:#EDE8DF;font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center"><div style="padding:40px"><div style="color:#C9A55C;letter-spacing:5px;font-weight:bold;font-size:20px">PAMPA MEATS</div><div style="font-size:54px;margin:22px 0 6px;color:#7fc99a">&#10003;</div><h1 style="font-weight:600;margin:0 0 8px">Payment received</h1><p style="color:#9a9488;max-width:360px;margin:0 auto">Thank you — your payment was successful. We will confirm your delivery shortly.</p></div></body></html>';
  try {
    const sid = new URL(req.url).searchParams.get('session_id') || '';
    if (sk && sid) {
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + sid, { headers: { Authorization: 'Bearer ' + sk } });
      const s = await r.json();
      if (r.ok) await markPaidFromSession(s, atoken);
    }
  } catch (e) {}
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleStripeWebhook(req) {
  const sk = process.env.STRIPE_SECRET_KEY;
  const atoken = process.env.AIRTABLE_TOKEN;
  let ev = {};
  try { ev = await req.json(); } catch (e) {}
  try {
    const type = ev.type || '';
    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      const sid = (ev.data && ev.data.object && ev.data.object.id) || '';
      if (sk && sid) {
        const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + sid, { headers: { Authorization: 'Bearer ' + sk } });
        const s = await r.json();
        if (r.ok) await markPaidFromSession(s, atoken);
      }
    }
  } catch (e) {}
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export default async function middleware(req) {
  const pathname = new URL(req.url).pathname;
  const key = process.env.DASH_PASS;
  const atoken = process.env.AIRTABLE_TOKEN;

  if (pathname === '/api/order-create' || pathname === '/api/daily-digest') return;

  if (pathname === '/api/pay-done') return handlePayDone(req);
  if (pathname === '/api/stripe-webhook' && req.method === 'POST') return handleStripeWebhook(req);

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
