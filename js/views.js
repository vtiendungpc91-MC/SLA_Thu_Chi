// Các màn hình và form của app.
import * as S from './store.js';
import { state } from './store.js';
import {
  ui, currentRange, toast, openSheet, periodBar, progress, empty, shareOrDownload, download, openCalendarFile, compressImage,
} from './ui.js';
import {
  esc, fmt, fmtNum, fmtCur, fmtSigned, fmtShort, fmtDate, fmtDayHeader, fmtDue, parseAmount, todayISO, addDays, diffDays,
  getRange, shiftAnchor, elapsedDays, parseISO, nextDate, FREQ_LABEL, PERIOD_LABEL, splitTags, debounce, addMonths,
} from './utils.js';
import { donut, bars } from './charts.js';
import { voiceSupported, listen, parseSpeech } from './voice.js';
import { buildAllDayICS, buildDailyICS } from './ics.js';

export const actions = {};
const $ = (root, sel) => root.querySelector(sel);

// ================= Thành phần nhỏ =================
const UNKNOWN_CAT = { name: 'Không rõ', icon: '❔', color: '#888' };
const catIcon = (c) => `<span class="ci" style="--c:${esc((c || UNKNOWN_CAT).color)}">${esc((c || UNKNOWN_CAT).icon)}</span>`;
const accName = (id) => S.accById(id)?.name || '—';
const TYPE_LABEL = { expense: 'Chi', income: 'Thu', transfer: 'Chuyển khoản' };
const KIND_LABEL = { cash: 'Tiền mặt', bank: 'Ngân hàng', ewallet: 'Ví điện tử', credit: 'Thẻ tín dụng', other: 'Khác' };
const PAY_METHODS = ['Chuyển khoản qua app ngân hàng', 'Trích nợ tự động', 'Nộp tiền mặt tại quầy', 'Ví điện tử (MoMo, ZaloPay...)', 'Khác'];
const BANKS = ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank',
  'HDBank', 'VIB', 'SHB', 'SeABank', 'OCB', 'MSB', 'LPBank', 'Eximbank', 'Nam A Bank', 'Bac A Bank', 'ABBANK', 'Shinhan Bank',
  'HSBC', 'Standard Chartered', 'UOB', 'Cake by VPBank', 'Timo', 'FE Credit', 'Home Credit', 'HD Saison', 'Mcredit', 'Mirae Asset'];

function txRow(t) {
  const parts = S.txParts(t);
  const isTr = t.type === 'transfer';
  const cat = isTr ? null : S.catById(parts[0].categoryId);
  const icon = isTr ? `<span class="ci" style="--c:#6f6e77">⇄</span>` : catIcon(cat);
  const catText = t.gop ? (t.gop.dir === 'out' ? `Góp cho ${t.gop.peerName}` : `Nhận góp từ ${t.gop.peerName}`)
    : parts.length > 1 ? `${parts.length} danh mục` : (cat || UNKNOWN_CAT).name;
  const title = t.note || (isTr ? 'Chuyển tiền' : catText);
  const sub = [isTr ? `${accName(t.accountId)} → ${accName(t.toAccountId)}` : (t.note && t.note !== catText ? catText + ' · ' : '') + accName(t.accountId)];
  if (t.tags && t.tags.length) sub.push(t.tags.map((g) => '#' + g).join(' '));
  const flags = (t.photoIds && t.photoIds.length ? '📎' : '') + (t.recurringId ? '🔁' : '') + (t.debtId ? '🏦' : '');
  const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
  const foreign = t.currency && t.currency !== 'VND' ? `<small>${esc(fmtCur(t.amount, t.currency))}</small>` : '';
  return `<button type="button" class="row tx" data-act="tx-edit" data-id="${t.id}">
    ${icon}
    <span class="grow"><b>${esc(title)}</b><small>${esc(sub.join(' · '))}</small></span>
    <span class="amt ${t.type}">${sign ? fmtSigned(sign * t.amountVnd) : fmt(t.amountVnd)}${foreign}<small>${flags}</small></span>
  </button>`;
}

const sortTx = (list) => list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));

function groupedTx(list) {
  const groups = new Map();
  for (const t of sortTx(list)) {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  }
  return [...groups.entries()].map(([d, items]) => {
    const net = items.reduce((s, t) => s + (t.type === 'income' ? t.amountVnd : t.type === 'expense' ? -t.amountVnd : 0), 0);
    return `<div class="day"><div class="day-h"><span>${fmtDayHeader(d)}</span><span class="${net >= 0 ? 'income' : 'expense'}">${fmtSigned(net)}</span></div>
      <div class="card list">${items.map(txRow).join('')}</div></div>`;
  }).join('');
}

const catOptions = (type, selected, extra = '') =>
  extra + S.catsOf(type).map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon + ' ' + c.name)}</option>`).join('');

function accOptions(selected) {
  const list = S.activeAccounts();
  const cur = S.accById(selected);
  if (cur && cur.archived) list.push(cur);
  return list.map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.icon + ' ' + a.name)}</option>`).join('');
}

const field = (label, inner, extra = '') => `<label class="field" ${extra}><span>${label}</span>${inner}</label>`;
const amountField = (id, value, label = 'Số tiền') =>
  field(label, `<input id="${id}" class="money" inputmode="decimal" autocomplete="off" placeholder="vd: 50k, 1tr2" value="${value ? fmtNum(value) : ''}"><em class="hint" data-hint-for="${id}"></em>`);

/** Gắn gợi ý đọc số tiền dưới ô nhập. */
function bindMoney(root, id) {
  const inp = $(root, '#' + id), hint = $(root, `[data-hint-for="${id}"]`);
  const upd = () => {
    const v = readMoney(inp.value);
    hint.textContent = inp.value && Number.isFinite(v) ? '= ' + fmt(v) : inp.value ? 'Chưa hiểu số tiền' : '';
  };
  inp.addEventListener('input', upd);
  upd();
  return inp;
}
/** Hỗ trợ cả số âm (vd: dư nợ thẻ tín dụng ban đầu). */
const readMoney = (s) => {
  const str = String(s || '').trim();
  const neg = str.startsWith('-');
  const v = parseAmount(neg ? str.slice(1) : str);
  return neg ? -v : v;
};

// ================= Người dùng =================
const profileChip = () => {
  const p = S.currentProfile();
  return `<button type="button" class="profile-chip" data-act="profiles" style="--c:${esc(p.color)}" title="Đổi người dùng">
    <span>${esc(p.icon)}</span>${esc(p.name)} <i>▾</i></button>`;
};
const summaryBtn = () => `<button type="button" class="btn ghost small" data-act="summary" data-v="current">📊 Tóm tắt</button>`;

async function switchTo(id) {
  if (id === S.currentProfile().id) return;
  ui.period = null;
  ui.txFilter = { type: 'all', q: '', categoryId: null, tag: null, accountId: null };
  await S.switchProfile(id);
  await S.processRecurring();
  toast(`Đã chuyển sang sổ của ${S.currentProfile().name}`);
}

actions['profile-switch'] = (el) => switchTo(el.dataset.id);

actions.profiles = () => {
  const cur = S.currentProfile().id;
  openSheet({
    title: 'Chọn người dùng',
    body: `<div class="list">${S.getProfiles().map((p) => `
      <div class="row profile-row ${p.id === cur ? 'on' : ''}">
        <button type="button" class="grow-btn" data-switch="${esc(p.id)}"><span class="ci" style="--c:${esc(p.color)}">${esc(p.icon)}</span>
          <span class="grow"><b>${esc(p.name)}</b><small>${p.id === cur ? 'Đang dùng' : 'Bấm để chuyển sang'}</small></span>${p.id === cur ? '<span class="income">✓</span>' : ''}</button>
        <button type="button" class="icon-btn" data-edit="${esc(p.id)}" aria-label="Sửa">✎</button>
      </div>`).join('')}</div>
      <button type="button" class="btn primary block" data-add>+ Thêm người dùng</button>
      <p class="muted small">Ví dụ: sổ của bạn, sổ của vợ/chồng, sổ của con… Dữ liệu mỗi người tách riêng.</p>`,
    onMount(sh, close) {
      sh.addEventListener('click', async (e) => {
        const sw = e.target.closest('[data-switch]');
        const ed = e.target.closest('[data-edit]');
        if (sw) { close(); await switchTo(sw.dataset.switch); }
        else if (ed) { close(); profileForm(S.getProfiles().find((p) => p.id === ed.dataset.edit)); }
        else if (e.target.closest('[data-add]')) { close(); profileForm(null); }
      });
    },
  });
};

const PROFILE_ICONS = ['🧑', '👨', '👩', '👦', '👧', '👴', '👵', '👪', '💼', '🏠'];

function profileForm(p) {
  const f = p ? { ...p } : { name: '', icon: S.getProfiles().length === 1 ? '👩' : '🧑', color: null };
  if (!f.color) f.color = S.PROFILE_COLORS[S.getProfiles().length % S.PROFILE_COLORS.length];
  const isOnly = S.getProfiles().length <= 1;
  openSheet({
    title: p ? 'Sửa người dùng' : 'Thêm người dùng',
    body: `<form class="form">
      ${field('Tên hiển thị', `<input id="pf-name" required maxlength="20" value="${esc(f.name)}" placeholder="vd: Dũng, Vợ, Con gái">`)}
      <div class="field"><span>Biểu tượng</span><div class="chips" id="pf-icons">${PROFILE_ICONS.map((i) => `<button type="button" class="chip icon-chip ${i === f.icon ? 'on' : ''}" data-icon="${i}">${i}</button>`).join('')}</div></div>
      <div class="field"><span>Màu</span><div class="colors">${S.PROFILE_COLORS.map((col) => `<button type="button" class="color ${col === f.color ? 'on' : ''}" data-color="${col}" style="--c:${col}" aria-label="${col}"></button>`).join('')}</div></div>
      ${p ? '' : '<p class="muted small">Sổ mới có sẵn danh mục và 2 ví mặc định. Cài đặt khác lấy giá trị mặc định.</p>'}
      <div class="actions">${p && !isOnly ? '<button type="button" class="btn danger" data-del>Xóa người dùng</button>' : ''}<button class="btn primary">${p ? 'Lưu' : 'Thêm & chuyển sang'}</button></div>
    </form>`,
    onMount(sh, close) {
      $(sh, '#pf-icons').addEventListener('click', (e) => {
        const b = e.target.closest('[data-icon]');
        if (!b) return;
        f.icon = b.dataset.icon;
        sh.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x === b));
      });
      $(sh, '.colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        f.color = b.dataset.color;
        sh.querySelectorAll('.color').forEach((x) => x.classList.toggle('on', x === b));
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $(sh, '#pf-name').value.trim();
        if (!name) return toast('Nhập tên');
        if (S.getProfiles().some((x) => x.id !== f.id && x.name.toLowerCase() === name.toLowerCase())) return toast('Tên này đã có');
        const saved = S.saveProfile({ ...f, name });
        close();
        if (p) { refresh(); toast('Đã lưu'); } else await switchTo(saved.id);
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (!confirm(`Xóa người dùng "${p.name}" và TOÀN BỘ dữ liệu thu chi của người này? Không thể hoàn tác. Nên sao lưu trước!`)) return;
        if (prompt('Gõ XOA để xác nhận') !== 'XOA') return;
        ui.period = null;
        await S.deleteProfile(p.id);
        close(); refresh(); toast('Đã xóa người dùng');
      });
    },
  });
}

function sectionTitle(text, actionHtml = '') {
  return `<div class="sec-h"><h2>${text}</h2>${actionHtml}</div>`;
}

// ================= Tổng quan =================
function homeView() {
  const r = currentRange();
  const t = S.totals(r);
  const alerts = S.getAlerts();
  const today = todayISO();
  const recent = sortTx([...state.transactions]).slice(0, 6);
  const top = S.byCategory(r, 'expense').slice(0, 5);
  const topMax = top[0]?.amount || 1;
  const hour = new Date().getHours();
  const loggedToday = state.transactions.some((x) => x.date === today);
  const showMonthSum = Number(today.slice(8)) <= 3;

  return `
  <header class="top"><div>${profileChip()}<h1>Sổ Thu Chi</h1><small>${fmtDayHeader(today)}</small></div>
    ${summaryBtn()}</header>
  ${periodBar()}
  <section class="card hero">
    <div class="hero-row">
      <div><small>Thu</small><b class="income">${fmt(t.income)}</b></div>
      <div><small>Chi</small><b class="expense">${fmt(t.expense)}</b></div>
    </div>
    <div class="hero-net"><small>Chênh lệch kỳ này</small><strong class="${t.net >= 0 ? 'income' : 'expense'}">${fmtSigned(t.net)}</strong></div>
    <div class="hero-bal"><span>Tổng số dư các ví</span><b>${fmt(S.totalBalance())}</b></div>
    ${otherProfiles().length ? `<button type="button" class="btn ghost block gop-btn" data-act="gop">🤝 Góp tiền cho ${esc(otherProfiles().map((p) => p.name).join(' / '))}</button>` : ''}
  </section>

  ${!loggedToday && hour >= 18 ? `<button type="button" class="banner" data-act="add">✏️ Hôm nay bạn chưa ghi khoản nào. Ghi ngay?</button>` : ''}
  ${showMonthSum ? `<button type="button" class="banner soft" data-act="summary" data-v="prev-month">📊 Xem tóm tắt tháng trước</button>` : ''}

  ${alerts.length ? `${sectionTitle('Cần chú ý')}<div class="card list">${alerts.map(alertRow).join('')}</div>` : ''}

  ${sectionTitle('Ví & tài khoản', `<button type="button" class="link" data-act="accounts">Quản lý</button>`)}
  <div class="card list">${S.activeAccounts().map((a) => {
    const b = S.accountBalance(a);
    return `<div class="row"><span class="ci" style="--c:#3e63dd">${esc(a.icon)}</span><span class="grow"><b>${esc(a.name)}</b><small>${KIND_LABEL[a.kind] || ''}</small></span><span class="amt ${b < 0 ? 'expense' : ''}">${fmt(b)}</span></div>`;
  }).join('')}</div>

  ${top.length ? `${sectionTitle('Chi nhiều nhất', `<a class="link" href="#/reports">Báo cáo</a>`)}
  <div class="card list">${top.map((x) => `<button type="button" class="row" data-act="report-cat" data-id="${x.cat.id}">${catIcon(x.cat)}
    <span class="grow"><b>${esc(x.cat.name)}</b><span class="bar thin"><i style="width:${(x.amount / topMax) * 100}%;background:${esc(x.cat.color)}"></i></span></span>
    <span class="amt">${fmt(x.amount)}</span></button>`).join('')}</div>` : ''}

  ${sectionTitle('Gần đây', `<a class="link" href="#/tx">Tất cả</a>`)}
  ${recent.length ? `<div class="card list">${recent.map(txRow).join('')}</div>` : empty('🪙', 'Chưa có giao dịch nào. Bấm nút <b>+</b> để ghi khoản đầu tiên.')}
  ${fab()}`;
}

function alertRow(a) {
  const map = {
    debt: ['🏦', 'debt-open', a.days < 0 ? 'over' : 'warn'],
    pending: ['⏳', 'pending-open', 'warn'],
    recurring: ['🔁', 'rec-open', ''],
    budget: ['⚠️', 'budget-goto', a.level >= 100 ? 'over' : 'warn'],
  }[a.kind];
  const sub = a.kind === 'budget'
    ? `Đã dùng ${Math.round(a.ratio * 100)}% ngân sách (${fmt(a.amount)} / ${fmt(a.limit)})`
    : a.kind === 'pending' ? `Đến kỳ ${fmtDate(a.date)} — bấm để xác nhận số tiền` : `${fmtDue(a.days)} · ${fmtDate(a.date)}`;
  return `<button type="button" class="row alert ${map[2]}" data-act="${map[1]}" data-id="${a.id}">
    <span class="ci">${map[0]}</span><span class="grow"><b>${esc(a.title)}</b><small>${esc(sub)}</small></span>
    ${a.kind !== 'budget' ? `<span class="amt">${fmt(a.amount)}</span>` : ''}</button>`;
}

const fab = () => `<button type="button" class="fab" data-act="add" aria-label="Thêm giao dịch">+</button>`;

// ================= Giao dịch =================
function filteredTx() {
  const f = ui.txFilter;
  const r = currentRange();
  const q = f.q.trim().toLowerCase();
  return S.txIn(r).filter((t) => {
    if (f.type !== 'all' && t.type !== f.type) return false;
    if (f.categoryId && !S.txParts(t).some((p) => p.categoryId === f.categoryId)) return false;
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (q) {
      const hay = [t.note, ...(t.tags || []), ...S.txParts(t).map((p) => S.catById(p.categoryId)?.name), accName(t.accountId), String(t.amountVnd)]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function txListHtml() {
  const list = filteredTx();
  let inc = 0, exp = 0;
  for (const t of list) { if (t.type === 'income') inc += t.amountVnd; else if (t.type === 'expense') exp += t.amountVnd; }
  return `<p class="muted center">${list.length} giao dịch · Thu <b class="income">${fmt(inc)}</b> · Chi <b class="expense">${fmt(exp)}</b></p>
    ${list.length ? groupedTx(list) : empty('🔍', 'Không có giao dịch phù hợp trong kỳ này.')}`;
}

function txView() {
  const f = ui.txFilter;
  const chips = [];
  if (f.categoryId) chips.push(['categoryId', (S.catById(f.categoryId) || UNKNOWN_CAT).name]);
  if (f.tag) chips.push(['tag', '#' + f.tag]);
  if (f.accountId) chips.push(['accountId', accName(f.accountId)]);
  const tags = S.allTags().slice(0, 12);
  return `
  <header class="top"><div>${profileChip()}<h1>Giao dịch</h1></div><button type="button" class="icon-btn" data-act="export-csv" title="Xuất CSV">⬇️</button></header>
  ${periodBar()}
  <div class="filters">
    <input id="tx-q" type="search" placeholder="Tìm ghi chú, danh mục, tag, số tiền…" value="${esc(f.q)}">
    <div class="seg small">${['all', 'expense', 'income', 'transfer'].map((t) =>
      `<button type="button" data-act="tx-type" data-v="${t}" class="${f.type === t ? 'on' : ''}">${t === 'all' ? 'Tất cả' : TYPE_LABEL[t]}</button>`).join('')}</div>
    <div class="chips">
      ${chips.map(([k, label]) => `<button type="button" class="chip on" data-act="tx-unfilter" data-v="${k}">${esc(label)} ✕</button>`).join('')}
      <select id="tx-acc" class="chip-select"><option value="">Mọi ví</option>${S.activeAccounts().map((a) => `<option value="${a.id}" ${f.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      ${tags.filter((g) => g !== f.tag).map((g) => `<button type="button" class="chip" data-act="tx-tag" data-v="${esc(g)}">#${esc(g)}</button>`).join('')}
    </div>
  </div>
  <div id="tx-list">${txListHtml()}</div>
  ${fab()}`;
}

function mountTx(root) {
  const q = $(root, '#tx-q');
  q.addEventListener('input', debounce(() => {
    ui.txFilter.q = q.value;
    $(root, '#tx-list').innerHTML = txListHtml();
  }, 150));
  $(root, '#tx-acc').addEventListener('change', (e) => { ui.txFilter.accountId = e.target.value || null; refresh(); });
}

actions['tx-type'] = (el) => { ui.txFilter.type = el.dataset.v; refresh(); };
actions['tx-tag'] = (el) => { ui.txFilter.tag = el.dataset.v; refresh(); };
actions['tx-unfilter'] = (el) => { ui.txFilter[el.dataset.v] = null; refresh(); };
actions['tx-edit'] = (el) => {
  const tx = state.transactions.find((t) => t.id === el.dataset.id);
  if (tx) (tx.gop ? gopDetail(tx) : openTxForm({ tx }));
};

// ================= Góp tiền giữa các người dùng =================
const otherProfiles = () => S.getProfiles().filter((p) => p.id !== S.currentProfile().id);

actions.gop = () => openGopForm();

function openGopForm() {
  const others = otherProfiles();
  if (!others.length) {
    toast('Cần thêm ít nhất 1 người dùng nữa để góp');
    return actions.profiles();
  }
  const me = S.currentProfile();
  openSheet({
    title: 'Góp tiền cho người khác',
    body: `<form class="form">
      <p class="muted small">Sổ của <b>${esc(me.name)}</b> ghi một khoản <b class="expense">chi</b>, sổ người nhận ghi một khoản <b class="income">thu</b>.</p>
      <div class="field"><span>Góp cho</span><div class="chips" id="gf-to">${others.map((p, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-to="${esc(p.id)}">${esc(p.icon)} ${esc(p.name)}</button>`).join('')}</div></div>
      ${amountField('gf-amt', 0)}
      <div class="two">
        ${field('Từ ví của ' + esc(me.name), `<select id="gf-from">${accOptions(state.settings.lastAccount)}</select>`)}
        ${field('Vào ví của <span id="gf-to-name"></span>', `<select id="gf-toacc"><option>Đang tải…</option></select>`)}
      </div>
      ${field('Ngày', `<input type="date" id="gf-date" value="${todayISO()}">`)}
      ${field('Ghi chú (không bắt buộc)', `<input id="gf-note" placeholder="vd: Góp tiền chợ tháng 11">`)}
      <div class="actions"><button class="btn primary">🤝 Góp</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'gf-amt');
      let toId = others[0].id;
      const loadPeer = async () => {
        const p = others.find((x) => x.id === toId);
        $(sh, '#gf-to-name').textContent = p.name;
        const accs = await S.peerAccounts(toId);
        $(sh, '#gf-toacc').innerHTML = accs.map((a) => `<option value="${a.id}">${esc(a.icon + ' ' + a.name)}</option>`).join('');
      };
      $(sh, '#gf-to').addEventListener('click', (e) => {
        const b = e.target.closest('[data-to]');
        if (!b) return;
        toId = b.dataset.to;
        sh.querySelectorAll('[data-to]').forEach((x) => x.classList.toggle('on', x === b));
        loadPeer();
      });
      loadPeer();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền góp');
        const toAccountId = $(sh, '#gf-toacc').value;
        if (!toAccountId) return toast('Chọn ví nhận');
        const to = others.find((x) => x.id === toId);
        await S.gop({
          toProfileId: toId, amount: v, fromAccountId: $(sh, '#gf-from').value, toAccountId,
          date: $(sh, '#gf-date').value || todayISO(), note: $(sh, '#gf-note').value.trim(),
        });
        close();
        toast(`🤝 Đã góp ${fmt(v)} cho ${to.name}`);
      });
    },
  });
}

function gopDetail(tx) {
  const out = tx.gop.dir === 'out';
  const peerExists = S.getProfiles().some((p) => p.id === tx.gop.peer);
  openSheet({
    title: out ? 'Khoản góp' : 'Khoản nhận góp',
    body: `<div class="detail">
      <div class="big-ic">🤝</div>
      <div class="kv"><span>${out ? 'Góp cho' : 'Nhận từ'}</span><b>${esc(tx.gop.peerName)}${peerExists ? '' : ' (đã xóa)'}</b></div>
      <div class="kv"><span>Số tiền</span><b class="${out ? 'expense' : 'income'}">${fmtSigned(out ? -tx.amountVnd : tx.amountVnd)}</b></div>
      <div class="kv"><span>${out ? 'Từ ví' : 'Vào ví'}</span><b>${esc(accName(tx.accountId))}</b></div>
      <div class="kv"><span>Ngày</span><b>${fmtDate(tx.date)}</b></div>
      ${tx.note ? `<div class="kv"><span>Ghi chú</span><b>${esc(tx.note)}</b></div>` : ''}
      <p class="muted small">Khoản góp được ghi ở cả 2 sổ. Muốn sửa số tiền: xóa khoản này rồi góp lại.</p>
      <div class="actions"><button type="button" class="btn danger" data-del>Xóa khoản góp${peerExists ? ' (cả 2 bên)' : ''}</button></div>
    </div>`,
    onMount(sh, close) {
      $(sh, '[data-del]').addEventListener('click', async () => {
        if (!confirm(`Xóa khoản góp này?${peerExists ? ` Giao dịch tương ứng trong sổ của ${tx.gop.peerName} cũng bị xóa.` : ''}`)) return;
        await S.deleteTx(tx);
        close(); toast('Đã xóa khoản góp');
      });
    },
  });
}
actions['report-cat'] = (el) => {
  ui.txFilter = { type: 'all', q: '', categoryId: el.dataset.id, tag: null, accountId: null };
  location.hash = '#/tx';
};

// ================= Báo cáo =================
function trendBuckets(r) {
  const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  let buckets, idx;
  if (r.type === 'year') {
    buckets = Array.from({ length: 12 }, (_, i) => ({ label: 'T' + (i + 1), income: 0, expense: 0 }));
    idx = (d) => Number(d.slice(5, 7)) - 1;
  } else {
    buckets = Array.from({ length: r.days }, (_, i) => {
      const d = addDays(r.start, i);
      return { label: r.type === 'week' ? WD[parseISO(d).getDay()] : String(Number(d.slice(8))), income: 0, expense: 0 };
    });
    idx = (d) => diffDays(r.start, d);
  }
  for (const t of S.txIn(r)) {
    const b = buckets[idx(t.date)];
    if (!b) continue;
    if (t.type === 'income') b.income += t.amountVnd;
    else if (t.type === 'expense') b.expense += t.amountVnd;
  }
  return buckets;
}

function pctChange(cur, prev) {
  if (!prev) return cur ? 'kỳ trước chưa có dữ liệu' : '';
  const p = Math.round(((cur - prev) / prev) * 100);
  return p === 0 ? 'bằng kỳ trước' : `${p > 0 ? 'tăng' : 'giảm'} ${Math.abs(p)}% so với kỳ trước`;
}

function reportsView() {
  const r = currentRange();
  const t = S.totals(r);
  const prev = getRange(r.type, shiftAnchor(r.type, r.start, -1), state.settings.weekStart);
  const pt = S.totals(prev);
  const type = ui.reportType;
  const cats = S.byCategory(r, type);
  const total = type === 'expense' ? t.expense : t.income;
  const elapsed = elapsedDays(r);
  const alloc = S.allocation(r);
  const tagMap = new Map();
  for (const x of S.txIn(r)) if (x.type === 'expense') for (const g of x.tags || []) tagMap.set(g, (tagMap.get(g) || 0) + x.amountVnd);
  const tags = [...tagMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return `
  <header class="top"><div>${profileChip()}<h1>Báo cáo</h1></div>${summaryBtn()}</header>
  ${periodBar()}
  <section class="card stats">
    <div><small>Thu</small><b class="income">${fmt(t.income)}</b><em>${pctChange(t.income, pt.income)}</em></div>
    <div><small>Chi</small><b class="expense">${fmt(t.expense)}</b><em>${pctChange(t.expense, pt.expense)}</em></div>
    <div><small>Chênh lệch</small><b class="${t.net >= 0 ? 'income' : 'expense'}">${fmtSigned(t.net)}</b>
      <em>${t.income > 0 ? `Tỷ lệ tiết kiệm ${Math.round((t.net / t.income) * 100)}%` : ''}</em></div>
    <div><small>Chi trung bình/ngày</small><b>${fmt(elapsed ? t.expense / elapsed : 0)}</b><em>${elapsed} ngày đã qua</em></div>
  </section>

  ${r.type === 'day' ? '' : `${sectionTitle('Theo thời gian')}
  <section class="card"><div class="legend-inline"><span><i class="dot b-in"></i>Thu</span><span><i class="dot b-ex"></i>Chi</span></div>${bars(trendBuckets(r))}</section>`}

  ${sectionTitle('Theo danh mục', `<div class="seg small">${['expense', 'income'].map((x) => `<button type="button" data-act="report-type" data-v="${x}" class="${type === x ? 'on' : ''}">${TYPE_LABEL[x]}</button>`).join('')}</div>`)}
  <section class="card">
    ${cats.length ? `<div class="donut-wrap">${donut(cats.map((c) => ({ value: c.amount, color: c.cat.color })), { label: type === 'expense' ? 'Tổng chi' : 'Tổng thu', value: fmtShort(total) })}</div>
    <div class="list">${cats.map((c) => `<button type="button" class="row" data-act="report-cat" data-id="${c.cat.id}">${catIcon(c.cat)}
      <span class="grow"><b>${esc(c.cat.name)}</b><small>${total ? ((c.amount / total) * 100).toFixed(1) : 0}%</small></span><span class="amt">${fmt(c.amount)}</span></button>`).join('')}</div>`
      : empty('📭', 'Chưa có dữ liệu trong kỳ này.')}
  </section>

  ${alloc ? allocationCard(alloc) : ''}

  ${tags.length ? `${sectionTitle('Chi theo tag')}<section class="card list">${tags.map(([g, v]) => `<button type="button" class="row" data-act="tx-tag-go" data-v="${esc(g)}"><span class="ci">#</span><span class="grow"><b>${esc(g)}</b></span><span class="amt">${fmt(v)}</span></button>`).join('')}</section>` : ''}
  `;
}

function allocationCard(a) {
  return `${sectionTitle('Phân bổ ' + esc(a.method.name), `<a class="link" href="#/settings">Đổi</a>`)}
  <section class="card">
    <p class="muted">Dựa trên ${a.usingExpected ? 'thu nhập dự kiến' : 'thu nhập thực tế'}: <b>${fmt(a.base)}</b>
      ${a.usingExpected && !a.base ? '<br>Hãy nhập "Thu nhập dự kiến/tháng" trong Cài đặt hoặc ghi khoản thu.' : ''}</p>
    ${a.groups.map((g) => `<div class="alloc"><div class="alloc-h"><b>${esc(g.name)}</b><span>${g.pct}%</span></div>
      ${progress(g.target ? g.spent / g.target : g.spent ? 1 : 0)}
      <small>Đã chi ${fmt(g.spent)} / mục tiêu ${fmt(g.target)}</small></div>`).join('')}
    ${a.unassigned ? `<p class="muted">Chưa gán nhóm: ${fmt(a.unassigned)} (sửa trong Cài đặt → Danh mục)</p>` : ''}
  </section>`;
}

actions['report-type'] = (el) => { ui.reportType = el.dataset.v; refresh(); };
actions['tx-tag-go'] = (el) => {
  ui.txFilter = { type: 'all', q: '', categoryId: null, tag: el.dataset.v, accountId: null };
  location.hash = '#/tx';
};

// ================= Kế hoạch =================
const PLAN_TABS = { budget: 'Ngân sách', goals: 'Mục tiêu', debts: 'Trả nợ', recurring: 'Định kỳ' };

function planView(sub) {
  if (sub && PLAN_TABS[sub]) ui.planTab = sub;
  const tab = ui.planTab;
  const body = { budget: budgetTab, goals: goalsTab, debts: debtsTab, recurring: recurringTab }[tab]();
  return `<header class="top"><div>${profileChip()}<h1>Kế hoạch</h1></div></header>
  <div class="seg tabs">${Object.entries(PLAN_TABS).map(([k, v]) => `<a href="#/plan/${k}" class="${tab === k ? 'on' : ''}">${v}</a>`).join('')}</div>
  ${body}`;
}

// ----- Ngân sách -----
function budgetTab() {
  const today = todayISO();
  const list = state.budgets.map((b) => ({ b, st: S.budgetStatus(b) })).sort((x, y) => y.st.ratio - x.st.ratio);
  const alloc = S.allocation(getRange('month', today));
  return `
  <p class="muted">Đặt hạn mức chi theo tuần/tháng/năm. App cảnh báo khi dùng 80% và khi vượt 100%.</p>
  ${list.length ? `<div class="card list">${list.map(({ b, st }) => {
    const daysLeft = diffDays(today, st.range.end) + 1;
    const cat = b.categoryId === '__all' ? { icon: 'Σ', color: '#3e63dd' } : S.catById(b.categoryId);
    return `<button type="button" class="row col" data-act="budget-edit" data-id="${b.id}">
      <div class="row-top">${catIcon(cat)}<span class="grow"><b>${esc(S.budgetName(b))}</b><small>${PERIOD_LABEL[b.period || 'month']} này · ${esc(st.range.label)}</small></span>
      <span class="amt ${st.left < 0 ? 'expense' : ''}">${st.left < 0 ? 'Vượt ' + fmt(-st.left) : 'Còn ' + fmt(st.left)}</span></div>
      ${progress(st.ratio)}
      <small class="muted">Đã chi ${fmt(st.spent)} / ${fmt(b.amount)} (${Math.round(st.ratio * 100)}%)${st.left > 0 && daysLeft > 0 ? ` · nên chi ≤ ${fmt(st.left / daysLeft)}/ngày` : ''}</small>
    </button>`;
  }).join('')}</div>` : empty('💸', 'Chưa có ngân sách nào.')}
  <button type="button" class="btn primary block" data-act="budget-edit">+ Thêm ngân sách</button>
  ${alloc ? allocationCard(alloc) : `<p class="muted center">Muốn chia thu nhập theo <b>50/30/20</b> hoặc <b>6 chiếc lọ</b>? Bật trong <a href="#/settings">Cài đặt</a>.</p>`}`;
}

actions['budget-goto'] = () => { ui.planTab = 'budget'; location.hash = '#/plan/budget'; };
actions['budget-edit'] = (el) => {
  const b = state.budgets.find((x) => x.id === el.dataset.id);
  const f = b ? { ...b } : { categoryId: '__all', amount: 0, period: 'month' };
  openSheet({
    title: b ? 'Sửa ngân sách' : 'Thêm ngân sách',
    body: `<form class="form">
      ${field('Áp dụng cho', `<select id="bf-cat">${catOptions('expense', f.categoryId, `<option value="__all" ${f.categoryId === '__all' ? 'selected' : ''}>Σ Tổng chi tiêu</option>`)}</select>`)}
      ${amountField('bf-amt', f.amount, 'Hạn mức')}
      ${field('Chu kỳ', `<select id="bf-per">${['month', 'year'].map((p) => `<option value="${p}" ${f.period === p ? 'selected' : ''}>Mỗi ${PERIOD_LABEL[p].toLowerCase()}</option>`).join('')}</select>`)}
      <div class="actions">${b ? '<button type="button" class="btn danger" data-del>Xóa</button>' : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'bf-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập hạn mức hợp lệ');
        await S.put('budgets', { ...f, categoryId: $(sh, '#bf-cat').value, amount: Math.round(v), period: $(sh, '#bf-per').value });
        close(); toast('Đã lưu ngân sách');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (!confirm('Xóa ngân sách này?')) return;
        await S.remove('budgets', b.id); close();
      });
    },
  });
};

// ----- Mục tiêu & quỹ dự phòng -----
function goalsTab() {
  const em = S.emergencyInfo();
  const goals = state.goals.filter((g) => !g.isEmergency);
  const eg = em.goal;
  return `
  <section class="card emergency">
    <div class="row-top"><span class="ci" style="--c:#e5484d">🛟</span><span class="grow"><b>Quỹ dự phòng khẩn cấp</b>
      <small>Nên bằng ${em.months} tháng chi tiêu</small></span></div>
    ${em.avg ? `<p>Chi tiêu trung bình: <b>${fmt(em.avg)}</b>/tháng → mục tiêu <b>${fmt(em.target)}</b></p>` : '<p class="muted">Chưa đủ dữ liệu chi tiêu để tính. Hãy ghi chép vài tuần.</p>'}
    ${eg ? `${progress(eg.target ? eg.saved / eg.target : 0, 'goal')}<small class="muted">Đã có ${fmt(eg.saved)} / ${fmt(eg.target)}</small>
      <div class="actions"><button type="button" class="btn ghost" data-act="goal-open" data-id="${eg.id}">Chi tiết</button>
      ${em.target && em.target !== eg.target ? `<button type="button" class="btn ghost" data-act="emergency-sync">Cập nhật mục tiêu = ${fmtShort(em.target)}</button>` : ''}</div>`
      : `<button type="button" class="btn primary block" data-act="emergency-create">Tạo quỹ dự phòng</button>`}
  </section>
  ${sectionTitle('Mục tiêu tiết kiệm')}
  ${goals.length ? `<div class="card list">${goals.map(goalRow).join('')}</div>` : empty('🎯', 'Chưa có mục tiêu. Ví dụ: mua xe, du lịch, quỹ học phí…')}
  <button type="button" class="btn primary block" data-act="goal-edit">+ Thêm mục tiêu</button>`;
}

function goalPlan(g) {
  const left = Math.max(0, g.target - g.saved);
  if (!g.deadline || !left) return '';
  const months = Math.max(1, Math.ceil(diffDays(todayISO(), g.deadline) / 30.4));
  return diffDays(todayISO(), g.deadline) < 0 ? 'Đã quá hạn' : `Cần ${fmt(left / months)}/tháng trong ${months} tháng`;
}

function goalRow(g) {
  const ratio = g.target ? g.saved / g.target : 0;
  return `<button type="button" class="row col" data-act="goal-open" data-id="${g.id}">
    <div class="row-top"><span class="ci" style="--c:#30a46c">${esc(g.icon || '🎯')}</span><span class="grow"><b>${esc(g.name)}</b>
      <small>${g.deadline ? 'Hạn ' + fmtDate(g.deadline) : 'Không đặt hạn'}${goalPlan(g) ? ' · ' + goalPlan(g) : ''}</small></span>
      <span class="amt">${Math.round(ratio * 100)}%</span></div>
    ${progress(ratio, 'goal')}<small class="muted">${fmt(g.saved)} / ${fmt(g.target)}</small></button>`;
}

actions['emergency-create'] = async () => {
  const em = S.emergencyInfo();
  await S.put('goals', { name: 'Quỹ dự phòng khẩn cấp', icon: '🛟', target: em.target || 0, saved: 0, deadline: null, isEmergency: true, contributions: [] });
  toast('Đã tạo quỹ dự phòng');
};
actions['emergency-sync'] = async () => {
  const em = S.emergencyInfo();
  if (em.goal) await S.put('goals', { ...em.goal, target: em.target });
};

actions['goal-edit'] = (el) => {
  const g = state.goals.find((x) => x.id === el.dataset.id);
  const f = g ? { ...g } : { name: '', icon: '🎯', target: 0, saved: 0, deadline: '', contributions: [] };
  openSheet({
    title: g ? 'Sửa mục tiêu' : 'Mục tiêu mới',
    body: `<form class="form">
      <div class="two">${field('Biểu tượng', `<input id="gf-icon" maxlength="4" value="${esc(f.icon)}" class="emoji">`)}
      ${field('Tên mục tiêu', `<input id="gf-name" required value="${esc(f.name)}" placeholder="vd: Mua xe máy">`, 'style="flex:3"')}</div>
      ${amountField('gf-target', f.target, 'Số tiền cần đạt')}
      ${g ? '' : amountField('gf-saved', 0, 'Đã có sẵn (không bắt buộc)')}
      ${field('Hạn hoàn thành (không bắt buộc)', `<input type="date" id="gf-dl" value="${esc(f.deadline || '')}">`)}
      <div class="actions">${g ? '<button type="button" class="btn danger" data-del>Xóa</button>' : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const tgt = bindMoney(sh, 'gf-target');
      const sv = g ? null : bindMoney(sh, 'gf-saved');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const target = readMoney(tgt.value);
        if (!(target > 0)) return toast('Nhập số tiền mục tiêu');
        const obj = { ...f, name: $(sh, '#gf-name').value.trim(), icon: $(sh, '#gf-icon').value.trim() || '🎯', target: Math.round(target), deadline: $(sh, '#gf-dl').value || null };
        if (sv) obj.saved = Math.round(readMoney(sv.value) || 0);
        await S.put('goals', obj);
        close(); toast('Đã lưu mục tiêu');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (!confirm('Xóa mục tiêu này? (Các giao dịch đã ghi vẫn giữ nguyên)')) return;
        await S.remove('goals', g.id); close();
      });
    },
  });
};

actions['goal-open'] = (el) => {
  const g = state.goals.find((x) => x.id === el.dataset.id);
  if (!g) return;
  const hist = [...(g.contributions || [])].reverse();
  openSheet({
    title: g.name,
    body: `<div class="goal-detail">
      <div class="big-ic">${esc(g.icon || '🎯')}</div>
      ${progress(g.target ? g.saved / g.target : 0, 'goal')}
      <p class="center"><b>${fmt(g.saved)}</b> / ${fmt(g.target)}<br><small class="muted">${goalPlan(g) || (g.saved >= g.target ? '🎉 Đã hoàn thành!' : '')}</small></p>
      <div class="actions"><button type="button" class="btn primary" data-c="1">+ Nạp tiền</button><button type="button" class="btn ghost" data-c="-1">− Rút ra</button></div>
      ${hist.length ? `<h4>Lịch sử</h4><div class="list">${hist.map((c) => `<div class="row"><span class="grow">${fmtDate(c.date)}${c.note ? ' · ' + esc(c.note) : ''}</span><span class="amt ${c.amount > 0 ? 'income' : 'expense'}">${fmtSigned(c.amount)}</span></div>`).join('')}</div>` : ''}
      <div class="actions"><button type="button" class="btn ghost" data-edit>Sửa mục tiêu</button></div>
    </div>`,
    onMount(sh, close) {
      sh.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { close(); goalContribute(g, Number(b.dataset.c)); }));
      $(sh, '[data-edit]').addEventListener('click', () => { close(); actions['goal-edit']({ dataset: { id: g.id } }); });
    },
  });
};

function goalContribute(g, dir) {
  const savingCat = S.sysCat('saving');
  openSheet({
    title: dir > 0 ? `Nạp vào "${g.name}"` : `Rút từ "${g.name}"`,
    body: `<form class="form">
      ${amountField('gc-amt', 0)}
      ${field(dir > 0 ? 'Lấy từ ví' : 'Đưa về ví', `<select id="gc-acc">${accOptions(state.settings.lastAccount)}</select>`)}
      ${field('Ngày', `<input type="date" id="gc-date" value="${todayISO()}">`)}
      <label class="check"><input type="checkbox" id="gc-tx" ${dir > 0 ? 'checked' : ''}> ${dir > 0
        ? `Ghi thành khoản chi "${esc(savingCat?.name || 'Tiết kiệm')}" (trừ số dư ví)`
        : 'Ghi thành khoản thu vào ví'}</label>
      <div class="actions"><button class="btn primary">Xác nhận</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'gc-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = Math.round(readMoney(amt.value));
        if (!(v > 0)) return toast('Nhập số tiền');
        const date = $(sh, '#gc-date').value || todayISO();
        let txId = null;
        if ($(sh, '#gc-tx').checked) {
          const incomeCat = S.catsOf('income').find((c) => c.name === 'Thu khác') || S.catsOf('income')[0];
          const tx = await S.put('transactions', {
            type: dir > 0 ? 'expense' : 'income', amount: v, currency: 'VND', rate: 1, amountVnd: v, date,
            categoryId: dir > 0 ? savingCat?.id : incomeCat?.id, accountId: $(sh, '#gc-acc').value,
            note: (dir > 0 ? 'Tiết kiệm: ' : 'Rút từ mục tiêu: ') + g.name, tags: [], splits: null, photoIds: [], createdAt: Date.now(),
          }, { silent: true });
          txId = tx.id;
        }
        g.saved = Math.max(0, (g.saved || 0) + dir * v);
        g.contributions = [...(g.contributions || []), { date, amount: dir * v, txId }];
        await S.put('goals', g);
        close();
        toast(g.saved >= g.target && dir > 0 ? '🎉 Chúc mừng! Bạn đã đạt mục tiêu' : 'Đã cập nhật mục tiêu');
      });
    },
  });
}

// ----- Trả nợ ngân hàng -----
function debtsTab() {
  const today = todayISO();
  const m = getRange('month', today);
  const active = state.debts.filter((d) => !d.done).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const done = state.debts.filter((d) => d.done);
  const dueThisMonth = active.filter((d) => d.dueDate <= m.end).reduce((s, d) => s + d.amount, 0);
  const paidThisMonth = state.debts.flatMap((d) => d.history || []).filter((h) => h.paidDate >= m.start && h.paidDate <= m.end).reduce((s, h) => s + h.amount, 0);
  return `
  <section class="card stats two-col">
    <div><small>Còn phải trả đến hết ${m.label.toLowerCase()}</small><b class="expense">${fmt(dueThisMonth)}</b></div>
    <div><small>Đã trả trong tháng</small><b class="income">${fmt(paidThisMonth)}</b></div>
  </section>
  ${active.length ? `<div class="card list">${active.map((d) => {
    const days = diffDays(today, d.dueDate);
    const tone = days < 0 ? 'over' : days <= (d.remindDays ?? state.settings.remindDays) ? 'warn' : '';
    return `<button type="button" class="row alert ${tone}" data-act="debt-open" data-id="${d.id}">
      <span class="ci" style="--c:#0d74ce">🏦</span>
      <span class="grow"><b>${esc(S.debtName(d))}</b><small>${fmtDate(d.dueDate)} · ${fmtDue(days)}${d.repeat === 'monthly' ? ` · hằng tháng${d.periodsLeft != null ? `, còn ${d.periodsLeft} kỳ` : ''}` : ''}</small>
      ${d.method ? `<small>💳 ${esc(d.method)}</small>` : ''}</span>
      <span class="amt">${fmt(d.amount)}</span></button>`;
  }).join('')}</div>` : empty('🏦', 'Chưa có khoản trả nợ nào.')}
  <button type="button" class="btn primary block" data-act="debt-edit">+ Thêm khoản trả nợ</button>
  ${active.length ? `<button type="button" class="btn ghost block" data-act="debt-ics-all">📅 Thêm tất cả hạn trả nợ vào Lịch điện thoại</button>` : ''}
  ${done.length ? `<details class="card"><summary>Đã hoàn tất (${done.length})</summary><div class="list">${done.map((d) =>
    `<button type="button" class="row" data-act="debt-open" data-id="${d.id}"><span class="ci">✅</span><span class="grow"><b>${esc(S.debtName(d))}</b><small>${(d.history || []).length} lần trả</small></span><span class="amt">${fmt((d.history || []).reduce((s, h) => s + h.amount, 0))}</span></button>`).join('')}</div></details>` : ''}`;
}

actions['debt-edit'] = (el) => {
  const d = state.debts.find((x) => x.id === el.dataset.id);
  const f = d ? { ...d } : { bank: '', title: '', amount: 0, dueDate: todayISO(), repeat: 'monthly', periodsLeft: null, method: PAY_METHODS[0], note: '', accountId: state.settings.lastAccount, remindDays: Number(state.settings.remindDays) };
  const methodIsPreset = PAY_METHODS.includes(f.method);
  openSheet({
    title: d ? 'Sửa khoản trả nợ' : 'Thêm khoản trả nợ',
    body: `<form class="form">
      ${field('Ngân hàng / Công ty tài chính', `<input id="df-bank" list="bank-list" required value="${esc(f.bank)}" placeholder="vd: Vietcombank"><datalist id="bank-list">${BANKS.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`)}
      ${field('Nội dung khoản nợ', `<input id="df-title" value="${esc(f.title)}" placeholder="vd: Vay mua xe, Thẻ tín dụng, Trả góp iPhone">`)}
      ${amountField('df-amt', f.amount, 'Số tiền mỗi kỳ')}
      <div class="two">${field('Ngày đến hạn', `<input type="date" id="df-date" required value="${esc(f.dueDate)}">`)}
      ${field('Nhắc trước (ngày)', `<input type="number" id="df-rem" min="0" max="30" value="${esc(f.remindDays ?? 3)}">`)}</div>
      <div class="two">${field('Lặp lại', `<select id="df-rep"><option value="monthly" ${f.repeat === 'monthly' ? 'selected' : ''}>Hằng tháng</option><option value="none" ${f.repeat === 'none' ? 'selected' : ''}>Một lần</option></select>`)}
      ${field('Số kỳ còn lại', `<input type="number" id="df-left" min="1" placeholder="Không giới hạn" value="${f.periodsLeft ?? ''}">`, 'data-left')}</div>
      ${field('Cách thức thanh toán', `<select id="df-method">${PAY_METHODS.map((m) => `<option ${m === f.method || (!methodIsPreset && m === 'Khác') ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`)}
      ${field('Ghi chú thanh toán', `<textarea id="df-note" rows="3" placeholder="vd: CK tới STK 0123456789 – Nguyễn Văn A, nội dung: HD123 thang 11. Hoặc: trích tự động từ TK lương, nhớ để đủ tiền trước ngày 25.">${esc(f.note || (!methodIsPreset ? f.method : ''))}</textarea>`)}
      ${field('Trả từ ví (khi đánh dấu đã trả)', `<select id="df-acc">${accOptions(f.accountId)}</select>`)}
      <div class="actions">${d ? '<button type="button" class="btn danger" data-del>Xóa</button>' : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'df-amt');
      const rep = $(sh, '#df-rep'), leftF = $(sh, '[data-left]');
      const updRep = () => { leftF.hidden = rep.value !== 'monthly'; };
      rep.addEventListener('change', updRep); updRep();
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền mỗi kỳ');
        const dueDate = $(sh, '#df-date').value;
        if (!dueDate) return toast('Chọn ngày đến hạn');
        const left = $(sh, '#df-left').value;
        await S.put('debts', {
          ...f, bank: $(sh, '#df-bank').value.trim(), title: $(sh, '#df-title').value.trim(), amount: Math.round(v),
          dueDate, dueDay: Number(dueDate.slice(8)), repeat: rep.value, periodsLeft: rep.value === 'monthly' && left ? Math.max(1, Number(left)) : null,
          method: $(sh, '#df-method').value, note: $(sh, '#df-note').value.trim(), accountId: $(sh, '#df-acc').value,
          remindDays: Number($(sh, '#df-rem').value) || 0, done: d ? d.done && dueDate === d.dueDate : false, history: f.history || [],
        });
        close(); toast('Đã lưu khoản trả nợ');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (!confirm('Xóa khoản này? Các giao dịch trả nợ đã ghi vẫn được giữ.')) return;
        await S.remove('debts', d.id); close();
      });
    },
  });
};

actions['debt-open'] = (el) => {
  const d = state.debts.find((x) => x.id === el.dataset.id);
  if (!d) return;
  const days = diffDays(todayISO(), d.dueDate);
  const hist = [...(d.history || [])].reverse();
  openSheet({
    title: S.debtName(d),
    body: `<div class="detail">
      <div class="kv"><span>Số tiền mỗi kỳ</span><b>${fmt(d.amount)}</b></div>
      ${d.done ? '<div class="kv"><span>Trạng thái</span><b class="income">Đã hoàn tất</b></div>'
        : `<div class="kv"><span>Hạn kỳ tới</span><b class="${days < 0 ? 'expense' : ''}">${fmtDate(d.dueDate)} (${fmtDue(days)})</b></div>`}
      <div class="kv"><span>Lặp lại</span><b>${d.repeat === 'monthly' ? 'Hằng tháng' + (d.periodsLeft != null ? ` · còn ${d.periodsLeft} kỳ` : '') : 'Một lần'}</b></div>
      <div class="kv"><span>Cách thanh toán</span><b>${esc(d.method || '—')}</b></div>
      ${d.note ? `<div class="note-box">${esc(d.note).replace(/\n/g, '<br>')}</div>` : ''}
      ${d.note ? '<button type="button" class="btn ghost small" data-copy>📋 Sao chép ghi chú</button>' : ''}
      <div class="actions">
        ${d.done ? '' : '<button type="button" class="btn primary" data-pay>✓ Đánh dấu đã trả</button>'}
        <button type="button" class="btn ghost" data-ics>📅 Thêm vào Lịch</button>
      </div>
      ${hist.length ? `<h4>Lịch sử trả</h4><div class="list">${hist.map((h) => `<div class="row"><span class="grow">Kỳ ${fmtDate(h.dueDate)}<small>Trả ngày ${fmtDate(h.paidDate)}</small></span><span class="amt">${fmt(h.amount)}</span></div>`).join('')}</div>
        <button type="button" class="btn ghost small" data-undo>↶ Hoàn tác lần trả gần nhất</button>` : ''}
      <div class="actions"><button type="button" class="btn ghost" data-edit>Sửa</button></div>
    </div>`,
    onMount(sh, close) {
      $(sh, '[data-pay]')?.addEventListener('click', () => { close(); debtPay(d); });
      $(sh, '[data-ics]').addEventListener('click', () => calendarSheet(`tra-no-${d.bank}.ics`, buildAllDayICS([debtEvent(d)])));
      $(sh, '[data-edit]').addEventListener('click', () => { close(); actions['debt-edit']({ dataset: { id: d.id } }); });
      $(sh, '[data-copy]')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(d.note); toast('Đã sao chép'); } catch { toast('Không sao chép được'); }
      });
      $(sh, '[data-undo]')?.addEventListener('click', async () => {
        if (!confirm('Hoàn tác lần trả gần nhất? Giao dịch chi tương ứng sẽ bị xóa.')) return;
        await S.undoDebtPayment(d); close(); toast('Đã hoàn tác');
      });
    },
  });
};

function debtPay(d) {
  openSheet({
    title: 'Xác nhận đã trả',
    body: `<form class="form">
      <p class="muted">${esc(S.debtName(d))} · kỳ ${fmtDate(d.dueDate)}</p>
      ${amountField('dp-amt', d.amount, 'Số tiền đã trả')}
      ${field('Trả từ ví', `<select id="dp-acc">${accOptions(d.accountId || state.settings.lastAccount)}</select>`)}
      ${field('Ngày trả', `<input type="date" id="dp-date" value="${todayISO()}">`)}
      <p class="muted">App sẽ ghi một khoản chi "Trả nợ ngân hàng"${d.repeat === 'monthly' ? ' và chuyển sang kỳ tháng sau' : ''}.</p>
      <div class="actions"><button class="btn primary">Xác nhận</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'dp-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền');
        await S.payDebt(d, { amount: Math.round(v), accountId: $(sh, '#dp-acc').value, date: $(sh, '#dp-date').value || todayISO() });
        close(); toast(d.done ? '🎉 Đã trả xong khoản nợ!' : 'Đã ghi nhận. Kỳ tới: ' + fmtDate(d.dueDate));
      });
    },
  });
}

function debtEvent(d) {
  const rrule = d.repeat === 'monthly' ? `FREQ=MONTHLY${d.periodsLeft != null ? ';COUNT=' + d.periodsLeft : ''}` : null;
  return {
    uid: 'debt-' + d.id, date: d.dueDate, rrule, remindDays: d.remindDays ?? state.settings.remindDays,
    title: `🏦 Trả nợ ${S.debtName(d)}: ${fmt(d.amount)}`,
    description: `Cách thanh toán: ${d.method || ''}\n${d.note || ''}`,
  };
}

actions['debt-ics-all'] = () => {
  const evs = state.debts.filter((d) => !d.done).map(debtEvent);
  calendarSheet('lich-tra-no.ics', buildAllDayICS(evs));
};

function calendarSheet(filename, ics) {
  openSheet({
    title: 'Thêm vào Lịch điện thoại',
    body: `<p>App Lịch của điện thoại sẽ <b>tự báo chuông</b> trước hạn, kể cả khi bạn không mở Sổ Thu Chi.</p>
      <div class="actions col"><button type="button" class="btn primary" data-open>📅 Mở bằng app Lịch</button>
      <button type="button" class="btn ghost" data-share>📤 Chia sẻ / Lưu file .ics</button></div>
      <p class="muted small">Nếu nút đầu không mở được Lịch, hãy dùng "Chia sẻ", chọn Lịch hoặc lưu file rồi mở file đó.</p>`,
    onMount(sh) {
      $(sh, '[data-open]').addEventListener('click', () => openCalendarFile(filename, ics));
      $(sh, '[data-share]').addEventListener('click', () => shareOrDownload(filename, ics, 'text/calendar'));
    },
  });
}

// ----- Giao dịch định kỳ -----
function recurringTab() {
  const list = [...state.recurring].sort((a, b) => (b.active - a.active) || (a.nextDate < b.nextDate ? -1 : 1));
  return `
  <p class="muted">Lương, tiền nhà, điện nước, Netflix… Chọn <b>tự động ghi</b> khi đến ngày, hoặc <b>chờ xác nhận</b> nếu số tiền thay đổi mỗi kỳ.</p>
  ${list.length ? `<div class="card list">${list.map((r) => {
    const t = r.template;
    const cat = S.catById(t.categoryId);
    return `<button type="button" class="row ${r.active ? '' : 'off'}" data-act="rec-open" data-id="${r.id}">
      ${t.type === 'transfer' ? '<span class="ci">⇄</span>' : catIcon(cat)}
      <span class="grow"><b>${esc(t.note || cat?.name || TYPE_LABEL[t.type])}</b>
      <small>${FREQ_LABEL[r.freq]}${r.interval > 1 ? ` (mỗi ${r.interval})` : ''} · ${r.active ? 'kỳ tới ' + fmtDate(r.nextDate) : 'đã tắt'} · ${r.autoAdd ? 'tự động' : 'chờ xác nhận'}</small></span>
      <span class="amt ${t.type}">${fmtCur(t.amount, t.currency)}</span></button>`;
  }).join('')}</div>` : empty('🔁', 'Chưa có khoản định kỳ. Khi thêm giao dịch, chọn "Lặp lại" để tạo.')}
  <button type="button" class="btn primary block" data-act="add" data-repeat="month">+ Thêm khoản định kỳ</button>`;
}

actions['rec-open'] = (el) => {
  const r = state.recurring.find((x) => x.id === el.dataset.id);
  if (!r) return;
  const t = r.template;
  const curOpts = state.settings.currencies.map((c) => `<option ${c.code === (t.currency || 'VND') ? 'selected' : ''}>${esc(c.code)}</option>`).join('');
  openSheet({
    title: 'Khoản định kỳ',
    body: `<form class="form">
      <p class="muted">${TYPE_LABEL[t.type]}</p>
      <div class="two">${amountField('rf-amt', t.amount)}${state.settings.currencies.length > 1 ? field('Tiền tệ', `<select id="rf-cur">${curOpts}</select>`, 'style="flex:0 0 96px"') : ''}</div>
      ${t.type !== 'transfer' ? field('Danh mục', `<select id="rf-cat">${catOptions(t.type, t.categoryId)}</select>`) : ''}
      ${field('Ví', `<select id="rf-acc">${accOptions(t.accountId)}</select>`)}
      ${field('Ghi chú', `<input id="rf-note" value="${esc(t.note || '')}">`)}
      <div class="two">${field('Lặp lại', `<select id="rf-freq">${Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}" ${r.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
      ${field('Kỳ tới', `<input type="date" id="rf-next" value="${esc(r.nextDate)}">`)}</div>
      <div class="two">${field('Nhắc trước (ngày)', `<input type="number" id="rf-rem" min="0" max="30" value="${esc(r.remindDays ?? 0)}">`)}
      ${field('Kết thúc (không bắt buộc)', `<input type="date" id="rf-end" value="${esc(r.endDate || '')}">`)}</div>
      <label class="check"><input type="checkbox" id="rf-auto" ${r.autoAdd ? 'checked' : ''}> Tự động ghi khi đến ngày</label>
      <label class="check"><input type="checkbox" id="rf-active" ${r.active ? 'checked' : ''}> Đang hoạt động</label>
      <div class="actions"><button type="button" class="btn danger" data-del>Xóa</button><button type="button" class="btn ghost" data-ics>📅 Lịch</button><button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const amt = bindMoney(sh, 'rf-amt');
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readMoney(amt.value);
        if (!(v > 0)) return toast('Nhập số tiền');
        const nd = $(sh, '#rf-next').value;
        r.template = { ...t, amount: v, currency: $(sh, '#rf-cur')?.value || t.currency || 'VND', categoryId: $(sh, '#rf-cat')?.value || t.categoryId, accountId: $(sh, '#rf-acc').value, note: $(sh, '#rf-note').value.trim(), splits: null };
        r.freq = $(sh, '#rf-freq').value;
        if (nd && nd !== r.nextDate) { r.nextDate = nd; r.anchorDay = Number(nd.slice(8)); }
        r.remindDays = Number($(sh, '#rf-rem').value) || 0;
        r.endDate = $(sh, '#rf-end').value || null;
        r.autoAdd = $(sh, '#rf-auto').checked;
        r.active = $(sh, '#rf-active').checked;
        await S.put('recurring', r);
        await S.processRecurring();
        close(); toast('Đã lưu');
      });
      $(sh, '[data-del]').addEventListener('click', async () => {
        if (!confirm('Xóa khoản định kỳ? Các giao dịch đã ghi vẫn được giữ.')) return;
        await S.remove('recurring', r.id); close();
      });
      $(sh, '[data-ics]').addEventListener('click', () => {
        const rr = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[r.freq];
        calendarSheet('dinh-ky.ics', buildAllDayICS([{
          uid: 'rec-' + r.id, date: r.nextDate, rrule: `FREQ=${rr};INTERVAL=${r.interval || 1}${r.endDate ? ';UNTIL=' + r.endDate.replace(/-/g, '') : ''}`,
          remindDays: r.remindDays || 0, title: `🔁 ${t.note || S.catById(t.categoryId)?.name || 'Định kỳ'}: ${fmtCur(t.amount, t.currency)}`, description: 'Khoản định kỳ trong Sổ Thu Chi',
        }]));
      });
    },
  });
};

actions['pending-open'] = (el) => {
  const r = state.recurring.find((x) => x.id === el.dataset.id);
  if (!r) return;
  const tx = S.txFromTemplate(r, r.nextDate);
  openTxForm({ preset: { ...tx, id: undefined }, fromRecurring: r });
};

// ================= Form giao dịch =================
export function openTxForm({ tx = null, type = 'expense', preset = null, fromRecurring = null, repeat = 'none' } = {}) {
  const st = state.settings;
  const isEdit = !!tx;
  const f = tx ? JSON.parse(JSON.stringify(tx)) : {
    type, amount: null, currency: 'VND', date: todayISO(), categoryId: st.lastCat?.[type] || null,
    accountId: st.lastAccount, toAccountId: null, note: '', tags: [], splits: null, photoIds: [], ...(preset || {}),
  };
  const accs = S.activeAccounts();
  if (!S.accById(f.accountId)) f.accountId = accs[0]?.id;
  if (f.type === 'transfer' && !f.toAccountId) f.toAccountId = accs.find((a) => a.id !== f.accountId)?.id;
  const ensureCat = () => { if (f.type !== 'transfer' && !S.catsOf(f.type).some((c) => c.id === f.categoryId)) f.categoryId = st.lastCat?.[f.type] && S.catById(st.lastCat[f.type]) ? st.lastCat[f.type] : S.catsOf(f.type)[0]?.id; };
  ensureCat();
  const rate0 = f.rate || S.rateOf(f.currency);
  let splitRows = f.splits && f.splits.length ? f.splits.map((p) => ({ categoryId: p.categoryId, amount: fmtNum(p.amountVnd / rate0) })) : [];
  const keepPhotos = [...(f.photoIds || [])];
  const removed = [];
  const added = []; // { blob, url }
  const multiCur = st.currencies.length > 1;
  const showVoice = voiceSupported();

  openSheet({
    title: isEdit ? 'Sửa giao dịch' : fromRecurring ? 'Xác nhận khoản định kỳ' : 'Thêm giao dịch',
    body: `<form class="form txf" autocomplete="off">
      <div class="seg seg-3" id="tf-type">${['expense', 'income', 'transfer'].map((t) => `<button type="button" data-v="${t}">${TYPE_LABEL[t]}</button>`).join('')}
        ${!isEdit && !fromRecurring && otherProfiles().length ? '<button type="button" id="tf-gop">🤝 Góp</button>' : ''}</div>
      <div class="amount-row">
        <input id="tf-amt" class="amount-input" inputmode="decimal" placeholder="0" value="${f.amount ? esc(fmtNum(f.amount)) : ''}" aria-label="Số tiền">
        ${multiCur ? `<select id="tf-cur" class="cur">${st.currencies.map((c) => `<option ${c.code === f.currency ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select>` : ''}
        ${showVoice ? '<button type="button" class="icon-btn mic" id="tf-mic" title="Nói, vd: ăn trưa 45 nghìn">🎤</button>' : ''}
      </div>
      <em class="hint center" id="tf-hint">Gõ nhanh: 50k · 1tr2 · 2,5tr</em>
      <div id="tf-quick" class="chips center"></div>
      <div id="tf-cats" class="cat-grid"></div>
      <label class="check" id="tf-split-wrap"><input type="checkbox" id="tf-split" ${splitRows.length ? 'checked' : ''}> Chia thành nhiều danh mục</label>
      <div id="tf-splits"></div>
      <div class="two">
        ${field('<span id="tf-acc-l">Ví</span>', `<select id="tf-acc">${accOptions(f.accountId)}</select>`)}
        ${field('Đến ví', `<select id="tf-to">${accOptions(f.toAccountId)}</select>`, 'id="tf-to-wrap"')}
        ${field('Ngày', `<input type="date" id="tf-date" value="${esc(f.date)}" required>`)}
      </div>
      ${field('Ghi chú', `<input id="tf-note" value="${esc(f.note)}" placeholder="vd: Ăn trưa với đồng nghiệp">`)}
      ${field('Tag (cách nhau bởi dấu phẩy)', `<input id="tf-tags" value="${esc((f.tags || []).join(', '))}" placeholder="vd: du lịch Đà Lạt, công tác"><div class="chips" id="tf-tag-sug"></div>`)}
      <div class="field"><span>Ảnh hóa đơn</span><div class="photos" id="tf-photos"></div>
        <label class="btn ghost small file-btn">📷 Chụp / chọn ảnh<input type="file" accept="image/*" id="tf-photo" multiple hidden></label></div>
      ${isEdit || fromRecurring ? '' : `<div class="two">${field('Lặp lại', `<select id="tf-rep"><option value="none">Không</option>${Object.entries(FREQ_LABEL).map(([k, v]) => `<option value="${k}" ${repeat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
        <label class="check" id="tf-auto-wrap"><input type="checkbox" id="tf-auto" checked> Tự động ghi khi đến kỳ</label></div>`}
      <div class="actions">
        ${isEdit ? '<button type="button" class="btn danger" id="tf-del">Xóa</button><button type="button" class="btn ghost" id="tf-dup">Nhân bản</button>' : ''}
        ${fromRecurring ? '<button type="button" class="btn ghost" id="tf-skip">Bỏ qua kỳ này</button>' : ''}
        <button class="btn primary">Lưu</button>
      </div>
    </form>`,
    onClose() { added.forEach((p) => URL.revokeObjectURL(p.url)); },
    onMount(sh, close) {
      const amtIn = $(sh, '#tf-amt'), hint = $(sh, '#tf-hint');
      const curSel = $(sh, '#tf-cur');
      const curCode = () => (curSel ? curSel.value : 'VND');

      const updHint = () => {
        const v = parseAmount(amtIn.value);
        if (!amtIn.value) { hint.textContent = 'Gõ nhanh: 50k · 1tr2 · 2,5tr'; return; }
        if (!Number.isFinite(v)) { hint.textContent = 'Chưa hiểu số tiền'; return; }
        const c = curCode();
        hint.textContent = c === 'VND' ? '= ' + fmt(v) : `= ${fmtCur(v, c)} ≈ ${fmt(v * S.rateOf(c))}`;
        renderSplitInfo();
      };
      amtIn.addEventListener('input', updHint);
      curSel?.addEventListener('change', updHint);

      // --- loại giao dịch ---
      const typeBtns = sh.querySelectorAll('#tf-type button[data-v]');
      $(sh, '#tf-gop')?.addEventListener('click', () => { close(); openGopForm(); });
      const updType = () => {
        typeBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === f.type));
        const tr = f.type === 'transfer';
        $(sh, '#tf-cats').hidden = tr;
        $(sh, '#tf-quick').hidden = tr;
        $(sh, '#tf-split-wrap').hidden = tr;
        $(sh, '#tf-to-wrap').hidden = !tr;
        $(sh, '#tf-acc-l').textContent = tr ? 'Từ ví' : 'Ví';
        if (tr) $(sh, '#tf-split').checked = false;
        renderCats(); renderSplits();
      };
      typeBtns.forEach((b) => b.addEventListener('click', () => {
        if (f.type === b.dataset.v) return;
        f.type = b.dataset.v; ensureCat(); splitRows = []; $(sh, '#tf-split').checked = false;
        updType();
      }));

      // --- danh mục ---
      function renderCats() {
        if (f.type === 'transfer') return;
        $(sh, '#tf-cats').innerHTML = S.catsOf(f.type).filter((c) => !String(c.sys || '').startsWith('gop')).map((c) =>
          `<button type="button" class="cat ${c.id === f.categoryId ? 'on' : ''}" data-id="${c.id}" style="--c:${esc(c.color)}"><span>${esc(c.icon)}</span><small>${esc(c.name)}</small></button>`).join('');
        $(sh, '#tf-quick').innerHTML = '';
      }
      $(sh, '#tf-cats').addEventListener('click', (e) => {
        const b = e.target.closest('.cat');
        if (!b) return;
        f.categoryId = b.dataset.id;
        renderCats();
      });

      // --- chia danh mục ---
      const splitBox = $(sh, '#tf-splits');
      function renderSplits() {
        const on = $(sh, '#tf-split').checked && f.type !== 'transfer';
        $(sh, '#tf-cats').classList.toggle('dim', on);
        if (!on) { splitBox.innerHTML = ''; return; }
        if (!splitRows.length) splitRows = [{ categoryId: f.categoryId, amount: amtIn.value }, { categoryId: S.catsOf(f.type)[1]?.id, amount: '' }];
        splitBox.innerHTML = splitRows.map((r, i) => `<div class="split-row" data-i="${i}">
          <select data-k="categoryId">${catOptions(f.type, r.categoryId)}</select>
          <input data-k="amount" inputmode="decimal" placeholder="Số tiền" value="${esc(r.amount)}">
          <button type="button" class="icon-btn" data-rm aria-label="Bỏ">✕</button></div>`).join('')
          + `<div class="split-foot"><button type="button" class="btn ghost small" data-add>+ Thêm dòng</button><em id="tf-split-info"></em></div>`;
        renderSplitInfo();
      }
      function renderSplitInfo() {
        const el = $(sh, '#tf-split-info');
        if (!el) return;
        const total = parseAmount(amtIn.value) || 0;
        const sum = splitRows.reduce((s, r) => s + (parseAmount(r.amount) || 0), 0);
        const diff = total - sum;
        el.textContent = Math.abs(diff) < 0.5 ? '✓ Khớp tổng' : diff > 0 ? `Còn thiếu ${fmtCur(diff, curCode())}` : `Dư ${fmtCur(-diff, curCode())}`;
        el.className = Math.abs(diff) < 0.5 ? 'income' : 'expense';
      }
      $(sh, '#tf-split').addEventListener('change', renderSplits);
      splitBox.addEventListener('input', (e) => {
        const row = e.target.closest('.split-row');
        if (!row) return;
        splitRows[row.dataset.i][e.target.dataset.k] = e.target.value;
        renderSplitInfo();
      });
      splitBox.addEventListener('change', (e) => {
        const row = e.target.closest('.split-row');
        if (row && e.target.dataset.k) splitRows[row.dataset.i][e.target.dataset.k] = e.target.value;
      });
      splitBox.addEventListener('click', (e) => {
        if (e.target.closest('[data-add]')) {
          const total = parseAmount(amtIn.value) || 0;
          const sum = splitRows.reduce((s, r) => s + (parseAmount(r.amount) || 0), 0);
          splitRows.push({ categoryId: S.catsOf(f.type)[0]?.id, amount: total > sum ? fmtNum(total - sum) : '' });
          renderSplits();
        } else if (e.target.closest('[data-rm]')) {
          splitRows.splice(Number(e.target.closest('.split-row').dataset.i), 1);
          if (splitRows.length < 2) { $(sh, '#tf-split').checked = false; splitRows = []; }
          renderSplits();
        }
      });

      // --- tag gợi ý ---
      const tagIn = $(sh, '#tf-tags');
      const renderTagSug = () => {
        const cur = splitTags(tagIn.value);
        $(sh, '#tf-tag-sug').innerHTML = S.allTags().filter((g) => !cur.includes(g)).slice(0, 8)
          .map((g) => `<button type="button" class="chip" data-tag="${esc(g)}">#${esc(g)}</button>`).join('');
      };
      $(sh, '#tf-tag-sug').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tag]');
        if (!b) return;
        tagIn.value = [...splitTags(tagIn.value), b.dataset.tag].join(', ');
        renderTagSug();
      });
      tagIn.addEventListener('input', debounce(renderTagSug, 200));
      renderTagSug();

      // --- ảnh ---
      const photoBox = $(sh, '#tf-photos');
      async function renderPhotos() {
        const items = [];
        for (const id of keepPhotos) {
          const p = await S.getPhoto(id);
          if (p) items.push(`<div class="ph"><img src="${URL.createObjectURL(p.blob)}" alt="" data-view><button type="button" data-rm-old="${id}">✕</button></div>`);
        }
        added.forEach((p, i) => items.push(`<div class="ph"><img src="${p.url}" alt="" data-view><button type="button" data-rm-new="${i}">✕</button></div>`));
        photoBox.innerHTML = items.join('');
      }
      photoBox.addEventListener('click', (e) => {
        const t = e.target;
        if (t.dataset.rmOld) { keepPhotos.splice(keepPhotos.indexOf(t.dataset.rmOld), 1); removed.push(t.dataset.rmOld); renderPhotos(); }
        else if (t.dataset.rmNew != null) { URL.revokeObjectURL(added[t.dataset.rmNew].url); added.splice(Number(t.dataset.rmNew), 1); renderPhotos(); }
        else if (t.hasAttribute('data-view')) viewImage(t.src);
      });
      $(sh, '#tf-photo').addEventListener('change', async (e) => {
        for (const file of e.target.files) {
          try {
            const blob = await compressImage(file);
            added.push({ blob, url: URL.createObjectURL(blob) });
          } catch (err) { toast(err.message); }
        }
        e.target.value = '';
        renderPhotos();
      });
      renderPhotos();

      // --- giọng nói ---
      const mic = $(sh, '#tf-mic');
      mic?.addEventListener('click', async () => {
        if (!navigator.onLine) return toast('Nhập giọng nói cần có kết nối mạng');
        mic.classList.add('rec');
        toast('Đang nghe… vd: "ăn trưa 45 nghìn"');
        try {
          const text = await listen();
          if (!text) return toast('Không nghe rõ, thử lại nhé');
          const p = parseSpeech(text);
          if (p.type !== f.type) { f.type = p.type; ensureCat(); updType(); }
          if (p.amount) { amtIn.value = fmtNum(p.amount); updHint(); }
          if (p.note) $(sh, '#tf-note').value = p.note;
          const c = p.categoryName && S.catsOf(f.type).find((x) => x.name === p.categoryName);
          if (c) { f.categoryId = c.id; renderCats(); }
          toast(`🎤 “${text}”`);
        } catch (err) {
          toast(err.message === 'not-allowed' ? 'Bạn chưa cho phép dùng micro' : 'Không nhận được giọng nói (' + err.message + ')');
        } finally { mic.classList.remove('rec'); }
      });

      // --- lặp lại ---
      const rep = $(sh, '#tf-rep');
      if (rep) {
        const upd = () => { $(sh, '#tf-auto-wrap').hidden = rep.value === 'none'; };
        rep.addEventListener('change', upd); upd();
      }

      // --- lưu ---
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = parseAmount(amtIn.value);
        if (!(amount > 0)) { amtIn.focus(); return toast('Nhập số tiền hợp lệ'); }
        const currency = curCode();
        const rate = S.rateOf(currency);
        const amountVnd = Math.round(amount * rate);
        const accountId = $(sh, '#tf-acc').value;
        const toAccountId = f.type === 'transfer' ? $(sh, '#tf-to').value : null;
        if (f.type === 'transfer' && accountId === toAccountId) return toast('Ví nguồn và ví đích phải khác nhau');
        let splits = null;
        if (f.type !== 'transfer' && $(sh, '#tf-split').checked) {
          splits = splitRows.map((r) => ({ categoryId: r.categoryId, amountVnd: Math.round((parseAmount(r.amount) || 0) * rate) })).filter((r) => r.amountVnd > 0);
          const sum = splits.reduce((s, r) => s + r.amountVnd, 0);
          if (Math.abs(sum - amountVnd) > splits.length) return toast('Tổng các dòng phải bằng số tiền giao dịch');
          if (splits.length < 2) splits = null;
          else splits[splits.length - 1].amountVnd += amountVnd - sum; // bù sai số làm tròn
        }
        if (f.type !== 'transfer' && !splits && !f.categoryId) return toast('Chọn danh mục');

        for (const id of removed) await S.deletePhoto(id);
        const photoIds = [...keepPhotos];
        for (const p of added) photoIds.push(await S.savePhoto(p.blob));

        const date = $(sh, '#tf-date').value || todayISO();
        const obj = {
          ...f, amount, currency, rate, amountVnd, date, accountId, toAccountId,
          categoryId: f.type === 'transfer' ? null : splits ? splits[0].categoryId : f.categoryId,
          splits, note: $(sh, '#tf-note').value.trim(), tags: splitTags(tagIn.value), photoIds,
          createdAt: f.createdAt || Date.now(),
        };
        if (fromRecurring) obj.recurringId = fromRecurring.id;

        const repVal = rep ? rep.value : 'none';
        if (repVal !== 'none') {
          const r = {
            template: { type: obj.type, amount, currency, categoryId: obj.categoryId, accountId, toAccountId, note: obj.note, tags: obj.tags, splits },
            freq: repVal, interval: 1, anchorDay: Number(date.slice(8)), startDate: date,
            nextDate: nextDate(date, repVal, 1, Number(date.slice(8))), endDate: null,
            autoAdd: $(sh, '#tf-auto').checked, remindDays: obj.type === 'expense' ? Number(st.remindDays) || 0 : 0, active: true,
          };
          await S.put('recurring', r, { silent: true });
          obj.recurringId = r.id;
        }
        await S.put('transactions', obj, { silent: true });
        if (fromRecurring) { S.advanceRecurring(fromRecurring); await S.put('recurring', fromRecurring, { silent: true }); }
        if (obj.type !== 'transfer') await S.setSetting('lastCat', { ...st.lastCat, [obj.type]: f.categoryId }, { silent: true });
        await S.setSetting('lastAccount', accountId, { silent: true });
        if (repVal !== 'none') await S.processRecurring();
        S.emit();
        close();
        toast(isEdit ? 'Đã cập nhật' : 'Đã lưu ' + (obj.type === 'expense' ? 'khoản chi ' : obj.type === 'income' ? 'khoản thu ' : '') + fmt(amountVnd));
        if (obj.type === 'expense') budgetWarn(obj);
      });

      $(sh, '#tf-del')?.addEventListener('click', async () => {
        if (!confirm('Xóa giao dịch này?')) return;
        await S.deleteTx(tx);
        close(); toast('Đã xóa');
      });
      $(sh, '#tf-dup')?.addEventListener('click', () => {
        close();
        const { id, photoIds, recurringId, debtId, createdAt, updatedAt, ...rest } = tx;
        openTxForm({ preset: { ...rest, date: todayISO(), photoIds: [] }, type: tx.type });
      });
      $(sh, '#tf-skip')?.addEventListener('click', async () => {
        S.advanceRecurring(fromRecurring);
        await S.put('recurring', fromRecurring);
        close(); toast('Đã bỏ qua kỳ này');
      });

      updType();
      updHint();
      if (!isEdit && !f.amount) setTimeout(() => amtIn.focus(), 250);
    },
  });
}

function budgetWarn(tx) {
  const cats = new Set(S.txParts(tx).map((p) => p.categoryId));
  for (const b of state.budgets) {
    if (b.categoryId !== '__all' && !cats.has(b.categoryId)) continue;
    const st = S.budgetStatus(b, tx.date);
    if (tx.date < st.range.start || tx.date > st.range.end) continue;
    if (st.ratio >= 1) return setTimeout(() => toast(`⛔ Vượt ngân sách "${S.budgetName(b)}" ${fmt(-st.left)}`, 3500), 2500);
    if (st.ratio >= 0.8) return setTimeout(() => toast(`⚠️ "${S.budgetName(b)}" đã dùng ${Math.round(st.ratio * 100)}%`, 3500), 2500);
  }
}

function viewImage(src) {
  openSheet({ title: 'Ảnh hóa đơn', body: `<img src="${src}" class="full-img" alt="">`, wide: true });
}

actions.add = (el) => openTxForm({ type: el.dataset.type || 'expense', repeat: el.dataset.repeat || 'none' });

// ================= Tóm tắt & chia sẻ =================
function summaryText(r) {
  const t = S.totals(r);
  const prev = getRange(r.type, shiftAnchor(r.type, r.start, -1), state.settings.weekStart);
  const pt = S.totals(prev);
  const top = S.byCategory(r, 'expense').slice(0, 5);
  const lines = [
    `📊 Tóm tắt thu chi – ${r.label}`,
    `• Thu: ${fmt(t.income)}`,
    `• Chi: ${fmt(t.expense)}${pt.expense ? ` (${pctChange(t.expense, pt.expense)})` : ''}`,
    `• Chênh lệch: ${fmtSigned(t.net)}`,
  ];
  if (top.length) {
    lines.push('', 'Chi nhiều nhất:');
    top.forEach((x, i) => lines.push(`${i + 1}. ${x.cat.icon} ${x.cat.name}: ${fmt(x.amount)}`));
  }
  const over = state.budgets.map((b) => ({ b, st: S.budgetStatus(b, r.end < todayISO() ? r.end : todayISO()) })).filter((x) => x.st.ratio >= 1);
  if (over.length) {
    lines.push('', 'Vượt ngân sách:');
    over.forEach(({ b, st }) => lines.push(`⛔ ${S.budgetName(b)}: ${fmt(st.spent)} / ${fmt(b.amount)}`));
  }
  const debts = state.debts.filter((d) => !d.done && diffDays(todayISO(), d.dueDate) <= 14);
  if (debts.length) {
    lines.push('', 'Sắp đến hạn trả nợ:');
    debts.forEach((d) => lines.push(`🏦 ${S.debtName(d)}: ${fmt(d.amount)} – ${fmtDate(d.dueDate)}`));
  }
  return lines.join('\n');
}

actions.summary = (el) => {
  const v = el.dataset.v;
  const today = todayISO();
  const ws = state.settings.weekStart;
  const r = v === 'prev-week' ? getRange('week', addDays(today, -7), ws)
    : v === 'prev-month' ? getRange('month', addMonths(today, -1, 1), ws) : currentRange();
  const text = summaryText(r);
  openSheet({
    title: 'Tóm tắt ' + r.label,
    body: `<pre class="summary">${esc(text)}</pre>
      <div class="actions"><button type="button" class="btn ghost" data-copy>📋 Sao chép</button><button type="button" class="btn primary" data-share>📤 Chia sẻ</button></div>
      <p class="muted small">Chia sẻ qua Zalo, Messenger, Email… hoặc lưu vào Ghi chú.</p>`,
    onMount(sh) {
      $(sh, '[data-copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(text); toast('Đã sao chép'); } catch { toast('Không sao chép được'); }
      });
      $(sh, '[data-share]').addEventListener('click', async () => {
        if (navigator.share) { try { await navigator.share({ title: 'Tóm tắt thu chi', text }); } catch { /* người dùng hủy */ } }
        else { try { await navigator.clipboard.writeText(text); toast('Thiết bị không hỗ trợ chia sẻ – đã sao chép'); } catch { toast('Không chia sẻ được'); } }
      });
    },
  });
};

// ================= Cài đặt =================
function settingsView() {
  const s = state.settings;
  const notifState = !('Notification' in window) ? 'unsupported' : Notification.permission;
  return `
  <header class="top"><div>${profileChip()}<h1>Cài đặt</h1></div></header>

  ${sectionTitle('Người dùng', `<button type="button" class="link" data-act="profiles">Quản lý</button>`)}
  <section class="card list">${S.getProfiles().map((p) => `
    <button type="button" class="row" data-act="profile-switch" data-id="${esc(p.id)}">
      <span class="ci" style="--c:${esc(p.color)}">${esc(p.icon)}</span><span class="grow"><b>${esc(p.name)}</b>
      <small>${p.id === S.currentProfile().id ? 'Đang dùng' : 'Bấm để chuyển sang'}</small></span>${p.id === S.currentProfile().id ? '<span class="income">✓</span>' : '›'}</button>`).join('')}
  </section>
  <p class="muted small">Mỗi người có sổ riêng: ví, giao dịch, ngân sách, mục tiêu, trả nợ và cài đặt hoàn toàn tách biệt.</p>

  ${sectionTitle('Hiển thị')}
  <section class="card form">
    ${field('Kỳ xem mặc định', `<select data-set="period">${['month', 'year'].map((p) => `<option value="${p}" ${s.period === p ? 'selected' : ''}>${PERIOD_LABEL[p]}</option>`).join('')}</select>`)}
  </section>

  ${sectionTitle('Dữ liệu nền')}
  <section class="card list">
    <button type="button" class="row" data-act="accounts"><span class="ci">👛</span><span class="grow"><b>Ví & tài khoản</b><small>${S.activeAccounts().length} ví</small></span>›</button>
    <button type="button" class="row" data-act="categories"><span class="ci">🗂️</span><span class="grow"><b>Danh mục thu chi</b><small>${state.categories.filter((c) => !c.archived).length} danh mục</small></span>›</button>
    <button type="button" class="row" data-act="currencies"><span class="ci">💱</span><span class="grow"><b>Tiền tệ & tỷ giá</b><small>${s.currencies.map((c) => c.code).join(', ')}</small></span>›</button>
  </section>

  ${sectionTitle('Phân bổ thu nhập & quỹ dự phòng')}
  <section class="card form">
    ${field('Phương pháp', `<select data-set="method"><option value="none" ${s.method === 'none' ? 'selected' : ''}>Không dùng</option>${Object.entries(S.METHODS).map(([k, m]) => `<option value="${k}" ${s.method === k ? 'selected' : ''}>${m.name}</option>`).join('')}</select>`)}
    ${field('Thu nhập dự kiến/tháng (dùng khi chưa ghi khoản thu)', `<input class="money" inputmode="decimal" data-set="expectedIncome" data-money value="${s.expectedIncome ? fmtNum(s.expectedIncome) : ''}" placeholder="vd: 15tr">`)}
    ${field('Quỹ dự phòng = số tháng chi tiêu', `<select data-set="emergencyMonths" data-num>${[3, 4, 6, 9, 12].map((n) => `<option value="${n}" ${Number(s.emergencyMonths) === n ? 'selected' : ''}>${n} tháng</option>`).join('')}</select>`)}
    <p class="muted small">Gán nhóm 50/30/20 hoặc lọ JARS cho từng danh mục trong "Danh mục thu chi".</p>
  </section>

  ${sectionTitle('Nhắc nhở')}
  <section class="card form">
    ${field('Nhắc trước hạn trả nợ / hóa đơn (ngày)', `<input type="number" min="0" max="30" data-set="remindDays" data-num value="${esc(s.remindDays)}">`)}
    <div class="row-between"><span>Thông báo khi mở app<br><small class="muted">${notifState === 'unsupported' ? 'Thiết bị/trình duyệt chưa hỗ trợ. Trên iPhone cần iOS 16.4+ và mở app từ màn hình chính.' : notifState === 'granted' ? 'Đã cho phép' : notifState === 'denied' ? 'Đã bị chặn – bật lại trong Cài đặt của điện thoại' : 'Chưa cấp quyền'}</small></span>
      ${notifState === 'unsupported' ? '' : `<label class="switch"><input type="checkbox" data-act-change="notify" ${s.notify && notifState === 'granted' ? 'checked' : ''}><i></i></label>`}</div>
    <div class="two">${field('Nhắc ghi chép hằng ngày lúc', `<input type="time" data-set="dailyTime" value="${esc(s.dailyTime)}">`)}
      <button type="button" class="btn ghost" data-act="daily-ics" style="align-self:end">📅 Thêm vào Lịch</button></div>
    <p class="muted small">💡 Web app không tự đặt chuông khi đang đóng. Để nhắc chắc chắn, hãy thêm hạn trả nợ và nhắc ghi chép vào <b>app Lịch</b> của điện thoại. App Lịch sẽ báo cả khi offline.</p>
  </section>

  ${sectionTitle('Sao lưu & dữ liệu')}
  <section class="card list">
    <button type="button" class="row" data-act="backup"><span class="ci">💾</span><span class="grow"><b>Sao lưu (file .json)</b><small>${s.lastBackup ? 'Lần cuối: ' + fmtDate(s.lastBackup) : 'Chưa sao lưu lần nào'}</small></span>›</button>
    <label class="row"><span class="ci">♻️</span><span class="grow"><b>Khôi phục từ bản sao lưu</b><small>Thay thế toàn bộ dữ liệu hiện tại</small></span>›<input type="file" accept=".json,application/json" data-act-change="restore" hidden></label>
    <button type="button" class="row" data-act="export-csv-all"><span class="ci">📄</span><span class="grow"><b>Xuất Excel (CSV) toàn bộ giao dịch</b></span>›</button>
    <button type="button" class="row danger" data-act="wipe"><span class="ci">🗑️</span><span class="grow"><b>Xóa toàn bộ dữ liệu của ${esc(S.currentProfile().name)}</b><small>Sổ của người khác giữ nguyên</small></span></button>
  </section>
  ${s.lastBackup && diffDays(s.lastBackup, todayISO()) < 30 ? '' : '<p class="muted small center">⚠️ Dữ liệu chỉ nằm trên máy này. Nên sao lưu định kỳ (lưu vào iCloud Drive / Google Drive / Zalo "Cloud của tôi").</p>'}
  <p class="muted small center" id="storage-info"></p>
  <p class="muted small center">Sổ Thu Chi · chạy offline · dữ liệu không rời khỏi điện thoại của bạn</p>`;
}

async function mountSettings(root) {
  root.querySelectorAll('[data-set]').forEach((el) => {
    el.addEventListener('change', async () => {
      let v = el.value;
      if (el.hasAttribute('data-num')) v = Number(v);
      if (el.hasAttribute('data-money')) {
        v = el.value.trim() ? Math.round(parseAmount(el.value)) : 0;
        if (!Number.isFinite(v)) return toast('Số tiền chưa hợp lệ');
      }
      await S.setSetting(el.dataset.set, v);
      if (el.dataset.set === 'period' && ui.period) ui.period.type = v;
      toast('Đã lưu');
    });
  });
  root.querySelector('[data-act-change="notify"]')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const p = await Notification.requestPermission();
      await S.setSetting('notify', p === 'granted');
      if (p !== 'granted') toast('Bạn chưa cho phép thông báo');
    } else await S.setSetting('notify', false);
  });
  root.querySelector('[data-act-change="restore"]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm(`Khôi phục sẽ THAY THẾ toàn bộ dữ liệu trong sổ của "${S.currentProfile().name}". Sổ của người khác không bị ảnh hưởng. Tiếp tục?`)) return;
    try {
      await S.importData(JSON.parse(await file.text()));
      ui.period = null;
      toast('Đã khôi phục dữ liệu');
    } catch (err) { toast('Lỗi: ' + err.message, 4000); }
  });
  if (navigator.storage?.estimate) {
    const { usage } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const el = root.querySelector('#storage-info');
    if (el) el.textContent = `Dung lượng đang dùng: ${(usage / 1048576).toFixed(1)} MB${persisted ? ' · lưu trữ bền vững ✓' : ''}`;
  }
}

actions['daily-ics'] = () => calendarSheet('nhac-ghi-chep.ics', buildDailyICS(state.settings.dailyTime || '21:00', todayISO()));

actions.backup = async () => {
  const data = await S.exportData();
  const who = S.currentProfile().name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^\w]+/g, '-').toLowerCase();
  await shareOrDownload(`sothuchi-${who}-${todayISO()}.json`, JSON.stringify(data), 'application/json');
  await S.setSetting('lastBackup', todayISO());
};

function csvOf(list) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Ngày', 'Loại', 'Số tiền (VND)', 'Tiền tệ', 'Số tiền gốc', 'Danh mục', 'Ví', 'Đến ví', 'Ghi chú', 'Tag'];
  const rows = sortTx([...list]).reverse().map((t) => [
    t.date, TYPE_LABEL[t.type], t.type === 'expense' ? -t.amountVnd : t.amountVnd, t.currency || 'VND', t.amount,
    S.txParts(t).map((p) => (S.catById(p.categoryId)?.name || '') + (S.txParts(t).length > 1 ? ` (${p.amountVnd})` : '')).join(' + '),
    accName(t.accountId), t.toAccountId ? accName(t.toAccountId) : '', t.note, (t.tags || []).join(', '),
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}
actions['export-csv'] = () => shareOrDownload(`giao-dich-${currentRange().start}.csv`, csvOf(filteredTx()), 'text/csv');
actions['export-csv-all'] = () => shareOrDownload(`giao-dich-tat-ca-${todayISO()}.csv`, csvOf(state.transactions), 'text/csv');

actions.wipe = async () => {
  if (!confirm(`Xóa TOÀN BỘ dữ liệu trong sổ của "${S.currentProfile().name}"? Không thể hoàn tác. Hãy sao lưu trước!`)) return;
  if (prompt('Gõ XOA để xác nhận') !== 'XOA') return;
  await S.wipeAll();
  ui.period = null;
  toast('Đã xóa toàn bộ dữ liệu');
};

// ----- Ví -----
actions.accounts = () => {
  const render = () => `<div class="list">${state.accounts.sort((a, b) => (a.archived - b.archived) || (a.order ?? 0) - (b.order ?? 0)).map((a) => `
    <button type="button" class="row ${a.archived ? 'off' : ''}" data-acc="${a.id}"><span class="ci">${esc(a.icon)}</span>
    <span class="grow"><b>${esc(a.name)}</b><small>${KIND_LABEL[a.kind] || ''}${a.archived ? ' · đã ẩn' : ''}</small></span><span class="amt">${fmt(S.accountBalance(a))}</span></button>`).join('')}</div>
    <button type="button" class="btn primary block" data-acc="">+ Thêm ví</button>`;
  openSheet({
    title: 'Ví & tài khoản', body: render(),
    onMount(sh, close) {
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('[data-acc]');
        if (b) { close(); accountForm(state.accounts.find((a) => a.id === b.dataset.acc)); }
      });
    },
  });
};

function accountForm(a) {
  const f = a ? { ...a } : { name: '', icon: '💳', kind: 'bank', initial: 0, order: state.accounts.length };
  const used = a && state.transactions.some((t) => t.accountId === a.id || t.toAccountId === a.id);
  openSheet({
    title: a ? 'Sửa ví' : 'Thêm ví',
    body: `<form class="form">
      <div class="two">${field('Biểu tượng', `<input id="af-icon" maxlength="4" class="emoji" value="${esc(f.icon)}">`)}
      ${field('Tên ví', `<input id="af-name" required value="${esc(f.name)}" placeholder="vd: Techcombank, MoMo">`, 'style="flex:3"')}</div>
      ${field('Loại', `<select id="af-kind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
      ${amountField('af-init', f.initial, 'Số dư ban đầu (thẻ tín dụng đang nợ thì nhập số âm, vd: -2tr)')}
      <div class="actions">${a ? `<button type="button" class="btn danger" data-del>${used ? (a.archived ? 'Hiện lại' : 'Ẩn ví') : 'Xóa'}</button>` : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      const init = bindMoney(sh, 'af-init');
      if (f.initial < 0) init.value = '-' + fmtNum(-f.initial);
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = init.value.trim() ? readMoney(init.value) : 0;
        if (!Number.isFinite(v)) return toast('Số dư chưa hợp lệ');
        await S.put('accounts', { ...f, name: $(sh, '#af-name').value.trim(), icon: $(sh, '#af-icon').value.trim() || '💳', kind: $(sh, '#af-kind').value, initial: Math.round(v) });
        close(); toast('Đã lưu ví');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (used) { await S.put('accounts', { ...a, archived: !a.archived }); close(); return; }
        if (S.activeAccounts().length <= 1) return toast('Cần giữ ít nhất 1 ví');
        if (!confirm('Xóa ví này?')) return;
        await S.remove('accounts', a.id); close();
      });
    },
  });
}

// ----- Danh mục -----
actions.categories = () => {
  let tab = 'expense';
  const render = () => `<div class="seg small">${['expense', 'income'].map((t) => `<button type="button" data-tab="${t}" class="${tab === t ? 'on' : ''}">${TYPE_LABEL[t]}</button>`).join('')}</div>
    <div class="list">${state.categories.filter((c) => c.type === tab).sort((a, b) => (!!a.archived - !!b.archived) || (a.order ?? 0) - (b.order ?? 0)).map((c) => {
      const m = S.METHODS[state.settings.method];
      const grp = m && tab === 'expense' ? m.groups.find((g) => g.key === c[m.field])?.name || 'Chưa gán nhóm' : '';
      return `<button type="button" class="row ${c.archived ? 'off' : ''}" data-cat="${c.id}">${catIcon(c)}<span class="grow"><b>${esc(c.name)}</b><small>${esc(grp)}${c.archived ? ' · đã ẩn' : ''}</small></span>›</button>`;
    }).join('')}</div>
    <button type="button" class="btn primary block" data-cat="">+ Thêm danh mục</button>`;
  openSheet({
    title: 'Danh mục', body: `<div id="cat-mgr">${render()}</div>`,
    onMount(sh, close) {
      const box = $(sh, '#cat-mgr');
      box.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; box.innerHTML = render(); return; }
        const b = e.target.closest('[data-cat]');
        if (b) { close(); categoryForm(state.categories.find((c) => c.id === b.dataset.cat), tab); }
      });
    },
  });
};

function categoryForm(c, type) {
  const f = c ? { ...c } : { type, name: '', icon: '🏷️', color: S.PALETTE[state.categories.length % S.PALETTE.length], rule: 'wants', jar: 'PLAY', order: state.categories.length };
  const used = c && state.transactions.some((t) => S.txParts(t).some((p) => p.categoryId === c.id));
  const grpSelect = (m, key, val) => `<select id="cf-${key}">${S.METHODS[m].groups.map((g) => `<option value="${g.key}" ${val === g.key ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`;
  openSheet({
    title: c ? 'Sửa danh mục' : 'Thêm danh mục',
    body: `<form class="form">
      <div class="two">${field('Biểu tượng', `<input id="cf-icon" maxlength="4" class="emoji" value="${esc(f.icon)}">`)}
      ${field('Tên', `<input id="cf-name" required value="${esc(f.name)}">`, 'style="flex:3"')}</div>
      <div class="field"><span>Màu</span><div class="colors">${S.PALETTE.map((col) => `<button type="button" class="color ${col === f.color ? 'on' : ''}" data-color="${col}" style="--c:${col}" aria-label="${col}"></button>`).join('')}</div></div>
      ${f.type === 'expense' ? `<div class="two">${field('Nhóm 50/30/20', grpSelect('503020', 'rule', f.rule))}${field('Lọ JARS', grpSelect('jars', 'jar', f.jar))}</div>` : ''}
      <div class="actions">${c && !c.sys ? `<button type="button" class="btn danger" data-del>${used ? (c.archived ? 'Hiện lại' : 'Ẩn') : 'Xóa'}</button>` : ''}<button class="btn primary">Lưu</button></div>
    </form>`,
    onMount(sh, close) {
      $(sh, '.colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        f.color = b.dataset.color;
        sh.querySelectorAll('.color').forEach((x) => x.classList.toggle('on', x === b));
      });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await S.put('categories', { ...f, name: $(sh, '#cf-name').value.trim(), icon: $(sh, '#cf-icon').value.trim() || '🏷️', rule: $(sh, '#cf-rule')?.value || f.rule, jar: $(sh, '#cf-jar')?.value || f.jar });
        close(); toast('Đã lưu danh mục');
      });
      $(sh, '[data-del]')?.addEventListener('click', async () => {
        if (used) { await S.put('categories', { ...c, archived: !c.archived }); close(); return; }
        if (!confirm('Xóa danh mục này?')) return;
        await S.remove('categories', c.id); close();
      });
    },
  });
}

// ----- Tiền tệ -----
actions.currencies = () => {
  const list = state.settings.currencies.map((c) => ({ ...c }));
  const render = () => list.map((c, i) => `<div class="split-row"><input value="${esc(c.code)}" data-i="${i}" data-k="code" maxlength="5" ${c.code === 'VND' ? 'disabled' : ''} style="flex:0 0 80px">
    <input inputmode="decimal" value="${c.code === 'VND' ? 1 : fmtNum(c.rate)}" data-i="${i}" data-k="rate" ${c.code === 'VND' ? 'disabled' : ''} placeholder="Tỷ giá ra VND">
    ${c.code === 'VND' ? '<span class="icon-btn"></span>' : `<button type="button" class="icon-btn" data-rm="${i}">✕</button>`}</div>`).join('');
  openSheet({
    title: 'Tiền tệ & tỷ giá',
    body: `<form class="form"><p class="muted small">Tỷ giá tự nhập (1 đơn vị = ? VND). App chạy offline nên không tự cập nhật tỷ giá. Giao dịch cũ giữ tỷ giá lúc ghi.</p>
      <div id="cur-list">${render()}</div>
      <button type="button" class="btn ghost small" data-add>+ Thêm tiền tệ</button>
      <div class="actions"><button class="btn primary">Lưu</button></div></form>`,
    onMount(sh, close) {
      const box = $(sh, '#cur-list');
      box.addEventListener('input', (e) => {
        const i = e.target.dataset.i;
        if (i == null) return;
        if (e.target.dataset.k === 'code') list[i].code = e.target.value.toUpperCase().trim();
        else list[i].rate = parseAmount(e.target.value);
      });
      box.addEventListener('click', (e) => {
        if (e.target.dataset.rm != null) { list.splice(Number(e.target.dataset.rm), 1); box.innerHTML = render(); }
      });
      $(sh, '[data-add]').addEventListener('click', () => { list.push({ code: '', rate: 0 }); box.innerHTML = render(); });
      $(sh, 'form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const clean = list.filter((c) => c.code && c.rate > 0);
        if (!clean.some((c) => c.code === 'VND')) clean.unshift({ code: 'VND', rate: 1 });
        await S.setSetting('currencies', clean);
        close(); toast('Đã lưu tỷ giá');
      });
    },
  });
};

// ================= Điều hướng chung =================
actions['period-type'] = (el) => {
  const r = currentRange();
  const today = todayISO();
  // Chuyển sang xem theo ngày khi đang ở kỳ hiện tại → mở luôn ngày hôm nay.
  if (el.dataset.v === 'day' && today >= r.start && today <= r.end) ui.period.anchor = today;
  ui.period.type = el.dataset.v;
  refresh();
};
actions['period-shift'] = (el) => { currentRange(); ui.period.anchor = shiftAnchor(ui.period.type, ui.period.anchor, Number(el.dataset.v)); refresh(); };
actions['period-date'] = (el) => {
  if (!el.value) return;
  currentRange();
  ui.period.anchor = el.value;
  refresh();
};
actions['period-today'] = () => { currentRange(); ui.period.anchor = todayISO(); refresh(); };

const VIEWS = {
  home: { html: homeView },
  tx: { html: txView, mount: mountTx },
  reports: { html: reportsView },
  plan: { html: planView },
  settings: { html: settingsView, mount: mountSettings },
};

let current = { route: 'home', sub: null };

export function render(route, sub) {
  const sameView = current.route === route && current.sub === sub;
  current = { route: VIEWS[route] ? route : 'home', sub };
  const v = VIEWS[current.route];
  const main = document.getElementById('main');
  const y = window.scrollY;
  main.innerHTML = v.html(sub);
  v.mount && v.mount(main);
  window.scrollTo(0, sameView ? y : 0);
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === current.route));
}

export function refresh() {
  render(current.route, current.sub);
}
