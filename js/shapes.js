// Projectile and target definitions + rasterisers.
// Everything is described in millimetres and rasterised at the scene's mm-per-cell scale.

import { MAT, MATERIALS } from './materials.js';
import { ROLE_BODY, ROLE_FILLER, ROLE_LINER } from './engine.js';

// ----------------------------------------------------------------- projectiles
// Part primitives (x along the axis from tail = 0 to nose = L, y = 0 on the axis):
//  rect   {x0,x1,r}             solid cylinder
//  cone   {x0,x1,r0,r1}         solid frustum, radius r0 at x0 → r1 at x1
//  ogive  {x0,x1,r}             tangent-ish nose: full radius at x0, point at x1
//  sphere {cx,r}
//  liner  {x0,x1,r1,w}          conical shell, apex at x0 (r=0), base radius r1 at x1
//  tube   {x0,x1,r,w}           hollow cylinder wall
// mat: material key or null (carve out)

function radiusAt(p, x) {
  switch (p.t) {
    case 'rect': return x >= p.x0 && x <= p.x1 ? p.r : -1;
    case 'cone': return x >= p.x0 && x <= p.x1 ? p.r0 + (p.r1 - p.r0) * (x - p.x0) / (p.x1 - p.x0) : -1;
    case 'ogive': {
      if (x < p.x0 || x > p.x1) return -1;
      const u = (x - p.x0) / (p.x1 - p.x0);
      return p.r * Math.sqrt(Math.max(0, 1 - u * u));
    }
    default: return -1;
  }
}

function inside(p, x, y, cell) {
  const ay = Math.abs(y);
  switch (p.t) {
    case 'sphere': return (x - p.cx) ** 2 + y * y <= p.r * p.r;
    case 'liner': {
      if (x < p.x0 - cell * 0.5 || x > p.x1) return false;
      const rc = Math.max(0, (x - p.x0) / (p.x1 - p.x0) * p.r1);
      return Math.abs(ay - rc) <= Math.max(p.w, cell) * 0.5 + 1e-6;
    }
    case 'tube': {
      if (x < p.x0 || x > p.x1) return false;
      return ay <= p.r && ay >= p.r - Math.max(p.w, cell * 0.9);
    }
    default: {
      const r = radiusAt(p, x);
      return r >= 0 && ay <= r;
    }
  }
}

export function projectileLength(def) {
  return def.len;
}

export function rasterizeProjectile(def, cellMM) {
  const L = def.len, R = def.radius;
  const w = Math.max(1, Math.ceil(L / cellMM));
  const h = Math.max(1, Math.ceil((2 * R) / cellMM));
  const n = w * h;
  const mat = new Uint8Array(n), role = new Uint8Array(n), charge = new Uint8Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) * (L / w);
      const y = (j + 0.5 - h / 2) * cellMM;
      const k = j * w + i;
      for (const p of def.parts) {
        if (!inside(p, x, y, cellMM)) continue;
        if (!p.mat) { mat[k] = 0; role[k] = 0; charge[k] = 0; continue; }
        mat[k] = MAT[p.mat]; role[k] = p.role || ROLE_BODY; charge[k] = p.charge || 0;
      }
    }
  }
  // fillers / liners thinner than a cell must not vanish (no filler = no explosion)
  for (const p of def.parts) {
    if (!p.role || !p.mat) continue;
    let found = false;
    for (let k = 0; k < n; k++) if (role[k] === p.role && charge[k] === (p.charge || 0)) { found = true; break; }
    if (found) continue;
    const xc = p.t === 'sphere' ? p.cx : (p.x0 + p.x1) / 2;
    const i = Math.min(w - 1, Math.max(0, Math.floor(xc / (L / w))));
    const j = (h / 2) | 0;
    const k = j * w + i;
    mat[k] = MAT[p.mat]; role[k] = p.role; charge[k] = p.charge || 0;
  }
  // tiny projectile relative to the cell – keep at least one cell of its core
  let any = false;
  for (let k = 0; k < n; k++) if (mat[k]) { any = true; break; }
  if (!any) {
    const core = def.parts.find(p => p.core) || def.parts[0];
    const k = ((h / 2) | 0) * w + (w - 1);
    mat[k] = MAT[core.mat];
  }
  return { w, h, mat, role, charge };
}

// helpers to build typical rounds
function bullet({ cal, len, core = 'lead', jacket = 'brass', tipCore = null, tipLen = 0.45, eff = 0.5 }) {
  const r = cal / 2, body = len * 0.58, jt = Math.max(0.4, cal * 0.07);
  const parts = [
    { t: 'rect', x0: 0, x1: body, r, mat: jacket },
    { t: 'ogive', x0: body, x1: len, r, mat: jacket },
    { t: 'rect', x0: len * 0.04, x1: body, r: r - jt, mat: core, core: true },
    { t: 'ogive', x0: body, x1: len - jt * 1.5, r: r - jt, mat: core },
  ];
  if (tipCore) {
    parts.push({ t: 'rect', x0: len * (1 - tipLen) - len * 0.2, x1: body, r: r - jt * 1.2, mat: tipCore, core: true });
    parts.push({ t: 'ogive', x0: body, x1: len - jt * 1.6, r: r - jt * 1.2, mat: tipCore });
  }
  return { len, radius: r, parts, eff };
}

function rod({ len, dia, mat, fins = true, tip = 'mild', eff = 0.8 }) {
  const r = dia / 2;
  const parts = [
    { t: 'rect', x0: 0, x1: len * 0.93, r, mat, core: true },
    { t: 'cone', x0: len * 0.93, x1: len, r0: r, r1: r * 0.25, mat: tip },
  ];
  if (fins) parts.unshift({ t: 'cone', x0: 0, x1: len * 0.12, r0: r * 2.6, r1: r * 1.1, mat: 'alu' });
  return { len, radius: fins ? r * 2.6 : r, parts, eff };
}

function apShell({ cal, len, filler = 0, cap = true, mat = 'hhs', ballistic = true }) {
  const r = cal / 2;
  const parts = [
    { t: 'rect', x0: 0, x1: len * 0.62, r, mat, core: true },
    { t: 'ogive', x0: len * 0.62, x1: len * (ballistic ? 0.84 : 1), r, mat },
  ];
  if (ballistic) {
    // hollow windshield
    parts.push({ t: 'ogive', x0: len * 0.72, x1: len, r: r * 0.92, mat: 'mild' });
    parts.push({ t: 'ogive', x0: len * 0.76, x1: len * 0.985, r: r * 0.82, mat: null });
    parts.push({ t: 'ogive', x0: len * 0.62, x1: len * 0.84, r, mat });
  }
  if (filler > 0) {
    parts.push({ t: 'rect', x0: len * 0.12, x1: len * (0.12 + filler), r: r * 0.24, mat: 'rdx', role: ROLE_FILLER });
  }
  return { len, radius: r, parts };
}

function heShell({ cal, len, wall = 0.12, filler = 'tnt' }) {
  const r = cal / 2, wt = cal * wall;
  return {
    len, radius: r, parts: [
      { t: 'rect', x0: 0, x1: len * 0.66, r, mat: 'mild', core: true },
      { t: 'ogive', x0: len * 0.66, x1: len * 0.97, r, mat: 'mild' },
      { t: 'rect', x0: len * 0.08, x1: len * 0.66, r: r - wt, mat: filler, role: ROLE_FILLER },
      { t: 'ogive', x0: len * 0.66, x1: len * 0.9, r: r - wt, mat: filler, role: ROLE_FILLER },
      { t: 'cone', x0: len * 0.9, x1: len, r0: r * 0.25, r1: r * 0.12, mat: 'alu' },
    ],
  };
}

function heshShell({ cal, len }) {
  const r = cal / 2, wt = Math.max(3, cal * 0.04);
  return {
    len, radius: r, parts: [
      { t: 'rect', x0: 0, x1: len * 0.7, r, mat: 'mild', core: true },
      { t: 'ogive', x0: len * 0.7, x1: len, r, mat: 'mild' },
      { t: 'rect', x0: len * 0.08, x1: len * 0.7, r: r - wt, mat: 'pe4', role: ROLE_FILLER },
      { t: 'ogive', x0: len * 0.7, x1: len - wt, r: r - wt, mat: 'pe4', role: ROLE_FILLER },
    ],
  };
}

// shaped-charge warhead at x0..x0+wlen, nose standoff up to x0+wlen+standoff
function shapedCharge({ x0, cal, wlen, standoff, charge = 0, nose = true }) {
  const r = cal / 2, wt = Math.max(1.5, cal * 0.035);
  const apex = x0 + wlen * 0.35, base = x0 + wlen;
  const parts = [
    { t: 'tube', x0, x1: base, r, w: wt, mat: 'mild', charge },
    { t: 'rect', x0: x0 + wt, x1: base, r: r - wt, mat: 'rdx', role: ROLE_FILLER, charge },
    { t: 'cone', x0: apex, x1: base + 0.01, r0: 0, r1: r - wt, mat: null },
    { t: 'liner', x0: apex, x1: base, r1: r - wt, w: Math.max(1.2, cal * 0.025), mat: 'copper', role: ROLE_LINER, charge },
  ];
  if (nose) {
    parts.push({ t: 'cone', x0: base, x1: base + standoff, r0: r, r1: r * 0.18, mat: 'alu', charge });
    parts.push({ t: 'cone', x0: base - 0.01, x1: base + standoff * 0.96, r0: r - wt, r1: r * 0.1, mat: null });
    parts.push({ t: 'rect', x0: base + standoff * 0.9, x1: base + standoff, r: r * 0.16, mat: 'brass', charge });
  }
  return parts;
}

const P = (o) => o;

export const PROJECTILES = [
  // ---------------------------------------------------------- small arms
  P({ key: '9mm', cat: 'small', name: { ru: '9×19 мм Парабеллум (FMJ)', en: '9×19mm Parabellum FMJ' }, speed: 360,
    ...bullet({ cal: 9.0, len: 15.6 }) }),
  P({ key: '556', cat: 'small', name: { ru: '5,56×45 мм SS109', en: '5.56×45mm SS109' }, speed: 940,
    ...bullet({ cal: 5.7, len: 23, tipCore: 'hhs', tipLen: 0.3 }) }),
  P({ key: '762ps', cat: 'small', name: { ru: '7,62×39 мм ПС (стальной сердечник)', en: '7.62×39mm PS (steel core)' }, speed: 715,
    ...bullet({ cal: 7.9, len: 26.8, core: 'mild', jacket: 'brass' }) }),
  P({ key: '762b32', cat: 'small', name: { ru: '7,62×54R Б-32 (бронебойный)', en: '7.62×54R B-32 AP' }, speed: 820,
    ...bullet({ cal: 7.9, len: 37, tipCore: 'hhs', tipLen: 0.75, eff: 0.32 }) }),
  P({ key: '127ap', cat: 'small', name: { ru: '12,7×99 мм M2 AP', en: '.50 BMG M2 AP' }, speed: 890,
    ...bullet({ cal: 13, len: 59, tipCore: 'hhs', tipLen: 0.7 }) }),
  P({ key: '145bs41', cat: 'small', name: { ru: '14,5×114 мм БС-41 (карбид вольфрама)', en: '14.5×114mm BS-41 (WC core)' }, speed: 1000,
    ...bullet({ cal: 14.9, len: 66, tipCore: 'wc', tipLen: 0.6, eff: 0.45 }) }),
  P({ key: '30apfsds', cat: 'small', name: { ru: '30 мм БОПС (вольфрам)', en: '30mm APFSDS (tungsten)' }, speed: 1405,
    ...rod({ len: 120, dia: 12, mat: 'wha' }) }),

  // ---------------------------------------------------------- WWII
  P({ key: '76m62', cat: 'ww2', name: { ru: '76 мм M62 APC (Шерман)', en: '76mm M62 APC (Sherman)' }, speed: 792,
    fuze: { charges: [{ delay: 450 }] },
    ...apShell({ cal: 76.2, len: 300, filler: 0.08 }) }),
  P({ key: '85br365', cat: 'ww2', name: { ru: '85 мм БР-365 (Т-34-85)', en: '85mm BR-365 (T-34-85)' }, speed: 792,
    fuze: { charges: [{ delay: 450 }] },
    ...apShell({ cal: 85, len: 300, filler: 0.12, ballistic: false }), eff: 0.85 }),
  P({ key: '88pzgr39', cat: 'ww2', name: { ru: '88 мм PzGr 39 (Тигр I)', en: '88mm PzGr 39 (Tiger I)' }, speed: 773,
    fuze: { charges: [{ delay: 500 }] },
    ...apShell({ cal: 88, len: 370, filler: 0.12 }) }),
  P({ key: '122br471', cat: 'ww2', name: { ru: '122 мм БР-471 (ИС-2)', en: '122mm BR-471 (IS-2)' }, speed: 795,
    fuze: { charges: [{ delay: 500 }] },
    ...apShell({ cal: 122, len: 440, filler: 0.14, ballistic: false }) }),

  // ---------------------------------------------------------- modern tank rounds
  P({ key: '120dm53', cat: 'tank', name: { ru: '120 мм DM53 (БОПС, вольфрам)', en: '120mm DM53 APFSDS (W)' }, speed: 1670,
    ...rod({ len: 680, dia: 26, mat: 'wha', eff: 0.82 }) }),
  P({ key: '120m829a3', cat: 'tank', name: { ru: '120 мм M829A3 (БОПС, уран)', en: '120mm M829A3 APFSDS (DU)' }, speed: 1555,
    ...rod({ len: 800, dia: 25, mat: 'du', eff: 0.8 }) }),
  P({ key: '125mango', cat: 'tank', name: { ru: '125 мм 3БМ42 «Манго»', en: '125mm 3BM42 Mango' }, speed: 1700,
    ...rod({ len: 570, dia: 24, mat: 'wha', eff: 0.8 }) }),
  P({ key: '125bk18', cat: 'tank', name: { ru: '125 мм 3БК18М (кумулятивный)', en: '125mm 3BK18M HEAT' }, speed: 905,
    fuze: { charges: [{ delay: 0, jet: { penRHA: 550, vtip: 8300, vtail: 1800 } }] },
    len: 680, radius: 62.5, parts: [
      { t: 'cone', x0: 0, x1: 60, r0: 62.5 * 1.3, r1: 40, mat: 'mild' },
      { t: 'rect', x0: 0, x1: 120, r: 40, mat: 'mild' },
      ...shapedCharge({ x0: 120, cal: 125, wlen: 260, standoff: 300 }),
    ] }),
  P({ key: '105hesh', cat: 'tank', name: { ru: '105 мм L64 (фугасный, HESH)', en: '105mm L64 HESH' }, speed: 730,
    fuze: { charges: [{ delay: 250 }], fuzeSens: 0.05 },
    ...heshShell({ cal: 105, len: 450 }) }),
  P({ key: '152he', cat: 'tank', name: { ru: '152 мм ОФ-540 (осколочно-фугасный)', en: '152mm OF-540 HE-FRAG' }, speed: 650,
    fuze: { charges: [{ delay: 0 }] },
    ...heShell({ cal: 152, len: 700 }) }),

  // ---------------------------------------------------------- rockets & missiles
  P({ key: 'pg7vl', cat: 'missile', name: { ru: 'ПГ-7ВЛ (РПГ-7)', en: 'PG-7VL (RPG-7)' }, speed: 300,
    fuze: { charges: [{ delay: 0, jet: { penRHA: 500, vtip: 8000, vtail: 1500 } }] },
    len: 900, radius: 46.5, parts: [
      { t: 'cone', x0: 0, x1: 60, r0: 46.5, r1: 22, mat: 'alu' },
      { t: 'tube', x0: 0, x1: 520, r: 22, w: 3, mat: 'mild' },
      { t: 'rect', x0: 40, x1: 500, r: 18, mat: 'propellant' },
      { t: 'cone', x0: 500, x1: 540, r0: 22, r1: 46.5, mat: 'mild' },
      ...shapedCharge({ x0: 540, cal: 93, wlen: 170, standoff: 190 }),
    ] }),
  P({ key: 'kornet', cat: 'missile', name: { ru: '9М133 «Корнет» (тандемный)', en: '9M133 Kornet (tandem)' }, speed: 300,
    fuze: { charges: [
      { delay: 0, jet: { penRHA: 250, vtip: 7500, vtail: 1500 } },
      { delay: 320, jet: { penRHA: 1050, vtip: 8800, vtail: 2000 } },
    ] },
    len: 1200, radius: 76, parts: [
      { t: 'tube', x0: 0, x1: 520, r: 76, w: 4, mat: 'alu', charge: 1 },
      { t: 'rect', x0: 30, x1: 480, r: 60, mat: 'propellant', charge: 1 },
      ...shapedCharge({ x0: 520, cal: 152, wlen: 330, standoff: 40, charge: 1, nose: false }),
      { t: 'rect', x0: 850, x1: 1000, r: 22, mat: 'alu', charge: 1 },
      ...shapedCharge({ x0: 1000, cal: 60, wlen: 110, standoff: 90, charge: 0 }),
    ] }),

  // ---------------------------------------------------------- fun
  P({ key: 'railgun', cat: 'fun', name: { ru: 'Рельсотрон (вольфрам, 3 км/с)', en: 'Railgun slug (W, 3 km/s)' }, speed: 3000,
    ...rod({ len: 160, dia: 40, mat: 'wha', fins: false, eff: 1 }) }),
  P({ key: 'goldbar', cat: 'fun', name: { ru: 'Золотой слиток', en: 'Gold bar' }, speed: 1200,
    len: 180, radius: 30, parts: [{ t: 'rect', x0: 0, x1: 180, r: 30, mat: 'gold', core: true }] }),
  P({ key: 'meteor', cat: 'fun', name: { ru: 'Метеорит (железо, 12 км/с)', en: 'Meteorite (iron, 12 km/s)' }, speed: 12000,
    len: 120, radius: 60, parts: [{ t: 'sphere', cx: 60, r: 60, mat: 'mild', core: true }] }),
];

export const PROJ = Object.fromEntries(PROJECTILES.map(p => [p.key, p]));
export const PROJ_CATS = [
  ['small', 'Стрелковое и МЗА', 'Small arms & autocannon'],
  ['ww2', 'Вторая мировая', 'World War II'],
  ['tank', 'Современные танковые', 'Modern tank rounds'],
  ['missile', 'Ракеты и ПТУР', 'Rockets & ATGMs'],
  ['fun', 'Для веселья', 'For fun'],
];

// --------------------------------------------------------------------- painter
// Paints shapes given in millimetres into the world grid.
export class Painter {
  constructor(world, ox = 0, oy = 0) {
    this.w = world; this.ox = ox; this.oy = oy; this.s = world.cellMM;
  }
  cx(x) { return (x + this.ox) / this.s; }
  cy(y) { return (y + this.oy) / this.s; }
  set(i, j, key) { this.w.setCell(i, j, key ? MAT[key] : 0); }

  poly(pts, key) {
    const P = pts.map(([x, y]) => [this.cx(x), this.cy(y)]);
    let y0 = Infinity, y1 = -Infinity;
    for (const p of P) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const jy0 = Math.max(0, Math.floor(y0)), jy1 = Math.min(this.w.H - 1, Math.ceil(y1));
    for (let j = jy0; j <= jy1; j++) {
      const yc = j + 0.5, xs = [];
      for (let k = 0; k < P.length; k++) {
        const a = P[k], b = P[(k + 1) % P.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let i0 = Math.round(xs[k]), i1 = Math.round(xs[k + 1]) - 1;
        if (i1 < i0 && xs[k + 1] - xs[k] > 0.25) i1 = i0; // keep thin plates at least one cell
        for (let i = Math.max(0, i0); i <= Math.min(this.w.W - 1, i1); i++) this.set(i, j, key);
      }
    }
  }

  rect(x, y, w, h, key) {
    // at least one cell thick so thin plates never vanish
    const i0 = Math.round(this.cx(x)), j0 = Math.round(this.cy(y));
    let i1 = Math.round(this.cx(x + w)), j1 = Math.round(this.cy(y + h));
    if (i1 <= i0) i1 = i0 + 1; if (j1 <= j0) j1 = j0 + 1;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) this.set(i, j, key);
  }

  rotRect(cx, cy, w, h, deg, key) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const minW = Math.max(w, this.s * 1.05);
    const pts = [[-minW / 2, -h / 2], [minW / 2, -h / 2], [minW / 2, h / 2], [-minW / 2, h / 2]]
      .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    this.poly(pts, key);
  }

  circle(cx, cy, r, key) {
    const i0 = Math.floor(this.cx(cx - r)), i1 = Math.ceil(this.cx(cx + r));
    const j0 = Math.floor(this.cy(cy - r)), j1 = Math.ceil(this.cy(cy + r));
    const rc = Math.max(r / this.s, 0.5);
    const ccx = this.cx(cx), ccy = this.cy(cy);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if ((i + 0.5 - ccx) ** 2 + (j + 0.5 - ccy) ** 2 <= rc * rc) this.set(i, j, key);
    }
  }

  ring(cx, cy, r, w, key) {
    const i0 = Math.floor(this.cx(cx - r)), i1 = Math.ceil(this.cx(cx + r));
    const j0 = Math.floor(this.cy(cy - r)), j1 = Math.ceil(this.cy(cy + r));
    const ro = r / this.s, ri = Math.max(0, (r - Math.max(w, this.s)) / this.s);
    const ccx = this.cx(cx), ccy = this.cy(cy);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d2 = (i + 0.5 - ccx) ** 2 + (j + 0.5 - ccy) ** 2;
      if (d2 <= ro * ro && d2 >= ri * ri) this.set(i, j, key);
    }
  }

  // armoured shell: outer polygon filled with armour, inner polygon (inset by per-edge thickness) cleared
  shell(pts, thick, key, innerKey = null) {
    this.poly(pts, key);
    const inner = insetPolygon(pts, thick.map(t => Math.max(t, this.s * 1.01)));
    if (inner) this.poly(inner, innerKey);
    return inner;
  }
}

// inset a clockwise/ccw polygon by per-edge distances (edge k goes from pts[k] to pts[k+1])
export function insetPolygon(pts, d) {
  const n = pts.length;
  let area = 0;
  for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const lines = [];
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1; nx = nx / l * sgn; ny = ny / l * sgn;
    lines.push([a[0] + nx * d[k], a[1] + ny * d[k], b[0] + nx * d[k], b[1] + ny * d[k]]);
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const L1 = lines[(k - 1 + n) % n], L2 = lines[k];
    const p = intersect(L1, L2);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

function intersect(a, b) {
  const [x1, y1, x2, y2] = a, [x3, y3, x4, y4] = b;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return [x2, y2];
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// ---------------------------------------------------------------------- targets
// Target local coordinates: x from 0 (front, facing the gun) to w, y from 0 (top) to h (bottom).
// aim: y (mm) of the default aim point.

function obliqueBox(t, h, deg) {
  const a = Math.abs(deg) * Math.PI / 180;
  return { w: t * Math.cos(a) + h * Math.sin(a), h: t * Math.sin(a) + h * Math.cos(a) };
}

function plateTarget(key, ru, en, t, mat = 'rha', plateH = null) {
  return {
    key, cat: 'plates', angled: true, name: { ru, en },
    size(angle) {
      const ph = plateH || Math.max(200, t * 2.4);
      const b = obliqueBox(t, ph, angle);
      return { w: b.w, h: Math.max(b.h, ph * 0.6), aim: Math.max(b.h, ph * 0.6) / 2 };
    },
    build(P, angle, sz) {
      const ph = plateH || Math.max(200, t * 2.4);
      P.rotRect(sz.w / 2, sz.h / 2, t, ph, -angle, mat);
    },
  };
}

function layered(key, ru, en, layers, plateH = 400, gaps = null) {
  const total = layers.reduce((s, l) => s + l[1], 0);
  return {
    key, cat: 'composite', angled: true, name: { ru, en },
    size(angle) {
      const b = obliqueBox(total, plateH, angle);
      return { w: b.w, h: b.h, aim: b.h / 2 };
    },
    build(P, angle, sz) {
      const a = -angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      let off = -total / 2;
      for (const [mat, th] of layers) {
        const mid = off + th / 2;
        if (mat) P.rotRect(sz.w / 2 + mid * c, sz.h / 2 + mid * s, th, plateH, -angle, mat);
        off += th;
      }
    },
  };
}

export const TARGETS = [
  plateTarget('rha10', 'Броня RHA 10 мм', 'RHA plate 10 mm', 10, 'rha', 120),
  plateTarget('rha20', 'Броня RHA 20 мм', 'RHA plate 20 mm', 20, 'rha', 160),
  plateTarget('rha50', 'Броня RHA 50 мм', 'RHA plate 50 mm', 50),
  plateTarget('rha100', 'Броня RHA 100 мм', 'RHA plate 100 mm', 100),
  plateTarget('rha200', 'Броня RHA 200 мм', 'RHA plate 200 mm', 200),
  plateTarget('rha400', 'Броня RHA 400 мм', 'RHA plate 400 mm', 400),
  plateTarget('rha700', 'Блок RHA 700 мм', 'RHA block 700 mm', 700, 'rha', 900),
  plateTarget('rha1000', 'Блок RHA 1000 мм', 'RHA block 1000 mm', 1000, 'rha', 1000),
  plateTarget('alu100', 'Алюминий 100 мм', 'Aluminium 100 mm', 100, 'alu'),
  plateTarget('hhs30', 'Высокотвёрдая сталь 30 мм', 'High-hard steel 30 mm', 30, 'hhs', 200),
  plateTarget('bedrock', 'Неразрушимая плита', 'Indestructible plate', 80, 'bedrock'),
  layered('spaced', 'Разнесённая броня 2×40 мм', 'Spaced armour 2×40 mm', [['rha', 40], [null, 250], ['rha', 40]]),
  layered('screens', 'Экран + броня 100 мм', 'Skirt + 100 mm armour', [['mild', 8], [null, 400], ['rha', 100]]),
  layered('composite', 'Комбинированная: сталь/керамика/сталь', 'Composite steel/ceramic/steel', [['rha', 60], ['alumina', 120], ['rha', 40], ['alumina', 120], ['rha', 60]], 500),
  layered('b4cvest', 'Бронежилет: карбид бора + СВМПЭ + гель', 'Body armour: B4C + UHMWPE + gel', [['b4c', 9], ['uhmwpe', 14], [null, 2], ['gel', 220]], 260),
  layered('era', 'Динамическая защита + 300 мм RHA', 'ERA + 300 mm RHA', [['rha', 15], ['era', 10], ['rha', 15], [null, 120], ['rha', 300]], 600),
  layered('nera', 'Сталь/резина/сталь ×3 (NERA)', 'Steel/rubber/steel ×3 (NERA)', [['rha', 20], ['rubber', 20], ['rha', 20], [null, 40], ['rha', 20], ['rubber', 20], ['rha', 20], [null, 40], ['rha', 20], ['rubber', 20], ['rha', 20], [null, 60], ['rha', 150]], 500),
  {
    key: 'concrete', cat: 'other', angled: false, name: { ru: 'Бетонная стена 600 мм', en: 'Concrete wall 600 mm' },
    size: () => ({ w: 600, h: 1400, aim: 700 }),
    build(P) {
      P.rect(0, 0, 600, 1400, 'rconcrete');
      for (let y = 80; y < 1400; y += 150) P.rect(0, y, 600, 12, 'mild');
    },
  },
  {
    key: 'bricks', cat: 'other', angled: false, name: { ru: 'Кирпичная стена', en: 'Brick wall' },
    size: () => ({ w: 380, h: 1200, aim: 600 }),
    build(P) {
      P.rect(0, 0, 380, 1200, 'concrete');
      for (let row = 0; row * 75 < 1200; row++) {
        const off = row % 2 ? 0 : 125;
        for (let x = -250 + off; x < 380; x += 250) P.rect(Math.max(0, x + 5), row * 75 + 5, Math.min(240, 380 - Math.max(0, x + 5)), 65, 'brick');
      }
    },
  },
  {
    key: 'gel', cat: 'other', angled: false, name: { ru: 'Блок баллистического геля', en: 'Ballistic gelatin block' },
    size: () => ({ w: 400, h: 160, aim: 80 }),
    build(P) { P.rect(0, 0, 400, 160, 'gel'); },
  },
  {
    key: 'glass', cat: 'other', angled: false, name: { ru: 'Бронестекло (стекло + поликарбонат)', en: 'Bullet-resistant glass' },
    size: () => ({ w: 70, h: 260, aim: 130 }),
    build(P) {
      for (let k = 0; k < 5; k++) P.rect(k * 12, 0, 10, 260, 'glass');
      P.rect(60, 0, 10, 260, 'uhmwpe');
    },
  },
  {
    key: 'watertank', cat: 'other', angled: false, name: { ru: 'Бак с водой', en: 'Water tank' },
    size: () => ({ w: 600, h: 500, aim: 300 }),
    build(P) {
      P.rect(0, 0, 8, 500, 'mild'); P.rect(592, 0, 8, 500, 'mild'); P.rect(0, 492, 600, 8, 'mild');
      P.rect(8, 60, 584, 432, 'water');
    },
  },
  {
    key: 'bunker', cat: 'other', angled: false, name: { ru: 'ДОТ с бойцами', en: 'Pillbox with crew' },
    size: () => ({ w: 3200, h: 2400, aim: 1500 }),
    build(P) {
      P.poly([[0, 2400], [300, 600], [3200, 600], [3200, 2400]], 'rconcrete');
      P.poly([[700, 2400], [900, 1100], [2700, 1100], [2700, 2400]], null);
      P.rect(0, 1350, 900, 260, null); // embrasure
      P.rect(2400, 0, 800, 600, 'sand');
      dummy(P, 1300, 2400, 1.0); dummy(P, 2000, 2400, 1.0);
      P.rect(2300, 2000, 300, 400, 'wood');
      P.rect(2340, 2040, 220, 150, 'tnt');
    },
  },
];

// --------------------------------------------------------------------- tanks
// crew dummy standing at x (centre) with feet on y, scale s
function dummy(P, x, y, s = 1, sit = false) {
  const hh = sit ? 1150 * s : 1750 * s;
  P.circle(x, y - hh + 110 * s, 110 * s, 'dummy');
  P.rect(x - 160 * s, y - hh + 230 * s, 320 * s, 560 * s, 'dummy');
  if (sit) {
    P.rect(x - 160 * s, y - hh + 760 * s, 520 * s, 180 * s, 'dummy');
    P.rect(x + 220 * s, y - hh + 760 * s, 140 * s, 390 * s, 'dummy');
  } else {
    P.rect(x - 150 * s, y - hh + 790 * s, 130 * s, 960 * s, 'dummy');
    P.rect(x + 20 * s, y - hh + 790 * s, 130 * s, 960 * s, 'dummy');
  }
}

function ammoRound(P, x, y, w, h, vertical = false) {
  // case of propellant + projectile with HE filler
  if (vertical) {
    P.rect(x, y + h * 0.35, w, h * 0.65, 'propellant');
    P.rect(x, y, w, h * 0.38, 'mild');
    P.rect(x + w * 0.25, y + h * 0.08, w * 0.5, h * 0.22, 'tnt');
  } else {
    P.rect(x + w * 0.35, y, w * 0.65, h, 'propellant');
    P.rect(x, y, w * 0.38, h, 'mild');
    P.rect(x + w * 0.08, y + h * 0.25, w * 0.22, h * 0.5, 'tnt');
  }
}

function wheels(P, x0, x1, yGround, r, n, trackT = 60) {
  const step = (x1 - x0 - 2 * r) / Math.max(1, n - 1);
  for (let k = 0; k < n; k++) {
    const cx = x0 + r + k * step;
    P.circle(cx, yGround - r - trackT, r, 'rubber');
    P.circle(cx, yGround - r - trackT, r * 0.85, 'mild');
    P.circle(cx, yGround - r - trackT, r * 0.25, 'cast');
  }
  // track: bottom run and top run
  P.rect(x0, yGround - trackT, x1 - x0, trackT, 'mild');
  P.rect(x0 + r * 0.5, yGround - 2 * r - trackT * 2, x1 - x0 - r, trackT, 'mild');
  P.circle(x0 + r * 0.6, yGround - r - trackT * 1.2, r * 0.75, 'cast');
  P.circle(x1 - r * 0.6, yGround - r - trackT * 1.2, r * 0.75, 'cast');
}

// spec in mm. Tank faces -x (towards the gun).
function makeTank(spec) {
  const s = spec;
  const over = Math.max(0, s.gunLen - s.turretX + 150);
  const w = over + s.hullL;
  const h = s.height + 200;
  return {
    key: s.key, cat: 'tanks', angled: false, name: s.name,
    size: () => ({ w, h, aim: s.aimY ?? (h - s.clearance - s.hullH - s.turretH * 0.27) }),
    ground: true,
    build(P) {
      const X = over; // hull nose x
      const G = h;   // ground y
      const belly = G - s.clearance, deck = belly - s.hullH;
      const noseY = deck + s.hullH * s.noseFrac;
      const ufpX = X + (noseY - deck) * Math.tan(s.ufpAngle * Math.PI / 180);
      const lfpX = X + (belly - noseY) * Math.tan(s.lfpAngle * Math.PI / 180);
      const rear = X + s.hullL;
      wheels(P, X + s.hullL * 0.05, rear - s.hullL * 0.02, G, s.wheelR, s.wheels, s.trackT || 60);
      // hull shell
      const hull = [[X, noseY], [ufpX, deck], [rear, deck], [rear, belly - s.hullH * 0.25], [rear - 150, belly], [lfpX, belly]];
      const ufpT = s.ufpT, lfpT = s.lfpT;
      P.shell(hull, [ufpT, s.roofT, s.rearT, s.rearT, s.bellyT, lfpT], s.hullMat || 'rha');
      if (s.ufpInsert) {
        // composite insert in the upper glacis
        const ins = insetPolygon([[X, noseY], [ufpX, deck], [rear, deck], [rear, belly], [lfpX, belly]], [s.ufpInsert.offset, 0, 0, 0, 0]);
        if (ins) {
          const ins2 = insetPolygon([[X, noseY], [ufpX, deck], [rear, deck], [rear, belly], [lfpX, belly]], [s.ufpInsert.offset + s.ufpInsert.t, 0, 0, 0, 0]);
          P.poly([ins[0], ins[1], ins2[1], ins2[0]], s.ufpInsert.mat);
        }
      }
      // interior: driver, fuel, engine, ammo
      const inX0 = lfpX + 120, engineX = rear - s.engineL;
      // engine block
      P.rect(engineX + 80, deck + s.roofT + 60, s.engineL - 200, s.hullH - s.roofT - s.bellyT - 160, 'cast');
      P.rect(engineX + 200, deck + s.roofT + 140, s.engineL - 440, (s.hullH - s.roofT - s.bellyT) * 0.45, 'alu');
      P.rect(engineX + 20, deck + s.roofT + 20, 50, s.hullH - s.roofT - s.bellyT - 40, 'mild'); // firewall
      // fuel tanks
      if (s.fuelFront) {
        const fx = ufpX + 150, fy = deck + s.roofT + 30;
        P.rect(fx, fy, 520, s.hullH * 0.45, 'mild');
        P.rect(fx + 15, fy + 15, 490, s.hullH * 0.45 - 30, 'diesel');
      }
      const fRx = engineX - 520, fRy = belly - s.bellyT - 380;
      P.rect(fRx, fRy, 480, 360, 'mild'); P.rect(fRx + 15, fRy + 15, 450, 330, 'diesel');
      // driver
      dummy(P, (s.fuelFront ? ufpX + 820 : inX0 + 420), belly - s.bellyT, s.crewScale || 0.85, true);
      // turret
      const tx = X + s.turretX, ty = deck;
      const tH = s.turretH, tL = s.turretL;
      const turret = s.turretShape === 'box'
        ? [[tx, ty - tH], [tx + tL, ty - tH], [tx + tL, ty], [tx, ty]]
        : [[tx, ty - tH * 0.25], [tx + tH * 0.75 * Math.tan(s.tfAngle * Math.PI / 180), ty - tH], [tx + tL - 150, ty - tH], [tx + tL, ty - tH * 0.45], [tx + tL - 100, ty], [tx + 40, ty]];
      const tThick = s.turretShape === 'box' ? [s.roofT * 1.2, s.tRearT, s.tRearT, s.tfT] : [s.tfT, s.troofT, s.tRearT, s.tRearT, s.tRearT, s.tfT * 0.6];
      // turret ring opening in the hull roof
      P.rect(tx + 200, deck - 1, Math.min(tL - 400, s.ring || 1800), s.roofT + 2, null);
      P.shell(turret, tThick, s.turretMat || 'cast');
      // composite cheek
      if (s.cheek) {
        const ch = s.cheek;
        let off = 0;
        for (const [m, t] of ch.layers) {
          P.rect(tx + 60 + off, ty - tH * 0.85, t, tH * 0.7, m);
          off += t;
        }
      }
      // ERA bricks
      if (s.era) {
        for (let k = 0; k < 3; k++) {
          const ey = ty - tH * 0.8 + k * tH * 0.26;
          P.rect(tx - 140, ey, 40, tH * 0.22, 'mild');
          P.rect(tx - 100, ey, 20, tH * 0.22, 'era');
          P.rect(tx - 80, ey, 40, tH * 0.22, 'mild');
        }
        const n = 4;
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n;
          const px = X + (ufpX - X) * u, py = noseY + (deck - noseY) * u;
          P.rotRect(px - 70, py - 30, 60, (noseY - deck) / n / Math.cos(s.ufpAngle * Math.PI / 180) * 0.8, s.ufpAngle, 'era');
        }
      }
      // gun + mantlet
      const gy = ty - tH * (s.gunY ?? 0.55);
      P.rect(tx - 120, gy - s.mantletH / 2, 260, s.mantletH, s.mantletMat || 'cast');
      P.rect(tx - s.gunLen, gy - s.caliber * 0.9, s.gunLen, s.caliber * 1.8, 'mild');
      P.rect(tx - s.gunLen, gy - s.caliber / 2, s.gunLen + 200, s.caliber, null);
      P.rect(tx + 140, gy - s.caliber, 700, s.caliber * 2, 'mild'); // breech
      // crew in turret
      dummy(P, tx + tL * 0.45, deck + (s.basketDepth ?? 450), s.crewScale || 0.85, true);
      if (s.crew >= 4) dummy(P, tx + tL * 0.72, deck + (s.basketDepth ?? 450), s.crewScale || 0.85, true);
      // ammo
      if (s.carousel) {
        // autoloader carousel under the turret floor
        const cy = belly - s.bellyT - 110;
        for (let k = 0; k < 9; k++) ammoRound(P, tx + 120 + k * 200, cy - 100, 180, 110);
        for (let k = 0; k < 8; k++) ammoRound(P, tx + 220 + k * 200, cy - 210, 180, 100);
      }
      if (s.bustle) {
        const bx = tx + tL - s.bustle - 60, by = ty - tH + s.troofT + 40;
        P.rect(bx - 40, by, 40, tH - s.troofT - 120, 'rha'); // blast door
        for (let k = 0; k < 3; k++) for (let r = 0; r < Math.floor(s.bustle / 150); r++) ammoRound(P, bx + 10 + r * 150, by + 20 + k * 150, 130, 110, true);
        P.rect(bx, ty - tH - 10, s.bustle, s.troofT * 0.6, null); // blow-off panels
        P.rect(bx, ty - tH - 10, s.bustle, s.troofT * 0.25, 'alu');
      }
      if (s.hullRack) {
        const n = s.hullRack;
        for (let k = 0; k < n; k++) ammoRound(P, tx + 100 + k * 150, belly - s.bellyT - 560, 130, 520, true);
      }
    },
  };
}

export const TANKS = [
  makeTank({
    key: 't3485', name: { ru: 'Т-34-85', en: 'T-34-85' },
    hullL: 6100, hullH: 1300, clearance: 400, height: 2720, noseFrac: 0.55,
    ufpAngle: 60, ufpT: 45, lfpAngle: 53, lfpT: 45, roofT: 20, rearT: 45, bellyT: 20,
    turretX: 1650, turretH: 900, turretL: 2600, tfAngle: 25, tfT: 90, troofT: 20, tRearT: 75,
    gunLen: 2900, caliber: 85, mantletH: 400, wheels: 5, wheelR: 400, engineL: 1900,
    crew: 4, hullRack: 6,
  }),
  makeTank({
    key: 'tiger', name: { ru: 'Tiger I', en: 'Tiger I' },
    hullL: 6300, hullH: 1500, clearance: 470, height: 3000, noseFrac: 0.45,
    ufpAngle: 10, ufpT: 100, lfpAngle: 65, lfpT: 100, roofT: 26, rearT: 80, bellyT: 26,
    turretX: 1750, turretH: 950, turretL: 2900, turretShape: 'box', tfT: 100, troofT: 26, tRearT: 80,
    turretMat: 'rha', gunLen: 3200, caliber: 88, mantletH: 560, mantletMat: 'rha', wheels: 8, wheelR: 400, engineL: 1900,
    crew: 4, hullRack: 8,
  }),
  makeTank({
    key: 'sherman', name: { ru: 'M4A3 Шерман', en: 'M4A3 Sherman' },
    hullL: 5900, hullH: 1500, clearance: 430, height: 2900, noseFrac: 0.5,
    ufpAngle: 47, ufpT: 64, lfpAngle: 40, lfpT: 51, roofT: 19, rearT: 38, bellyT: 13,
    turretX: 1800, turretH: 850, turretL: 2500, tfAngle: 20, tfT: 76, troofT: 25, tRearT: 64,
    gunLen: 2400, caliber: 76, mantletH: 420, wheels: 6, wheelR: 330, engineL: 2000,
    crew: 4, hullRack: 7,
  }),
  makeTank({
    key: 'is2', name: { ru: 'ИС-2', en: 'IS-2' },
    hullL: 6800, hullH: 1400, clearance: 420, height: 2730, noseFrac: 0.5,
    ufpAngle: 60, ufpT: 120, lfpAngle: 30, lfpT: 100, roofT: 30, rearT: 60, bellyT: 20,
    turretX: 1900, turretH: 900, turretL: 2800, tfAngle: 30, tfT: 100, troofT: 30, tRearT: 90,
    gunLen: 3000, caliber: 122, mantletH: 500, wheels: 6, wheelR: 400, engineL: 2000,
    crew: 4, hullRack: 5,
  }),
  makeTank({
    key: 't72b', name: { ru: 'Т-72Б', en: 'T-72B' },
    hullL: 6900, hullH: 1350, clearance: 470, height: 2230, noseFrac: 0.55,
    ufpAngle: 68, ufpT: 80, lfpAngle: 55, lfpT: 85, roofT: 20, rearT: 40, bellyT: 20,
    ufpInsert: { offset: 60, t: 105, mat: 'alumina' },
    turretX: 2350, turretH: 820, turretL: 2550, tfAngle: 40, tfT: 140, troofT: 45, tRearT: 70,
    cheek: { layers: [['cast', 120], ['rubber', 40], ['rha', 60], ['rubber', 40], ['rha', 60], ['cast', 180]] },
    gunLen: 3400, caliber: 125, mantletH: 420, wheels: 6, wheelR: 380, engineL: 1800,
    crew: 3, carousel: true, fuelFront: true, basketDepth: 300,
  }),
  makeTank({
    key: 't72era', name: { ru: 'Т-72Б с «Контакт-1» (ДЗ)', en: 'T-72B with Kontakt-1 ERA' },
    hullL: 6900, hullH: 1350, clearance: 470, height: 2230, noseFrac: 0.55,
    ufpAngle: 68, ufpT: 80, lfpAngle: 55, lfpT: 85, roofT: 20, rearT: 40, bellyT: 20,
    ufpInsert: { offset: 60, t: 105, mat: 'alumina' },
    turretX: 2350, turretH: 820, turretL: 2550, tfAngle: 40, tfT: 140, troofT: 45, tRearT: 70,
    cheek: { layers: [['cast', 120], ['rubber', 40], ['rha', 60], ['rubber', 40], ['rha', 60], ['cast', 180]] },
    gunLen: 3400, caliber: 125, mantletH: 420, wheels: 6, wheelR: 380, engineL: 1800,
    crew: 3, carousel: true, fuelFront: true, basketDepth: 300, era: true,
  }),
  makeTank({
    key: 'm1a2', name: { ru: 'M1A2 Абрамс', en: 'M1A2 Abrams' },
    hullL: 7900, hullH: 1300, clearance: 480, height: 2440, noseFrac: 0.45,
    ufpAngle: 82, ufpT: 50, lfpAngle: 40, lfpT: 70, roofT: 25, rearT: 40, bellyT: 25,
    turretX: 2200, turretH: 760, turretL: 3900, tfAngle: 15, tfT: 60, troofT: 40, tRearT: 40, turretMat: 'rha',
    cheek: { layers: [['rha', 60], ['alumina', 160], ['rha', 40], ['du', 50], ['alumina', 160], ['rha', 40], ['kevlar', 40]] },
    gunLen: 3800, caliber: 120, mantletH: 400, mantletMat: 'rha', wheels: 7, wheelR: 330, engineL: 2100,
    crew: 4, bustle: 900, basketDepth: 450,
  }),
  makeTank({
    key: 'leo2a6', name: { ru: 'Leopard 2A6', en: 'Leopard 2A6' },
    hullL: 7700, hullH: 1350, clearance: 500, height: 2640, noseFrac: 0.45,
    ufpAngle: 81, ufpT: 60, lfpAngle: 35, lfpT: 80, roofT: 25, rearT: 40, bellyT: 25,
    turretX: 2300, turretH: 800, turretL: 3700, tfAngle: 10, tfT: 60, troofT: 40, tRearT: 50, turretMat: 'rha',
    cheek: { layers: [['hhs', 30], [null, 200], ['rha', 60], ['alumina', 120], ['rha', 40], ['rubber', 30], ['rha', 40], ['alumina', 120], ['rha', 60]] },
    gunLen: 5100, caliber: 120, mantletH: 420, mantletMat: 'rha', wheels: 7, wheelR: 350, engineL: 2200,
    crew: 4, bustle: 800, hullRack: 4, basketDepth: 450,
  }),
  makeTank({
    key: 'bmp1', name: { ru: 'БМП-1', en: 'BMP-1' },
    hullL: 6700, hullH: 1300, clearance: 390, height: 2070, noseFrac: 0.6,
    ufpAngle: 80, ufpT: 7, lfpAngle: 57, lfpT: 19, roofT: 6, rearT: 16, bellyT: 6, hullMat: 'hhs',
    turretX: 2600, turretH: 500, turretL: 1500, tfAngle: 40, tfT: 23, troofT: 6, tRearT: 6, turretMat: 'hhs',
    gunLen: 1300, caliber: 73, mantletH: 220, wheels: 6, wheelR: 360, engineL: 1400,
    crew: 4, hullRack: 4, fuelFront: false, basketDepth: 300,
  }),
];

for (const t of TANKS) TARGETS.push(t);

export const TARGET = Object.fromEntries(TARGETS.map(t => [t.key, t]));
export const TARGET_CATS = [
  ['plates', 'Плиты', 'Plates'],
  ['composite', 'Многослойная броня', 'Layered armour'],
  ['other', 'Стены, гель, прочее', 'Walls, gel & more'],
  ['tanks', 'Танки в разрезе', 'Tank cutaways'],
];

export { MATERIALS };
