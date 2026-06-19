// Pampa Meats — create supplier Purchase Order. PROTECTED by middleware (Basic Auth / DASH_PASS).
// Aggregates cuts from the partner/dashboard PO builder into a Purchase Orders record for Aharon.
// Requires env var AIRTABLE_TOKEN with data.records:write scope.

const BASE = 'app1muH8br0JSsvOa';
const PO_TABLE = 'tbl26Cpo8KPk6jzMa';
const AHARON_ID = 'recqf7yKGuHgbyPwc';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method_not_allowed' }); return; }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const num = (v) => { const n = Number(v); return isNaN(n) || n < 0 ? 0 : Math.round(n); };
  const picanha = num(body.picanha);
  const topSirloin = num(body.topSirloin);
  const nyStrip = num(body.nyStrip);
  const tenderloin = num(body.tenderloin);
  if (picanha + topSirloin + nyStrip + tenderloin <= 0) {
    res.status(400).json({ ok: false, reason: 'no_cuts' }); return;
  }

  const now = new Date();
  const ymd = now.toISOString().slice(0, 10);
  const poNum = 'PO-' + ymd.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

  const fields = {
    'PO #': poNum,
    'Status': body.status === 'Sent' ? 'Sent' : 'Draft',
    'Order Date': ymd,
    'Supplier': [AHARON_ID]
  };
  if (picanha) fields['Picanha'] = picanha;
  if (topSirloin) fields['Top Sirloin'] = topSirloin;
  if (nyStrip) fields['New York Strip'] = nyStrip;
  if (tenderloin) fields['Tenderloin / Filet'] = tenderloin;
  if (body.notes) fields['Notes'] = String(body.notes).trim();

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${PO_TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    const data = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
    const id = (data.records && data.records[0] && data.records[0].id) || '';
    res.status(200).json({ ok: true, id, po: poNum });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
