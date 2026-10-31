# Prompt gửi cho bên mobile

Hãy đọc code mobile hiện tại rồi sửa trực tiếp màn hình, API client và quản lý
trạng thái AUTO theo hợp đồng backend dưới đây. Dùng kiến trúc và UI hiện có.
Backend đã chuyển nơi deploy: lấy base URL từ cấu hình môi trường của mobile,
không hardcode URL cũ, không đưa thông tin DB/MQTT hoặc secret backend vào app.

## 1. AUTO theo tầng và nguồn điều kiện

- Điều khiển theo `floor_id`. Mapping gồm `room_id`, `master_id` (ID số trong DB),
  `node_address`, `misting_ssr_channel`; không suy ra node/kênh van từ số tầng.
- Ngưỡng nhiệt độ/độ ẩm dùng min/max trong `mushroom_conditions` của các phiên
  `ACTIVE` gắn khay bằng liên kết `ACTIVE` trong `cultivation_session_trays`.
- Dùng cấu hình `config_source: "FLOOR"` và gợi ý từ backend. Không tự tính lại
  khoảng chung trên mobile; không chọn một loại nấm đại diện cho cả tầng.
- Không dùng `cultivation_protocol_steps.target_temperature/target_humidity`
  để thay ngưỡng AUTO. Không gửi các trường CO2/độ ẩm giá thể đã bỏ.

## 2. API

Tất cả endpoint yêu cầu JWT. Response thành công bọc trong `{ "data": ... }`.
API thay đổi dữ liệu, suggestions và evaluate yêu cầu quyền
`iot.automation.manage`; xử lý 403 từ backend, không dựa vào role ID cố định.

Prefix `F = /api/iot/floors/{floorId}`:

- `GET /api/iot/floors`: danh sách tầng và mapping.
- `POST /api/iot/floors`, `PUT F`: tạo/sửa mapping. Gửi đủ `room_id`,
  `floor_number`, `floor_name`, `master_id`, `node_address`, `misting_ssr_channel`.
  `status` là ACTIVE/INACTIVE. Tùy chọn `total_rows`, `total_columns`:
  1–32767 hoặc null; bỏ trường khi sửa sẽ giữ kích thước hiện tại.
- `PUT F/trays/{trayId}`: gán khay cùng phòng. Body tùy chọn
  `{ "position_id": 123 }` chọn vị trí ACTIVE, còn trống trong tầng/phòng;
  null gỡ vị trí nhưng giữ tầng; không gửi trường giữ vị trí hiện tại.
- `GET F/environment`: cảm biến, `averageHumidity`, `averageTemperature`,
  `healthy`, `reason`, `thresholds`.
- `GET F/auto-control`: `config`, `mode`, `cultivation`, `floorSuggestion`.
  `cultivation.trays` có phiên/loại nấm và `position_id`, `row_number`,
  `column_number`, `position_status`.
- `GET F/auto-control/suggestions`: `common`, `sourceProfiles`, `warnings`,
  `issues`, `config`. Nếu config=null, hiển thị issues và chặn áp dụng gợi ý.
- `PUT F/auto-control`: lưu cấu hình, không khởi động AUTO.
- `POST F/auto-control/start`: `{ "dryRun": true }` mô phỏng hoặc
  `{ "dryRun": false }` chạy thiết bị. Mặc định backend là mô phỏng.
- `POST F/auto-control/stop`: dừng AUTO và xử lý OFF còn chờ.
- `GET F/auto-control/status`: `mode`, `run`, `runtime`, `environment`, `ssr`,
  `cooldownRemainingMs`, `lastDecision`.
- `GET F/auto-control/logs?limit=100&offset=0`: `limit`, `offset`, `logs`.
- `POST F/auto-control/evaluate`: chỉ xem trước quyết định, không bật thiết bị.

## 3. Luồng cấu hình và chạy

Chọn phòng/tầng → tải cấu hình và gợi ý → cho người vận hành xem/chỉnh preset
→ đặt tên profile và xác nhận duyệt → lưu → bấm Start riêng.

Khi lưu, chỉ gửi các trường cấu hình hợp lệ trong object `suggestions.config`,
cùng `profile_name` và `profile_approved: true`. Không gửi cả response,
`sourceProfiles`, `source_profiles`, `id`, `floor_id`, thông tin người cấu hình
hoặc timestamps của bản ghi đã lưu. Backend tự tạo snapshot nguồn.
Không tự Start sau Save, mở màn hình, đổi tầng hoặc nhận lại kết nối.

Hiển thị rõ mô phỏng/chạy thiết bị từ `run.dry_run`. Không gọi SSR ON trực tiếp
để thay thế API Start. Dừng và hoàn tất OFF trước khi sửa cấu hình/mapping/gán khay.

## 4. Trạng thái sau mất kết nối — đã trả về cơ chế dừng

- Backend mất DB, MQTT/thiết bị, lỗi cảm biến, gửi lệnh lỗi hoặc backend/worker
  khởi động lại: phiên AUTO bị kết thúc, cần người vận hành bấm Start lại.
- Khi kết nối lại, chỉ tải lại trạng thái. Tuyệt đối không tự Start lại,
  không phát lại lệnh ON hoặc mutation đã timeout.
- `mode: "MANUAL"` không chứng minh van đã tắt. Nếu `runtime.control_state`
  là `OFF_PENDING`, hiển thị “Đang chờ thiết bị xác nhận tắt”, chặn Start/chỉnh
  cấu hình cho tới khi backend xử lý xong. Hiển thị `run.stop_reason`,
  `runtime.last_error`, `runtime.last_reason` khi phù hợp.
- Phân biệt trạng thái phiên RUNNING/STOPPED/FAULT với runtime:
  DISABLED, IDLE, ON_REQUESTED, MISTING, OFF_PENDING, COOLDOWN,
  SENSOR_FAULT, DEVICE_OFFLINE, FAULT. AUTO không đồng nghĩa van luôn ON.
- `ssr.desired_state` là lệnh mong muốn, `ssr.reported_state` là phản hồi thiết bị;
  gửi lệnh thành công chưa chứng minh thiết bị đã đổi trạng thái.
- Mobile mất HTTP/mạng riêng: báo “Mất kết nối, chưa xác định trạng thái mới nhất”,
  đánh dấu dữ liệu cũ, khóa thao tác điều khiển. Không tự sửa state thành OFF
  hoặc báo backend đã dừng; backend không dùng kết nối điện thoại làm heartbeat.

## 5. Polling, lỗi và kiểm thử

- Poll trạng thái khi màn hình đang hoạt động; không tạo request chồng nhau,
  hủy khi đổi tầng/rời màn hình, bỏ response cũ của tầng trước.
  Khi app trở lại foreground hoặc mạng phục hồi, đọc lại trạng thái từ backend.
- Chống double tap cho Save/Start/Stop. Khi mutation timeout, đọc lại status
  để đối chiếu trước khi cho thao tác tiếp; không tự retry mutation.
- 400: dữ liệu sai; 401: phiên đăng nhập; 403: thiếu quyền; 409: xung đột hoặc
  chưa đủ điều kiện; 503: worker/MQTT chưa sẵn sàng; 504: timeout gửi lệnh/
  chờ phản hồi. Hiển thị message của backend và tránh báo thành công giả.
- Kiểm thử: lưu không tự Start; mô phỏng/chạy thật; mất kết nối và reconnect
  không tự bật lại; MANUAL + OFF_PENDING; lỗi cảm biến; thiếu quyền; dữ liệu cũ;
  đổi tầng khi request đang chạy; Start timeout; gợi ý null và profile thay đổi.
- Hoàn thành code và báo các file đã sửa, kiểm thử đã chạy, điểm còn thiếu
  từ API thật. Không chỉ trả kế hoạch hoặc dựng dữ liệu giả làm kết quả cuối.
