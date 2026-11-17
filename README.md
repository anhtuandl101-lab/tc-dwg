# TC DWG

Ứng dụng Android xem bản vẽ AutoCAD DWG, DXF ngay trên điện thoại, không cần mạng: bật tắt layer, đo chiều dài và diện tích có bắt điểm, ghi chú, xuất PDF hoặc ảnh, đổi chữ TCVN3/VNI sang Unicode.

Phát triển bởi C.S.O (Công ty Cổ phần Tư vấn Quản lý Dự án và Xây dựng C.S.O, Đà Nẵng).

## Giấy phép

Phần mềm tự do theo **GNU General Public License phiên bản 3 hoặc mới hơn** (xem `LICENSE`), vì ứng dụng dùng thư viện [LibreDWG](https://www.gnu.org/software/libredwg/) qua bản đóng gói WebAssembly [mlightcad/libredwg-web](https://github.com/mlightcad/libredwg-web). Không kèm bất kỳ bảo đảm nào.

DWG là định dạng tệp của AutoCAD; AutoCAD là nhãn hiệu của Autodesk, Inc. Dự án này không liên kết với Autodesk.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `ban-cai/` | Ứng dụng web: `app.js` (giao diện, đo, ghi chú, xuất), `worker.js` (đọc file trong luồng nền), `chuyen-doi.js` (dữ liệu DWG thành nét vẽ), `ve.js` (vẽ canvas), `dxf.js` (đọc DXF), `ma-viet.js` (đổi mã chữ Việt), `lib/` (libredwg-web đã chỉnh), `wasm/` (lõi LibreDWG build lại) |
| `android-app/` | Dự án Capacitor 7 đóng gói `ban-cai/` thành app Android |
| `libredwg/` | `tcdwg.patch`: các sửa đổi so với `mlightcad/libredwg-web` tag `v0.8.2`; `build-tcdwg.sh`: script build lõi WASM bằng Emscripten |

## Build

Lõi WASM:

```
git clone https://github.com/mlightcad/libredwg-web && cd libredwg-web
git checkout v0.8.2
git apply ../libredwg/tcdwg.patch
cp ../libredwg/build-tcdwg.sh . && bash build-tcdwg.sh dlmalloc 64MB out-dlmalloc
```

(Sửa đường dẫn Emscripten, CMake, Ninja ở đầu `build-tcdwg.sh` theo máy của bạn.) Chép `out-dlmalloc/libredwg-web.{js,wasm}` vào `ban-cai/wasm/`.

App Android (cần JDK 21, Android SDK 36, Node.js):

```
cd android-app
npm install
node copy-web.js && npx cap sync android
cd android && ./gradlew assembleDebug
```

## Những gì đã sửa trong LibreDWG

- Thu gọn bộ nhớ khi đọc (bỏ dữ liệu mở rộng EED không dùng, thu bảng đối tượng).
- Đọc được file R2004 có trang dữ liệu trống (trước đây bị từ chối cả phần).
- Sửa chuỗi văn bản file R2004 trở về trước bị đọc nhầm thành UTF-16.
- Tăng ngăn xếp WASM lên 8 MB, bỏ `ostringstream` trong binding để tránh lỗi khi khởi tạo.

Chi tiết từng dòng trong `libredwg/tcdwg.patch`.
