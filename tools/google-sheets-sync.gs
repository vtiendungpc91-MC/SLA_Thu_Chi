/**
 * Sổ Thu Chi → Google Sheets (Google Apps Script)
 * ------------------------------------------------
 * Dán toàn bộ file này vào Apps Script của file Google Sheets (Tiện ích mở rộng › Apps Script).
 * App Sổ Thu Chi sẽ gửi giao dịch lên đây; file Sheet có 2 trang:
 *   - GiaoDich: mỗi giao dịch 1 dòng (cột A là mã giao dịch, dùng để sửa / xóa đúng dòng).
 *   - TaiKhoan: số dư hiện tại của từng tài khoản (ghi lại mỗi lần đồng bộ).
 *   - KeHoach: Ngân sách, Mục tiêu, Trả nợ, Định kỳ, Nhắc nhở, Chuyến đi, Chia nhóm.
 *   - SaoLuu: bản sao lưu đầy đủ của app (dùng để tải về máy mới) — không sửa tay.
 *
 * BẮT BUỘC: đổi SECRET bên dưới thành mật khẩu riêng của bạn (dài, khó đoán, không dấu cách).
 * Ai có link ứng dụng web + đúng mật khẩu này mới ghi được vào Sheet.
 */
const SECRET = 'DOI-THANH-MAT-KHAU-RIENG-CUA-BAN';

const SHEET_TX = 'GiaoDich';
const SHEET_ACC = 'TaiKhoan';
const TX_HEADERS = ['ID', 'Ngày', 'Giờ ghi', 'User', 'Bank', 'Tài khoản', 'Loại', 'Danh mục', 'Số tiền', 'Thu', 'Chi', 'Ghi chú', 'Chuyển đến / Nhận từ', 'Mục ID', 'Cập nhật lúc'];
const ACC_HEADERS = ['Mục ID', 'User', 'Bank', 'Tài khoản', 'Loại tài khoản', 'Số dư', 'Cập nhật lúc'];
const SCRIPT_VERSION = 2; // app kiểm tra số này để biết đã dán bản mới
const EXTRA_SHEETS = ['KeHoach'];
const SHEET_BACKUP = 'SaoLuu';
const BACKUP_HEADERS = ['Phần', 'Dữ liệu (không sửa tay)', 'Lúc lưu'];

/** Chạy hàm này 1 lần sau khi dán code (nút ▶ Chạy) để tạo 2 trang và cấp quyền. */
function setup() {
  ensureSheet_(SHEET_TX, TX_HEADERS);
  ensureSheet_(SHEET_ACC, ACC_HEADERS);
}

/** Mở link ứng dụng web trên trình duyệt để kiểm tra: thấy {"ok":true,...} là chạy được. */
function doGet() {
  const tx = ensureSheet_(SHEET_TX, TX_HEADERS);
  return json_({ ok: true, app: 'sothuchi', rows: Math.max(0, tx.getLastRow() - 1) });
}

/**
 * App gửi lên: { key, action: 'upsert' | 'delete' | 'replaceAll', rows: [[...], ...], ids: [...], accounts: [[...], ...] }
 *   upsert: thêm mới hoặc cập nhật theo mã giao dịch (cột A)
 *   delete: xóa các dòng có mã trong ids
 *   replaceAll: xóa hết rồi ghi lại toàn bộ (lần đồng bộ đầu tiên)
 *   accounts: ghi lại trang TaiKhoan (số dư)
 */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Dữ liệu không hợp lệ' }); }
  if (!body || body.key !== SECRET) return json_({ ok: false, error: 'Sai mật khẩu' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const tx = ensureSheet_(SHEET_TX, TX_HEADERS);
    if (body.action === 'replaceAll') replaceAll_(tx, TX_HEADERS, body.rows || []);
    else if (body.action === 'upsert') upsert_(tx, body.rows || []);
    else if (body.action === 'delete') remove_(tx, body.ids || []);
    if (Array.isArray(body.accounts)) replaceAll_(ensureSheet_(SHEET_ACC, ACC_HEADERS), ACC_HEADERS, body.accounts);
    // Trang phụ ghi lại toàn bộ mỗi lần (KeHoach: kế hoạch + nhắc nhở).
    if (body.action === 'sheets' && body.sheets) {
      Object.keys(body.sheets).forEach((name) => {
        if (EXTRA_SHEETS.indexOf(name) < 0) return;
        const s = body.sheets[name];
        replaceAll_(ensureSheet_(name, s.headers), s.headers, s.rows || []);
      });
    }
    // Bản sao lưu đầy đủ (để tải về máy mới): cắt thành nhiều ô, mỗi ô tối đa 45.000 ký tự.
    if (body.action === 'backupPut') {
      const sh = ensureSheet_(SHEET_BACKUP, BACKUP_HEADERS);
      const parts = body.parts || [];
      const at = new Date();
      replaceAll_(sh, BACKUP_HEADERS, parts.map((p, i) => [i + 1, p, at]));
      return json_({ ok: true, parts: parts.length });
    }
    if (body.action === 'backupGet') {
      const sh = ensureSheet_(SHEET_BACKUP, BACKUP_HEADERS);
      const n = sh.getLastRow();
      const vals = n > 1 ? sh.getRange(2, 1, n - 1, 3).getValues() : [];
      vals.sort((a, b) => a[0] - b[0]);
      return json_({ ok: true, data: vals.map((r) => String(r[1])).join(''), at: vals.length ? vals[0][2] : null });
    }
    return json_({ ok: true, rows: Math.max(0, tx.getLastRow() - 1) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sh;
}

function replaceAll_(sh, headers, rows) {
  sh.clearContents();
  sh.appendRow(headers);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows.map((r) => pad_(r, headers.length)));
}

function upsert_(sh, rows) {
  const n = sh.getLastRow();
  const ids = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map((r) => String(r[0])) : [];
  const at = new Map(ids.map((id, i) => [id, i + 2]));
  const append = [];
  rows.forEach((r) => {
    const row = pad_(r, TX_HEADERS.length);
    const line = at.get(String(row[0]));
    if (line) sh.getRange(line, 1, 1, row.length).setValues([row]);
    else append.push(row);
  });
  if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, TX_HEADERS.length).setValues(append);
}

function remove_(sh, idList) {
  const n = sh.getLastRow();
  if (n < 2) return;
  const want = new Set(idList.map(String));
  const ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (want.has(String(ids[i][0]))) sh.deleteRow(i + 2);
}

function pad_(r, len) {
  const a = (r || []).slice(0, len);
  while (a.length < len) a.push('');
  return a;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ v: SCRIPT_VERSION }, o))).setMimeType(ContentService.MimeType.JSON);
}
