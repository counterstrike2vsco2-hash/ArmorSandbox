// Headless calibration: fires rounds at targets and prints penetration depth.
import { World } from '../js/engine.js';
import { buildScene } from '../js/scenes.js';

const cases = process.argv.length > 2 ? [process.argv.slice(2)] : [
  ['120dm53', 'rha700', 0, '~650-700'],
  ['125mango', 'rha700', 0, '~550-600'],
  ['120m829a3', 'rha700', 0, '~700-750'],
  ['88pzgr39', 'rha200', 0, '~140-160'],
  ['85br365', 'rha200', 0, '~110-120'],
  ['122br471', 'rha200', 0, '~140-160'],
  ['76m62', 'rha200', 0, '~100-110'],
  ['762b32', 'rha20', 0, '~10'],
  ['9mm', 'rha10', 0, '0-1'],
  ['145bs41', 'rha50', 0, '~30-35'],
  ['30apfsds', 'rha200', 0, '~100-120'],
  ['125bk18', 'rha700', 0, '~550'],
  ['pg7vl', 'rha700', 0, '~500'],
  ['pg7vl', 'era', 0, 'reduced'],
  ['105hesh', 'rha100', 0, 'spall'],
  ['120dm53', 'rha100', 80, 'ricochet'],
  ['9mm', 'gel', 0, '~300-400 (gel)'],
];

for (const [proj, target, angle, expect] of cases) {
  const w = new World(640, 360);
  const sc = buildScene(w, { proj, target, angle: +angle || 0 });
  const s = sc.shot;
  w.fireSprite(s.sprite, s.x, s.y, s.angle, s.speed, s.def);
  const t0 = performance.now();
  let frames = 0, maxNp = 0, spall = 0, expl = 0;
  for (; frames < 1500; frames++) {
    w.step();
    maxNp = Math.max(maxNp, w.np);
    for (const e of w.events) { if (e.type === 'spall') spall++; if (e.type === 'explosion') expl++; }
    w.events.length = 0;
    // stop when no fast particles left
    if (frames > 30 && frames % 20 === 0) {
      let fast = 0;
      for (let i = 0; i < w.np; i++) { const v = Math.hypot(w.pvx[i], w.pvy[i]); if (v > 150 && w.pkind[i] !== 3 && w.pkind[i] !== 4) fast++; }
      if (!fast) break;
    }
  }
  const ms = (performance.now() - t0) / frames;
  const depth = w.track.maxDepth * w.cellMM;
  console.log(`${proj.padEnd(10)} -> ${target.padEnd(10)} @${String(angle).padStart(2)}°  depth ${depth.toFixed(0).padStart(5)} mm  (expect ${expect})  los ${sc.losMM ? sc.losMM.toFixed(0) : '-'}  cell ${w.cellMM}mm  frames ${frames}  ${ms.toFixed(2)} ms/f  maxNp ${maxNp} spall ${spall} expl ${expl}`);
}
