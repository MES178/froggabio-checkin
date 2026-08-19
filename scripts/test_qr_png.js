/**
 * End-to-end test of the QR->PNG encoder: build a PNG the way WF-B will, then
 * decode it back with the same jsQR build the scanner uses. If the round trip
 * returns the original token, the encoder is correct — not merely plausible.
 *
 * Run: node scripts/test_qr_png.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
global.qrcode = require(path.join(ROOT, 'vendor/qrcode-generator.js'));
const { buildQrPng } = require(path.join(ROOT, 'n8n/qr-png.js'));
const jsQR = require(path.join(ROOT, 'vendor/jsQR.min.js'));

/** Minimal reader for the exact PNG shape we emit: 1-bit greyscale, no interlace. */
function decodePng(bytes) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colour, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 1 || colour !== 0 || interlace !== 0) {
        throw new Error(`unexpected IHDR: depth=${depth} colour=${colour} interlace=${interlace}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width / 8);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const base = y * (rowBytes + 1);
    if (raw[base] !== 0) throw new Error(`row ${y} uses filter ${raw[base]}, expected 0`);
    for (let x = 0; x < width; x++) {
      const bit = (raw[base + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = bit ? 255 : 0;
      const p = (y * width + x) * 4;
      rgba[p] = v;
      rgba[p + 1] = v;
      rgba[p + 2] = v;
      rgba[p + 3] = 255;
    }
  }
  return { width, height, rgba };
}

const tokens = [
  '3f2b8c1e-9d44-4a7f-b0c2-6e15a8d93f70',
  '00000000-0000-4000-8000-000000000000',
  'ffffffff-ffff-4fff-bfff-ffffffffffff',
];

let failures = 0;
for (const token of tokens) {
  const { bytes, size, modules, version } = buildQrPng(token, { minPx: 600, quiet: 4, ecc: 'M' });
  const buf = Buffer.from(bytes);
  const img = decodePng(buf);
  const decoded = jsQR(img.rgba, img.width, img.height);
  const ok = decoded && decoded.data === token;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${token}  v${version} ${modules}x${modules} modules -> ` +
      `${size}px, ${(buf.length / 1024).toFixed(1)} KB, decoded=${decoded ? decoded.data : 'null'}`
  );
}

// Keep one sample around for a visual check.
const sample = buildQrPng(tokens[0], { minPx: 600, quiet: 4, ecc: 'M' });
fs.writeFileSync(path.join(ROOT, 'docs/sample-qr.png'), Buffer.from(sample.bytes));
console.log('sample written to docs/sample-qr.png');

process.exit(failures ? 1 : 0);
