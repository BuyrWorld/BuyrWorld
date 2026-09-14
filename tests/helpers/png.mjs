/**
 * Just enough PNG to answer one question: does the ink touch the canvas edge?
 *
 * The UI brief reported the footer logo as clipped. It is not — it is drawn
 * underneath the sidebar. But "the asset is fine" is a claim with a shelf life:
 * the next export of it might genuinely crop the mark, and the symptom would
 * look identical. So the claim is measured rather than remembered.
 *
 * 8-bit RGBA, non-interlaced. Anything else raises rather than guessing.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** @returns {{width:number,height:number,rgba:Buffer}} */
export function readPng(path) {
  const buf = readFileSync(path);
  if (buf.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`${path} is not a PNG`);
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  const [depth, colour, , , interlace] = [buf[24], buf[25], buf[26], buf[27], buf[28]];
  if (depth !== 8 || colour !== 6 || interlace !== 0) {
    throw new Error(`${path}: only 8-bit RGBA non-interlaced is supported (depth ${depth}, colour ${colour}, interlace ${interlace})`);
  }

  const idat = [];
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    if (buf.toString("ascii", off + 4, off + 8) === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));

  const bpp = 4, stride = width * bpp;
  const rgba = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rgba[y * stride + x - bpp] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? rgba[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`${path}: unknown row filter ${filter}`);
      rgba[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, rgba };
}

/**
 * The box the visible pixels actually occupy, and the clear space around it.
 * A margin of zero on any side means the artwork runs off the canvas.
 */
export function inkBounds(path, alphaFloor = 8) {
  const { width, height, rgba } = readPng(path);
  const opaque = (x, y) => rgba[(y * width + x) * 4 + 3] > alphaFloor;
  const rowHasInk = (y) => { for (let x = 0; x < width; x++) if (opaque(x, y)) return true; return false; };
  const colHasInk = (x) => { for (let y = 0; y < height; y++) if (opaque(x, y)) return true; return false; };

  let top = 0; while (top < height && !rowHasInk(top)) top++;
  if (top === height) throw new Error(`${path} has no visible pixels at all`);
  let bottom = height - 1; while (!rowHasInk(bottom)) bottom--;
  let left = 0; while (!colHasInk(left)) left++;
  let right = width - 1; while (!colHasInk(right)) right--;

  return {
    width, height,
    box: { left, right, top, bottom },
    margins: { top, right: width - 1 - right, bottom: height - 1 - bottom, left },
  };
}
