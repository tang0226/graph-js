// Writes 1-pixel black-and-white checkerboard PNGs for testing image
// downscaling. Run from anywhere: `node demo/textures/make-checkerboards.mjs`.
//
// A correctly filtered downscale of a 1-pixel checkerboard is a uniform
// mid-grey. A filter that skips source pixels shows solid black or white,
// speckle, or moiré instead.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/* A 1-bit greyscale PNG, `w` x `h`, whose pixels alternate black and white. */
const checkerboard = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 1;   // bit depth
  ihdr[9] = 0;   // greyscale
  const rowBytes = Math.ceil(w / 8);
  const raw = Buffer.alloc(h * (1 + rowBytes));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + rowBytes);   // raw[row] = 0: no filter
    raw.fill(y % 2 ? 0b01010101 : 0b10101010, row + 1, row + 1 + rowBytes);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

for (const [w, h] of [[2048, 2048], [4000, 3000]]) {
  const file = new URL(`checker-${w}x${h}.png`, import.meta.url);
  writeFileSync(file, checkerboard(w, h));
  console.log(`wrote ${file.pathname}`);
}
