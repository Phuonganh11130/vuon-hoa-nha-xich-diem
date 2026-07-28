# 🌸 Vườn Hoa Tiên Cảnh — Sổ Hoa Sở Hữu

Web app tra cứu **Danh Sách Hoa** và **Thành Viên**, xây dựng bằng HTML/CSS/JS
thuần (không cần build tool, không phụ thuộc thư viện ngoài). Dữ liệu được đọc
trực tiếp từ hai file CSV lúc chạy trong trình duyệt.

## Tính năng

- 🔍 **Tìm kiếm** hoa theo tên / mã ID, tìm thành viên theo tên game / Zalo
- 🎛️ **Lọc** hoa theo hạng màu (Đỏ / Cam / Tím / Lam), trạng thái (Đã Có / Chưa Có),
  đã có chủ hay chưa
- ↕️ **Sắp xếp** theo mã ID, tên (A→Z / Z→A), số lượng chủ sở hữu / số hoa sở hữu
- 🌺 **Trang chi tiết Hoa**: hạng màu, trạng thái, danh sách **tên** chủ sở hữu
  (liên kết sang trang thành viên)
- 👤 **Trang Thành Viên**: danh sách & trang chi tiết từng thành viên với toàn bộ
  hoa họ đang sở hữu (liên kết ngược sang trang hoa)
- 🌸 **Danh Sách Hoa** hiển thị trực tiếp **tên các thành viên** đang sở hữu mỗi
  đóa hoa (thay vì chỉ đếm số lượng)
- ✏️ **Cập nhật hoa sở hữu**: trên trang chi tiết thành viên, bấm "Cập nhật hoa
  sở hữu" để tick/bỏ tick từng đóa hoa (có tìm kiếm + lọc theo hạng màu ngay
  trong lúc sửa), bấm **Lưu thay đổi** để áp dụng ngay trên toàn bộ trang
- ⬇️ **Xuất CSV cập nhật**: trang Thành Viên có nút tải về `Thanh_Vien_cap_nhat.csv`
  chứa toàn bộ chỉnh sửa, để thay thế vào `data/members.csv` và deploy lại
  (xem mục "Lưu chỉnh sửa vĩnh viễn" bên dưới)
- 🔗 **Quan hệ hai chiều** giữa `Danh_Sách_Hoa.csv` (cột `List Acc`) và
  `Thành_Viên.csv` (cột `ID_Hoa_So_Huu`) được đối chiếu và hợp nhất tự động
- 📱 **Responsive**: thanh tab trên cùng ở desktop, thanh điều hướng dưới cùng
  trên di động

## Lưu chỉnh sửa vĩnh viễn

Trang này là web tĩnh (không có server/database), nên khi bạn tick chọn hoa cho
một thành viên, thay đổi chỉ được lưu **trong trình duyệt hiện tại**
(`localStorage`) — người khác mở trang sẽ không thấy thay đổi đó, và nếu bạn
xoá dữ liệu duyệt web thì thay đổi cũng mất.

Để chỉnh sửa có hiệu lực với **mọi người** truy cập trang:

1. Vào trang **Thành Viên**, bấm **⬇️ Xuất CSV cập nhật** để tải về
   `Thanh_Vien_cap_nhat.csv` (đã gộp toàn bộ chỉnh sửa của bạn).
2. Đổi tên file này thành `members.csv` và ghi đè lên file cũ trong thư mục
   `data/`.
3. Commit & push lên GitHub (hoặc tải lại lên nơi bạn đang host) — sau khi
   GitHub Pages build lại, dữ liệu mới sẽ hiển thị cho tất cả mọi người.

## Cấu trúc thư mục

```
├── index.html          Khung trang + điều hướng
├── style.css            Toàn bộ giao diện (thiết kế "vườn hoa tiên cảnh")
├── app.js                Toàn bộ logic: đọc CSV, tìm/lọc/sắp xếp, định tuyến
├── data/
│   ├── flowers.csv       = Danh_Sách_Hoa.csv (giữ nguyên tên cột)
│   └── members.csv       = Thành_Viên.csv (giữ nguyên tên cột)
└── assets/
    ├── do011.jpg         Ảnh minh hoạ cho hoa "Ngân Hà Chiếu Nhụy" (Do011)
    └── do013.jpg         Ảnh minh hoạ cho hoa "Thiên Cung" (Do013)
```

Các hoa khác chưa có ảnh sẽ hiển thị khối màu theo hạng (Đỏ/Cam/Tím/Lam) kèm
biểu tượng 🌸 thay thế.

## Cập nhật dữ liệu

Chỉ cần chỉnh sửa hai file trong thư mục `data/` (giữ nguyên tên cột), rồi
tải lại trang — không cần sửa code:

- `data/flowers.csv` — cột: `ID_Hoa, Name, flower_color, List Acc, Image, Trạng Thái`
- `data/members.csv` — cột: `ID_Acc, Tên Game, Zalo, ID_Hoa_So_Huu`

Muốn thêm ảnh cho một đóa hoa: bỏ ảnh vào `assets/`, rồi thêm một dòng vào
`FLOWER_IMAGES` ở đầu `app.js`, ví dụ:

```js
const FLOWER_IMAGES = {
  'Do011': 'assets/do011.jpg',
  'Do013': 'assets/do013.jpg',
  'Cam001': 'assets/cam001.jpg', // thêm dòng mới ở đây
};
```

## Chạy thử ở máy local

Vì trang gọi `fetch()` để đọc file CSV, cần chạy qua một web server (mở trực
tiếp bằng `file://` sẽ bị chặn bởi trình duyệt). Cách đơn giản nhất:

```bash
cd hoa-app
python3 -m http.server 8080
# rồi mở http://localhost:8080
```

hoặc dùng bất kỳ static server nào khác (VS Code "Live Server", `npx serve`, …).

## Deploy lên GitHub Pages

1. Tạo một repository mới trên GitHub (ví dụ `vuon-hoa-tien-canh`).
2. Đẩy toàn bộ nội dung thư mục này lên nhánh `main`:
   ```bash
   git init
   git add .
   git commit -m "Sổ hoa sở hữu"
   git branch -M main
   git remote add origin https://github.com/<tên-bạn>/vuon-hoa-tien-canh.git
   git push -u origin main
   ```
3. Vào repo trên GitHub → **Settings → Pages**.
4. Ở mục **Build and deployment**, chọn **Source: Deploy from a branch**,
   **Branch: `main` / `(root)`** → **Save**.
5. Sau khoảng 1 phút, trang sẽ có tại:
   `https://<tên-bạn>.github.io/vuon-hoa-tien-canh/`

Ứng dụng dùng hash routing (`#/hoa`, `#/thanhvien/…`) nên chạy tốt trên GitHub
Pages mà không cần cấu hình rewrite/404 gì thêm.

## Ghi chú kỹ thuật

- Không phụ thuộc CDN hay thư viện ngoài — toàn bộ parser CSV được viết tay
  (hỗ trợ dấu ngoặc kép, dấu phẩy trong trường dữ liệu, xuống dòng CRLF/LF),
  nên trang chạy ổn định kể cả khi mất mạng ngoài hoặc CDN bị chặn.
- Phông chữ hiển thị dùng Google Fonts (Cormorant Garamond + Be Vietnam Pro)
  qua `<link>` trong `index.html`; nếu không tải được, trình duyệt sẽ tự
  dùng phông hệ thống thay thế, giao diện vẫn hoạt động bình thường.
