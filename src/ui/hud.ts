import type { TimeOfDay } from '../world/timeofday';
import type { WorldConfig, Season } from '../config';

const SEASON_JA: Record<Season, string> = {
  spring: '春',
  earlySummer: '初夏',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

/** The DOM layer: start card, time indicator, hint line, toast.  Invisible in VR by nature. */
export class Hud {
  private startEl = document.getElementById('start')!;
  private crossEl = document.getElementById('crosshair')!;
  private hintEl = document.getElementById('hint')!;
  private toastEl = document.getElementById('toast')!;
  private slider = document.getElementById('time') as HTMLInputElement;
  private clockEl = document.getElementById('clock')!;
  private playEl = document.getElementById('play') as HTMLButtonElement;
  private toastTimer = 0;
  private tod: TimeOfDay;

  constructor(tod: TimeOfDay, cfg: WorldConfig) {
    this.tod = tod;
    document.getElementById('title')!.textContent = cfg.title;
    document.title = cfg.title;
    document.getElementById('season')!.textContent = SEASON_JA[cfg.season];
    document.getElementById('subtitle')!.textContent = `${SEASON_JA[cfg.season]}・北緯${cfg.latitude}°`;
    this.slider.addEventListener('input', () => {
      tod.playing = false;
      tod.set(parseFloat(this.slider.value));
    });
    // the slider must not steal pointer lock or keys
    for (const ev of ['mousedown', 'click', 'keydown'] as const) this.slider.addEventListener(ev, (e) => e.stopPropagation());
    this.playEl.addEventListener('click', (e) => {
      e.stopPropagation();
      tod.playing = !tod.playing;
      this.sync();
    });
    this.playEl.addEventListener('mousedown', (e) => e.stopPropagation());
    tod.onChange(() => this.sync());
    this.sync();
  }

  sync() {
    if (document.activeElement !== this.slider) this.slider.value = String(this.tod.time);
    this.clockEl.textContent = this.tod.label();
    this.playEl.textContent = this.tod.playing ? '❚❚' : '▶';
  }

  setStarted(on: boolean) {
    this.startEl.classList.toggle('hidden', on);
    this.crossEl.classList.toggle('hidden', !on);
  }

  hint(text: string) {
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('hidden', !text);
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1600);
  }
}
