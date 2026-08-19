/**
 * QR -> PNG with zero runtime dependencies.
 *
 * This file is the source of truth for the encoder that gets embedded into the
 * n8n WF-B Code node (see scripts/build_wf_b.py). n8n Cloud allows neither npm
 * packages nor a guaranteed `zlib`, so the PNG is written by hand:
 *
 *   - 1-bit greyscale (colour type 0, bit depth 1) — a QR is two colours, and
 *     1 bit per pixel keeps a 600px image around 50 KB.
 *   - The zlib stream uses *stored* (uncompressed) deflate blocks, so no
 *     compressor is needed — just Adler-32 over the raw data and CRC-32 per
 *     chunk.
 *
 * Exports (Node) / globals (n8n Code node): buildQrPng(text, opts).
 */

/* eslint-disable no-bitwise */

function crc32Table() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value) {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function pngChunk(type, data) {
  const typeBytes = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)));
  const body = concat([typeBytes, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

/** zlib stream made of stored deflate blocks — valid, just not compressed. */
function storedZlib(raw) {
  const parts = [Uint8Array.from([0x78, 0x01])];
  const MAX = 65535;
  for (let offset = 0; offset < raw.length; offset += MAX) {
    const slice = raw.subarray(offset, Math.min(offset + MAX, raw.length));
    const last = offset + MAX >= raw.length ? 1 : 0;
    const len = slice.length;
    parts.push(Uint8Array.from([last, len & 0xff, (len >>> 8) & 0xff, ~len & 0xff, (~len >>> 8) & 0xff]));
    parts.push(slice);
  }
  parts.push(u32(adler32(raw)));
  return concat(parts);
}

/**
 * @param {boolean[][]} matrix  true = dark module
 * @param {number} scale        pixels per module
 * @param {number} quiet        quiet-zone width in modules
 */
function matrixToPng(matrix, scale, quiet) {
  const modules = matrix.length + quiet * 2;
  const size = modules * scale;
  const rowBytes = Math.ceil(size / 8);

  // One scanline per pixel row: filter byte 0 + packed bits, 1 = white.
  const raw = new Uint8Array((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    const base = y * (rowBytes + 1);
    raw[base] = 0;
    const my = Math.floor(y / scale) - quiet;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const dark =
        my >= 0 && my < matrix.length && mx >= 0 && mx < matrix.length && matrix[my][mx];
      if (!dark) raw[base + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const ihdr = concat([
    u32(size),
    u32(size),
    Uint8Array.from([1, 0, 0, 0, 0]), // bit depth 1, greyscale, no interlace
  ]);

  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', storedZlib(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Encode `text` as a QR PNG.
 *
 * @param {string} text
 * @param {{minPx?: number, quiet?: number, ecc?: string}} [opts]
 * @returns {{bytes: Uint8Array, size: number, modules: number, version: number}}
 */
function buildQrPng(text, opts) {
  const options = opts || {};
  const minPx = options.minPx || 600;
  const quiet = options.quiet == null ? 4 : options.quiet; // spec §7.4
  const ecc = options.ecc || 'M';

  // typeNumber 0 = auto-select the smallest version that fits.
  const qr = qrcode(0, ecc);
  qr.addData(text, 'Byte');
  qr.make();

  const count = qr.getModuleCount();
  const matrix = [];
  for (let r = 0; r < count; r++) {
    const row = [];
    for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
    matrix.push(row);
  }

  const scale = Math.ceil(minPx / (count + quiet * 2));
  const bytes = matrixToPng(matrix, scale, quiet);
  return { bytes, size: (count + quiet * 2) * scale, modules: count, version: (count - 17) / 4 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildQrPng, matrixToPng, crc32, adler32, storedZlib };
}
