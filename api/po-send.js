// Pampa Meats â send a Purchase Order to the supplier from the OFFICIAL domain email.
// PROTECTED by middleware (Basic Auth / DASH_PASS). NEVER uses a personal Gmail.
// Sends via Resend from purchasing@pampameats.com once the domain is verified (env RESEND_API_KEY).
// Until RESEND_API_KEY is set, returns {ok:false, reason:'email_not_configured'} so the UI can
// fall back to copy/print + WhatsApp.

const FROM = 'Pampa Meats Purchasing <purchasing@pampameats.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method_not_allowed' }); return; }

  const key = process.env.RESEND_API_KEY;
  if (!key) { res.status(200).json({ ok: false, reason: 'email_not_configured' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const to = String(body.to || '').trim();
  const subject = String(body.subject || 'Pampa Meats â Purchase Order').trim();
  const html = String(body.html || '').trim();
  const text = String(body.text || '').trim();
  if (!to || !/^[^@ ]+@[^@ ]+[.][^@ ]+$/.test(to)) { res.status(400).json({ ok: false, reason: 'bad_recipient' }); return; }
  if (!html && !text) { res.status(400).json({ ok: false, reason: 'empty_body' }); return; }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html: html || undefined, text: text || undefined })
    });
    const data = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, reason: 'resend_' + r.status, detail: data }); return; }
    res.status(200).json({ ok: true, id: data.id || '' });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
