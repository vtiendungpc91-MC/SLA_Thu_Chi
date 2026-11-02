// Trạng thái app + nghiệp vụ: số dư, tổng hợp, định kỳ, trả nợ, ngân sách, mục tiêu, sao lưu.
import { db, STORES } from './db.js';
import { uid, todayISO, addDays, addMonths, diffDays, getRange, nextDate } from './utils.js';

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
  ['Khác', '📦', 'wants', 'PLAY'],
];
const SEED_INCOME = [
  ['Lương', '💰'], ['Thưởng', '🎉'], ['Kinh doanh', '💼'], ['Lãi tiết kiệm/Đầu tư', '📈'], ['Được tặng', '🎁'], ['Thu khác', '➕'],
];

// ---------- Thông báo thay đổi ----------
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((f) => f());

// ---------- Tải / ghi ----------
export async function loadAll() {
  for (const s of LIST) state[s] = await db.getAll(s);
  const rows = await db.getAll('settings');
  state.settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) state.settings[r.key] = r.value;
  if (!state.categories.length) await seed();
}

async function seed() {
  const cats = [
    ...SEED_EXPENSE.map(([name, icon, rule, jar, sys], i) => ({ id: uid(), type: 'expense', name, icon, rule, jar, sys: sys || null, color: PALETTE[i % PALETTE.length], order: i })),
    ...SEED_INCOME.map(([name, icon], i) => ({ id: uid(), type: 'income', name, icon, color: PALETTE[(i + 3) % PALETTE.length], order: i })),
  ];
  const accs = [
    { id: uid(), name: 'Tiền mặt', icon: '💵', kind: 'cash', initial: 0, order: 0 },
    { id: uid(), name: 'Tài khoản ngân hàng', icon: '🏦', kind: 'bank', initial: 0, order: 1 },
  ];
  await db.bulkPut('categories', cats);
  await db.bulkPut('accounts', accs);
  state.categories = cats;
  state.accounts = accs;
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
export const catsOf = (type) => state.categories.filter((c) => c.type === type && !c.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  await remove('transactions', tx.id);
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
      await put('transactions', txFromTemplate(r, r.nextDate), { silent: true });
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
  const scale = range.type === 'week' ? 7 / 30.4 : range.type === 'year' ? 12 : 1;
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
    if (!r.autoAdd && days <= 0) {
      out.push({ key: `pending:${r.id}:${r.nextDate}`, kind: 'pending', id: r.id, days, title, amount: Math.round(r.template.amount * rateOf(r.template.currency)), date: r.nextDate });
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
  const [cash, bank] = state.accounts;
  // Ngày lùi n ngày nhưng giữ trong tháng hiện tại để báo cáo tháng có đủ dữ liệu.
  const monthStart = today.slice(0, 8) + '01';
  const day = (n) => { const d = addDays(today, -n); return d < monthStart ? monthStart : d; };
  const tx = (type, amt, cat, d, note, tags = [], acc = bank) => put('transactions', {
    type, amount: amt, currency: 'VND', rate: 1, amountVnd: amt, date: day(d), categoryId: c(cat), accountId: acc.id,
    note, tags, splits: null, photoIds: [], createdAt: Date.now() - d * 1000,
  }, { silent: true });
  await put('accounts', { ...bank, initial: 8000000 }, { silent: true });
  await put('accounts', { ...cash, initial: 500000 }, { silent: true });
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
