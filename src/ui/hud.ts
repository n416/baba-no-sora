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
    // the start card offers the other mode; a click on the link must not start pointer lock
    const link = document.getElementById('mode-link') as HTMLAnchorElement | null;
    if (link) {
      const robot = cfg.vehicle === 'robot';
      link.href = robot ? '?' : '?vehicle=robot';
      link.textContent = robot ? '▶ 翼のある車に戻る' : '▶ 巨大ロボットで遊ぶ（ビーム・バーニア・怪獣）';
      link.addEventListener('click', (e) => e.stopPropagation());
      if (robot) {
        const p = document.querySelector('#start p:nth-of-type(2)');
        if (p) p.innerHTML = 'W S 前後 ／ A D 旋回 ／ マウス 照準 ／ <b>左クリック ビーム</b><br />Shift ダッシュ ／ <b>Space・E バーニア上昇</b> ／ Q 降下<br />建物を 6 棟壊すと怪獣が来る。倒すと街が元に戻る';
      }
    }
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

  /** Kaiju HP gauge: ratio 0..1, or null to hide. */
  gauge(ratio: number | null) {
    const el = document.getElementById('boss')!;
    el.classList.toggle('hidden', ratio === null);
    if (ratio === null) return;
    (document.getElementById('boss-fill') as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;
    document.getElementById('boss-hp')!.textContent = String(Math.round(ratio * 100));
  }

  counter(text: string) {
    const el = document.getElementById('counter')!;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1600);
  }
}
