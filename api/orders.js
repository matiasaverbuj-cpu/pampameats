// Pampa Meats — live orders API (read-only). Vercel serverless function.
// Reads the Airtable Orders table server-side so the token is never exposed to the browser.
// Requires env var AIRTABLE_TOKEN (a read-only Airtable Personal Access Token scoped to this base).

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(200).json({ ok: false, reason: 'missing_token', orders: [] });
    return;
  }

  try {
    let records = [];
    let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`);
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);
      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        res.status(200).json({ ok: false, reason: 'airtable_' + r.status, orders: [] });
        return;
      }
      const data = await r.json();
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    const orders = records.filter(rec => String((rec.fields && rec.fields['Status']) || '').toLowerCase() !== 'cancelled').map(rec => {
      const f = rec.fields || {};
      return {
        id: rec.id,
        name: f['Name'] || '',
        status: f['Status'] || '',
        phone: f['Phone'] || '',
        email: f['Email'] || '',
        address: f['Address'] || '',
        picanha: Number(f['Picanha']) || 0,
        topSirloin: Number(f['Top Sirloin']) || 0,
        nyStrip: Number(f['Striploin']) || 0,
        tenderloin: Number(f['Tenderloin']) || 0,
        units: Number(f['Units (packages)']) || 0,
        zone: f['Zone'] || '',
        total: Number(f['Order Total']) || 0,
        date: f['Order Date'] || rec.createdTime,
        amountPaid: Number(f['Amount Paid']) || 0,
        balance: Number(f['Balance']) || 0,
        payStatus: f['Payment Status'] || '',
        delivered: !!f['Delivered'],
        deliveryStatus: f['Delivery Status'] || '',
        deliveryDate: f['Delivery Date'] || '',
        courier: f['Courier'] || '',
        tracking: f['Tracking'] || '',
        csNotes: f['CS Notes'] || ''
      };
    });

    res.status(200).json({ ok: true, count: orders.length, orders });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
