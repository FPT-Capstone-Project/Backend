# Capstone Backend

Backend API được xây dựng bằng Node.js, Express và PostgreSQL. Project hiện có nền tảng xác thực người dùng bằng JWT, mã hóa password bằng bcrypt, Swagger UI và cấu trúc module để tiếp tục phát triển các API khác.

## Thanh toán PayOS

Ứng dụng mobile tạo hoặc lấy lại payment link bằng `POST /api/payments/orders/{orderId}/payos`, sau đó mở `checkoutUrl` trong response để khách thanh toán. Sau khi mở trang thanh toán, ứng dụng poll `GET /api/payments/orders/{orderId}/status` cho đến khi `paymentStatus` là `PAID`. Không dùng redirect về `PAYOS_RETURN_URL` làm bằng chứng thanh toán thành công; trạng thái từ API mới là nguồn xác nhận.

PayOS gọi `POST /api/payments/payos/webhook` để cập nhật thanh toán. URL webhook phải là HTTPS public và cần được đăng ký bằng script `npm run payos:confirm-webhook`; app mobile không gọi endpoint webhook này trực tiếp.

## 1. Công nghệ sử dụng

- Node.js
- Express 5
- PostgreSQL
- `pg` để kết nối PostgreSQL
- `bcryptjs` để hash và kiểm tra password
- `jsonwebtoken` để tạo và xác thực JWT
- `dotenv` để đọc biến môi trường
- `swagger-jsdoc` và `swagger-ui-express` để tạo Swagger UI
- `nodemon` cho môi trường development

## 2. Cấu trúc thư mục

```text
Backend/
├── src/
│   ├── config/
│   │   ├── db.js              # PostgreSQL connection pool
│   │   ├── env.js             # Đọc và kiểm tra biến môi trường
│   │   └── swagger.js         # OpenAPI metadata và schema dùng chung
│   ├── controllers/
│   │   └── auth.controller.js # Nhận request và trả response
│   ├── middlewares/
│   │   └── auth.middleware.js # Authentication và authorization
│   ├── models/
│   │   └── user.model.js      # Query bảng users
│   ├── routes/
│   │   ├── auth.routes.js     # Register, login, current user
│   │   ├── root.routes.js     # Nơi đăng ký các module route
│   │   ├── swagger.routes.js  # Swagger UI và OpenAPI JSON
│   │   └── user.routes.js     # User routes
│   ├── services/
│   │   └── auth.service.js    # Nghiệp vụ auth, bcrypt và JWT
│   ├── utils/
│   │   └── app-error.js       # Custom operational error
│   ├── app.js                 # Khởi tạo Express app
│   └── server.js              # Load env và start HTTP server
├── .env.example
├── .gitignore
├── package.json
└── package-lock.json
```

## 3. Yêu cầu môi trường

Đảm bảo máy đã cài:

- Node.js 18 trở lên
- npm
- PostgreSQL local hoặc một PostgreSQL cloud như Supabase

Kiểm tra phiên bản:

```bash
node --version
npm --version
```

## 4. Cài đặt project

Mở terminal tại thư mục `Backend`:

```bash
npm install
```

Trên Windows, nếu PowerShell chặn lệnh `npm`, có thể dùng:

```powershell
npm.cmd install
```

## 5. Cấu hình file `.env`

Tạo file `.env` từ file mẫu:

PowerShell:

```powershell
Copy-Item .env.example .env
```

CMD:

```cmd
copy .env.example .env
```

Sau đó mở `.env` và cập nhật các giá trị:

```env
NODE_ENV=development
PORT=3000
SERVER_URL=http://localhost:3000

# Dùng DATABASE_URL cho Supabase hoặc PostgreSQL cloud
DATABASE_URL=postgresql://postgres:your-password@your-host:5432/postgres

# Chỉ dùng các biến DB_* nếu không cấu hình DATABASE_URL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=capstone
DB_USER=postgres
DB_PASSWORD=your-postgres-password

JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=1d

# PayOS
PAYOS_CLIENT_ID=your-payos-client-id
PAYOS_API_KEY=your-payos-api-key
PAYOS_CHECKSUM_KEY=your-payos-checksum-key
PAYOS_RETURN_URL=https://your-app.example/payment/return
PAYOS_CANCEL_URL=https://your-app.example/payment/cancel
PAYOS_PAYMENT_EXPIRE_MINUTES=15
PAYOS_WEBHOOK_URL=https://your-api.example/api/payments/payos/webhook
```

### Kết nối Supabase

Có thể dùng connection string PostgreSQL do Supabase cung cấp:

```env
DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres
```

Khi có `DATABASE_URL`, ứng dụng sẽ ưu tiên connection string này và bật SSL cho PostgreSQL pool. Không commit file `.env` lên Git. Chỉ commit `.env.example` không chứa password thật.

Nếu password database có ký tự đặc biệt như `@`, `:`, `/`, `#` hoặc khoảng trắng, cần URL-encode password trước khi đưa vào `DATABASE_URL`.

### Gửi OTP bằng Gmail API

OTP được gửi qua Gmail API (HTTPS), không dùng SMTP. Trong Google Cloud, bật Gmail API, tạo OAuth client loại Web application và đăng ký redirect URI khớp chính xác với `GOOGLE_REDIRECT_URI`. Cấu hình trên máy local và Render:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://<backend-domain>/api/auth/google/callback
GMAIL_REFRESH_TOKEN=
GMAIL_SENDER=sender@gmail.com
```

Để cấp quyền cho hộp thư gửi OTP, mở `/api/auth/google` trên backend đã deploy, đăng nhập đúng tài khoản gửi thư và chấp thuận quyền gửi email. Callback trả refresh token một lần trong response không-cache; lưu giá trị đó vào `GMAIL_REFRESH_TOKEN` trong Environment của Render. `GMAIL_SENDER` phải là chính hộp thư đã cấp quyền. Không ghi refresh token vào log hoặc chia sẻ công khai. Sau khi cấu hình, các API OTP hiện tại sẽ gửi qua Gmail API.

## 6. Chuẩn bị database

Bảng `users` cần tồn tại trước khi gọi API đăng ký. Bảng `users` có foreign key tới bảng `roles`, vì vậy bảng `roles` và role tương ứng cũng phải tồn tại trước.

Ví dụ cấu trúc bảng `users`:

```sql
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    role_id INT NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id)
        REFERENCES roles(role_id)
        ON DELETE RESTRICT
);
```

Kiểm tra database connection bằng query:

```bash
node -e "const pool=require('./src/config/db'); pool.query('SELECT current_database(), current_user').then(result=>{console.log(result.rows); return pool.end();}).catch(error=>{console.error(error.message); pool.end(()=>process.exit(1));});"
```

## 7. Chạy project

### Development

Chạy với `nodemon`, server tự restart khi source thay đổi:

```bash
npm run dev
```

Alias tương đương:

```bash
npm run rundev
```

### Normal/production-style start

```bash
npm start
```

Khi server chạy thành công, terminal sẽ in các URL tương tự:

```text
=================================
Server running on port 3000
Base URL: http://localhost:3000
Swagger: http://localhost:3000/api-docs
Health: http://localhost:3000/health
=================================
```

## 8. Swagger UI

Mở giao diện Swagger tại:

```text
http://localhost:3000/api-docs
```

OpenAPI JSON:

```text
http://localhost:3000/api-docs.json
```

Các route có tài liệu OpenAPI được viết trực tiếp bằng comment `@openapi` trong thư mục `src/routes`.

Trong Swagger UI, với API cần đăng nhập:

1. Gọi API login.
2. Copy giá trị `token` trong response.
3. Bấm **Authorize**.
4. Nhập token theo dạng:

```text
Bearer <jwt-token>
```

5. Bấm **Authorize** rồi gọi `/api/auth/me` hoặc `/api/users/me`.

## 9. API hiện có

### Health check

```http
GET /health
```

Response:

```json
{
  "status": "ok"
}
```

### Đăng ký

```http
POST /api/auth/register
Content-Type: application/json
```

Request body:

```json
{
  "name": "Nguyen Van A",
  "email": "user@example.com",
  "password": "password123",
  "phone": "0900000000",
  "address": "Ho Chi Minh City"
}
```

API tạo tài khoản chưa xác minh và gửi OTP tới email qua Gmail API. Sau đó xác minh mã bằng:

```http
POST /api/auth/verify-registration-otp
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

`/api/auth/register-otp` vẫn được hỗ trợ như alias. Trường `fullName` cũ cũng được chấp nhận thay cho `name`.

### Đăng nhập

```http
POST /api/auth/login
Content-Type: application/json
```

Request body:

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Response thành công trả về user và JWT token. Password không được trả về response.

### Lấy user hiện tại

```http
GET /api/auth/me
Authorization: Bearer <jwt-token>
```

Hoặc:

```http
GET /api/users/me
Authorization: Bearer <jwt-token>
```

## 10. JWT Authentication và Authorization

JWT được tạo sau khi đăng ký hoặc đăng nhập thành công. Payload hiện có:

```json
{
  "sub": "1",
  "roleId": 2
}
```

Middleware `authenticate` thực hiện:

1. Đọc header `Authorization`.
2. Kiểm tra format `Bearer <token>`.
3. Verify chữ ký JWT và thời hạn token.
4. Tìm user tương ứng trong database.
5. Từ chối user không tồn tại hoặc không có trạng thái `ACTIVE`.
6. Gắn user vào `req.user` để controller sử dụng.

Middleware `authorizeRoles` là khung phân quyền theo `role_id`:

```js
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

router.get(
  '/admin-only',
  authenticate,
  authorizeRoles(1),
  controller.adminOnly,
);
```

Trong ví dụ trên, chỉ user có `role_id = 1` mới được truy cập route.

## 11. Error handling

Các lỗi nghiệp vụ sử dụng `AppError` và được xử lý bởi error handler cuối cùng trong `src/app.js`.

Một số mã lỗi hiện có:

| HTTP status | Ý nghĩa |
|---|---|
| `400` | Thiếu dữ liệu, password không hợp lệ hoặc role không tồn tại |
| `401` | Token thiếu, token sai/hết hạn hoặc email/password sai |
| `403` | User không ACTIVE hoặc không đủ quyền |
| `404` | Không tìm thấy route |
| `409` | Email đã được đăng ký |
| `500` | Lỗi server hoặc database không dự kiến |

Response lỗi hiện tại có dạng:

```json
{
  "message": "Invalid email or password"
}
```

## 12. Thêm route mới

Tạo controller trong `src/controllers`, service nếu có nghiệp vụ, model nếu có query database, sau đó đăng ký route qua `src/routes/root.routes.js`:

```js
const exampleRoutes = require('./example.routes');

rootRouter.use('/examples', exampleRoutes);
```

Route mới nên được bảo vệ bằng middleware nếu cần đăng nhập:

```js
router.get('/private', authenticate, controller.privateAction);
```

Nếu cần phân quyền:

```js
router.get('/admin', authenticate, authorizeRoles(1), controller.adminAction);
```

## 13. Kiểm tra nhanh sau khi cài đặt

1. Chạy `npm install`.
2. Tạo và cấu hình `.env`.
3. Đảm bảo bảng `roles` và `users` đã tồn tại.
4. Chạy `npm run dev`.
5. Mở `http://localhost:3000/health`.
6. Mở `http://localhost:3000/api-docs`.
7. Đăng ký hoặc đăng nhập để lấy JWT.
8. Dùng JWT gọi `/api/auth/me`.

## 14. Lưu ý bảo mật

- Không commit `.env` hoặc password database lên Git.
- Dùng `JWT_SECRET` đủ dài và ngẫu nhiên.
- Không dùng secret mặc định khi deploy production.
- Không log password hoặc JWT token trong server log.
- Nếu connection string đã bị chia sẻ, nên đổi password database trên Supabase.
- Chỉ trả về các trường public của user; không trả về `password_hash`.

## 15. Phạm vi hiện tại

Project hiện mới tập trung vào base backend và authentication:

- Express app và server startup.
- PostgreSQL connection pool.
- JWT authentication.
- Bcrypt password hashing.
- Authorization middleware dạng khung.
- Swagger UI/OpenAPI.
- Route health check, auth và current user.

Các module CRUD như orders, products, maintenance hoặc dashboard chưa được triển khai trong backend hiện tại.
