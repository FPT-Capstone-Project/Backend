# Prompt cập nhật Mobile: tầng, khay, phiên thuê và AUTO

Hãy đọc code Mobile hiện tại và triển khai trực tiếp các thay đổi bên dưới. Tái sử dụng kiến trúc, navigation, API client, state management và design system của dự án. Không chỉ đưa kế hoạch hoặc tạo UI demo. Trước khi sửa, xác định các màn hình đang quản lý tầng, gán khay cho phiên trồng và điều khiển AUTO; hợp nhất luồng để tránh hai màn hình làm cùng một việc.

## 1. Hợp đồng nghiệp vụ mới

- Cấu trúc vật lý: phòng → tầng → vị trí hàng/cột → khay. Điều khiển AUTO theo tầng, không theo từng khay.
- Phân biệt “đặt khay vào tầng” với “gán khay cho phiên trồng”. Hai thao tác có API và mục đích khác nhau.
- Luồng: tạo tầng và lưới khay → duyệt profile loại nấm cho tầng → nhận đơn/chuẩn bị phiên → phiên READY_FOR_CULTIVATION → nhân viên chọn đúng số khay trên một tầng → phiên chuyển CULTIVATING → người vận hành chủ động Start AUTO.
- Thanh toán không tự gán khay, gán khay không tự Start AUTO.
- Tầng phải có profile nấm đã duyệt trước khi nhận/gán khay theo luồng thuê. Profile FLOOR giờ có thể lưu trước khi tầng có phiên trồng.
- Phiên đóng góp vào điều kiện AUTO khi có trạng thái CULTIVATING, HARVEST_READY hoặc HARVESTING và liên kết cultivation_session_trays ACTIVE.
- AUTO FLOOR chỉ chạy khi có phiên đang trồng. Loại nấm thực tế phải thuộc snapshot đã duyệt, điều kiện nấm phải còn khớp. Một phần loại nấm đã duyệt có thể chưa được trồng hoặc đã kết thúc phiên; các phiên còn lại vẫn được chăm sóc. Hết phiên hợp lệ thì FLOOR dừng.
- Backend là nguồn xác nhận cuối cùng về khay còn trống, profile hợp lệ và khả năng Start.

## 2. API cần tích hợp

Dùng base URL từ môi trường và JWT hiện có. AUTO trả thành công trong `{ "data": ... }`. Dùng cơ chế xử lý lỗi chung của app và giữ thông báo backend. Không tự đặt endpoint chưa được xác minh trong code/Swagger.

Đặt F = `/api/iot/floors/{floorId}`:

| API | Mục đích |
| --- | --- |
| GET /api/iot/floors | Danh sách tầng |
| POST /api/iot/floors, PUT F | Tạo/sửa tầng và mapping |
| POST F/trays/generate | Sinh khay theo total_rows × total_columns |
| PUT F/trays/{trayId} | Gán khay vật lý vào tầng; body tùy chọn position_id |
| GET F/auto-control | config, mode, cultivation, floorSuggestion |
| GET F/auto-control/suggestions | common, sourceProfiles, warnings, issues, config |
| PUT F/auto-control | Lưu profile; không Start |
| GET F/auto-control/status | mode, run, runtime, environment, ssr, cooldownRemainingMs, lastDecision |
| GET F/environment | averageTemperature, averageHumidity, healthy, reason và cảm biến |
| POST F/auto-control/start | `{ "dryRun": true }` mô phỏng; false chạy thiết bị |
| POST F/auto-control/stop | Dừng và xử lý OFF còn chờ |
| POST F/auto-control/evaluate | Xem trước quyết định; không bật thiết bị |
| GET F/auto-control/logs?limit=30&offset=0 | Nhật ký phân trang |
| GET /api/cultivation-sessions/admin/{sessionId} | Chi tiết phiên |
| GET /api/cultivation-sessions/admin/available-trays?floorId={floorId} | Khay có thể gán trên tầng |
| POST /api/cultivation-sessions/admin/{sessionId}/trays | Gán khay: `{ "floorId": 2, "trayIds": [21,22,25] }` |

API quản lý AUTO, suggestions và evaluate yêu cầu quyền iot.automation.manage. API admin của phiên yêu cầu Admin/Farm Operator theo backend. Dùng hệ thống phân quyền app hiện có; luôn xử lý 403 từ server.

Mapping tầng cần room_id, floor_number, floor_name, master_id, node_address, misting_ssr_channel; có thể thêm status, total_rows, total_columns. Không suy ra node hoặc kênh van từ số tầng. Đưa mapping kỹ thuật vào màn hình thiết lập nâng cao.

Danh sách khay trong `cultivation.trays` có tray_id, tray_code, tray_status, position_id, row_number, column_number, position_status, session_id, session_tray_id, mushroom_type_id, mushroom_name, cultivation_status. Dùng đúng tên field; không mặc định mọi response đều dùng status.

## 3. Lưu profile FLOOR trước khi có phiên

Thêm chọn nhiều loại nấm vào form cấu hình. Trường gửi mới là `mushroom_type_ids`, mảng ID số nguyên dương, không trùng, không rỗng khi gửi. Chỉ dùng với config_source FLOOR.

Ví dụ payload hoàn chỉnh minh họa cấu trúc, không hardcode các ngưỡng này cho mọi loại nấm:

```json
{
  "config_source": "FLOOR",
  "mushroom_type_ids": [1, 2],
  "profile_name": "Cấu hình tầng 2",
  "profile_approved": true,
  "humidity_min": 88,
  "humidity_max": 95,
  "humidity_start_threshold": 88,
  "humidity_stop_threshold": 91.5,
  "cooling_enabled": true,
  "temperature_min": 25,
  "temperature_max": 28,
  "temperature_start_threshold": 28,
  "temperature_stop_threshold": 26.5,
  "cooling_humidity_limit": 94,
  "misting_pulse_ms": 3000,
  "cooldown_ms": 60000,
  "evaluation_interval_ms": 5000,
  "sensor_max_age_ms": 20000,
  "required_valid_sensors": 3,
  "max_sensor_spread_percent": 10,
  "max_temperature_spread_c": 3,
  "max_activations_per_hour": 20,
  "max_cumulative_on_ms_per_hour": 200000
}
```

- Backend đọc mushroom_conditions, kiểm tra khoảng chung rồi tự lưu source_profiles. Không gửi source_profiles, sourceProfiles, id, floor_id, timestamps hoặc toàn bộ response GET vào PUT.
- Không gửi mushroom_type_id với FLOOR. Trường đơn này dành cho LEGACY.
- Khi mở profile đã lưu, khôi phục lựa chọn từ config.source_profiles[].mushroom_type_id; mushroom_type_ids là trường đầu vào, không phải cột lưu trong response.
- Nếu tầng có phiên, lựa chọn phải chứa tất cả loại nấm đang trồng. Hiển thị chip “Đang trồng” và không cho bỏ chọn loại nấm đó.
- Nếu không gửi mushroom_type_ids, backend dùng các phiên hiện có. Form dùng lựa chọn rõ ràng nên gửi danh sách đã chọn để giữ các loại nấm được duyệt cho tương lai.
- GET suggestions chỉ dựa vào phiên hiện có, chưa nhận bộ lọc loại nấm dự kiến. Tầng trống có config=null là bình thường: vẫn cho thiết lập và lưu profile thủ công với danh sách loại nấm, nhưng chưa cho Start.
- Tìm API danh mục nấm và điều kiện nấm thực sự có trong dự án. Nếu lấy đủ dữ liệu, form có thể tính khoảng chung để hỗ trợ nhập: min chung = max các min, max chung = min các max. Chỉ coi đây là bản xem trước, backend vẫn kiểm tra khi lưu. Nếu thiếu API/dữ liệu, hiển thị rõ và cho nhập ngưỡng; không bịa endpoint hoặc ngưỡng sinh học.
- Đổi lựa chọn nấm/ngưỡng thì yêu cầu người dùng duyệt lại. Không âm thầm áp dụng suggestions đè profile đang sửa hoặc đã lưu.
- UI dùng °C, % và giây/phút; chuyển đổi chính xác sang ms khi gửi. Tách cài đặt xung phun, thời gian nghỉ và giới hạn mỗi giờ vào phần nâng cao.

## 4. Bố cục UI mong muốn

Phong cách vận hành nông trại: sáng, gọn, dễ đọc ngoài hiện trường. Ưu tiên design system hiện có; nếu chưa có, dùng nền xám xanh rất nhạt, card trắng, chữ xanh đen, xanh lá làm màu hành động chính. Bo góc 12–16, khoảng cách theo hệ 8, nút cao tối thiểu 48. Dùng chữ và icon cùng màu trạng thái; không chỉ dựa vào màu. Tránh gradient đậm, quá nhiều bóng đổ hoặc mỗi chỉ số một màu.

### A. Danh sách tầng

- Bộ chọn phòng ở đầu; danh sách card tầng.
- Mỗi card có tên tầng, trạng thái AUTO, số khay đang dùng/tổng khay nếu đủ dữ liệu, nhiệt độ và độ ẩm mới nhất nếu đã tải được.
- Badge riêng “Mô phỏng” khi run RUNNING và dry_run=true. Không hiển thị mô phỏng như thiết bị đang bật.
- Tầng chưa cấu hình: “Chưa có cấu hình chăm sóc” + nút “Thiết lập”. Không hiện số 0 cho dữ liệu cảm biến thiếu.
- Tránh gọi dồn nhiều endpoint cho từng card. Ưu tiên tải chi tiết và polling khi mở một tầng; nếu cần hydrate danh sách thì giới hạn đồng thời và cache.

### B. Chi tiết tầng

Header: tên tầng, phòng, badge chế độ, thời điểm cập nhật. Bên dưới có ba tab: “Tổng quan”, “Khay”, “Nhật ký”.

Tab Tổng quan:
1. Hai ô lớn: nhiệt độ và độ ẩm, kèm khoảng mục tiêu và trạng thái dữ liệu.
2. Card “Chăm sóc tự động”: trạng thái bằng tiếng Việt, lý do quyết định gần nhất, thời gian nghỉ còn lại nếu có.
3. Card “Cấu hình chăm sóc”: tên profile, các chip loại nấm được duyệt, phân biệt “Đang trồng” và “Đã duyệt”; nút “Chỉnh sửa”.
4. Khu vực hành động cuối màn hình: khi dừng có “Chạy mô phỏng” và “Chạy thiết bị”; khi đang chạy có nút “Dừng AUTO” rõ ràng, dễ bấm.

Ví dụ phân cấp nội dung:

```text
Tầng 2 · Phòng A                 [Mô phỏng]

  Nhiệt độ                 Độ ẩm
  27,2 °C                  89 %
  Mục tiêu 25–28           Mục tiêu 88–95

Chăm sóc tự động
Đang nghỉ giữa các đợt phun · Còn 42 giây

Cấu hình tầng 2                        Sửa
[Nấm A · Đang trồng] [Nấm B · Đã duyệt]

                  [Dừng AUTO]
```

Màn hình cấu hình dùng form theo nhóm: “Loại nấm”, “Điều kiện chăm sóc”, “Nhịp phun và giới hạn”, “Duyệt cấu hình”. Dùng bottom sheet có tìm kiếm và checkbox để chọn nhiều loại nấm. Hiển thị lỗi ngay dưới field và tóm tắt xung đột chung ở đầu form. CTA cuối là “Lưu cấu hình”, không phải “Lưu và chạy”.

### C. Khay và gán khay cho phiên

- Tab Khay thể hiện sơ đồ đúng row_number/column_number, có nhãn hàng/cột. Không dùng thứ tự mảng làm tọa độ.
- Tầng lớn dùng viewport cuộn hoặc danh sách ảo hóa; thêm chế độ danh sách dễ đọc. Khay thiếu vị trí xuất hiện ở mục “Chưa có vị trí”.
- Trạng thái: khả dụng viền trung tính, đang sử dụng có icon, không hợp lệ/bảo trì màu xám, đã chọn viền xanh + dấu tick. Có chú giải ngắn.
- Chạm khay mở bottom sheet: mã, vị trí, trạng thái, phiên và tên nấm nếu có. Không hiển thị nút tưới riêng từng khay.
- Mở luồng gán từ phiên READY_FOR_CULTIVATION. Đầu màn hình hiển thị tên nấm, số khay cần, tầng đã chọn.
- Footer cố định “Đã chọn 2/3 khay” và “Gán 3 khay”. Chỉ bật nút khi chọn đủ, không trùng, cùng một tầng; đổi tầng phải xóa lựa chọn cũ.
- available-trays không nhận sessionId và không bảo đảm tầng hợp loại nấm của phiên. Kiểm tra profile đã duyệt để hỗ trợ UI; backend vẫn kiểm tra khi POST.
- Thành công: tải lại phiên và dữ liệu tầng, hiển thị “Đã gán khay · Phiên bắt đầu trồng”. AUTO vẫn cần Start riêng.
- Nếu 409 do khay vừa bị người khác chọn: giữ người dùng ở màn hình, tải lại danh sách, bỏ các lựa chọn không còn hợp lệ và giải thích ngắn gọn.

### D. Nhật ký

Timeline gọn: thời gian, sự kiện, lý do. Tải thêm theo phân trang. Tách “Đã gửi lệnh” khỏi “Thiết bị đã phản hồi”; không đổi ON_REQUESTED thành “Đã phun thành công”. Chi tiết kỹ thuật đặt trong phần mở rộng.

## 5. Trạng thái và hành vi bắt buộc

- RUNNING phải phân biệt chạy mô phỏng và chạy thiết bị qua run.dry_run. Không suy từ mode AUTO rằng van đang mở.
- OFF_PENDING hiển thị “Đang chờ thiết bị xác nhận tắt”; chưa báo “Đã tắt an toàn”, chưa cho chỉnh cấu hình hoặc Start lại.
- Backend chặn sửa khi run đang RUNNING hoặc runtime là ON_REQUESTED/MISTING/OFF_PENDING. UI hiển thị lý do và cho dừng trước.
- MISTING là trạng thái điều khiển, không chứng minh có nước chảy. Dùng cách diễn đạt phù hợp dữ liệu SSR và phản hồi thực tế.
- Sensor lỗi/cũ/thiếu hiển thị “Dữ liệu chưa sẵn sàng” cùng lý do; số cũ nếu giữ lại phải có nhãn thời điểm và trạng thái cũ.
- Khi khởi động lại server hoặc mất kết nối khiến backend dừng AUTO, không tự Start lại. Hiển thị yêu cầu người vận hành kiểm tra và chủ động chạy lại.
- Chạy thiết bị có hộp xác nhận ngắn nêu đúng tầng và profile. Dừng là hành động trực tiếp, không bắt xác nhận nhiều bước.
- Disable nút trong lúc gửi để tránh trùng request. Không tự retry POST Start/gán khay sau timeout; đọc lại trạng thái trước.
- Polling status khoảng 3–5 giây khi màn hình chi tiết đang mở; dừng khi blur/background, hủy request hoặc bỏ response cũ khi đổi tầng. Không chồng request. Pull-to-refresh để tải lại thủ công.
- Khi app mất mạng, giữ dữ liệu cũ với banner “Chưa cập nhật được”; không tự kết luận phần cứng đã dừng. Sau reconnect đọc lại server.
- Có skeleton, empty state, error state và retry. Thông báo tiếng Việt rõ ràng, không lộ stack trace. 401 dùng luồng đăng nhập hiện có; 403 giải thích thiếu quyền; 409 hiển thị nguyên nhân và tải lại dữ liệu liên quan; 503/504 giữ trạng thái chưa xác nhận đến khi đọc lại được server.

## 6. Kiểm tra và bàn giao

Kiểm tra tối thiểu:
1. Tầng trống có thể lưu profile FLOOR với nhiều ID nấm, nhưng chưa Start được.
2. Mở lại form khôi phục đúng các loại nấm từ source_profiles; PUT chỉ gửi field hợp lệ.
3. Không bỏ được nấm đang trồng; đổi nấm/ngưỡng cần duyệt lại.
4. Gán đúng số khay một tầng; xử lý tranh chấp 409 và không gọi Start tự động.
5. Hiển thị đúng mô phỏng/chạy thiết bị/OFF_PENDING/lỗi cảm biến/mất mạng.
6. Hoàn thành một phiên không tự báo AUTO đã dừng; dùng trạng thái backend của tầng.
7. Chuyển tầng nhanh hoặc background không làm dữ liệu tầng cũ ghi đè tầng mới.
8. UI không tràn ở màn hình nhỏ, cỡ chữ lớn; sơ đồ nhiều khay không làm treo app.

Hoàn thành bằng code chạy được. Báo các file đã sửa, API đã nối, cách kiểm tra và phần nào còn thiếu hợp đồng backend. Nếu chưa truy cập được API danh mục nấm/điều kiện, nêu rõ và hoàn thành các phần độc lập; không thay dữ liệu thật bằng mock trong bản bàn giao.
