import * as THREE from 'three';

/**
 * Sound effects, synthesised with Web Audio at runtime: no files, nothing to
 * license, works the same in VR.  Every one-shot is a few oscillators and a
 * burst of filtered noise with an envelope; the loops (verniers, engine, wind)
 * run all the time and only their gains move.
 *
 * Positional without a PannerNode: a source's gain falls off with distance from
 * the listener (the camera) and it pans by the angle to it.  Cheap, and it never
 * swings wildly when the VR head turns.
 *
 * Browsers only allow audio after a user gesture, so nothing exists until
 * `unlock()` (the start click, the VR button).  Until then every call is a no-op,
 * which is also what keeps the headless tests silent.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private readonly lpos = new THREE.Vector3();
  private readonly lright = new THREE.Vector3(1, 0, 0);
  // loops
  private thrust?: { g: GainNode; rumble: GainNode };
  private engine?: { g: GainNode; osc: OscillatorNode; buzz: OscillatorNode };
  private wind?: GainNode;
  private testing = false;
  /** How many times each sound was triggered (whether or not audio is unlocked): lets tests check the wiring. */
  readonly counts: Record<string, number> = {};
  private count(name: string) {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }

  get ready() {
    return !!this.ctx && !this.muted;
  }

  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    // a gentle limiter on the master so big collapses do not clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startLoops();
    void ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return !this.muted;
  }

  /** Where the ears are: the camera's position and its right vector. */
  listen(camera: THREE.Camera) {
    camera.getWorldPosition(this.lpos);
    this.lright.set(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(_q)).setY(0).normalize();
  }

  // ---- one-shots ------------------------------------------------------------------

  /** Beam: a falling square/saw zap over a low thump, with a hiss on top. */
  beam(at?: THREE.Vector3) {
    this.count('beam');
    const o = this.out(at, 0.55, 60);
    if (!o) return;
    const { ctx, t, dst } = o;
    this.tone(dst, 'square', 1600, 260, t, 0.004, 0.28, 0.16);
    this.tone(dst, 'sawtooth', 820, 140, t, 0.004, 0.32, 0.14);
    this.tone(dst, 'sine', 140, 55, t, 0.005, 0.25, 0.45);
    this.burst(dst, t, 0.12, 0.25, 'highpass', 3000, 3000);
    void ctx;
  }

  /** Something hit: a thud and a spray of grit.  `big` for the plasma blast. */
  impact(at: THREE.Vector3, big = false) {
    this.count('impact');
    const o = this.out(at, big ? 1 : 0.6, big ? 120 : 70);
    if (!o) return;
    const { t, dst } = o;
    this.tone(dst, 'sine', big ? 90 : 120, 30, t, 0.005, big ? 0.9 : 0.4, big ? 0.9 : 0.5);
    this.burst(dst, t, big ? 1.1 : 0.45, big ? 0.8 : 0.45, 'lowpass', big ? 2400 : 1600, 180);
  }

  /** The kaiju being hit: a meaty slap with a metallic ring. */
  hitKaiju(at: THREE.Vector3) {
    this.count('hitKaiju');
    const o = this.out(at, 0.7, 120);
    if (!o) return;
    const { t, dst } = o;
    this.tone(dst, 'triangle', 420, 380, t, 0.003, 0.25, 0.18);
    this.tone(dst, 'sine', 160, 60, t, 0.003, 0.3, 0.5);
    this.burst(dst, t, 0.25, 0.4, 'bandpass', 900, 500);
  }

  /** A building coming down: a long low rumble with crackles of breaking concrete. */
  collapse(at: THREE.Vector3, height: number) {
    this.count('collapse');
    const o = this.out(at, Math.min(1, 0.5 + height / 60), 140);
    if (!o) return;
    const { t, dst } = o;
    const len = 2.2 + height / 30;
    this.burst(dst, t, len, 0.9, 'lowpass', 500, 90, 0.25);
    this.tone(dst, 'sine', 55, 32, t, 0.3, len, 0.5);
    for (let i = 0; i < 9; i++) {
      const at2 = t + Math.random() * len * 0.7;
      this.burst(dst, at2, 0.06 + Math.random() * 0.1, 0.35, 'bandpass', 1200 + Math.random() * 2500, 800);
    }
  }

  /** A robot footfall: low thud plus a short metal clank. */
  robotStep(at: THREE.Vector3, weight = 1) {
    this.count('robotStep');
    const o = this.out(at, 0.35 * weight, 60);
    if (!o) return;
    const { t, dst } = o;
    this.tone(dst, 'sine', 75, 34, t, 0.004, 0.28, 0.6);
    this.tone(dst, 'square', 190, 170, t, 0.002, 0.06, 0.08);
    this.burst(dst, t, 0.12, 0.3, 'lowpass', 400, 150);
  }

  /** The kaiju's footfall: deeper and longer, shakes the low end. */
  kaijuStep(at: THREE.Vector3) {
    this.count('kaijuStep');
    const o = this.out(at, 0.8, 160);
    if (!o) return;
    const { t, dst } = o;
    this.tone(dst, 'sine', 48, 22, t, 0.01, 0.7, 0.9);
    this.burst(dst, t, 0.4, 0.5, 'lowpass', 260, 90);
  }

  /** The roar: two detuned saws sliding down under a wobbling formant, and breath noise. */
  roar(at: THREE.Vector3, long = false) {
    this.count('roar');
    const o = this.out(at, 0.9, 260);
    if (!o) return;
    const { ctx, t, dst } = o;
    const len = long ? 3.4 : 2.4;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 2.2;
    filt.frequency.setValueAtTime(700, t);
    filt.frequency.linearRampToValueAtTime(1100, t + len * 0.3);
    filt.frequency.linearRampToValueAtTime(420, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.35);
    g.gain.setValueAtTime(0.9, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    filt.connect(g).connect(dst);
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 7;
    lfoG.gain.value = 9;
    lfo.connect(lfoG);
    for (const [f0, f1] of [[150, 72], [226, 105]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + len);
      lfoG.connect(osc.frequency);
      osc.connect(filt);
      osc.start(t);
      osc.stop(t + len + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + len + 0.05);
    this.burst(dst, t, len, 0.35, 'bandpass', 700, 500, 0.3);
  }

  /** The plasma charging: a rising whine with a tremble. */
  charge(at: THREE.Vector3, secs: number) {
    this.count('charge');
    const o = this.out(at, 0.35, 200);
    if (!o) return;
    const { ctx, t, dst } = o;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + secs);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + secs * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + secs + 0.1);
    osc.connect(g).connect(dst);
    osc.start(t);
    osc.stop(t + secs + 0.15);
  }

  /** The plasma ball leaving the mouth: a whoosh that sweeps down. */
  plasma(at: THREE.Vector3) {
    this.count('plasma');
    const o = this.out(at, 0.7, 200);
    if (!o) return;
    const { t, dst } = o;
    this.burst(dst, t, 0.7, 0.6, 'bandpass', 2400, 350);
    this.tone(dst, 'sine', 320, 70, t, 0.01, 0.6, 0.4);
  }

  /** Round won, city restored: a bright four-note chime. */
  chime() {
    this.count('chime');
    const o = this.out(undefined, 0.35, 1);
    if (!o) return;
    const { t, dst } = o;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(dst, 'triangle', f, f, t + i * 0.13, 0.01, 0.6, 0.35));
  }

  // ---- loops ------------------------------------------------------------------------

  /**
   * Per frame: verniers (0..1), the winged car's engine (speed m/s, null when not
   * riding it), wind (airspeed while flying).  Smoothed with setTargetAtTime.
   */
  loops(thrust: number, engineSpeed: number | null, wind: number) {
    const ctx = this.ctx;
    if (!ctx || !this.thrust || !this.engine || !this.wind) return;
    const t = ctx.currentTime;
    this.thrust.g.gain.setTargetAtTime(thrust * 0.32, t, 0.08);
    this.thrust.rumble.gain.setTargetAtTime(thrust * 0.4, t, 0.08);
    if (engineSpeed === null) this.engine.g.gain.setTargetAtTime(0, t, 0.2);
    else {
      this.engine.g.gain.setTargetAtTime(0.05 + Math.min(0.12, Math.abs(engineSpeed) * 0.005), t, 0.2);
      this.engine.osc.frequency.setTargetAtTime(48 + Math.abs(engineSpeed) * 3.2, t, 0.15);
      this.engine.buzz.frequency.setTargetAtTime(22 + Math.abs(engineSpeed) * 2.1, t, 0.15);
    }
    this.wind.gain.setTargetAtTime(Math.min(0.28, wind * 0.011), t, 0.3);
  }

  private startLoops() {
    const ctx = this.ctx!;
    const src = (type: BiquadFilterType, f: number, q = 0.8) => {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type;
      filt.frequency.value = f;
      filt.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      n.connect(filt).connect(g).connect(this.master);
      n.start();
      return g;
    };
    this.thrust = { g: src('bandpass', 1100, 0.6), rumble: src('lowpass', 180) };
    this.wind = src('highpass', 600, 0.4);
    const g = ctx.createGain();
    g.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 900;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const buzz = ctx.createOscillator();
    buzz.type = 'square';
    buzz.frequency.value = 22;
    const buzzG = ctx.createGain();
    buzzG.gain.value = 0.35;
    osc.connect(filt);
    buzz.connect(buzzG).connect(filt);
    filt.connect(g).connect(this.master);
    osc.start();
    buzz.start();
    this.engine = { g, osc, buzz };
  }

  // ---- building blocks -----------------------------------------------------------------

  /** A destination for a one-shot at `at` (or unpositioned), with distance gain and pan. */
  private out(at: THREE.Vector3 | undefined, vol: number, ref: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted || (ctx.state !== 'running' && !this.testing)) return null;
    let gain = vol, pan = 0;
    if (at) {
      _d.subVectors(at, this.lpos);
      const dist = _d.length();
      gain = vol / (1 + (dist / ref) ** 1.5);
      if (gain < 0.01) return null;
      _d.setY(0);
      if (_d.lengthSq() > 1) pan = Math.max(-0.85, Math.min(0.85, _d.normalize().dot(this.lright)));
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.master);
    // tidy up once everything scheduled into it has finished
    setTimeout(() => { g.disconnect(); p.disconnect(); }, 6000);
    return { ctx, t: ctx.currentTime + 0.005, dst: g };
  }

  private tone(dst: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, attack: number, len: number, vol: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(dst);
    osc.start(t);
    osc.stop(t + len + 0.05);
  }

  /** Filtered noise with an attack/decay envelope; the filter sweeps f0 -> f1. */
  private burst(dst: AudioNode, t: number, len: number, vol: number, type: BiquadFilterType, f0: number, f1: number, attack = 0.004) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(filt).connect(g).connect(dst);
    n.start(t, Math.random() * 1.5);
    n.stop(t + len + 0.05);
  }

  /**
   * Render every one-shot offline and report its peak and RMS: proves the
   * synthesis produces sound without anyone having to listen.
   */
  async selfTest() {
    const saved = { ctx: this.ctx, master: this.master, noise: this.noise, muted: this.muted };
    const here = new THREE.Vector3(this.lpos.x + 20, this.lpos.y, this.lpos.z);
    const cases: [string, () => void][] = [
      ['beam', () => this.beam(here)], ['impact', () => this.impact(here)], ['impactBig', () => this.impact(here, true)],
      ['hitKaiju', () => this.hitKaiju(here)], ['collapse', () => this.collapse(here, 30)], ['robotStep', () => this.robotStep(here)],
      ['kaijuStep', () => this.kaijuStep(here)], ['roar', () => this.roar(here)], ['charge', () => this.charge(here, 2.2)],
      ['plasma', () => this.plasma(here)], ['chime', () => this.chime()],
    ];
    const out: Record<string, { peak: number; rms: number }> = {};
    this.testing = true;
    this.muted = false;
    try {
      for (const [name, fn] of cases) {
        const off = new OfflineAudioContext(2, 44100 * 4, 44100);
        this.ctx = off as unknown as AudioContext;
        this.master = off.createGain();
        this.master.connect(off.destination);
        this.noise = off.createBuffer(1, off.sampleRate * 2, off.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        fn();
        const buf = await off.startRendering();
        let peak = 0, sum = 0;
        for (let ch = 0; ch < 2; ch++) for (const v of buf.getChannelData(ch)) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
        out[name] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / (buf.length * 2)).toFixed(4) };
      }
    } finally {
      this.testing = false;
      Object.assign(this, saved);
    }
    return out;
  }
}

const _q = new THREE.Quaternion(), _d = new THREE.Vector3();

/** The one instance everything plays through. */
export const sfx = new Sfx();
