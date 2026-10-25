import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const requiredSizes = [16, 24, 32, 48, 64, 128, 256];

function parseIco(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const size = buffer[entry] || 256;
    frames.push({
      size,
      length: buffer.readUInt32LE(entry + 8),
      offset: buffer.readUInt32LE(entry + 12),
      data: buffer.subarray(buffer.readUInt32LE(entry + 12), buffer.readUInt32LE(entry + 12) + buffer.readUInt32LE(entry + 8))
    });
  }
  return frames;
}

function decodePng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      colorType = data[9];
      assert.equal(colorType, 6);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  assert.ok(width > 0 && height > 0);
  const bytes = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = bytes[source++];
    for (let x = 0; x < stride; x += 1) {
      const raw = bytes[source++];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = (raw + predictor) & 255;
      } else throw new Error(`unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = value;
    }
  }
  return { width, height, pixels };
}

test('TradeDesk icon contains all required sizes and the brand colors', () => {
  const frames = parseIco(readFileSync('desktop/TradeDesk.ico'));
  assert.deepEqual(frames.map(frame => frame.size).sort((a, b) => a - b), requiredSizes);
  const frame = frames.find(candidate => candidate.size === 256);
  assert.ok(frame, 'missing 256px frame');
  const { pixels } = decodePng(frame.data);
  let colored = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 200) continue;
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colored += 1;
  }
  assert.ok(colored > 1000, `icon does not contain enough colored pixels: ${colored}`);
});
