// Pampa Meats — order + CRM write endpoint. PROTECTED by middleware.
const BASE = 'app1muH8br0JSsvOa';
const TABLE = 'tbli7bDbuXmjnp02M';   // Orders
const INT = 'tbl4Dy1vFJw8OJ8Zi';     // Interactions
const CUST = 'tblC9Vly3bi60w52y';    // Customers
const API = 'https://api.airtable.com/v0/';

function norm(p){ return String(p||'').replace(/[^0-9]/g,'').slice(-10); }
function today(){ return new Date().toISOString().slice(0,10); }

async function findCustomer(auth, key){
  const r = await fetch(API + BASE + '/' + CUST + '?pageSize=100', { headers: auth });
  const d = await r.json();
  const recs = d.records || [];
  const k = norm(key);
  if(!k) return null;
  for (let i=0;i<recs.length;i++){ if (norm(recs[i].fields && recs[i].fields.Phone) === k) return recs[i]; }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok:false, reason:'method_not_allowed' }); return; }
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok:false, reason:'missing_token' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e){ body = {}; } }
  body = body || {};
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type':'application/json' };
  const action = body.action || '';

  if (action === 'interaction_list') {
    try {
      const key = norm(body.customer);
      const r = await fetch(API + BASE + '/' + INT + '?pageSize=100&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc', { headers: auth });
      const d = await r.json();
      const items = (d.records||[]).filter(function(rec){ return norm(rec.fields && rec.fields.CustomerKey) === key; }).map(function(rec){ var f=rec.fields||{}; return { id:rec.id, date:f.Date||'', channel:f.Channel||'', note:f.Note||'', by:f.By||'', rating:f.Rating||'', next:f['Next Contact']||'' }; });
      res.status(200).json({ ok:true, items: items });
    } catch(e){ res.status(200).json({ ok:false, reason:String(e) }); }
    return;
  }

  if (action === 'interaction_add') {
    try {
      const key = norm(body.customer);
      const channel = String(body.channel||'Note').trim();
      const note = String(body.note||'').trim();
      const by = String(body.by||'').trim();
      const rating = String(body.rating||'').trim();
      const cDate = String(body.contactDate||'').trim() || today();
      const nDate = String(body.nextDate||'').trim();
      const fields = { Summary: channel + ' - ' + cDate, CustomerKey: key, Date: cDate, Channel: channel, Note: note, By: by };
      if (rating) fields.Rating = rating;
      if (nDate) fields['Next Contact'] = nDate;
      const rr = await fetch(API + BASE + '/' + INT, { method:'POST', headers:auth, body: JSON.stringify({ fields: fields, typecast:true }) });
      const dd = await rr.json();
      try {
        const cust = await findCustomer(auth, body.customer);
        if (cust) {
          const cf = { 'Last Contact': cDate };
          if (note) cf['Last Feedback'] = note;
          if (rating) cf['Last Sentiment'] = rating;
          if (nDate) cf['Next Follow-up'] = nDate;
          await fetch(API + BASE + '/' + CUST + '/' + cust.id, { method:'PATCH', headers:auth, body: JSON.stringify({ fields: cf, typecast:true }) });
        }
      } catch(e){}
      res.status(200).json({ ok: !!dd.id, id: dd.id || null });
    } catch(e){ res.status(200).json({ ok:false, reason:String(e) }); }
    return;
  }

  if (action === 'customer_get') {
    try {
      const cust = await findCustomer(auth, body.customer);
      if (!cust) { res.status(200).json({ ok:true, found:false, prefs:{} }); return; }
      const f = cust.fields || {};
      res.status(200).json({ ok:true, found:true, id:cust.id, prefs:{ name:f.Name||'', doneness:f.Doneness||'', occasion:f.Occasion||'', notes:f.Notes||'', nextFollowup:f['Next Follow-up']||'', lastContact:f['Last Contact']||'', lastFeedback:f['Last Feedback']||'', lastSentiment:f['Last Sentiment']||'' } });
    } catch(e){ res.status(200).json({ ok:false, reason:String(e) }); }
    return;
  }

  if (action === 'customer_save') {
    try {
      const cust = await findCustomer(auth, body.customer);
      const cf = {};
      if (body.doneness != null) cf.Doneness = String(body.doneness);
      if (body.occasion != null) cf.Occasion = String(body.occasion);
      if (body.notes != null) cf.Notes = String(body.notes);
      if (cust) {
        await fetch(API + BASE + '/' + CUST + '/' + cust.id, { method:'PATCH', headers:auth, body: JSON.stringify({ fields: cf, typecast:true }) });
        res.status(200).json({ ok:true, id:cust.id });
      } else {
        cf.Phone = String(body.customer||''); if (body.name) cf.Name = String(body.name);
        const rr = await fetch(API + BASE + '/' + CUST, { method:'POST', headers:auth, body: JSON.stringify({ fields: cf, typecast:true }) });
        const dd = await rr.json();
        res.status(200).json({ ok: !!dd.id, id: dd.id||null });
      }
    } catch(e){ res.status(200).json({ ok:false, reason:String(e) }); }
    return;
  }

  if (action === 'followups_list') {
    try {
      const r = await fetch(API + BASE + '/' + CUST + '?pageSize=100', { headers: auth });
      const d = await r.json();
      const out = (d.records||[]).map(function(rec){ var f=rec.fields||{}; return {
        name: f.Name||'', phone: f.Phone||'', key: norm(f.Phone),
        totalSpent: Number(f['Total Spent']||0), numOrders: Number(f['# Orders']||0),
        lastOrder: String(f['Last Order']||'').slice(0,10), daysSince: (f['Days Since Last Order']!=null? Number(f['Days Since Last Order']): null),
        vip: !!f.VIP, nextFollowup: f['Next Follow-up']||'', lastContact: f['Last Contact']||'', lastSentiment: f['Last Sentiment']||'', lastFeedback: f['Last Feedback']||''
      }; }).filter(function(c){ return c.numOrders>0 && !/test|^zz /i.test(c.name); });
      res.status(200).json({ ok:true, items: out });
    } catch(e){ res.status(200).json({ ok:false, reason:String(e) }); }
    return;
  }

  // ---- existing: order PATCH (quote/invoice tool) ----
  const id = String(body.id || '').trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) { res.status(400).json({ ok:false, reason:'bad_id' }); return; }
  const fields = {};
  if (body.orderTotal != null && body.orderTotal !== '') fields['Order Total'] = Number(body.orderTotal) || 0;
  if (body.amountPaid != null && body.amountPaid !== '') fields['Amount Paid'] = Number(body.amountPaid) || 0;
  if (body.paymentMethod) fields['Payment Method'] = String(body.paymentMethod);
  if (body.paidDate) fields['Paid Date'] = String(body.paidDate);
  if (body.status) fields['Status'] = String(body.status);
  if (Object.keys(fields).length === 0) { res.status(400).json({ ok:false, reason:'no_fields' }); return; }
  try {
    const r = await fetch(API + BASE + '/' + TABLE + '/' + id, { method:'PATCH', headers: { Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify({ fields: fields, typecast:true }) });
    const data = await r.json();
    if (!r.ok) { res.status(200).json({ ok:false, reason:'airtable_'+r.status, detail:(data&&data.error)||null }); return; }
    res.status(200).json({ ok:true, id:data.id });
  } catch(e){ res.status(200).json({ ok:false, reason:String(e) }); }
}
