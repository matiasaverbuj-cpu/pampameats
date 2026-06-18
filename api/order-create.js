// Pampa Meats — create order endpoint (PUBLIC POST). Vercel serverless function.
// Writes a new record to the Airtable Orders table so orders flow into the same
// Business OS (dashboard + daily email) as the old Tally form.
// Requires env var AIRTABLE_TOKEN with WRITE scope (data.records:write) on this base.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method_not_allowed' }); return; }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // Honeypot: real users never fill the hidden 'hp' field. Bots do.
  // Pretend success so the bot moves on, but write nothing.
  if (String(body.hp || '').trim()) { res.status(200).json({ ok: true, id: 'skipped' }); return; }

  const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 120);
  const address = clean(body.address, 300);
  const stateRaw = clean(body.state, 8).toUpperCase();
  const deliveryDate = clean(body.deliveryDate, 30);
  const notes = clean(body.notes, 2000);

  const q = body.qty || {};
  const num = v => Math.max(0, Math.min(999, parseInt(v, 10) || 0));
  const picanha = num(q.picanha), topSirloin = num(q.topSirloin), nyStrip = num(q.nyStrip), tenderloin = num(q.tenderloin);

  if (!name || !phone) { res.status(400).json({ ok: false, reason: 'missing_contact' }); return; }
  if ((picanha + topSirloin + nyStrip + tenderloin) <= 0) { res.status(400).json({ ok: false, reason: 'empty_order' }); return; }

  const stateName = stateRaw === 'NJ' ? 'New Jersey (NJ)' : (stateRaw === 'NY' ? 'New York (NY)' : '');
  const zone = (stateRaw === 'NJ' || stateRaw === 'NY') ? stateRaw : '';

  const fields = {
    'Name': name,
    'Phone': phone,
    'Picanha': picanha,
    'Top Sirloin': topSirloin,
    'Striploin': nyStrip,
    'Tenderloin': tenderloin,
    'Address': address,
    'Notes': notes,
    'Status': 'New'
  };
  if (email) fields['Email'] = email;
  if (stateName) fields['Delivery State'] = stateName;
  if (zone) fields['Zone'] = zone;
  if (deliveryDate) fields['Delivery Date'] = deliveryDate;

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null });
      return;
    }
    res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
