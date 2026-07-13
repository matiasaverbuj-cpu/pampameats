// Pampa Meats — Daily Brief. Runs via Vercel Cron (07:00 Panama = 12:00 UTC).
// Reads Airtable directly, builds an HTML email, sends via Resend from reports@pampameats.com.
// Protected by CRON_SECRET (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
// Manual test: GET /api/daily-digest?key=<CRON_SECRET>
// Env: AIRTABLE_TOKEN, RESEND_API_KEY, CRON_SECRET. Optional: DIGEST_TO (comma-separated recipients).

const BASE = 'app1muH8br0JSsvOa';
const T_ORDERS = 'tbli7bDbuXmjnp02M';
const T_BILLS  = 'tblJX0e2VyUS2cBNM';
const T_EXP    = 'tblDSgTEyRHmiRIfX';
const T_PROD   = 'tblp3S8Up7nOhbLsD';

// First runs go to Mati only to validate the format. Add partners later (or set DIGEST_TO env).
const DEFAULT_TO = ['matias.averbuj@gmail.com', 'natebuchs@gmail.com', 'jaybuchsbaum@gmail.com', 'janbuchsbaum@gmail.com', 'Markmtb@mac.com'];
// Partners (ready to enable): jaybuchsbaum@gmail.com, janbuchsbaum@gmail.com, Markmtb@mac.com

async function atFetch(table, token) {
  let records = [], offset = '';
  do {
    const url = `https://api.airtable.com/v0/${BASE}/${table}?pageSize=100` + (offset ? `&offset=${offset}` : '');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (!r.ok) throw new Error('airtable_' + r.status);
    records = records.concat(d.records || []);
    offset = d.offset || '';
  } while (offset);
  return records;
}

const money = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;
  const secret = process.env.CRON_SECRET;

  // Auth: allow Vercel Cron (Bearer) or manual ?key=
  if (secret) {
    const auth = req.headers.authorization || '';
    const key = (req.query && req.query.key) || '';
    if (auth !== `Bearer ${secret}` && key !== secret) {
      res.status(401).json({ ok: false, reason: 'unauthorized' }); return;
    }
  }
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_airtable_token' }); return; }

  try {
    const [orders, bills, exps, prods] = await Promise.all([
      atFetch(T_ORDERS, token), atFetch(T_BILLS, token), atFetch(T_EXP, token), atFetch(T_PROD, token)
    ]);

    const now = Date.now();
    let revenue = 0, collected = 0, outstanding = 0, new24 = 0, new24val = 0, cogs = 0;
    const CUTS = [{q:'Picanha',cost:19,sell:42.99,w:2.5},{q:'Top Sirloin',cost:21.50,sell:26.99,w:5},{q:'Striploin',cost:21.50,sell:39.99,w:6.5},{q:'Tenderloin',cost:23,sell:59.99,w:2.5}];
    orders.forEach(rec => {
      const f = rec.fields || {};
      const nm = String(f['Name'] || '').trim();
      const total = Number(f['Order Total']) || 0;
      if (/test/i.test(nm) || (!nm && total === 0)) return; // skip test / empty rows
      if (/cancel/i.test(String(f['Status']||''))) return; // skip Cancelled orders
      const paid = Number(f['Amount Paid']) || 0;
      const bal = (f['Balance'] != null) ? Number(f['Balance']) : (total - paid);
      revenue += total; collected += paid; outstanding += Math.max(0, bal);
      { let _cw=0,_sw=0; CUTS.forEach(c=>{const q=Number(f[c.q])||0;_cw+=q*c.w*c.cost;_sw+=q*c.w*c.sell;}); cogs += _sw>0 ? total*(_cw/_sw) : total*0.55; }
      if (rec.createdTime && (now - new Date(rec.createdTime).getTime()) <= 24 * 3600 * 1000) { new24++; new24val += total; }
    });

    let apOutstanding = 0, apUnpaid = 0;
    bills.forEach(rec => {
      const f = rec.fields || {};
      const amt = Number(f['Amount']) || 0;
      const paid = Number(f['Amount Paid']) || 0;
      const status = f['Status'] || 'Unpaid';
      if (status !== 'Paid') { apOutstanding += Math.max(0, amt - paid); apUnpaid++; }
    });

    let expenses = 0;
    exps.forEach(rec => { expenses += Number((rec.fields || {})['Amount']) || 0; });

    const gp = revenue - cogs;
    const net = gp - expenses;
    const gpM = revenue > 0 ? Math.round(gp / revenue * 1000) / 10 : 0;

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Panama' });

    const kpi = (label, val, accent) =>
      `<td width="50%" style="padding:6px"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td bgcolor="#121212" style="border-left:3px solid ${accent || '#C9A55C'};border-radius:8px;padding:14px 16px;font-family:Arial,sans-serif">` +
      `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8A7548">${label}</div>` +
      `<div style="font-size:24px;color:#F5EFE5;margin-top:4px;font-weight:600">${val}</div></td></tr></table></td>`;

    const html =
`<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0A0A0A">
<tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px">
<tr><td bgcolor="#1a1a2e" style="border-radius:12px 12px 0 0;padding:22px 24px;font-family:Arial,sans-serif">
<div style="font-size:18px;font-weight:bold;letter-spacing:3px;color:#C9A55C">PAMPA MEATS</div>
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8A7548;margin-top:3px">Daily Brief &middot; ${today}</div>
</td></tr>
<tr><td bgcolor="#0E0E0E" style="padding:14px 18px">
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr>${kpi('New orders (24h)', new24 + ' &middot; ' + money(new24val), '#8AF0A8')}${kpi('Revenue (invoiced)', money(revenue))}</tr>
<tr>${kpi('Collected', money(collected), '#8AF0A8')}${kpi('Outstanding (A/R)', money(outstanding), '#E9A8A2')}</tr>
<tr>${kpi('A/P to pay', money(apOutstanding) + ' &middot; ' + apUnpaid + ' bill' + (apUnpaid === 1 ? '' : 's'), '#E9A8A2')}${kpi('Gross profit', money(gp) + ' &middot; ' + gpM + '%')}</tr>
<tr>${kpi('Operating expenses', money(expenses))}${kpi('Net profit', money(net), net >= 0 ? '#8AF0A8' : '#E9A8A2')}</tr>
</table>
</td></tr>
<tr><td bgcolor="#1a1a2e" style="border-radius:0 0 12px 12px;padding:16px 24px;font-family:Arial,sans-serif;text-align:center">
<a href="https://www.pampameats.com/dashboard" style="color:#C9A55C;font-size:13px;text-decoration:none;font-weight:bold">Open the backend &rarr;</a>
<div style="font-size:10px;color:#6E6347;margin-top:8px">Automated daily &middot; revenue is invoiced totals, COGS from cut costs (real margin). Operational figures.</div>
</td></tr>
</table>
</td></tr></table>`;

    const text = `Pampa Meats — Daily Brief (${today})
New orders 24h: ${new24} (${money(new24val)})
Revenue: ${money(revenue)} | Collected: ${money(collected)} | Outstanding A/R: ${money(outstanding)}
A/P to pay: ${money(apOutstanding)} (${apUnpaid} bills)
Gross profit: ${money(gp)} (${gpM}%) | Expenses: ${money(expenses)} | Net: ${money(net)}
Backend: https://www.pampameats.com/dashboard`;

    if (!resendKey) { res.status(200).json({ ok: false, reason: 'missing_resend_key', preview: text }); return; }

    const to = (process.env.DIGEST_TO ? process.env.DIGEST_TO.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_TO);

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Pampa Meats <reports@pampameats.com>', to, subject: `Pampa Meats — Daily Brief (${today})`, html, text })
    });
    const sd = await send.json();
    if (!send.ok) { res.status(200).json({ ok: false, reason: 'resend_' + send.status, detail: sd && sd.message }); return; }
    res.status(200).json({ ok: true, sent_to: to, id: sd && sd.id });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
