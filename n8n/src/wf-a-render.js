// WF-A step 2 — render the QR PNG for this contact.
//
// The QR encodes the bare UUID and nothing else. A URL would mean an attendee
// scanning their own code with the phone camera opens something; a bare UUID is
// inert to every scanner except ours (spec §7.1).
//
// The encoder above this comment is vendored, not installed: n8n Cloud cannot
// load npm packages inside a Code node, and no third-party QR service may ever
// see a customer identifier (spec §7.3).

// runOnceForEachItem: $input.first() is rejected here, and the node must
// return a single object rather than an array.
const item = $input.item.json;
const { bytes, size, modules } = buildQrPng(item.token, { minPx: 600, quiet: 4, ecc: 'M' });

return {
  json: { ...item, qr_px: size, qr_modules: modules },
  binary: {
    data: await this.helpers.prepareBinaryData(
      Buffer.from(bytes),
      `${item.event_key}-${item.short_code}.png`,
      'image/png'
    ),
  },
};
