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
  if (!s || s.status !== 'complete') return;
  const oid = (s.metadata && s.metadata.oid) || '';
  const amount = (s.amount_total || 0) / 100;
  const pi = (typeof s.payment_intent === 'string') ? s.payment_intent : ((s.payment_intent && s.payment_intent.id) || '');
  if (!oid || !atoken) return;
  let fields;
  if (s.payment_status === 'paid') {
    fields = { 'Amount Paid': amount, 'Status': 'Paid', 'Stripe PI': pi, 'Stripe Status': 'Captured', 'Payment Method': 'Credit card' };
  } else {
    fields = { 'Stripe PI': pi, 'Auth Hold': amount, 'Stripe Status': 'Authorized', 'Status': 'Confirmed' };
  }
  await fetch(AT + BASE + '/tbli7bDbuXmjnp02M/' + oid, { method: 'PATCH', headers: { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields, typecast: true }) });
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

async function stripeGetOrderPI(atoken, oid) {
  try {
    const r = await fetch(AT + BASE + '/tbli7bDbuXmjnp02M/' + oid, { headers: { Authorization: 'Bearer ' + atoken } });
    const j = await r.json();
    return (j.fields && (j.fields['Stripe PI'] || '')) || '';
  } catch (e) { return ''; }
}

async function handlePayAuthorize(req) {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return jsonRes({ ok: false, reason: 'stripe_not_configured' });
  let b = {};
  try { b = await req.json(); } catch (e) {}
  const oid = String(b.oid || '');
  const est = Number(b.amount || 0);
  const hold = Math.round(est * 1.15 * 100);
  if (!hold || hold < 50) return jsonRes({ ok: false, reason: 'bad_amount' });
  const origin = new URL(req.url).origin;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('payment_intent_data[capture_method]', 'manual');
  form.set('success_url', origin + '/api/pay-done?session_id={CHECKOUT_SESSION_ID}');
  form.set('cancel_url', origin + '/order');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][product_data][name]', 'Pampa Meats order (hold: estimate + 15%). Final charge by exact weight.');
  form.set('line_items[0][price_data][unit_amount]', String(hold));
  form.set('line_items[0][quantity]', '1');
  if (oid) { form.set('metadata[oid]', oid); form.set('payment_intent_data[metadata][oid]', oid); }
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + sk, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const j = await r.json();
    if (!r.ok) return jsonRes({ ok: false, reason: 'stripe_error', detail: (j.error && j.error.message) || null });
    return jsonRes({ ok: true, url: j.url, id: j.id });
  } catch (e) { return jsonRes({ ok: false, reason: String(e) }); }
}

async function handlePayCollect(req) {
  const sk = process.env.STRIPE_SECRET_KEY;
  const atoken = process.env.AIRTABLE_TOKEN;
  if (!sk) return jsonRes({ ok: false, reason: 'stripe_not_configured' });
  let b = {};
  try { b = await req.json(); } catch (e) {}
  const oid = String(b.oid || '');
  const amount = Math.round(Number(b.amount || 0) * 100);
  if (!amount || amount < 50) return jsonRes({ ok: false, reason: 'bad_amount' });
  const pi = oid ? await stripeGetOrderPI(atoken, oid) : '';
  if (pi) {
    try {
      const cap = new URLSearchParams();
      cap.set('amount_to_capture', String(amount));
      const r = await fetch('https://api.stripe.com/v1/payment_intents/' + pi + '/capture', { method: 'POST', headers: { Authorization: 'Bearer ' + sk, 'Content-Type': 'application/x-www-form-urlencoded' }, body: cap.toString() });
      const j = await r.json();
      if (!r.ok) return jsonRes({ ok: false, reason: 'capture_failed', detail: (j.error && j.error.message) || null });
      if (atoken) { await fetch(AT + BASE + '/tbli7bDbuXmjnp02M/' + oid, { method: 'PATCH', headers: { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { 'Amount Paid': amount / 100, 'Status': 'Paid', 'Stripe Status': 'Captured', 'Payment Method': 'Credit card' }, typecast: true }) }); }
      return jsonRes({ ok: true, captured: true, amount: amount / 100 });
    } catch (e) { return jsonRes({ ok: false, reason: String(e) }); }
  }
  const label = String(b.label || 'Pampa Meats order').slice(0, 120);
  const origin = new URL(req.url).origin;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', origin + '/api/pay-done?session_id={CHECKOUT_SESSION_ID}');
  form.set('cancel_url', origin + '/dashboard/weigh');
  form.set('line_items[0][price_data][currency]', 'usd');
  form.set('line_items[0][price_data][product_data][name]', label);
  form.set('line_items[0][price_data][unit_amount]', String(amount));
  form.set('line_items[0][quantity]', '1');
  if (oid) { form.set('metadata[oid]', oid); form.set('payment_intent_data[metadata][oid]', oid); }
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + sk, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const j = await r.json();
    if (!r.ok) return jsonRes({ ok: false, reason: 'stripe_error', detail: (j.error && j.error.message) || null });
    return jsonRes({ ok: true, url: j.url, id: j.id });
  } catch (e) { return jsonRes({ ok: false, reason: String(e) }); }
}

const WA_GRAPH = 'https://graph.facebook.com/v20.0/';
const WA_SYS = 'You are the friendly ordering assistant for Pampa Meats, a premium Argentine Angus, Glatt Kosher (Beit Yosef) beef company that delivers frozen to New York and New Jersey. Speak only English. Be warm, concise and helpful, like a boutique butcher concierge. You can take orders, answer questions about cuts, prices, kosher certification and delivery, and connect a customer to a person. Cuts and prices, sold by the pound as catch-weight with the final price confirmed by exact weight: Picanha 42.99 per lb, New York Strip 39.99 per lb, Top Sirloin 26.99 per lb, Tenderloin or Filet 59.99 per lb. To place an order collect which cuts and how many of each, the full name, a delivery address in NY or NJ, and a preferred delivery date, then confirm the summary before finalizing. When an order is confirmed, output on its own line a block exactly like: [ORDER] name=Full Name; picanha=0; topSirloin=0; nyStrip=0; tenderloin=0; address=Street City; state=NY; date=YYYY-MM-DD [/ORDER] then tell the customer the order is received and the team will confirm exact weight, total and payment shortly. If a customer wants to talk to a person or asks something you cannot handle, output on its own line: [CALLBACK] reason=short reason [/CALLBACK] then tell the customer a team member, preferably Ilia, will call shortly. Never invent facts. Payment is by secure card link after weighing. Delivery is frozen cold-chain, NY and NJ only. All beef is Glatt Kosher, Beit Yosef, rabbinically supervised.';

async function waVerify(req) {
  const u = new URL(req.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === process.env.WA_VERIFY_TOKEN) {
    return new Response(u.searchParams.get('hub.challenge') || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
}
async function waSend(to, body) {
  const tok = process.env.WA_TOKEN, pid = process.env.WA_PHONE_ID;
  if (!tok || !pid || !to) return;
  try { await fetch(WA_GRAPH + pid + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: String(body).slice(0, 4000) } }) }); } catch (e) {}
}
function waBlock(s, open, close) {
  const i = s.indexOf(open); if (i < 0) return '';
  const j = s.indexOf(close, i + open.length); if (j < 0) return '';
  return s.slice(i + open.length, j).trim();
}
function waStrip(s, open, close) {
  const i = s.indexOf(open); if (i < 0) return s;
  const j = s.indexOf(close, i + open.length); if (j < 0) return s;
  return s.slice(0, i) + s.slice(j + close.length);
}
function waParseKV(s) {
  const obj = {}, parts = s.split(';');
  for (let i = 0; i < parts.length; i++) { const p = parts[i], e = p.indexOf('='); if (e > 0) obj[p.slice(0, e).trim()] = p.slice(e + 1).trim(); }
  return obj;
}
async function waHistory(atoken, phone) {
  try {
    const formula = '{Phone}=' + JSON.stringify(phone);
    const r = await fetch(AT + BASE + '/tblBhoVagZqhRPbaM?maxRecords=1&filterByFormula=' + encodeURIComponent(formula), { headers: { Authorization: 'Bearer ' + atoken } });
    const jj = await r.json();
    const rec = jj.records && jj.records[0];
    let hist = [];
    if (rec && rec.fields && rec.fields.History) { try { hist = JSON.parse(rec.fields.History); } catch (e) {} }
    return { id: rec ? rec.id : null, hist: Array.isArray(hist) ? hist : [] };
  } catch (e) { return { id: null, hist: [] }; }
}
async function waSaveHistory(atoken, phone, id, hist, last) {
  const fields = { Phone: phone, History: JSON.stringify(hist.slice(-12)), 'Last Message': last, Updated: new Date().toISOString() };
  try {
    if (id) await fetch(AT + BASE + '/tblBhoVagZqhRPbaM/' + id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields, typecast: true }) });
    else await fetch(AT + BASE + '/tblBhoVagZqhRPbaM', { method: 'POST', headers: { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields, typecast: true }) });
  } catch (e) {}
}
async function waCreateOrder(atoken, phone, kv) {
  const fields = { Name: kv.name || 'WhatsApp customer', Phone: phone, Picanha: parseInt(kv.picanha, 10) || 0, 'Top Sirloin': parseInt(kv.topSirloin, 10) || 0, Striploin: parseInt(kv.nyStrip, 10) || 0, Tenderloin: parseInt(kv.tenderloin, 10) || 0, Address: kv.address || '', Status: 'New', Source: 'WhatsApp', Notes: 'Order taken by WhatsApp AI bot.' };
  const st = (kv.state || '').toUpperCase();
  if (st === 'NY') { fields['Delivery State'] = 'New York (NY)'; fields.Zone = 'NY'; }
  if (st === 'NJ') { fields['Delivery State'] = 'New Jersey (NJ)'; fields.Zone = 'NJ'; }
  if (kv.date) fields['Delivery Date'] = kv.date;
  try { const r = await fetch(AT + BASE + '/tbli7bDbuXmjnp02M', { method: 'POST', headers: { Authorization: 'Bearer ' + atoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields, typecast: true }) }); const jj = await r.json(); return jj.id || ''; } catch (e) { return ''; }
}
async function waAsk(hist, userText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return 'Thanks for messaging Pampa Meats. A team member will reply shortly.';
  const msgs = hist.concat([{ role: 'user', content: userText }]);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: WA_SYS, messages: msgs }) });
    const jj = await r.json();
    return (jj.content && jj.content[0] && jj.content[0].text) || 'Sorry, could you say that again?';
  } catch (e) { return 'Sorry, something went wrong. A team member will follow up.'; }
}
async function waIncoming(req) {
  const atoken = process.env.AIRTABLE_TOKEN;
  let body = {};
  try { body = await req.json(); } catch (e) {}
  try {
    const entry = (body.entry && body.entry[0]) || {};
    const change = (entry.changes && entry.changes[0]) || {};
    const value = change.value || {};
    const msg = (value.messages && value.messages[0]) || null;
    if (msg && msg.type === 'text' && msg.from) {
      const phone = msg.from, text = (msg.text && msg.text.body) || '';
      const H = await waHistory(atoken, phone);
      let reply = await waAsk(H.hist, text);
      const ob = waBlock(reply, '[ORDER]', '[/ORDER]');
      const cb = waBlock(reply, '[CALLBACK]', '[/CALLBACK]');
      if (ob) await waCreateOrder(atoken, phone, waParseKV(ob));
      if (cb) { const office = process.env.WA_OFFICE; if (office) { const kv = waParseKV(cb); await waSend(office, 'Callback request from ' + phone + '. Please call the customer (preferably Ilia). ' + (kv.reason || '')); } }
      reply = waStrip(reply, '[ORDER]', '[/ORDER]');
      reply = waStrip(reply, '[CALLBACK]', '[/CALLBACK]');
      reply = reply.trim() || 'Got it. Our team will follow up shortly.';
      await waSend(phone, reply);
      const nh = H.hist.concat([{ role: 'user', content: text }, { role: 'assistant', content: reply }]);
      await waSaveHistory(atoken, phone, H.id, nh, text);
    }
  } catch (e) {}
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export default async function middleware(req) {
  const pathname = new URL(req.url).pathname;
  const key = process.env.DASH_PASS;
  const atoken = process.env.AIRTABLE_TOKEN;

  if (pathname === '/api/order-create' || pathname === '/api/daily-digest') return;

  if (pathname === '/api/wa-webhook') { if (req.method === 'GET') return waVerify(req); if (req.method === 'POST') return waIncoming(req); }

  if (pathname === '/api/pay-authorize' && req.method === 'POST') return handlePayAuthorize(req);

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
    if (pathname === '/api/pay-collect' && req.method === 'POST') return handlePayCollect(req);
    return;
  }

  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return Response.redirect(new URL('/login', req.url), 302);
}
