/* ============================================================
   link.js — 인스타 · 쓰레드 링크에서 사진 불러오기
   (집 PC 백수톡 스튜디오 http://localhost:8770 연동)
   ============================================================ */

import * as E from './editor.js';

const DEFAULT_BASE = 'http://localhost:8770';
const STORE_KEY = 'pe.studio.base';
const REQ_TIMEOUT = 12000;

const $ = id => document.getElementById(id);

let base = DEFAULT_BASE;
try { base = localStorage.getItem(STORE_KEY) || DEFAULT_BASE; } catch (e) { /* 사생활 모드 */ }
let state = 'unknown';     // 'ok' | 'off' | 'unknown'
let results = [];          // {src, kind, name, w, h}
let picked = new Set();

/* ── 초기화 ───────────────────────────────────────────── */
export function initLinkTools() {
  $('btnLink').onclick = open;
  $('btnLink2').onclick = open;
  $('btnCloseLink').onclick = close;
  $('linkModal').addEventListener('click', e => { if (e.target.id === 'linkModal') close(); });
  $('btnLinkRecheck').onclick = () => check(true);
  $('btnLinkFetch').onclick = doFetch;
  $('btnLinkFile').onclick = () => { close(); $('fileInput').click(); };
  $('btnLinkAddAll').onclick = addPicked;
  $('linkUrl').addEventListener('keydown', e => { if (e.key === 'Enter') doFetch(); });
  $('linkBase').value = base;
  $('linkBase').addEventListener('change', () => {
    const v = $('linkBase').value.trim().replace(/\/+$/, '');
    base = v || DEFAULT_BASE;
    try { localStorage.setItem(STORE_KEY, base); } catch (e) { /* noop */ }
    check(true);
  });
  if (navigator.onLine === false) setStatus('off');
}

function open() {
  $('linkModal').classList.add('is-on');
  $('linkModal').setAttribute('aria-hidden', 'false');
  $('linkUrl').value = '';
  clearResults();
  check(false);
  setTimeout(() => $('linkUrl').focus(), 120);
}
function close() {
  $('linkModal').classList.remove('is-on');
  $('linkModal').setAttribute('aria-hidden', 'true');
}

/* ── 스튜디오 연결 확인 ───────────────────────────────── */
function setStatus(kind, text) {
  state = kind;
  const box = $('linkStatus');
  box.dataset.state = kind;
  $('linkStatusText').textContent = text;
  $('btnLinkFetch').disabled = false;
  if (kind === 'ok') {
    $('linkNote').textContent = '스튜디오가 연결됐습니다. 인스타그램·쓰레드 게시물 링크를 붙여 넣으면 원본 사진을 가져옵니다.';
  } else if (kind === 'off') {
    $('linkNote').textContent = '집 PC에서 백수톡 스튜디오를 실행하면 링크에서 원본 사진을 바로 불러올 수 있습니다. 지금은 파일에서 사진을 열어 주세요.';
  } else {
    $('linkNote').textContent = '스튜디오 연결을 확인하는 중입니다…';
  }
}

async function check(loud) {
  setStatus('unknown', '스튜디오 확인 중…');
  if (loud) setStatus('unknown', '스튜디오 확인 중…');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch(`${base}/api/health`, { signal: ctl.signal, cache: 'no-store', mode: 'cors' });
    // 응답이 오면 서버는 살아 있다 (health 엔드포인트가 없어 404여도 연결은 된 것)
    setStatus('ok', `스튜디오 연결됨 · ${base.replace(/^https?:\/\//, '')}`);
    if (loud) E.toast('백수톡 스튜디오에 연결됐습니다');
    return true;
  } catch (err) {
    setStatus('off', '스튜디오 연결 안 됨');
    if (loud) E.toast('스튜디오를 찾을 수 없습니다 (집 PC 실행 여부 확인)');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* ── 추출 요청 ────────────────────────────────────────── */
async function doFetch() {
  const url = $('linkUrl').value.trim();
  if (!url) { E.toast('게시물 링크를 붙여 넣어 주세요'); $('linkUrl').focus(); return; }
  if (!/^https?:\/\//i.test(url)) { E.toast('http로 시작하는 링크를 넣어 주세요'); return; }

  $('btnLinkFetch').disabled = true;
  clearResults();
  const box = $('linkResults');
  box.innerHTML = '<div class="link-empty"><span class="spinner"></span> 링크에서 사진을 찾는 중…</div>';

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQ_TIMEOUT);
  try {
    const res = await fetch(`${base}/api/extract-media`, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    const data = await res.json();
    const items = normalize(data);
    if (!items.length) {
      box.innerHTML = '<div class="link-empty">이 링크에서 사진을 찾지 못했습니다. 다른 게시물 링크로 시도해 보세요.</div>';
      setStatus('ok', `스튜디오 연결됨 · ${base.replace(/^https?:\/\//, '')}`);
      return;
    }
    results = items;
    picked = new Set(items.map((_, i) => i));
    setStatus('ok', `스튜디오 연결됨 · 사진 ${items.length}장 발견`);
    renderResults();
    $('btnLinkAddAll').hidden = false;
  } catch (err) {
    const msg = err && err.name === 'AbortError'
      ? '시간이 초과됐습니다. 스튜디오가 실행 중인지 확인해 주세요.'
      : '스튜디오에 요청을 보낼 수 없습니다.';
    setStatus('off', '스튜디오 연결 안 됨');
    box.innerHTML = `<div class="link-empty">${msg}<br><span class="muted">집 PC에서 백수톡 스튜디오를 실행하면 링크에서 원본 사진을 바로 불러올 수 있습니다.</span></div>`;
    $('linkNote').textContent = '집 PC에서 백수톡 스튜디오를 실행하면 링크에서 원본 사진을 바로 불러올 수 있습니다. 지금은 파일에서 사진을 열어 주세요.';
  } finally {
    clearTimeout(timer);
    $('btnLinkFetch').disabled = false;
  }
}

/* 서버 응답을 [{src, name}] 로 정규화 — 여러 형태 허용 */
function normalize(data) {
  if (!data) return [];
  let arr = [];
  if (Array.isArray(data)) arr = data;
  else if (Array.isArray(data.images)) arr = data.images;
  else if (Array.isArray(data.items)) arr = data.items;
  else if (Array.isArray(data.media)) arr = data.media;
  else if (data.image || data.dataUrl || data.url) arr = [data];

  const out = [];
  for (const it of arr) {
    let src = null, name = '', w = 0, h = 0;
    if (typeof it === 'string') src = it;
    else if (it && typeof it === 'object') {
      src = it.dataUrl || it.dataURL || it.url || it.src || it.base64 || null;
      name = it.name || it.caption || it.title || '';
      w = it.width || 0; h = it.height || 0;
      if (src && !/^(data:|https?:|blob:)/i.test(src)) src = 'data:image/jpeg;base64,' + src;
    }
    if (src) out.push({ src, name: name || `사진 ${out.length + 1}`, w, h });
  }
  return out;
}

function renderResults() {
  const box = $('linkResults');
  box.innerHTML = '';
  results.forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'link-card' + (picked.has(i) ? ' is-on' : '');
    const img = new Image();
    img.src = it.src; img.alt = it.name; img.loading = 'lazy';
    const meta = document.createElement('div');
    meta.className = 'link-meta';
    meta.textContent = it.name.slice(0, 40);
    const btn = document.createElement('button');
    btn.className = 'link-add';
    btn.textContent = '이 사진';
    btn.onclick = ev => { ev.stopPropagation(); loadItems([it]); };
    card.append(img, meta, btn);
    card.onclick = () => {
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      card.classList.toggle('is-on', picked.has(i));
      updateAddAllLabel();
    };
    box.append(card);
  });
  updateAddAllLabel();
}

function updateAddAllLabel() {
  const b = $('btnLinkAddAll');
  if (!b) return;
  b.hidden = !results.length;
  b.textContent = picked.size > 1 ? `선택한 ${picked.size}장 불러오기` : '모두 불러오기';
}

function clearResults() {
  results = []; picked = new Set();
  $('linkResults').innerHTML = '';
  $('btnLinkAddAll').hidden = true;
}

/* ── 실제 로딩 ────────────────────────────────────────── */
async function addPicked() {
  const list = results.filter((_, i) => picked.has(i));
  if (!list.length) return E.toast('불러올 사진을 선택하세요');
  await loadItems(list);
}

async function loadItems(list) {
  $('btnLinkAddAll').disabled = true;
  const btn = $('btnLinkFetch');
  btn.disabled = true;
  let ok = 0, fail = 0;
  for (const it of list) {
    E.showBusy(true, '사진 가져오는 중…');
    try {
      const blob = await toBlob(it.src);
      if (!blob) throw new Error('blob');
      await E.addImageFromBlob(blob, it.name || '링크 사진');
      ok++;
    } catch (err) {
      console.warn('link load fail', err);
      fail++;
    } finally {
      E.showBusy(false);
    }
  }
  $('btnLinkAddAll').disabled = false;
  btn.disabled = false;
  if (ok) {
    E.toast(fail ? `${ok}장 불러옴 · ${fail}장 실패` : `사진 ${ok}장을 불러왔습니다`);
    close();
  } else {
    E.toast('사진을 가져오지 못했습니다 — 주소를 확인해 주세요');
  }
}

async function toBlob(src) {
  try {
    const r = await fetch(src, { cache: 'no-store' });
    if (r.ok) {
      const b = await r.blob();
      if (b.type.startsWith('image/')) return b;
    }
  } catch (e) { /* 아래 대체 경로 */ }

  // 이미지로 직접 디코딩 (CORS 허용 시 캔버스 오염 없이 사용 가능)
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob')), 'image/png');
      } catch (err) { reject(err); }
    };
    img.onerror = () => reject(new Error('image load'));
    img.src = src;
  });
}
