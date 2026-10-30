# AUTO theo tầng: tích hợp mobile

## Triển khai

Chạy `migrations/007_add_floor_climate_profiles.sql` sau migration IoT 004 và AUTO 005,
trước khi khởi động phiên bản backend này. Migration giữ cấu hình cũ ở `LEGACY`,
`cooling_enabled=false`; không tự bật phun làm mát hoặc tạo phiên AUTO.

Các API trả kết quả trong `{ "data": ... }`. Mapping, gán khay, lấy gợi ý,
lưu, Start, Stop và Evaluate yêu cầu JWT và quyền `iot.automation.manage`.
Migration 005 cấp quyền này theo tên role Admin/Farm Operator, không cấp Customer.
Các API đọc cũ vẫn giữ yêu cầu đăng nhập như trước.

## Luồng màn hình

1. Chọn phòng và tầng. Tạo mapping bằng `POST /api/iot/floors`, hoặc sửa bằng
   `PUT /api/iot/floors/:floorId`. Gán đúng `master_id` (ID database),
   `node_address`, `misting_ssr_channel`. Không suy ra kênh van từ số tầng.
2. Gán các khay cùng phòng bằng `PUT /api/iot/floors/:floorId/trays/:trayId`.
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
`cultivation.trays` liệt kê khay đã gán và phiên/loại nấm hiện tại.
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

Với nhiệt độ, độ ẩm và CO₂, khoảng chung là:
`min = max(các min)`, `max = min(các max)`. CO₂ được dùng để kiểm tra tương thích
nếu tất cả loại nấm có dữ liệu, không điều khiển thiết bị CO₂. Thiếu CO₂ trả warning.
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
`Cooling blocked by humidity limit; ventilation or other cooling required`.
Nếu đang phun, yêu cầu OFF ngay ở lần đánh giá tiếp theo. Nhiệt độ giảm qua
ngưỡng stop xóa nhu cầu nhịp tiếp; nhịp hiện tại vẫn bị giới hạn bởi deadline.
Làm mát dùng chung pulse, cooldown, watchdog, ngân sách và cơ chế xác nhận OFF
với bù ẩm. Không có điều khiển quạt, đo lưu lượng, hoặc xác nhận hiệu quả làm mát.

Khi bật cooling, phải đủ số mẫu nhiệt độ hữu hạn trong [-40,80]°C từ các
cảm biến độ ẩm hợp lệ; kiểm tra cả độ chênh nhiệt độ. Dữ liệu sai/cũ gây FAULT
và yêu cầu OFF nếu đang phun. Log quyết định lưu cả average_temperature.

Profile FLOOR được kiểm tra lại khi Start, mỗi lần đánh giá và trước khi giữ
chỗ cho lệnh ON. Thay đổi tập loại nấm hoặc khoảng điều kiện so với snapshot
đã lưu khiến Start bị từ chối hoặc phiên đang chạy bị dừng/FAULT và yêu cầu OFF.
Lấy gợi ý mới, duyệt/lưu lại rồi Start. Thêm khay cùng loại, cùng điều kiện
không tự làm đổi profile.

Các điều kiện phần cứng vẫn giữ nguyên: MQTT, SSR OFF mới không retained,
watchdog đã khai báo đủ dài. Khởi động lại backend không tự khôi phục AUTO.
Publish OFF chưa có feedback vẫn là OFF_PENDING.
