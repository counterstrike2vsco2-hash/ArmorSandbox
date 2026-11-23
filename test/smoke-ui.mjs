// Headless UI smoke test: loads index.html in jsdom with a stub 2D canvas,
// runs the app, clicks every experiment and fires every projectile at a few targets.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(process.env.JSDOM_DIR ? process.env.JSDOM_DIR + '/' : import.meta.url);
const { JSDOM } = require('jsdom');

const root = new URL('..', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8').replace(/<script[^>]*main\.js[^>]*><\/script>/, '');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k in t) return t[k];
    return noop;
  },
  set(t, k, v) { t[k] = v; return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => ctx2d;
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
let rafCb = null;
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Blob', 'URL', 'alert', 'screen']) {
  try { globalThis[k] = k === 'window' ? window : window[k]; } catch {}
}
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.devicePixelRatio = 1;
window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 });
const errors = [];
process.on('uncaughtException', (e) => { errors.push(e); });

await import(pathToFileURL(new URL('js/main.js', root).pathname).href);
const { world, state } = window.__armor;
const doc = window.document;
const tick = (n) => { for (let i = 0; i < n; i++) rafCb && rafCb(performance.now()); };
tick(5);
console.log('boot ok; experiments:', doc.querySelectorAll('#expList .card').length, 'tools:', doc.querySelectorAll('#tools .tool').length,
  'swatches:', doc.querySelectorAll('.swatch').length, 'projOpts:', doc.querySelectorAll('#projSel option').length, 'targetOpts:', doc.querySelectorAll('#targetSel option').length);

// language switch
doc.getElementById('btnLang').click(); tick(1);
console.log('lang now', doc.documentElement.lang, '| fire btn:', doc.getElementById('btnFire').textContent);
doc.getElementById('btnLang').click(); tick(1);

// experiments
const cards = [...doc.querySelectorAll('#expList .card')];
for (const [i, c] of cards.entries()) {
  c.click();
  await new Promise(r => setTimeout(r, 320));
  const t0 = performance.now();
  tick(160);
  console.log(`exp ${i + 1} ${state.proj}->${state.target}@${state.angle}: np=${world.np} ${doc.getElementById('hudResult').textContent.replace(/\s+/g, ' ').slice(0, 80)} (${((performance.now() - t0) / 160).toFixed(1)} ms/f)`);
}
// every projectile at one plate, and every target with one projectile
const projSel = doc.getElementById('projSel'), tgtSel = doc.getElementById('targetSel');
for (const o of [...projSel.options]) {
  projSel.value = o.value; projSel.dispatchEvent(new window.Event('change'));
  tgtSel.value = 'rha100'; tgtSel.dispatchEvent(new window.Event('change'));
  doc.getElementById('btnFire').click(); tick(40);
}
console.log('all projectiles fired');
projSel.value = '120dm53'; projSel.dispatchEvent(new window.Event('change'));
for (const o of [...tgtSel.options]) {
  tgtSel.value = o.value; tgtSel.dispatchEvent(new window.Event('change'));
  doc.getElementById('btnFire').click(); tick(30);
}
console.log('all targets built');
// builder tools
const cv = doc.getElementById('view');
const pe = (type, x, y) => { const e = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }); e.pointerId = 1; cv.dispatchEvent(e); };
cv.setPointerCapture = noop;
for (const tool of [...doc.querySelectorAll('#tools .tool')]) {
  tool.click();
  pe('pointerdown', 300, 200); pe('pointermove', 400, 260); pe('pointermove', 500, 300); pe('pointerup', 500, 300);
  tick(20);
}
console.log('tools ok, np', world.np);
// materials editor
doc.querySelector('#matProps input').value = 3; doc.querySelector('#matProps input').dispatchEvent(new window.Event('input'));
doc.getElementById('btnMatResetAll').click();
// save/load
doc.getElementById('btnSave').click();
doc.querySelector('#saveList .save button').click(); tick(3);
console.log('save/load ok');
// quality change
const q = doc.getElementById('quality'); q.value = '800x450'; q.dispatchEvent(new window.Event('change')); tick(10);
console.log('quality', world.W, world.H);
console.log(errors.length ? 'ERRORS:\n' + errors.map(e => e.stack).join('\n') : 'NO ERRORS');
process.exit(errors.length ? 1 : 0);
