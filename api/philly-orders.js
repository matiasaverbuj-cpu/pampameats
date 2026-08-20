// Pampa Meats - Philadelphia dealer feed (read-only). Returns ONLY Philadelphia orders.
// Used by the dealer portal (/dashboard/philly) so Jack sees only his Philly orders.
const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token', orders: [] }); return; }
  try {
    let records = [], offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);
      const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, orders: [] }); return; }
      const data = await r.json();
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    function selName(v){ return v && typeof v === 'object' ? (v.name || '') : (v || ''); }
    function isPhilly(f){
      var z = String(f['Zone'] || '').toLowerCase();
      var ds = String(selName(f['Delivery State'])).toLowerCase();
      return z.indexOf('phil') > -1 || ds.indexOf('phil') > -1;
    }

    const orders = records.filter(function(rec){
      var f = rec.fields || {};
      if (String(selName(f['Status'])).toLowerCase() === 'cancelled') return false;
      return isPhilly(f);
    }).map(function(rec){
      var f = rec.fields || {};
      return {
        id: rec.id,
        name: f['Name'] || '',
        status: selName(f['Status']),
        phone: f['Phone'] || '',
        address: f['Address'] || '',
        picanha: Number(f['Picanha']) || 0,
        topSirloin: Number(f['Top Sirloin']) || 0,
        nyStrip: Number(f['Striploin']) || 0,
        tenderloin: Number(f['Tenderloin']) || 0,
        units: Number(f['Units (packages)']) || 0,
        date: f['Order Date'] || rec.createdTime,
        deliveryDate: f['Delivery Date'] || '',
        deliveryStatus: f['Delivery Status'] || '',
        notes: f['Notes'] || ''
      };
    });

    res.status(200).json({ ok: true, count: orders.length, orders: orders });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e), orders: [] });
  }
}
