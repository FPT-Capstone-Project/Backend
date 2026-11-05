# API biểu đồ môi trường dashboard

## Phân tích luồng frontend hiện tại

Theo mô tả EnvironmentChart.tsx, “Tầng 1 / Tầng 2” thực chất là N biểu đồ,
mỗi tầng một biểu đồ với hai đường nhiệt độ và độ ẩm. Frontend hiện lấy danh sách
tầng, master, snapshot từng tầng, rồi tải nhiều trang lịch sử cho từng sensor và
tự gộp bucket. Số request và dữ liệu tải về tăng theo số tầng và tần suất sensor.

API mới thực hiện phần tổng hợp trong PostgreSQL, trả dữ liệu để vẽ bằng một request.
Không tạo bảng, migration hay dữ liệu giả. Dùng các bảng hiện có:
`cultivation_floors`, `iot_masters`, `iot_auto_control_configs`, `iot_sensor_readings`.

## Request

`GET /api/analytics/dashboard/environment-history`

Yêu cầu Bearer JWT của Admin hoặc Farm Operator. Mặc định trả 24 giờ kết thúc tại
mốc 5 phút gần nhất, 96 bucket × 15 phút. Mọi tầng ACTIVE đều có mặt, kể cả tầng
chưa có dữ liệu. Không có tầng thì `floors=[]`.

Có thể truyền cặp `from` và `to` dạng ISO có timezone, ví dụ:

```text
?from=2026-11-04T00:00:00Z&to=2026-11-05T00:00:00Z
```

Cả hai phải được truyền cùng nhau; khoảng thời gian phải dương và tối đa 24 giờ.
Trả 400 nếu sai khoảng thời gian, 401 nếu thiếu/sai JWT, 403 nếu không phải nhân viên.

## Response

Ví dụ dưới đây rút gọn mảng points; API thực tế trả toàn bộ bucket:

```json
{
  "data": {
    "from": 1793750400000,
    "to": 1793836800000,
    "bucketMs": 900000,
    "refreshAfterMs": 300000,
    "floors": [
      {
        "floorId": 1,
        "floorName": "Tầng 1",
        "floorNumber": 1,
        "roomId": 1,
        "masterDbId": 1,
        "masterId": "master01",
        "nodeId": 1,
        "thresholds": {
          "temperature_min": 20,
          "temperature_max": 30,
          "humidity_min": 75,
          "humidity_max": 90
        },
        "points": [
          { "timestamp": 1793750400000, "temperature": 27.5, "humidity": 82 },
          { "timestamp": 1793751300000, "temperature": null, "humidity": null }
        ]
      }
    ]
  }
}
```

`from`, `to`, `timestamp` đều là epoch milliseconds để dùng trực tiếp cho trục X.
`thresholds` là ngưỡng cấu hình hiện tại; trường chưa cấu hình trả null. Đây không
phải ngưỡng lịch sử tại thời điểm đo. Lịch sử được gắn theo mapping master/node
hiện tại của tầng, giống luồng frontend cũ; hệ thống chưa lưu lịch sử thay mapping.

Mỗi bucket lấy trung bình riêng từng sensor 1–3, sau đó lấy trung bình các sensor
có dữ liệu, độc lập cho temperature/humidity. Sensor gửi nhiều mẫu không được
trọng số lớn hơn sensor gửi ít mẫu. Chỉ nhận mẫu is_valid=true, không retained,
giá trị nhiệt độ trong [-40,125], độ ẩm trong [0,100]. Thiếu dữ liệu trả null,
không thay bằng 0 hay nội suy. Timestamp dựa trên received_at, không measured_at.

Bucket bắt đầu tại `from`, không tự làm tròn sang :00/:15/:30/:45. Khoảng đọc là
`[from,to)`, không lấy mẫu đúng tại to. Khoảng tùy chọn không chia hết 15 phút sẽ
có bucket cuối ngắn hơn. Giá trị không làm tròn; frontend định dạng một chữ số thập phân.

## Đổi frontend

Chỉ riêng biểu đồ môi trường, thay chuỗi useFloorEnvironmentOverview/useFloorHistory
và việc map master bằng một query. Giữ các hook cũ nếu phần khác của dashboard còn dùng.

```tsx
const environmentQuery = useQuery({
  queryKey: ['dashboard', 'environment-history'],
  queryFn: async () => {
    const response = await apiClient.get('/api/analytics/dashboard/environment-history')
    return response.data.data
  },
  staleTime: 5 * 60_000,
  refetchInterval: 5 * 60_000,
  refetchOnWindowFocus: false,
})

const chart = environmentQuery.data
// Xử lý loading/error và chart.floors.length === 0 trước khi render.
// Với mỗi floor trong chart.floors:
<LineChart data={floor.points}>
  <XAxis dataKey="timestamp" type="number" domain={[chart.from, chart.to]}
    tickFormatter={value => new Date(value).toLocaleTimeString('vi-VN', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
    })} />
  <YAxis yAxisId="temperature" unit="°C" />
  <YAxis yAxisId="humidity" orientation="right" unit="%RH" />
  <Line yAxisId="temperature" dataKey="temperature" connectNulls={false} />
  <Line yAxisId="humidity" dataKey="humidity" strokeDasharray="7 4" connectNulls={false} />
</LineChart>
```

Đoạn trên minh họa phần nối dữ liệu; giữ layout, màu, tooltip và climateAxis đang có.
Tiêu đề dùng `floor.floorName`, tooltip dùng `floor.thresholds`; nếu tooltip hiện
tại dùng ClimateThresholds thì giữ hàm climateThresholdsFromConfig để chuyển đổi.
Giữ connectNulls=false. Bỏ vòng lặp phân trang và aggregateFloorHistory ở luồng này.
Lỗi API hiển thị lỗi tải biểu đồ, không giả thành mảng dữ liệu rỗng.

API cũ và API thống kê `/api/analytics/dashboard` vẫn dùng được như trước.
Backend này không chứa repo mcms-web-admin nên chưa chỉnh trực tiếp component web.
