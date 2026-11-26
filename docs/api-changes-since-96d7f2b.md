# API thay đổi từ commit `96d7f2b` đến hiện tại

Tài liệu tổng hợp các API được thêm hoặc mở rộng trong phạm vi commit `96d7f2b` đến `HEAD` (`7e998ec`). Nội dung tập trung vào QR khay, inspection/tăng trưởng, báo cáo sự cố, tư vấn chuyên gia và vệ sinh khay; không liệt kê các API khác đã có từ trước.

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
| `POST` | `/api/cultivation-sessions/admin/inspections` | Ghi inspection hằng ngày bằng QR hoặc ID assignment; có thể đính kèm ảnh |
| `POST` | `/api/cultivation-sessions/admin/qr-growth-update` | Cập nhật giai đoạn phát triển cho khay được quét |
| `GET` | `/api/cultivation-sessions/admin/{sessionId}/growth-status` | Xem tình trạng tăng trưởng của các khay trong phiên |
| `PATCH` | `/api/cultivation-sessions/admin/{sessionId}/harvest-readiness` | Ghi nhận đánh giá sẵn sàng thu hoạch |
| `POST` | `/api/issues/qr` | Tạo báo cáo sự cố cho khay bằng QR, kèm ảnh tùy chọn |
| `PATCH` | `/api/consultations/{consultationId}/close` | Chuyên gia đóng tư vấn và giải quyết sự cố không cần treatment |
| `POST` | `/api/cultivation-trays/qr/{qrToken}/complete-sanitation` | Xác nhận vệ sinh khay bằng QR |

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
- Có thể gửi tối đa 10 ảnh bằng cách lặp lại trường `images`.
- Phiên phải ở trạng thái `CULTIVATING`; mỗi assignment chỉ có tối đa một inspection mỗi ngày theo giờ Việt Nam.
- Thành công: `201 Created`. `400` nếu thiếu hoặc gửi đồng thời cả hai trường định danh; `404` nếu QR/assignment không tồn tại; `409` nếu phiên không ở giai đoạn phù hợp hoặc đã có inspection trong ngày.

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

## Các mốc thay đổi

- `96d7f2b`: tạo QR cho khay; thêm backfill, lấy ảnh QR, quét QR và ghi inspection hằng ngày bằng QR.
- `064c7ea`: thêm cập nhật tăng trưởng qua QR và xem trạng thái tăng trưởng các khay.
- `7501830`: thêm báo cáo sự cố qua QR và đóng tư vấn trực tiếp.
- `7e998ec`: thêm xác nhận vệ sinh bằng QR, đánh giá sẵn sàng thu hoạch và tự chuyển `HARVEST_READY` khi đủ điều kiện.
