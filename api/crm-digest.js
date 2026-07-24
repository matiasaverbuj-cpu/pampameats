// Pampa Meats — CRM morning digest (reorder call list). Vercel serverless function.
// Reads Airtable Orders, builds the "who to contact today" call list, sends via Resend
// from reports@pampameats.com to the CS team. Runs weekday mornings via Vercel Cron.
// Protected by CRON_SECRET (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
// Manual test: GET /api/crm-digest?key=<CRON_SECRET>
// Env: AIRTABLE_TOKEN, RESEND_API_KEY, CRON_SECRET. Optional: CRM_DIGEST_TO (comma-separated).

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';

// Field IDs (stable regardless of display-name changes)
const F = {
  name:   'fldSr8UPngvLz5e7y',
  status: 'fldjwF9AMazzAFbv3',
  phone:  'fldEABrFZXe9Ucnna',
  total:  'fldGnseAr83HDcgNY',
  units:  'fldqMAJyiZrcDzEWx',
  date:   'fldgVYOZ5FtnOpYwv',
  email:  'fld0Om9Zmhbif480B'
};

const DEFAULT_TO = ['ivillarreal@klagroupinc.com', 'matias.averbuj@gmail.com'];

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function money(n){ return '$' + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}); }
function norm(p){ return String(p||'').replace(/[^0-9]/g,'').slice(-10); }
function waNum(p){ let d=String(p||'').replace(/[^0-9]/g,''); if(d.length===10) d='1'+d; return d; }
function isTest(name){ return /test|^zz|systemcheck|e2e|borrar|\bmatias\b/i.test(String(name||'')); }
function fmtDate(s){ if(!s) return '—'; const d=new Date(s); if(isNaN(d)) return '—'; return d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}); }
function daysSince(s){ if(!s) return null; const d=new Date(s); if(isNaN(d)) return null; return Math.floor((Date.now()-d.getTime())/86400000); }
function selName(v){ return v && typeof v==='object' ? (v.name||'') : (v||''); }

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const key = (req.query && req.query.key) || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (secret && key !== secret) { res.status(401).json({ ok: false, reason: 'unauthorized' }); return; }

  const token = process.env.AIRTABLE_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;
  if (!token || !resendKey) { res.status(200).json({ ok: false, reason: 'missing_env' }); return; }

  try {
    // 1) pull all orders (fields keyed by field ID)
    let records = [], offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`);
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('returnFieldsByFieldId', 'true');
      if (offset) url.searchParams.set('offset', offset);
      const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status }); return; }
      const data = await r.json();
      records = records.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    // 2) map + filter to real, non-cancelled orders
    const orders = records.map(rec => {
      const f = rec.fields || {};
      return {
        name: f[F.name] || '',
        status: selName(f[F.status]),
        phone: f[F.phone] || '',
        total: Number(f[F.total]) || 0,
        units: Number(f[F.units]) || 0,
        date: f[F.date] || rec.createdTime,
        email: f[F.email] || ''
      };
    }).filter(o => String(o.status).toLowerCase() !== 'cancelled' && !isTest(o.name));

    // 3) aggregate by customer
    const byC = {};
    orders.forEach(o => {
      const k = norm(o.phone) || ('name:' + String(o.name).trim().toLowerCase());
      if (!byC[k]) byC[k] = { name: o.name, phone: o.phone, orders: 0, total: 0, units: 0, last: null };
      const c = byC[k];
      c.orders++; c.total += o.total; c.units += o.units;
      const d = new Date(o.date);
      if (!c.last || (!isNaN(d) && d > new Date(c.last))) c.last = o.date;
      if (o.name && o.name.length > (c.name||'').length) c.name = o.name;
      if (o.phone) c.phone = o.phone;
    });
    const custs = Object.keys(byC).map(k => byC[k]);
    custs.forEach(c => { c.days = daysSince(c.last); });

    const totalRev = orders.reduce((s,o)=>s+o.total, 0);
    const aov = orders.length ? totalRev/orders.length : 0;
    const DUE = 45;
    const dueCount = custs.filter(c => c.days != null && c.days >= DUE).length;

    // 4) call list: most overdue first, then by value
    const callList = custs.slice().sort((a,b) => {
      const da = a.days==null?-1:a.days, db = b.days==null?-1:b.days;
      if (db !== da) return db - da;
      return b.total - a.total;
    });

    const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

    // 5) build HTML (KLA style)
    const rows = callList.map((c, i) => {
      const wa = 'https://wa.me/' + waNum(c.phone) + '?text=' + encodeURIComponent('Hi ' + (String(c.name).split(' ')[0]||'') + ', this is Pampa Kosher Meats. It has been a little while since your last order — would you like us to prepare the same again for delivery this week?');
      const badge = (c.days != null && c.days >= DUE)
        ? '<span style="background:#fdecea;color:#c0392b;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:bold;">Due · ' + c.days + 'd</span>'
        : (c.days != null && c.days >= 30)
          ? '<span style="background:#fff4e5;color:#b9770e;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:bold;">Soon · ' + c.days + 'd</span>'
          : '<span style="background:#eef7f0;color:#2e7d46;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:bold;">' + (c.days!=null?c.days+'d':'—') + '</span>';
      return '<tr>'
        + '<td style="padding:9px 8px;border-bottom:1px solid #eee;color:#888;font-size:12px;">' + (i+1) + '</td>'
        + '<td style="padding:9px 8px;border-bottom:1px solid #eee;font-weight:bold;color:#1a1a2e;">' + esc(c.name) + '<br><span style="font-weight:normal;color:#888;font-size:12px;">' + esc(c.phone||'') + '</span></td>'
        + '<td style="padding:9px 8px;border-bottom:1px solid #eee;">' + badge + '</td>'
        + '<td style="padding:9px 8px;border-bottom:1px solid #eee;color:#555;font-size:13px;">' + fmtDate(c.last) + '</td>'
        + '<td style="padding:9px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:#1a1a2e;">' + money(c.total) + '</td>'
        + '<td style="padding:9px 8px;border-bottom:1px solid #eee;text-align:center;">'
          + '<a href="' + wa + '" style="background:#25D366;color:#062d16;text-decoration:none;font-weight:bold;padding:6px 12px;border-radius:6px;font-size:12px;">WhatsApp</a></td>'
        + '</tr>';
    }).join('');

    const html = ''
      + '<div style="max-width:640px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#f0ede8;padding:0;">'
      + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;">'
      + '<tr><td bgcolor="#1a1a2e" style="padding:22px 24px;">'
        + '<div style="color:#f5a623;font-size:12px;letter-spacing:2px;font-weight:bold;">PAMPA KOSHER MEATS</div>'
        + '<div style="color:#ffffff;font-size:22px;font-weight:bold;margin-top:4px;">Reorder Call List</div>'
        + '<div style="color:#b9bcc9;font-size:13px;margin-top:2px;">' + esc(today) + '</div>'
      + '</td></tr>'
      + '<tr><td bgcolor="#ffffff" style="padding:18px 24px;">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
          + '<td style="text-align:center;padding:6px;"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Customers</div><div style="font-size:22px;font-weight:bold;color:#1a1a2e;">' + custs.length + '</div></td>'
          + '<td style="text-align:center;padding:6px;"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Booked Revenue</div><div style="font-size:22px;font-weight:bold;color:#f5a623;">' + money(totalRev) + '</div></td>'
          + '<td style="text-align:center;padding:6px;"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Avg Order</div><div style="font-size:22px;font-weight:bold;color:#1a1a2e;">' + money(aov) + '</div></td>'
          + '<td style="text-align:center;padding:6px;"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Reorders Due</div><div style="font-size:22px;font-weight:bold;color:' + (dueCount?'#c0392b':'#2e7d46') + ';">' + dueCount + '</div></td>'
        + '</tr></table>'
      + '</td></tr>'
      + '<tr><td bgcolor="#ffffff" style="padding:0 24px 8px;">'
        + '<div style="border-left:4px solid #f5a623;background:#fff8ed;padding:10px 14px;border-radius:4px;color:#7a5a1e;font-size:13px;">Contact these customers today, most overdue first. Tap WhatsApp to reach them on WhatsApp Business with a ready reorder message.</div>'
      + '</td></tr>'
      + '<tr><td bgcolor="#ffffff" style="padding:12px 24px 20px;">'
        + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        + '<tr><th style="text-align:left;padding:8px;border-bottom:2px solid #1a1a2e;font-size:11px;color:#888;text-transform:uppercase;">#</th>'
          + '<th style="text-align:left;padding:8px;border-bottom:2px solid #1a1a2e;font-size:11px;color:#888;text-transform:uppercase;">Customer</th>'
          + '<th style="text-align:left;padding:8px;border-bottom:2px solid #1a1a2e;font-size:11px;color:#888;text-transform:uppercase;">Status</th>'
          + '<th style="text-align:left;padding:8px;border-bottom:2px solid #1a1a2e;font-size:11px;color:#888;text-transform:uppercase;">Last order</th>'
          + '<th style="text-align:right;padding:8px;border-bottom:2px solid #1a1a2e;font-size:11px;color:#888;text-transform:uppercase;">Lifetime</th>'
          + '<th style="padding:8px;border-bottom:2px solid #1a1a2e;"></th></tr>'
        + rows
        + '</table>'
      + '</td></tr>'
      + '<tr><td bgcolor="#1a1a2e" style="padding:16px 24px;text-align:center;">'
        + '<a href="https://pampameats.com/dashboard/crm" style="color:#f5a623;text-decoration:none;font-weight:bold;font-size:14px;">Open the Command Center →</a>'
      + '</td></tr>'
      + '<tr><td bgcolor="#1a1a2e" style="padding:0 24px 18px;text-align:center;color:#8b8fa3;font-size:11px;">Pampa Kosher Meats · CRM · sent automatically each morning</td></tr>'
      + '</table></div>';

    const text = 'Pampa Kosher Meats — Reorder Call List (' + today + ')\n\n'
      + callList.map((c,i)=> (i+1) + '. ' + c.name + ' (' + c.phone + ') — last order ' + fmtDate(c.last) + (c.days!=null?(' · ' + c.days + 'd ago'):'') + ' — ' + money(c.total)).join('\n')
      + '\n\nOpen the Command Center: https://pampameats.com/dashboard/crm';

    const to = process.env.CRM_DIGEST_TO
      ? process.env.CRM_DIGEST_TO.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_TO;

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Pampa Meats <reports@pampameats.com>', to, subject: `Pampa — Reorder Call List (${today})`, html, text })
    });
    const sd = await send.json();
    if (!send.ok) { res.status(200).json({ ok: false, reason: 'resend_' + send.status, detail: sd }); return; }

    res.status(200).json({ ok: true, sent: to, customers: custs.length, due: dueCount, id: sd.id });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}
