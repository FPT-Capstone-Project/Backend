# Quạt thủ công theo tầng

Chạy migration `migrations/022_add_floor_fan_channel.sql` trước khi sử dụng API mới.
Mỗi tầng có một `fan_ssr_channel`, mặc định `null`. Không cần tạo thêm tầng hoặc
gán sẵn kênh 4/5. Chức năng này không tạo quy tắc tự động cho quạt.

## Hiển thị trên màn hình điều khiển

Các request dùng JWT như API IoT hiện tại:

1. `GET /api/iot/floors` trả về `{ data: [...] }`. Lọc theo `room_id` đã chọn.
   Tạo một thẻ quạt cho **mọi tầng**, kể cả khi `fan_ssr_channel === null`.
   Dùng `floor_name` để đặt tên, ví dụ “Quạt tầng 1”, “Quạt tầng 2”.
2. `GET /api/iot/masters` trả về `{ data: [...] }`. Ghép `floor.master_id`
   với `master.id` để lấy `master.masterId` (chuỗi như `master01`).
3. Nếu kênh trống: hiện “Chưa cấu hình kênh”, nút “Cấu hình quạt”, vô hiệu hóa
   bật/tắt. Không bỏ ẩn thẻ và không hiển thị trạng thái “Tắt” khi chưa biết.
4. `PUT /api/iot/floors/1/fan` với `{ "channel": 4 }` gán kênh; `{ "channel": null }`
   bỏ cấu hình. API trả `{ data: <tầng đã cập nhật> }`. Chỉ người có quyền
   `iot.automation.manage` được cấu hình. Kênh 1–8, không trùng van/đèn/quạt trên
   cùng master. Endpoint này chỉ cần trường `channel`, không cần gửi lại cả tầng.
5. `GET /api/iot/masters/master01/ssr` trả `{ data: { masterId, channels } }`.
   Tìm phần tử có `channel === floor.fan_ssr_channel`, lấy `reportedState`
   và `lastReportedAt` để hiển thị trạng thái. `null` là chưa có phản hồi.
6. Nút bật/tắt gọi `POST /api/iot/masters/master01/ssr/4/commands` với
   `{ "action": "ON" }` hoặc `{ "action": "OFF" }`. Đây là API điều khiển
   SSR chung đang dùng cho van và đèn. Không gọi API auto-control cho quạt.
   `PUBLISHED` chỉ xác nhận broker nhận lệnh; tiếp tục đọc SSR để cập nhật
   trạng thái phản hồi, không tự coi thiết bị đã bật/tắt thành công.

Trước khi đổi/bỏ kênh đang dùng, tắt thiết bị ở kênh cũ và kiểm tra phản hồi.
API cấu hình không gửi lệnh tắt. Giao diện phải được cập nhật ở dự án frontend;
thay đổi backend không tự tạo thêm thẻ trên màn hình.
