// Canvas renderer: grid + particles into an ImageData at simulation resolution,
// scaled up with nearest-neighbour, plus vector overlays (flashes, aim, ruler).

import { MATERIALS } from './materials.js';
import { EMPTY, LOOSE, K_DEBRIS, K_PROJ, K_JET, K_FIRE, K_SMOKE, K_SPARK } from './engine.js';

const pack = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.flashes = [];
    this.shake = 0;
    this.ghost = null;     // {canvas, x, y, angle, w, h}
    this.aim = null;       // {x0,y0,x1,y1} in cells
    this.brush = null;     // {x,y,r} in cells
    this.shape = null;     // {type:'line'|'rect', x0,y0,x1,y1}
    this.showGrid = true;
    this.units = ['мм', 'м'];
    this.onWorldResized();
  }

  onWorldResized() {
    const w = this.world;
    this.off = document.createElement('canvas');
    this.off.width = w.W; this.off.height = w.H;
    this.octx = this.off.getContext('2d');
    this.img = this.octx.createImageData(w.W, w.H);
    this.u32 = new Uint32Array(this.img.data.buffer);
    this.buildPalette();
    this.buildBackground();
  }

  buildPalette() {
    this.pal = new Uint32Array(MATERIALS.length * 16);
    this.palRGB = new Uint8Array(MATERIALS.length * 16 * 3);
    for (let id = 1; id < MATERIALS.length; id++) {
      const [r, g, b] = MATERIALS[id].color;
      for (let s = 0; s < 16; s++) {
        const k = 0.9 + (s / 15) * 0.18;
        const o = (id * 16 + s);
        this.pal[o] = pack(clamp(r * k), clamp(g * k), clamp(b * k));
        this.palRGB[o * 3] = clamp(r * k); this.palRGB[o * 3 + 1] = clamp(g * k); this.palRGB[o * 3 + 2] = clamp(b * k);
      }
    }
  }

  buildBackground() {
    const w = this.world;
    this.bg = new Uint32Array(w.N);
    const base = [17, 20, 26];
    // grid lines at a "nice" spacing in millimetres
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    let step = nice.find(s => s / w.cellMM >= 18) || 5000;
    this.gridStepMM = step;
    const sc = step / w.cellMM;
    for (let y = 0; y < w.H; y++) {
      const gy = this.showGrid && Math.floor((y + 1) / sc) !== Math.floor(y / sc);
      for (let x = 0; x < w.W; x++) {
        const gx = this.showGrid && Math.floor((x + 1) / sc) !== Math.floor(x / sc);
        const v = (gx || gy) ? 8 : 0;
        const vig = 1 - 0.25 * Math.pow(Math.abs(y / w.H - 0.5) * 2, 2);
        this.bg[y * w.W + x] = pack((base[0] + v) * vig, (base[1] + v) * vig, (base[2] + v + 2) * vig);
      }
    }
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.dpr = dpr;
    const w = this.world;
    this.scale = Math.min(W / w.W, H / w.H);
    this.ox = (W - w.W * this.scale) / 2;
    this.oy = (H - w.H * this.scale) / 2;
  }

  // client (CSS px) -> cell coordinates
  toCell(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = (clientX - r.left) * this.dpr, y = (clientY - r.top) * this.dpr;
    return [(x - this.ox) / this.scale, (y - this.oy) / this.scale];
  }

  setGhost(sprite, x, y, angle) {
    if (!sprite) { this.ghost = null; return; }
    const c = document.createElement('canvas');
    c.width = sprite.w; c.height = sprite.h;
    const cx = c.getContext('2d');
    const id = cx.createImageData(sprite.w, sprite.h);
    const u = new Uint32Array(id.data.buffer);
    for (let k = 0; k < sprite.mat.length; k++) {
      const m = sprite.mat[k];
      if (m) u[k] = this.pal[m * 16 + 8];
    }
    cx.putImageData(id, 0, 0);
    this.ghost = { canvas: c, x, y, angle, w: sprite.w, h: sprite.h };
  }

  handleEvents(events) {
    for (const e of events) {
      if (e.type === 'explosion') {
        this.flashes.push({ x: e.x, y: e.y, r: e.r * (e.low ? 0.8 : 1.1), t: 0, life: e.low ? 22 : 16, low: e.low });
        this.shake = Math.min(14, this.shake + Math.sqrt(e.power) * 0.06);
      } else if (e.type === 'jet') {
        this.flashes.push({ x: e.x, y: e.y, r: 10, t: 0, life: 6, jet: true });
      } else if (e.type === 'fire') {
        this.flashes.push({ x: e.x, y: e.y, r: 6, t: 0, life: 5, jet: true });
      }
    }
    if (this.flashes.length > 60) this.flashes.splice(0, this.flashes.length - 60);
  }

  draw() {
    const w = this.world, u = this.u32, bg = this.bg, pal = this.pal;
    const { mat, st, hp, temp, shade, burning } = w;
    const N = w.N;
    const flick = (w.frame * 7) & 15;
    for (let c = 0; c < N; c++) {
      const s = st[c];
      if (s === EMPTY) { u[c] = bg[c]; continue; }
      const o = mat[c] * 16 + (shade[c] >> 4);
      const t = temp[c];
      const h = hp[c];
      if (t < 350 && h >= 0.999 && s !== LOOSE && !burning[c]) { u[c] = pal[o]; continue; }
      let r = this.palRGB[o * 3], g = this.palRGB[o * 3 + 1], b = this.palRGB[o * 3 + 2];
      let k = s === LOOSE ? 0.72 : 1;
      if (h < 0.999) k *= 0.55 + 0.45 * Math.max(0, h);
      r *= k; g *= k; b *= k;
      if (t >= 350) {
        const f = Math.min(1, (t - 350) / 1300);
        const a = Math.min(0.9, f * 1.4);
        const gr = 70 + 185 * f * f, gb = 15 + 220 * f * f * f;
        r = r + (255 - r) * a; g = g + (gr - g) * a; b = b + (gb - b) * a;
      }
      if (burning[c]) {
        const fl = ((c * 13 + flick) & 15) / 15;
        r = r * 0.4 + 255 * 0.6; g = g * 0.4 + (90 + 90 * fl) * 0.6; b = b * 0.4 + 20 * 0.6;
      }
      u[c] = pack(clamp(r), clamp(g), clamp(b));
    }
    // particles
    const W = w.W, H = w.H;
    const data = this.img.data;
    for (let i = 0; i < w.np; i++) {
      const x = w.px[i] | 0, y = w.py[i] | 0;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const c = y * W + x;
      const k = w.pkind[i];
      if (k === K_SMOKE) {
        const p = c * 4, a = Math.min(0.35, w.plife[i] / 300);
        data[p] += (70 - data[p]) * a; data[p + 1] += (70 - data[p + 1]) * a; data[p + 2] += (76 - data[p + 2]) * a;
        continue;
      }
      if (k === K_FIRE) {
        const l = w.plife[i];
        const p = c * 4;
        const f = Math.min(1, l / 40);
        data[p] = clamp(data[p] + 160 + 95 * f);
        data[p + 1] = clamp(data[p + 1] + 40 + 170 * f * f);
        data[p + 2] = clamp(data[p + 2] + 10 + 120 * f * f * f);
        continue;
      }
      if (k === K_JET) { u[c] = pack(255, 250, 215); if (x + 1 < W) u[c + 1] = pack(255, 210, 120); continue; }
      if (k === K_SPARK) { u[c] = pack(255, 220, 110); continue; }
      const m = w.pmat[i];
      const o = m * 16 + 10;
      let r = this.palRGB[o * 3], g = this.palRGB[o * 3 + 1], b = this.palRGB[o * 3 + 2];
      if (k === K_PROJ) { r = clamp(r * 1.25 + 30); g = clamp(g * 1.25 + 30); b = clamp(b * 1.25 + 30); }
      else { r = clamp(r + 25); g = clamp(g + 25); b = clamp(b + 25); }
      const t = w.ptemp[i];
      if (t > 450) {
        const f = Math.min(1, (t - 450) / 1200);
        r = clamp(r + (255 - r) * f); g = clamp(g + (80 + 175 * f * f - g) * f); b = clamp(b + (30 + 200 * f * f * f - b) * f);
      }
      u[c] = pack(r, g, b);
    }
    this.octx.putImageData(this.img, 0, 0);

    // compose
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    let sx = 0, sy = 0;
    if (this.shake > 0.2) {
      sx = (Math.random() - 0.5) * this.shake * this.dpr; sy = (Math.random() - 0.5) * this.shake * this.dpr;
      this.shake *= 0.86;
    } else this.shake = 0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, this.ox + sx, this.oy + sy, w.W * this.scale, w.H * this.scale);
    ctx.save();
    ctx.translate(this.ox + sx, this.oy + sy);
    ctx.scale(this.scale, this.scale);

    if (this.ghost) {
      const gh = this.ghost;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.translate(gh.x, gh.y);
      ctx.rotate(gh.angle);
      ctx.drawImage(gh.canvas, -gh.w + 1, -gh.h / 2);
      ctx.restore();
      // aim line
      ctx.save();
      ctx.strokeStyle = 'rgba(255,190,60,0.35)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1 / this.scale * this.dpr;
      ctx.beginPath();
      ctx.moveTo(gh.x + 2, gh.y);
      ctx.lineTo(gh.x + Math.cos(gh.angle) * w.W * 2, gh.y + Math.sin(gh.angle) * w.W * 2);
      ctx.stroke();
      ctx.restore();
    }

    // flashes
    ctx.globalCompositeOperation = 'lighter';
    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k];
      f.t++;
      const a = 1 - f.t / f.life;
      if (a <= 0) { this.flashes.splice(k, 1); continue; }
      const r = f.r * (0.5 + 0.7 * (f.t / f.life));
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      if (f.jet) {
        g.addColorStop(0, `rgba(255,250,220,${0.9 * a})`); g.addColorStop(1, 'rgba(255,200,120,0)');
      } else {
        g.addColorStop(0, `rgba(255,245,210,${0.95 * a})`);
        g.addColorStop(0.35, `rgba(255,170,60,${0.6 * a})`);
        g.addColorStop(1, 'rgba(255,80,10,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    const lw = this.dpr / this.scale;
    if (this.aim) {
      const a = this.aim;
      ctx.strokeStyle = '#ffb02e'; ctx.fillStyle = '#ffb02e';
      ctx.lineWidth = 1.5 * lw;
      ctx.beginPath(); ctx.moveTo(a.x0, a.y0); ctx.lineTo(a.x1, a.y1); ctx.stroke();
      const ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0), hl = 8 * lw;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x1 - Math.cos(ang - 0.4) * hl, a.y1 - Math.sin(ang - 0.4) * hl);
      ctx.lineTo(a.x1 - Math.cos(ang + 0.4) * hl, a.y1 - Math.sin(ang + 0.4) * hl);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(a.x0, a.y0, 3 * lw, 0, Math.PI * 2); ctx.fill();
    }
    if (this.brush) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(this.brush.x, this.brush.y, Math.max(0.5, this.brush.r), 0, Math.PI * 2); ctx.stroke();
    }
    if (this.shape) {
      const s = this.shape;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = lw; ctx.setLineDash([3 * lw, 3 * lw]);
      ctx.beginPath();
      if (s.type === 'rect') ctx.rect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
      else { ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();

    // ruler
    this.drawRuler();
  }

  drawRuler() {
    const ctx = this.ctx, w = this.world;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const targetPx = 110 * this.dpr;
    const mmPerPx = w.cellMM / this.scale;
    const len = nice.find(n => n / mmPerPx >= targetPx * 0.6) || 10000;
    const px = len / mmPerPx;
    const x = this.ox + 14 * this.dpr, y = this.oy + w.H * this.scale - 16 * this.dpr;
    ctx.save();
    ctx.strokeStyle = 'rgba(230,236,245,0.85)'; ctx.fillStyle = 'rgba(230,236,245,0.85)';
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath(); ctx.moveTo(x, y - 5 * this.dpr); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5 * this.dpr); ctx.stroke();
    ctx.font = `${11 * this.dpr}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(len >= 1000 ? `${len / 1000} ${this.units[1]}` : `${len} ${this.units[0]}`, x + 4 * this.dpr, y - 7 * this.dpr);
    ctx.restore();
  }
}
