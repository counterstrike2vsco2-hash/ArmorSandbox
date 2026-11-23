// Renders scene snapshots to PNG for visual checks: node test/snap.mjs proj target angle frames...
import { World } from '../js/engine.js';
import { buildScene } from '../js/scenes.js';
import { MATERIALS } from '../js/materials.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const crc = (buf) => { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function render(w) {
  const buf = Buffer.alloc(w.W * w.H * 3);
  for (let c = 0; c < w.N; c++) {
    let r = 20, g = 23, b = 28;
    if (w.st[c]) { const m = MATERIALS[w.mat[c]]; const k = w.st[c] === 2 ? 0.7 : 0.5 + 0.5 * Math.max(0, w.hp[c]); [r, g, b] = m.color.map(v => v * k); }
    buf[c * 3] = r; buf[c * 3 + 1] = g; buf[c * 3 + 2] = b;
  }
  for (let i = 0; i < w.np; i++) {
    const x = w.px[i] | 0, y = w.py[i] | 0; if (x < 0 || y < 0 || x >= w.W || y >= w.H) continue;
    const k = w.pkind[i]; const c = (y * w.W + x) * 3;
    const col = k === 1 ? [255, 60, 255] : k === 2 ? [255, 255, 200] : k === 3 ? [255, 140, 30] : k === 4 ? [110, 110, 110] : k === 5 ? [255, 220, 90] : MATERIALS[w.pmat[i]].color.map(v => Math.min(255, v + 60));
    buf[c] = col[0]; buf[c + 1] = col[1]; buf[c + 2] = col[2];
  }
  return buf;
}

const [proj, target, angle = 0, ...frames] = process.argv.slice(2);
const w = new World(640, 360);
const sc = buildScene(w, { proj, target, angle: +angle });
const s = sc.shot;
fs.mkdirSync('/tmp/snaps', { recursive: true });
const fr = frames.length ? frames.map(Number) : [0, 60, 120, 240];
let f = 0;
w.fireSprite(s.sprite, s.x, s.y, s.angle, s.speed, s.def);
for (const target of fr) {
  while (f < target) { w.step(); f++; }
  const file = `/tmp/snaps/${proj}_${sc.target.key}_${f}.png`;
  fs.writeFileSync(file, png(w.W, w.H, render(w)));
  console.log(file, 'np', w.np, 'depth', (w.track.maxDepth * w.cellMM).toFixed(0));
}
