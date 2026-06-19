// Pampa Meats — vendors (suppliers) list + create. PROTECTED by middleware (Basic Auth / DASH_PASS).
// GET  -> list vendors from the Suppliers table.
// POST -> create a vendor { name, email, phone, notes }.
// Requires env var AIRTABLE_TOKEN with data.records:write scope.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbl942qKjQMWaf1Kw';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }
  const auth = { Authorization: `Bearer ${token}` };

  if (req.method === 'GET') {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status }); return; }
      const vendors = (data.records || []).map(rec => {
        const f = rec.fields || {};
        return {
          id: rec.id,
          name: f['Name'] || '',
          email: f['Email'] || '',
          phone: f['Phone'] || '',
          notes: f['Notes'] || '',
          picanha: Number(f['Picanha stock']) || 0,
          topSirloin: Number(f['Top Sirloin stock']) || 0,
          nyStrip: Number(f['New York Strip stock']) || 0,
          tenderloin: Number(f['Tenderloin / Filet stock']) || 0
        };
      });
      res.status(200).json({ ok: true, vendors });
    } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const name = String(body.name || '').trim();
    if (!name) { res.status(400).json({ ok: false, reason: 'missing_name' }); return; }
    const fields = { 'Name': name };
    if (body.email) fields['Email'] = String(body.email).trim();
    if (body.phone) fields['Phone'] = String(body.phone).trim();
    if (body.notes) fields['Notes'] = String(body.notes).trim();
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields }], typecast: true })
      });
      const data = await r.json();
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
      res.status(200).json({ ok: true, id: (data.records && data.records[0] && data.records[0].id) || '' });
    } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
    return;
  }

  res.status(405).json({ ok: false, reason: 'method_not_allowed' });
}
