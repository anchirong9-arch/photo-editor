/* ============================================================
   state.js — 편집 상태 · 레이어 모델 · 히스토리
   ============================================================ */

export const FONTS = [
  { id: 'Black Han Sans',     label: '블랙한산스 · 굵은 제목', weights: [400] },
  { id: 'Noto Sans KR',       label: '노토산스 · 기본 고딕',   weights: [400, 700, 900] },
  { id: 'Jua',                label: '주아 · 동글동글',        weights: [400] },
  { id: 'Do Hyeon',           label: '도현 · 큼직한 고딕',     weights: [400] },
  { id: 'Nanum Pen Script',   label: '나눔손글씨 펜',          weights: [400] },
  { id: 'Gowun Batang',       label: '고운바탕 · 명조',        weights: [400, 700] },
  { id: 'Gowun Dodum',        label: '고운돋움 · 부드러운 고딕', weights: [400] },
  { id: 'Nanum Myeongjo',     label: '나눔명조 · 클래식',      weights: [400, 800] },
];

export const PRESETS = [
  { id:'original', label:'원본',  adj:{brightness:0, contrast:0, saturation:0, temperature:0, vignette:0, blur:0} },
  { id:'vivid',    label:'선명',  adj:{brightness:2, contrast:14, saturation:12, temperature:2, vignette:0, blur:0} },
  { id:'film',     label:'필름',  adj:{brightness:3, contrast:8, saturation:-14, temperature:14, vignette:18, blur:0} },
  { id:'mono',     label:'흑백',  adj:{brightness:3, contrast:12, saturation:-100, temperature:0, vignette:6, blur:0} },
  { id:'warm',     label:'따뜻',  adj:{brightness:4, contrast:4, saturation:8, temperature:28, vignette:0, blur:0} },
  { id:'cool',     label:'시원',  adj:{brightness:2, contrast:6, saturation:-4, temperature:-28, vignette:0, blur:0} },
  { id:'retro',    label:'레트로',adj:{brightness:-2, contrast:6, saturation:-26, temperature:32, vignette:26, blur:0} },
  { id:'fade',     label:'페일',  adj:{brightness:8, contrast:-16, saturation:-8, temperature:6, vignette:10, blur:0} },
  { id:'clarity',  label:'생생',  adj:{brightness:0, contrast:22, saturation:6, temperature:0, vignette:0, blur:0} },
];

export const ADJ_DEFS = [
  { key:'brightness',  label:'밝기',   min:-100, max:100, step:1 },
  { key:'contrast',    label:'대비',   min:-100, max:100, step:1 },
  { key:'saturation',  label:'채도',   min:-100, max:100, step:1 },
  { key:'temperature', label:'색온도', min:-100, max:100, step:1 },
  { key:'vignette',    label:'비네팅', min:0,    max:100, step:1 },
  { key:'blur',        label:'흐림',   min:0,    max:100, step:1 },
];

export const S = {
  slots: [],          // { id, name, dataURL, bmp, w, h }
  slotId: null,
  view: { rot: 0, flipH: false, flipV: false },
  crop: null,         // {x,y,w,h} 0..1 (회전 적용 후 좌표계)
  adj: { brightness:0, contrast:0, saturation:0, temperature:0, vignette:0, blur:0 },
  preset: 'original',
  layers: [],
  sel: null,
  tool: 'photo',
  keepEdit: true,
  cropBackup: null,
  // 도구 기본값
  text: { font:'Black Han Sans', weight:400, size:0.09, maxW:0.9, align:'center', color:'#ffffff',
          strokeColor:'#000000', strokeWidth:0, shadowColor:'#000000', shadowAlpha:70, shadowBlur:18,
          shadowX:0, shadowY:6, bgOn:false, bgColor:'#000000', bgRadius:24, bgPad:40, bgAlpha:60,
          opacity:100, tracking:0, leading:120, italic:false },
  draw: { mode:'pen', color:'#ff4d6d', width:6, opacity:100 },
  shape: { kind:'rect', color:'#ffd166', width:6, fill:false, fillColor:'#ffd166', opacity:100 },
  mosaic: { mode:'pixel', block:18 },
  export: { fmt:'png', quality:92, maxSide:0, name:'photo-editor' },
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => 'L' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

/* ── 레이어 팩토리 ─────────────────────────────────────── */

export function newTextLayer(x = 0.5, y = 0.5, text = '텍스트를 입력하세요') {
  const t = S.text;
  return {
    id: uid(), type:'text', name: text.slice(0, 12) || '텍스트',
    x, y, rot: 0,
    text, font:t.font, weight:t.weight, italic:t.italic,
    size:t.size, maxW:t.maxW, color:t.color, opacity:t.opacity,
    align:t.align, leading:t.leading, tracking:t.tracking,
    stroke:{ color:t.strokeColor, width:t.strokeWidth },
    shadow:{ color:t.shadowColor, alpha:t.shadowAlpha, blur:t.shadowBlur, x:t.shadowX, y:t.shadowY },
    bg:{ on:t.bgOn, color:t.bgColor, radius:t.bgRadius, padX:t.bgPad, padY:t.bgPad*0.55, alpha:t.bgAlpha },
    visible:true,
  };
}

export function newStrokeLayer(mode, color, widthPct, opacity) {
  return {
    id: uid(), type:'stroke', name: mode==='marker' ? '형광펜' : '펜',
    mode, color, width: widthPct / 1000, opacity,
    points: [], visible: true,
  };
}

export function newShapeLayer(kind) {
  const s = S.shape;
  return {
    id: uid(), type:'shape', name: kind==='rect' ? '사각형' : kind==='ellipse' ? '원' : '화살표',
    shape: kind, x1:0, y1:0, x2:0, y2:0,
    color: s.color, width: s.width/1000, fill: s.fill, fillColor: s.fillColor, opacity: s.opacity,
    visible: true,
  };
}

export function newMosaicLayer(rect, mode, blockVal) {
  return {
    id: uid(), type:'mosaic', name: mode==='blur' ? '블러' : '모자이크',
    mode, x:rect.x, y:rect.y, w:rect.w, h:rect.h, block: blockVal/1000,
    visible: true,
  };
}

/* ── 히스토리 ──────────────────────────────────────────── */

const UNDO_LIMIT = 60;
let undoStack = [];
let redoStack = [];

function snapshot() {
  return JSON.stringify({
    view: S.view, crop: S.crop, adj: S.adj, preset: S.preset,
    layers: S.layers, sel: S.sel, slotId: S.slotId,
  });
}

function applySnapshot(str) {
  const d = JSON.parse(str);
  S.view = d.view; S.crop = d.crop; S.adj = d.adj; S.preset = d.preset;
  S.layers = d.layers; S.sel = d.sel; S.slotId = d.slotId;
}

let last = snapshot();

/** 현재 상태를 히스토리에 확정 기록 (변화가 있을 때만) */
export function commit(label = '') {
  const now = snapshot();
  if (now === last) return false;
  undoStack.push(last);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
  last = now;
  onHistory && onHistory();
  return true;
}

/** 변경 전 상태를 되돌릴 지점으로 잡아 둔다 */
export function mark() { last = snapshot(); }

export function undo() {
  if (!undoStack.length) return false;
  const cur = snapshot();
  redoStack.push(cur);
  const prev = undoStack.pop();
  applySnapshot(prev);
  last = prev;
  onHistory && onHistory();
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  const cur = snapshot();
  undoStack.push(cur);
  const next = redoStack.pop();
  applySnapshot(next);
  last = next;
  onHistory && onHistory();
  return true;
}

export function historyState() {
  return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}

export function resetHistory() {
  undoStack = []; redoStack = []; last = snapshot();
  onHistory && onHistory();
}

let onHistory = null;
export function setHistoryListener(fn) { onHistory = fn; }

/* ── 편의 ──────────────────────────────────────────────── */

export function selectedLayer() {
  return S.layers.find(l => l.id === S.sel) || null;
}

export function findLayer(id) {
  return S.layers.find(l => l.id === id) || null;
}

export function removeLayer(id) {
  const i = S.layers.findIndex(l => l.id === id);
  if (i >= 0) { S.layers.splice(i, 1); if (S.sel === id) S.sel = null; return true; }
  return false;
}

export function layerLabel(l) {
  if (l.type === 'text') return l.text.split('\n')[0].slice(0, 16) || '텍스트';
  return l.name;
}
