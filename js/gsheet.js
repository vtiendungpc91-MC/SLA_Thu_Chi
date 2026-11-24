// Đồng bộ giao dịch lên Google Sheets qua Apps Script (v7.77).
// Cách làm: mỗi lần đồng bộ dựng lại toàn bộ dòng từ dữ liệu trên máy, so với "dấu" các dòng đã gửi lần trước
// (lưu ở localStorage) → chỉ gửi dòng mới/đổi (upsert) và mã đã mất (delete). Mất mạng thì lần sau gửi bù.
// Mục Secrecy không được gửi lên Sheet.
import * as S from './store.js';
import { writeHooks } from './db.js';
import { encryptBackup, decryptBackup, isEncryptedBackup } from './autosave.js';

const CFG_KEY = 'stc-gsheet';
const SENT_KEY = 'stc-gsheet-sent';
const ACC_SIG_KEY = 'stc-gsheet-acc';
const PLAN_SIG_KEY = 'stc-gsheet-plan';
const STATUS_KEY = 'stc-gsheet-status';
const BK_SIG_KEY = 'stc-gsheet-bk'; // dấu dữ liệu của bản sao lưu đã gửi lên trang SaoLuu
const BK_AT_KEY = 'stc-gsheet-bk-at';
const BK_GAP = 2 * 60 * 1000; // gửi bản sao lưu đầy đủ tối đa 2 phút/lần
const BK_PART = 45000; // mỗi ô Google Sheets chứa tối đa 50.000 ký tự
const CHUNK = 400;

const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export const gsConfig = () => ({ url: '', key: '', auto: true, ...(readJSON(CFG_KEY) || {}) });
export const gsReady = (c = gsConfig()) => /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(c.url) && !!c.key;
export const gsStatus = () => readJSON(STATUS_KEY) || null;
const statusListeners = new Set();
export const onGsStatus = (fn) => statusListeners.add(fn);
function setStatus(st) {
  writeJSON(STATUS_KEY, { ...(gsStatus() || {}), ...st });
  statusListeners.forEach((f) => { try { f(gsStatus()); } catch { /* bỏ qua */ } });
}

/** Lưu cấu hình. Đổi link hoặc mật khẩu → coi như Sheet mới, lần sau ghi lại toàn bộ. */
export function saveGsConfig(c) {
  const old = gsConfig();
  const next = { url: String(c.url || '').trim(), key: String(c.key || '').trim(), auto: c.auto !== false };
  writeJSON(CFG_KEY, next);
  if (old.url !== next.url || old.key !== next.key) { [SENT_KEY, ACC_SIG_KEY, PLAN_SIG_KEY, STATUS_KEY, BK_SIG_KEY, BK_AT_KEY].forEach((k) => localStorage.removeItem(k)); }
  return next;
}
export function clearGsConfig() {
  [CFG_KEY, SENT_KEY, ACC_SIG_KEY, PLAN_SIG_KEY, STATUS_KEY, BK_SIG_KEY, BK_AT_KEY].forEach((k) => localStorage.removeItem(k));
}

// ---------- Dựng dòng dữ liệu ----------
const clean = (s) => String(s ?? '').replace(/\S*⁣[A-Za-z0-9_-]*/g, '').replace(/\s+/g, ' ').trim();
const pad2 = (n) => String(n).padStart(2, '0');
const stamp = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const ACC_TYPE_LABEL = Object.fromEntries(S.ACC_TYPES.map(([k, label]) => [k, label]));
const AUTO_NOTE = /^(Chuyển (cho|đến) |Chuyển \(Nhận\) cho |Nhận (tiền chuyển )?từ |Thanh toán )/;

function peerName(g, profiles) {
  const p = profiles.find((x) => x.id === g.peer);
  if (p) return clean(S.bookLabelShort(p));
  const n = clean(g.peerName);
  return n.startsWith('Secrecy · ') || !n.includes(' · ') ? n : n.slice(n.indexOf(' · ') + 3);
}
function gopText(g, profiles) {
  const who = peerName(g, profiles);
  if (g.mode === 'pay') return g.dir === 'in' ? `Thanh toán từ ${who}` : `Thanh toán ${who}`;
  return g.dir === 'out' ? `Chuyển đến ${who}` : `Nhận từ ${who}`;
}

/** Số dư từng tài khoản trong mục (giống cách tính ở Tổng quan). */
function accBalance(b, a, txs) {
  if (S.kindOfBook(b) === 'card' && !b.credit) return -txs.reduce((s, t) => s + (t.status !== 'done' ? t.amountVnd || 0 : 0), 0);
  let v = Number(a.initial) || 0;
  for (const t of txs) {
    if (t.type === 'income') v += t.accountId === a.id ? t.amountVnd : 0;
    else if (t.type === 'expense') v -= t.accountId === a.id ? t.amountVnd : 0;
    else v += (t.toAccountId === a.id ? t.amountVnd : 0) - (t.accountId === a.id ? t.amountVnd : 0);
  }
  return v;
}

export async function buildRows() {
  const profiles = S.getProfiles();
  const users = S.getUsers();
  const gcats = S.globalCats();
  const rows = [], accounts = [];
  const now = stamp(Date.now());
  for (const b of profiles) {
    if (b.owner === S.SECRECY) continue;
    const [accs, txs, bcats] = await Promise.all([S.readBook(b.id, 'accounts'), S.readBook(b.id, 'transactions'), S.readBook(b.id, 'categories')]);
    const user = clean(users.find((u) => u.id === b.owner)?.name || '');
    const bank = clean(S.groupOf(b)?.name || '');
    const many = accs.filter((a) => !a.archived).length > 1;
    const accName = (id) => { const a = accs.find((x) => x.id === id); return clean(b.name) + (many && a ? ' · ' + clean(a.name) : ''); };
    const catName = (id) => clean((bcats.find((c) => c.id === id) || gcats.find((c) => c.id === id))?.name || '');
    for (const t of txs) {
      const amt = Number(t.amountVnd) || 0;
      let loai, cat, note = clean(t.note), peer = '';
      if (t.gop) {
        loai = t.gop.dir === 'out' ? 'Chuyển đi' : 'Nhận về';
        cat = clean(S.flowCatById(t.gop.flowCat)?.name || '') || 'Chuyển';
        peer = gopText(t.gop, profiles);
        if (AUTO_NOTE.test(note)) note = '';
      } else if (t.type === 'transfer') {
        loai = 'Chuyển nội bộ';
        cat = '';
        peer = 'Chuyển đến ' + accName(t.toAccountId);
      } else {
        loai = t.type === 'income' ? 'Thu' : 'Chi';
        cat = t.splits && t.splits.length ? t.splits.map((p) => catName(p.categoryId)).filter(Boolean).join(', ') : catName(t.categoryId);
      }
      rows.push([
        String(t.id), t.date || '', stamp(t.createdAt), user, bank, accName(t.accountId), loai, cat, amt,
        t.type === 'income' ? amt : '', t.type === 'expense' ? amt : '', note, peer, b.id, stamp(t.updatedAt || t.createdAt),
      ]);
    }
    for (const a of accs) {
      if (a.archived) continue;
      const tp = S.accTypeOf(b);
      accounts.push([b.id, user, bank, accName(a.id), ACC_TYPE_LABEL[tp] || clean(b.name), accBalance(b, a, txs), now]);
    }
  }
  rows.sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : x[2] < y[2] ? -1 : 1));
  // Chữ bắt đầu bằng = + - @ thì Sheet hiểu là công thức → thêm dấu ' để giữ nguyên là chữ.
  const safe = (r) => r.map((v, i) => (i > 2 && typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v));
  return { rows: rows.map(safe), accounts: accounts.map(safe) };
}

/**
 * Trang KeHoach (v7.78): Ngân sách, Mục tiêu, Trả nợ, Định kỳ, Nhắc nhở, Chuyến đi, Chia nhóm — mỗi khoản 1 dòng.
 * Cột: Loại | Tên | Số tiền | Đã có / Đã trả | Ngày / Hạn | Lặp lại | Trạng thái | Tài khoản | Ghi chú | Chi tiết | ID | Cập nhật lúc
 */
export const PLAN_HEADERS = ['Loại', 'Tên', 'Số tiền', 'Đã có / Đã trả', 'Ngày / Hạn', 'Lặp lại', 'Trạng thái', 'Tài khoản', 'Ghi chú', 'Chi tiết', 'ID', 'Cập nhật lúc'];
const PER = { day: 'Ngày', week: 'Tuần', month: 'Tháng', quarter: 'Quý', year: 'Năm' };
const FREQ = { day: 'ngày', week: 'tuần', month: 'tháng', year: 'năm' };
const money = (n) => (Number(n) || 0).toLocaleString('vi-VN');

export async function buildPlanRows() {
  const profiles = S.getProfiles().filter((b) => b.owner !== S.SECRECY);
  const gcats = S.globalCats();
  const rows = [];
  const add = (r) => rows.push(r.map((v) => (v == null ? '' : v)));
  for (const b of profiles) {
    const [accs, bcats, budgets, goals, debts, recs] = await Promise.all(['accounts', 'categories', 'budgets', 'goals', 'debts', 'recurring'].map((s) => S.readBook(b.id, s)));
    const label = clean(S.bookLabelShort(b));
    const catName = (id) => (id === '__all' ? 'Tổng chi tiêu' : clean((bcats.find((c) => c.id === id) || gcats.find((c) => c.id === id))?.name || ''));
    const accName = (id) => { const a = accs.find((x) => x.id === id); return label + (a && accs.filter((x) => !x.archived).length > 1 ? ' · ' + clean(a.name) : ''); };
    for (const x of budgets) add(['Ngân sách', catName(x.categoryId) || 'Danh mục đã xóa', x.amount, '', '', 'Mỗi ' + (PER[x.period] || 'Tháng').toLowerCase(), '', label, '', '', x.id]);
    for (const x of goals) {
      const done = (Number(x.saved) || 0) >= (Number(x.target) || 0) && x.target > 0;
      add(['Mục tiêu', clean(x.name), x.target, x.saved || 0, x.deadline, '', done ? 'Đã đạt' : x.target ? `Còn ${money(Math.max(0, x.target - (x.saved || 0)))}` : '', label, '', x.isEmergency ? 'Quỹ dự phòng khẩn cấp' : '', x.id]);
    }
    for (const x of debts) {
      const paid = (x.history || []).reduce((s, h) => s + (Number(h.amount) || 0), 0);
      add(['Trả nợ', clean(S.debtName(x)), x.amount, paid, x.dueDate, x.repeat === 'monthly' ? 'Hằng tháng' + (x.periodsLeft != null ? ` · còn ${x.periodsLeft} kỳ` : '') : 'Một lần',
        x.done ? 'Đã xong' : 'Chưa trả kỳ này', accName(x.accountId), clean(x.note), clean(x.method) + (x.remindDays ? ` · nhắc trước ${x.remindDays} ngày` : ''), x.id]);
    }
    for (const x of recs) {
      const tp = x.template || {};
      const kind = tp.type === 'income' ? 'Thu' : tp.type === 'transfer' ? 'Chuyển' : 'Chi';
      add(['Định kỳ', clean(tp.note) || catName(tp.categoryId) || kind, tp.amountVnd || tp.amount, '', x.nextDate,
        (x.interval > 1 ? `Mỗi ${x.interval} ${FREQ[x.freq] || ''}` : 'Hằng ' + (FREQ[x.freq] || 'tháng')) + (x.endDate ? ` · đến ${x.endDate}` : ''),
        x.active === false ? 'Tạm dừng' : 'Đang chạy', accName(tp.accountId), '', `${kind} · ${catName(tp.categoryId)}${x.autoAdd ? ' · tự ghi' : ''}`, x.id]);
    }
  }
  for (const u of S.getUsers()) {
    for (const x of u.reminders || []) {
      const unit = { day: 'ngày', week: 'tuần', month: 'tháng' }[x.repeat];
      add(['Nhắc nhở', clean(x.title), x.amount || '', '', x.date, unit ? 'Hằng ' + unit : 'Một lần', '', clean(u.name), clean(x.note), x.remindDays ? `Nhắc trước ${x.remindDays} ngày${x.time ? ' lúc ' + x.time : ''}` : x.time ? 'Lúc ' + x.time : '', x.id]);
    }
  }
  for (const x of S.trips()) add(['Chuyến đi', clean(x.name), '', '', `${x.start} → ${x.end}`, '', '', '', '', '', x.id]);
  for (const g of S.splitGroups()) {
    const open = g.people.filter((p) => !p.paid && !p.skipped);
    const got = g.people.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0);
    add(['Chia nhóm', clean(g.title), g.total, got, g.date, '', open.length ? `Còn ${open.length} người chưa trả` : 'Đã xong', '', '',
      g.people.map((p) => `${clean(p.name)}: ${money(p.amount)}${p.paid ? ' ✓' : p.skipped ? ' (bỏ qua)' : ''}`).join(' · '), g.id]);
  }
  const now = stamp(Date.now());
  const safe = (r) => r.map((v, i) => (typeof v === 'string' && i !== 4 && /^[=+\-@]/.test(v) ? "'" + v : v));
  return rows.map((r) => safe([...r, now]));
}

// Dấu ngắn của 1 dòng (để biết dòng nào đã đổi mà không phải lưu cả dòng).
function sig(arr) {
  const s = JSON.stringify(arr);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------- Gửi lên ----------
// Phiên bản Apps Script (lần trả lời gần nhất): 2 = có KeHoach, 3 = có SaoLuu an toàn.
let scriptV = -1;
async function post(body, cfg) {
  // text/plain: không cần hỏi trước CORS, Apps Script vẫn đọc được e.postData.contents.
  const res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ key: cfg.key, ...body }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
  let out;
  try { out = await res.json(); } catch { throw new Error('Link không trả về dữ liệu đúng — kiểm tra lại link ứng dụng web (phải kết thúc bằng /exec, quyền truy cập "Bất kỳ ai")'); }
  scriptV = Number(out.v) || 0;
  if (!out.ok) throw new Error(out.error || 'Google Sheets báo lỗi');
  return out;
}

/** Kiểm tra link + mật khẩu (gửi lệnh rỗng). */
export async function gsTest(cfg = gsConfig()) {
  if (!gsReady(cfg)) throw new Error('Chưa nhập đúng link ứng dụng web hoặc mật khẩu');
  return post({ action: 'ping' }, cfg);
}

/** Số giao dịch đang có trên Sheet và Sheet đã có bản sao lưu chưa (dùng khi cài trên máy mới). */
export async function gsPeek(cfg) {
  const r = await gsTest(cfg);
  if ((r.v || 0) < 3) return { rows: r.rows || 0, backup: false, oldScript: true };
  const b = await post({ action: 'backupGet' }, cfg);
  return { rows: r.rows || 0, backup: !!b.data, backupAt: b.at || null, size: (b.data || '').length, data: b.data || '' };
}

/** Tải bản sao lưu trên Sheet về và giải mã (chưa ghi vào máy). */
export async function gsFetchBackup(cfg, peek = null) {
  const p = peek || await gsPeek(cfg);
  if (p.oldScript) throw new Error('Apps Script là bản cũ — dán lại mã mới và triển khai phiên bản mới');
  if (!p.data) throw new Error('Trên Sheet chưa có bản sao lưu. Ở máy cũ, mở app (bản mới) và bấm "Đẩy toàn bộ lên Sheet" trước');
  let file;
  try { file = JSON.parse(p.data); } catch { throw new Error('Bản sao lưu trên Sheet bị lỗi (có thể đã bị sửa tay trang SaoLuu)'); }
  const data = isEncryptedBackup(file) ? await decryptBackup(file, cfg.key) : file;
  if (!data || data.app !== 'sothuchi' || !data.all) throw new Error('Bản sao lưu trên Sheet không đúng định dạng');
  return data;
}

/** Sau khi khôi phục từ Sheet: lưu cấu hình, đánh dấu dữ liệu hiện tại = bản trên Sheet (không gửi lại sao lưu ngay). */
export async function gsAfterRestore(cfg) {
  saveGsConfig(cfg);
  [SENT_KEY, ACC_SIG_KEY, PLAN_SIG_KEY].forEach((k) => localStorage.removeItem(k));
  const data = await S.exportAll();
  localStorage.setItem(BK_SIG_KEY, sig([JSON.stringify({ ...data, exportedAt: 0 })]));
  localStorage.setItem(BK_AT_KEY, String(Date.now()));
}

let running = null, again = false, timer = null, paused = false;
/** Tạm dừng đồng bộ (đang khôi phục dữ liệu, tránh gửi dữ liệu dở dang lên Sheet). */
export const gsPause = (on) => { paused = !!on; if (on) clearTimeout(timer); };

/**
 * Đồng bộ. full = true: ghi lại toàn bộ trang GiaoDich (nút "Đẩy toàn bộ").
 * Trả về { sent, removed, rows } hoặc ném lỗi.
 */
export async function gsSync({ full = false } = {}) {
  const cfg = gsConfig();
  if (!gsReady(cfg)) throw new Error('Chưa cài đặt Google Sheets');
  if (paused) throw new Error('Đang khôi phục dữ liệu');
  if (running) { again = again || !full; if (full) await running.catch(() => {}); else return running; }
  running = (async () => {
    if (!navigator.onLine) { setStatus({ pending: true, err: 'Đang mất mạng — sẽ gửi khi có mạng' }); throw new Error('Đang mất mạng'); }
    let oldScript = false;
    const { rows, accounts } = await buildRows();
    const accSig = sig(accounts.map((r) => r.slice(0, -1)));
    const plan = await buildPlanRows();
    const planSig = sig(plan.map((r) => r.slice(0, -1)));
    if (full || localStorage.getItem(PLAN_SIG_KEY) !== planSig) {
      const r = await post({ action: 'sheets', sheets: { KeHoach: { headers: PLAN_HEADERS, rows: plan } } }, cfg);
      // Apps Script bản cũ (chưa có trang KeHoach) không trả số v → vẫn gửi giao dịch, báo cần cập nhật mã.
      if ((r.v || 0) >= 2) localStorage.setItem(PLAN_SIG_KEY, planSig);
      else oldScript = true;
    }
    const prev = localStorage.getItem(SENT_KEY);
    let sent = full || prev === null ? null : (readJSON(SENT_KEY) || {});
    let result;
    if (!sent) {
      // Lần đầu (hoặc bấm Đẩy toàn bộ): xóa trang rồi ghi lại hết, chia nhiều lượt nếu nhiều dòng.
      const map = {};
      await post({ action: 'replaceAll', rows: rows.slice(0, CHUNK), accounts }, cfg);
      for (let i = CHUNK; i < rows.length; i += CHUNK) await post({ action: 'upsert', rows: rows.slice(i, i + CHUNK) }, cfg);
      rows.forEach((r) => { map[r[0]] = sig(r); });
      writeJSON(SENT_KEY, map);
      localStorage.setItem(ACC_SIG_KEY, accSig);
      result = { sent: rows.length, removed: 0, rows: rows.length, full: true };
    } else {
      const ids = new Set(rows.map((r) => r[0]));
      const changed = rows.filter((r) => sent[r[0]] !== sig(r));
      const removed = Object.keys(sent).filter((id) => !ids.has(id));
      const accDirty = localStorage.getItem(ACC_SIG_KEY) !== accSig;
      if (removed.length) {
        await post({ action: 'delete', ids: removed }, cfg);
        removed.forEach((id) => delete sent[id]);
        writeJSON(SENT_KEY, sent);
      }
      for (let i = 0; i < changed.length; i += CHUNK) {
        const part = changed.slice(i, i + CHUNK);
        const last = i + CHUNK >= changed.length;
        await post({ action: 'upsert', rows: part, ...(last && accDirty ? { accounts } : {}) }, cfg);
        part.forEach((r) => { sent[r[0]] = sig(r); });
        writeJSON(SENT_KEY, sent);
      }
      if (accDirty && !changed.length) await post({ action: 'upsert', rows: [], accounts }, cfg);
      if (accDirty) localStorage.setItem(ACC_SIG_KEY, accSig);
      result = { sent: changed.length, removed: removed.length, rows: rows.length, full: false };
    }
    // A1 (v7.80): bản sao lưu đầy đủ (mã hóa bằng mật khẩu SECRET) lên trang SaoLuu để tải về máy mới.
    let bkAt = Number(localStorage.getItem(BK_AT_KEY)) || 0;
    if (scriptV < 0) await post({ action: 'ping' }, cfg);
    if (scriptV < 3) oldScript = true;
    if (!oldScript) {
      const data = await S.exportAll();
      const bkSig = sig([JSON.stringify({ ...data, exportedAt: 0 })]);
      if (localStorage.getItem(BK_SIG_KEY) !== bkSig) {
        const wait = full ? 0 : bkAt + BK_GAP - Date.now();
        if (wait > 0) scheduleGsSync(wait + 500); // vừa gửi xong → hẹn lần sau, không gửi dồn
        else {
          const text = await encryptBackup(JSON.stringify(data), cfg.key);
          const parts = [];
          for (let i = 0; i < text.length; i += BK_PART) parts.push(text.slice(i, i + BK_PART));
          const r = await post({ action: 'backupPut', parts }, cfg);
          if (r.parts === parts.length) {
            bkAt = Date.now();
            localStorage.setItem(BK_SIG_KEY, bkSig);
            localStorage.setItem(BK_AT_KEY, String(bkAt));
          } else oldScript = true;
        }
      }
    }
    setStatus({ at: Date.now(), ok: true, err: '', pending: false, rows: rows.length, plan: plan.length, oldScript, bkAt: bkAt || null });
    return result;
  })();
  try { return await running; } catch (e) {
    if (navigator.onLine) setStatus({ ok: false, pending: true, err: e.message || String(e), errAt: Date.now() });
    throw e;
  } finally {
    running = null;
    if (again) { again = false; scheduleGsSync(1500); }
  }
}

/** Hẹn đồng bộ tự động sau ms (gộp nhiều lần ghi liên tiếp thành 1 lần gửi). */
export function scheduleGsSync(ms = 4000) {
  const cfg = gsConfig();
  if (!gsReady(cfg) || !cfg.auto || paused) return;
  clearTimeout(timer);
  timer = setTimeout(() => { gsSync().catch(() => {}); }, ms);
}

/** Gọi 1 lần khi mở app. */
export function initGsSync() {
  const watched = new Set(['transactions', 'accounts', 'budgets', 'goals', 'debts', 'recurring']);
  writeHooks.add((store) => { if (watched.has(store)) scheduleGsSync(); });
  // Nhắc nhở, Chuyến đi, Chia nhóm lưu ở localStorage → bắt theo sự kiện đổi dữ liệu chung của app.
  S.onChange(() => scheduleGsSync());
  window.addEventListener('online', () => scheduleGsSync(1000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleGsSync(3000); });
  scheduleGsSync(5000);
}
