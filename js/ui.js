/* ============================================================
   ui.js — 패널 · 컨트롤 · 목록 바인딩
   ============================================================ */

import { S, FONTS, PRESETS, ADJ_DEFS, commit, mark, undo, redo, setHistoryListener,
         historyState, selectedLayer, removeLayer, layerLabel, newTextLayer, uid } from './state.js';
import * as R from './render.js';
import * as E from './editor.js';

const $ = id => document.getElementById(id);
const ZERO_ADJ = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, vignette: 0, blur: 0 };

/* ── 초기화 ───────────────────────────────────────────── */
export function initUI() {
  buildAdjSliders();
  buildFilterGrid();
  buildFontSelect();
  bindTopbar();
  bindRail();
  bindPhotoPane();
  bindCropPane();
  bindAdjustPane();
  bindTextPane();
  bindDrawPane();
  bindShapePane();
  bindMosaicPane();
  bindSaveModal();
  bindLayers();
  bindDnd();
  bindPanelCollapse();

  setHistoryListener(updateHistoryButtons);
  E.on('tool', t => {
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('is-on', p.dataset.pane === t));
  });
  E.on('sel', l => syncSelection(l));
  E.on('slots', () => { updateSlots(); updateFilterThumbs(); });
  E.on('state', () => { updateSlots(); updateSizeLabel(); updateFilterState(); });
  E.on('crop', d => updateCropInfo(d));

  updateHistoryButtons();
  updateSizeLabel();
  syncSelection(null);
  updateSlots();
  E.setTool('select');
  window.addEventListener('resize', () => E.resizeCanvas());
  window.addEventListener('orientationchange', () => setTimeout(() => E.resizeCanvas(), 260));
}

/* ── 상단 ─────────────────────────────────────────────── */
function bindTopbar() {
  $('btnOpen').onclick = () => $('fileInput').click();
  $('btnOpen2').onclick = () => $('fileInput').click();
  $('btnEmptyOpen').onclick = () => $('fileInput').click();
  $('btnSelOpen').onclick = () => $('fileInput').click();
  $('btnSample').onclick = () => E.loadSample();
  $('btnEmptySample').onclick = () => E.loadSample();
  $('btnSave').onclick = openSave;
  $('btnUndo').onclick = () => { if (undo()) E.afterHistory(); };
  $('btnRedo').onclick = () => { if (redo()) E.afterHistory(); };
  $('fileInput').onchange = e => {
    E.handleFiles(e.target.files);
    e.target.value = '';
  };
}

function updateHistoryButtons() {
  const { canUndo, canRedo } = historyState();
  $('btnUndo').disabled = !canUndo;
  $('btnRedo').disabled = !canRedo;
}

/* ── 도구 레일 ────────────────────────────────────────── */
function bindRail() {
  document.querySelectorAll('#rail .tool').forEach(btn => {
    btn.onclick = () => {
      const t = btn.dataset.tool;
      E.setTool(t);
      if (t === 'text') setTimeout(() => { if (!selectedLayer()) $('btnAddText').focus(); }, 30);
      if (t === 'crop' && !R.hasImage()) E.toast('먼저 사진을 불러오세요');
    };
  });
  $('btnSelText').onclick = () => { E.setTool('text'); addTextCenter(); };
}

/* ── 사진 패널 ────────────────────────────────────────── */
function bindPhotoPane() {
  $('keepEdit').checked = S.keepEdit;
  $('keepEdit').onchange = e => { S.keepEdit = e.target.checked; };
  $('btnResetEdit').onclick = () => {
    if (!R.hasImage()) return E.toast('사진이 없습니다');
    if (!confirm('텍스트·필터·모자이크 등 모든 편집을 지울까요?')) return;
    E.resetEdits();
    E.toast('편집을 초기화했습니다');
  };
}

function updateSlots() {
  const list = $('slotList');
  const strip = $('slotStrip');
  $('slotCount').textContent = String(S.slots.length);
  if (!S.slots.length) {
    list.innerHTML = '<p class="note">아직 없습니다.</p>';
    strip.innerHTML = '';
    return;
  }
  list.innerHTML = '';
  S.slots.forEach(s => {
    const row = document.createElement('div');
    row.className = 'slot-row' + (s.id === S.slotId ? ' is-on' : '');
    const img = new Image(); img.src = s.url; img.alt = s.name;
    const meta = document.createElement('div');
    meta.className = 'slot-meta';
    const nm = document.createElement('div'); nm.className = 'slot-name'; nm.textContent = s.name;
    const dm = document.createElement('div'); dm.className = 'slot-dim';
    dm.textContent = `${s.w}×${s.h} · ${fmtBytes(s.bytes)}`;
    meta.append(nm, dm);
    const x = document.createElement('button');
    x.className = 'slot-x'; x.textContent = '✕'; x.title = '이 사진 빼기';
    x.onclick = ev => { ev.stopPropagation(); E.removeSlot(s.id); };
    row.append(img, meta, x);
    row.onclick = () => { if (s.id !== S.slotId) { E.selectSlot(s.id); E.toast(`‘${s.name}’ 사진으로 교체`); } };
    list.append(row);
  });

  strip.innerHTML = '';
  S.slots.forEach(s => {
    const im = new Image();
    im.src = s.url; im.className = 'slot-thumb' + (s.id === S.slotId ? ' is-on' : '');
    im.title = s.name;
    im.onclick = () => { if (s.id !== S.slotId) E.selectSlot(s.id); };
    strip.append(im);
  });
}

function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024 * 1024) return Math.round(b / 1024) + 'KB';
  return (b / 1024 / 1024).toFixed(1) + 'MB';
}

function updateSizeLabel() {
  const el = $('sizeLabel');
  const tip = $('tipText');
  if (!R.hasImage()) { el.textContent = '—'; if (tip) tip.textContent = '사진을 불러오면 편집을 시작합니다'; return; }
  const o = R.outputSize();
  const b = R.baseSize();
  el.textContent = `${o.w} × ${o.h}px`;
  if (tip) {
    const n = S.layers.length;
    tip.textContent = n ? `레이어 ${n}개 · 원본 ${b.w}×${b.h}` : `원본 ${b.w}×${b.h}px`;
  }
}

/* ── 자르기 ───────────────────────────────────────────── */
function bindCropPane() {
  document.querySelectorAll('#aspectChips .chip').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('#aspectChips .chip').forEach(x => x.classList.toggle('is-on', x === c));
      const a = c.dataset.aspect;
      E.setAspect(a === 'free' ? null : a.split(':').map(Number).reduce((p, q) => p / q));
      E.toast(a === 'free' ? '자유 비율' : `${a} 비율 고정`);
    };
  });
  $('btnRotL').onclick = () => {
    if (!R.hasImage()) return;
    mark();
    S.view.rot = (S.view.rot + 270) % 360;
    if (S.tool === 'crop') S.cropDraft = { x: 0, y: 0, w: 1, h: 1 };
    else S.crop = null;
    R.clearCaches();
    E.resizeCanvas();
    commit('rotate');
  };
  $('btnFlipH').onclick = () => {
    if (!R.hasImage()) return;
    mark(); S.view.flipH = !S.view.flipH; R.clearCaches(); E.resizeCanvas(); commit('flip');
  };
  $('btnFlipV').onclick = () => {
    if (!R.hasImage()) return;
    mark(); S.view.flipV = !S.view.flipV; R.clearCaches(); E.resizeCanvas(); commit('flip');
  };
  $('btnCropApply').onclick = () => E.applyCrop();
  $('btnCropCancel').onclick = () => {
    E.cancelCrop();
    E.setTool('select');
  };
}

function updateCropInfo(d) {
  const note = $('cropNote');
  if (!note) return;
  if (d) {
    const o = R.baseSize();
    note.textContent = `자르기 영역 ${Math.round(d.w * o.w)}×${Math.round(d.h * o.h)}px · 모서리를 끌어 조절, 안쪽을 끌면 이동합니다.`;
  } else {
    note.textContent = '모서리를 끌어 자르고, 안쪽을 끌면 영역이 이동합니다.';
  }
}

/* ── 색감 ─────────────────────────────────────────────── */
function buildAdjSliders() {
  const box = $('adjSliders');
  box.innerHTML = '';
  ADJ_DEFS.forEach(d => {
    const f = document.createElement('label');
    f.className = 'field';
    f.innerHTML = `<span class="lbl">${d.label} <b id="adjv-${d.key}">0</b></span>`;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = d.step; inp.value = 0;
    inp.id = 'adj-' + d.key;
    let marking = false;
    inp.oninput = () => {
      if (!marking) { mark(); marking = true; }
      S.adj[d.key] = Number(inp.value);
      S.preset = 'custom';
      $('adjv-' + d.key).textContent = fmtAdj(d.key, inp.value);
      updateFilterState();
      E.invalidate();
    };
    inp.onchange = () => { marking = false; commit('adj'); };
    f.append(inp);
    box.append(f);
  });
}

function fmtAdj(key, v) {
  if (key === 'temperature') return v > 0 ? `따뜻 +${v}` : v < 0 ? `차갑 ${v}` : '0';
  return String(v);
}

function syncAdj() {
  ADJ_DEFS.forEach(d => {
    const inp = $('adj-' + d.key);
    if (!inp) return;
    inp.value = S.adj[d.key] || 0;
    $('adjv-' + d.key).textContent = fmtAdj(d.key, S.adj[d.key] || 0);
  });
  updateFilterState();
}

function buildFilterGrid() {
  const box = $('filterGrid');
  box.innerHTML = '';
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'filter-btn' + (p.id === 'original' ? ' is-on' : '');
    b.dataset.preset = p.id;
    const img = document.createElement('img');
    img.className = 'fthumb';
    img.alt = p.label;
    b.append(img);
    const s = document.createElement('span');
    s.textContent = p.label;
    b.append(s);
    b.onclick = () => applyPreset(p.id);
    box.append(b);
  });
}

function updateFilterThumbs() {
  const slot = R.currentSlot();
  document.querySelectorAll('#filterGrid .filter-btn').forEach(b => {
    const img = b.querySelector('img');
    if (slot) { img.src = slot.url; img.style.display = ''; } else { img.style.display = 'none'; }
    img.style.filter = cssFilterFor(b.dataset.preset);
  });
}

function cssFilterFor(id) {
  const p = PRESETS.find(x => x.id === id);
  if (!p) return 'none';
  const a = p.adj;
  const parts = [];
  if (a.brightness) parts.push(`brightness(${1 + a.brightness / 100})`);
  if (a.contrast) parts.push(`contrast(${1 + a.contrast / 100})`);
  if (a.saturation !== 0) parts.push(`saturate(${Math.max(0, 1 + a.saturation / 100)})`);
  if (a.temperature) parts.push(a.temperature > 0 ? 'sepia(.28)' : 'hue-rotate(-8deg) saturate(1.05)');
  return parts.join(' ') || 'none';
}

function applyPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  if (!p) return;
  mark();
  S.adj = { ...ZERO_ADJ, ...p.adj };
  S.preset = id;
  commit('preset');
  syncAdj();
  E.invalidate();
  E.toast(`필터 · ${p.label}`);
}

function updateFilterState() {
  document.querySelectorAll('#filterGrid .filter-btn').forEach(b => {
    b.classList.toggle('is-on', b.dataset.preset === S.preset);
  });
}

function bindAdjustPane() {
  $('btnAdjReset').onclick = () => applyPreset('original');

  const cmp = $('btnCompare');
  const on = () => {
    if (!R.hasImage()) return;
    cmp._bak = { ...S.adj };
    S.adj = { ...ZERO_ADJ };
    E.invalidate();
    cmp.classList.add('is-on');
  };
  const off = () => {
    if (cmp._bak) { S.adj = cmp._bak; cmp._bak = null; E.invalidate(); cmp.classList.remove('is-on'); }
  };
  cmp.addEventListener('pointerdown', e => { e.preventDefault(); on(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => cmp.addEventListener(ev, off));
  window.addEventListener('blur', off);
}

/* ── 텍스트 ───────────────────────────────────────────── */
function buildFontSelect() {
  const sel = $('txFont');
  sel.innerHTML = '';
  FONTS.forEach(f => {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.label;
    sel.append(o);
  });
}

function bindTextPane() {
  $('btnAddText').onclick = () => addTextCenter();

  const withLayer = fn => {
    const l = selectedLayer();
    if (!l || l.type !== 'text') return null;
    fn(l);
    E.invalidate();
    return l;
  };
  const live = (el, fn) => {
    let marking = false;
    el.addEventListener('input', () => {
      if (!marking) { mark(); marking = true; }
      withLayer(fn);
    });
    el.addEventListener('change', () => { marking = false; commit('text'); updateLayerList(); });
  };

  const ta = $('txText');
  let taMarking = false;
  ta.addEventListener('input', () => {
    if (!taMarking) { mark(); taMarking = true; }
    withLayer(l => { l.text = ta.value; });
    updateLayerList();
  });
  ta.addEventListener('blur', () => { if (taMarking) { taMarking = false; commit('text'); } });

  $('txFont').addEventListener('change', () => {
    const l = withLayer(l => {
      l.font = $('txFont').value;
      const fam = FONTS.find(f => f.id === l.font);
      if (fam && !fam.weights.includes(l.weight)) l.weight = fam.weights[0];
    });
    if (l) {
      commit('text'); previewFont(l); syncWeightButtons(l.weight); updateLayerList();
    }
  });

  live($('txSize'), l => { l.size = Number($('txSize').value) / 100; $('txSizeVal').textContent = $('txSize').value + '%'; });
  live($('txWrap'), l => { l.maxW = Number($('txWrap').value) / 100; $('txWrapVal').textContent = $('txWrap').value + '%'; });
  live($('txTracking'), l => { l.tracking = Number($('txTracking').value); });
  live($('txLeading'), l => { l.leading = Number($('txLeading').value); });
  live($('txColor'), l => { l.color = $('txColor').value; });
  live($('txOpacity'), l => { l.opacity = Number($('txOpacity').value); });
  live($('txStrokeColor'), l => { l.stroke.color = $('txStrokeColor').value; });
  live($('txStrokeWidth'), l => {
    l.stroke.width = Number($('txStrokeWidth').value);
    $('txStrokeVal').textContent = $('txStrokeWidth').value;
  });
  live($('txShadowColor'), l => { l.shadow.color = $('txShadowColor').value; });
  live($('txShadowAlpha'), l => { l.shadow.alpha = Number($('txShadowAlpha').value); });
  live($('txShadowBlur'), l => { l.shadow.blur = Number($('txShadowBlur').value); $('txShadowBlurVal').textContent = $('txShadowBlur').value; });
  live($('txShadowX'), l => { l.shadow.x = Number($('txShadowX').value); });
  live($('txShadowY'), l => { l.shadow.y = Number($('txShadowY').value); });
  live($('txBgColor'), l => { l.bg.color = $('txBgColor').value; });
  live($('txBgRadius'), l => { l.bg.radius = Number($('txBgRadius').value); });
  live($('txBgPad'), l => { l.bg.padX = Number($('txBgPad').value); l.bg.padY = Number($('txBgPad').value) * 0.55; });
  live($('txBgAlpha'), l => { l.bg.alpha = Number($('txBgAlpha').value); });

  $('txItalic').addEventListener('change', () => {
    withLayer(l => { l.italic = $('txItalic').checked; });
    commit('text'); updateLayerList();
  });
  $('txBgOn').addEventListener('change', () => {
    withLayer(l => { l.bg.on = $('txBgOn').checked; });
    commit('text');
  });

  document.querySelectorAll('#txAlign button').forEach(b => {
    b.onclick = () => {
      withLayer(l => { l.align = b.dataset.align; });
      document.querySelectorAll('#txAlign button').forEach(x => x.classList.toggle('is-on', x === b));
      commit('text');
    };
  });
  document.querySelectorAll('#txWeight button').forEach(b => {
    b.onclick = () => {
      const l = withLayer(l => { l.weight = Number(b.dataset.weight); });
      if (l && l.type === 'text') previewFont(l);
      syncWeightButtons(Number(b.dataset.weight));
      commit('text');
    };
  });

  $('btnDupText').onclick = () => duplicateSelected();
  $('btnDelText').onclick = () => {
    const l = selectedLayer();
    if (!l) return;
    mark(); removeLayer(l.id); commit('del'); E.emit('sel', null); E.draw(); updateLayerList();
  };
  $('btnFrontText').onclick = () => {
    const l = selectedLayer();
    if (!l) return;
    mark();
    S.layers = S.layers.filter(x => x !== l); S.layers.push(l);
    commit('order'); E.draw(); updateLayerList();
  };
  $('btnBackText').onclick = () => {
    const l = selectedLayer();
    if (!l) return;
    mark();
    S.layers = S.layers.filter(x => x !== l); S.layers.unshift(l);
    commit('order'); E.draw(); updateLayerList();
  };
}

function addTextCenter() {
  if (!R.hasImage()) { E.toast('먼저 사진을 불러오세요'); return; }
  mark();
  const l = newTextLayer(0.5, 0.5);
  S.layers.push(l);
  S.sel = l.id;
  commit('text-add');
  E.setTool('text');
  E.emit('sel', l);
  E.draw();
  updateLayerList();
  setTimeout(() => { const t = $('txText'); if (t) { t.focus(); t.select(); } }, 80);
}

function duplicateSelected() {
  const l = selectedLayer();
  if (!l) return E.toast('복제할 레이어를 먼저 선택하세요');
  mark();
  const copy = JSON.parse(JSON.stringify(l));
  copy.id = uid();
  if (copy.type === 'text') { copy.x = Math.min(0.95, copy.x + 0.03); copy.y = Math.min(0.95, copy.y + 0.03); }
  if (copy.type === 'shape') { copy.x1 += 0.03; copy.x2 += 0.03; copy.y1 += 0.03; copy.y2 += 0.03; }
  if (copy.type === 'stroke') copy.points = copy.points.map(p => [p[0] + 0.03, p[1] + 0.03]);
  if (copy.type === 'mosaic') { copy.x += 0.03; copy.y += 0.03; }
  S.layers.push(copy);
  S.sel = copy.id;
  commit('dup');
  E.emit('sel', copy);
  E.draw();
  updateLayerList();
  E.toast('복제했습니다');
}

function previewFont(l) {
  const el = $('fontPreview');
  el.style.fontFamily = `"${l.font}", "Noto Sans KR", sans-serif`;
  el.style.fontWeight = String(l.weight || 400);
  el.style.fontStyle = l.italic ? 'italic' : 'normal';
  if (document.fonts) {
    document.fonts.load(`${l.weight || 400} 20px "${l.font}"`, '가나다 ABC 123').catch(() => {});
  }
}

function syncWeightButtons(weight) {
  document.querySelectorAll('#txWeight button').forEach(b => {
    b.classList.toggle('is-on', Number(b.dataset.weight) === weight);
    b.disabled = false;
  });
  const l = selectedLayer();
  if (l && l.type === 'text') {
    const fam = FONTS.find(f => f.id === l.font);
    if (fam) {
      document.querySelectorAll('#txWeight button').forEach(b => {
        b.disabled = !fam.weights.includes(Number(b.dataset.weight));
      });
    }
  }
}

function syncSelection(l) {
  const isText = l && l.type === 'text';
  $('txtEdit').style.display = isText ? '' : 'none';
  $('textEmptyNote').style.display = isText ? 'none' : '';
  document.querySelectorAll('#txWeight button, #txAlign button').forEach(b => b.classList.remove('is-on'));
  if (!isText) { updateLayerList(); return; }

  $('txText').value = l.text;
  $('txFont').value = l.font;
  $('txSize').value = Math.round(l.size * 100);
  $('txSizeVal').textContent = Math.round(l.size * 100) + '%';
  $('txWrap').value = Math.round(l.maxW * 100);
  $('txWrapVal').textContent = Math.round(l.maxW * 100) + '%';
  $('txTracking').value = l.tracking;
  $('txLeading').value = l.leading;
  $('txColor').value = l.color;
  $('txOpacity').value = l.opacity;
  $('txItalic').checked = !!l.italic;
  $('txStrokeColor').value = l.stroke.color;
  $('txStrokeWidth').value = l.stroke.width;
  $('txStrokeVal').textContent = l.stroke.width;
  $('txShadowColor').value = l.shadow.color;
  $('txShadowAlpha').value = l.shadow.alpha;
  $('txShadowBlur').value = l.shadow.blur;
  $('txShadowBlurVal').textContent = l.shadow.blur;
  $('txShadowX').value = l.shadow.x;
  $('txShadowY').value = l.shadow.y;
  $('txBgOn').checked = !!l.bg.on;
  $('txBgColor').value = l.bg.color;
  $('txBgRadius').value = l.bg.radius;
  $('txBgPad').value = l.bg.padX;
  $('txBgAlpha').value = l.bg.alpha;
  document.querySelectorAll('#txAlign button').forEach(b => b.classList.toggle('is-on', b.dataset.align === l.align));
  syncWeightButtons(l.weight);
  previewFont(l);
  updateLayerList();
}

/* ── 그리기 / 도형 / 모자이크 ─────────────────────────── */
function bindDrawPane() {
  document.querySelectorAll('#drawModes .chip').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('#drawModes .chip').forEach(x => x.classList.toggle('is-on', x === c));
      S.draw.mode = c.dataset.mode;
    };
  });
  $('drawColor').oninput = e => { S.draw.color = e.target.value; applyToSelected(s => s.color = e.target.value, 'stroke'); };
  $('drawWidth').oninput = e => {
    S.draw.width = Number(e.target.value);
    $('drawWidthVal').textContent = e.target.value;
    applyToSelected(s => s.width = Number(e.target.value) / 1000, 'stroke');
  };
  $('drawOpacity').oninput = e => {
    S.draw.opacity = Number(e.target.value);
    $('drawOpacityVal').textContent = e.target.value + '%';
    applyToSelected(s => s.opacity = Number(e.target.value), 'stroke');
  };
  bindLiveCommit(['drawColor', 'drawWidth', 'drawOpacity']);
}

function bindShapePane() {
  document.querySelectorAll('#shapeKinds .chip').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('#shapeKinds .chip').forEach(x => x.classList.toggle('is-on', x === c));
      S.shape.kind = c.dataset.shape;
    };
  });
  $('shapeColor').oninput = e => { S.shape.color = e.target.value; applyToSelected(s => s.color = e.target.value, 'shape'); };
  $('shapeWidth').oninput = e => {
    S.shape.width = Number(e.target.value);
    $('shapeWidthVal').textContent = e.target.value;
    applyToSelected(s => s.width = Number(e.target.value) / 1000, 'shape');
  };
  $('shapeFill').onchange = e => { S.shape.fill = e.target.checked; applyToSelected(s => s.fill = e.target.checked, 'shape'); commit('shape'); };
  $('shapeFillColor').oninput = e => { S.shape.fillColor = e.target.value; applyToSelected(s => s.fillColor = e.target.value, 'shape'); };
  $('shapeOpacity').oninput = e => {
    S.shape.opacity = Number(e.target.value);
    $('shapeOpacityVal').textContent = e.target.value + '%';
    applyToSelected(s => s.opacity = Number(e.target.value), 'shape');
  };
  bindLiveCommit(['shapeColor', 'shapeWidth', 'shapeFillColor', 'shapeOpacity']);
}

function bindMosaicPane() {
  document.querySelectorAll('#mosaicModes .chip').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('#mosaicModes .chip').forEach(x => x.classList.toggle('is-on', x === c));
      S.mosaic.mode = c.dataset.mode;
      applyToSelected(s => s.mode = c.dataset.mode, 'mosaic');
      commit('mosaic');
    };
  });
  $('mosaicSize').oninput = e => {
    S.mosaic.block = Number(e.target.value);
    $('mosaicSizeVal').textContent = e.target.value;
    applyToSelected(s => s.block = Number(e.target.value) / 1000, 'mosaic');
  };
  $('mosaicSize').onchange = () => commit('mosaic');
  $('btnClearMosaic').onclick = () => {
    if (!S.layers.some(l => l.type === 'mosaic')) return E.toast('모자이크가 없습니다');
    mark();
    S.layers = S.layers.filter(l => l.type !== 'mosaic');
    if (S.sel && !S.layers.some(l => l.id === S.sel)) S.sel = null;
    commit('mosaic-clear'); E.draw(); updateLayerList(); E.toast('모자이크를 지웠습니다');
  };
}

function applyToSelected(fn, type) {
  const l = selectedLayer();
  if (l && l.type === type) { fn(l); E.invalidate(); updateLayerList(); }
}

function bindLiveCommit(ids) {
  ids.forEach(id => {
    const el = $(id);
    if (!el) return;
    let marking = false;
    el.addEventListener('pointerdown', () => { if (!marking) { mark(); marking = true; } });
    el.addEventListener('change', () => { marking = false; commit('edit'); });
  });
}

/* ── 레이어 목록 ──────────────────────────────────────── */
function bindLayers() {
  updateLayerList();
}

function layerIcon(l) {
  if (l.type === 'text') return 'T';
  if (l.type === 'stroke') return '✎';
  if (l.type === 'shape') return '▭';
  return '▦';
}

export function updateLayerList() {
  const box = $('layerList');
  $('layerCount').textContent = String(S.layers.length);
  if (!S.layers.length) {
    box.innerHTML = '<div class="layer-empty">레이어가 없습니다.</div>';
    return;
  }
  box.innerHTML = '';
  for (let i = S.layers.length - 1; i >= 0; i--) {
    const l = S.layers[i];
    const row = document.createElement('button');
    row.className = 'layer-item' + (l.id === S.sel ? ' is-on' : '');
    const ic = document.createElement('span'); ic.className = 'lico'; ic.textContent = layerIcon(l);
    const nm = document.createElement('span'); nm.className = 'lname'; nm.textContent = layerLabel(l);
    const vis = document.createElement('span'); vis.className = 'lvis';
    vis.textContent = l.visible ? '◉' : '○';
    vis.title = l.visible ? '숨기기' : '보이기';
    vis.onclick = ev => {
      ev.stopPropagation();
      mark(); l.visible = !l.visible; commit('vis');
      E.draw(); updateLayerList();
    };
    row.append(ic, nm, vis);
    row.onclick = () => {
      S.sel = l.id;
      if (l.type === 'text') E.setTool('text');
      E.emit('sel', l);
      E.draw();
      updateLayerList();
    };
    box.append(row);
  }
}

/* ── 저장 모달 ────────────────────────────────────────── */
function bindSaveModal() {
  $('btnCloseSave').onclick = closeSave;
  $('saveModal').addEventListener('click', e => { if (e.target.id === 'saveModal') closeSave(); });
  document.querySelectorAll('#formatChips .chip').forEach(c => {
    c.onclick = () => {
      document.querySelectorAll('#formatChips .chip').forEach(x => x.classList.toggle('is-on', x === c));
      S.export.fmt = c.dataset.fmt;
      $('qualityField').hidden = S.export.fmt === 'png';
      updateExportInfo();
    };
  });
  $('quality').oninput = e => {
    S.export.quality = Number(e.target.value);
    $('qualityVal').textContent = e.target.value + '%';
    updateExportInfo();
  };
  $('exportSize').onchange = e => { S.export.maxSide = Number(e.target.value); updateExportInfo(); };
  $('exportName').oninput = e => { S.export.name = e.target.value; };
  $('btnDownload').onclick = async () => {
    const r = await E.downloadImage();
    if (r) closeSave();
  };
  $('btnShare').onclick = async () => {
    const ok = await E.shareImage();
    if (ok) closeSave();
  };
  if (!navigator.canShare) $('btnShare').style.display = 'none';
}

function openSave() {
  if (!R.hasImage()) { E.toast('먼저 사진을 불러오세요'); return; }
  const slot = R.currentSlot();
  if (!S.export.name || S.export.name === 'photo-editor') {
    S.export.name = (slot && slot.name ? slot.name : 'photo-editor').replace(/[\\/:*?"<>|]+/g, '') || 'photo-editor';
  }
  $('exportName').value = S.export.name;
  $('qualityField').hidden = S.export.fmt === 'png';
  document.querySelectorAll('#formatChips .chip').forEach(c => c.classList.toggle('is-on', c.dataset.fmt === S.export.fmt));
  updateExportInfo();
  $('saveModal').classList.add('is-on');
  $('saveModal').setAttribute('aria-hidden', 'false');
}
function closeSave() {
  $('saveModal').classList.remove('is-on');
  $('saveModal').setAttribute('aria-hidden', 'true');
}

function updateExportInfo() {
  const { w, h } = R.outputSize();
  const maxSide = Number(S.export.maxSide) || 0;
  const s = maxSide ? Math.min(1, maxSide / Math.max(w, h)) : 1;
  const ow = Math.max(1, Math.round(w * s)), oh = Math.max(1, Math.round(h * s));
  const fmt = S.export.fmt.toUpperCase();
  const ext = S.export.fmt === 'jpeg' ? 'JPG' : S.export.fmt.toUpperCase();
  $('exportInfo').innerHTML =
    `출력 <b>${ow} × ${oh}px</b> · ${ext}${S.export.fmt === 'png' ? ' (무손실)' : ` · 품질 ${S.export.quality}%`}<br>` +
    `원본 ${R.baseSize().w}×${R.baseSize().h} · 레이어 ${S.layers.length}개`;
}

/* ── 드래그앤드롭 ─────────────────────────────────────── */
function bindDnd() {
  const wrap = $('canvasWrap');
  let depth = 0;
  ['dragenter', 'dragover'].forEach(ev => wrap.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragenter') depth++;
    wrap.classList.add('dragging');
  }));
  wrap.addEventListener('dragleave', e => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (!depth) wrap.classList.remove('dragging');
  });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    depth = 0;
    wrap.classList.remove('dragging');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) E.handleFiles(files);
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
}

/* ── 패널 접기 (모바일) ───────────────────────────────── */
function bindPanelCollapse() {
  const panel = $('panel');
  $('panelCollapse').onclick = () => {
    panel.classList.toggle('collapsed');
    setTimeout(() => E.resizeCanvas(), 220);
  };
  // 모바일에서 도구를 고르면 패널을 펼친다
  E.on('tool', () => {
    panel.classList.remove('collapsed');
    setTimeout(() => E.resizeCanvas(), 40);
  });
  E.on('sel', () => setTimeout(() => E.resizeCanvas(), 60));
}
