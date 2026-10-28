const messages = {
  'ssr.db.pool.wait': 'Đang chờ kết nối cơ sở dữ liệu cho SSR',
  'ssr.db.pool.acquired': 'Đã nhận kết nối cơ sở dữ liệu cho SSR',
  'ssr.db.query.start': 'Bắt đầu truy vấn dữ liệu SSR',
  'ssr.db.query.done': 'Đã hoàn tất truy vấn dữ liệu SSR',
  'ssr.mqtt.received': 'Đã nhận phản hồi SSR qua MQTT',
  'ssr.feedback.dropped': 'Đã bỏ phản hồi SSR do hệ thống đang dừng hoặc hàng đợi đã đầy',
  'ssr.db.start': 'Bắt đầu lưu phản hồi SSR',
  'ssr.db.committed': 'Đã lưu phản hồi SSR',
  'ssr.db.ignored': 'Đã bỏ qua phản hồi SSR của bộ điều khiển chưa đăng ký',
  'ssr.db.failed': 'Không thể lưu phản hồi SSR',
  'ssr.get.start': 'Bắt đầu đọc trạng thái SSR',
  'ssr.get.done': 'Đã đọc trạng thái SSR',
  'ssr.command.publish.start': 'Bắt đầu gửi lệnh điều khiển SSR',
  'ssr.command.publish.acked': 'Máy chủ MQTT đã xác nhận nhận lệnh điều khiển SSR',
};

// Only pass validated identifiers and timing/state metadata, never credentials or payloads.
function trace(logger, event, fields = {}) {
  logger.info(JSON.stringify({ event, message: messages[event] || 'Sự kiện điều khiển SSR', at: new Date().toISOString(), ...fields }));
}

module.exports = trace;
