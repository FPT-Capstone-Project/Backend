# Luong tay test: Yeu cau chuyen gia

## Cập nhật mobile: hội thoại hai chiều và ảnh

### Expert xem thông tin phiên

Trong chi tiết tư vấn, bấm **Xem thông tin phiên trồng**. Trang chỉ đọc sử dụng `GET /api/issues/{issueId}` hiện có, hiển thị loại nấm, trạng thái phiên, khay/tầng, ngày bắt đầu/dự kiến thu hoạch, tiến độ mới nhất và báo cáo nguồn.

Backend bổ sung `session_status`, `session_start_at`, `expected_harvest_date`, `growth_stage`, `growth_progress`, `growth_condition`, `growth_updated_at`, `tray_code`, `floor_id`, `tray_condition`, `mushroom_condition`, `inspection_notes`, `inspection_at`, `spawn_condition`. Không cần thêm bảng/cột. Cần triển khai code backend này để app nhận các trường bổ sung.

Kiểm tra giai đoạn hiện tại lấy từ bản ghi tiến độ mới nhất; giai đoạn lúc báo sự cố và ảnh chụp dữ liệu môi trường chỉ hiển thị nếu thực sự đã được lưu. Thiếu dữ liệu hiển thị “Chưa ghi nhận”. Mở/đóng trang không thay đổi trạng thái tư vấn hay phiên trồng.

Không cần migration hay bảng mới. Backend lưu hội thoại có cấu trúc trong cột `expert_consultations.question` hiện có, trả câu hỏi gốc và danh sách `messages` qua các API cũ. Câu hỏi và các tin bổ sung cũ vẫn đọc được.
Các phản hồi chuyên môn từ thời điểm cập nhật được lưu thành tin riêng, không mất khi Expert trả lời tiếp.

- Farm Operator mở báo cáo → **Nhờ chuyên gia** → nhập nội dung, chọn **Đính kèm ảnh** → gửi yêu cầu. Ảnh được tải trước khi gửi yêu cầu; nếu lỗi có thể tiếp tục yêu cầu đã lưu.
- Expert nhận tư vấn rồi mở **Trao đổi trong yêu cầu**. Hai bên gửi được nhiều tin và ảnh, kể cả sau khi consultation là `ANSWERED`, lúc chờ duyệt và khi theo dõi.
- Tin nhắn có người gửi, thời gian, ảnh có thể bấm xem lớn. Hội thoại tải mới mỗi 5 giây khi app đang hoạt động; có nút tải lại.
- Gửi tin/ảnh không thay đổi trạng thái xử lý và không hoàn tất yêu cầu. Expert vẫn gửi chẩn đoán/hướng xử lý, Operator ghi nhận xử lý, Expert duyệt rồi chọn **Đã ổn — Hoàn tất yêu cầu** khi issue `MONITORING`.
- Sau hoàn tất, hội thoại chỉ đọc. Expert khác chưa được phân công và Customer không được gửi tin.

`POST /api/consultations/{id}/messages` nhận JSON `{ "message": "Nội dung" }` hoặc multipart với `message` và `file` (ảnh, tối đa 25 MB). Có thể chỉ gửi ảnh. Cả Farm Operator và Expert được phân công đều dùng endpoint này. Response chi tiết consultation có `messages[].media_url` khi có ảnh.

Checklist bổ sung: gửi 3 lượt mỗi bên; gửi ảnh không có chữ; gửi tiếp sau `ANSWERED`; gửi khi `WAITING_REVIEW`/`MONITORING`; kiểm tra không mất phản hồi cũ; hoàn tất rồi xác nhận API gửi tin trả `409`; thử Expert khác trả `403`.

Các bước bên dưới mô tả luồng nghiệp vụ; bước bổ sung thông tin không còn bị giới hạn ở `WAITING_EXPERT`. Ảnh trong tin nhắn độc lập với ảnh issue/treatment nên vẫn gửi được lúc theo dõi.

Tai lieu nay mo ta cach test toan bo quy trinh WF-06 tu khi Farm Operator tao issue, chuyen gia nhan va chan doan, den khi treatment duoc duyet va issue duoc giai quyet.

## 1. Cau hinh chung

- Base URL: `http://localhost:<PORT>/api`
- Swagger UI: `http://localhost:<PORT>/api-docs`
- Swagger JSON: `http://localhost:<PORT>/api-docs.json`
- Header cho moi API da dang nhap:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

Can co ba tai khoan dang ACTIVE:

| Vai tro | role_id | Quyen test |
|---|---:|---|
| Farm Operator | 2 | Tao issue, yeu cau chuyen gia, ghi treatment va tai media |
| Mushroom Expert | role name chua `expert` | Nhan consultation, chan doan, duyet treatment, resolve issue |
| Customer | 3 | Xem issue va timeline cua session minh so huu |

Ngoai ra, issue nguon phai hop le va tai lieu nay su dung spawn inspection `32`.

- `spawnInspectionId`: `32`

Dang nhap tung tai khoan:

```http
POST /api/auth/login
Content-Type: application/json
```

```json
{
  "email": "operator@email.com",
  "password": "password"
}
```

Luon lay `accessToken` moi tu response va luu lai:

- `OPERATOR_TOKEN`
- `EXPERT_TOKEN`
- `CUSTOMER_TOKEN`

## 2. Trang thai can kiem tra

```text
Issue:
OPEN -> WAITING_EXPERT -> IN_PROGRESS -> WAITING_REVIEW -> MONITORING -> RESOLVED

Consultation:
PENDING -> IN_PROGRESS -> ANSWERED -> CLOSED
```

Truong hop expert can them thong tin:

```text
Consultation: PENDING/IN_PROGRESS
Issue: WAITING_EXPERT
```

---

## 3. Test luong chinh

### Buoc 1: Farm Operator tao issue

Goi API voi spawn inspection `32`:

```http
POST /api/issues
Authorization: Bearer <OPERATOR_TOKEN>
Content-Type: application/json
```

```json
{
  "spawnInspectionId": 32,
  "issueType": "CONTAMINATION",
  "title": "Abnormal spawn inspection 32",
  "description": "Several spawn units show abnormal contamination from spawn inspection 32.",
  "severity": "HIGH"
}
```

Kỳ vong:

- Status HTTP: `201`
- `data.status`: `OPEN`
- Lu u `data.issue_id` thanh `ISSUE_ID`

Optional: upload anh chan chung issue:

```http
POST /api/issues/{ISSUE_ID}/media
Authorization: Bearer <OPERATOR_TOKEN>
Content-Type: multipart/form-data
```

Form-data:

| Field | Gia tri |
|---|---|
| `file` | Mot file JPG hoac PNG |
| `caption` | Mo ta anh, optional |

Chi issue co linked inspection moi ho tro issue media.

### Buoc 2: Farm Operator yeu cau consultation

```http
POST /api/issues/{ISSUE_ID}/consultations
Authorization: Bearer <OPERATOR_TOKEN>
Content-Type: application/json
```

```json
{
  "question": "Please diagnose the discoloration and suggest a treatment."
}
```

Kỳ vong:

- Status HTTP: `201`
- `data.status`: `PENDING`
- Issue status: `WAITING_EXPERT`
- Lu u `data.consultation_id` thanh `CONSULTATION_ID`

Notification cho expert co:

- `notification_type`: `MUSHROOM_DISEASE`
- `reference_type`: `EXPERT_CONSULTATION`
- `reference_id`: `CONSULTATION_ID`

### Buoc 3: Expert xem danh sach consultation

```http
GET /api/consultations?status=PENDING&page=1&pageSize=20
Authorization: Bearer <EXPERT_TOKEN>
```

Kỳ vong:

- Consultation vua tao xuat hien trong danh sach.

Xem chi tiet:

```http
GET /api/consultations/{CONSULTATION_ID}
Authorization: Bearer <EXPERT_TOKEN>
```

### Buoc 4: Expert nhan consultation

```http
PATCH /api/consultations/{CONSULTATION_ID}/assign
Authorization: Bearer <EXPERT_TOKEN>
```

Khong can request body.

Kỳ vong:

- Status HTTP: `200`
- Consultation status: `IN_PROGRESS`
- Co `expert_id`
- Issue van o trang thai `WAITING_EXPERT`

Neu mot expert khac cung thu nhan:

- Kỳ vong: `409`

### Buoc 5: Expert chan doan va dua ra giai phap

```http
PATCH /api/consultations/{CONSULTATION_ID}/respond
Authorization: Bearer <EXPERT_TOKEN>
Content-Type: application/json
```

```json
{
  "diagnosis": "Likely surface contamination.",
  "solution": "Isolate the tray and improve ventilation.",
  "needsMoreInfo": false
}
```

Kỳ vong:

- Consultation status: `ANSWERED`
- Issue status: `IN_PROGRESS`
- Co `diagnosis`, `solution`, `responded_at`

### Buoc 6: Farm Operator ghi treatment

```http
POST /api/consultations/{CONSULTATION_ID}/treatments
Authorization: Bearer <OPERATOR_TOKEN>
Content-Type: application/json
```

```json
{
  "actionDescription": "Isolated the tray and adjusted ventilation.",
  "resultDescription": "No further spread observed."
}
```

Kỳ vong:

- Status HTTP: `201`
- Issue status: `WAITING_REVIEW`
- Lu u `data.treatment_log_id` thanh `TREATMENT_ID`

### Buoc 7: Upload media cho treatment

```http
POST /api/treatments/{TREATMENT_ID}/media
Authorization: Bearer <OPERATOR_TOKEN>
Content-Type: multipart/form-data
```

Form-data:

| Field | Gia tri |
|---|---|
| `file` | Anh hoac video |
| `mediaStage` | `BEFORE`, `DURING` hoac `AFTER` |
| `caption` | Mo ta media, optional |

Kỳ vong:

- Status HTTP: `201`

Khong duoc tao treatment thu hai truoc khi treatment hien tai duoc expert review:

- Kỳ vong: `409`

### Buoc 8A: Expert yeu cau them action

```http
POST /api/treatments/{TREATMENT_ID}/review
Authorization: Bearer <EXPERT_TOKEN>
Content-Type: application/json
```

```json
{
  "reviewResult": "NEEDS_MORE_ACTION",
  "reviewComment": "Continue ventilation adjustment and monitor the tray."
}
```

Kỳ vong:

- Issue status: `IN_PROGRESS`

### Buoc 9: Operator ghi treatment tiep theo

```http
POST /api/consultations/{CONSULTATION_ID}/treatments
Authorization: Bearer <OPERATOR_TOKEN>
Content-Type: application/json
```

```json
{
  "actionDescription": "Completed follow-up and documented the outcome.",
  "resultDescription": "The issue is stable and ready for expert review."
}
```

Luu treatment moi thanh `TREATMENT_ID_2`.

### Buoc 10: Expert duyệt treatment

```http
POST /api/treatments/{TREATMENT_ID_2}/review
Authorization: Bearer <EXPERT_TOKEN>
Content-Type: application/json
```

```json
{
  "reviewResult": "APPROVED",
  "reviewComment": "Treatment was performed correctly."
}
```

Kỳ vong:

- Issue status: `MONITORING`
- Consultation van o trang thai `ANSWERED`

### Buoc 11: Expert xac nhan issue da duoc giai quyet

```http
PATCH /api/issues/{ISSUE_ID}/resolve
Authorization: Bearer <EXPERT_TOKEN>
Content-Type: application/json
```

```json
{
  "reviewComment": "Confirmed the issue is resolved."
}
```

Kỳ vong:

- Issue status: `RESOLVED`
- Co `resolved_at`
- Co `resolved_by`
- Consultation status: `CLOSED`
- Co review `RESOLVED`

---

## 4. Luong expert can them thong tin

Sau khi expert nhan consultation, expert goi:

```http
PATCH /api/consultations/{CONSULTATION_ID}/respond
Authorization: Bearer <EXPERT_TOKEN>
Content-Type: application/json
```

```json
{
  "diagnosis": "Please provide a close-up photo from beneath the tray.",
  "needsMoreInfo": true
}
```

Kỳ vong:

- Consultation status: `IN_PROGRESS`
- Issue status: `WAITING_EXPERT`
- `solution`: `null`

Operator them thong tin:

```http
POST /api/consultations/{CONSULTATION_ID}/messages
Authorization: Bearer <OPERATOR_TOKEN>
Content-Type: application/json
```

```json
{
  "message": "Added a close-up photo and sensor reading context."
}
```

Expert gui chan doan cuoi:

```http
PATCH /api/consultations/{CONSULTATION_ID}/respond
Authorization: Bearer <EXPERT_TOKEN>
Content-Type: application/json
```

```json
{
  "diagnosis": "Low airflow is likely affecting growth.",
  "solution": "Increase ventilation and monitor the tray.",
  "needsMoreInfo": false
}
```

Kỳ vong:

- Consultation status: `ANSWERED`
- Issue status: `IN_PROGRESS`

---

## 5. Customer xem tien trinh

List issue cua session:

```http
GET /api/customer/sessions/{SESSION_ID}/issues
Authorization: Bearer <CUSTOMER_TOKEN>
```

Xem chi tiet:

```http
GET /api/customer/issues/{ISSUE_ID}
Authorization: Bearer <CUSTOMER_TOKEN>
```

Xem timeline:

```http
GET /api/customer/issues/{ISSUE_ID}/timeline
Authorization: Bearer <CUSTOMER_TOKEN>
```

Timeline can co:

- Issue va issue status
- Consultation
- Original question va follow-up messages
- Treatment actions
- Treatment media
- Expert treatment reviews
- Resolution review

---

## 6. Cac case loi can test

| Truong hop | API | Kỳ vong |
|---|---|---|
| Operator goi assign/respond | `/consultations/{id}/assign` hoac `/respond` | `403` |
| Expert ghi treatment | `/consultations/{id}/treatments` | `403` |
| Customer tao issue hoac duyet treatment | Issue/treatment endpoints | `403` |
| Khach xem session/issue khong thuoc minh | Customer issue/session endpoints | `404` |
| Thieu `question` | Tao consultation | `400` |
| Thieu `diagnosis` | Respond consultation | `400` |
| Thieu `actionDescription` | Tao treatment | `400` |
| Thieu `reviewResult` | Review treatment | `400` |
| Tao consultation lan hai khi issue khong OPEN | Tao consultation | `409` |
| Expert duyet lai treatment da review | Review treatment | `409` |
| Resolve issue khi issue chua MONITORING | Resolve issue | `409` |
| Upload video vao issue media | Issue media | `400` |
| Upload issue media sau khi issue MONITORING/RESOLVED | Issue media | `409` |
| Xoa treatment media sau khi issue da lock | Delete treatment media | `409` |
| Khong gui field `file` | Upload issue/treatment media | `400` |

## 7. Checklist hoan thanh

- [ ] Tao issue thanh cong o trang thai `OPEN`
- [ ] Tao consultation va issue chuyen sang `WAITING_EXPERT`
- [ ] Expert nhan consultation thanh cong
- [ ] Expert chan doan va dua ra solution
- [ ] Operator ghi treatment thanh cong
- [ ] Expert yeu cau them action hoac approve treatment
- [ ] Issue tiep tuc sang `MONITORING`
- [ ] Expert resolve issue va consultation dong lai
- [ ] Customer xem duoc timeline va toan bo lich su
- [ ] Tat ca role, validation va state conflict dung nhu mong doi
