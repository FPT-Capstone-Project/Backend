# Quạt trong AUTO của tầng

Quạt dùng chung cấu hình, phiên chạy và nút bắt đầu/dừng AUTO hiện có. Phun sương
vẫn theo điều kiện cảm biến; quạt lặp theo thời gian chạy rồi nghỉ trong cùng phiên.
Không có API khởi động quạt riêng hoặc bảng dữ liệu riêng cho AUTO quạt.

## Cấu hình và sử dụng

- Trong cấu hình AUTO của tầng, bật **Cho quạt chạy cùng AUTO**, nhập thời gian chạy
  và nghỉ theo phút nguyên từ 1 đến 1440 (60 phút = 1 giờ). Tầng phải đã gán kênh quạt.
- Lưu cấu hình không bật thiết bị. Dùng nút bắt đầu AUTO hiện có; chế độ mô phỏng áp
  dụng cho cả phun sương và quạt. Dừng AUTO dừng cả hai thiết bị.
- `fan_enabled`, `fan_run_minutes`, `fan_rest_minutes` thuộc
  `iot_auto_control_configs`; được chụp trong `config_snapshot` của phiên AUTO.
- Các cột `fan_*` thuộc `iot_auto_control_runtime` lưu trạng thái và thời hạn chu kỳ.
  Nhật ký `FAN_*` ghi trong `iot_auto_control_logs` với cùng `run_id`.
- API cấu hình/start/stop/status/logs AUTO hiện có được giữ nguyên đường dẫn.
  Status thêm đối tượng `fan`; không còn đường dẫn `fan-auto`.

## Migration

Áp dụng `022_add_floor_fan_channel.sql` và `030_add_fan_auto_control.sql` trước khi
chạy backend mới. Database mới có sẵn các cột này trong `database.sql`.
Migration 030 chỉ bổ sung cột vào các bảng AUTO hiện có.

Nếu đã áp dụng bản 030 cũ tạo bảng quạt riêng, phải dừng phiên quạt cũ và xác nhận
OFF trước khi chạy lại bản 030 mới. Migration từ chối chuyển khi quạt còn chạy;
khi đã dừng, lưu cấu hình/nhật ký cũ vào nhật ký AUTO, chuyển thời gian chạy/nghỉ
cho các tầng đã có cấu hình AUTO, rồi xóa hai bảng quạt cũ. Quạt mặc định chưa
được bật trong cấu hình chung, cần kiểm tra và lưu lại. Migration chạy lại được.

## Điều khiển thiết bị

Giữ kiểm tra an toàn phun sương hiện có. Để chạy quạt thật, cần thiết bị trực tuyến
và khai báo `FAN_AUTO_REAL_ENABLED=true`, `FAN_AUTO_VERIFIED_WATCHDOGS`, ví dụ
`{"master01/4":300000}` chỉ sau khi xác minh bộ tự ngắt của kênh 4 trong 5 phút.
Đây là khai báo khả năng đã kiểm chứng, không lập trình watchdog cho firmware.
Thời gian chạy không được vượt giới hạn tự ngắt đã khai báo.

Quạt xác nhận OFF trước ON; chỉ phản hồi trực tiếp mới được chấp nhận. Hạn bật
không kéo dài theo phản hồi chậm. Thiếu xác nhận ON sau 5 giây sẽ yêu cầu OFF.
Thời gian nghỉ tính sau xác nhận OFF. Mất kết nối/khởi động lại bỏ lượt chạy dở,
xác nhận OFF rồi nghỉ đủ chu kỳ; không chạy bù. Dừng hoặc OFF thủ công trên kênh
đang do AUTO quản lý kết thúc phiên chung; không tự bật lại. Chặn đổi cấu hình
và gán lại thiết bị đến khi xác nhận tắt hoàn tất.

Kiểm thử phần mềm dùng cơ sở dữ liệu cô lập và MQTT giả lập. Cần kiểm tra phản hồi,
chu kỳ, dừng, mất MQTT và bộ tự ngắt trên thiết bị thật trước vận hành.
