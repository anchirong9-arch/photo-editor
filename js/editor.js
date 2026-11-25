/* ============================================================
   editor.js — 캔버스 · 도구 제스처 · 자르기 · 내보내기
   ============================================================ */

import { S, commit, mark, undo, redo, clamp, selectedLayer, findLayer, removeLayer,
         newTextLayer, newStrokeLayer, newShapeLayer, newMosaicLayer, PRESETS } from './state.js';
import * as R from './render.js';

export const view = document.getElementById('view');
export const overlay = document.getElementById('overlay');
const vctx = view.getContext('2d');
const octx = overlay.getContext('2d');

let cssW = 0, cssH = 0, dpr = 1;
let raf = 0;
let dragging = false;

export const listeners = { tool: [], sel: [], state: [], slots: [], crop: [] };
export function on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); }
export function emit(evt, arg) { (listeners[evt] || []).forEach(f => f(arg)); }

/* ── 크기 계산 & 렌더 ──────────────────────────────────── */
export function resizeCanvas() {
  const wrap = document.getElementById('canvasWrap');
  if (!wrap) return;
  if (!R.hasImage()) { draw(); return; }
  const availW = Math.max(40, wrap.clientWidth - 24);
  const availH = Math.max(40, wrap.clientHeight - 24);
  const { w: ow, h: oh } = R.outputSize();
  const scale = Math.min(availW / ow, availH / oh, 1);
  cssW = Math.max(1, Math.round(ow * scale));
  cssH = Math.max(1, Math.round(oh * scale));
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pxW = Math.max(1, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(cssH * dpr));
  if (view.width !== pxW || view.height !== pxH) {
    view.width = pxW; view.height = pxH;
    overlay.width = pxW; overlay.height = pxH;
  }
  view.style.width = cssW + 'px'; view.style.height = cssH + 'px';
  overlay.style.width = cssW + 'px'; overlay.style.height = cssH + 'px';
  draw();
}

export function invalidate() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; draw(); });
}

export function draw() {
  const W = view.width, H = view.height;
  const empty = document.getElementById('empty');
  if (empty) empty.style.display = R.hasImage() ? 'none' : 'grid';
  if (!W || !H) return;
  if (R.hasImage()) R.renderScene(vctx, W, H);
  else vctx.clearRect(0, 0, W, H);
  drawOverlay();
}

/* ── 선택 핸들 ─────────────────────────────────────────── */
const ROT_GAP = 30;

function handlePoints(l, W, H) {
  const b = R.layerBounds(l, W, H);
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const corners = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const pts = corners.map(([ux, uy]) => {
    const lx = ux * b.w / 2, ly = uy * b.h / 2;
    return { hx: ux, hy: uy, x: b.cx + lx * c - ly * s, y: b.cy + lx * s + ly * c };
  });
  const ly = -b.h / 2 - ROT_GAP;
  pts.push({ hx: 9, hy: 9, x: b.cx - ly * s, y: b.cy + ly * c });
  return { b, pts };
}

function drawOverlay() {
  const W = overlay.width, H = overlay.height;
  octx.clearRect(0, 0, W, H);
  if (!R.hasImage() || !W) return;

  if (S.tool === 'crop') { drawCropOverlay(W, H); return; }

  if (S._mosaicPreview) {
    const r = S._mosaicPreview;
    octx.save();
    octx.strokeStyle = 'rgba(167,139,250,.95)';
    octx.setLineDash([6 * dpr, 5 * dpr]);
    octx.lineWidth = Math.max(1, 1.4 * dpr);
    octx.fillStyle = 'rgba(167,139,250,.12)';
    octx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
    octx.strokeRect(r.x * W, r.y * H, r.w * W, r.h * H);
    octx.restore();
  }

  // 진행 중인 드래프트
  if (g && g.type === 'shape' && g.layer) {
    octx.save();
    octx.strokeStyle = 'rgba(167,139,250,.9)';
    octx.lineWidth = 1.5 * dpr;
    octx.setLineDash([5 * dpr, 4 * dpr]);
    const l = g.layer;
    const x = Math.min(l.x1, l.x2) * W, y = Math.min(l.y1, l.y2) * H;
    const w = Math.abs(l.x2 - l.x1) * W, h = Math.abs(l.y2 - l.y1) * H;
    octx.strokeRect(x, y, w, h);
    octx.restore();
  }

  const l = selectedLayer();
  if (!l || !l.visible) return;

  const { b, pts } = handlePoints(l, W, H);
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const hw = b.w / 2, hh = b.h / 2;

  octx.save();
  octx.strokeStyle = 'rgba(167,139,250,.95)';
  octx.lineWidth = Math.max(1, 1.4 * dpr);
  octx.beginPath();
  const corners = pts.slice(0, 8);
  octx.moveTo(corners[0].x, corners[0].y);
  [2, 4, 6, 0].forEach(i => octx.lineTo(corners[i].x, corners[i].y));
  octx.stroke();

  // 회전 핸들 (텍스트만)
  if (l.type === 'text') {
    const rp = pts[8];
    const topX = b.cx + (b.h / 2) * s, topY = b.cy - (b.h / 2) * c;
    octx.beginPath();
    octx.moveTo(topX, topY);
    octx.lineTo(rp.x, rp.y);
    octx.stroke();
    octx.beginPath();
    octx.arc(rp.x, rp.y, 6 * dpr, 0, Math.PI * 2);
    octx.fillStyle = '#a78bfa';
    octx.fill();
  }

  if (!(dragging && g && g.type === 'stroke')) {
    octx.fillStyle = '#0d0e12';
    const hs = 5 * dpr;
    for (const p of pts) {
      if (p.hx === 9) continue;
      octx.beginPath();
      octx.rect(p.x - hs, p.y - hs, hs * 2, hs * 2);
      octx.fill();
      octx.stroke();
    }
  }
  octx.restore();
}

/* ── 자르기 오버레이 ───────────────────────────────────── */
function drawCropOverlay(W, H) {
  const d = S.cropDraft;
  if (!d) return;
  const x = d.x * W, y = d.y * H, w = d.w * W, h = d.h * H;
  octx.save();
  octx.fillStyle = 'rgba(6,7,10,.62)';
  octx.fillRect(0, 0, W, y);
  octx.fillRect(0, y + h, W, H - y - h);
  octx.fillRect(0, y, x, h);
  octx.fillRect(x + w, y, W - x - w, h);

  octx.strokeStyle = 'rgba(255,255,255,.92)';
  octx.lineWidth = Math.max(1, 1.6 * dpr);
  octx.strokeRect(x, y, w, h);

  octx.strokeStyle = 'rgba(255,255,255,.24)';
  octx.lineWidth = 1;
  octx.beginPath();
  for (let i = 1; i < 3; i++) {
    octx.moveTo(x + w * i / 3, y); octx.lineTo(x + w * i / 3, y + h);
    octx.moveTo(x, y + h * i / 3); octx.lineTo(x + w, y + h * i / 3);
  }
  octx.stroke();

  octx.fillStyle = '#fff';
  const hs = 4.5 * dpr;
  const hpts = [
    [x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2],
    [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2],
  ];
  for (const [hx, hy] of hpts) {
    octx.beginPath();
    octx.rect(hx - hs, hy - hs, hs * 2, hs * 2);
    octx.fill();
  }
  octx.restore();
}

/* ── 좌표 ─────────────────────────────────────────────── */
function toNorm(e) {
  const r = overlay.getBoundingClientRect();
  return {
    x: clamp((e.clientX - r.left) / (r.width || 1), -0.5, 1.5),
    y: clamp((e.clientY - r.top) / (r.height || 1), -0.5, 1.5),
  };
}
function toPx(e) {
  const p = toNorm(e);
  return { x: p.x * overlay.width, y: p.y * overlay.height, nx: p.x, ny: p.y };
}

/* ── 제스처 ───────────────────────────────────────────── */
let g = null;

export function setTool(tool) {
  if (S.tool === 'crop' && tool !== 'crop') cancelCrop(true);
  S.tool = tool;
  if (tool === 'crop' && R.hasImage() && !S.cropDraft) enterCrop();
  document.getElementById('app').dataset.tool = tool;
  document.querySelectorAll('#rail .tool').forEach(b => b.classList.toggle('is-on', b.dataset.tool === tool));
  draw();
  emit('tool', tool);
}

/* 자르기 */
export function enterCrop() {
  if (!R.hasImage()) return;
  S.cropBackup = S.crop;
  S.cropDraft = S.crop ? { ...S.crop } : { x: 0, y: 0, w: 1, h: 1 };
  S.crop = null;
  resizeCanvas();
  emit('crop', S.cropDraft);
}
export function cancelCrop(silent) {
  if (S.tool === 'crop') {
    S.crop = S.cropBackup ?? null;
    S.cropDraft = null;
    resizeCanvas();
    if (!silent) emit('crop', null);
  }
}
export function applyCrop() {
  const d = S.cropDraft;
  if (!d) return;
  S.crop = clampCrop({ x: d.x, y: d.y, w: d.w, h: d.h });
  S.cropDraft = null;
  S.cropBackup = S.crop;
  commit('crop');
  setTool('select');
  resizeCanvas();
  emit('crop', null);
  toast('자르기를 적용했습니다');
}

function clampCrop(c) {
  let { x, y, w, h } = c;
  w = clamp(w, 0.02, 1); h = clamp(h, 0.02, 1);
  x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
  return { x, y, w, h };
}

/* 자르기 제스처 */
let cropG = null;

function cropHitTest(px, py, W, H) {
  const d = S.cropDraft;
  const x = d.x * W, y = d.y * H, w = d.w * W, h = d.h * H;
  const t = 12 * dpr;
  const hs = [
    ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y],
    ['e', x + w, y + h / 2], ['se', x + w, y + h], ['s', x + w / 2, y + h],
    ['sw', x, y + h], ['w', x, y + h / 2],
  ];
  for (const [name, hx, hy] of hs) {
    if (Math.abs(px - hx) <= t && Math.abs(py - hy) <= t) return name;
  }
  if (px > x && px < x + w && py > y && py < y + h) return 'move';
  return 'new';
}

function cropPointerDown(e) {
  const { x: px, y: py, nx, ny } = toPx(e);
  const W = overlay.width, H = overlay.height;
  const mode = cropHitTest(px, py, W, H);
  cropG = {
    mode, startN: { x: nx, y: ny },
    start: { ...S.cropDraft },
    aspect: currentAspect(),
  };
  if (mode === 'new') {
    S.cropDraft = { x: clamp(nx, 0, 0.98), y: clamp(ny, 0, 0.98), w: 0.02, h: 0.02 };
    cropG.start = { ...S.cropDraft };
  }
  invalidate();
}

function cropPointerMove(e) {
  if (!cropG) return;
  const { nx, ny } = toPx(e);
  const d0 = cropG.start;
  const dx = nx - cropG.startN.x, dy = ny - cropG.startN.y;
  let d = { ...d0 };

  if (cropG.mode === 'move') {
    d.x = clamp(d0.x + dx, 0, 1 - d0.w);
    d.y = clamp(d0.y + dy, 0, 1 - d0.h);
  } else if (cropG.mode === 'new') {
    let x = Math.min(cropG.startN.x, nx), y = Math.min(cropG.startN.y, ny);
    let w = Math.abs(nx - cropG.startN.x), h = Math.abs(ny - cropG.startN.y);
    if (cropG.aspect) {
      if (w / cropG.aspect > h) h = w / cropG.aspect; else w = h * cropG.aspect;
    }
    d = clampCrop({ x, y, w, h });
  } else {
    const m = cropG.mode;
    let x1 = d0.x, y1 = d0.y, x2 = d0.x + d0.w, y2 = d0.y + d0.h;
    if (m.includes('w')) x1 = clamp(d0.x + dx, 0, x2 - 0.02);
    if (m.includes('e')) x2 = clamp(d0.x + d0.w + dx, x1 + 0.02, 1);
    if (m.includes('n')) y1 = clamp(d0.y + dy, 0, y2 - 0.02);
    if (m.includes('s')) y2 = clamp(d0.y + d0.h + dy, y1 + 0.02, 1);
    let w = x2 - x1, h = y2 - y1;
    if (cropG.aspect) {
      const target = w / cropG.aspect;
      if (m === 'n' || m === 's') { h = h; w = h * cropG.aspect; }
      else { w = w; h = target; }
      if (m.includes('w')) x1 = x2 - w; else x2 = x1 + w;
      if (m.includes('n')) y1 = y2 - h; else y2 = y1 + h;
    }
    d = clampCrop({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(w), h: Math.abs(h) });
  }
  S.cropDraft = d;
  invalidate();
  emit('crop', d);
}

let aspectValue = null; // number | null
export function currentAspect() { return aspectValue; }
export function setAspect(v) {
  aspectValue = v;
  if (!S.cropDraft) return;
  if (!v) return;
  // 현재 초점을 중심으로 비율에 맞춘 최대 사각형
  const c = S.cropDraft;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  let w = c.w, h = w / v;
  if (h > 1) { h = 1; w = h * v; }
  if (w > 1) { w = 1; h = w / v; }
  let x = clamp(cx - w / 2, 0, 1 - w), y = clamp(cy - h / 2, 0, 1 - h);
  S.cropDraft = { x, y, w, h };
  invalidate();
  emit('crop', S.cropDraft);
}

/* ── 포인터 ───────────────────────────────────────────── */
overlay.addEventListener('pointerdown', e => {
  if (!R.hasImage()) return;
  overlay.setPointerCapture(e.pointerId);
  dragging = true;
  if (S.tool === 'crop') { cropPointerDown(e); return; }
  pointerDown(e);
});
overlay.addEventListener('pointermove', e => {
  if (!dragging) return;
  if (S.tool === 'crop') { cropPointerMove(e); return; }
  if (g) pointerMove(e);
});
overlay.addEventListener('pointerup', e => {
  dragging = false;
  if (S.tool === 'crop') { finishCropGesture(); return; }
  if (g) pointerUp(e);
});
overlay.addEventListener('pointercancel', () => {
  dragging = false;
  if (g) pointerUp({ clientX: 0, clientY: 0 });
});
overlay.addEventListener('dblclick', e => {
  if (!R.hasImage() || S.tool === 'crop') return;
  const { x, y } = toPx(e);
  const l = R.topLayerAt(x, y, overlay.width, overlay.height);
  if (l && l.type === 'text') {
    S.sel = l.id;
    setTool('text');
    emit('sel', l);
    setTimeout(() => document.getElementById('txText')?.focus(), 40);
  }
});

function pointerDown(e) {
  const { x: px, y: py, nx, ny } = toPx(e);
  const W = overlay.width, H = overlay.height;
  const tool = S.tool;

  if (tool === 'draw') return startStroke(nx, ny);
  if (tool === 'shape') return startShape(nx, ny);
  if (tool === 'mosaic') return startMosaic(nx, ny);
  if (tool === 'text') {
    const hit = R.topLayerAt(px, py, W, H);
    if (hit && hit.type === 'text') {
      S.sel = hit.id; mark();
      g = { type: 'move', layer: hit, startN: { x: nx, y: ny }, orig: { x: hit.x, y: hit.y } };
      emit('sel', hit); draw(); return;
    }
    const l = newTextLayer(clamp(nx, 0.1, 0.9), clamp(ny, 0.05, 0.95));
    mark();
    S.layers.push(l);
    S.sel = l.id;
    commit('text-add');
    emit('sel', l); draw();
    setTimeout(() => { const t = document.getElementById('txText'); if (t) { t.focus(); t.select(); } }, 60);
    return;
  }

  // 선택 도구
  const sel = selectedLayer();
  if (sel && sel.visible) {
    const { pts } = handlePoints(sel, W, H);
    const tol = 16 * dpr;
    for (const p of pts) {
      if (Math.hypot(px - p.x, py - p.y) <= tol) {
        if (p.hx === 9 && sel.type !== 'text') continue;
        mark();
        if (p.hx === 9) {
          const b = R.layerBounds(sel, W, H);
          g = {
            type: 'rotate', layer: sel,
            cx: b.cx, cy: b.cy,
            startAngle: Math.atan2(py - b.cy, px - b.cx),
            orig: sel.rot || 0,
          };
        } else {
          const b = R.layerBounds(sel, W, H);
          g = {
            type: 'scale', layer: sel, cx: b.cx, cy: b.cy,
            startDist: Math.max(8, Math.hypot(px - b.cx, py - b.cy)),
            orig: JSON.parse(JSON.stringify({
              size: sel.size, x1: sel.x1, y1: sel.y1, x2: sel.x2, y2: sel.y2,
              x: sel.x, y: sel.y, w: sel.w, h: sel.h,
              points: sel.points,
            })),
            startN: { x: nx, y: ny },
          };
        }
        draw();
        return;
      }
    }
  }

  const hit = R.topLayerAt(px, py, W, H);
  if (hit) {
    S.sel = hit.id;
    mark();
    g = {
      type: 'move', layer: hit, startN: { x: nx, y: ny },
      orig: { x: hit.x, y: hit.y, points: hit.type === 'stroke' ? hit.points.map(p => [p[0], p[1]]) : null },
    };
    emit('sel', hit);
    draw();
  } else {
    S.sel = null;
    emit('sel', null);
    draw();
  }
}

function pointerMove(e) {
  const { x: px, y: py, nx, ny } = toPx(e);
  const W = overlay.width, H = overlay.height;
  const t = g.type;

  if (t === 'move') {
    const l = g.layer;
    const dx = nx - g.startN.x, dy = ny - g.startN.y;
    if (l.type === 'shape') {
      l.x1 = g.orig.x1 + dx; l.y1 = g.orig.y1 + dy;
      l.x2 = g.orig.x2 + dx; l.y2 = g.orig.y2 + dy;
    } else if (l.type === 'text') {
      let x = g.orig.x + dx, y = g.orig.y + dy;
      if (Math.abs(x - 0.5) < 0.012) x = 0.5;
      if (Math.abs(y - 0.5) < 0.012) y = 0.5;
      l.x = x; l.y = y;
    } else {
      const b = R.layerBounds(l, W, H);
      l.x = g.orig.x + dx; l.y = g.orig.y + dy;
      if (l.type === 'stroke') l.points = g.orig.points.map(p => [p[0] + dx, p[1] + dy]);
    }
    invalidate();
    return;
  }

  if (t === 'rotate') {
    const ang = Math.atan2(py - g.cy, px - g.cx);
    let rot = g.orig + (ang - g.startAngle);
    const step = Math.PI / 12;
    if (Math.abs(rot % step) < 0.035) rot = Math.round(rot / step) * step;
    g.layer.rot = rot;
    invalidate();
    return;
  }

  if (t === 'scale') {
    const l = g.layer;
    const dist = Math.max(6, Math.hypot(px - g.cx, py - g.cy));
    const f = clamp(dist / g.startDist, 0.12, 8);
    if (l.type === 'text') {
      l.size = clamp(g.orig.size * f, 0.01, 1.6);
    } else if (l.type === 'shape') {
      l.x1 = g.cx + (g.orig.x1 * W - g.cx) * f; l.y1 = g.cy + (g.orig.y1 * H - g.cy) * f;
      l.x2 = g.cx + (g.orig.x2 * W - g.cx) * f; l.y2 = g.cy + (g.orig.y2 * H - g.cy) * f;
      l.x1 /= W; l.x2 /= W; l.y1 /= H; l.y2 /= H;
    } else if (l.type === 'mosaic') {
      const w = g.orig.w * f, h = g.orig.h * f;
      l.w = clamp(w, 0.01, 2); l.h = clamp(h, 0.01, 2);
      l.x = clamp(g.orig.x + g.orig.w / 2 - l.w / 2, -0.5, 1);
      l.y = clamp(g.orig.y + g.orig.h / 2 - l.h / 2, -0.5, 1);
    } else if (l.type === 'stroke') {
      const pts = g.orig.points;
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      const ccx = (minX + maxX) / 2 * W, ccy = (minY + maxY) / 2 * H;
      l.points = pts.map(p => [
        (ccx + (p[0] * W - ccx) * f) / W,
        (ccy + (p[1] * H - ccy) * f) / H,
      ]);
    }
    invalidate();
    return;
  }

  if (t === 'stroke') {
    const l = g.layer;
    const lastP = l.points[l.points.length - 1];
    const minStep = 0.0016;
    if (!lastP || Math.hypot(nx - lastP[0], ny - lastP[1]) > minStep) l.points.push([nx, ny]);
    invalidate();
    return;
  }

  if (t === 'shape') {
    const l = g.layer;
    l.x2 = nx; l.y2 = ny;
    if (e.shiftKey) {
      const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      l.x2 = l.x1 + Math.sign(dx) * m; l.y2 = l.y1 + Math.sign(dy) * m;
    }
    invalidate();
    return;
  }

  if (t === 'mosaic') {
    g.cur = { x: nx, y: ny };
    const r = rectFrom(g.start, g.cur);
    S._mosaicPreview = r;
    invalidate();
    return;
  }
}

function rectFrom(a, b) {
  return {
    x: clamp(Math.min(a.x, b.x), 0, 1), y: clamp(Math.min(a.y, b.y), 0, 1),
    w: clamp(Math.abs(b.x - a.x), 0, 1), h: clamp(Math.abs(b.y - a.y), 0, 1),
  };
}

function pointerUp() {
  const t = g && g.type;
  if (t === 'move' || t === 'scale' || t === 'rotate') {
    commit();
  } else if (t === 'stroke') {
    if (g.layer.points.length < 1) removeLayer(g.layer.id);
    commit();
  } else if (t === 'shape') {
    const l = g.layer;
    if (Math.abs(l.x2 - l.x1) < 0.006 && Math.abs(l.y2 - l.y1) < 0.006) removeLayer(l.id);
    commit();
  } else if (t === 'mosaic') {
    const r = S._mosaicPreview;
    S._mosaicPreview = null;
    if (r && r.w > 0.012 && r.h > 0.012) {
      const l = newMosaicLayer(r, S.mosaic.mode, S.mosaic.block);
      S.layers.push(l);
      S.sel = l.id;
      emit('sel', l);
      commit('mosaic');
    }
  }
  g = null;
  emit('state');
  draw();
}

function finishCropGesture() {
  if (!cropG) return;
  cropG = null;
  if (S.cropDraft && (S.cropDraft.w < 0.03 || S.cropDraft.h < 0.03)) {
    S.cropDraft = { x: 0, y: 0, w: 1, h: 1 };
  }
  invalidate();
}

/* ── 도구 시작 ─────────────────────────────────────────── */
function startStroke(nx, ny) {
  if (S.draw.mode === 'eraser') {
    const W = overlay.width, H = overlay.height;
    const l = R.topLayerAt(nx * W, ny * H, W, H);
    if (l && l.type === 'stroke') { removeLayer(l.id); commit('erase'); draw(); toast('선을 지웠습니다'); }
    g = { type: 'stroke-null' };
    return;
  }
  mark();
  const l = newStrokeLayer(S.draw.mode, S.draw.color, S.draw.width, S.draw.opacity);
  l.points.push([nx, ny]);
  S.layers.push(l);
  S.sel = l.id;
  g = { type: 'stroke', layer: l };
  emit('sel', l);
  draw();
}

function startShape(nx, ny) {
  mark();
  const l = newShapeLayer(S.shape.kind);
  l.x1 = nx; l.y1 = ny; l.x2 = nx; l.y2 = ny;
  S.layers.push(l);
  S.sel = l.id;
  g = { type: 'shape', layer: l };
  emit('sel', l);
  draw();
}

function startMosaic(nx, ny) {
  mark();
  g = { type: 'mosaic', start: { x: nx, y: ny }, cur: { x: nx, y: ny } };
  draw();
}

/* ── 사진 불러오기 ─────────────────────────────────────── */
let slotSeq = 0;

export async function addImageFromBlob(blob, name) {
  showBusy(true, '사진 여는 중…');
  try {
    let bmp, w, h;
    try {
      bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      w = bmp.width; h = bmp.height;
    } catch (err) {
      const url = URL.createObjectURL(blob);
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i); i.onerror = rej; i.src = url;
      });
      bmp = img; w = img.naturalWidth; h = img.naturalHeight;
    }
    const slot = {
      id: 'S' + (++slotSeq) + '_' + Date.now().toString(36),
      name: name || '사진', bmp, w, h,
      url: URL.createObjectURL(blob),
      bytes: blob.size,
    };
    S.slots.push(slot);
    selectSlot(slot.id, !S.keepEdit);
    return slot;
  } finally {
    showBusy(false);
  }
}

export function selectSlot(id, resetEdit) {
  const slot = S.slots.find(s => s.id === id);
  if (!slot) return;
  S.slotId = id;
  S.view = { rot: 0, flipH: false, flipV: false };
  S.crop = null;
  if (resetEdit || !S.keepEdit) resetEdits(false);
  R.clearCaches();
  resizeCanvas();
  emit('slots');
  emit('state');
  commit('slot');
}

export function removeSlot(id) {
  const i = S.slots.findIndex(s => s.id === id);
  if (i < 0) return;
  const [slot] = S.slots.splice(i, 1);
  if (slot.url) URL.revokeObjectURL(slot.url);
  if (S.slotId === id) {
    S.slotId = S.slots.length ? S.slots[Math.min(i, S.slots.length - 1)].id : null;
    R.clearCaches();
    if (!S.slotId) { S.layers = []; S.sel = null; }
  }
  resizeCanvas();
  emit('slots');
  commit('slot-remove');
}

export function resetEdits(doCommit = true) {
  S.layers = [];
  S.sel = null;
  S.adj = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, vignette: 0, blur: 0 };
  S.preset = 'original';
  S.view = { rot: 0, flipH: false, flipV: false };
  S.crop = null;
  R.clearCaches();
  resizeCanvas();
  emit('sel', null);
  emit('state');
  if (doCommit) commit('reset');
}

export async function handleFiles(files) {
  const list = Array.from(files || []).filter(f => f.type.startsWith('image/'));
  if (!list.length) { toast('이미지 파일이 아닙니다'); return; }
  for (const f of list) {
    try { await addImageFromBlob(f, f.name.replace(/\.[^.]+$/, '')); }
    catch (err) { console.error(err); toast('사진을 열 수 없습니다: ' + f.name); }
  }
}

export function makeSample() {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1200;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, '#2b3a67');
  sky.addColorStop(.45, '#7b5ea7');
  sky.addColorStop(.7, '#e58f65');
  sky.addColorStop(1, '#f6c177');
  g.fillStyle = sky; g.fillRect(0, 0, 1600, 1200);
  g.fillStyle = 'rgba(255,240,210,.95)';
  g.beginPath(); g.arc(1120, 520, 120, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,240,210,.16)';
  g.beginPath(); g.arc(1120, 520, 220, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3b2b4a';
  g.beginPath(); g.moveTo(0, 900); g.lineTo(420, 560); g.lineTo(760, 900); g.closePath(); g.fill();
  g.fillStyle = '#4d3860';
  g.beginPath(); g.moveTo(520, 900); g.lineTo(980, 500); g.lineTo(1420, 900); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,.16)';
  g.beginPath(); g.moveTo(980, 500); g.lineTo(1100, 640); g.lineTo(860, 640); g.closePath(); g.fill();
  const ground = g.createLinearGradient(0, 880, 0, 1200);
  ground.addColorStop(0, '#241a2e'); ground.addColorStop(1, '#120d18');
  g.fillStyle = ground; g.fillRect(0, 880, 1600, 320);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * .7})`;
    const s = Math.random() * 2.4 + .6;
    g.fillRect(Math.random() * 1600, Math.random() * 700, s, s);
  }
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.92));
}

export async function loadSample() {
  const blob = await makeSample();
  await addImageFromBlob(blob, '샘플');
  toast('샘플 사진을 열었습니다');
}

/* ── 내보내기 ─────────────────────────────────────────── */
export async function buildExport() {
  if (!R.hasImage()) return null;
  const { w: ow, h: oh } = R.outputSize();
  const maxSide = Number(S.export.maxSide) || 0;
  const scale = maxSide ? Math.min(1, maxSide / Math.max(ow, oh)) : 1;
  const W = Math.max(1, Math.round(ow * scale));
  const H = Math.max(1, Math.round(oh * scale));

  await ensureFonts();

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (S.export.fmt === 'jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
  R.clearCaches(); // 폰트 로드 후 레이아웃 재측정
  R.renderScene(ctx, W, H);

  const mime = S.export.fmt === 'jpeg' ? 'image/jpeg' : S.export.fmt === 'webp' ? 'image/webp' : 'image/png';
  const q = S.export.quality / 100;
  const blob = await new Promise(res => c.toBlob(res, mime, q));
  return { blob, W, H, mime };
}

async function ensureFonts() {
  if (!document.fonts) return;
  const jobs = [];
  const seen = new Set();
  for (const l of S.layers) {
    if (l.type !== 'text') continue;
    const k = `${l.weight} ${l.font}`;
    if (seen.has(k)) continue;
    seen.add(k);
    try { jobs.push(document.fonts.load(`${l.weight} 48px "${l.font}"`, l.text || '가')); } catch (e) { /* noop */ }
  }
  try { await Promise.all(jobs); } catch (e) { /* noop */ }
  try { await document.fonts.ready; } catch (e) { /* noop */ }
}

export async function downloadImage() {
  showBusy(true, '내보내는 중…');
  try {
    const out = await buildExport();
    if (!out) { toast('먼저 사진을 불러오세요'); return; }
    const ext = S.export.fmt === 'jpeg' ? 'jpg' : S.export.fmt;
    const base = (S.export.name || 'photo-editor').replace(/[\\/:*?"<>|]+/g, '').trim() || 'photo-editor';
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const name = `${base}-${stamp}.${ext}`;
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`저장 완료 · ${out.W}×${out.H} ${ext.toUpperCase()}`);
    return { name, ...out };
  } catch (err) {
    console.error(err);
    toast('저장에 실패했습니다');
    return null;
  } finally {
    showBusy(false);
  }
}

export async function shareImage() {
  const out = await buildExport();
  if (!out) { toast('먼저 사진을 불러오세요'); return false; }
  const file = new File([out.blob], `photo-editor.${S.export.fmt === 'jpeg' ? 'jpg' : S.export.fmt}`, { type: out.mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '사진 편집기' }); return true; }
    catch (e) { return false; }
  }
  toast('이 브라우저는 공유를 지원하지 않습니다 — 다운로드를 사용하세요');
  return false;
}

/* ── 유틸 ─────────────────────────────────────────────── */
let busyTimer = 0;
export function showBusy(on, text) {
  const el = document.getElementById('busy');
  if (!el) return;
  if (text) document.getElementById('busyText').textContent = text;
  if (on) { el.classList.add('on'); clearTimeout(busyTimer); }
  else { busyTimer = setTimeout(() => el.classList.remove('on'), 120); }
}

let toastTimer = 0;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

/* ── 키보드 ───────────────────────────────────────────── */
export function bindKeyboard() {
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === 'z') {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) { if (redo()) afterHistory(); }
      else if (undo()) afterHistory();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') { if (!typing) { e.preventDefault(); if (redo()) afterHistory(); } return; }
    if (meta && e.key.toLowerCase() === 'd') {
      const l = selectedLayer();
      if (l && !typing) { e.preventDefault(); emit('duplicate', l); }
      return;
    }
    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault();
      downloadImage();
      return;
    }
    if (meta && e.key.toLowerCase() === 'o') {
      e.preventDefault(); document.getElementById('fileInput').click(); return;
    }
    if (typing) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const l = selectedLayer();
      if (l) { e.preventDefault(); removeLayer(l.id); emit('sel', null); commit('del'); draw(); }
      return;
    }
    if (e.key === 'Escape') {
      if (S.tool === 'crop') { cancelCrop(); setTool('photo'); }
      else { S.sel = null; emit('sel', null); draw(); }
      return;
    }
    if (e.key.startsWith('Arrow')) {
      const l = selectedLayer();
      if (!l) return;
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * 0.002;
      if (l.type === 'shape') {
        if (e.key === 'ArrowLeft') { l.x1 -= step; l.x2 -= step; }
        if (e.key === 'ArrowRight') { l.x1 += step; l.x2 += step; }
        if (e.key === 'ArrowUp') { l.y1 -= step; l.y2 -= step; }
        if (e.key === 'ArrowDown') { l.y1 += step; l.y2 += step; }
      } else if (l.type === 'stroke') {
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        l.points = l.points.map(p => [p[0] + d[0], p[1] + d[1]]);
      } else if (l.type === 'mosaic') {
        if (e.key === 'ArrowLeft') l.x -= step;
        if (e.key === 'ArrowRight') l.x += step;
        if (e.key === 'ArrowUp') l.y -= step;
        if (e.key === 'ArrowDown') l.y += step;
      } else {
        if (e.key === 'ArrowLeft') l.x -= step;
        if (e.key === 'ArrowRight') l.x += step;
        if (e.key === 'ArrowUp') l.y -= step;
        if (e.key === 'ArrowDown') l.y += step;
      }
      invalidate();
      return;
    }
  });
  // 붙여넣기
  document.addEventListener('paste', async e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); await addImageFromBlob(f, '붙여넣은 사진'); toast('사진을 붙여넣었습니다'); return; }
      }
    }
  });
}

function afterHistory() {
  R.clearCaches();
  S.sel = S.sel && findLayer(S.sel) ? S.sel : null;
  resizeCanvas();
  emit('sel', selectedLayer());
  emit('slots');
  emit('state');
}

export { afterHistory, findLayer };
