// Pampa Meats — create order endpoint (PUBLIC POST). Vercel serverless function.
// Writes a new record to the Airtable Orders table so orders flow into the same
// Business OS (dashboard + daily email) as the old Tally form.
// Requires env var AIRTABLE_TOKEN with WRITE scope (data.records:write) on this base.

const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';
const JACK = { name: 'Jack', email: 'info@levincompany.com', wa: '16102036175' };
const PHILLY_NOTIFY = (process.env.ORDER_NOTIFY_TO ? process.env.ORDER_NOTIFY_TO.split(',').map(function(s){ return s.trim(); }).filter(Boolean) : [JACK.email, 'orders@pampameats.com', 'matias.averbuj@gmail.com']);
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method_not_allowed' }); return; }

  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // Honeypot: real users never fill the hidden 'hp' field. Bots do.
  // Pretend success so the bot moves on, but write nothing.
  if (String(body.hp || '').trim()) { res.status(200).json({ ok: true, id: 'skipped' }); return; }

  const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 120);
  const address = clean(body.address, 300);
  const stateRaw = clean(body.state, 8).toUpperCase();
  const deliveryDate = clean(body.deliveryDate, 30);
  let notes = clean(body.notes, 2000);

  const q = body.qty || {};
  const num = v => Math.max(0, Math.min(999, parseInt(v, 10) || 0));
  const picanha = num(q.picanha), topSirloin = num(q.topSirloin), nyStrip = num(q.nyStrip), tenderloin = num(q.tenderloin);

  if (!name || !phone) { res.status(400).json({ ok: false, reason: 'missing_contact' }); return; }
  if ((picanha + topSirloin + nyStrip + tenderloin) <= 0) { res.status(400).json({ ok: false, reason: 'empty_order' }); return; }

  const stateName = stateRaw === 'NJ' ? 'New Jersey (NJ)' : (stateRaw === 'NY' ? 'New York (NY)' : ((stateRaw === 'PHL' || stateRaw === 'PHILLY' || stateRaw.indexOf('PHL') === 0) ? 'Philadelphia (PA)' : ''));
  const isPhilly = (stateRaw === 'PHL' || stateRaw === 'PHILLY' || stateRaw.indexOf('PHL') === 0);
  const zone = (stateRaw === 'NJ' || stateRaw === 'NY') ? stateRaw : (isPhilly ? 'Philadelphia' : '');
  if (isPhilly) { if (!stateName) { /* set below */ } notes = ('[DEALER: Jack - Philadelphia. Customer pays in-store.] ' + notes).slice(0, 2000); }

  const fields = {
    'Name': name,
    'Phone': phone,
    'Picanha': picanha,
    'Top Sirloin': topSirloin,
    'Striploin': nyStrip,
    'Tenderloin': tenderloin,
    'Address': address,
    'Notes': notes,
    'Status': 'New'
  };
  if (email) fields['Email'] = email;
  if (stateName) fields['Delivery State'] = stateName;
  if (zone) fields['Zone'] = zone;
  if (deliveryDate) fields['Delivery Date'] = deliveryDate;

  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true })
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null });
      return;
    }
    try {
      var rk = process.env.RESEND_API_KEY;
      if (rk) {
        var ref = "PM-" + String(data.id || "").slice(-5).toUpperCase();
        var rows = [picanha?("Picanha &times; "+picanha):"", topSirloin?("Top Sirloin &times; "+topSirloin):"", nyStrip?("New York Strip &times; "+nyStrip):"", tenderloin?("Tenderloin / Filet &times; "+tenderloin):""].filter(Boolean).map(function(x){ return "<tr><td style='padding:7px 0;border-bottom:1px solid #eee;color:#333;font-size:14px'>"+x+"</td></tr>"; }).join("");
        var cutList = [picanha?("Picanha x"+picanha):"", topSirloin?("Top Sirloin x"+topSirloin):"", nyStrip?("NY Strip x"+nyStrip):"", tenderloin?("Tenderloin x"+tenderloin):""].filter(Boolean).join(", ");
        var team = ["natebuchs@gmail.com","janbuchsbaum@gmail.com","jaybuchsbaum@gmail.com","Markmtb@mac.com","mbuchsbaum@klagroupinc.com","m@kedem-la.com"];
        var teamHtml = "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#f0ede8;padding:24px'><tr><td align='center'><table role='presentation' width='600' cellpadding='0' cellspacing='0' style='max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif;background:#fff;border-radius:10px;overflow:hidden'><tr><td bgcolor='#0A0A0A' style='padding:24px 30px'><div style='color:#C9A55C;font-size:20px;letter-spacing:4px;font-weight:bold'>PAMPA MEATS</div><div style='color:#8A7548;font-size:11px;letter-spacing:2px;margin-top:5px'>NEW ORDER &middot; PRO FORMA</div></td></tr><tr><td style='padding:24px 30px 6px;color:#0A0A0A;font-size:20px;font-weight:bold'>Order "+ref+"</td></tr><tr><td style='padding:0 30px 6px;color:#333;font-size:14px;line-height:1.8'><b>Customer:</b> "+name+"<br><b>Phone:</b> "+phone+"<br><b>Email:</b> "+(email||"-")+"<br><b>Deliver to:</b> "+(address||"-")+" ("+stateRaw+")<br><b>Preferred date:</b> "+(deliveryDate||"-")+"</td></tr><tr><td style='padding:10px 30px 0'><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-top:2px solid #C9A55C'>"+rows+"</table></td></tr><tr><td style='padding:10px 30px 0;color:#555;font-size:13px'><b>Notes:</b> "+(notes||"-")+"</td></tr><tr><td style='padding:14px 30px 22px'><table role='presentation' width='100%'><tr><td bgcolor='#fff8ed' style='border-left:4px solid #C9A55C;padding:12px 16px;color:#3a2f1a;font-size:12.5px;line-height:1.5'>Pro forma only. The final invoice is issued after the exact weight is confirmed.</td></tr></table></td></tr><tr><td bgcolor='#0A0A0A' style='padding:16px 30px;color:#8A7548;font-size:10px;letter-spacing:1px'>PAMPA MEATS &middot; INTERNAL ORDER ALERT</td></tr></table></td></tr></table>";
        await fetch("https://api.resend.com/emails", { method:"POST", headers:{ Authorization:("Bearer "+rk), "Content-Type":"application/json" }, body: JSON.stringify({ from:"Pampa Meats <reports@pampameats.com>", to: team, subject:("New order (proforma) "+ref+" - "+name), html: teamHtml, text:("Pro forma "+ref+" - "+name+" - "+phone+" - "+stateRaw+" - "+(cutList||"no cuts")) }) });
        if (email) {
          var fn = (name.split(" ")[0] || "friend");
          var custHtml = "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#f0ede8;padding:24px'><tr><td align='center'><table role='presentation' width='600' cellpadding='0' cellspacing='0' style='max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif;background:#fff;border-radius:10px;overflow:hidden'><tr><td bgcolor='#0A0A0A' style='padding:26px 30px'><div style='color:#C9A55C;font-size:22px;letter-spacing:4px;font-weight:bold'>PAMPA MEATS</div><div style='color:#8A7548;font-size:11px;letter-spacing:2px;margin-top:5px'>ORDER CONFIRMATION</div></td></tr><tr><td style='padding:28px 30px;color:#222;font-size:15px;line-height:1.6'>Thank you, "+fn+" &mdash; we have received your order.<br><br><b style='color:#0A0A0A'>Order "+ref+"</b></td></tr><tr><td style='padding:0 30px'><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-top:2px solid #C9A55C'>"+rows+"</table></td></tr><tr><td style='padding:18px 30px;color:#555;font-size:13.5px;line-height:1.7'>Delivery to: "+(address||"-")+" ("+stateRaw+")<br>Preferred date: "+(deliveryDate||"to be confirmed")+"</td></tr><tr><td style='padding:6px 30px 22px'><table role='presentation' width='100%'><tr><td bgcolor='#fff8ed' style='border-left:4px solid #C9A55C;padding:14px 16px;color:#3a2f1a;font-size:13px;line-height:1.6'>This is a confirmation of your order, not a final invoice. Because every cut is sold by exact weight, our team will confirm the final weight, total and payment with you shortly.</td></tr></table></td></tr><tr><td bgcolor='#0A0A0A' style='padding:20px 30px;color:#C9A55C;font-size:12px;line-height:1.6'>Questions? Just reply to this email.<br><span style='color:#8A7548;font-size:10px;letter-spacing:1px'>PAMPA MEATS &middot; PREMIUM ARGENTINE ANGUS &middot; NY &amp; NJ</span></td></tr></table></td></tr></table>";
          await fetch("https://api.resend.com/emails", { method:"POST", headers:{ Authorization:("Bearer "+rk), "Content-Type":"application/json" }, body: JSON.stringify({ from:"Pampa Meats <reports@pampameats.com>", to:[email], reply_to:"customerservice@pampameats.com", subject:("Your Pampa Meats order "+ref), html: custHtml }) });
        }
      }
    } catch(e){}
    if (isPhilly) { try { await notifyJack({ name: name, phone: phone, email: email, address: address, deliveryDate: deliveryDate, notes: clean(body.notes, 2000), picanha: picanha, topSirloin: topSirloin, nyStrip: nyStrip, tenderloin: tenderloin }); } catch (e2) {} }
    res.status(200).json({ ok: true, id: data.id });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e) });
  }
}

function cutLines(o){ var p=[]; if(o.picanha)p.push(o.picanha+'x Picanha'); if(o.topSirloin)p.push(o.topSirloin+'x Top Sirloin'); if(o.nyStrip)p.push(o.nyStrip+'x NY Strip'); if(o.tenderloin)p.push(o.tenderloin+'x Tenderloin'); return p; }
async function notifyJack(o){
  var resendKey = process.env.RESEND_API_KEY; if(!resendKey) return;
  var cuts = cutLines(o);
  var lines = [o.name + ' - ' + o.phone].concat(cuts);
  if(o.address) lines.push('Address: ' + o.address);
  if(o.deliveryDate) lines.push('Delivery: ' + o.deliveryDate);
  if(o.notes) lines.push('Notes: ' + o.notes);
  lines.push('Customer pays in-store.');
  var waText = 'New Philadelphia order (Pampa):\n' + lines.join('\n');
  var waHref = 'https://wa.me/' + JACK.wa + '?text=' + encodeURIComponent(waText);
  var rowsHtml = cuts.map(function(c){ return '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">' + esc(c) + '</td></tr>'; }).join('');
  var infoHtml = lines.slice(0, lines.length-1).map(function(l){ return '<div style="padding:3px 0;color:#2b2b2b;">' + esc(l) + '</div>'; }).join('');
  var html = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#f0ede8;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">'
    + '<tr><td bgcolor="#1a1a2e" style="padding:18px 22px;"><div style="color:#f5a623;font-size:11px;letter-spacing:2px;font-weight:bold;">PAMPA KOSHER MEATS - PHILADELPHIA</div><div style="color:#ffffff;font-size:20px;font-weight:bold;margin-top:4px;">New Philadelphia order</div></td></tr>'
    + '<tr><td bgcolor="#ffffff" style="padding:16px 22px;">'
    + '<div style="border-left:4px solid #f5a623;background:#fff8ed;padding:9px 13px;border-radius:4px;color:#7a5a1e;font-size:13px;">Philadelphia dealer channel (Jack). Customer pays in-store - no online payment.</div>'
    + '<div style="margin-top:12px;font-size:14px;">' + infoHtml + '</div>'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px;color:#2b2b2b;border:1px solid #eee;border-radius:6px;">' + rowsHtml + '</table>'
    + '<div style="text-align:center;margin-top:16px;"><a href="' + waHref + '" style="display:inline-block;background:#25D366;color:#062d16;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:8px;font-size:15px;">Send this order to Jack on WhatsApp</a></div>'
    + '</td></tr></table></div>';
  await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Pampa Meats <reports@pampameats.com>', to: PHILLY_NOTIFY, subject: 'New Philadelphia order - ' + o.name, html: html, text: waText }) });
}

