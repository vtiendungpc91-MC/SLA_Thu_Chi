// Thành phần giao diện dùng chung: toast, bottom sheet, thanh chọn kỳ, chia sẻ/tải file.
import { esc, getRange, customRange, todayISO, addDays, PERIOD_LABEL } from './utils.js';
import { state } from './store.js';

/** Trạng thái giao diện (không lưu vào DB). */
export const ui = {
  period: null, // Tổng quan + Giao dịch: { type: day|month, anchor }
  reportPeriod: null, // Báo cáo: { type: day|month|quarter|year|custom, anchor, from, to }
  txFilter: { type: 'all', q: '', categoryId: null, tag: null, accountId: null },
  reportType: 'expense',
  planTab: 'budget',
};

/** Các loại kỳ cho từng nơi: "main" = Tổng quan/Giao dịch, "report" = Báo cáo. */
export const PERIOD_TYPES = { main: ['day', 'month'], report: ['day', 'month', 'quarter', 'year', 'custom'] };

export function periodState(key = 'main') {
  if (key === 'report') {
    if (!ui.reportPeriod) {
      const t = todayISO();
      ui.reportPeriod = { type: 'month', anchor: t, from: addDays(t, -29), to: t };
    }
    return ui.reportPeriod;
  }
  if (!ui.period) ui.period = { type: state.settings.period === 'day' ? 'day' : 'month', anchor: todayISO() };
  return ui.period;
}

function rangeOf(p) {
  return p.type === 'custom' ? customRange(p.from, p.to) : getRange(p.type, p.anchor, state.settings.weekStart);
}
export const currentRange = () => rangeOf(periodState('main'));
export const reportRange = () => rangeOf(periodState('report'));

let toastTimer;
export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Mở bottom sheet. onMount(sheetEl, close) để gắn sự kiện cho form. */
export function openSheet({ title, body, onMount, onClose, wide = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <button type="button" class="icon-btn" data-close aria-label="Đóng">✕</button>
        <h3>${esc(title)}</h3><span class="sp"></span>
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!document.querySelector('.sheet-wrap')) document.body.classList.remove('noscroll');
    }, 220);
    onClose && onClose();
  };
  wrap.querySelector('.sheet-bg').addEventListener('click', close);
  wrap.querySelector('[data-close]').addEventListener('click', close);
  const sheet = wrap.querySelector('.sheet');
  onMount && onMount(sheet, close);
  return close;
}

export function periodBar(key = 'main') {
  const p = periodState(key);
  const r = rangeOf(p);
  const k = `data-p="${key}"`;
  const nav = p.type === 'custom'
    ? `<div class="range-pick">
        <label class="field"><span>Từ ngày</span><input type="date" ${k} data-range="from" value="${esc(p.from)}"></label>
        <label class="field"><span>Đến ngày</span><input type="date" ${k} data-range="to" value="${esc(p.to)}"></label>
      </div><p class="muted small center">${esc(r.label)} · ${r.days} ngày</p>`
    : `<div class="period-nav">
        <button type="button" class="icon-btn" data-act="period-shift" ${k} data-v="-1" aria-label="Kỳ trước">‹</button>
        <label class="period-label" title="Chọn ngày">${esc(r.label)} <span class="cal">📅</span>
          <input type="date" ${k} data-period-date value="${esc(p.anchor)}" aria-label="Chọn ngày"></label>
        <button type="button" class="icon-btn" data-act="period-shift" ${k} data-v="1" aria-label="Kỳ sau">›</button>
      </div>
      ${todayISO() < r.start || todayISO() > r.end ? `<button type="button" class="link center" data-act="period-today" ${k}>↺ Về ${p.type === 'day' ? 'hôm nay' : 'kỳ hiện tại'}</button>` : ''}`;
  return `
  <div class="period">
    <div class="seg${PERIOD_TYPES[key].length > 3 ? ' small' : ''}">${PERIOD_TYPES[key].map((t) =>
      `<button type="button" data-act="period-type" ${k} data-v="${t}" class="${p.type === t ? 'on' : ''}">${PERIOD_LABEL[t]}</button>`).join('')}
    </div>
    ${nav}
  </div>`;
}

export const progress = (ratio, cls = '') => {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const tone = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
  return `<div class="bar ${cls}"><i class="${tone}" style="width:${pct.toFixed(1)}%"></i></div>`;
};

export const empty = (icon, text) => `<div class="empty"><div class="empty-i">${icon}</div><p>${text}</p></div>`;

/** Chia sẻ file (iOS/Android share sheet), nếu không được thì tải về. */
export async function shareOrDownload(filename, content, mime) {
  const file = new File([content], filename, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  download(filename, file);
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Mở file lịch .ics: trên iOS Safari sẽ hiện "Thêm vào Lịch", Android mở bằng app Lịch. */
export function openCalendarFile(filename, ics) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    // iOS: mở trực tiếp data URL để hệ thống hỏi thêm vào Lịch.
    const reader = new FileReader();
    reader.onload = () => { window.location.href = reader.result; };
    reader.readAsDataURL(blob);
    return;
  }
  shareOrDownload(filename, ics, 'text/calendar');
}

/** Nén ảnh hóa đơn trước khi lưu để tiết kiệm bộ nhớ. */
export function compressImage(file, max = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Không nén được ảnh'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
    img.src = url;
  });
}
