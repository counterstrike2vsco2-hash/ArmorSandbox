// ArmorSandbox Web – physics core.
// A grid of material cells (armour, structures, loose rubble, liquids) plus a pool of
// free particles (projectiles, shaped-charge jets, fragments, fire, smoke).
// No DOM access here, so the core also runs headless in Node for calibration tests.

import { MATERIALS, MAT, STATE } from './materials.js';

export const EMPTY = 0, FIXED = 1, LOOSE = 2;
export const K_DEBRIS = 0, K_PROJ = 1, K_JET = 2, K_FIRE = 3, K_SMOKE = 4, K_SPARK = 5;
export const ROLE_BODY = 0, ROLE_FILLER = 1, ROLE_LINER = 2;

const PASS = 0, STOP = 1, DEAD = 2;

// Tunables (calibrated in test/calibrate.mjs)
export const TUNE = {
  erosion: 1.0,     // hydrodynamic erosion coefficient of rods
  lowv: 4.0,        // extra erosion at low striking energy (Tate strength term)
  jetErosion: 1.9,  // shaped-charge jet erosion (jets are mass-calibrated anyway)
  jetEff: 1.22,     // compensates crater widening & stretching losses so jets reach their rated RHA
  cd: 0.35,         // dynamic-pressure coefficient of the target
  cost: 0.5,        // fraction of the destroy energy taken from the penetrator
  rigid: 1.2,       // rigid-body (sub-threshold) penetration efficiency of full-calibre shot
  ricochet: 0.55,   // ricochet threshold factor
  gravity: 0.035,   // visual gravity, cells / frame^2 at time scale 1
};

const AMBIENT = 20;

export class World {
  constructor(w = 640, h = 360, cap = 160000) {
    this.cap = cap;
    this.px = new Float32Array(cap); this.py = new Float32Array(cap);
    this.pvx = new Float32Array(cap); this.pvy = new Float32Array(cap);
    this.ptemp = new Float32Array(cap); this.php = new Float32Array(cap);
    this.plife = new Float32Array(cap);
    this.pmat = new Uint8Array(cap); this.pkind = new Uint8Array(cap);
    this.prole = new Uint8Array(cap); this.pcharge = new Uint8Array(cap);
    this.pgroup = new Uint16Array(cap);
    this.resize(w, h);
    this.cellMM = 2;
    this.timeScale = 1;
    this.groups = new Map();
    this.nextGroup = 1;
    this.events = [];
  }

  resize(w, h) {
    this.W = w; this.H = h; this.N = w * h;
    const N = this.N;
    this.mat = new Uint8Array(N);
    this.st = new Uint8Array(N);
    this.hp = new Float32Array(N);
    this.temp = new Float32Array(N).fill(AMBIENT);
    this.shade = new Uint8Array(N);
    this.burning = new Uint8Array(N);
    this.visit = new Uint8Array(N);
    this.stack = new Int32Array(N);
    for (let i = 0; i < N; i++) this.shade[i] = (Math.random() * 255) | 0;
    this.clear();
  }

  clear() {
    this.mat.fill(0); this.st.fill(0); this.hp.fill(0); this.temp.fill(AMBIENT); this.burning.fill(0);
    this.np = 0;
    this.time = 0; // seconds of simulated time
    this.frame = 0;
    this.detQueue = [];
    this.zones = [];
    this.pendingPartDet = null;
    this.groups = new Map();
    this.events = [];
    this.looseCount = 0;
    this.resetTracking();
  }

  resetTracking(x0 = 0, y0 = 0, dx = 1, dy = 0, lat = 1e9) {
    this.track = { x0, y0, dx, dy, lat, first: null, maxDepth: 0, destroyed: 0 };
  }

  get cellM() { return this.cellMM / 1000; }
  // seconds per frame: 1000 m/s travels 2.5 cells per frame at time scale 1
  get dt() { return this.timeScale * 2.5 * this.cellM / 1000; }

  idx(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }

  // ------------------------------------------------------------------ cells
  setCell(x, y, id, force = true) {
    if (!this.inside(x, y)) return;
    const c = y * this.W + x;
    if (!force && this.st[c]) return;
    if (!id) { this.clearCell(c); return; }
    const m = MATERIALS[id];
    if (this.st[c] === LOOSE) this.looseCount--;
    this.mat[c] = id;
    this.st[c] = m.state === STATE.SOLID ? FIXED : LOOSE;
    if (this.st[c] === LOOSE) this.looseCount++;
    this.hp[c] = 1;
    this.temp[c] = AMBIENT;
    this.burning[c] = 0;
  }

  clearCell(c) {
    if (this.st[c] === LOOSE) this.looseCount--;
    this.mat[c] = 0; this.st[c] = EMPTY; this.hp[c] = 0; this.temp[c] = AMBIENT; this.burning[c] = 0;
  }

  // ------------------------------------------------------------ particles
  spawn(x, y, vx, vy, mat, kind, temp = AMBIENT, life = -1) {
    if (this.np >= this.cap) return -1;
    const i = this.np++;
    this.px[i] = x; this.py[i] = y; this.pvx[i] = vx; this.pvy[i] = vy;
    this.pmat[i] = mat; this.pkind[i] = kind; this.ptemp[i] = temp; this.php[i] = 1;
    this.plife[i] = life; this.prole[i] = 0; this.pcharge[i] = 0; this.pgroup[i] = 0;
    return i;
  }

  kill(i) {
    const j = --this.np;
    if (i !== j) {
      this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pvx[i] = this.pvx[j]; this.pvy[i] = this.pvy[j];
      this.ptemp[i] = this.ptemp[j]; this.php[i] = this.php[j]; this.plife[i] = this.plife[j];
      this.pmat[i] = this.pmat[j]; this.pkind[i] = this.pkind[j]; this.prole[i] = this.prole[j];
      this.pcharge[i] = this.pcharge[j]; this.pgroup[i] = this.pgroup[j];
    }
  }

  // turn a cell into a flying fragment
  destroyCell(c, vx, vy, spread = 0.3, dT = 0) {
    const id = this.mat[c];
    if (!id) return -1;
    const x = c % this.W, y = (c / this.W) | 0;
    const t = this.temp[c] + dT;
    this.clearCell(c);
    const sp = Math.hypot(vx, vy) * spread;
    return this.spawn(x + 0.5, y + 0.5, vx + (Math.random() - 0.5) * 2 * sp, vy + (Math.random() - 0.5) * 2 * sp, id, K_DEBRIS, t);
  }

  // -------------------------------------------------------------- shooting
  // sprite: {w, h, mat:Uint8Array, role:Uint8Array, charge:Uint8Array} – nose at x = w-1
  fireSprite(sprite, x, y, angle, speed, def = {}) {
    const g = this.nextGroup++;
    if (this.nextGroup > 65000) this.nextGroup = 1;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const vx = ca * speed, vy = sa * speed;
    let n = 0;
    for (let j = 0; j < sprite.h; j++) for (let i = 0; i < sprite.w; i++) {
      const k = j * sprite.w + i, m = sprite.mat[k];
      if (!m) continue;
      const lx = i - (sprite.w - 1), ly = j - (sprite.h - 1) / 2;
      const p = this.spawn(x + lx * ca - ly * sa, y + lx * sa + ly * ca, vx, vy, m, K_PROJ);
      if (p < 0) break;
      this.pgroup[p] = g; this.prole[p] = sprite.role[k]; this.pcharge[p] = sprite.charge[k];
      this.php[p] = def.eff || 1;
      n++;
    }
    const charges = (def.charges || []).map(c => ({ ...c, done: false }));
    this.groups.set(g, {
      id: g, def, charges, triggered: false, tTrigger: 0,
      dir: [ca, sa], speed, count: n, fuzeSens: def.fuzeSens ?? 0.05,
    });
    this.resetTracking(x, y, ca, sa, sprite.h * 1.5 + 4);
    this.events.push({ type: 'fire', x, y, speed });
    return g;
  }

  groupImpact(gid, Ep) {
    const g = this.groups.get(gid);
    if (!g || g.triggered || !g.charges.length) return;
    if (Ep < g.fuzeSens) return;
    g.triggered = true;
    g.tTrigger = this.time;
  }

  processGroups() {
    for (const g of this.groups.values()) {
      if (!g.triggered) continue;
      let pending = false;
      for (let ci = 0; ci < g.charges.length; ci++) {
        const ch = g.charges[ci];
        if (ch.done) continue;
        if ((this.time - g.tTrigger) * 1e6 >= (ch.delay || 0)) { ch.done = true; this.fireCharge(g, ci, ch); }
        else pending = true;
      }
      if (!pending) this.groups.delete(g.id);
    }
  }

  fireCharge(g, ci, ch) {
    let ex = 0, ey = 0, en = 0, p0 = 0, low = 0;
    const liner = [];
    for (let i = 0; i < this.np; i++) {
      if (this.pgroup[i] !== g.id || this.pcharge[i] !== ci) continue;
      if (this.prole[i] === ROLE_FILLER) {
        const m = MATERIALS[this.pmat[i]];
        ex += this.px[i]; ey += this.py[i]; en++; p0 += m.P0 || 10; if (m.low) low++;
        this.pkind[i] = 255; // mark for removal
      } else if (this.prole[i] === ROLE_LINER && this.pkind[i] !== K_JET) {
        liner.push(i);
      }
    }
    // remove consumed filler
    for (let i = 0; i < this.np; i++) if (this.pkind[i] === 255) { this.kill(i); i--; }
    // liner indices may have shifted after kills: rebuild
    liner.length = 0;
    for (let i = 0; i < this.np; i++) if (this.pgroup[i] === g.id && this.pcharge[i] === ci && this.prole[i] === ROLE_LINER && this.pkind[i] !== K_JET) liner.push(i);

    if (liner.length && ch.jet) this.formJet(g, liner, ch.jet);
    if (en > 0) this.explode(ex / en, ey / en, en, p0 / en, low > en / 2, g.id, ci);
  }

  formJet(g, idxs, jet) {
    const [ux, uy] = g.dir;
    let cx = 0, cy = 0;
    for (const i of idxs) { cx += this.px[i]; cy += this.py[i]; }
    cx /= idxs.length; cy /= idxs.length;
    let smin = 1e9, smax = -1e9;
    for (const i of idxs) {
      const s = (this.px[i] - cx) * ux + (this.py[i] - cy) * uy;
      if (s < smin) smin = s; if (s > smax) smax = s;
    }
    const range = Math.max(1e-3, smax - smin);
    const ax = cx + ux * smin, ay = cy + uy * smin;
    // forward speed the round still has
    let fwd = 0;
    for (const i of idxs) fwd += this.pvx[i] * ux + this.pvy[i] * uy;
    fwd = Math.max(0, fwd / idxs.length);
    const jetIdx = [];
    for (const i of idxs) {
      const s = (this.px[i] - cx) * ux + (this.py[i] - cy) * uy;
      const r = -(this.px[i] - cx) * uy + (this.py[i] - cy) * ux;
      const f = 1 - (s - smin) / range; // apex (rear) -> fastest
      if (f < 0.18) { // slug
        const v = fwd + 500 + 600 * f;
        this.pvx[i] = ux * v; this.pvy[i] = uy * v; this.pkind[i] = K_DEBRIS; this.ptemp[i] = 600;
        continue;
      }
      const v = fwd + jet.vtail + (jet.vtip - jet.vtail) * Math.pow((f - 0.18) / 0.82, 1.2);
      const off = Math.random() * 1.5;
      this.px[i] = ax + ux * off;
      this.py[i] = ay + uy * off;
      this.pvx[i] = ux * v; this.pvy[i] = uy * v;
      this.pkind[i] = K_JET; this.ptemp[i] = 500;
      jetIdx.push(i);
    }
    // calibrate jet "mass" so the jet perforates its rated RHA thickness
    const m = MATERIALS[MAT.copper], t = MATERIALS[MAT.rha];
    const eRef = Math.sqrt(t.density / m.density) * TUNE.jetErosion;
    const cells = jet.penRHA / this.cellMM;
    const hp = Math.max(0.2, cells * eRef / Math.max(1, jetIdx.length) * (jet.eff || 1) * TUNE.jetEff);
    for (const i of jetIdx) this.php[i] = hp;
    this.events.push({ type: 'jet', x: ax, y: ay });
  }

  // ------------------------------------------------------------ explosions
  queueDetonation(c) { this.detQueue.push(c); }

  processDetonations() {
    if (!this.detQueue.length) return;
    const q = this.detQueue; this.detQueue = [];
    const { W, H, mat, st, visit, stack } = this;
    for (const start of q) {
      const m0 = MATERIALS[mat[start]];
      if (!m0 || !m0.P0 || st[start] === EMPTY) continue;
      const low = m0.low;
      let sp = 0, n = 0, sx = 0, sy = 0, p0 = 0;
      const touched = [];
      stack[sp++] = start; visit[start] = 1; touched.push(start);
      while (sp > 0 && n < 5000) {
        const c = stack[--sp];
        const m = MATERIALS[mat[c]];
        sx += c % W; sy += (c / W) | 0; n++; p0 += m.P0;
        this.clearCell(c);
        const x = c % W, y = (c / W) | 0;
        const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
        for (const d of nb) {
          if (d < 0 || visit[d] || st[d] === EMPTY) continue;
          const md = MATERIALS[mat[d]];
          if (!md.P0 || md.low !== low) continue;
          visit[d] = 1; touched.push(d); stack[sp++] = d;
        }
      }
      for (const c of touched) visit[c] = 0;
      if (n) this.explode(sx / n + 0.5, sy / n + 0.5, n, p0 / n, low, 0);
    }
  }

  lineBlocked(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (n < 2) return false;
    const sx = dx / n, sy = dy / n;
    let x = x0, y = y0;
    for (let k = 1; k < n; k++) {
      x += sx; y += sy;
      const c = (y | 0) * this.W + (x | 0);
      if (this.st[c] === FIXED) return true;
    }
    return false;
  }

  explode(cx, cy, count, P0, low = false, owner = 0, ownerCharge = -1) {
    const { W, H, st, mat, hp, temp } = this;
    const cellMM = this.cellMM;
    const rc = Math.max(0.8, Math.sqrt(count / Math.PI));
    const reach = low ? 6 : 13;
    const R = Math.min(rc * reach + 4, 300);
    const pAt = d => P0 * Math.pow(rc / (rc + d), 1.25);
    const rays = Math.max(64, Math.min(1800, Math.round(2 * Math.PI * R * 1.3)));
    const a0 = Math.random() * Math.PI * 2;
    const step = 0.7;
    for (let r = 0; r < rays; r++) {
      const a = a0 + (r / rays) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      let atten = 1, last = -1;
      for (let d = 0; d < R; d += step) {
        const x = cx + ca * d, y = cy + sa * d;
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        const ix = x | 0, iy = y | 0, c = iy * W + ix;
        if (c === last) continue;
        last = c;
        const s = st[c];
        if (s === EMPTY) continue;
        const p = pAt(d) * atten;
        if (p < 0.008) break;
        const m = MATERIALS[mat[c]];
        if (m.P0 > 0) { this.queueDetonation(c); atten *= 0.75; continue; }
        if (m.ignite > 0) { temp[c] += Math.min(900, p * 300); }
        else temp[c] += Math.min(300, p * 40);
        if (s === LOOSE) {
          const v = Math.min(2500, Math.sqrt(2 * p / m.density) * 1000 * 0.5);
          this.destroyCell(c, ca * v, sa * v, 0.35);
          atten *= 0.85;
          continue;
        }
        const res = m.R * hp[c];
        if (p > res) {
          const v = Math.min(3000, Math.sqrt(2 * (p - res) / m.density) * 1000 * 0.6 + 40);
          this.destroyCell(c, ca * v, sa * v, 0.25, p * 30);
          atten *= Math.max(0.12, 1 - 0.85 * res / p);
          continue;
        }
        if (m.R < 1e8) { hp[c] -= 0.25 * p / m.R; if (hp[c] <= 0.02) { this.destroyCell(c, ca * 60, sa * 60, 0.5); continue; } }
        // shock wave runs through the solid; tensile reflection at the free back face spalls it
        let pp = p, jx = x, jy = y, lastSolid = c, exitC = -1;
        for (let k = 0; k < 800; k++) {
          jx += ca * step; jy += sa * step;
          if (jx < 0 || jy < 0 || jx >= W || jy >= H) break;
          const cc = (jy | 0) * W + (jx | 0);
          const sc = st[cc];
          if (sc === FIXED) {
            pp *= Math.exp(-cellMM * step / MATERIALS[mat[cc]].atten);
            lastSolid = cc;
          } else { exitC = cc; break; }
        }
        if (exitC >= 0 && st[exitC] === EMPTY) {
          const sm = MATERIALS[mat[lastSolid]];
          if (sm && sm.R < 1e8 && pp > sm.spall * hp[lastSolid]) {
            const v = Math.min(1800, Math.sqrt(Math.max(0, 2 * (pp - sm.spall * hp[lastSolid]) / sm.density)) * 1000 * 0.55 + 60);
            // detach 1-3 cells of the back face
            let n = Math.min(3, 1 + Math.floor(pp / (sm.spall * 3)));
            let bx = lastSolid % W + 0.5, by = ((lastSolid / W) | 0) + 0.5, prev = -1;
            while (n > 0) {
              const bc = (by | 0) * W + (bx | 0);
              if (bc !== prev) {
                if (st[bc] !== FIXED || MATERIALS[mat[bc]].R >= 1e8) break;
                this.destroyCell(bc, ca * v, sa * v, 0.5, 50);
                prev = bc; n--;
              }
              bx -= ca * step; by -= sa * step;
              if (bx < 0 || by < 0 || bx >= W || by >= H) break;
            }
            this.events.push({ type: 'spall', x: lastSolid % W, y: (lastSolid / W) | 0 });
          }
        }
        break;
      }
    }

    // push free particles
    const R2 = R * R;
    const chain = [];
    for (let i = 0; i < this.np; i++) {
      const k = this.pkind[i];
      const dx = this.px[i] - cx, dy = this.py[i] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      if (owner && this.pgroup[i] === owner && (k === K_JET || this.pcharge[i] !== ownerCharge)) continue;
      if (k === K_FIRE || k === K_SMOKE) continue;
      const d = Math.sqrt(d2) + 1e-3;
      if (d > 2 && this.lineBlocked(cx, cy, this.px[i], this.py[i])) continue;
      const p = pAt(d);
      const m = MATERIALS[this.pmat[i]];
      if (m.P0 > 0 && !m.low && p > 1.5 && this.prole[i] !== ROLE_FILLER) { chain.push(i); continue; }
      if (m.P0 > 0 && m.low) this.ptemp[i] += 400;
      const dv = Math.min(3200, Math.sqrt(2 * p / m.density) * 1000 * 0.55);
      if (k === K_JET) {
        // ERA / blast disruption of a shaped-charge jet
        this.pvx[i] += (dx / d) * dv * 0.12 + (Math.random() - 0.5) * dv * 0.25;
        this.pvy[i] += (dy / d) * dv * 0.12 + (Math.random() - 0.5) * dv * 0.25;
        this.php[i] *= Math.max(0.15, 1 - p * 0.06);
        continue;
      }
      this.pvx[i] += (dx / d) * dv; this.pvy[i] += (dy / d) * dv;
      this.ptemp[i] += Math.min(800, p * 60);
      if (k === K_PROJ && p > 1) this.pkind[i] = K_DEBRIS;
    }
    if (chain.length) {
      let sx = 0, sy = 0, sp = 0;
      for (const i of chain) { sx += this.px[i]; sy += this.py[i]; sp += MATERIALS[this.pmat[i]].P0; this.pkind[i] = 255; }
      const n = chain.length;
      this.pendingPartDet = { x: sx / n, y: sy / n, n, p0: sp / n };
      for (let i = 0; i < this.np; i++) if (this.pkind[i] === 255) { this.kill(i); i--; }
    }

    // fire & smoke
    const cpf = this.cellM / this.dt; // m/s per (cell/frame)
    const nFire = Math.min(low ? 1200 : 900, Math.round((low ? 30 : 25) + count * (low ? 6 : 3)));
    for (let k = 0; k < nFire; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = R * (0.03 + Math.random() * (low ? 0.07 : 0.11));
      const rr = Math.random() * rc;
      this.spawn(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.cos(a) * sp * cpf, Math.sin(a) * sp * cpf,
        MAT.fire, K_FIRE, 2200, 14 + Math.random() * (low ? 70 : 40));
    }
    const nSmoke = Math.min(500, 10 + count * 2);
    for (let k = 0; k < nSmoke; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = R * (0.01 + Math.random() * 0.04);
      this.spawn(cx + (Math.random() - 0.5) * rc, cy + (Math.random() - 0.5) * rc, Math.cos(a) * sp * cpf, Math.sin(a) * sp * cpf,
        MAT.smoke, K_SMOKE, 300, 80 + Math.random() * 160);
    }
    // the expanding detonation products / flying plates keep disrupting jets for a while (ERA effect)
    if (!low) this.zones.push({ x: cx, y: cy, r: rc * 2.2 + 3, until: this.time + 160e-6 * Math.min(3, Math.max(0.6, rc * this.cellMM / 25)), owner });
    this.events.push({ type: 'explosion', x: cx, y: cy, r: R, power: count * P0, low });
  }

  // ------------------------------------------------------------- collisions
  surfaceNormal(x, y, dirx, diry) {
    let nx = 0, ny = 0;
    const { W, H, st } = this;
    for (let dy = -3; dy <= 3; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= W) continue;
        if (st[yy * W + xx] !== FIXED) { nx += dx; ny += dy; }
      }
    }
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) return [-dirx, -diry];
    return [nx / l, ny / l];
  }

  bounce(i, ncx, ncy, cx, cy, e) {
    if (ncx !== cx) { this.pvx[i] = -this.pvx[i] * e; this.pvy[i] *= 0.75; }
    if (ncy !== cy) { this.pvy[i] = -this.pvy[i] * e; this.pvx[i] *= 0.75; }
  }

  // projectile particle becomes spray / fragment
  erode(i, v, dirx, diry) {
    const m = MATERIALS[this.pmat[i]];
    const a = Math.atan2(-diry, -dirx) + (Math.random() - 0.5) * 1.4;
    const s = v * (0.03 + Math.random() * 0.09);
    this.pvx[i] = Math.cos(a) * s; this.pvy[i] = Math.sin(a) * s;
    this.pkind[i] = m.pyro ? K_SPARK : K_DEBRIS;
    this.php[i] = 1;
    this.ptemp[i] = Math.max(this.ptemp[i], m.pyro ? 2200 : 700);
    if (m.pyro) this.plife[i] = 40 + Math.random() * 60;
  }

  collide(i, c, ncx, ncy, cx, cy) {
    const k = this.pkind[i];
    const st = this.st, hp = this.hp;
    const tmId = this.mat[c], tm = MATERIALS[tmId];
    if (k === K_FIRE || k === K_SMOKE) {
      if (k === K_FIRE) {
        this.temp[c] += tm.ignite ? 25 : 4;
      }
      this.pvx[i] *= -0.2; this.pvy[i] *= -0.2;
      return STOP;
    }
    const pm = MATERIALS[this.pmat[i]];
    const vx = this.pvx[i], vy = this.pvy[i];
    const v2 = vx * vx + vy * vy;
    const vk2 = v2 * 1e-6;
    const Ep = 0.5 * pm.density * vk2;

    if (k === K_SPARK && tm.ignite) this.temp[c] += 120;

    if (st[c] === LOOSE) {
      if (Ep > 0.01) {
        const share = pm.density / (pm.density + tm.density);
        if (k === K_PROJ || k === K_JET) {
          // rubble in the channel is shoved aside, not driven ahead
          const v = Math.sqrt(v2), a = Math.atan2(-vy, -vx) + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.8);
          const sv = Math.min(v * 0.1, 300);
          this.destroyCell(c, Math.cos(a) * sv, Math.sin(a) * sv, 0.3, Math.min(400, Ep * 20));
        } else this.destroyCell(c, vx * share * 0.9, vy * share * 0.9, 0.4, Math.min(400, Ep * 20));
        const slow = (k === K_PROJ || k === K_JET) ? 0.985 : Math.sqrt(share);
        this.pvx[i] *= slow; this.pvy[i] *= slow;
        return PASS;
      }
      this.bounce(i, ncx, ncy, cx, cy, 0.1);
      return STOP;
    }

    // fixed cell
    if (Ep < 0.012) { this.bounce(i, ncx, ncy, cx, cy, 0.25); return STOP; }
    const isPen = k === K_PROJ || k === K_JET;
    if (this.pgroup[i]) this.groupImpact(this.pgroup[i], Ep);
    if (tm.P0 > 0 && Ep > tm.sens) this.queueDetonation(c);
    if (tm.ignite && Ep > 0.5) this.temp[c] += Ep * 8;

    const v = Math.sqrt(v2);
    const dirx = vx / v, diry = vy / v;
    if (isPen && !this.track.first) this.track.first = [ncx, ncy];

    if (tm.R >= 1e8) {
      if (k === K_JET || Ep > 20) { this.erode(i, v, dirx, diry); return STOP; }
      this.bounce(i, ncx, ncy, cx, cy, 0.3);
      if (k === K_PROJ) this.pkind[i] = K_DEBRIS;
      return STOP;
    }

    // ricochet off an oblique face
    if (k !== K_JET) {
      const [nx, ny] = this.surfaceNormal(ncx, ncy, dirx, diry);
      const cosI = -(dirx * nx + diry * ny);
      if (cosI > 0 && cosI < 0.5) {
        const En = Ep * cosI * cosI;
        const res = tm.R * hp[c];
        const hr = Math.min(2, Math.max(0.5, tm.hard / Math.max(0.3, pm.hard)));
        if (En < res * TUNE.ricochet * hr) {
          const vn = vx * nx + vy * ny;
          this.pvx[i] = (vx - 1.25 * vn * nx) * 0.85;
          this.pvy[i] = (vy - 1.25 * vn * ny) * 0.85;
          hp[c] -= Math.min(0.5, En / res * 0.06);
          this.temp[c] += En * 30;
          this.ptemp[i] += En * 30;
          if (hp[c] <= 0.02) this.destroyCell(c, vx * 0.2, vy * 0.2, 0.5);
          if (Ep > 0.5) this.events.push({ type: 'ricochet', x: ncx, y: ncy, e: Ep });
          return STOP;
        }
      }
    }

    const Pt = tm.R + 0.5 * tm.density * vk2 * TUNE.cd;
    const h = Math.max(isPen ? 0.02 : 0.5, hp[c]);
    if (Ep >= Pt * h) {
      const ratio = Ep / Pt;
      // penetrator erosion per cell of target pushed aside
      let e = 0;
      if (k === K_JET) e = Math.sqrt(tm.density / pm.density) * TUNE.jetErosion;
      else if (k === K_PROJ) {
        // hydrodynamic term (falls with velocity), capped so it joins the rigid-penetration regime smoothly
        const hardP = Math.pow(Math.min(2, Math.max(0.15, pm.hard / Math.max(0.3, tm.hard))), 0.8);
        const eh = Math.sqrt(tm.density / pm.density) * TUNE.erosion * Math.pow(tm.hard / Math.max(0.3, pm.hard), 0.5)
          * (1 + TUNE.lowv * tm.R / Ep);
        e = Math.min(eh, 1 / hardP) * (1 + pm.brittle * 0.6);
        // soft targets (gel, water, wood) barely erode a penetrator – it is stopped by drag instead
        e *= Math.min(1, Math.max(0.02, tm.R));
      }
      // penetrator runs out part-way through this cell
      if (isPen && this.php[i] < e * h) {
        hp[c] -= this.php[i] / e;
        this.temp[c] += Math.min(400, Ep * 20);
        if (hp[c] <= 0.02) this.destroyCell(c, -vx * 0.04, -vy * 0.04, 0.5);
        this.erode(i, v, dirx, diry);
        return STOP;
      }
      const share = pm.density / (pm.density + tm.density);
      const fv = (k === K_JET ? 0.25 : 0.8) * share;
      const ax0 = Math.round(ncx + dirx * 1.5), ay0 = Math.round(ncy + diry * 1.5);
      const exiting = !this.inside(ax0, ay0) || st[ay0 * this.W + ax0] === EMPTY;
      if (exiting) {
        // plug / exit fragments fly forward
        this.destroyCell(c, vx * fv, vy * fv, 0.35 + tm.brittle * 0.4, Math.min(1500, Ep * 25));
      } else {
        // crater ejecta flows back and sideways out of the channel
        const a = Math.atan2(-diry, -dirx) + (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.6);
        const sv = v * (0.03 + Math.random() * 0.08) * (k === K_JET ? 0.5 : 1);
        this.destroyCell(c, Math.cos(a) * sv, Math.sin(a) * sv, 0.2, Math.min(1500, Ep * 25));
      }
      if (isPen) {
        const t = this.track;
        const rx = ncx - t.x0, ry = ncy - t.y0;
        const lat = Math.abs(-rx * t.dy + ry * t.dx);
        if (lat <= t.lat) {
          const d = (ncx - t.first[0]) * t.dx + (ncy - t.first[1]) * t.dy + 1;
          if (d > t.maxDepth) t.maxDepth = d;
        }
        t.destroyed++;
      }
      this.php[i] -= e * h;
      // crater widening
      const wp = k === K_JET ? 0.75 : Math.min(0.85, ratio * 0.12);
      if (isPen && ratio > 1.3 && Math.random() < wp) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const reach = k === K_JET ? 1 + ((Math.random() * 2.2) | 0) : 1;
        const wx = Math.round(ncx - diry * side * reach), wy = Math.round(ncy + dirx * side * reach);
        if (this.inside(wx, wy)) {
          const wc = wy * this.W + wx;
          if (st[wc] === FIXED) {
            const wm = MATERIALS[this.mat[wc]];
            if (wm.R < 1e8) {
              const wd = Math.min(1, hp[wc], 0.35 * ratio * (Pt / (wm.R + 0.5 * wm.density * vk2 * TUNE.cd)));
              hp[wc] -= wd;
              this.php[i] -= e * wd * Math.sqrt(wm.density / tm.density) * (k === K_JET ? 0.5 : 1);
              if (hp[wc] <= 0.02) this.destroyCell(wc, (-dirx * 0.6 - diry * side * 0.4) * v * 0.06, (-diry * 0.6 + dirx * side * 0.4) * v * 0.06, 0.4);
            }
          }
        }
      }
      // brittle cracking
      if (tm.brittle > 0.4) {
        for (let n = 0; n < 2; n++) {
          const bx = ncx + ((Math.random() * 7) | 0) - 3, by = ncy + ((Math.random() * 7) | 0) - 3;
          if (!this.inside(bx, by)) continue;
          const bc = by * this.W + bx;
          if (st[bc] !== FIXED || this.mat[bc] !== tmId) continue;
          hp[bc] -= tm.brittle * 0.18 * Math.min(4, ratio);
          if (hp[bc] <= 0.02) this.destroyCell(bc, vx * fv * 0.5, vy * fv * 0.5, 0.8);
        }
      }
      // back-face spall cone
      if (exiting && ratio > 2) {
        const rs = Math.min(4, 1 + ratio * 0.08) | 0;
        const prob = 0.12 + tm.brittle * 0.5;
        for (let yy = -rs; yy <= rs; yy++) for (let xx = -rs; xx <= rs; xx++) {
          if (xx * xx + yy * yy > rs * rs) continue;
          const sx = ncx + xx, sy = ncy + yy;
          if (!this.inside(sx, sy)) continue;
          const sc = sy * this.W + sx;
          if (st[sc] !== FIXED || Math.random() > prob) continue;
          if (MATERIALS[this.mat[sc]].R >= 1e8) continue;
          const fx = Math.round(sx + dirx), fy = Math.round(sy + diry);
          if (this.inside(fx, fy) && st[fy * this.W + fx] !== EMPTY) continue;
          const sv = v * share * (0.25 + Math.random() * 0.35);
          this.destroyCell(sc, dirx * sv, diry * sv, 0.6, 80);
        }
      }
      this.ptemp[i] += Math.min(400, Pt * 30);
      if (isPen && this.php[i] <= 0) { this.erode(i, v, dirx, diry); return PASS; }
      const Ep2 = Math.max(0, Ep - Pt * h * TUNE.cost);
      const s = Math.sqrt(Ep2 / Ep);
      this.pvx[i] *= s; this.pvy[i] *= s;
      if (k === K_DEBRIS && s < 0.2) { this.pvx[i] *= 0.5; this.pvy[i] *= 0.5; }
      return PASS;
    }

    // not enough energy to break the cell: dent it (rigid-body penetration) and stop
    {
      const hardP = Math.pow(Math.min(2, Math.max(0.15, pm.hard / Math.max(0.3, tm.hard))), 0.8);
      const dmg = isPen
        ? hardP * Math.pow(Ep / Pt, 0.7) * Math.max(0.05, this.php[i]) / (1 + pm.brittle * 0.6) * TUNE.rigid
        : (Ep > Pt * (0.12) ? hardP * Math.pow(Ep / Pt, 1.4) * 0.6 : 0); // loose fragments: only fast ones matter
      hp[c] -= dmg;
      if (hp[c] <= 0.02) {
        this.destroyCell(c, -vx * 0.05, -vy * 0.05, 0.6);
      }
      if (isPen && hp[c] <= 0.02) {
        const t = this.track;
        const rx = ncx - t.x0, ry = ncy - t.y0;
        if (Math.abs(-rx * t.dy + ry * t.dx) <= t.lat) {
          const d = (ncx - t.first[0]) * t.dx + (ncy - t.first[1]) * t.dy + 1;
          if (d > t.maxDepth) t.maxDepth = d;
        }
      }
    }
    this.temp[c] += Math.min(400, Ep * 40);
    if (isPen) {
      // flatten / splash along the surface
      const [nx, ny] = this.surfaceNormal(ncx, ncy, dirx, diry);
      const side = Math.random() < 0.5 ? 1 : -1;
      const s = v * (0.05 + Math.random() * 0.15);
      this.pvx[i] = (-ny * side) * s + nx * s * 0.4;
      this.pvy[i] = (nx * side) * s + ny * s * 0.4;
      this.pkind[i] = K_DEBRIS;
      this.ptemp[i] += Math.min(500, Ep * 60);
      if (Ep > 0.3) this.events.push({ type: 'impact', x: ncx, y: ncy, e: Ep });
    } else {
      this.bounce(i, ncx, ncy, cx, cy, 0.2);
    }
    return STOP;
  }

  // --------------------------------------------------------------- stepping
  stepParticles() {
    const { W, H, st } = this;
    const dt = this.dt;
    const inv = dt / this.cellM; // cells per (m/s) per frame
    const cpf = 1 / inv;
    const ts = this.timeScale;
    const g = TUNE.gravity * ts * ts * cpf; // m/s added per frame
    for (let i = 0; i < this.np; i++) {
      const k = this.pkind[i];
      // lifetime
      if (this.plife[i] > 0) {
        this.plife[i] -= ts;
        if (this.plife[i] <= 0) {
          if (k === K_FIRE && Math.random() < 0.15) {
            this.pkind[i] = K_SMOKE; this.pmat[i] = MAT.smoke; this.plife[i] = 60 + Math.random() * 100; this.ptemp[i] = 200;
          } else { this.kill(i); i--; continue; }
        }
      }
      // forces
      if (k === K_FIRE) {
        this.pvy[i] -= g * 0.6; const dr = Math.pow(0.9, ts); this.pvx[i] *= dr; this.pvy[i] *= dr;
      } else if (k === K_SMOKE) {
        this.pvy[i] -= g * 0.25; const dr = Math.pow(0.94, ts); this.pvx[i] *= dr; this.pvy[i] *= dr;
        this.pvx[i] += (Math.random() - 0.5) * cpf * 0.02 * ts;
      } else if (k === K_DEBRIS || k === K_SPARK) {
        this.pvy[i] += g;
        const sp2 = this.pvx[i] * this.pvx[i] + this.pvy[i] * this.pvy[i];
        if (sp2 > 1e4) { const dr = Math.pow(0.995, ts); this.pvx[i] *= dr; this.pvy[i] *= dr; }
        if (this.ptemp[i] > AMBIENT) this.ptemp[i] -= (this.ptemp[i] - AMBIENT) * 0.01 * ts;
      }
      if (k === K_JET && this.zones.length) {
        for (const z of this.zones) {
          if (z.owner && z.owner === this.pgroup[i]) continue;
          const dx = this.px[i] - z.x, dy = this.py[i] - z.y;
          if (dx * dx + dy * dy > z.r * z.r) continue;
          const v = Math.hypot(this.pvx[i], this.pvy[i]);
          this.php[i] *= Math.pow(0.72, ts);
          this.pvx[i] += (Math.random() - 0.5) * v * 0.08 * ts;
          this.pvy[i] += (Math.random() - 0.5) * v * 0.08 * ts;
        }
      }
      // move with per-cell collision checks
      let x = this.px[i], y = this.py[i];
      let cx = Math.floor(x), cy = Math.floor(y);
      let rem = 1, iter = 0, dead = false;
      while (rem > 1e-4 && iter++ < 120) {
        const vx = this.pvx[i], vy = this.pvy[i];
        const sp = Math.sqrt(vx * vx + vy * vy) * inv;
        if (sp < 1e-6) break;
        const f = Math.min(rem, 0.8 / sp);
        const nx = x + vx * inv * f, ny = y + vy * inv * f;
        rem -= f;
        let ncx = Math.floor(nx), ncy = Math.floor(ny);
        if (ncx < 0 || ncx >= W || ncy < 0) { dead = true; break; }
        if (ncy >= H) { // floor
          if (k === K_FIRE || k === K_SMOKE) { this.pvy[i] = 0; continue; }
          this.pvy[i] = -Math.abs(this.pvy[i]) * 0.2; this.pvx[i] *= 0.6;
          if (k === K_PROJ || k === K_JET) this.pkind[i] = K_DEBRIS;
          continue;
        }
        if (ncx === cx && ncy === cy) { x = nx; y = ny; continue; }
        const c = ncy * W + ncx;
        if (st[c] === EMPTY) { x = nx; y = ny; cx = ncx; cy = ncy; continue; }
        const r = this.collide(i, c, ncx, ncy, cx, cy);
        if (r === PASS) { x = nx; y = ny; cx = ncx; cy = ncy; }
        else if (r === DEAD) { dead = true; break; }
        else if (this.pkind[i] !== k && rem > 0.5) rem = 0.5;
      }
      if (dead) { this.kill(i); i--; continue; }
      this.px[i] = x; this.py[i] = y;

      // settle slow debris into loose rubble
      const kk = this.pkind[i];
      if (kk === K_DEBRIS) {
        const vx = this.pvx[i], vy = this.pvy[i];
        if ((vx * vx + vy * vy) * inv * inv < 0.06) {
          const c = cy * W + cx;
          const below = cy + 1 >= H || st[c + W] !== EMPTY;
          if (below && st[c] === EMPTY) {
            const id = this.pmat[i];
            this.mat[c] = id; this.st[c] = LOOSE; this.hp[c] = 0.5; this.temp[c] = this.ptemp[i];
            this.looseCount++;
            this.kill(i); i--; continue;
          }
        }
      } else if (kk === K_SPARK) {
        const c = cy * W + cx;
        if (cy + 1 < H && st[c + W] === FIXED && MATERIALS[this.mat[c + W]].ignite) this.temp[c + W] += 30;
      }
    }
  }

  stepLoose() {
    if (this.looseCount <= 0) return;
    const { W, H, mat, st, hp, temp, burning } = this;
    const flip = this.frame & 1;
    const move = (a, b) => {
      mat[b] = mat[a]; st[b] = st[a]; hp[b] = hp[a]; temp[b] = temp[a]; burning[b] = burning[a];
      mat[a] = 0; st[a] = EMPTY; hp[a] = 0; temp[a] = AMBIENT; burning[a] = 0;
    };
    const swap = (a, b) => {
      let t;
      t = mat[a]; mat[a] = mat[b]; mat[b] = t;
      t = st[a]; st[a] = st[b]; st[b] = t;
      t = hp[a]; hp[a] = hp[b]; hp[b] = t;
      t = temp[a]; temp[a] = temp[b]; temp[b] = t;
      t = burning[a]; burning[a] = burning[b]; burning[b] = t;
    };
    for (let y = H - 2; y >= 0; y--) {
      const row = y * W;
      for (let n = 0; n < W; n++) {
        const x = flip ? n : W - 1 - n;
        const c = row + x;
        if (st[c] !== LOOSE) continue;
        const m = MATERIALS[mat[c]];
        const liquid = m.state === STATE.LIQUID;
        const b = c + W;
        if (st[b] === EMPTY) { move(c, b); continue; }
        if (st[b] === LOOSE && !liquid && MATERIALS[mat[b]].state === STATE.LIQUID) { swap(c, b); continue; }
        const dir = Math.random() < 0.5 ? -1 : 1;
        let moved = false;
        for (let t = 0; t < 2 && !moved; t++) {
          const d = t ? -dir : dir;
          const xx = x + d;
          if (xx < 0 || xx >= W) continue;
          if (st[b + d] === EMPTY && (liquid || st[c + d] === EMPTY)) { move(c, b + d); moved = true; }
        }
        if (moved || !liquid) continue;
        for (let t = 0; t < 2 && !moved; t++) {
          const d = t ? -dir : dir;
          const xx = x + d;
          if (xx < 0 || xx >= W) continue;
          if (st[c + d] === EMPTY) { move(c, c + d); moved = true; }
        }
      }
    }
  }

  stepHeat() {
    const { W, H, mat, st, hp, temp, burning } = this;
    const ts = this.timeScale;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = y * W + x;
        if (st[c] === EMPTY) continue;
        const t = temp[c];
        if (t < 30 && !burning[c]) { if (t !== AMBIENT && t < AMBIENT + 1) temp[c] = AMBIENT; continue; }
        const m = MATERIALS[mat[c]];
        // conduction & cooling
        let sum = 0, n = 0, air = 0;
        const nb0 = c - 1, nb1 = c + 1, nb2 = c - W, nb3 = c + W;
        if (st[nb0]) { sum += temp[nb0]; n++; } else air++;
        if (st[nb1]) { sum += temp[nb1]; n++; } else air++;
        if (st[nb2]) { sum += temp[nb2]; n++; } else air++;
        if (st[nb3]) { sum += temp[nb3]; n++; } else air++;
        let nt = t;
        if (n) nt += (sum / n - t) * 0.12;
        nt -= (t - AMBIENT) * (0.004 * air + 0.001) * ts;
        temp[c] = nt;
        if (m.ignite && nt > m.ignite) {
          if (m.P0 > 0) { this.queueDetonation(c); continue; }
          burning[c] = 1;
        }
        if (burning[c]) {
          hp[c] -= m.burn * 3 * ts;
          if (temp[c] < 650) temp[c] = 650;
          if (st[nb2] === EMPTY && Math.random() < 0.35 * ts) {
            this.spawn(x + Math.random(), y - 0.1, (Math.random() - 0.5) * 30 * this.cellM / this.dt * 0.02, -this.cellM / this.dt * (0.2 + Math.random() * 0.3), MAT.fire, K_FIRE, 1400, 12 + Math.random() * 30);
          }
          if (st[nb0]) temp[nb0] += 6; if (st[nb1]) temp[nb1] += 6; if (st[nb2]) temp[nb2] += 10; if (st[nb3]) temp[nb3] += 3;
          if (hp[c] <= 0) {
            this.clearCell(c);
            if (Math.random() < 0.5) this.spawn(x + 0.5, y + 0.5, 0, -this.cellM / this.dt * 0.1, MAT.smoke, K_SMOKE, 200, 80 + Math.random() * 80);
          }
        } else if (m.melt && nt > m.melt && st[c] === FIXED) {
          st[c] = LOOSE; this.looseCount++;
        }
      }
    }
  }

  step() {
    this.frame++;
    this.time += this.dt;
    this.stepParticles();
    this.processGroups();
    this.processDetonations();
    if (this.zones.length) this.zones = this.zones.filter(z => z.until > this.time);
    if (this.pendingPartDet) {
      const p = this.pendingPartDet; this.pendingPartDet = null;
      this.explode(p.x, p.y, p.n, p.p0, false, 0);
    }
    this.stepLoose();
    if (this.frame % 3 === 0) this.stepHeat();
  }

  // ---------------------------------------------------------------- tools
  paintCircle(cx, cy, r, id, force = true) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r2) continue;
      this.setCell(x, y, id, force);
    }
  }

  heatCircle(cx, cy, r, dT) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!this.inside(x, y) || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const c = y * this.W + x;
      if (this.st[c]) this.temp[c] += dT;
    }
  }

  // ------------------------------------------------------- save / load
  serialize() {
    // run-length encode (mat, state) pairs
    const out = [];
    const { mat, st, N } = this;
    let prevM = mat[0], prevS = st[0], run = 0;
    for (let i = 0; i <= N; i++) {
      const m = i < N ? mat[i] : -1, s = i < N ? st[i] : -1;
      if (m === prevM && s === prevS && run < 65535) run++;
      else { out.push(prevM, prevS, run); prevM = m; prevS = s; run = 1; }
    }
    return { v: 1, w: this.W, h: this.H, cellMM: this.cellMM, rle: out };
  }

  deserialize(o) {
    if (o.w !== this.W || o.h !== this.H) this.resize(o.w, o.h);
    this.clear();
    this.cellMM = o.cellMM || this.cellMM;
    let i = 0;
    for (let k = 0; k < o.rle.length; k += 3) {
      const m = o.rle[k], s = o.rle[k + 1], run = o.rle[k + 2];
      for (let r = 0; r < run && i < this.N; r++, i++) {
        if (!m || !MATERIALS[m]) continue;
        this.mat[i] = m; this.st[i] = s; this.hp[i] = 1;
        if (s === LOOSE) this.looseCount++;
      }
    }
  }
}
