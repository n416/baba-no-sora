import * as THREE from 'three';
import { glow } from './toon';
import { JP_FONT } from '../core/util';

/**
 * Every shop sign in town lives in ONE canvas atlas, drawn at build time, so
 * a street with two hundred signs is still a single draw call after the bake,
 * and all of them light up together at night (the atlas is also the emissive map).
 *
 * Layout of the 2048^2 atlas:
 *   top half      horizontal cells 256 x 64  (4:1)  -- 8 per row, 16 rows
 *   bottom half   vertical cells    64 x 256 (1:4)  -- 32 per row, 4 rows
 * Size the face you put a cell on to the same aspect (4:1 or 1:4), or it smears.
 *
 * Names are invented.  No real shop, chain, brand or logo goes in here.
 */

const SIZE = 2048;
const canvas = document.createElement('canvas');
canvas.width = SIZE;
canvas.height = SIZE;
const g = canvas.getContext('2d')!;
g.fillStyle = '#ffffff';
g.fillRect(0, 0, SIZE, SIZE);

export const signTexture = new THREE.CanvasTexture(canvas);
signTexture.colorSpace = THREE.SRGBColorSpace;
signTexture.anisotropy = 8;
signTexture.generateMipmaps = true;

/** The one material every sign face uses. */
export const signMaterial = glow('#ffffff', '#ffffff', { map: signTexture, emissiveMap: signTexture, ramp: 'soft' });

export interface SignStyle { bg: string; fg: string; border?: string; stripe?: string }
export const SIGN_STYLES: SignStyle[] = [
  { bg: '#d93a33', fg: '#fff6e0' },
  { bg: '#f4d23a', fg: '#c7271f' },
  { bg: '#1f5fae', fg: '#ffffff' },
  { bg: '#ffffff', fg: '#d02c26', border: '#d02c26' },
  { bg: '#2e8a4a', fg: '#fffbe6' },
  { bg: '#f08a24', fg: '#ffffff' },
  { bg: '#fff7e2', fg: '#2a2a33', border: '#2a2a33' },
  { bg: '#232730', fg: '#f6d64a' },
  { bg: '#e9476f', fg: '#ffffff' },
  { bg: '#7a3fa0', fg: '#fff2ff' },
  { bg: '#ffffff', fg: '#1f5fae', stripe: '#1f5fae' },
  { bg: '#16a0b8', fg: '#ffffff' },
];

/** Invented tenants of a Takadanobaba zakkyo building. */
export const TENANTS = [
  'らーめん 大翔', '居酒屋 まるふく', 'カラオケ ソラ', '焼肉 牛之助', '中華 龍門', '麻雀 東風荘', '歯科 さくら通り',
  '英会話 MAPLE', '学習塾 明星', 'ネットカフェ 夜鷹', '珈琲 ことり', 'とりどり', '串かつ 八兵衛', '古書 馬場堂',
  'ゲームセンター ぴこ', 'つけ麺 風雲', '寿司 ひので', '整体 ほぐし庵', 'スタジオ 音巣', 'ビストロ 月の舟',
  'カレー 象の家', 'ホットヨガ ひなた', '眼科 あおば', '司法書士 事務所', 'ダイニング 灯', 'もつ鍋 どんたく',
  '餃子 百番', 'バル TANUKI', '漫画喫茶 栞', 'ボードゲーム 双六屋', '台湾料理 小籠', 'たこ焼 まんまる',
  '質 はやせ', '古着 ふくろう', 'パン工房 こむぎ', '写真館 光陽', '書道教室 墨香', '雀荘 白發', 'ホルモン 炎',
];
export const VERTICAL_TENANTS = [
  'カラオケ', 'らーめん', '居酒屋', '焼肉', '歯科', '学習塾', '麻雀', '英会話', '中華料理', 'つけ麺', '珈琲',
  'ネットカフェ', 'もつ鍋', '整体', '寿司', '串かつ', '古書', '眼科', 'ゲーム', '雀荘', '餃子', '質',
  'チケット', '金券', 'スタジオ', 'バー', 'ホルモン', 'カレー',
];

export interface Rect { u0: number; v0: number; u1: number; v1: number }

let nextH = 0, nextV = 0;
const H_COLS = 8, H_ROWS = 16, V_COLS = 32, V_ROWS = 4;
const HW = SIZE / H_COLS, HH = 64, VW = 64, VH = 256;
const hCache = new Map<string, Rect>(), vCache = new Map<string, Rect>();

function rectOf(x: number, y: number, w: number, h: number): Rect {
  // canvas y runs down; texture v runs up (flipY)
  return { u0: x / SIZE, v0: 1 - (y + h) / SIZE, u1: (x + w) / SIZE, v1: 1 - y / SIZE };
}

function frame(x: number, y: number, w: number, h: number, st: SignStyle) {
  g.fillStyle = st.bg;
  g.fillRect(x, y, w, h);
  if (st.stripe) {
    g.fillStyle = st.stripe;
    if (w > h) g.fillRect(x, y + h - h * 0.14, w, h * 0.14);
    else g.fillRect(x + w - w * 0.14, y, w * 0.14, h);
  }
  if (st.border) {
    const lw = Math.min(w, h) * 0.07;
    g.strokeStyle = st.border;
    g.lineWidth = lw;
    g.strokeRect(x + lw / 2 + 1, y + lw / 2 + 1, w - lw - 2, h - lw - 2);
  }
}

/** Specials (station, hotel...) are drawn first and never reused for a tenant. */
const special = new Set<Rect>();
export function markSpecial(r: Rect) { special.add(r); return r; }
function reuse(cache: Map<string, Rect>, key: string) {
  const all = [...cache.values()].filter((r) => !special.has(r));
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return all[h % all.length];
}

/** A 4:1 horizontal sign cell.  Same text + style returns the same cell. */
export function hSign(text: string, style: SignStyle): Rect {
  const key = text + style.bg + style.fg;
  const hit = hCache.get(key);
  if (hit) return hit;
  // atlas full: reuse an existing cell rather than overwrite one already in use
  if (nextH >= H_COLS * H_ROWS) return reuse(hCache, key);
  const i = nextH++;
  const x = (i % H_COLS) * HW, y = Math.floor(i / H_COLS) * HH;
  frame(x, y, HW, HH, style);
  g.fillStyle = style.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = Math.min(HH * 0.66, (HW * 0.86) / Math.max(1, [...text].length));
  g.font = `bold ${size}px ${JP_FONT}`;
  g.fillText(text, x + HW / 2, y + HH / 2 + size * 0.05);
  signTexture.needsUpdate = true;
  const r = rectOf(x + 1, y + 1, HW - 2, HH - 2);
  hCache.set(key, r);
  return r;
}

/** A 1:4 vertical sign cell (text runs top to bottom). */
export function vSign(text: string, style: SignStyle): Rect {
  const key = text + style.bg + style.fg;
  const hit = vCache.get(key);
  if (hit) return hit;
  if (nextV >= V_COLS * V_ROWS) return reuse(vCache, key);
  const i = nextV++;
  const x = (i % V_COLS) * VW, y = SIZE / 2 + Math.floor(i / V_COLS) * VH;
  frame(x, y, VW, VH, style);
  g.fillStyle = style.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = [...text];
  const size = Math.min(VW * 0.74, (VH * 0.88) / chars.length);
  g.font = `bold ${size}px ${JP_FONT}`;
  chars.forEach((ch, k) => {
    const cy = y + VH / 2 + (k - (chars.length - 1) / 2) * size * 1.02;
    // long-vowel and dash marks turn upright in vertical writing
    if (ch === 'ー' || ch === '－') {
      g.save(); g.translate(x + VW / 2, cy); g.rotate(Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
    } else g.fillText(ch, x + VW / 2, cy);
  });
  signTexture.needsUpdate = true;
  const r = rectOf(x + 1, y + 1, VW - 2, VH - 2);
  vCache.set(key, r);
  return r;
}

/** A plane facing +z showing one atlas cell. */
export function signPlane(w: number, h: number, r: Rect) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) < 0.5 ? r.u0 : r.u1, uv.getY(i) < 0.5 ? r.v0 : r.v1);
  }
  const m = new THREE.Mesh(geo, signMaterial);
  m.receiveShadow = true;
  return m;
}
