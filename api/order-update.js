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
