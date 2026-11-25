/* ============================================================
   boot.js — 시작
   ============================================================ */

import * as E from './editor.js';
import { initUI } from './ui.js';
import * as State from './state.js';
import * as Render from './render.js';

function boot() {
  initUI();
  E.bindKeyboard();
  E.resizeCanvas();

  const wrap = document.getElementById('canvasWrap');
  if (wrap && 'ResizeObserver' in window) {
    let t = 0;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => E.resizeCanvas(), 60);
    }).observe(wrap);
  }

  if (document.fonts) {
    document.fonts.load('700 13px "Noto Sans KR"', '가나다').catch(() => {});
    document.fonts.load('400 13px "Noto Sans KR"', '가나다').catch(() => {});
  }

  // 서비스워커 없이도 오프라인 캐시는 브라우저에 맡긴다
  window.__PE__ = { S: State.S, E, R: Render, State };
  window.__PE_READY__ = true;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
