// Pampa Meats — partner intake (create order). PROTECTED by middleware (Basic Auth / DASH_PASS).
// Used by the internal partner order-entry page (/dashboard/intake) to log orders taken offline
// (phone / WhatsApp / in person) from friends who did not order through the website.
// Requires env var AIRTABLE_TOKEN with data.records:write scope.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method_not_allowed' }); return; }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const name = String(body.name || '').trim();
  if (!name) { res.status(400).json({ ok: false, reason: 'missing_name' }); return; }

  const num = (v) => { const n = Number(v); return isNaN(n) || n < 0 ? 0 : n; };
  const picanha = num(body.picanha);
  const topSirloin = num(body.topSirloin);
  const nyStrip = num(body.nyStrip);
  const tenderloin = num(body.tenderloin);
  if (picanha + topSirloin + nyStrip + tenderloin <= 0) {
    res.status(400).json({ ok: false, reason: 'no_cuts' }); return;
  }

  const fields = {
    'Name': name,
    'Status': 'New',
    'Source': 'Partner intake'
  };
  if (body.takenBy) fields['Taken By'] = String(body.takenBy);
  if (body.phone) fields['Phone'] = String(body.phone).trim();
  if (body.email) fields['Email'] = String(body.email).trim();
  if (body.address) fields['Address'] = String(body.address).trim();
  if (body.zone) fields['Zone'] = String(body.zone).trim();
  if (body.deliveryState) fields['Delivery State'] = String(body.deliveryState).trim();
  if (body.deliveryDate) fields['Delivery Date'] = String(body.deliveryDate).trim();
  if (body.notes) fields['Notes'] = String(body.notes).trim();
  if (picanha) fields['Picanha'] = picanha;
  if (topSirloin) fields['Top Sirloin'] = topSirloin;
  if (nyStrip) fields['Striploin'] = nyStrip;
  if (tenderloin) fields['Tenderloin'] = tenderloin;
  if (body.estTotal != null && body.estTotal !== '') fields['Estimated Total'] = Number(body.estTotal) || 0;

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    const data = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
    const id = (data.records && data.records[0] && data.records[0].id) || '';
    res.status(200).json({ ok: true, id });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
