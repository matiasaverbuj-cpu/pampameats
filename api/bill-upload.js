// Pampa Meats — upload a vendor invoice PDF onto a Vendor Bill record.
// PROTECTED by middleware (Basic Auth / DASH_PASS).
// POST { recordId, filename, contentType, fileBase64 } -> attaches file to the bill's Attachment field.
// Uses Airtable Content API (uploadAttachment). Requires env var AIRTABLE_TOKEN with data.records:write scope.

const BASE = 'app1muH8br0JSsvOa';
const ATTACH_FIELD = 'fldq6r2xNrheNupQp'; // Vendor Bills -> Attachment

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method_not_allowed' }); return; }
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) { res.status(200).json({ ok: false, reason: 'missing_token' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const recordId = String(body.recordId || '').trim();
  const fileBase64 = String(body.fileBase64 || '');
  const filename = String(body.filename || 'invoice.pdf').trim();
  const contentType = String(body.contentType || 'application/pdf').trim();
  if (!recordId) { res.status(400).json({ ok: false, reason: 'missing_record' }); return; }
  if (!fileBase64) { res.status(400).json({ ok: false, reason: 'missing_file' }); return; }

  // Airtable content API limits attachments to 5 MB (base64). Guard early.
  if (fileBase64.length > 7000000) { res.status(200).json({ ok: false, reason: 'file_too_large' }); return; }

  try {
    const r = await fetch(`https://content.airtable.com/v0/${BASE}/${recordId}/${(typeof body.fieldId==="string"&&/^fld[A-Za-z0-9]{14}$/.test(body.fieldId))?body.fieldId:ATTACH_FIELD}/uploadAttachment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, file: fileBase64, filename })
    });
    const data = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, reason: 'airtable_' + r.status, detail: (data && data.error) || null }); return; }
    res.status(200).json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false, reason: String(e) }); }
}
