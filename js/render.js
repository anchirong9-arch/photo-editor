/* ============================================================
   render.js — 베이스 이미지 · 필터 · 레이어 렌더 파이프라인
   ============================================================ */

import { S } from './state.js';

const orientedCache = new Map();

export function clearCaches() {
  orientedCache.clear();
  if (S.layers) for (const l of S.layers) { l._lk = null; l._mc = null; }
}

export function currentSlot() {
  return S.slots.find(s => s.id === S.slotId) || null;
}

export function hasImage() {
  return !!currentSlot();
}

/* ── 회전/반전 적용된 원본 캔버스 (캐시) ────────────────── */
export function orientedCanvas() {
  const slot = currentSlot();
  if (!slot) return null;
  const { rot, flipH, flipV } = S.view;
  const key = `${slot.id}|${rot}|${flipH}|${flipV}`;
  const hit = orientedCache.get(key);
  if (hit) return hit;
  if (orientedCache.size > 6) orientedCache.clear();

  const swap = (rot % 180) !== 0;
  const c = document.createElement('canvas');
  c.width = swap ? slot.h : slot.w;
  c.height = swap ? slot.w : slot.h;
  const g = c.getContext('2d');
  g.save();
  g.translate(c.width / 2, c.height / 2);
  g.rotate(rot * Math.PI / 180);
  g.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  g.drawImage(slot.bmp, -slot.w / 2, -slot.h / 2, slot.w, slot.h);
  g.restore();
  orientedCache.set(key, c);
  return c;
}

export function baseSize() {
  const o = orientedCanvas();
  return o ? { w: o.width, h: o.height } : { w: 0, h: 0 };
}

export function outputSize() {
  const o = orientedCanvas();
  if (!o) return { w: 0, h: 0 };
  const c = S.crop || { x: 0, y: 0, w: 1, h: 1 };
  return {
    w: Math.max(1, Math.round(o.width * c.w)),
    h: Math.max(1, Math.round(o.height * c.h)),
  };
}

/* ── 필터 문자열 ───────────────────────────────────────── */
function filterString(W) {
  const a = S.adj, p = [];
  if (a.brightness) p.push(`brightness(${clampNum(1 + a.brightness / 100)})`);
  if (a.contrast) p.push(`contrast(${clampNum(1 + a.contrast / 100)})`);
  if (a.saturation !== 0) p.push(`saturate(${clampNum(1 + a.saturation / 100)})`);
  if (a.blur > 0) p.push(`blur(${(a.blur / 100) * W * 0.022}px)`);
  return p.join(' ');
}
function clampNum(v) { return Math.max(0, v); }

function hexToRgb(hex) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/* ── 베이스 그리기 ─────────────────────────────────────── */
export function paintBase(ctx, W, H) {
  const o = orientedCanvas();
  if (!o) return false;
  const c = S.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = c.x * o.width, sy = c.y * o.height, sw = c.w * o.width, sh = c.h * o.height;
  const blur = S.adj.blur > 0;

  ctx.save();
  if (blur) { ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); }
  ctx.filter = filterString(W) || 'none';
  if (blur) {
    const ox = sw * 0.03, oy = sh * 0.03;
    ctx.drawImage(o, sx - ox, sy - oy, sw + ox * 2, sh + oy * 2, -W * 0.03, -H * 0.03, W * 1.06, H * 1.06);
  } else {
    ctx.drawImage(o, sx, sy, sw, sh, 0, 0, W, H);
  }
  ctx.filter = 'none';
  ctx.restore();

  // 색온도 (따뜻/차갑)
  const t = S.adj.temperature;
  if (t) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.85, Math.abs(t) / 100 * 0.9);
    ctx.fillStyle = t > 0 ? '#ff9a3c' : '#4c9dff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 비네팅
  const v = S.adj.vignette;
  if (v > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${(v / 100) * 0.92})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  return true;
}

/* ── 텍스트 레이아웃 ───────────────────────────────────── */
const mcanvas = document.createElement('canvas');
const mctx = mcanvas.getContext('2d');

export function fontCss(l, fs) {
  return `${l.italic ? 'italic ' : ''}${l.weight || 400} ${fs}px "${l.font}", "Noto Sans KR", sans-serif`;
}

function wrapParagraph(ctx, text, maxW) {
  if (!text) return [''];
  const lines = [];
  let line = '';
  for (const ch of Array.from(text)) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line.length) {
      const sp = line.lastIndexOf(' ');
      if (sp > 0 && ch !== ' ') {
        lines.push(line.slice(0, sp));
        line = line.slice(sp + 1) + ch;
      } else {
        lines.push(line);
        line = ch === ' ' ? '' : ch;
      }
    } else {
      line = test;
    }
  }
  lines.push(line);
  return lines;
}

export function layoutText(l, W, H) {
  const key = [l.text, l.font, l.weight, l.italic, l.size, l.maxW, l.align,
    l.tracking, l.leading, W, H].join('|');
  if (l._lk === key) return l._lay;

  const fs = Math.max(2, l.size * H);
  mctx.font = fontCss(l, fs);
  if ('letterSpacing' in mctx) mctx.letterSpacing = `${(l.tracking / 100) * fs}px`;
  const maxW = Math.max(fs * 0.6, l.maxW * W);

  const lines = [];
  for (const raw of String(l.text ?? '').split('\n')) lines.push(...wrapParagraph(mctx, raw, maxW));
  const widths = lines.map(t => mctx.measureText(t).width);
  const boxW = Math.max(fs * 0.4, ...widths);
  const lineH = fs * (l.leading / 100);
  const boxH = Math.max(fs, lineH * lines.length);

  const lay = { fs, lines, widths, boxW, boxH, lineH };
  l._lk = key;
  l._lay = lay;
  if ('letterSpacing' in mctx) mctx.letterSpacing = '0px';
  return lay;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function drawTextLayer(ctx, l, W, H) {
  // 폰트 미로드 대비: 로드 전에는 기본 폰트로 그려지므로 boot에서 미리 로드
  const L = layoutText(l, W, H);
  const fs = L.fs;
  ctx.save();
  ctx.translate(l.x * W, l.y * H);
  ctx.rotate(l.rot || 0);
  ctx.globalAlpha = (l.opacity ?? 100) / 100;

  if (l.bg && l.bg.on) {
    const padX = (l.bg.padX / 100) * fs;
    const padY = (l.bg.padY / 100) * fs;
    const bw = L.boxW + padX * 2, bh = L.boxH + padY * 2;
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, l.bg.alpha / 100));
    ctx.fillStyle = l.bg.color;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, (l.bg.radius / 100) * fs * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.font = fontCss(l, fs);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(l.tracking / 100) * fs}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const sw = (l.stroke?.width || 0) / 100 * fs;
  const startY = -L.boxH / 2 + (L.lineH - fs) / 2 + fs * 0.82;
  const sh = l.shadow;
  const useShadow = sh && sh.alpha > 0 && (sh.blur > 0 || sh.x !== 0 || sh.y !== 0);

  for (let i = 0; i < L.lines.length; i++) {
    const line = L.lines[i];
    if (!line) continue;
    const w = L.widths[i];
    let x;
    if (l.align === 'left') x = -L.boxW / 2;
    else if (l.align === 'right') x = L.boxW / 2 - w;
    else x = -w / 2;
    const y = startY + i * L.lineH;

    ctx.save();
    if (useShadow) {
      ctx.shadowColor = rgba(sh.color, sh.alpha / 100);
      ctx.shadowBlur = (sh.blur / 100) * fs;
      ctx.shadowOffsetX = (sh.x / 100) * fs;
      ctx.shadowOffsetY = (sh.y / 100) * fs;
    }
    if (sw > 0) {
      ctx.lineWidth = sw;
      ctx.strokeStyle = l.stroke.color;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = l.color;
    ctx.fillText(line, x, y);
    ctx.restore();
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}

/* ── 선 ────────────────────────────────────────────────── */
function drawStroke(ctx, l, W, H) {
  if (!l.points || l.points.length < 1) return;
  const lw = Math.max(0.5, l.width * Math.min(W, H));
  ctx.save();
  ctx.globalAlpha = (l.opacity ?? 100) / 100;
  ctx.strokeStyle = l.color;
  ctx.lineWidth = l.mode === 'marker' ? lw * 2.4 : lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (l.mode === 'marker') ctx.globalAlpha *= 0.45;   // 형광펜은 반투명하게 얹는다
  ctx.beginPath();
  const p = l.points;
  if (p.length === 1) {
    ctx.arc(p[0][0] * W, p[0][1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = l.color;
    ctx.fill();
  } else {
    ctx.moveTo(p[0][0] * W, p[0][1] * H);
    for (let i = 1; i < p.length; i++) {
      const mx = (p[i - 1][0] + p[i][0]) / 2 * W;
      const my = (p[i - 1][1] + p[i][1]) / 2 * H;
      ctx.quadraticCurveTo(p[i - 1][0] * W, p[i - 1][1] * H, mx, my);
    }
    const last = p[p.length - 1];
    ctx.lineTo(last[0] * W, last[1] * H);
    ctx.stroke();
  }
  ctx.restore();
}

/* ── 도형 ──────────────────────────────────────────────── */
function drawShape(ctx, l, W, H) {
  const x1 = l.x1 * W, y1 = l.y1 * H, x2 = l.x2 * W, y2 = l.y2 * H;
  const lw = Math.max(0.6, l.width * Math.min(W, H));
  ctx.save();
  ctx.globalAlpha = (l.opacity ?? 100) / 100;
  ctx.lineWidth = lw;
  ctx.strokeStyle = l.color;
  ctx.fillStyle = l.fillColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (l.shape === 'rect' || l.shape === 'ellipse') {
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    ctx.beginPath();
    if (l.shape === 'rect') {
      roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.06);
    } else {
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, .5), Math.max(h / 2, .5), 0, 0, Math.PI * 2);
    }
    if (l.fill) { ctx.globalAlpha *= 0.5; ctx.fill(); ctx.globalAlpha /= 0.5; }
    ctx.stroke();
  } else {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 2) { ctx.restore(); return; }
    const head = Math.min(dist * 0.35, Math.max(lw * 3.4, Math.min(W, H) * 0.035));
    const bx = x2 - Math.cos(ang) * head;
    const by = y2 - Math.sin(ang) * head;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(bx, by);
    ctx.stroke();
    const spread = 0.42;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(bx + Math.cos(ang + Math.PI / 2) * head * spread * 1.6,
               by + Math.sin(ang + Math.PI / 2) * head * spread * 1.6);
    ctx.lineTo(bx + Math.cos(ang - Math.PI / 2) * head * spread * 1.6,
               by + Math.sin(ang - Math.PI / 2) * head * spread * 1.6);
    ctx.closePath();
    ctx.fillStyle = l.color;
    ctx.fill();
  }
  ctx.restore();
}

/* ── 모자이크 / 블러 ───────────────────────────────────── */
function drawMosaic(ctx, l, W, H, baseSnap) {
  const x = l.x * W, y = l.y * H, w = Math.max(1, l.w * W), h = Math.max(1, l.h * H);
  const block = Math.max(2, l.block * W);
  if (l.mode === 'blur') {
    const pad = block * 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.filter = `blur(${block * 0.7}px)`;
    ctx.drawImage(baseSnap, Math.max(0, x - pad), Math.max(0, y - pad), w + pad * 2, h + pad * 2,
      x - pad, y - pad, w + pad * 2, h + pad * 2);
    ctx.filter = 'none';
    ctx.restore();
    return;
  }
  const tw = Math.max(1, Math.round(w / block));
  const th = Math.max(1, Math.round(h / block));
  const key = `${tw}x${th}`;
  let tmp = l._mc;
  if (!tmp || l._mcKey !== key) {
    tmp = document.createElement('canvas');
    tmp.width = tw; tmp.height = th;
    l._mc = tmp; l._mcKey = key;
  }
  const g = tmp.getContext('2d');
  g.clearRect(0, 0, tw, th);
  g.imageSmoothingEnabled = false;
  g.drawImage(baseSnap, x, y, w, h, 0, 0, tw, th);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tw, th, x, y, tw * block, th * block);
  ctx.restore();
}

/* ── 전체 렌더 ─────────────────────────────────────────── */
let baseSnap = document.createElement('canvas');
let baseSnapCtx = baseSnap.getContext('2d', { willReadFrequently: false });

export function renderScene(ctx, W, H, opts = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!hasImage()) return;

  const hasMosaic = S.layers.some(l => l.type === 'mosaic' && l.visible);
  paintBase(ctx, W, H);

  if (hasMosaic) {
    if (baseSnap.width !== W || baseSnap.height !== H) {
      baseSnap.width = W; baseSnap.height = H;
      baseSnapCtx = baseSnap.getContext('2d');
    }
    baseSnapCtx.clearRect(0, 0, W, H);
    baseSnapCtx.drawImage(ctx.canvas, 0, 0, W, H, 0, 0, W, H);
    for (const l of S.layers) {
      if (l.type === 'mosaic' && l.visible) drawMosaic(ctx, l, W, H, baseSnap);
    }
  }

  for (const l of S.layers) {
    if (!l.visible) continue;
    if (l.type === 'stroke') drawStroke(ctx, l, W, H);
    else if (l.type === 'shape') drawShape(ctx, l, W, H);
    else if (l.type === 'text') drawTextLayer(ctx, l, W, H);
  }
}

/* ── 바운즈 · 히트테스트 (px 좌표계) ────────────────────── */
export function layerBounds(l, W, H) {
  if (l.type === 'text') {
    const L = layoutText(l, W, H);
    const fs = L.fs;
    const padX = l.bg && l.bg.on ? (l.bg.padX / 100) * fs : 0;
    const padY = l.bg && l.bg.on ? (l.bg.padY / 100) * fs : 0;
    return { cx: l.x * W, cy: l.y * H, w: L.boxW + padX * 2, h: L.boxH + padY * 2, rot: l.rot || 0 };
  }
  if (l.type === 'shape') {
    const lw = l.width * Math.min(W, H);
    const x1 = l.x1 * W, y1 = l.y1 * H, x2 = l.x2 * W, y2 = l.y2 * H;
    const pad = lw / 2 + 2;
    return {
      cx: (x1 + x2) / 2, cy: (y1 + y2) / 2,
      w: Math.abs(x2 - x1) + pad * 2, h: Math.abs(y2 - y1) + pad * 2, rot: 0,
    };
  }
  if (l.type === 'stroke') {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of l.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const lw = (l.mode === 'marker' ? l.width * 2.4 : l.width) * Math.min(W, H);
    const x = minX * W, y = minY * H, w = (maxX - minX) * W, h = (maxY - minY) * H;
    return { cx: x + w / 2, cy: y + h / 2, w: Math.max(w, lw) + lw, h: Math.max(h, lw) + lw, rot: 0 };
  }
  return { cx: (l.x + l.w / 2) * W, cy: (l.y + l.h / 2) * H, w: l.w * W, h: l.h * H, rot: 0 };
}

export function hitLayer(l, px, py, W, H) {
  if (!l.visible) return false;
  if (l.type === 'shape' || l.type === 'stroke') {
    if (l.type === 'shape') {
      const b = layerBounds(l, W, H);
      const t = Math.max(10, l.width * Math.min(W, H));
      return Math.abs(px - b.cx) <= b.w / 2 + t && Math.abs(py - b.cy) <= b.h / 2 + t;
    }
    const thr = Math.max(9, l.width * Math.min(W, H));
    const pts = l.points;
    for (let i = 1; i < pts.length; i++) {
      if (distToSeg(px, py, pts[i - 1][0] * W, pts[i - 1][1] * H, pts[i][0] * W, pts[i][1] * H) <= thr) return true;
    }
    if (pts.length === 1) return Math.hypot(px - pts[0][0] * W, py - pts[0][1] * H) <= thr;
    return false;
  }
  const b = layerBounds(l, W, H);
  const dx = px - b.cx, dy = py - b.cy;
  const c = Math.cos(-(b.rot || 0)), s = Math.sin(-(b.rot || 0));
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function topLayerAt(px, py, W, H) {
  for (let i = S.layers.length - 1; i >= 0; i--) {
    if (hitLayer(S.layers[i], px, py, W, H)) return S.layers[i];
  }
  return null;
}
