// Pampa Meats — products (cut master) + inventory. PROTECTED by middleware (Basic Auth / DASH_PASS).
// GET  -> list products (cuts) with SKU, UPC, item#, lot, weights, cost/price, stock.
// POST -> update inventory for a product { id, onHand, reorderAt }.
// Requires env var AIRTABLE_TOKEN.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tblp3S8Up7nOhbLsD';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }
  const auth = { Authorization: `Bearer ${token}` };

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const id = String(body.id || '').trim();
    if (!/^rec[A-Za-z0-9]{14}$/.test(id)) { res.status(400).json({ ok: false, reason: 'bad_id' }); return; }
    const fields = {};
    if (body.onHand != null && body.onHand !== '') fields['On hand (pkg)'] = Number(body.onHand) || 0;
    if (body.reorderAt != null && body.reorderAt !== '') fields['Reorder at (pkg)'] = Number(body.reorderAt) || 0;
    if (Object.keys(fields).length === 0) { res.status(400).json({ ok: false, reason: 'no_fields' }); return; }
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${id}`, {
        method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, typecast: true })
      });
      const data = await r.json();
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
      res.status(200).json({ ok: true, id: data.id });
    } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
    return;
  }

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100`, { headers: auth });
    const data = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status }); return; }
    const products = (data.records || []).map(rec => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        cut: f['Cut'] || '',
        sku: f['SKU'] || '',
        upc: f['UPC'] || '',
        item: f['Item #'] || '',
        lot: f['Lot prefix'] || '',
        alt: f['Alt name (ES)'] || '',
        bol: f['BOL description'] || '',
        caseLb: Number(f['Case avg (lb)']) || 0,
        pkgLb: Number(f['Pkg avg (lb)']) || 0,
        costLb: Number(f['Cost per lb']) || 0,
        priceLb: Number(f['Price per lb']) || 0,
        onHand: Number(f['On hand (pkg)']) || 0,
        reorderAt: Number(f['Reorder at (pkg)']) || 0,
        active: !!f['Active']
      };
    });
    res.status(200).json({ ok: true, products });
  } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
}
