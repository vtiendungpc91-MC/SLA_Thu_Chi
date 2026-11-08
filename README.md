# Sổ Thu Chi — app quản lý thu chi cá nhân (chạy offline)

Web app (PWA): cài lên màn hình chính iPhone/Android như app thật, chạy **không cần mạng**.
Dữ liệu chỉ lưu trên thiết bị (IndexedDB), không gửi lên server nào.

- **Link app:** https://vtiendungpc91-mc.github.io/SLA_Thu_Chi/
- **Phiên bản khi ghi tài liệu này:** v7.23.1 (09/11/2026). Phiên bản hiện tại xem ở `VERSION` trong `sw.js`.

## Cách tổ chức dữ liệu

```
User (tối đa 3)
├── Bank (nhiều Bank, đổi được tên và icon)
│   ├── Account (tối đa 2)
│   ├── Thấu chi (tối đa 1)
│   ├── Tiết kiệm (tối đa 2)
│   └── Credit Card (tối đa 1)
└── Ví điện tử
    ├── Tài khoản thanh toán (1, giao dịch như Account)
    └── Thẻ trả trước (1, hoạt động như Credit Card)
Secrecy (ngoài các User): NEOBANK — chỉ Account đã bật "Cho phép Transfer / Get In với NEOBANK"
```

Màn hình chính là **Tổng quan** của User: các thẻ Account (gồm Account của mọi Bank và tài khoản thanh toán của Ví), Thấu chi, Tiết Kiệm, Credit Card (gồm Credit Card của Bank và Thẻ trả trước của Ví) — chỉ hiện thẻ đang có tài khoản, mỗi thẻ liệt kê các tài khoản với số dư, thu/chi trong ngày, nút nhanh và thống kê. Nút góc trái chọn User và xem Notifications. Nút góc phải có thẻ Tổng quan (đổi được tên, biểu tượng, màu) và danh sách mục chia theo từng Bank / Ví điện tử (nút ▾ sát lề phải để thu gọn/mở từng nhóm, app nhớ trạng thái), mỗi nhóm có 1 nút "＋ Thêm mục" (chọn loại, loại đã đủ thì mờ) và nút 🗑 xóa nhóm (còn mục thì xóa luôn các mục, hỏi 2 lần); cuối danh sách có nút "＋ Bank / Ví điện tử"; chọn mục sẽ mở Giao dịch, Báo cáo, Kế hoạch, Cài đặt của mục đó, nút Đóng luôn về Tổng quan.

## Tính năng

| Nhóm | Có gì |
|---|---|
| **Thu/Chi** | Ghi vào mục Account hoặc Thấu chi; gõ tắt `50k`, `1tr2`; chia nhiều danh mục; giao dịch định kỳ (tự ghi hoặc chờ xác nhận). Không đủ số dư thì không chi được |
| **Transfer** | Mọi form giao dịch (Chi, Thu, Transfer, Get In, nút nhanh, xác nhận định kỳ) có dòng logo Bank: "Chi từ [logo] → Nhận vào [logo]". Chuyển tiền giữa các mục, ghi ở cả 2 sổ. Xóa một bên thì bên kia xóa theo, sửa ngày áp dụng cả 2 bên. Có danh mục riêng, chọn được biểu tượng |
| **Get In** | Account, Thấu chi, Tiết kiệm rút từ Account/Thấu chi khác; Account giao dịch được với NEOBANK trong Secrecy khi đã bật công tắc trong Cài đặt của mục (không hiện nếu Secrecy đang ẩn). Các khoản Withdraw cũ vẫn giữ trong lịch sử |
| **Quyền của từng mục** | Cài đặt riêng của Account, Thấu chi: bật/tắt Thu, Chi, Transfer, Get In. Account, Thấu chi, Tiết kiệm: công tắc cho phép trừ tiền khỏi tài khoản. Tiết kiệm có Transfer và Get In |
| **Account** | Sổ thu/chi có 1 tài khoản ngân hàng và số dư. Biểu tượng chọn từ huy hiệu ngân hàng Việt Nam (màu đặc trưng + tên viết tắt, tự chọn theo tên ngân hàng) hoặc emoji; tên gợi nhớ để trống thì dùng tên ngân hàng. Ô chọn tài khoản khi tạo giao dịch hiện kèm số tài khoản |
| **Thấu chi** | Nhập hạn mức và số dư lúc tạo, sau đó không sửa được (xóa rồi tạo lại). Thu/Chi và Transfer như Account, được âm số dư, vẫn cộng vào tổng Ngân hàng. Tiền ra hoặc vào vượt hạn mức thì cảnh báo, không chặn |
| **Tiết kiệm** | Chỉ Transfer và Get In với Account/Thấu chi |
| **Credit Card** (thẻ tín dụng) | Tạo mới nhập hạn mức âm tối đa và số nợ hiện tại; Chi vượt hạn mức bị chặn. Có Thu/Chi, luôn hiện số âm, hết nợ là 0. Nút Thanh toán trả một phần hoặc toàn bộ từ Account. Nhận Transfer từ Account/Thấu chi và Get In từ Account/Thấu chi, không chuyển tiền ra và không bị Get In; form hiện số đang nợ, không cho thu hoặc trả vượt số nợ. Tổng quan hiện tổng nợ thẻ |
| **Ví (bản cũ)** (không tạo mới; ví cũ vẫn dùng được) | Không có số dư: ghi khoản chi (số tiền, danh mục, nội dung), rồi thanh toán từng khoản hoặc tất cả từ mục Account. Cài đặt thẻ có nhắc trích trả nợ theo ngày và giờ, gồm các khoản chưa trả trước tháng hiện tại |
| **User đặc biệt** | Đã bỏ từ v7.22.5 (cùng Personal / Family). Dữ liệu cũ giữ nguyên; Account gốc của User đặc biệt được bật sẵn quyền NEOBANK |
| **Kế hoạch** | Ngân sách, Mục tiêu, Trả nợ, Định kỳ. Khoản định kỳ: Chi, Thu, Transfer, Get In (Tiết kiệm chỉ Transfer/Get In), chọn ngày bắt đầu, tự động ghi hoặc chờ xác nhận có giờ thông báo; khi xác nhận hiện số tiền đã đặt để sửa và ghi rõ tiền ra từ đâu, vào đâu. Lúc thanh toán khoản Trả nợ, số tiền điền sẵn theo thiết lập và sửa được cho riêng kỳ đó |
| **Nhắc nhở** | Theo từng User, tối đa 9, tạo ở cuối màn hình nút góc phải Tổng quan. Có tên, ngày đến hạn, giờ nhắc, số ngày nhắc trước; lặp theo ngày, tuần hoặc tháng với số kì lặp (để trống là không giới hạn). Nhắc nhở cũ trong từng mục tự chuyển lên User |
| **Notifications** | Trả nợ và Nhắc nhở hiện từ đúng ngày giờ đã chọn (hạn trừ số ngày nhắc trước), giữ đến khi thanh toán hoặc bấm Done. Tổng quan hiện 2 thông báo dưới dòng Nợ thẻ (mỗi dòng 1 cái, dài thì có ...), 5 giây đổi sang 2 cái kế tiếp, xoay vòng |
| **Thống kê ở Tổng quan** | Tối đa 3 thống kê mỗi mục Account/Tiết kiệm, loại Transfer/Get In hoặc Thu/Chi, đặt được tên và biểu tượng, số liệu trong ngày. Trong Cài đặt của mục, mỗi thống kê có công tắc ẩn/hiện ở Tổng quan; công tắc ở dòng tiêu đề chỉ thu gọn danh sách |
| **Nút nhanh** | Tạo trong Cài đặt của mục, tên tối đa 12 ký tự (luôn hiện đủ: chữ tự thu nhỏ cho vừa nút, quá hẹp thì xuống 2 dòng), icon theo loại (mặc định 💸 Chi, 💰 Thu, 🤝 Transfer, 🔄 Get In; đổi được trong Cài đặt chung → Icon giao dịch, có sẵn 5 cặp tiền ra/tiền vào, tên chức năng cố định). Tối đa Account/Thấu chi 6, Tiết kiệm 3, Thẻ 6; Account đã bật giao dịch NEOBANK 12. Hiện ở Tổng quan, mỗi dòng tối đa 3 nút, chia đều các dòng, tối đa 2 dòng (Account bật NEOBANK 4 dòng). Mỗi nút có công tắc ẩn/hiện ở Tổng quan; công tắc ở dòng tiêu đề chỉ thu gọn danh sách. Nút luôn xếp theo Chi, Thu, Transfer, Get In. Dưới cụm nút luôn hiện 5 giao dịch gần nhất (có nút ẩn/hiện); khoản mới trong 10 phút có nút Recall để hủy |
| **Nhập số tiền** | Tự thêm dấu chấm hàng nghìn, nút **+000** bên phải ô, đề xuất số tiền ngay dưới ô. Ngày cố định là hôm nay khi ghi mới, chỉ sửa khi mở lại giao dịch |
| **Phần đầu cố định** | Khi cuộn, phần đầu đứng yên: Tổng quan đến dòng thẻ Account, Thấu chi…; Giao dịch và Báo cáo đến dòng Ngày/Tuần/Tháng; Kế hoạch đến dòng thẻ Ngân sách, Mục tiêu…; Cài đặt của mục đến ngay trên nhóm đầu tiên; Cài đặt chung đến hết danh sách chọn User |
| **Giao dịch** | Lọc theo kỳ, loại và nhiều danh mục đã có trong lịch sử; tìm kiếm; xuất CSV |
| **Báo cáo** | Theo ngày, tháng, quý, năm hoặc khoảng tự chọn; biểu đồ theo thời gian và danh mục |
| **Giao diện** | Mỗi loại tài khoản một màu (Account cam, Thấu chi xanh nhạt, Tiết kiệm xanh lá, Thẻ đỏ) ở tab, nút +, viền thẻ tài khoản, tiêu đề và nút Đóng. Số tiền thẳng cột. Phần đầu thu gọn khi cuộn. Nút 👁 che số dư (thu, chi, giao dịch, chênh lệch vẫn hiện). Mỗi lần mở app hoặc mở khóa: 7:00–20:00 chế độ sáng, 20:00–7:00 chế độ tối (nút 🌙 vẫn đổi được trong lúc dùng). Mọi bộ chọn icon có thêm huy hiệu ngân hàng. Cặp icon tiền ra/vào chưa rõ màu có nền đỏ nhạt (Chi, Transfer) / xanh lá nhạt (Thu, Get In) |
| **Tìm kiếm chung** | Nút 🔎 ở Tổng quan: tìm theo ghi chú, danh mục, tên tài khoản, tag hoặc số tiền trong mọi tài khoản của User; bấm kết quả mở đúng ngày của giao dịch |
| **Báo cáo thêm** | Biểu đồ tổng tài sản của User 12 tháng (Account + Thấu chi + Tiết kiệm − nợ thẻ). Nút 🖼️ tạo ảnh tóm tắt thu chi của kỳ đang xem để chia sẻ hoặc lưu |
| **Nhắc sao lưu** | Quá 7 ngày chưa sao lưu (hoặc chưa sao lưu lần nào) thì hiện trong Notifications và dòng thông báo ở Tổng quan |
| **Face ID / Touch ID** | Bật trong Cài đặt chung → Bảo mật (chỉ hiện khi máy hỗ trợ). Mở app là tự hỏi Face ID; không nhận diện được 2 lần thì hiện bàn phím nhập mật khẩu |
| **Khóa app** | Mật khẩu số khi mở app (mặc định `2024`, nên đổi trong Cài đặt), khóa riêng từng mục được |
| **Dữ liệu** | Sao lưu **tất cả** vào 1 file `.json` và khôi phục từ file đó; nút Save nhanh. Mỗi lần lưu phải đặt mật khẩu 4 số, file được mã hóa (PBKDF2 + AES-GCM); khôi phục phải nhập đúng mật khẩu. Quên mật khẩu thì không mở được file. File cũ không có mật khẩu vẫn khôi phục được |

## 1. Chạy thử trên máy tính

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Mở `http://localhost:8080` bằng Chrome hoặc Edge. Bấm F12, chọn biểu tượng điện thoại để xem giao diện mobile.

## 2. Cài lên điện thoại

**iPhone (iOS 16.4+ khuyến nghị)**
1. Mở link app bằng **Safari**.
2. Bấm nút **Chia sẻ** của Safari, chọn **Thêm vào MH chính**, rồi bấm **Thêm**.
3. Mở app từ icon "Thu Chi". Từ đây app chạy offline.

**Android**
1. Mở link app bằng **Chrome**.
2. Bấm menu ⋮, chọn **Cài đặt ứng dụng** (hoặc **Thêm vào màn hình chính**).

## 3. Cập nhật app sau khi sửa code

1. Mở `sw.js`, tăng số phiên bản ở dòng `const VERSION = '...';`. Không tăng thì điện thoại vẫn giữ bản cũ.
2. Trên GitHub, vào đúng thư mục (`js`, `css` hoặc thư mục gốc), chọn **Add file → Upload files**, kéo file đã sửa vào rồi bấm **Commit changes**. Không cần tải `.nojekyll` (file rỗng).
3. Đợi GitHub Pages cập nhật xong. Trên điện thoại, mở app khi có mạng, đóng hẳn rồi mở lại, có thể phải làm 2 lần. Dữ liệu vẫn giữ nguyên.

## 4. Lưu ý quan trọng

- **Sao lưu định kỳ.** Xóa app khỏi màn hình chính hoặc xóa dữ liệu trình duyệt sẽ **mất dữ liệu**. Trên iPhone, file sao lưu lưu qua bảng Chia sẻ, không tự ghi vào một file đã chọn.
- **Thông báo khi app đóng:** ứng dụng web không tự báo được. Hãy bấm **Thêm vào Lịch** ở khoản Trả nợ hoặc Nhắc nhở để app Lịch đổ chuông đúng giờ. Đổi giờ thì phải thêm lại vào Lịch.
- **Repo Public:** ai có link cũng xem được **mã nguồn**, nhưng **không xem được dữ liệu**, vì dữ liệu chỉ nằm trên điện thoại.

## Cấu trúc mã nguồn

```
index.html            khung trang + thanh tab
manifest.webmanifest  thông tin cài đặt PWA
sw.js                 service worker: cache để chạy offline, chứa VERSION
css/app.css           giao diện (sáng/tối theo giờ khi mở app; nút 🌙 ở màn hình nút góc phải)
js/app.js             khởi động, điều hướng, thông báo
js/views.js           các màn hình và form
js/store.js           nghiệp vụ: số dư, Transfer/Get In, Personal/Family, thông báo, sao lưu
js/db.js              lưu trữ IndexedDB
js/ui.js              thành phần dùng chung: ô tiền, ô ngày, bottom sheet, chọn kỳ
js/utils.js           định dạng tiền/ngày, đọc số tiền gõ tắt, kỳ thời gian
js/charts.js          biểu đồ SVG
js/icons.js           thư viện biểu tượng có tìm kiếm
js/ics.js             tạo file lịch .ics
js/lock.js            khóa app bằng mật khẩu
js/autosave.js        lưu file sao lưu
js/voice.js           không còn dùng (nhập giọng nói đã bỏ khỏi giao diện)
icons/                icon app
serve.ps1             server chạy thử trên máy tính
```
