// Tiny procedural sound engine (WebAudio). No samples – everything is synthesised.
export class Sound {
  constructor() { this.enabled = true; this.ctx = null; this.last = {}; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  throttle(key, ms) {
    const t = performance.now();
    if (this.last[key] && t - this.last[key] < ms) return false;
    this.last[key] = t; return true;
  }

  noiseBurst(dur, freq, vol, q = 0.7, type = 'lowpass') {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.6 + Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone(f0, f1, dur, vol, type = 'sine') {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  play(events) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    for (const e of events) {
      switch (e.type) {
        case 'fire':
          if (this.throttle('fire', 60)) { this.noiseBurst(0.35, 900, 0.5); this.tone(120, 40, 0.25, 0.4); }
          break;
        case 'impact':
          if (this.throttle('impact', 45)) { const v = Math.min(0.35, 0.05 + e.e * 0.03); this.tone(1800 + Math.random() * 1600, 900, 0.18, v, 'triangle'); this.noiseBurst(0.06, 4000, v, 1, 'bandpass'); }
          break;
        case 'ricochet':
          if (this.throttle('ric', 120)) this.tone(3200 + Math.random() * 800, 600, 0.45, 0.18, 'sine');
          break;
        case 'spall':
          if (this.throttle('spall', 70)) this.noiseBurst(0.12, 2500, 0.18, 1.5, 'bandpass');
          break;
        case 'jet':
          if (this.throttle('jet', 80)) this.noiseBurst(0.25, 6000, 0.35, 0.8, 'highpass');
          break;
        case 'explosion': {
          if (!this.throttle('boom', 70)) break;
          const p = Math.min(1, Math.sqrt(e.power) / 300);
          this.noiseBurst(0.6 + 1.6 * p, e.low ? 700 : 380, 0.35 + 0.6 * p, 0.5);
          this.tone(90, 28, 0.5 + p, 0.3 + 0.4 * p);
          break;
        }
      }
    }
  }
}
