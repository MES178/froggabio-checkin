// WF-A step 3 — one PATCH per contact carrying every field at once.
//
// A single write, not four: a half-written contact (token but no QR URL) would
// be picked up by the next poll and issued a second token.

const upload = $input.first().json || {};
const contact = $('Render QR').item.json;

const url = upload.url || (upload.objects && upload.objects[0] && upload.objects[0].url);
if (!url) {
  throw new Error(`File upload returned no URL for ${contact.short_code}: ${JSON.stringify(upload).slice(0, 300)}`);
}

return [
  {
    json: {
      hs_id: contact.hs_id,
      short_code: contact.short_code,
      properties: {
        ls2026_token: contact.token,
        ls2026_short_code: contact.short_code,
        ls2026_qr_url: url,
        ls2026_status: 'registered',
        ls2026_registered_at: new Date(contact.registered_at).toISOString(),
      },
    },
  },
];
