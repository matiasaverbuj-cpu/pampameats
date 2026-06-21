// Pampa Meats — Accounts Payable (vendor bills). PROTECTED by middleware (Basic Auth / DASH_PASS).
// GET  -> list bills.
// POST -> create a bill, or update one ({id, ...}) e.g. mark paid.
// Requires env var AIRTABLE_TOKEN with data.records:write scope.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tblJX0e2VyUS2cBNM';
const ROSENBLATT_ID = 'recqf7yKGuHgbyPwc';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }
  const auth = { Authorization: `Bearer ${token}` };

  if (req.method === 'GET') {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status }); return; }
      const bills = (data.records || []).map(rec => {
        const f = rec.fields || {};
        const amount = Number(f['Amount']) || 0;
        const paid = Number(f['Amount Paid']) || 0;
        return {
          id: rec.id,
          billNum: f['Bill #'] || '',
          invoiceNum: f['Invoice #'] || '',
          invoiceDate: f['Invoice Date'] || '',
          dueDate: f['Due Date'] || '',
          amount: amount,
          paid: paid,
          balance: Math.round((amount - paid) * 100) / 100,
          status: f['Status'] || 'Unpaid',
          paidDate: f['Paid Date'] || '',
          notes: f['Notes'] || ''
        };
      });
      res.status(200).json({ ok: true, bills });
    } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    // Update (e.g. mark paid)
    if (body.id) {
      const fields = {};
      if (body.amountPaid != null && body.amountPaid !== '') fields['Amount Paid'] = Number(body.amountPaid) || 0;
      if (body.status) fields['Status'] = String(body.status);
      if (body.paidDate) fields['Paid Date'] = String(body.paidDate);
      if (Object.keys(fields).length === 0) { res.status(400).json({ ok: false, reason: 'no_fields' }); return; }
      try {
        const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}/${body.id}`, {
          method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields, typecast: true })
        });
        const data = await r.json();
        if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
        res.status(200).json({ ok: true, id: data.id });
      } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
      return;
    }

    // Create
    const amount = Number(body.amount) || 0;
    const now = new Date().toISOString().slice(0, 10);
    const billNum = body.billNum || ('BILL-' + now.replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase());
    const fields = {
      'Bill #': billNum,
      'Vendor': [ROSENBLATT_ID],
      'Amount': amount,
      'Status': 'Unpaid'
    };
    if (body.invoiceNum) fields['Invoice #'] = String(body.invoiceNum).trim();
    if (body.invoiceDate) fields['Invoice Date'] = String(body.invoiceDate);
    if (body.dueDate) fields['Due Date'] = String(body.dueDate);
    if (body.notes) fields['Notes'] = String(body.notes).trim();
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields }], typecast: true })
      });
      const data = await r.json();
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
      res.status(200).json({ ok: true, id: (data.records && data.records[0] && data.records[0].id) || '', billNum });
    } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
    return;
  }

  res.status(405).json({ ok: false, reason: 'method_not_allowed' });
}
