# Thông báo sự cố thiết bị IoT

Bảng `device_incidents` quản lý chung SENSOR, NODE và MASTER.

## Triển khai

- Database mới: dùng `database.sql`, đã có bảng `device_incidents`.
- Database hiện có: chạy `020_device_incidents.sql` nếu chưa có bảng sự cố, sau đó
  chạy `023_auto_resolve_master_incidents.sql` trước khi khởi động backend mới.
  Migration 023 đã bao gồm tự phục hồi cho cả MASTER, NODE và SENSOR.
- Migration 020 tạo một bảng chung `device_incidents` cho SENSOR, NODE và MASTER.
  Không có bảng sự cố cảm biến riêng hoặc bước chuyển đổi bảng cũ.

## Phát hiện và người nhận

Worker `deviceIncident.worker.js` quét mỗi 10 giây, độc lập với AUTO, với tầng ACTIVE
đã cập nhật mapping quá 60 giây. Mỗi node có ba cảm biến địa chỉ 1–3.

| Loại | Phát hiện | Phạm vi Customer |
| --- | --- | --- |
| MASTER | Không có bản tin live trong 60 giây hoặc offline mới bằng/sau bản tin live cuối | Các tầng ACTIVE dùng master |
| NODE | Master còn hoạt động nhưng node không có bản tin sensor live trong 60 giây | Tầng của node |
| SENSOR | Master/node còn liên lạc nhưng sensor lỗi, thiếu, retained hoặc dữ liệu quá 60 giây | Tầng của sensor |

Firmware chưa có heartbeat/status riêng cho node. NODE_NO_TELEMETRY là dấu hiệu
mất liên lạc cần kiểm tra, không khẳng định mạch hỏng. Bản tin sensor `is_valid=false`
vẫn chứng minh node truyền dữ liệu. Mất kết nối backend/MQTT cũng có thể gây cảnh báo.

Master lỗi thì không mở thêm lỗi node/sensor trong lần quét; node lỗi thì không mở
thêm lỗi sensor của node. Các sự cố con đã mở trước đó vẫn giữ để nhân viên xử lý.
Mỗi thiết bị chỉ có một sự cố OPEN. Sau RESOLVED, lỗi mới tạo hồ sơ mới.
MASTER, NODE và SENSOR tự chuyển sang RESOLVED khi đạt điều kiện phục hồi bên dưới.
Bản tin chứng minh phục hồi phải mới hơn thời điểm phát hiện và còn mới trong 60 giây.
`auto_resolved=true`, `resolved_by=null`, `resolved_at` là thời điểm hệ thống xác nhận.
Mỗi lần chuyển trạng thái tạo một thông báo “đã phục hồi” cho mỗi người nhận.
Thông báo cũ trả trạng thái RESOLVED khi tải lại API. Lỗi tiếp theo tạo sự cố mới.
Nếu phục hồi rồi mất kết nối hoàn toàn giữa hai lần quét, worker có thể không thấy
giai đoạn phục hồi. Sự cố cũ đang offline không được tự đóng khi triển khai.
Lỗi thoáng qua giữa hai lần quét có thể không được ghi nhận. Ngưỡng thông báo không
thay đổi ngưỡng an toàn AUTO.

Tất cả Admin, Farm Operator ACTIVE nhận thông báo. Customer phải ACTIVE, có phiên
trồng chưa kết thúc và khay ACTIVE trong phạm vi ảnh hưởng. Nhiều khay/phiên của cùng
Customer chỉ nhận một thông báo. Hiện chưa phân công Farm Operator theo tầng.

Customer được báo thiết bị đang gặp vấn đề và nhân viên sẽ kiểm tra, sửa chữa ngay.
Nhân viên nhận thêm vị trí, mã lỗi và yêu cầu kiểm tra, sửa chữa; không cần bấm xác nhận.

## API và giao diện

`GET /api/notifications` trả `reference_type=DEVICE_INCIDENT`, `reference_id` là ID
sự cố, và `device_incident`, gồm:

- `device_type`: SENSOR, NODE hoặc MASTER.
- `incident_id`, `master_id`, `floor_id`, `node_address`, `sensor_address`, `reason`.
- `status`: OPEN hoặc RESOLVED; `detected_at`, `resolved_at`, `resolved_by`, `repair_note`.
- `auto_resolved`: true khi backend tự xác nhận thiết bị đã phục hồi.
- `can_confirm_repair`: luôn false; mobile ẩn nút xác nhận thủ công.

MASTER có floor_id/node_address/sensor_address=null; NODE có sensor_address=null.
SENSOR có đủ master/node/tầng/sensor. MASTER là một sự cố chung, không nhân bản theo tầng.

`PATCH /api/notifications/:notificationId/confirm-repair` chỉ giữ để tương thích
mobile cũ. Vẫn kiểm tra quyền Operator/sở hữu, nhưng dùng cùng logic tự phục hồi,
không ghi nhận xác nhận thủ công hoặc ghi chú sửa chữa. Mobile mới không cần gọi API này.

Backend yêu cầu bằng chứng phục hồi mới trong 60 giây:

- MASTER: bản tin live mới và không có offline mới bằng/sau bản tin live cuối.
- NODE: master hoạt động và ít nhất một bản tin sensor live mới, không retained.
- SENSOR: master hoạt động và bản tin sensor hợp lệ mới, không retained.

Node liên lạc trở lại không có nghĩa mọi sensor đã sửa. Nếu chưa phục hồi trả 409;
sai vai trò 403, không sở hữu thông báo 404, ID/ghi chú sai 400.

Sau khi tự phục hồi, tải lại danh sách và hiện **Đã phục hồi** cùng thời gian hệ thống
xác nhận. Quét hoặc gọi API lặp không gửi trùng. Đánh dấu đã đọc không tự đóng sự cố.

Thông báo phục hồi gửi tới Admin, Farm Operator ACTIVE và những người nhận ban đầu
còn ACTIVE, kể cả Customer có phiên trồng vừa kết thúc. Tạo/đóng sự cố và thông báo nằm cùng transaction với khóa
PostgreSQL để đồng bộ nhiều backend process. Khi DB lỗi, worker thử lại chu kỳ sau.
Thông báo lưu trong ứng dụng; frontend tải lại API để cập nhật, chưa có push/email.

## Trạng thái cảm biến hiện tại

API danh sách/chi tiết IoT sensor tính `ok` tại thời điểm truy vấn: master phải còn
live, bản tin sensor hợp lệ, không retained và không quá 60 giây. `readingValid`
giữ tính hợp lệ của bản tin cuối; `healthReason` là `MASTER_OFFLINE`, `RETAINED`,
`STALE`, `INVALID` hoặc null khi khỏe. Giá trị nhiệt độ/độ ẩm cũ vẫn giữ để tham
khảo, không chứng minh thiết bị còn hoạt động. `ok` của API lịch sử vẫn biểu thị
tính hợp lệ của từng bản tin lịch sử. Timestamp API dùng ISO UTC; UI đổi sang múi
giờ Việt Nam khi hiển thị.
