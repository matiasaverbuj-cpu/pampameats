// Pampa Meats — Business Expenses (per partner). PROTECTED by middleware (Basic Auth / DASH_PASS).
// GET  -> list expenses.
// POST -> create an expense { partner, category, amount, date, expense, notes }.
// Requires env var AIRTABLE_TOKEN with data.records:write scope.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tblDSgTEyRHmiRIfX';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }
  const auth = { Authorization: `Bearer ${token}` };

  if (req.method === 'GET') {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?pageSize=100`, { headers: auth });
      const data = await r.json();
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status }); return; }
      const expenses = (data.records || []).map(rec => {
        const f = rec.fields || {};
        return {
          id: rec.id,
          expense: f['Expense'] || '',
          partner: f['Partner'] || '',
          category: f['Category'] || '',
          amount: Number(f['Amount']) || 0,
          date: f['Date'] || '',
          notes: f['Notes'] || ''
        };
      });
      res.status(200).json({ ok: true, expenses });
    } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const amount = Number(body.amount) || 0;
    if (!(amount > 0)) { res.status(400).json({ ok: false, reason: 'bad_amount' }); return; }
    const fields = {
      'Expense': String(body.expense || body.category || 'Expense').trim(),
      'Amount': amount,
      'Date': body.date ? String(body.date) : new Date().toISOString().slice(0, 10)
    };
    if (body.partner) fields['Partner'] = String(body.partner);
    if (body.category) fields['Category'] = String(body.category);
    if (body.notes) fields['Notes'] = String(body.notes).trim();
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
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
