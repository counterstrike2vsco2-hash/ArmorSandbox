import { World, K_PROJ, K_JET, EMPTY, FIXED } from './engine.js';
import { MATERIALS, MAT, CATEGORIES, DEFAULTS, resetMaterial } from './materials.js';
import { PROJECTILES, PROJ, PROJ_CATS, TARGETS, TARGET, TARGET_CATS, rasterizeProjectile } from './shapes.js';
import { buildScene, EXPERIMENTS } from './scenes.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';

// ------------------------------------------------------------------ i18n
const STR = {
  ru: {
    subtitle: 'web · альфа', pause: 'Пауза (P)', play: 'Пуск (P)', step: 'Шаг (S)', reset: 'Заново (R)', timeScale: 'Время',
    fire: 'ОГОНЬ', quality: 'Качество', qLow: 'Низкое', qMed: 'Среднее', qHigh: 'Высокое', qUltra: 'Ультра', sound: 'Звук', help: 'Справка',
    tabExp: 'Опыты', tabShoot: 'Стрельба', tabBuild: 'Конструктор', tabMats: 'Материалы', tabFile: 'Файл',
    expHint: 'Готовые опыты. Нажмите — сцена соберётся и выстрелит.',
    projectile: 'Снаряд', speed: 'Скорость', target: 'Цель', angle: 'Угол наклона', rebuild: 'Собрать заново',
    aimHint: 'Совет: инструмент «Пушка» на вкладке «Конструктор» — зажмите на поле и потяните, чтобы выстрелить из любой точки в любом направлении.',
    brush: 'Кисть', clear: 'Очистить поле', clearParticles: 'Убрать осколки', scale: 'Масштаб (мм на клетку)',
    material: 'Материал', resetMat: 'Сбросить материал', resetAll: 'Сбросить все',
    matHint: 'Изменения сразу влияют на симуляцию. Плотность — г/см³, прочность — ГПа (эквивалент).',
    saveName: 'Название', save: 'Сохранить', export: 'Экспорт файла', import: 'Импорт файла', screenshot: 'Скриншот PNG',
    fileHint: 'Сохранения хранятся только в этом браузере. Ничего не отправляется в сеть.',
    len: 'Длина', calib: 'Калибр', mm: 'мм', m: 'м', ms: 'м/с', rated: 'Табличная бронепробиваемость',
    depth: 'Глубина канала', los: 'Приведённая толщина', pen: 'ПРОБИТИЕ', nopen: 'НЕПРОБИТИЕ', flying: 'летит…',
    particles: 'Частиц', time: 'Время', scaleS: 'Масштаб', perCell: 'мм/клетка', fps: 'кадр/с', paused: 'ПАУЗА',
    tShoot: 'Пушка', tBrush: 'Кисть', tLine: 'Линия', tRect: 'Блок', tErase: 'Ластик', tHeat: 'Нагрев', tIgnite: 'Поджечь', tBoom: 'Заряд',
    noSaves: 'Сохранений пока нет.', load: 'Открыть', del: '✕', saved: 'Сохранено', custom: 'Своя сцена',
    density: 'Плотность, г/см³', R: 'Прочность (сопр. пробитию), ГПа', Y: 'Прочность как снаряда, ГПа', hard: 'Твёрдость (0–10)',
    brittle: 'Хрупкость (0–1)', atten: 'Затухание ударной волны, мм', spall: 'Порог откола, ГПа', ignite: 'Воспламенение, °C', P0: 'Давление детонации, ГПа',
    importErr: 'Не удалось прочитать файл',
    helpBody: `<h2>ArmorSandbox · Web</h2>
<p>Двумерная песочница терминальной баллистики. Каждая плита, снаряд и осколок состоит из частиц с реальными свойствами материала: плотностью, прочностью, твёрдостью, хрупкостью, температурой воспламенения. Пробитие, эрозия «лома», рикошет, откол, кумулятивная струя, детонация и пожар не нарисованы — они считаются.</p>
<ul>
<li><b>Опыты</b> — готовые сцены одним нажатием.</li>
<li><b>Стрельба</b> — выберите снаряд, скорость, цель и угол, затем <kbd>Пробел</kbd> или «ОГОНЬ».</li>
<li><b>Конструктор</b> — рисуйте броню любым материалом, стреляйте инструментом «Пушка» (зажать и потянуть), поджигайте, подрывайте.</li>
<li><b>Материалы</b> — меняйте свойства любого материала, симуляция подстроится.</li>
</ul>
<p><kbd>Пробел</kbd> огонь · <kbd>P</kbd> пауза · <kbd>S</kbd> шаг · <kbd>R</kbd> заново · <kbd>1–8</kbd> инструменты · колесо мыши — размер кисти</p>
<p class="hint">Модель упрощённая (эрозия по Тейту, откол по ударной волне, калиброванные кумулятивные струи) — для понимания и веселья, а не для проектирования брони. Всё работает локально в браузере, без серверов и аккаунтов.</p>`,
  },
  en: {
    subtitle: 'web · alpha', pause: 'Pause (P)', play: 'Play (P)', step: 'Step (S)', reset: 'Restart (R)', timeScale: 'Time',
    fire: 'FIRE', quality: 'Quality', qLow: 'Low', qMed: 'Medium', qHigh: 'High', qUltra: 'Ultra', sound: 'Sound', help: 'Help',
    tabExp: 'Experiments', tabShoot: 'Shoot', tabBuild: 'Builder', tabMats: 'Materials', tabFile: 'File',
    expHint: 'Ready-made experiments. Click one — the scene is built and fired.',
    projectile: 'Projectile', speed: 'Velocity', target: 'Target', angle: 'Obliquity', rebuild: 'Rebuild',
    aimHint: 'Tip: the “Gun” tool in the Builder tab — press on the field and drag to fire from any point in any direction.',
    brush: 'Brush', clear: 'Clear field', clearParticles: 'Remove debris', scale: 'Scale (mm per cell)',
    material: 'Material', resetMat: 'Reset material', resetAll: 'Reset all',
    matHint: 'Changes affect the simulation immediately. Density in g/cm³, strength in GPa (equivalent).',
    saveName: 'Name', save: 'Save', export: 'Export file', import: 'Import file', screenshot: 'PNG screenshot',
    fileHint: 'Saves are stored in this browser only. Nothing is sent over the network.',
    len: 'Length', calib: 'Calibre', mm: 'mm', m: 'm', ms: 'm/s', rated: 'Rated penetration',
    depth: 'Channel depth', los: 'Line-of-sight thickness', pen: 'PENETRATION', nopen: 'NO PENETRATION', flying: 'in flight…',
    particles: 'Particles', time: 'Time', scaleS: 'Scale', perCell: 'mm/cell', fps: 'fps', paused: 'PAUSED',
    tShoot: 'Gun', tBrush: 'Brush', tLine: 'Line', tRect: 'Block', tErase: 'Eraser', tHeat: 'Heat', tIgnite: 'Ignite', tBoom: 'Charge',
    noSaves: 'No saves yet.', load: 'Open', del: '✕', saved: 'Saved', custom: 'Custom scene',
    density: 'Density, g/cm³', R: 'Strength (penetration resistance), GPa', Y: 'Strength as a projectile, GPa', hard: 'Hardness (0–10)',
    brittle: 'Brittleness (0–1)', atten: 'Shock attenuation, mm', spall: 'Spall threshold, GPa', ignite: 'Ignition, °C', P0: 'Detonation pressure, GPa',
    importErr: 'Could not read the file',
    helpBody: `<h2>ArmorSandbox · Web</h2>
<p>A 2D terminal-ballistics sandbox. Every plate, projectile and fragment is made of particles with real material properties: density, strength, hardness, brittleness, ignition temperature. Penetration, long-rod erosion, ricochet, spall, shaped-charge jets, detonation and fire are not drawn — they are simulated.</p>
<ul>
<li><b>Experiments</b> — ready-made scenes in one click.</li>
<li><b>Shoot</b> — pick a projectile, velocity, target and obliquity, then <kbd>Space</kbd> or “FIRE”.</li>
<li><b>Builder</b> — paint armour with any material, fire with the “Gun” tool (press and drag), ignite, detonate.</li>
<li><b>Materials</b> — tweak any material and the simulation follows.</li>
</ul>
<p><kbd>Space</kbd> fire · <kbd>P</kbd> pause · <kbd>S</kbd> step · <kbd>R</kbd> restart · <kbd>1–8</kbd> tools · mouse wheel — brush size</p>
<p class="hint">The model is simplified (Tate-style erosion, shock-wave spall, calibrated shaped-charge jets) — for insight and fun, not for armour design. Everything runs locally in your browser, no servers, no accounts.</p>`,
  },
};
let lang = localStorage.getItem('as_lang') || 'ru';
const t = (k) => (STR[lang] && STR[lang][k]) ?? STR.ru[k] ?? k;
const nm = (o) => (o.name ? o.name[lang] || o.name.ru : o[lang] ? o[lang][0] : '');
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ setup
const savedQ = localStorage.getItem('as_quality') || (Math.min(screen.width, screen.height) < 700 ? '480x270' : '640x360');
const [GW, GH] = savedQ.split('x').map(Number);
const world = new World(GW, GH);
const canvas = $('view');
const renderer = new Renderer(canvas, world);
const sound = new Sound();
sound.enabled = localStorage.getItem('as_sound') !== '0';

const state = {
  proj: '120dm53', target: 'rha400', angle: 0, speedK: 50,
  scene: null, running: true, tool: 'shoot', brushMat: MAT.rha, brush: 4,
  shot: null, custom: false,
};

function speedOf() {
  const v0 = PROJ[state.proj].speed;
  return Math.round(v0 * Math.pow(2, (state.speedK - 50) / 25));
}

// ------------------------------------------------------------------ selects
function fillSelect(sel, items, cats, current) {
  sel.innerHTML = '';
  for (const [key, ru, en] of cats) {
    const g = document.createElement('optgroup');
    g.label = lang === 'ru' ? ru : en;
    for (const it of items.filter(i => i.cat === key)) {
      const o = document.createElement('option');
      o.value = it.key; o.textContent = nm(it);
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  sel.value = current;
}

function projInfo() {
  const P = PROJ[state.proj];
  const charges = (P.fuze && P.fuze.charges) || [];
  const jets = charges.filter(c => c.jet);
  const core = P.parts.filter(p => p.core && p.r).reduce((a, p) => Math.max(a, p.r), 0) || P.radius;
  let s = `${t('calib')}: ${(core * 2).toFixed(core < 10 ? 1 : 0)} ${t('mm')} · ${t('len')}: ${P.len} ${t('mm')}<br>`;
  s += `${t('speed')}: ${P.speed} ${t('ms')}`;
  if (jets.length) s += `<br>${t('rated')}: ${jets.map(j => j.jet.penRHA).join(' + ')} ${t('mm')} RHA`;
  $('projInfo').innerHTML = s;
}

function updateSpeedOut() { $('speedOut').textContent = `${speedOf()} ${t('ms')}`; }

// ------------------------------------------------------------------ scene
function rebuild() {
  state.custom = false;
  state.scene = buildScene(world, { proj: state.proj, target: state.target, angle: state.angle, speed: speedOf() });
  renderer.buildBackground();
  const s = state.scene.shot;
  renderer.setGhost(s.sprite, s.x, s.y, s.angle);
  state.shot = null;
  updateHud();
  const T = TARGET[state.target];
  $('angleField').style.opacity = T.angled ? 1 : 0.4;
  $('angle').disabled = !T.angled;
  syncScaleSel();
}

function fire() {
  sound.init();
  if (state.custom || !state.scene) { customFireDefault(); return; }
  const s = state.scene.shot;
  const P = PROJ[state.proj];
  const def = { ...s.def };
  world.fireSprite(s.sprite, s.x, s.y, s.angle, speedOf(), def);
  renderer.setGhost(null);
  startShot(state.scene.losMM);
  if (!state.running) setRunning(true);
}

function customFireDefault() {
  // fire from the left edge, middle height, horizontally
  shootFrom(4 + rasterizeProjectile(PROJ[state.proj], world.cellMM).w, world.H / 2, 0);
}

function shootFrom(x, y, angle) {
  sound.init();
  const P = PROJ[state.proj];
  const sprite = rasterizeProjectile(P, world.cellMM);
  const def = { charges: (P.fuze && P.fuze.charges) || [], fuzeSens: (P.fuze && P.fuze.fuzeSens) || 0.05, eff: P.eff || 1 };
  world.fireSprite(sprite, x, y, angle, speedOf(), def);
  renderer.setGhost(null);
  startShot(null);
  if (!state.running) setRunning(true);
}

function startShot(los) {
  state.shot = { los, done: false, quiet: 0, frames: 0 };
}

function updateShot() {
  const sh = state.shot;
  if (!sh || sh.done) return;
  sh.frames++;
  if (sh.frames % 10 === 0) {
    let fast = 0;
    for (let i = 0; i < world.np; i++) {
      const k = world.pkind[i];
      if ((k === K_PROJ || k === K_JET) && Math.abs(world.pvx[i]) + Math.abs(world.pvy[i]) > 80) { fast++; break; }
    }
    if (!fast && sh.frames > 20 && world.groups.size === 0) sh.quiet++;
    else sh.quiet = 0;
    if (sh.quiet >= 3) sh.done = true;
  }
}

function updateHud() {
  const sc = state.scene;
  if (sc && !state.custom) {
    $('hudScene').innerHTML = `${nm(sc.proj)} <span class="muted">${speedOf()} ${t('ms')}</span><span class="vs">→</span>${nm(sc.target)}${sc.target.angled && sc.angle ? ` · ${sc.angle}°` : ''}`;
  } else $('hudScene').innerHTML = t('custom');
}

function updateResult() {
  const sh = state.shot;
  if (!sh) { $('hudResult').innerHTML = ''; $('result').innerHTML = ''; return; }
  const depth = world.track.maxDepth * world.cellMM;
  let html = `${t('depth')}: <b>${depth.toFixed(depth < 20 ? 1 : 0)} ${t('mm')}</b>`;
  if (sh.los) {
    html += `<br>${t('los')}: ${sh.los.toFixed(0)} ${t('mm')}`;
    if (depth >= sh.los * 0.97) html += `<div class="verdict pen">${t('pen')}</div>`;
    else if (sh.done) html += `<div class="verdict nopen">${t('nopen')}</div>`;
    else html += `<div class="muted">${t('flying')}</div>`;
  }
  $('hudResult').innerHTML = html;
  $('result').innerHTML = html;
}

// ------------------------------------------------------------------ loop
let lastT = performance.now(), fpsAcc = 0, fpsN = 0, fps = 60, stepOnce = false;
function loop(now) {
  const dt = now - lastT; lastT = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 500) { fps = Math.round(1000 * fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  renderer.resize();
  if (state.running || stepOnce) {
    world.step();
    stepOnce = false;
    updateShot();
  }
  if (world.events.length) {
    renderer.handleEvents(world.events);
    sound.play(world.events);
    world.events.length = 0;
  }
  renderer.draw();
  if ((world.frame & 7) === 0 || !state.running) {
    updateResult();
    $('status').textContent = `${state.running ? '' : t('paused') + ' · '}${t('particles')}: ${world.np} · ${t('time')}: ${(world.time * 1000).toFixed(2)} ms · ${t('scaleS')}: ${world.cellMM} ${t('perCell')} · ${world.W}×${world.H} · ${fps} ${t('fps')}`;
  }
  requestAnimationFrame(loop);
}

function setRunning(r) {
  state.running = r;
  $('btnPlay').textContent = r ? '⏸' : '▶';
  $('btnPlay').title = r ? t('pause') : t('play');
}

// ------------------------------------------------------------------ tools
const TOOLS = [
  ['shoot', '🎯', 'tShoot'], ['brush', '🖌️', 'tBrush'], ['line', '📏', 'tLine'], ['rect', '⬛', 'tRect'],
  ['erase', '🧽', 'tErase'], ['heat', '🔥', 'tHeat'], ['ignite', '🧨', 'tIgnite'], ['boom', '💥', 'tBoom'],
];
function buildTools() {
  const el = $('tools'); el.innerHTML = '';
  TOOLS.forEach(([key, ico, label], i) => {
    const b = document.createElement('button');
    b.className = 'tool' + (state.tool === key ? ' active' : '');
    b.innerHTML = `<span class="ico">${ico}</span>${t(label)}`;
    b.title = `${t(label)} (${i + 1})`;
    b.onclick = () => setTool(key);
    el.appendChild(b);
  });
}
function setTool(k) { state.tool = k; buildTools(); renderer.brush = null; }

function buildPalette() {
  const el = $('palette'); el.innerHTML = '';
  for (const [cat, ru, en] of CATEGORIES) {
    const h = document.createElement('h4'); h.textContent = lang === 'ru' ? ru : en; el.appendChild(h);
    const box = document.createElement('div'); box.className = 'swatches';
    for (const m of MATERIALS) {
      if (!m || m.cat !== cat || !m.paintable) continue;
      const b = document.createElement('button');
      b.className = 'swatch' + (state.brushMat === m.id ? ' active' : '');
      b.innerHTML = `<i style="background:rgb(${m.color.join(',')})"></i>${m.name[lang]}`;
      b.onclick = () => { state.brushMat = m.id; if (!['brush', 'line', 'rect'].includes(state.tool)) setTool('brush'); buildPalette(); };
      box.appendChild(b);
    }
    el.appendChild(box);
  }
}

const SCALES = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 8, 10, 15, 20, 25];
function syncScaleSel() {
  const sel = $('scaleSel');
  const vals = [...new Set([...SCALES, world.cellMM])].sort((a, b) => a - b);
  sel.innerHTML = vals.map(v => `<option value="${v}">${v}</option>`).join('');
  sel.value = world.cellMM;
}

function markCustom() {
  if (!state.custom) { state.custom = true; renderer.setGhost(null); updateHud(); }
}

// pointer handling on the canvas
let drag = null;
function cellAt(e) { return renderer.toCell(e.clientX, e.clientY); }
canvas.addEventListener('pointerdown', (e) => {
  sound.init();
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = cellAt(e);
  drag = { x0: x, y0: y, x, y, button: e.button };
  const tool = state.tool;
  if (tool === 'shoot' && e.button === 0) renderer.aim = { x0: x, y0: y, x1: x, y1: y };
  else applyTool(x, y, true);
});
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = cellAt(e);
  const tool = state.tool;
  if (['brush', 'erase', 'heat', 'ignite', 'boom'].includes(tool)) renderer.brush = { x, y, r: state.brush / 2 };
  else renderer.brush = null;
  if (!drag) return;
  const px = drag.x, py = drag.y;
  drag.x = x; drag.y = y;
  if (tool === 'shoot') { if (renderer.aim) { renderer.aim.x1 = x; renderer.aim.y1 = y; } return; }
  if (tool === 'line' || tool === 'rect') { renderer.shape = { type: tool, x0: drag.x0, y0: drag.y0, x1: x, y1: y }; return; }
  if (tool === 'brush' || tool === 'erase' || tool === 'heat') {
    // interpolate strokes
    const n = Math.ceil(Math.hypot(x - px, y - py) / Math.max(1, state.brush / 3));
    for (let k = 1; k <= n; k++) applyTool(px + (x - px) * k / n, py + (y - py) * k / n, false);
  }
});
canvas.addEventListener('pointerleave', () => { renderer.brush = null; });
const endDrag = (e) => {
  if (!drag) return;
  const tool = state.tool;
  if (tool === 'shoot' && renderer.aim) {
    const a = renderer.aim;
    const dx = a.x1 - a.x0, dy = a.y1 - a.y0;
    const ang = Math.hypot(dx, dy) > 4 ? Math.atan2(dy, dx) : 0;
    renderer.aim = null;
    state.custom = state.custom || false;
    shootFrom(a.x0, a.y0, ang);
  } else if ((tool === 'line' || tool === 'rect') && renderer.shape) {
    const s = renderer.shape; renderer.shape = null;
    markCustom();
    if (tool === 'rect') {
      const x0 = Math.round(Math.min(s.x0, s.x1)), x1 = Math.round(Math.max(s.x0, s.x1));
      const y0 = Math.round(Math.min(s.y0, s.y1)), y1 = Math.round(Math.max(s.y0, s.y1));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.setCell(x, y, state.brushMat);
    } else {
      const n = Math.ceil(Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * 2) + 1;
      for (let k = 0; k <= n; k++) world.paintCircle(s.x0 + (s.x1 - s.x0) * k / n, s.y0 + (s.y1 - s.y0) * k / n, state.brush / 2, state.brushMat);
    }
  }
  drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  if (state.tool === 'shoot') return;
  e.preventDefault();
  state.brush = Math.max(1, Math.min(40, state.brush + (e.deltaY < 0 ? 1 : -1)));
  $('brushSize').value = state.brush; $('brushOut').textContent = state.brush;
  if (renderer.brush) renderer.brush.r = state.brush / 2;
}, { passive: false });

function applyTool(x, y, first) {
  const r = state.brush / 2;
  switch (state.tool) {
    case 'brush': markCustom(); world.paintCircle(x, y, Math.max(0.5, r), state.brushMat); break;
    case 'erase': markCustom(); world.paintCircle(x, y, Math.max(0.5, r), 0); break;
    case 'heat': world.heatCircle(x, y, Math.max(1, r), 120); break;
    case 'ignite': if (first) world.heatCircle(x, y, Math.max(1, r), 1500); break;
    case 'boom': if (first) { sound.init(); world.explode(x, y, Math.max(3, Math.PI * r * r), MATERIALS[MAT.tnt].P0, false, 0); } break;
  }
}

// ------------------------------------------------------------------ materials editor
const PROPS = [
  ['density', 0.1, 25, 0.01], ['R', 0, 15, 0.05], ['Y', 0, 8, 0.05], ['hard', 0, 10, 0.1], ['brittle', 0, 1, 0.01],
  ['atten', 5, 400, 1], ['spall', 0, 8, 0.01], ['ignite', 0, 1500, 10], ['P0', 0, 40, 0.5],
];
function buildMatSel() {
  const sel = $('matSel'); const cur = +sel.value || MAT.rha;
  sel.innerHTML = '';
  for (const [cat, ru, en] of CATEGORIES) {
    const g = document.createElement('optgroup'); g.label = lang === 'ru' ? ru : en;
    for (const m of MATERIALS) if (m && m.cat === cat && m.paintable && m.R < 1e8) {
      const o = document.createElement('option'); o.value = m.id; o.textContent = m.name[lang]; g.appendChild(o);
    }
    sel.appendChild(g);
  }
  sel.value = cur;
  buildMatProps();
}
function buildMatProps() {
  const m = MATERIALS[+$('matSel').value];
  const el = $('matProps'); el.innerHTML = '';
  if (!m) return;
  for (const [key, min, max, step] of PROPS) {
    const d = document.createElement('div'); d.className = 'prop';
    d.innerHTML = `<label><span>${t(key)}</span><b>${+m[key].toFixed(3)}</b></label><input type="range" min="${min}" max="${max}" step="${step}" value="${m[key]}">`;
    const inp = d.querySelector('input'), out = d.querySelector('b');
    inp.oninput = () => {
      m[key] = +inp.value; out.textContent = +m[key].toFixed(3);
      if (key === 'ignite') m.flammable = m.ignite > 0 && m.P0 === 0;
      if (key === 'P0') { m.flammable = m.ignite > 0 && m.P0 === 0; if (m.P0 > 0 && !m.sens) m.sens = 5; }
    };
    el.appendChild(d);
  }
}

// ------------------------------------------------------------------ saves
const SAVE_KEY = 'as_saves_v1';
const getSaves = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; } catch { return []; } };
function snapshot(name) {
  return { name, date: Date.now(), world: world.serialize(), meta: { proj: state.proj, target: state.target, angle: state.angle, speedK: state.speedK } };
}
function restore(s) {
  world.deserialize(s.world);
  renderer.onWorldResized();
  renderer.resize();
  if (s.meta) { Object.assign(state, s.meta); syncControls(); }
  state.custom = true; renderer.setGhost(null); state.shot = null; updateHud(); syncScaleSel();
}
function buildSaves() {
  const el = $('saveList'); const saves = getSaves();
  if (!saves.length) { el.innerHTML = `<p class="hint">${t('noSaves')}</p>`; return; }
  el.innerHTML = '';
  saves.forEach((s, i) => {
    const d = document.createElement('div'); d.className = 'save';
    d.innerHTML = `<span title="${new Date(s.date).toLocaleString()}">${s.name}</span><button>${t('load')}</button><button>${t('del')}</button>`;
    const [bl, bd] = d.querySelectorAll('button');
    bl.onclick = () => restore(s);
    bd.onclick = () => { const a = getSaves(); a.splice(i, 1); localStorage.setItem(SAVE_KEY, JSON.stringify(a)); buildSaves(); };
    el.appendChild(d);
  });
}

// ------------------------------------------------------------------ wiring
function syncControls() {
  fillSelect($('projSel'), PROJECTILES, PROJ_CATS, state.proj);
  fillSelect($('targetSel'), TARGETS, TARGET_CATS, state.target);
  $('speed').value = state.speedK; $('angle').value = state.angle; $('angleOut').textContent = `${state.angle}°`;
  projInfo(); updateSpeedOut();
}

function buildExperiments() {
  const el = $('expList'); el.innerHTML = '';
  for (const ex of EXPERIMENTS) {
    const b = document.createElement('button');
    b.className = 'card';
    const [ti, de] = ex[lang] || ex.ru;
    b.innerHTML = `<div class="t">${ti}</div><div class="d">${de}</div>`;
    b.onclick = () => {
      state.proj = ex.proj; state.target = ex.target; state.angle = ex.angle; state.speedK = 50;
      syncControls(); rebuild();
      sound.init();
      setTimeout(fire, 300);
    };
    el.appendChild(b);
  }
}

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $('btnLang').textContent = lang === 'ru' ? 'EN' : 'RU';
  $('helpBody').innerHTML = t('helpBody');
  renderer.units = [t('mm'), t('m')];
  buildExperiments(); buildTools(); buildPalette(); buildMatSel(); buildSaves(); syncControls(); updateHud(); setRunning(state.running);
}

document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab));
  if (b.dataset.tab === 'shoot' && state.tool !== 'shoot') setTool('shoot');
});

$('projSel').onchange = (e) => { state.proj = e.target.value; state.speedK = 50; $('speed').value = 50; projInfo(); updateSpeedOut(); rebuild(); };
$('targetSel').onchange = (e) => { state.target = e.target.value; rebuild(); };
$('speed').oninput = (e) => { state.speedK = +e.target.value; updateSpeedOut(); if (state.scene) { state.scene.speed = speedOf(); updateHud(); } };
$('angle').oninput = (e) => { state.angle = +e.target.value; $('angleOut').textContent = `${state.angle}°`; };
$('angle').onchange = () => rebuild();
$('btnFire').onclick = fire;
$('btnFireTop').onclick = fire;
$('btnRebuild').onclick = rebuild;
$('btnReset').onclick = rebuild;
$('btnPlay').onclick = () => setRunning(!state.running);
$('btnStep').onclick = () => { setRunning(false); stepOnce = true; };
$('timeScale').oninput = (e) => { world.timeScale = +e.target.value; $('timeScaleOut').textContent = `${(+e.target.value).toFixed(2).replace(/\.?0+$/, '')}×`; };
$('quality').value = savedQ;
$('quality').onchange = (e) => {
  localStorage.setItem('as_quality', e.target.value);
  const [w, h] = e.target.value.split('x').map(Number);
  world.resize(w, h);
  renderer.onWorldResized();
  rebuild();
};
$('btnSound').textContent = sound.enabled ? '🔊' : '🔇';
$('btnSound').onclick = () => { sound.enabled = !sound.enabled; localStorage.setItem('as_sound', sound.enabled ? '1' : '0'); $('btnSound').textContent = sound.enabled ? '🔊' : '🔇'; sound.init(); };
$('btnLang').onclick = () => { lang = lang === 'ru' ? 'en' : 'ru'; localStorage.setItem('as_lang', lang); applyLang(); };
$('btnHelp').onclick = () => { $('help').hidden = false; };
$('helpClose').onclick = () => { $('help').hidden = true; };
$('help').onclick = (e) => { if (e.target.id === 'help') $('help').hidden = true; };
$('brushSize').oninput = (e) => { state.brush = +e.target.value; $('brushOut').textContent = state.brush; };
$('btnClear').onclick = () => { world.clear(); markCustom(); state.shot = null; };
$('btnClearParticles').onclick = () => { world.np = 0; world.groups.clear(); };
$('scaleSel').onchange = (e) => { world.cellMM = +e.target.value; renderer.buildBackground(); markCustom(); };
$('matSel').onchange = buildMatProps;
$('btnMatReset').onclick = () => { resetMaterial(+$('matSel').value); buildMatProps(); };
$('btnMatResetAll').onclick = () => { for (let i = 1; i < MATERIALS.length; i++) resetMaterial(i); buildMatProps(); };
$('btnSave').onclick = () => {
  const name = $('saveName').value.trim() || `${nm(PROJ[state.proj])} → ${nm(TARGET[state.target])}`;
  const a = getSaves(); a.unshift(snapshot(name));
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(a.slice(0, 30))); } catch { a.pop(); }
  $('saveName').value = ''; buildSaves();
};
$('btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(snapshot('export'))], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `armorsandbox-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importFile').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { restore(JSON.parse(await f.text())); } catch { alert(t('importErr')); }
  e.target.value = '';
};
$('btnShot').onclick = () => {
  const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `armorsandbox-${Date.now()}.png`; a.click();
};

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); fire(); }
  else if (e.code === 'KeyP') setRunning(!state.running);
  else if (e.code === 'KeyS') { setRunning(false); stepOnce = true; }
  else if (e.code === 'KeyR') rebuild();
  else if (e.code === 'Escape') $('help').hidden = true;
  else if (/^Digit[1-8]$/.test(e.code)) setTool(TOOLS[+e.code.slice(5) - 1][0]);
});

// ------------------------------------------------------------------ start
applyLang();
renderer.resize();
rebuild();
requestAnimationFrame(loop);
window.__armor = { world, state, renderer };
