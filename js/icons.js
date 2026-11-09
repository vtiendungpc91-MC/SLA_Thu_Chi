// Thư viện biểu tượng có từ khóa (tiếng Việt không dấu + tiếng Anh) để tìm nhanh khi chọn icon.
const RAW = `
🧑 nguoi ban than person|👨 dan ong bo chong man|👩 phu nu me vo woman|👦 con trai be boy|👧 con gai be girl|👶 em be baby|👴 ong grandpa|👵 ba grandma|🧔 rau dan ong|👱‍♀️ toc vang co gai
🧑‍💼 cong so van phong|🧑‍💻 lap trinh it dev|🧑‍🍳 dau bep nau an|🧑‍🏫 giao vien thay co|🧑‍⚕️ bac si y te|🧑‍🚀 phi hanh gia|🧑‍🎓 sinh vien hoc|🧑‍🔧 tho sua chua|🥷 ninja|🦸 sieu anh hung
🧚 tien|🤴 hoang tu|👸 cong chua|👪 gia dinh family|💑 cap doi vo chong|👨‍👩‍👧 gia dinh con|🐱 meo cat|🐶 cho dog|🐼 gau truc panda|🐻 gau bear
🐰 tho rabbit|🦊 cao fox|🐯 ho tiger|🦁 su tu lion|🐸 ech frog|🐵 khi monkey|🐷 heo lon tiet kiem pig|🐨 koala|🐧 chim canh cut|🐥 ga con chick
🦄 ky lan unicorn|🐳 ca voi whale|🐙 bach tuoc|🦖 khung long|🐢 rua|🐝 ong bee|🦋 buom|🐟 ca fish|🐾 thu cung pet|🐴 ngua horse
😎 ngau cool|🤓 mot sach|🥰 yeu thuong love|😺 meo cuoi|👻 ma ghost|🤖 robot|😀 cuoi vui|🤑 tien money|😇 thien than|🥳 tiec party
🌸 hoa flower|🌻 huong duong|🌹 hoa hong rose|🌷 tulip|🌱 cay non mam|🌳 cay tree|🍀 co bon la may man|🌵 xuong rong|⭐ ngoi sao star|🌙 trang moon
☀️ mat troi sun|🌈 cau vong|🔥 lua fire|💧 nuoc water|⚡ dien sam|❄️ tuyet lanh|🌊 song bien|⛰️ nui|🏖️ bien du lich|🏕️ cam trai
🏦 ngan hang bank|💰 tui tien money|💵 tien mat cash|💴 tien yen|💶 euro|💷 bang anh|🪙 dong xu coin|💳 the card|🏧 atm rut tien|💸 tieu tien chi
🧾 hoa don bill|👛 vi wallet|💼 cong viec cap|📈 tang dau tu chung khoan stock|📉 giam lo|📊 bieu do thong ke|💹 ty gia lai|🥇 vang gold huy chuong|💎 kim cuong|🏆 cup
🎯 muc tieu goal|🔁 transfer luong chuyen|🔄 withdraw rut ve|📤 chuyen ra outflow tien ra|📥 nhan vao tien vao|🗂️ danh muc thu muc|📁 thu muc|🏷️ nhan tag|🔒 khoa|🔑 chia khoa
🍜 an uong pho bun|🍚 com|🍔 burger an vat|🍕 pizza|🍣 sushi|🍗 ga ran|🥗 rau salad|🍞 banh mi|🍰 banh ngot cake|🍩 donut
🍓 dau|🍎 tao|🍌 chuoi|🍉 dua hau|☕ ca phe coffee|🧋 tra sua|🍵 tra|🍺 bia beer|🍷 ruou vang|🥤 nuoc ngot
🛒 di cho sieu thi mua sam|🛍️ mua sam shopping|👗 quan ao|👕 ao|👟 giay|👜 tui xach|💄 my pham|💍 nhan cuoi|⌚ dong ho|🕶️ kinh
🏠 nha o house|🏡 nha vuon|🏢 toa nha cong ty|🏗️ xay dung|🛋️ noi that|🛏️ giuong ngu|🚿 tam|🧹 don dep|🔧 sua chua|💡 dien den
🔌 dien|📶 internet wifi|📱 dien thoai phone|💻 may tinh laptop|📺 tivi|🎮 game|🎧 tai nghe|📷 may anh|🖨️ may in|🔋 pin
🛵 xe may|🚗 o to xe hoi car|🚕 taxi grab|🚌 xe buyt bus|🚆 tau|✈️ may bay du lich|⛽ xang xang dau|🅿️ gui xe|🚲 xe dap|🛳️ tau thuy
🏥 benh vien suc khoe|💊 thuoc|🩺 kham benh|🦷 rang nha khoa|🏋️ gym the thao|⚽ bong da|🏸 cau long|🧘 yoga|💆 spa|💇 cat toc
📚 sach hoc giao duc|🎓 tot nghiep hoc phi|✏️ but|🏫 truong hoc|🧸 do choi tre em|🍼 sua be|🎒 cap sach|🎨 ve|🎵 am nhac|🎬 phim giai tri
🎁 qua tang gift|🎉 tiec le|🎂 sinh nhat|💐 hoa tang|🧧 li xi tet|🎄 noel|🕯️ nen|💌 thu|🤝 bat tay transfer|🙏 cam on tu thien
📦 khac hang hoa|🐕 cho|🛡️ bao hiem|📄 giay to hop dong|⚖️ phap ly|🧮 tinh toan|📅 lich|⏰ bao thuc|🗓️ ke hoach|✅ xong
⬆️ mui ten len tien ra|⬇️ mui ten xuong tien vao|↗️ mui ten cheo len tien ra|↙️ mui ten cheo xuong tien vao|🔴 tron do tien ra|🟢 tron xanh tien vao|🛫 may bay len tien ra|🛬 may bay xuong tien vao
`;

/** 5 cặp icon tương phản tiền ra / tiền vào, hiện ở đầu bộ chọn icon của nút nhanh. */
export const MONEY_PAIRS = [['⬆️', '⬇️'], ['↗️', '↙️'], ['📤', '📥'], ['🔴', '🟢'], ['🛫', '🛬']];
/** Icon trong cặp tiền ra/vào chưa tự thể hiện màu: cần thêm nền đỏ / xanh nhạt khi hiển thị. */
export const PAIR_TINT = new Set(MONEY_PAIRS.flat().filter((i) => i !== '🔴' && i !== '🟢'));

export const ICONS = RAW.split(/[|\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
  const i = s.indexOf(' ');
  return { icon: s.slice(0, i), kw: s.slice(i + 1).toLowerCase() };
});

/** Bỏ dấu tiếng Việt để tìm kiếm. */
export const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export function searchIcons(q) {
  const k = plain(q).trim();
  if (!k) return ICONS;
  return ICONS.filter((x) => x.kw.includes(k) || x.icon === q.trim());
}

/** HTML bộ chọn icon: ô tìm kiếm + lưới icon. id dùng làm tiền tố. */
export function iconPickerHtml(id, selected, { pairs = null } = {}) {
  // Cặp icon chưa rõ màu: Ra nền đỏ nhạt, Vào nền xanh lá nhạt (cặp 🔴🟢 đã rõ màu thì giữ nguyên).
  const pairBtn = (icon, dir) => `<button type="button" class="chip icon-chip ${PAIR_TINT.has(icon) ? 'tint-' + dir : ''} ${icon === selected ? 'on' : ''}" data-icon="${icon}">${icon}</button>`;
  return `<div class="icon-picker" id="${id}">
    ${pairs ? `<div class="ip-pairs"><span>Ra</span>${pairs.map((p) => pairBtn(p[0], 'out')).join('')}<span>Vào</span>${pairs.map((p) => pairBtn(p[1], 'in')).join('')}</div>` : ''}
    <input type="search" class="ip-q" placeholder="🔍 Tìm biểu tượng: tiền, ăn, xe, nhà, mèo…" autocomplete="off">
    <div class="ip-grid">${gridHtml(ICONS, selected)}</div>
  </div>`;
}
const gridHtml = (list, selected) => list.map((x) => `<button type="button" class="chip icon-chip ${x.icon === selected ? 'on' : ''}" data-icon="${x.icon}" title="${x.kw}">${x.icon}</button>`).join('')
  || '<p class="muted small">Không tìm thấy — thử từ khác.</p>';

/** Gắn sự kiện: onPick(icon) khi chọn. */
export function bindIconPicker(root, onPick, getSelected) {
  const q = root.querySelector('.ip-q'), grid = root.querySelector('.ip-grid');
  q.addEventListener('input', () => { grid.innerHTML = gridHtml(searchIcons(q.value), getSelected()); });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    // Cùng một icon có thể nằm ở cả khu cặp icon và lưới: đánh dấu mọi chỗ.
    root.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('on', x.dataset.icon === b.dataset.icon));
    onPick(b.dataset.icon);
  });
}

// ---------- Huy hiệu ngân hàng dùng làm icon ----------
// Icon lưu dạng "🏦" + ký tự ẩn U+2063 + mã (vd VCB). Chỗ hiện HTML tự đổi thành huy hiệu màu;
// chỗ chỉ có chữ (ô chọn, tiêu đề) hiện "🏦VCB" nên vẫn đọc được.
export const BANK_LOGOS = [
  ['VCB', 'Vietcombank', '#00703c'], ['VTB', 'VietinBank', '#005993'], ['BIDV', 'BIDV', '#00665e'], ['AGR', 'Agribank', '#ae1c3f'],
  ['TCB', 'Techcombank', '#e2231a'], ['MB', 'MB Bank', '#141ed2'], ['ACB', 'ACB', '#1a5ea8'], ['VPB', 'VPBank', '#00a651'],
  ['TPB', 'TPBank', '#5e2e86'], ['STB', 'Sacombank', '#0067b1'], ['HDB', 'HDBank', '#e30613'], ['VIB', 'VIB', '#f7941d'],
  ['SHB', 'SHB', '#f37021'], ['SEAB', 'SeABank', '#d71920'], ['OCB', 'OCB', '#008c45'], ['MSB', 'MSB', '#e4003a'],
  ['LPB', 'LPBank', '#f29200'], ['EIB', 'Eximbank', '#0b5ca8'], ['NAB', 'Nam A Bank', '#e2231a'], ['BAB', 'Bac A Bank', '#c8102e'],
  ['ABB', 'ABBANK', '#00843d'], ['PVCB', 'PVcomBank', '#004a93'], ['KLB', 'KienlongBank', '#0d6b3a'], ['NCB', 'NCB', '#003da5'],
  ['VAB', 'VietABank', '#00529c'], ['BVB', 'BaoViet Bank', '#0063a6'], ['SGB', 'Saigonbank', '#0b3f8a'], ['PGB', 'PG Bank', '#00529b'],
  ['SHBVN', 'Shinhan Bank', '#0046ff'], ['HSBC', 'HSBC', '#db0011'], ['SC', 'Standard Chartered', '#0473ea'], ['UOB', 'UOB', '#005eb8'],
  ['CAKE', 'Cake by VPBank', '#ff4f9a'], ['TIMO', 'Timo', '#4b2c82'], ['MOMO', 'MoMo', '#a50064'], ['ZALO', 'ZaloPay', '#0068ff'],
  ['VTM', 'Viettel Money', '#ee0033'],
].map(([code, name, bg]) => ({ code, name, bg }));
export const BANK_SEP = '\u2063';
export const bankIcon = (code) => '🏦' + BANK_SEP + code;
const bankOf = (code) => BANK_LOGOS.find((l) => l.code === code);
/** Màu huy hiệu nếu icon là logo ngân hàng, không thì null. */
export const bankColorOf = (icon) => {
  const m = /🏦⁣([A-Z]{2,6})/.exec(String(icon || ''));
  return (m && bankOf(m[1])?.bg) || null;
};
ICONS.push(...BANK_LOGOS.map((l) => ({ icon: bankIcon(l.code), kw: `logo ngan hang bank ${plain(l.name)} ${l.code.toLowerCase()}` })));

const TOKEN_RE = /🏦\u2063([A-Z]{2,6})/g;
const SKIP = 'option, select, textarea, input, script, style, title';
function convertText(node) {
  const text = node.data;
  if (!text.includes(BANK_SEP) || node.parentElement?.closest(SKIP)) return;
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const l = bankOf(m[1]);
    if (!l) continue;
    if (m.index > last) frag.append(text.slice(last, m.index));
    const s = document.createElement('span');
    s.className = 'bank-badge ib';
    s.style.setProperty('--bb', l.bg);
    s.title = l.name;
    s.textContent = l.code;
    frag.append(s);
    last = m.index + m[0].length;
  }
  if (!last) return;
  if (last < text.length) frag.append(text.slice(last));
  node.replaceWith(frag);
}
function convertIn(root) {
  if (root.nodeType === 3) return convertText(root);
  if (root.nodeType !== 1 || !root.textContent.includes(BANK_SEP)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.data.includes(BANK_SEP)) nodes.push(walker.currentNode);
  nodes.forEach(convertText);
}
/** Theo dõi trang: icon ngân hàng xuất hiện ở đâu thì vẽ thành huy hiệu ở đó. */
export function startBankBadges() {
  convertIn(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') convertText(m.target);
      else m.addedNodes.forEach(convertIn);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}