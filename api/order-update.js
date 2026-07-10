// Pampa Meats — update order (PATCH). PROTECTED by middleware (Basic Auth / DASH_PASS).
// Used by the internal quote/invoice tool to write price, payment and status back to an order.
// Requires env var AIRTABLE_TOKEN with write scope.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method_not_allowed' }); return; }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (body.action === 'interaction_add' || body.action === 'interaction_list') {
    const INT = 'tbl4Dy1vFJw8OJ8Zi';
    const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    try {
      if (body.action === 'interaction_list') {
        const key = String(body.customer || '').trim();
        const formula = encodeURIComponent("{CustomerKey}='" + key.replace(/'/g, '') + "'");
        const u = 'https://api.airtable.com/v0/' + BASE + '/' + INT + '?filterByFormula=' + formula + '&pageSize=50&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc';
        const rr = await fetch(u, { headers: auth });
        const dd = await rr.json();
        const items = (dd.records || []).map(function (rec) { return { id: rec.id, date: rec.fields.Date || '', channel: rec.fields.Channel || '', note: rec.fields.Note || '', by: rec.fields.By || '' }; });
        res.status(200).json({ ok: true, items: items });
        return;
      }
      const key = String(body.customer || '').trim();
      const channel = String(body.channel || 'Note').trim();
      const note = String(body.note || '').trim();
      const by = String(body.by || '').trim();
      const today = new Date().toISOString().slice(0, 10);
      const payload = { fields: { Summary: channel + ' - ' + today, CustomerKey: key, Date: today, Channel: channel, Note: note, By: by }, typecast: true };
      const rr = await fetch('https://api.airtable.com/v0/' + BASE + '/' + INT, { method: 'POST', headers: auth, body: JSON.stringify(payload) });
      const dd = await rr.json();
      res.status(200).json({ ok: !!dd.id, id: dd.id || null });
      return;
    } catch (e) {
      res.status(200).json({ ok: false, reason: String(e) });
      return;
    }
  }


  const id = String(body.id || '').trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) { res.status(400).json({ ok: false, reason: 'bad_id' }); return; }

  const fields = {};
  if (body.orderTotal != null && body.orderTotal !== '') fields['Order Total'] = Number(body.orderTotal) || 0;
  if (body.amountPaid != null && body.amountPaid !== '') fields['Amount Paid'] = Number(body.amountPaid) || 0;
  if (body.paymentMethod) fields['Payment Method'] = String(body.paymentMethod);
  if (body.paidDate) fields['Paid Date'] = String(body.paidDate);
  if (body.status) fields['Status'] = String(body.status);

  if (Object.keys(fields).length === 0) { res.status(400).json({ ok: false, reason: 'no_fields' }); return; }

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    const data = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
    res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
