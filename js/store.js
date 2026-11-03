// Trạng thái app + nghiệp vụ: số dư, tổng hợp, định kỳ, trả nợ, ngân sách, mục tiêu, sao lưu.
import { db, dbOf, STORES, useProfile, dropProfile } from './db.js';
import { uid, todayISO, addDays, addMonths, diffDays, getRange, nextDate, fmt } from './utils.js';

const LIST = STORES.filter((s) => s !== 'settings' && s !== 'photos');

export const state = { accounts: [], categories: [], transactions: [], recurring: [], budgets: [], goals: [], debts: [], settings: {} };

export const DEFAULT_SETTINGS = {
  period: 'month',
  weekStart: 1,
  method: 'none',
  expectedIncome: 0,
  remindDays: 3,
  notify: false,
  emergencyMonths: 6,
  dailyTime: '21:00',
  currencies: [{ code: 'VND', rate: 1 }, { code: 'USD', rate: 26000 }],
  lastCat: {},
  lastAccount: null,
  notified: {},
};

export const PALETTE = ['#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#0091ff', '#3e63dd', '#8e4ec6', '#d6409f', '#978365', '#6f6e77', '#0d74ce'];

export const METHODS = {
  '503020': {
    name: '50/30/20', field: 'rule',
    groups: [
      { key: 'needs', name: 'Thiết yếu', pct: 50 },
      { key: 'wants', name: 'Mong muốn', pct: 30 },
      { key: 'savings', name: 'Tiết kiệm & trả nợ', pct: 20 },
    ],
  },
  jars: {
    name: '6 chiếc lọ (JARS)', field: 'jar',
    groups: [
      { key: 'NEC', name: 'Thiết yếu (NEC)', pct: 55 },
      { key: 'FFA', name: 'Tự do tài chính (FFA)', pct: 10 },
      { key: 'LTSS', name: 'Tiết kiệm dài hạn (LTSS)', pct: 10 },
      { key: 'EDU', name: 'Giáo dục (EDU)', pct: 10 },
      { key: 'PLAY', name: 'Hưởng thụ (PLAY)', pct: 10 },
      { key: 'GIVE', name: 'Cho đi (GIVE)', pct: 5 },
    ],
  },
};

const SEED_EXPENSE = [
  ['Ăn uống', '🍜', 'needs', 'NEC'],
  ['Đi lại', '🛵', 'needs', 'NEC'],
  ['Nhà ở', '🏠', 'needs', 'NEC'],
  ['Điện nước & Internet', '💡', 'needs', 'NEC'],
  ['Sức khỏe', '💊', 'needs', 'NEC'],
  ['Gia đình & Con cái', '👨‍👩‍👧', 'needs', 'NEC'],
  ['Mua sắm', '🛍️', 'wants', 'PLAY'],
  ['Giải trí & Du lịch', '🎬', 'wants', 'PLAY'],
  ['Giáo dục', '📚', 'needs', 'EDU'],
  ['Hiếu hỉ & Quà tặng', '🎁', 'wants', 'GIVE'],
  ['Trả nợ ngân hàng', '🏦', 'savings', 'NEC', 'debt'],
  ['Tiết kiệm', '🐷', 'savings', 'LTSS', 'saving'],
  ['Đầu tư', '📈', 'savings', 'FFA'],
  ['Góp cho người nhà', '🤝', 'needs', 'NEC', 'gop-out'],
  ['Khác', '📦', 'wants', 'PLAY'],
];
const SEED_INCOME = [
  ['Lương', '💰'], ['Thưởng', '🎉'], ['Kinh doanh', '💼'], ['Lãi tiết kiệm/Đầu tư', '📈'], ['Được tặng', '🎁'],
  ['Nhận góp', '🤝', 'gop-in'], ['Thu khác', '➕'],
];
// Danh mục hệ thống cần có ở mọi sổ (kể cả sổ tạo từ bản cũ).
const SYS_CATS = {
  'gop-out': { type: 'expense', name: 'Góp cho người nhà', icon: '🤝', rule: 'needs', jar: 'NEC', color: '#12a594' },
  'gop-in': { type: 'income', name: 'Nhận góp', icon: '🤝', color: '#12a594' },
  'trich-in': { type: 'income', name: 'Trích từ người nhà', icon: '🔄', color: '#8e4ec6' },
  'trich-out': { type: 'expense', name: 'Bị trích cho người nhà', icon: '🔄', rule: 'needs', jar: 'NEC', color: '#8e4ec6' },
};

function seedRows() {
  return {
    cats: [
      ...SEED_EXPENSE.map(([name, icon, rule, jar, sys], i) => ({ id: uid(), type: 'expense', name, icon, rule, jar, sys: sys || null, color: PALETTE[i % PALETTE.length], order: i })),
      ...SEED_INCOME.map(([name, icon, sys], i) => ({ id: uid(), type: 'income', name, icon, sys: sys || null, color: PALETTE[(i + 3) % PALETTE.length], order: i })),
    ],
    accs: [
      { id: uid(), name: 'Tài khoản chính', bank: '', number: '', holder: '', icon: '🏦', kind: 'bank', initial: 0, order: 0 },
    ],
  };
}

/** Bổ sung danh mục hệ thống còn thiếu vào danh sách `cats` của một sổ; trả về các danh mục mới tạo. */
// Mục Đầu tư dùng danh sách danh mục ngắn riêng (3 chi, 3 thu).
const INVEST_CATS = [
  { invest: 'stock', type: 'expense', name: 'Chứng khoán', icon: '📈', color: '#3e63dd', rule: 'savings', jar: 'FFA' },
  { invest: 'saving', type: 'expense', name: 'Gửi tiết kiệm', icon: '🏦', color: '#12a594', rule: 'savings', jar: 'LTSS' },
  { invest: 'gold', type: 'expense', name: 'Vàng & khác', icon: '🥇', color: '#ffb224', rule: 'savings', jar: 'FFA' },
  { invest: 'profit', type: 'income', name: 'Lãi / Cổ tức', icon: '💹', color: '#30a46c' },
  { invest: 'sell', type: 'income', name: 'Bán / Tất toán', icon: '💰', color: '#0091ff' },
  { invest: 'capital', type: 'income', name: 'Nạp vốn', icon: '➕', color: '#8e4ec6' },
];
const missingInvestCats = (cats) => INVEST_CATS
  .filter((ic) => !cats.some((c) => c.invest === ic.invest))
  .map((ic, i) => ({ id: uid(), ...ic, order: i }));

function missingSysCats(cats) {
  return Object.entries(SYS_CATS)
    .filter(([sys]) => !cats.some((c) => c.sys === sys))
    .map(([sys, c]) => ({ id: uid(), ...c, sys, order: 99 }));
}

// ---------- Thông báo thay đổi ----------
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((f) => f());

// ---------- Người dùng & mục ----------
// Người dùng (tối đa 3) lưu ở "stc-users". Mỗi người dùng có nhiều MỤC (sổ) thuộc 3 loại:
// Ngân hàng, Đầu tư (sổ thu/chi có tài khoản) và Thẻ chi tiêu. Danh sách mục lưu ở "stc-profiles";
// mỗi mục có database riêng. "Profile" trong code = một mục.
const PROFILES_KEY = 'stc-profiles';
const USERS_KEY = 'stc-users';
const CURRENT_KEY = 'stc-current';
export const MAX_USERS = 3;
export const MAX_PER_KIND = 2; // mỗi người dùng: tối đa 2 mục cho mỗi loại (Ngân hàng / Đầu tư / Thẻ chi tiêu)
export const PROFILE_COLORS = ['#1f6feb', '#d6409f', '#30a46c', '#f76b15', '#8e4ec6', '#0d74ce'];
export const BOOK_KINDS = {
  bank: { label: 'Ngân hàng', icon: '🏦' },
  invest: { label: 'Đầu tư', icon: '📈' },
  card: { label: 'Thẻ chi tiêu', icon: '💳' },
};

const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const saveProfiles = (list) => localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
const saveUsers = (list) => localStorage.setItem(USERS_KEY, JSON.stringify(list));

/**
 * Chuyển dữ liệu bản cũ (mỗi hồ sơ là 1 người dùng, thẻ đứng riêng) sang mô hình người dùng → mục:
 * mỗi hồ sơ người dùng cũ thành 1 người dùng + mục "Ngân hàng" (giữ nguyên dữ liệu), thẻ cũ thuộc người dùng đầu tiên.
 */
function ensureModel() {
  let books = readJSON(PROFILES_KEY) || [];
  let users = readJSON(USERS_KEY);
  if (users && users.length && books.length) return;
  if (!books.length) books = [{ id: 'main', name: 'Tôi', icon: '🧑', color: PROFILE_COLORS[0] }];
  users = [];
  for (const b of books) {
    if (b.kind === 'card') continue;
    users.push({ id: b.id, name: b.name, icon: b.icon, color: b.color, photo: b.photo || null });
    Object.assign(b, { kind: 'bank', owner: b.id, name: BOOK_KINDS.bank.label, icon: BOOK_KINDS.bank.icon, photo: null });
  }
  if (!users.length) {
    const u = { id: 'main', name: 'Tôi', icon: '🧑', color: PROFILE_COLORS[0] };
    users.push(u);
    books.unshift({ id: 'main', name: BOOK_KINDS.bank.label, icon: BOOK_KINDS.bank.icon, color: u.color, kind: 'bank', owner: u.id });
  }
  for (const b of books) if (b.kind === 'card' && !b.owner) b.owner = users[0].id;
  saveUsers(users);
  saveProfiles(books);
}

/** Danh sách mục (sổ) của mọi người dùng. */
export function getProfiles() {
  ensureModel();
  return readJSON(PROFILES_KEY);
}
export function getUsers() {
  ensureModel();
  return readJSON(USERS_KEY);
}

export function currentProfile() {
  const list = getProfiles();
  return list.find((p) => p.id === localStorage.getItem(CURRENT_KEY)) || list[0];
}
export function currentUser() {
  const users = getUsers();
  return users.find((u) => u.id === currentProfile().owner) || users[0];
}
export const userOf = (book) => getUsers().find((u) => u.id === book.owner);
export const userBooks = (userId) => getProfiles().filter((b) => b.owner === userId);
// ---------- Khóa mục ----------
// Mục bị khóa: không chuyển tiền đi được (chi, góp, chuyển khoản, trả nợ, bị trích, trả tiền thẻ; thẻ thì không ghi khoản chi mới).
// Tiền vào (thu, nhận góp) vẫn được.
export const isLocked = (bookId) => !!getProfiles().find((b) => b.id === bookId)?.locked;
export function setLocked(bookId, locked) {
  saveProfile({ id: bookId, locked: !!locked });
  emit();
}
export function lockError(bookId) {
  const b = getProfiles().find((x) => x.id === bookId);
  return b && b.locked ? `🔒 Mục "${bookLabel(b)}" đang khóa — mở khóa trong Cài đặt để chuyển tiền đi` : null;
}

/** Nhãn đầy đủ của một mục: "Tôi · Ngân hàng". */
export const bookLabel = (b) => `${userOf(b)?.name || '?'} · ${b.name}`;

export async function switchProfile(id) {
  localStorage.setItem(CURRENT_KEY, id);
  // Nhớ mục dùng gần nhất của người dùng để lần sau chuyển người thì mở đúng mục đó.
  const book = getProfiles().find((b) => b.id === id);
  if (book) saveUsers(getUsers().map((u) => (u.id === book.owner ? { ...u, lastBook: id } : u)));
  await useProfile(id);
  await loadAll();
  emit();
}

/** Chuyển sang người dùng khác: mở mục dùng gần nhất của người đó. */
export async function switchUser(userId) {
  const u = getUsers().find((x) => x.id === userId);
  const books = userBooks(userId);
  if (!u || !books.length) return;
  await switchProfile((books.find((b) => b.id === u.lastBook) || books[0]).id);
}

/** Thêm/sửa người dùng. Thêm mới (tối đa 3) sẽ kèm một mục Ngân hàng mặc định. */
export function saveUser(u) {
  const users = getUsers();
  if (!u.id) {
    if (users.length >= MAX_USERS) throw new Error(`Tối đa ${MAX_USERS} người dùng`);
    u.id = uid().replace(/-/g, '').slice(0, 12);
    u.color = u.color || PROFILE_COLORS[users.length % PROFILE_COLORS.length];
    users.push(u);
    saveUsers(users);
    saveProfile({ name: BOOK_KINDS.bank.label, icon: BOOK_KINDS.bank.icon, kind: 'bank', owner: u.id, color: u.color });
  } else {
    saveUsers(users.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
  }
  return u;
}

/** Xóa người dùng cùng toàn bộ các mục (sổ) của người đó. */
export async function deleteUser(userId) {
  const users = getUsers().filter((u) => u.id !== userId);
  if (!users.length) throw new Error('Cần giữ ít nhất 1 người dùng');
  const drop = userBooks(userId);
  saveUsers(users);
  saveProfiles(getProfiles().filter((b) => b.owner !== userId));
  if (drop.some((b) => b.id === localStorage.getItem(CURRENT_KEY))) await switchUser(users[0].id);
  for (const b of drop) await dropProfile(b.id);
}

export function saveProfile(p) {
  const list = getProfiles();
  if (!p.id) {
    const same = list.filter((b) => b.owner === p.owner && (b.kind || 'bank') === (p.kind || 'bank'));
    if (p.owner && same.length >= MAX_PER_KIND) {
      throw new Error(`Mỗi người dùng tối đa ${MAX_PER_KIND} mục ${BOOK_KINDS[p.kind || 'bank'].label}`);
    }
    p.id = uid().replace(/-/g, '').slice(0, 12);
    p.color = p.color || PROFILE_COLORS[list.length % PROFILE_COLORS.length];
    list.push(p);
  } else {
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = { ...list[i], ...p };
  }
  saveProfiles(list);
  return p;
}

/** Xóa một mục (sổ) và toàn bộ dữ liệu của mục đó. Mỗi người dùng phải còn ít nhất 1 mục. */
export async function deleteProfile(id) {
  const book = getProfiles().find((p) => p.id === id);
  if (!book) return;
  const siblings = userBooks(book.owner).filter((b) => b.id !== id);
  if (!siblings.length) throw new Error('Mỗi người dùng cần ít nhất 1 mục');
  saveProfiles(getProfiles().filter((p) => p.id !== id));
  if (localStorage.getItem(CURRENT_KEY) === id) await switchProfile(siblings[0].id);
  await dropProfile(id);
}

// ---------- Tải / ghi ----------
export async function loadAll() {
  await useProfile(currentProfile().id);
  for (const s of LIST) state[s] = await db.getAll(s);
  const rows = await db.getAll('settings');
  state.settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) state.settings[r.key] = r.value;
  if (!state.categories.length) {
    const { cats, accs } = seedRows();
    await db.bulkPut('categories', cats);
    await db.bulkPut('accounts', accs);
    state.categories = cats;
    state.accounts = accs;
  }
  const extra = missingSysCats(state.categories);
  if (currentProfile().kind === 'invest') extra.push(...missingInvestCats(state.categories));
  if (extra.length) {
    await db.bulkPut('categories', extra);
    state.categories.push(...extra);
  }
  await migrateCash();
}

/**
 * Bản cũ có ví "Tiền mặt": xóa nếu chưa dùng (chưa có giao dịch, số dư ban đầu 0) và
 * chuyển các khoản nợ/định kỳ đang trỏ tới nó sang tài khoản ngân hàng đầu tiên.
 * Ví tiền mặt đã có giao dịch được giữ lại để không lệch số dư.
 */
async function migrateCash() {
  const used = new Set(state.transactions.flatMap((t) => [t.accountId, t.toAccountId]));
  const drop = state.accounts.filter((a) => a.kind === 'cash' && !used.has(a.id) && !Number(a.initial));
  if (!drop.length) return;
  for (const a of drop) await db.del('accounts', a.id);
  state.accounts = state.accounts.filter((a) => !drop.includes(a));
  if (!state.accounts.length) {
    const acc = seedRows().accs[0];
    await db.put('accounts', acc);
    state.accounts = [acc];
  }
  const target = state.accounts.find((a) => !a.archived) || state.accounts[0];
  const dropped = new Set(drop.map((a) => a.id));
  for (const d of state.debts) if (dropped.has(d.accountId)) { d.accountId = target.id; await db.put('debts', d); }
  for (const r of state.recurring) {
    if (dropped.has(r.template.accountId)) r.template.accountId = target.id;
    if (dropped.has(r.template.toAccountId)) r.template.toAccountId = null;
    await db.put('recurring', r);
  }
  if (dropped.has(state.settings.lastAccount)) await setSetting('lastAccount', target.id, { silent: true });
}

// ---------- Kiểm tra số dư ----------
/** Ảnh hưởng của một giao dịch lên số dư một tài khoản. */
function txEffect(t, accountId) {
  if (t.type === 'income') return t.accountId === accountId ? t.amountVnd : 0;
  if (t.type === 'expense') return t.accountId === accountId ? -t.amountVnd : 0;
  return (t.toAccountId === accountId ? t.amountVnd : 0) - (t.accountId === accountId ? t.amountVnd : 0);
}

/** Số dư khả dụng; khi sửa giao dịch thì bỏ qua ảnh hưởng của chính giao dịch đó. */
export function available(accountId, ignoreTx = null) {
  const acc = accById(accountId);
  if (!acc) return 0;
  return accountBalance(acc) - (ignoreTx ? txEffect(ignoreTx, accountId) : 0);
}

/** Trả về thông báo lỗi nếu tài khoản không đủ tiền cho khoản chi, ngược lại trả về null. */
export function fundsError(accountId, amountVnd, ignoreTx = null) {
  // Mục đang khóa thì không cho chuyển tiền đi (chi, góp, trả nợ, chuyển khoản…).
  const locked = lockError(currentProfile().id);
  if (locked) return locked;
  const have = available(accountId, ignoreTx);
  if (amountVnd <= have) return null;
  return `Số dư "${accById(accountId)?.name || 'tài khoản'}" không đủ: còn ${fmt(have)}, cần ${fmt(amountVnd)}`;
}

// ---------- Góp tiền giữa các người dùng ----------
/** Đọc sổ của người khác; nếu sổ chưa từng mở thì tạo dữ liệu mặc định. */
async function openPeerBook(profileId) {
  const peer = dbOf(profileId);
  let cats = await peer.getAll('categories');
  let accs = await peer.getAll('accounts');
  if (!cats.length) {
    const seedData = seedRows();
    cats = seedData.cats;
    accs = seedData.accs;
    await peer.bulkPut('categories', cats);
    await peer.bulkPut('accounts', accs);
  }
  const extra = missingSysCats(cats);
  if (extra.length) { await peer.bulkPut('categories', extra); cats = cats.concat(extra); }
  return { peer, cats, accs };
}

/** Danh sách tài khoản (chưa ẩn) của một người dùng khác. */
export async function peerAccounts(profileId) {
  const { accs } = await openPeerBook(profileId);
  return accs.filter((a) => !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Góp tiền: sổ người góp ghi khoản CHI "Góp cho …", sổ người nhận ghi khoản THU "Nhận góp từ …".
 * Hai giao dịch liên kết qua gop.id để xóa đồng bộ.
 */
export async function gop({ toProfileId, amount, fromAccountId, toAccountId, date, note }) {
  const me = currentProfile();
  const to = getProfiles().find((p) => p.id === toProfileId);
  if (!to || to.id === me.id) throw new Error('Chọn người nhận khác');
  const err = fundsError(fromAccountId, amount);
  if (err) throw new Error(err);
  const gid = uid();
  const base = { amount, currency: 'VND', rate: 1, amountVnd: amount, date, tags: [], splits: null, photoIds: [], createdAt: Date.now() };
  const { peer, cats } = await openPeerBook(to.id);
  await peer.put('transactions', {
    ...base, id: uid(), type: 'income', categoryId: cats.find((c) => c.sys === 'gop-in').id, accountId: toAccountId,
    note: note || `Nhận góp từ ${bookLabel(me)}`, gop: { id: gid, dir: 'in', peer: me.id, peerName: bookLabel(me) }, updatedAt: Date.now(),
  });
  return put('transactions', {
    ...base, type: 'expense', categoryId: sysCat('gop-out').id, accountId: fromAccountId,
    note: note || `Góp cho ${bookLabel(to)}`, gop: { id: gid, dir: 'out', peer: to.id, peerName: bookLabel(to) },
  });
}

/** Số dư hiện tại của một tài khoản trong sổ người khác. */
export async function peerBalance(profileId, accountId) {
  const peer = dbOf(profileId);
  const acc = (await peer.getAll('accounts')).find((a) => a.id === accountId);
  if (!acc) return 0;
  let b = Number(acc.initial) || 0;
  for (const t of await peer.getAll('transactions')) b += txEffect(t, accountId);
  return b;
}

/**
 * Trích tiền (ngược với Góp): lấy tiền từ tài khoản của người khác về tài khoản của mình.
 * Sổ mình ghi khoản THU "Trích từ …", sổ người kia ghi khoản CHI "Bị … trích". Người kia phải đủ số dư.
 */
export async function trich({ fromProfileId, amount, fromAccountId, toAccountId, date, note }) {
  const me = currentProfile();
  const from = getProfiles().find((p) => p.id === fromProfileId);
  if (!from || from.id === me.id) throw new Error('Chọn người bị trích khác');
  const { peer, cats, accs } = await openPeerBook(from.id);
  const locked = lockError(from.id);
  if (locked) throw new Error(locked);
  const have = await peerBalance(from.id, fromAccountId);
  if (amount > have) {
    const acc = accs.find((a) => a.id === fromAccountId);
    throw new Error(`Số dư "${acc?.name || 'tài khoản'}" của ${bookLabel(from)} không đủ: còn ${fmt(have)}, cần ${fmt(amount)}`);
  }
  const gid = uid();
  const base = { amount, currency: 'VND', rate: 1, amountVnd: amount, date, tags: [], splits: null, photoIds: [], createdAt: Date.now() };
  await peer.put('transactions', {
    ...base, id: uid(), type: 'expense', categoryId: cats.find((c) => c.sys === 'trich-out').id, accountId: fromAccountId,
    note: note || `Bị ${bookLabel(me)} trích`, gop: { id: gid, mode: 'trich', dir: 'out', peer: me.id, peerName: bookLabel(me) }, updatedAt: Date.now(),
  });
  return put('transactions', {
    ...base, type: 'income', categoryId: sysCat('trich-in').id, accountId: toAccountId,
    note: note || `Trích từ ${bookLabel(from)}`, gop: { id: gid, mode: 'trich', dir: 'in', peer: from.id, peerName: bookLabel(from) },
  });
}

/** Xóa giao dịch tương ứng trong sổ của người kia (nếu người đó còn tồn tại). */
async function deleteGopPeer(tx) {
  if (!tx.gop || !getProfiles().some((p) => p.id === tx.gop.peer)) return;
  const peer = dbOf(tx.gop.peer);
  const twin = (await peer.getAll('transactions')).find((t) => t.gop && t.gop.id === tx.gop.id);
  if (twin) await peer.del('transactions', twin.id);
}

export async function put(store, obj, { silent = false } = {}) {
  if (!obj.id) obj.id = uid();
  obj.updatedAt = Date.now();
  await db.put(store, obj);
  const arr = state[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  if (!silent) emit();
  return obj;
}

export async function remove(store, id, { silent = false } = {}) {
  await db.del(store, id);
  state[store] = state[store].filter((x) => x.id !== id);
  if (!silent) emit();
}

export async function setSetting(key, value, { silent = false } = {}) {
  state.settings[key] = value;
  await db.put('settings', { key, value });
  if (!silent) emit();
}

// ---------- Tra cứu ----------
export const catById = (id) => state.categories.find((c) => c.id === id);
export const accById = (id) => state.accounts.find((a) => a.id === id);
export const sysCat = (sys) => state.categories.find((c) => c.sys === sys);
/** Danh mục đang dùng; mục Đầu tư chỉ hiện danh sách ngắn riêng (kèm danh mục hệ thống góp/trích). */
export const catsOf = (type) => {
  const invest = currentProfile().kind === 'invest';
  return state.categories
    .filter((c) => c.type === type && !c.archived && (!invest || c.invest || /^(gop|trich)/.test(c.sys || '')))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};
export const activeAccounts = () => state.accounts.filter((a) => !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const rateOf = (code) => (state.settings.currencies.find((c) => c.code === code) || { rate: 1 }).rate;

/** Một giao dịch có thể chia nhiều danh mục; trả về các phần (danh mục, số tiền VND). */
export const txParts = (tx) =>
  tx.splits && tx.splits.length ? tx.splits : [{ categoryId: tx.categoryId, amountVnd: tx.amountVnd }];

export const txIn = (range) => state.transactions.filter((t) => t.date >= range.start && t.date <= range.end);

export function totals(range) {
  let income = 0, expense = 0;
  for (const t of txIn(range)) {
    if (t.type === 'income') income += t.amountVnd;
    else if (t.type === 'expense') expense += t.amountVnd;
  }
  return { income, expense, net: income - expense };
}

export function byCategory(range, type) {
  const map = new Map();
  for (const t of txIn(range)) {
    if (t.type !== type) continue;
    for (const p of txParts(t)) map.set(p.categoryId, (map.get(p.categoryId) || 0) + p.amountVnd);
  }
  return [...map.entries()]
    .map(([id, amount]) => ({ cat: catById(id) || { id, name: 'Không rõ', icon: '❔', color: '#888' }, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function catSpent(categoryId, range) {
  let s = 0;
  for (const t of txIn(range)) {
    if (t.type !== 'expense') continue;
    for (const p of txParts(t)) if (p.categoryId === categoryId) s += p.amountVnd;
  }
  return s;
}

export function accountBalance(acc) {
  let b = Number(acc.initial) || 0;
  for (const t of state.transactions) {
    if (t.type === 'income' && t.accountId === acc.id) b += t.amountVnd;
    else if (t.type === 'expense' && t.accountId === acc.id) b -= t.amountVnd;
    else if (t.type === 'transfer') {
      if (t.accountId === acc.id) b -= t.amountVnd;
      if (t.toAccountId === acc.id) b += t.amountVnd;
    }
  }
  return b;
}
export const totalBalance = () => activeAccounts().reduce((s, a) => s + accountBalance(a), 0);

export function allTags() {
  const count = new Map();
  for (const t of state.transactions) for (const g of t.tags || []) count.set(g, (count.get(g) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

/** Danh mục hay dùng nhất (để gợi ý nhập nhanh). */
export function topCategories(type, n = 6) {
  const count = new Map();
  for (const t of state.transactions.slice(-300)) if (t.type === type) count.set(t.categoryId, (count.get(t.categoryId) || 0) + 1);
  return catsOf(type).sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0)).slice(0, n);
}

// ---------- Giao dịch ----------
export async function deleteTx(tx) {
  for (const pid of tx.photoIds || []) await db.del('photos', pid);
  await deleteGopPeer(tx);
  await reopenCardItem(tx);
  await remove('transactions', tx.id);
}

// ---------- Thẻ chi tiêu ----------
// Thẻ chi tiêu là một "sổ" (hồ sơ kind = 'card') không có số dư: chỉ ghi các khoản chi (nguồn MoMo, ZaloPay…).
// Mỗi khoản chi có trạng thái open/done; "Trích thanh toán" ghi một khoản chi vào sổ người dùng trả tiền.
export const isCard = (p = currentProfile()) => p && p.kind === 'card';
/** Các mục có tài khoản/số dư (Ngân hàng, Đầu tư) của mọi người dùng — dùng cho Góp, Trích, trả tiền thẻ. */
export const moneyBooks = () => getProfiles().filter((p) => p.kind !== 'card');
export const cardBooks = (userId) => getProfiles().filter((p) => p.kind === 'card' && (!userId || p.owner === userId));
export const CARD_SOURCES = ['MoMo', 'ZaloPay', 'ShopeePay', 'VNPay', 'Viettel Money', 'Apple Pay', 'Thẻ tín dụng', 'Khác'];

/** Trích thanh toán một khoản chi của thẻ (đang mở thẻ) từ tài khoản của một người dùng. */
export async function payCardItem(item, { profileId, accountId, date }) {
  const card = currentProfile();
  const payer = getProfiles().find((p) => p.id === profileId);
  if (!payer || payer.kind === 'card') throw new Error('Chọn người dùng trả tiền');
  const locked = lockError(profileId);
  if (locked) throw new Error(locked);
  const { peer, cats, accs } = await openPeerBook(profileId);
  const acc = accs.find((a) => a.id === accountId);
  const have = await peerBalance(profileId, accountId);
  if (item.amountVnd > have) {
    throw new Error(`Số dư "${acc?.name || 'tài khoản'}" của ${bookLabel(payer)} không đủ: còn ${fmt(have)}, cần ${fmt(item.amountVnd)}`);
  }
  // Danh mục bên sổ người trả: cùng tên với danh mục của khoản chi, không có thì "Khác".
  const catName = catById(item.categoryId)?.name;
  const expCats = cats.filter((c) => c.type === 'expense' && !c.archived);
  const cat = expCats.find((c) => c.name === catName) || expCats.find((c) => c.name === 'Khác') || expCats[0];
  const txId = uid();
  await peer.put('transactions', {
    id: txId, type: 'expense', amount: item.amountVnd, currency: 'VND', rate: 1, amountVnd: item.amountVnd, date,
    categoryId: cat.id, accountId, note: `${bookLabel(card)}: ${item.note || item.source}`, tags: [], splits: null, photoIds: [],
    createdAt: Date.now(), updatedAt: Date.now(),
    cardPay: { cardId: card.id, cardName: bookLabel(card), itemId: item.id, source: item.source },
  });
  item.status = 'done';
  item.paid = { profileId, profileName: bookLabel(payer), accountId, accountName: acc?.name || '', txId, date, at: Date.now() };
  return put('transactions', item);
}

/** Hủy thanh toán: xóa khoản chi bên sổ người trả, đưa khoản chi của thẻ về "chưa thanh toán". */
export async function unpayCardItem(item) {
  if (item.paid && getProfiles().some((p) => p.id === item.paid.profileId)) {
    await dbOf(item.paid.profileId).del('transactions', item.paid.txId);
  }
  item.status = 'open';
  item.paid = null;
  return put('transactions', item);
}

/** Người trả xóa khoản thanh toán trong sổ của họ → khoản chi bên thẻ mở lại. */
async function reopenCardItem(tx) {
  if (!tx.cardPay || !getProfiles().some((p) => p.id === tx.cardPay.cardId)) return;
  const cardDb = dbOf(tx.cardPay.cardId);
  const item = (await cardDb.getAll('transactions')).find((t) => t.id === tx.cardPay.itemId);
  if (item && item.paid && item.paid.txId === tx.id) {
    item.status = 'open';
    item.paid = null;
    item.updatedAt = Date.now();
    await cardDb.put('transactions', item);
  }
}

/** Tóm tắt để hiện trong danh sách chọn: người dùng → tổng số dư; thẻ → số tiền đã chi chưa thanh toán. */
export async function profileSummary(p) {
  const isCur = p.id === currentProfile().id;
  const txs = isCur ? state.transactions : await dbOf(p.id).getAll('transactions');
  if (p.kind === 'card') {
    const open = txs.filter((t) => t.status !== 'done');
    return { kind: 'card', unpaid: open.reduce((s, t) => s + t.amountVnd, 0), count: open.length };
  }
  const accs = (isCur ? state.accounts : await dbOf(p.id).getAll('accounts')).filter((a) => !a.archived);
  let balance = 0;
  for (const a of accs) {
    let b = Number(a.initial) || 0;
    for (const t of txs) b += txEffect(t, a.id);
    balance += b;
  }
  return { kind: 'user', balance };
}

export const savePhoto = (blob) => {
  const id = uid();
  return db.put('photos', { id, blob, createdAt: Date.now() }).then(() => id);
};
export const getPhoto = (id) => db.get('photos', id);
export const deletePhoto = (id) => db.del('photos', id);

// ---------- Giao dịch định kỳ ----------
export function txFromTemplate(r, date) {
  const t = r.template;
  const rate = rateOf(t.currency || 'VND');
  return {
    id: uid(), type: t.type, amount: t.amount, currency: t.currency || 'VND', rate,
    amountVnd: Math.round(t.amount * rate), date, categoryId: t.categoryId, accountId: t.accountId,
    toAccountId: t.toAccountId || null, note: t.note || '', tags: t.tags || [],
    splits: t.splits ? t.splits.map((s) => ({ ...s })) : null, photoIds: [], recurringId: r.id, createdAt: Date.now(),
  };
}

export const advanceRecurring = (r) => {
  r.nextDate = nextDate(r.nextDate, r.freq, r.interval || 1, r.anchorDay);
  if (r.endDate && r.nextDate > r.endDate) r.active = false;
};

/** Tự ghi các giao dịch định kỳ (loại "tự động") đã đến hạn. */
export async function processRecurring() {
  const today = todayISO();
  let added = 0;
  for (const r of state.recurring) {
    if (!r.active || !r.autoAdd) continue;
    let guard = 0;
    while (r.active && r.nextDate <= today && guard++ < 400) {
      const tx = txFromTemplate(r, r.nextDate);
      // Khoản chi/chuyển khoản không đủ số dư: không tự ghi, để lại thành mục "cần xử lý".
      if (tx.type !== 'income' && fundsError(tx.accountId, tx.amountVnd)) break;
      await put('transactions', tx, { silent: true });
      advanceRecurring(r);
      added++;
    }
    if (guard) await put('recurring', r, { silent: true });
  }
  if (added) emit();
  return added;
}

// ---------- Trả nợ ----------
export const debtName = (d) => d.bank + (d.title ? ' – ' + d.title : '');

export async function payDebt(debt, { amount, accountId, date }) {
  const err = fundsError(accountId, Math.round(amount));
  if (err) throw new Error(err);
  const cat = sysCat('debt');
  const tx = await put('transactions', {
    type: 'expense', amount, currency: 'VND', rate: 1, amountVnd: Math.round(amount), date,
    categoryId: cat ? cat.id : null, accountId, note: 'Trả nợ ' + debtName(debt), tags: [], splits: null,
    photoIds: [], debtId: debt.id, createdAt: Date.now(),
  }, { silent: true });
  debt.history = [...(debt.history || []), { dueDate: debt.dueDate, paidDate: date, amount, txId: tx.id, periodsLeft: debt.periodsLeft }];
  const more = debt.repeat === 'monthly' && (debt.periodsLeft == null || debt.periodsLeft > 1);
  if (more) {
    debt.dueDate = addMonths(debt.dueDate, 1, debt.dueDay);
    if (debt.periodsLeft != null) debt.periodsLeft--;
  } else {
    debt.done = true;
    if (debt.periodsLeft != null) debt.periodsLeft = 0;
  }
  await put('debts', debt);
}

export async function undoDebtPayment(debt) {
  const last = (debt.history || []).slice(-1)[0];
  if (!last) return;
  const tx = state.transactions.find((t) => t.id === last.txId);
  if (tx) await remove('transactions', tx.id, { silent: true });
  debt.history = debt.history.slice(0, -1);
  debt.dueDate = last.dueDate;
  debt.periodsLeft = last.periodsLeft ?? debt.periodsLeft;
  debt.done = false;
  await put('debts', debt);
}

// ---------- Ngân sách ----------
export function budgetStatus(b, refDate = todayISO()) {
  const range = getRange(b.period || 'month', refDate, state.settings.weekStart);
  const spent = b.categoryId === '__all' ? totals(range).expense : catSpent(b.categoryId, range);
  return { range, spent, ratio: b.amount > 0 ? spent / b.amount : 0, left: b.amount - spent };
}
export const budgetName = (b) => (b.categoryId === '__all' ? 'Tổng chi tiêu' : catById(b.categoryId)?.name || 'Danh mục đã xóa');

// ---------- Phân bổ 50/30/20 hoặc JARS ----------
export function allocation(range) {
  const m = METHODS[state.settings.method];
  if (!m) return null;
  const t = totals(range);
  const exp = Number(state.settings.expectedIncome) || 0;
  // Thu nhập dự kiến là theo tháng → quy đổi theo độ dài kỳ (ngày, quý, năm, khoảng tự chọn).
  const scale = range.type === 'month' ? 1 : range.type === 'year' ? 12 : range.type === 'quarter' ? 3 : range.days / 30.44;
  const base = t.income > 0 ? t.income : Math.round(exp * scale);
  const spentBy = new Map();
  for (const tx of txIn(range)) {
    if (tx.type !== 'expense') continue;
    for (const p of txParts(tx)) {
      const g = catById(p.categoryId)?.[m.field] || '';
      spentBy.set(g, (spentBy.get(g) || 0) + p.amountVnd);
    }
  }
  return {
    method: m, base, usingExpected: !(t.income > 0),
    groups: m.groups.map((g) => ({ ...g, target: Math.round((base * g.pct) / 100), spent: spentBy.get(g.key) || 0 })),
    unassigned: spentBy.get('') || 0,
  };
}

// ---------- Quỹ dự phòng ----------
export function emergencyInfo() {
  const today = todayISO();
  let total = 0, monthsWithData = 0;
  for (let i = 1; i <= 3; i++) {
    const e = totals(getRange('month', addMonths(today, -i, 1))).expense;
    if (e > 0) { total += e; monthsWithData++; }
  }
  if (!monthsWithData) {
    const cur = getRange('month', today);
    const e = totals(cur).expense;
    const passed = Math.max(1, diffDays(cur.start, today) + 1);
    total = Math.round((e / passed) * 30);
    monthsWithData = total > 0 ? 1 : 0;
  }
  const avg = monthsWithData ? Math.round(total / monthsWithData) : 0;
  const months = Number(state.settings.emergencyMonths) || 6;
  return { avg, months, target: avg * months, goal: state.goals.find((g) => g.isEmergency) };
}

// ---------- Nhắc nhở ----------
export function getAlerts() {
  const today = todayISO();
  const def = Number(state.settings.remindDays) || 0;
  const out = [];
  for (const d of state.debts) {
    if (d.done) continue;
    const days = diffDays(today, d.dueDate);
    if (days <= (d.remindDays ?? def)) {
      out.push({ key: `debt:${d.id}:${d.dueDate}`, kind: 'debt', id: d.id, days, title: debtName(d), amount: d.amount, date: d.dueDate });
    }
  }
  for (const r of state.recurring) {
    if (!r.active) continue;
    const days = diffDays(today, r.nextDate);
    const title = r.template.note || catById(r.template.categoryId)?.name || 'Giao dịch định kỳ';
    if (days <= 0) {
      // Chờ xác nhận, hoặc khoản tự động bị dừng vì không đủ số dư.
      out.push({ key: `pending:${r.id}:${r.nextDate}`, kind: 'pending', id: r.id, days, noFunds: !!r.autoAdd, title, amount: Math.round(r.template.amount * rateOf(r.template.currency)), date: r.nextDate });
    } else if (r.template.type === 'expense' && days > 0 && days <= (r.remindDays ?? def)) {
      out.push({ key: `rec:${r.id}:${r.nextDate}`, kind: 'recurring', id: r.id, days, title, amount: Math.round(r.template.amount * rateOf(r.template.currency)), date: r.nextDate });
    }
  }
  for (const b of state.budgets) {
    const st = budgetStatus(b);
    if (st.ratio >= 0.8) {
      const level = st.ratio >= 1 ? 100 : 80;
      out.push({ key: `budget:${b.id}:${st.range.start}:${level}`, kind: 'budget', id: b.id, days: 999, level, title: budgetName(b), amount: st.spent, limit: b.amount, ratio: st.ratio });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

// ---------- Sao lưu ----------
const blobToDataURL = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const dataURLToBlob = async (url) => (await fetch(url)).blob();

export async function exportData({ withPhotos = true } = {}) {
  const out = { app: 'sothuchi', version: 1, exportedAt: new Date().toISOString(), settings: state.settings };
  for (const s of LIST) out[s] = state[s];
  out.photos = [];
  if (withPhotos) {
    for (const p of await db.getAll('photos')) out.photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
  }
  return out;
}

/** Đọc toàn bộ một sổ (người dùng hoặc thẻ) để sao lưu. */
async function exportBook(profileId) {
  const book = dbOf(profileId);
  const out = { settings: {} };
  for (const s of LIST) out[s] = await book.getAll(s);
  for (const r of await book.getAll('settings')) out.settings[r.key] = r.value;
  out.photos = [];
  for (const p of await book.getAll('photos')) out.photos.push({ id: p.id, data: await blobToDataURL(p.blob) });
  return out;
}

/** Sao lưu TẤT CẢ người dùng và thẻ chi tiêu vào một file. */
export async function exportAll() {
  const profiles = getProfiles();
  const books = {};
  for (const p of profiles) books[p.id] = await exportBook(p.id);
  return { app: 'sothuchi', version: 3, all: true, exportedAt: new Date().toISOString(), current: currentProfile().id, users: getUsers(), profiles, books };
}

/**
 * Khôi phục. File mới (all: true) → thay toàn bộ người dùng, thẻ và giao dịch.
 * File cũ (chỉ một sổ) → khôi phục vào sổ đang chọn như trước.
 */
export async function importAny(data) {
  if (!data || data.app !== 'sothuchi') throw new Error('File không phải bản sao lưu của Sổ Thu Chi');
  if (!data.all) return importData(data);
  if (!Array.isArray(data.profiles) || !data.profiles.length || !data.books) throw new Error('File sao lưu không đầy đủ');
  const oldIds = getProfiles().map((p) => p.id);
  for (const p of data.profiles) {
    const b = data.books[p.id] || {};
    const book = dbOf(p.id);
    for (const s of STORES) await book.clear(s);
    for (const s of LIST) await book.bulkPut(s, b[s] || []);
    for (const ph of b.photos || []) await book.put('photos', { id: ph.id, blob: await dataURLToBlob(ph.data), createdAt: Date.now() });
    await book.bulkPut('settings', Object.entries(b.settings || {}).map(([key, value]) => ({ key, value })));
  }
  saveProfiles(data.profiles);
  // Bản sao lưu cũ chưa có danh sách người dùng → để ensureModel() chuyển đổi lại từ danh sách mục.
  if (Array.isArray(data.users) && data.users.length) saveUsers(data.users);
  else localStorage.removeItem(USERS_KEY);
  const target = data.profiles.some((p) => p.id === data.current) ? data.current : getProfiles()[0].id;
  await switchProfile(target);
  // Xóa các sổ trên máy không có trong bản sao lưu.
  for (const id of oldIds) if (!data.profiles.some((p) => p.id === id)) await dropProfile(id);
  return data.profiles.length;
}

export async function importData(data) {
  if (!data || data.app !== 'sothuchi') throw new Error('File không phải bản sao lưu của Sổ Thu Chi');
  for (const s of STORES) await db.clear(s);
  for (const s of LIST) await db.bulkPut(s, data[s] || []);
  for (const p of data.photos || []) await db.put('photos', { id: p.id, blob: await dataURLToBlob(p.data), createdAt: Date.now() });
  for (const [key, value] of Object.entries(data.settings || {})) await db.put('settings', { key, value });
  await loadAll();
  emit();
}

/** Nạp dữ liệu mẫu để xem thử app (chỉ dùng khi chưa có giao dịch). */
export async function seedDemo() {
  if (state.transactions.length) return false;
  const today = todayISO();
  const c = (n) => state.categories.find((x) => x.name === n)?.id;
  const bank = await put('accounts', { ...state.accounts[0], name: 'VCB lương', bank: 'Vietcombank', number: '0123456789', holder: 'NGUYEN VAN A', initial: 8000000 }, { silent: true });
  const cash = await put('accounts', { name: 'Techcombank chi tiêu', bank: 'Techcombank', number: '19034567891011', holder: 'NGUYEN VAN A', icon: '💳', kind: 'bank', initial: 500000, order: 1 }, { silent: true });
  // Ngày lùi n ngày nhưng giữ trong tháng hiện tại để báo cáo tháng có đủ dữ liệu.
  const monthStart = today.slice(0, 8) + '01';
  const day = (n) => { const d = addDays(today, -n); return d < monthStart ? monthStart : d; };
  const tx = (type, amt, cat, d, note, tags = [], acc = bank) => put('transactions', {
    type, amount: amt, currency: 'VND', rate: 1, amountVnd: amt, date: day(d), categoryId: c(cat), accountId: acc.id,
    note, tags, splits: null, photoIds: [], createdAt: Date.now() - d * 1000,
  }, { silent: true });
  await tx('income', 18000000, 'Lương', 10, 'Lương tháng');
  await tx('expense', 3500000, 'Nhà ở', 9, 'Tiền thuê nhà');
  await tx('expense', 420000, 'Điện nước & Internet', 8, 'Tiền điện');
  await tx('expense', 650000, 'Mua sắm', 6, 'Áo khoác', ['mùa đông']);
  await tx('expense', 1200000, 'Giải trí & Du lịch', 4, 'Xem phim + ăn tối', ['cuối tuần']);
  await tx('expense', 80000, 'Đi lại', 1, 'Đổ xăng', [], cash);
  await tx('expense', 45000, 'Ăn uống', 0, 'Ăn trưa', [], cash);
  await tx('expense', 35000, 'Ăn uống', 0, 'Cà phê sáng', [], cash);
  await put('debts', {
    bank: 'Vietcombank', title: 'Vay mua xe', amount: 5200000, dueDate: addDays(today, 2), dueDay: Number(addDays(today, 2).slice(8)),
    repeat: 'monthly', periodsLeft: 24, method: 'Trích nợ tự động', note: 'Để đủ tiền trong TK lương trước ngày đến hạn',
    accountId: bank.id, remindDays: 3, history: [],
  }, { silent: true });
  await put('debts', {
    bank: 'Techcombank', title: 'Thẻ tín dụng', amount: 3150000, dueDate: addDays(today, 12), dueDay: Number(addDays(today, 12).slice(8)),
    repeat: 'monthly', periodsLeft: null, method: 'Chuyển khoản qua app ngân hàng', note: 'CK tới thẻ 4xxx, nội dung: THANH TOAN THE',
    accountId: bank.id, remindDays: 3, history: [],
  }, { silent: true });
  await put('budgets', { categoryId: c('Ăn uống'), amount: 1500000, period: 'month' }, { silent: true });
  await put('budgets', { categoryId: '__all', amount: 12000000, period: 'month' }, { silent: true });
  await put('goals', { name: 'Du lịch Nhật Bản', icon: '🗾', target: 40000000, saved: 12000000, deadline: addMonths(today, 8), contributions: [] }, { silent: true });
  await put('recurring', {
    template: { type: 'expense', amount: 260000, currency: 'VND', categoryId: c('Giải trí & Du lịch'), accountId: bank.id, note: 'Netflix', tags: [] },
    freq: 'month', interval: 1, anchorDay: Number(addDays(today, 3).slice(8)), nextDate: addDays(today, 3), autoAdd: true, remindDays: 3, active: true,
  }, { silent: true });
  await setSetting('method', '503020', { silent: true });
  emit();
  return true;
}

export async function wipeAll() {
  for (const s of STORES) await db.clear(s);
  await loadAll();
  emit();
}
