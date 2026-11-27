# API thay đổi từ commit `96d7f2b` đến hiện tại

Tài liệu tổng hợp các API được thêm hoặc mở rộng trong phạm vi commit `96d7f2b` đến `HEAD` (`d14dc5b`). Nội dung tập trung vào QR khay, inspection/tăng trưởng, báo cáo sự cố, tư vấn chuyên gia, vệ sinh khay và quy trình giao nhận thu hoạch; không liệt kê các API khác đã có từ trước.

## Quy ước gọi API

- Thay `BASE_URL` bằng địa chỉ gốc của backend, ví dụ `http://localhost:3000` (không thêm `/api`).
- Các API yêu cầu đăng nhập dùng header `Authorization: Bearer <JWT>`.
- Ví dụ dùng `curl.exe`, có thể chạy trong PowerShell hoặc Git Bash trên Windows.
- Swagger UI: `GET /api-docs`.

```powershell
$BASE_URL = "http://localhost:3000"
$TOKEN = "<JWT>"
$QR_TOKEN = "<token đọc từ QR>"
```

## Danh sách endpoint

| Method | Endpoint | Chức năng |
|---|---|---|
| `POST` | `/api/cultivation-trays/qr/backfill` | Tạo QR token cho các khay chưa có token |
| `GET` | `/api/cultivation-trays/{id}/qr` | Tải ảnh QR PNG của một khay |
| `POST` | `/api/cultivation-trays/qr/scan` | Tra cứu khay và các phiên trồng đang hoạt động từ QR token |
| `POST` | `/api/cultivation-sessions/admin/inspections` | Ghi inspection; tùy chọn ghi giai đoạn tăng trưởng có thể cập nhật sẵn sàng thu hoạch |
| `POST` | `/api/cultivation-sessions/admin/qr-growth-update` | Cập nhật giai đoạn phát triển cho khay được quét |
| `GET` | `/api/cultivation-sessions/admin/{sessionId}/growth-status` | Xem tình trạng tăng trưởng của các khay trong phiên |
| `PATCH` | `/api/cultivation-sessions/admin/{sessionId}/growth` | Cập nhật tăng trưởng cấp phiên; cập nhật mới cần đánh giá lại sẵn sàng thu hoạch |
| `PATCH` | `/api/cultivation-sessions/admin/{sessionId}/harvest-readiness` | Ghi nhận đánh giá sẵn sàng thu hoạch |
| `POST` | `/api/harvests` | Đã điều chỉnh: tạo harvest và ghi yield trong cùng request |
| `POST` | `/api/harvests/{id}/start` | API cũ, đã deprecated |
| `POST` | `/api/harvests/{id}/yield` | API cũ, đã deprecated |
| `POST` | `/api/harvests/{id}/complete` | Đã điều chỉnh: hoàn tất theo luồng PICKUP hoặc DELIVERY |
| `GET` | `/api/harvests/admin` | Đã điều chỉnh liên kết thông tin harvest với yêu cầu nhận tương ứng |
| `GET` | `/api/harvests/{id}` | Đã điều chỉnh liên kết thông tin harvest với yêu cầu nhận tương ứng |
| `GET` | `/api/orders/{orderId}/harvest-history` | Đã điều chỉnh liên kết phương thức nhận với harvest tương ứng |
| `POST` | `/api/harvest-requests` | Đã điều chỉnh quyền tạo và điều kiện chọn phương thức nhận |
| `PATCH` | `/api/harvest-requests/{id}` | Đã điều chỉnh điều kiện cập nhật phương thức nhận/lịch PICKUP |
| `POST` | `/api/harvest-requests/{id}/complete` | API bàn giao cũ, đã deprecated; chỉ còn luồng PICKUP legacy |
| `POST` | `/api/issues/qr` | Tạo báo cáo sự cố cho khay bằng QR, kèm ảnh tùy chọn |
| `PATCH` | `/api/consultations/{consultationId}/close` | Chuyên gia đóng tư vấn và giải quyết sự cố không cần treatment |
| `POST` | `/api/cultivation-trays/qr/{qrToken}/complete-sanitation` | Xác nhận vệ sinh khay bằng QR |
| `POST` | `/api/shipments` | Đã điều chỉnh: không tạo thủ công shipment cho đơn có phiên trồng |
| `GET` | `/api/shipments/admin` | Đã điều chỉnh response có `harvest_request_id` |
| `GET` | `/api/shipments/orders/{orderId}` | Đã điều chỉnh response có `harvest_request_id` |
| `PATCH` | `/api/shipments/{id}/status` | Đã điều chỉnh: không dùng endpoint này để đánh dấu đã giao |
| `PATCH` | `/api/harvest-requests/{id}/cancel` | Khách hàng hủy yêu cầu nhận thu hoạch trước khi có bản ghi thu hoạch |
| `PATCH` | `/api/shipments/{id}/confirm-received` | Khách hàng xác nhận đã nhận shipment thu hoạch |

## QR khay

### Tạo token QR còn thiếu

**`POST /api/cultivation-trays/qr/backfill`**

- Quyền: Admin hoặc Farm Operator.
- Không cần request body.
- Chỉ tạo token cho khay chưa có; giữ nguyên token hiện tại nên có thể gọi lại.
- Response `data` gồm `updated_count` và `tray_ids`.

```powershell
curl.exe -X POST "$BASE_URL/api/cultivation-trays/qr/backfill" `
  -H "Authorization: Bearer $TOKEN"
```

### Lấy ảnh QR

**`GET /api/cultivation-trays/{id}/qr`**

- Quyền: người dùng đã đăng nhập.
- Response thành công là ảnh PNG (`image/png`), không phải JSON.
- `404` nếu không tìm thấy khay; `409` nếu khay chưa có QR token.

```powershell
curl.exe "$BASE_URL/api/cultivation-trays/12/qr" `
  -H "Authorization: Bearer $TOKEN" `
  -o tray-12-qr.png
```

### Quét QR để xem khay và phiên

**`POST /api/cultivation-trays/qr/scan`**

- Quyền: người dùng đã đăng nhập.
- Body JSON nhận `qrToken`; `qr_token` cũng được chấp nhận.
- Response `data` có `tray` và danh sách `sessions` đang hoạt động.
- `400` nếu token thiếu/sai định dạng; `404` nếu không tìm thấy khay.

```powershell
curl.exe -X POST "$BASE_URL/api/cultivation-trays/qr/scan" `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{"qrToken":"<QR_TOKEN>"}'
```

## Inspection và tăng trưởng theo QR

### Ghi inspection hằng ngày

**`POST /api/cultivation-sessions/admin/inspections`**

Ghi nhận quan sát cho assignment khay đang hoạt động. Chọn **đúng một** trong `qr_token` hoặc `session_tray_id`. Với QR, backend tự tìm khay và assignment đang hoạt động; không cần gửi `tray_id`, `session_id` hay `inspected_by`.

- Quyền: Admin hoặc Farm Operator.
- Content-Type: `multipart/form-data`.
- Trường tùy chọn: `trayCondition`, `mushroomCondition`, `notes`, `caption`.
- Có thể gửi thêm `growth_status` (`FRUITING_INITIATION`, `PINNING`, `YOUNG_FRUITING`, `MATURATION`) để ghi giai đoạn tăng trưởng cùng inspection.
- Có thể gửi tối đa 10 ảnh bằng cách lặp lại trường `images`.
- Phiên phải ở trạng thái `CULTIVATING`; mỗi assignment chỉ có tối đa một inspection nguồn `MANUAL` hoặc nguồn cũ `NULL` mỗi ngày theo giờ Việt Nam.
- Khi có `growth_status`, hệ thống đồng bộ giai đoạn của các khay; nếu mọi khay yêu cầu đều `OCCUPIED`, cùng đạt `MATURATION` và không có sự cố chặn, phiên có thể được chuyển sang `HARVEST_READY`.
- Thành công: `201 Created`. `400` nếu thiếu hoặc gửi đồng thời cả hai trường định danh; `404` nếu QR/assignment không tồn tại; `409` nếu phiên không ở giai đoạn phù hợp hoặc đã có inspection `MANUAL`/`NULL` trong ngày.

```powershell
curl.exe -X POST "$BASE_URL/api/cultivation-sessions/admin/inspections" `
  -H "Authorization: Bearer $TOKEN" `
  -F "qr_token=$QR_TOKEN" `
  -F "trayCondition=Normal" `
  -F "mushroomCondition=Đang phát triển bình thường" `
  -F "notes=Kiểm tra buổi sáng" `
  -F "images=@C:\temp\tray.jpg"
```

### Cập nhật giai đoạn tăng trưởng qua QR

**`POST /api/cultivation-sessions/admin/qr-growth-update`**

Ghi giai đoạn phát triển cho khay được quét. Inspection trong ngày được cập nhật nếu đã tồn tại, nếu chưa thì tạo mới. Khi mọi khay đang hoạt động đồng bộ cùng giai đoạn, hệ thống cập nhật tiến độ phiên nếu giai đoạn khác với tiến độ gần nhất.

- Quyền: Admin hoặc Farm Operator.
- Content-Type: `multipart/form-data` (không gửi ảnh).
- Bắt buộc: `qr_token`, `growth_status`.
- `growth_status`: `FRUITING_INITIATION`, `PINNING`, `YOUNG_FRUITING`, `MATURATION`.
- Tùy chọn: `trayCondition` (tối đa 500 ký tự), `mushroomCondition` (tối đa 500), `notes` (tối đa 1000).
- `409` nếu khay không có assignment đang hoạt động hoặc phiên không ở trạng thái `CULTIVATING`.

```powershell
curl.exe -X POST "$BASE_URL/api/cultivation-sessions/admin/qr-growth-update" `
  -H "Authorization: Bearer $TOKEN" `
  -F "qr_token=$QR_TOKEN" `
  -F "growth_status=PINNING" `
  -F "trayCondition=Normal" `
  -F "mushroomCondition=Đang phát triển bình thường" `
  -F "notes=Kiểm tra buổi sáng"
```

Khi tất cả khay đạt `MATURATION` và đồng bộ, API trên tự chuyển `harvest_status` sang `HARVEST_READY` nếu đồng thời thỏa các điều kiện: số assignment đang hoạt động bằng số khay yêu cầu của phiên, mọi khay ở trạng thái `OCCUPIED`, tiến độ phiên có condition hợp lệ, và không còn sự cố chất lượng/nghiêm trọng chưa giải quyết. Khi trạng thái được chuyển lần đầu, khách hàng được gửi thông báo. Đây là hành vi của API cập nhật tăng trưởng, không phải endpoint riêng.

Response trả về thông tin khay/phiên, `growth_status`, `harvest_status`, `harvest_ready`, `harvest_ready_changed` và `synchronization` (bao gồm số khay, mức đồng bộ và `session_stage`).

### Cập nhật tăng trưởng cấp phiên

**`PATCH /api/cultivation-sessions/admin/{sessionId}/growth`**

- Quyền: Admin hoặc Farm Operator.
- Body gồm `growthStatus`, `progressPercent`, `condition`; `notes` và `expectedHarvestDate` tùy chọn.
- Mỗi cập nhật tăng trưởng cấp phiên đặt lại đánh giá sẵn sàng thu hoạch; cần đánh giá lại bằng API `harvest-readiness`.
- Khác với cập nhật cấp khay bằng QR/inspection, endpoint này không tự chuyển phiên sang `HARVEST_READY`.

### Xem tình trạng tăng trưởng các khay

**`GET /api/cultivation-sessions/admin/{sessionId}/growth-status`**

- Quyền: Admin hoặc Farm Operator.
- Response `data` gồm `session_id`, `session_stage`, `synchronization` và `trays`.
- Mỗi khay có `tray_id`, `tray_code`, `tray_status`, `growth_status`, `updated` và `last_inspection_at`.
- `404` nếu không tìm thấy phiên.

```powershell
curl.exe "$BASE_URL/api/cultivation-sessions/admin/21/growth-status" `
  -H "Authorization: Bearer $TOKEN"
```

### Ghi nhận đánh giá sẵn sàng thu hoạch

**`PATCH /api/cultivation-sessions/admin/{sessionId}/harvest-readiness`**

API này ghi nhận đánh giá thủ công; không thực hiện thu hoạch. Phiên vẫn giữ `status` là `CULTIVATING`, còn trạng thái thu hoạch được lưu riêng.

- Quyền: Admin hoặc Farm Operator.
- Body JSON bắt buộc `harvestReady` kiểu boolean; `notes` tùy chọn (tối đa 1000 ký tự).
- Chỉ đánh giá phiên `CULTIVATING` có đủ khay đang hoạt động/trạng thái `OCCUPIED` và đã có condition tăng trưởng.
- `harvestReady: true` chỉ hợp lệ khi giai đoạn tăng trưởng là `MATURATION` và không còn sự cố chất lượng hoặc mức độ `HIGH` chưa giải quyết; nếu chưa trưởng thành, API trả `409`.
- Thành công ghi người xác nhận/thời điểm và thêm đánh giá vào lịch sử; khi xác nhận sẵn sàng, khách hàng được thông báo.

```powershell
curl.exe -X PATCH "$BASE_URL/api/cultivation-sessions/admin/21/harvest-readiness" `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{"harvestReady":true,"notes":"Đã kiểm tra toàn bộ khay"}'
```

## Báo cáo sự cố và tư vấn chuyên gia

### Tạo sự cố từ QR

**`POST /api/issues/qr`**

Tìm khay bằng QR, tạo inspection liên kết với báo cáo, tải ảnh minh chứng lên và tạo issue trong cùng luồng xử lý.

- Quyền: Admin hoặc Farm Operator.
- Content-Type: `multipart/form-data`.
- Bắt buộc: `qr_token`, `issue_type` (tối đa 100 ký tự), `title` (tối đa 255), `description`.
- Tùy chọn: `severity` (`LOW`, `MEDIUM`, `HIGH`); tối đa 10 ảnh ở trường `images`.
- Chỉ báo cáo được khi khay có assignment đang hoạt động, phiên đã thanh toán và đang ở `CULTIVATING`, `HARVEST_READY` hoặc `HARVESTING`.
- Thành công: `201 Created`; `400` nếu dữ liệu/ảnh không hợp lệ; `404` nếu QR không tồn tại; `409` nếu assignment, thanh toán hoặc trạng thái phiên không đáp ứng điều kiện.

```powershell
curl.exe -X POST "$BASE_URL/api/issues/qr" `
  -H "Authorization: Bearer $TOKEN" `
  -F "qr_token=$QR_TOKEN" `
  -F "issue_type=CONTAMINATION" `
  -F "title=Phát hiện dấu hiệu nhiễm" `
  -F "description=Quan sát thấy đốm bất thường trên khay" `
  -F "severity=MEDIUM" `
  -F "images=@C:\temp\evidence.jpg"
```

### Đóng tư vấn trực tiếp

**`PATCH /api/consultations/{consultationId}/close`**

Cho phép chuyên gia đóng tư vấn ngay khi kết luận không cần treatment hoặc theo dõi thêm. Tư vấn chuyển `CLOSED`, issue chuyển `RESOLVED`.

- Quyền: Mushroom Expert hoặc Admin. Nếu tư vấn đã được giao, chỉ chuyên gia được giao mới đóng được.
- Body JSON bắt buộc `diagnosis`; `reviewComment` tùy chọn.
- `409` nếu tư vấn/issue đã đóng, đã có treatment plan, hoặc issue đang trong giai đoạn `WAITING_REVIEW`/`MONITORING`.

```powershell
curl.exe -X PATCH "$BASE_URL/api/consultations/42/close" `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{"diagnosis":"Không cần xử lý thêm","reviewComment":"Đã kiểm tra thông tin và ảnh"}'
```

## Vệ sinh khay

### Xác nhận vệ sinh bằng QR

**`POST /api/cultivation-trays/qr/{qrToken}/complete-sanitation`**

- Quyền: Admin hoặc Farm Operator.
- Không cần body; dùng token đọc được từ QR ở path.
- Khay phải ở trạng thái `MAINTENANCE` và không còn assignment phiên trồng `ACTIVE`.
- Thành công chuyển khay sang `AVAILABLE`, đồng thời ghi `last_cleaned_at` và `last_cleaned_by`.
- `404` nếu QR không tìm thấy; `409` nếu trạng thái khay hoặc assignment không hợp lệ.

```powershell
curl.exe -X POST "$BASE_URL/api/cultivation-trays/qr/$QR_TOKEN/complete-sanitation" `
  -H "Authorization: Bearer $TOKEN"
```

## Nhận và giao thu hoạch

### Hủy yêu cầu nhận thu hoạch

**`PATCH /api/harvest-requests/{id}/cancel`**

- Quyền: Customer; chỉ hủy được yêu cầu do chính khách hàng tạo.
- Chỉ hủy trước khi bản ghi thu hoạch được tạo.
- `409` nếu yêu cầu đã đóng hoặc đã có harvest.

```powershell
curl.exe -X PATCH "$BASE_URL/api/harvest-requests/31/cancel" `
  -H "Authorization: Bearer $TOKEN"
```

### Quy trình tạo thu hoạch đã rút gọn

**`POST /api/harvests`**

Tạo harvest ở trạng thái `IN_PROGRESS`, chuyển phiên sang `HARVESTING` và ghi yield trong cùng request/giao dịch.

- Quyền: Admin hoặc Farm Operator.
- Body bắt buộc `sessionId`, `totalWeightKg`, `usableWeightKg`, `rejectedWeightKg`.
- `qualityGrade` và `notes` là tùy chọn.
- `usableWeightKg + rejectedWeightKg` phải khớp `totalWeightKg`.
- Phiên phải `HARVEST_READY`, có yêu cầu nhận còn hiệu lực; PICKUP phải có lịch. Không được còn sự cố chất lượng/nghiêm trọng chưa xử lý.
- `POST /api/harvests/{id}/start` và `POST /api/harvests/{id}/yield` được đánh dấu deprecated.

```powershell
curl.exe -X POST "$BASE_URL/api/harvests" `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{"sessionId":21,"totalWeightKg":5.2,"usableWeightKg":4.8,"rejectedWeightKg":0.4,"qualityGrade":"A","notes":"Thu hoạch đợt đầu"}'
```

Sau khi ghi yield, dùng `POST /api/harvests/{id}/complete` để hoàn tất bản ghi thu hoạch. Với hình thức giao hàng, hệ thống tạo shipment ở bước hoàn tất thu hoạch.

### Khách hàng xác nhận đã nhận shipment

**`PATCH /api/shipments/{id}/confirm-received`**

- Quyền: Customer; chỉ xác nhận được shipment thuộc đơn hàng của chính khách hàng.
- Dùng cho shipment thu hoạch đang ở `PENDING`.
- Thành công chuyển shipment sang `DELIVERED`, ghi thời điểm nhận và hoàn tất bàn giao thu hoạch.
- Gọi lại API cho shipment đã xác nhận sẽ trả lại bản ghi hiện có thay vì tạo xác nhận trùng.
- Staff không thể tự chuyển shipment thu hoạch sang `DELIVERED` qua API cập nhật status.

```powershell
curl.exe -X PATCH "$BASE_URL/api/shipments/55/confirm-received" `
  -H "Authorization: Bearer $TOKEN"
```

### Các API hiện có đã điều chỉnh

#### Chọn và cập nhật phương thức nhận

**`POST /api/harvest-requests`**

- Chỉ Customer được tạo yêu cầu; phiên phải sẵn sàng thu hoạch và chưa có harvest.
- Với `DELIVERY`, bắt buộc có `deliveryAddress` và số điện thoại trong hồ sơ khách hàng. Tạo yêu cầu không còn tạo shipment ngay; shipment được tạo khi harvest DELIVERY hoàn tất.
- Với `PICKUP`, vẫn cần `scheduledAt` trong khung thời gian cho phép.

**`PATCH /api/harvest-requests/{id}`**

- Chỉ cập nhật khi yêu cầu chưa `COMPLETED`/`CANCELLED`, chưa có harvest và phiên vẫn đủ điều kiện nhận.
- Customer chỉ được đổi phương thức nhận trong ngày phiên sẵn sàng thu hoạch và ngày kế tiếp; staff có thể điều chỉnh khi phiên còn đủ điều kiện.
- Lịch PICKUP phải từ thời điểm hiện tại đến tối đa ba ngày sau ngày sẵn sàng thu hoạch, trong khung 07:00–17:00 giờ Việt Nam.
- Chọn DELIVERY cần hồ sơ khách hàng có số điện thoại; `deliveryAddress` có thể để trống khi cập nhật để dùng địa chỉ hồ sơ.

#### Bắt đầu và hoàn tất harvest

**`POST /api/harvests/{id}/start`** và **`POST /api/harvests/{id}/yield`**

Hai endpoint cũ vẫn tồn tại để tương thích nhưng đã deprecated. Luồng mới dùng `POST /api/harvests` để tạo harvest, bắt đầu thu hoạch và ghi yield cùng lúc.

**`POST /api/harvests/{id}/complete`**

- Chỉ hoàn tất harvest `IN_PROGRESS` thuộc phiên `HARVESTING`, đã có đủ yield và còn yêu cầu nhận hiệu lực.
- Với `PICKUP`, API hoàn tất bàn giao và phiên; đơn hàng được hoàn tất khi tất cả phiên của đơn đã xong. Khay được chuyển sang `MAINTENANCE`.
- Với `DELIVERY`, API tạo shipment `PENDING`; phiên chưa hoàn tất cho đến khi khách hàng gọi `PATCH /api/shipments/{id}/confirm-received`.
- Gọi lại cho harvest đã `COMPLETED` trả bản ghi hiện tại.

**`POST /api/harvest-requests/{id}/complete`**

Endpoint legacy đã deprecated và chỉ còn hoàn tất bàn giao PICKUP cũ sau khi harvest hoàn thành. Không dùng cho DELIVERY; khách hàng xác nhận giao hàng bằng `PATCH /api/shipments/{id}/confirm-received`.

#### Shipment của đơn có phiên trồng

**`POST /api/shipments`**

Chỉ tạo thủ công shipment cho đơn không có cultivation session. Shipment đơn thu hoạch được tạo tự động khi hoàn tất harvest DELIVERY; gọi thủ công cho đơn có phiên trồng sẽ trả `409`.

**`PATCH /api/shipments/{id}/status`**

- Không còn nhận `DELIVERED` hoặc `deliveredAt`; khách hàng phải xác nhận nhận hàng qua endpoint `confirm-received`.
- Shipment gắn với cultivation session giữ `PENDING` chờ khách xác nhận; không thể chuyển sang `SHIPPED`/`IN_TRANSIT` qua API này.
- Với đơn không có cultivation session, staff vẫn có thể cập nhật các trạng thái vận chuyển được hỗ trợ.

**`GET /api/shipments/admin`** và **`GET /api/shipments/orders/{orderId}`**

Response có thêm `harvest_request_id` để xác định shipment thuộc yêu cầu nhận thu hoạch nào.

#### Đọc harvest và lịch sử đơn hàng

**`GET /api/harvests/admin`**, **`GET /api/harvests/{id}`** và **`GET /api/orders/{orderId}/harvest-history`**

Thông tin phương thức nhận (`harvest_method`) được liên kết với đúng yêu cầu nhận của từng harvest, thay vì lấy một yêu cầu bất kỳ cùng phiên/đơn.

## Các mốc thay đổi

- `96d7f2b`: tạo QR cho khay; thêm backfill, lấy ảnh QR, quét QR và ghi inspection hằng ngày bằng QR.
- `064c7ea`: thêm cập nhật tăng trưởng qua QR và xem trạng thái tăng trưởng các khay.
- `7501830`: thêm báo cáo sự cố qua QR và đóng tư vấn trực tiếp.
- `7e998ec`: thêm xác nhận vệ sinh bằng QR, đánh giá sẵn sàng thu hoạch và tự chuyển `HARVEST_READY` khi đủ điều kiện.
- `115e9dc`: rút gọn quy trình thu hoạch, yêu cầu nhận thu hoạch hỗ trợ hủy, shipment giao hàng chỉ được khách hàng xác nhận đã nhận.
