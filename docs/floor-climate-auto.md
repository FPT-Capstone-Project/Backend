# AUTO theo tầng: tích hợp mobile

## Triển khai

Database mới: chạy `database.sql`. Database đã tạo theo bản schema chỉnh sửa có
`tray_positions`, `position_id`, `total_rows`, `total_columns`: chạy
`migrations/012_restore_auto_control_integrity.sql` trước khi khởi động backend.
Không chạy lại các migration tạo bảng 004/005/007/009 trên schema đã có đủ bảng/cột.

Migration 012 khôi phục UNIQUE cho SSR `(master_id, channel)`, mapping tầng/node/kênh,
một phiên AUTO RUNNING mỗi tầng, kiểm tra khoảng điều kiện và các trigger bảo vệ
phòng của master, kênh đèn/van. Nếu dữ liệu hiện có trùng hoặc không hợp lệ,
migration báo lỗi và rollback; cần sửa các bản ghi đó trước khi chạy lại.
Migration không tạo thiết bị, đổi mapping, bật van hoặc tự tạo phiên AUTO.
Master phải được khai báo trong `iot_masters` với đúng `master_identifier` của firmware
và `cultivation_room_id`; không còn giả định database tự tạo sẵn `master01`.

Các API trả kết quả trong `{ "data": ... }`. Mapping, gán khay, lấy gợi ý,
lưu, Start, Stop và Evaluate yêu cầu JWT và quyền `iot.automation.manage`.
Migration 012 cấp quyền này theo tên role Admin/Farm Operator, không cấp Customer.
Nếu tạo role sau khi khởi tạo database, chạy lại migration 012 để cấp quyền.
Các API đọc cũ vẫn giữ yêu cầu đăng nhập như trước.

## Luồng màn hình

1. Chọn phòng và tầng. Tạo mapping bằng `POST /api/iot/floors`, hoặc sửa bằng
   `PUT /api/iot/floors/:floorId`. Gán đúng `master_id` (ID database),
   `node_address`, `misting_ssr_channel`. Có thể gửi thêm `total_rows`, `total_columns`
   (1–32767 hoặc null). Khi sửa, bỏ qua trường kích thước sẽ giữ nguyên giá trị;
   không được thu nhỏ hơn các vị trí đã khai báo. Không suy ra kênh van từ số tầng.
2. Gán các khay cùng phòng bằng `PUT /api/iot/floors/:floorId/trays/:trayId`.
   Body tùy chọn `{"position_id":123}` chọn vị trí đã khai báo trong `tray_positions`;
   vị trí phải ACTIVE, còn trống, thuộc tầng/phòng và nằm trong kích thước tầng.
   `{"position_id":null}` gỡ vị trí nhưng giữ tầng; bỏ body/field giữ nguyên vị trí.
   Dừng AUTO và hoàn tất xác nhận OFF trước khi gán.
3. Khách tạo đơn tại `POST /api/orders/cultivation` với loại nấm, gói và số khay.
   Sau khi PayOS xác nhận thanh toán, backend tạo session ACTIVE theo order item,
   gắn từng khay qua `cultivation_session_trays`, và chuyển khay sang OCCUPIED.
   Farm Operator không cần tạo session hoặc chọn lại loại nấm thủ công.
4. Gọi `GET /api/iot/floors/:floorId/auto-control/suggestions`.
5. Hiển thị `common`, `sourceProfiles`, `warnings`. Nếu `config=null`,
   hiển thị `issues` và chưa cho lưu gợi ý. Nếu có config, dùng nó để điền form.
6. Người vận hành xem lại preset, đặt tên profile, xác nhận duyệt; gửi **chỉ object
   config** với `profile_approved:true` đến `PUT /api/iot/floors/:floorId/auto-control`.
   Không gửi `sourceProfiles`, `common`, hoặc toàn bộ response.
7. Bấm Start riêng: `POST .../auto-control/start` với `{"dryRun":true}` để mô phỏng,
   hoặc `{"dryRun":false}` khi muốn chạy thiết bị thật.
8. Theo dõi `GET .../auto-control/status` và `GET .../auto-control/logs`.

Farm Operator ghi nhận kiểm tra mỗi khay tại
`POST /api/cultivation-sessions/admin/session-trays/:sessionTrayId/inspections`;
mỗi lần kiểm tra lưu `cultivation_inspections` và cập nhật lịch sử
`cultivation_progress` của session.

`GET .../auto-control` cũng có `floorSuggestion` cùng định dạng để hỗ trợ màn hình
cấu hình hiện tại. `suggestions` cũ vẫn được giữ cho client dùng cấu hình LEGACY.
`cultivation.trays` liệt kê khay đã gán và phiên/loại nấm hiện tại, kèm
`position_id`, `row_number`, `column_number`, `position_status`.
Không tự đổi ngưỡng hoặc tự Start khi người dùng chọn loại nấm.

## Dữ liệu chung và preset

Nguồn là các loại nấm DISTINCT của phiên `ACTIVE` trên các khay có `floor_id`
tương ứng thông qua liên kết ACTIVE trong `cultivation_session_trays`.
Phiên PLANNED/COMPLETED/CANCELLED hoặc liên kết khay không khớp không tham gia.
Khay OCCUPIED nhưng không có phiên hợp lệ không tự
đóng góp loại nấm. Không có phiên hợp lệ thì không sinh cấu hình gợi ý.
Thời hạn gói chỉ là kế hoạch; AUTO dùng trạng thái phiên và khay được gán để xác định
đang trồng, không tự ngừng chăm sóc chỉ vì qua ngày dự kiến.
Khay chưa gán ở nơi khác trong phòng không ảnh hưởng profile FLOOR.

Nguồn ngưỡng là min/max nhiệt độ và độ ẩm trong `mushroom_conditions`.
`cultivation_protocol_steps.target_temperature/target_humidity` không thay thế ngưỡng AUTO;
quy trình và giai đoạn trồng vẫn phục vụ theo dõi phiên. CO₂ đã bỏ khỏi schema và AUTO.
Khoảng chung là `min = max(các min)`, `max = min(các max)`.
Thiếu nhiệt độ/độ ẩm, khoảng rỗng, độ ẩm chung rộng không quá 2 điểm phần trăm,
hoặc nhiệt độ chung rộng dưới 1°C sẽ không sinh preset.

Preset gợi ý:

- Bắt đầu bù ẩm dưới độ ẩm min chung, ngừng nhu cầu ở trung điểm khoảng độ ẩm.
- Bắt đầu làm mát khi nhiệt độ đạt max chung, xóa nhu cầu ở trung điểm nhiệt độ.
- Giới hạn độ ẩm khi phun là độ ẩm max chung trừ 1 điểm phần trăm.
- Nhịp 3 giây, nghỉ 60 giây, đánh giá 5 giây, 3 cảm biến mới trong vòng 20 giây.
- Chênh lệch độ ẩm tối đa 10 điểm phần trăm; nhiệt độ tối đa 3°C.
- Tối đa 20 lượt và 200 giây ngân sách mỗi cửa sổ hiện tại của hệ thống.

Đây là giá trị khởi đầu cần được người vận hành hiệu chỉnh cho thiết bị;
không phải liều phun suy ra từ sinh học loại nấm. `profile_approved` mặc định false.
Cấu hình FLOOR dùng `mushroom_type_id=null`; backend tự lưu `source_profiles`
và không nhận snapshot loại nấm do client gửi.

## Điều khiển

Nhu cầu bù ẩm (`runtime.demand`) và làm mát (`runtime.cooling_demand`) giữ riêng
theo ngưỡng bật/tắt. Có một nhu cầu thì có thể phun nếu chưa chạm trần độ ẩm,
hết cooldown, còn ngân sách và dữ liệu hợp lệ. Khi bật cooling, trần
`cooling_humidity_limit` được áp dụng cho mọi nhịp vì dùng chung một van.
Trần phải lớn hơn ngưỡng ngừng bù ẩm và không vượt humidity_max.

Nhiệt độ cao nhưng chạm trần ẩm: không phun thêm; `runtime.last_reason` ghi
`Không thể làm mát do độ ẩm đã đạt giới hạn; cần thông gió hoặc dùng phương pháp làm mát khác`.
Nếu đang phun, yêu cầu OFF ngay ở lần đánh giá tiếp theo. Nhiệt độ giảm qua
ngưỡng stop xóa nhu cầu nhịp tiếp; nhịp hiện tại vẫn bị giới hạn bởi deadline.
Làm mát dùng chung pulse, cooldown, watchdog, ngân sách và cơ chế xác nhận OFF
với bù ẩm. Không có điều khiển quạt, đo lưu lượng, hoặc xác nhận hiệu quả làm mát.

Khi bật cooling, phải đủ số mẫu nhiệt độ hữu hạn trong [-40,80]°C từ các
cảm biến độ ẩm hợp lệ; kiểm tra cả độ chênh nhiệt độ. Dữ liệu sai/cũ chuyển sang
SENSOR_FAULT, kết thúc phiên bằng FAULT và yêu cầu OFF nếu đang phun.
Log quyết định lưu cả average_temperature.

Profile FLOOR được kiểm tra lại khi Start, mỗi lần đánh giá và trước khi giữ
chỗ cho lệnh ON. Thay đổi tập loại nấm hoặc khoảng điều kiện so với snapshot
đã lưu khiến Start bị từ chối hoặc phiên đang chạy bị dừng/FAULT và yêu cầu OFF.
Lấy gợi ý mới, duyệt/lưu lại rồi Start. Thêm khay cùng loại, cùng điều kiện
không tự làm đổi profile.

Các điều kiện phần cứng vẫn giữ nguyên: MQTT, SSR OFF mới không retained,
watchdog đã khai báo đủ dài (`AUTO_MISTING_REAL_ENABLED=true` và
`AUTO_MISTING_VERIFIED_WATCHDOGS` theo master thực tế). Mất DB, MQTT/thiết bị,
lỗi cảm biến, lỗi gửi lệnh hoặc khởi động lại backend kết thúc phiên AUTO.
Khi kết nối trở lại, backend chỉ hoàn tất OFF đang chờ; phải bấm Start để chạy phiên mới.
Publish OFF chưa có feedback vẫn là OFF_PENDING, dù mode đã là MANUAL.

Nếu DB mất kết nối thì backend không ghi được trạng thái ngay; worker chặn lệnh ON
và kết thúc các phiên cũ sau khi lấy lại kết nối. Nếu backend chết hoặc MQTT mất,
lệnh OFF có thể không tới thiết bị; firmware phải có watchdog tự tắt van theo thời hạn
đã xác minh. Việc khai báo biến môi trường không tự cài watchdog lên firmware.
Mất mạng riêng trên mobile không phải tín hiệu dừng AUTO; giao diện cần báo mất kết nối,
không suy diễn van đã OFF từ lỗi HTTP.
