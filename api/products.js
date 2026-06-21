// Pampa Meats — products (cut master) list. PROTECTED by middleware (Basic Auth / DASH_PASS).
// GET -> list products (cuts) with SKU, UPC, item#, lot, case/pkg weights.
// Requires env var AIRTABLE_TOKEN.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tblp3S8Up7nOhbLsD';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }
  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100`, { headers: { Authorization: `Bearer ${token}` } });
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
        active: !!f['Active']
      };
    });
    res.status(200).json({ ok: true, products });
  } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
}
